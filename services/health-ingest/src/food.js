/**
 * Food log routes (Nutrición part 2), mounted by server.js under /food/ and reached from the LAN
 * plan page through plan-web's /api/food/ proxy:
 *
 *   GET    /food/products            active products (each with its store)
 *   POST   /food/products            create        PUT /food/products/:id   edit    DELETE = archive
 *   GET    /food/recipes             active recipes with COMPUTED macros (per serving / per 100 g cooked)
 *   POST   /food/recipes             create        PUT /food/recipes/:id    edit    DELETE = archive
 *   GET    /food/log?date=YYYY-MM-DD entries of that (local) day + day totals
 *   POST   /food/log                 add one entry (macros SNAPSHOT computed here)   DELETE /food/log/:id
 *   GET    /food/off?barcode=|q=     Open Food Facts lookup, server side (src/off.js); saves nothing
 *   GET    /food/log/summary?from=&to=  per-day sums of the log (<= FOOD_LIMITS.summaryDaysMax days): the
 *                                   page's adherence view (food-calc.js daySummaries)
 *   GET    /food/settings            the owner's goal + target weight (one row, sql/007_settings.sql)
 *   PUT    /food/settings            partial update {goal?, targetWeightKg?} (targetWeightKg null clears it)
 *
 * The settings live in their OWN optional migration group (`settings`): when 007 fails only
 * /food/settings answers 503 settings_unavailable, and when the food tables fail it keeps working.
 *
 * Security. A static page cannot hold a secret, so these routes are UNAUTHENTICATED like /sync and
 * meant for the LAN only (a public reverse proxy must NEVER forward /food/*, see README). Layers:
 *   - Host check (DNS rebinding): the Host must be an IP literal, localhost, host.docker.internal (the
 *     plan-web proxy hop) or a name in FOOD_ALLOWED_HOSTS, else 421. A rebinding page (its own name
 *     resolved to a LAN address) is refused here and, first, by plan-web's nginx Host map;
 *   - on writes, an Origin header (when the browser sends one) must name an allowed host too (403);
 *   - every request must carry the custom header `X-HC-Food: 1` (403) and every write
 *     `Content-Type: application/json` (415): from another site both force a CORS preflight, which this
 *     server never approves (it sends no CORS headers at all), so a plain cross-site request is not sent.
 * Together they stop a website opened on a LAN device from reading or writing the log; none of them
 * stops a device on the LAN that talks to the service directly (that is the LAN-only trust model).
 * Bodies are capped at 16 KB (413), writes share one rate limit per client address (429; behind
 * plan-web every request comes from nginx, so it is one shared budget), the whole feature answers 503
 * food_unavailable when its tables failed to migrate, and every error is a COARSE code
 * ({error, field?}), never raw DB text.
 *
 * Validation is strict and by hand: unknown keys are refused, strings trimmed and length-capped,
 * numbers finite, rounded to 1 decimal and THEN checked against the shared FOOD_LIMITS (so 0.04 g is
 * 0 and refused where > 0 is required), dates must round trip, and a label whose kcal disagree with 4 p + 4 c + 9 f by more than 25 % is refused with
 * `atwater` unless the request says `force: true` (fibre / polyols make real labels deviate).
 */
import {
  FOOD_STORES, FOOD_UNITS, ENTRY_UNITS, FOOD_SOURCES, RECIPE_KINDS, REF_TYPES, FOOD_MEALS, FOOD_LIMITS as L, RECIPE_BASIC_UNITS,
  SETTINGS_GOALS, round1, roundMacros, productEntry, recipeBasis, recipeEntry, dayTotals, daySummaries, atwaterOk
} from './food-calc.js'
import { createWindowLimiter } from './limits.js'

export const FOOD_BODY_LIMIT = 16 * 1024
export const FOOD_WRITE_LIMIT = 60 // per client address per minute
export const FOOD_SUMMARY_LIMIT = 30 // GET /food/log/summary per client address per minute (a read of up to 120 days)
// limits: FOOD_LIMITS (food-calc.js, a copy of lib/nutrition/foodlog.mjs, which is authoritative)
const ID_RE = /^[1-9][0-9]{0,15}$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const BARCODE_RE = new RegExp(L.barcodePattern)
const BASIC_KEY_RE = new RegExp(L.basicKeyPattern)
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/ // the page's per-add id (a UUID), makes a retry idempotent
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/
const IPV6_RE = /^\[[0-9a-f:.]+\]$/
const LOCAL_HOSTS = ['localhost', 'host.docker.internal']
const OFF_CODE_RE = /^[0-9]{1,14}$/
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE'])

// path pattern -> allowed methods (+ the optional migration group it needs, default food)
const ROUTES = [
  { re: /^\/food\/settings$/, methods: ['GET', 'PUT'], group: 'settings' },
  { re: /^\/food\/log\/summary$/, methods: ['GET'] },
  { re: /^\/food\/products$/, methods: ['GET', 'POST'] },
  { re: /^\/food\/products\/([^/]+)$/, methods: ['PUT', 'DELETE'] },
  { re: /^\/food\/recipes$/, methods: ['GET', 'POST'] },
  { re: /^\/food\/recipes\/([^/]+)$/, methods: ['PUT', 'DELETE'] },
  { re: /^\/food\/log$/, methods: ['GET', 'POST'] },
  { re: /^\/food\/log\/([^/]+)$/, methods: ['DELETE'] },
  { re: /^\/food\/off$/, methods: ['GET'] }
]

function httpError (status, code, field) {
  return Object.assign(new Error(code), { status, code, field })
}
function bad (field) {
  throw httpError(400, 'invalid', field)
}

/* ---------- validation ---------- */
function isObj (v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
function strictKeys (body, allowed, prefix = '') {
  if (!isObj(body)) bad(prefix ? prefix.slice(0, -1) : 'body')
  for (const k of Object.keys(body)) if (!allowed.includes(k)) bad(prefix + k)
}
function absent (v) {
  return v === undefined || v === null
}
function str (v, field, max, optional = false) {
  if (optional && (absent(v) || v === '')) return null
  if (typeof v !== 'string') bad(field)
  const s = v.replace(/\s+/g, ' ').trim()
  if (!s || s.length > max) bad(field)
  return s
}
// rounded FIRST (1 decimal, the stored precision), then bound-checked: 0.04 is 0, 900.04 is 900
function number (v, field, { min = 0, max, above = false, optional = false, integer = false }) {
  if (optional && absent(v)) return null
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(field)
  if (integer && !Number.isInteger(v)) bad(field)
  const n = integer ? v : round1(v)
  if (above ? n <= min : n < min) bad(field)
  if (n > max) bad(field)
  return n
}
function oneOf (v, field, list) {
  if (!list.includes(v)) bad(field)
  return v
}
function pattern (v, field, re, optional = true) {
  if (optional && (absent(v) || v === '')) return null
  if (typeof v !== 'string' || !re.test(v)) bad(field)
  return v
}
function flag (v, field) {
  if (absent(v)) return false
  if (typeof v !== 'boolean') bad(field)
  return v
}
function id (v, field) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) bad(field)
  return v
}
function pathId (s) {
  return ID_RE.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : null
}
/** YYYY-MM-DD that is a real calendar day (2026-02-31 is refused), years 2000-2100. */
export function validDate (s) {
  const m = typeof s === 'string' ? DATE_RE.exec(s) : null
  if (!m) return null
  const y = Number(m[1])
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3])))
  return y >= 2000 && y <= 2100 && d.toISOString().slice(0, 10) === s ? s : null
}

/** An allowed host name (no port): an IP literal, localhost, host.docker.internal or an allowlisted name. */
export function hostAllowed (hostname, extra = []) {
  const h = String(hostname || '').toLowerCase()
  if (!h) return false
  return IPV4_RE.test(h) || IPV6_RE.test(h) || LOCAL_HOSTS.includes(h) || extra.includes(h)
}
/** The host part of a Host header ("192.168.1.10:8090" -> "192.168.1.10", "[::1]:8088" -> "[::1]"). */
function hostOfHeader (v) {
  const s = String(v || '').trim()
  const m = /^(\[[^\]]*\]|[^:]*)(?::\d+)?$/.exec(s)
  return m ? m[1] : ''
}
/** The host of an Origin header, or null when it is not a URL ("null", garbage). */
function hostOfOrigin (v) {
  try {
    const u = new URL(v)
    return /^https?:$/.test(u.protocol) ? u.hostname : null
  } catch {
    return null
  }
}
/** FOOD_ALLOWED_HOSTS: comma / space separated names, lowercased. */
export function parseAllowedHosts (v) {
  return String(v || '').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
}

export function validateProduct (body) {
  strictKeys(body, ['name', 'brand', 'store', 'barcode', 'unit', 'per100', 'servingSize', 'source', 'offCode', 'force'])
  const p = {
    name: str(body.name, 'name', L.nameMax),
    brand: str(body.brand, 'brand', L.brandMax, true),
    store: oneOf(body.store, 'store', FOOD_STORES),
    barcode: pattern(body.barcode, 'barcode', BARCODE_RE),
    unit: oneOf(body.unit, 'unit', FOOD_UNITS),
    per100: null,
    servingSize: number(body.servingSize, 'servingSize', { max: L.servingMax, above: true, optional: true }),
    source: oneOf(body.source, 'source', FOOD_SOURCES),
    offCode: pattern(body.offCode, 'offCode', OFF_CODE_RE)
  }
  strictKeys(body.per100, ['kcal', 'protein', 'carbs', 'fat'], 'per100.')
  p.per100 = {
    kcal: number(body.per100.kcal, 'per100.kcal', { max: L.kcal100Max }),
    protein: number(body.per100.protein, 'per100.protein', { max: L.macro100Max }),
    carbs: number(body.per100.carbs, 'per100.carbs', { max: L.macro100Max }),
    fat: number(body.per100.fat, 'per100.fat', { max: L.macro100Max })
  }
  const force = flag(body.force, 'force')
  if (!force && !atwaterOk(p.per100)) throw httpError(400, 'atwater')
  return p
}

// a basic snapshot's per-100 (per unit for a 'ud' food) value: finite, >= 0, within the per-100 limits,
// kept to 2 decimals (the precision of the baked basics table, so the page's preview is what is stored)
function snapshotValue (v, field, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(field)
  const n = Math.round(v * 100 + 1e-9) / 100
  if (n < 0 || n > max) bad(field)
  return n
}
/** A recipe ingredient: a product {productId, amount}, or a basic of the public food DB as a SNAPSHOT
 * {basic, name, unit, amount, per100} (food-calc.js RECIPE_BASIC_UNITS). */
function validateIngredient (ing) {
  if (!isObj(ing) || !('basic' in ing)) {
    strictKeys(ing, ['productId', 'amount'], 'ingredients.')
    return { productId: id(ing.productId, 'ingredients.productId'), amount: number(ing.amount, 'ingredients.amount', { max: L.ingredientAmountMax, above: true }) }
  }
  strictKeys(ing, ['basic', 'name', 'unit', 'amount', 'per100'], 'ingredients.')
  const out = {
    basic: pattern(ing.basic, 'ingredients.basic', BASIC_KEY_RE, false),
    name: str(ing.name, 'ingredients.name', L.nameMax),
    unit: oneOf(ing.unit, 'ingredients.unit', RECIPE_BASIC_UNITS),
    amount: number(ing.amount, 'ingredients.amount', { max: L.ingredientAmountMax, above: true }),
    per100: null
  }
  strictKeys(ing.per100, ['kcal', 'protein', 'carbs', 'fat'], 'ingredients.per100.')
  out.per100 = {
    kcal: snapshotValue(ing.per100.kcal, 'ingredients.per100.kcal', L.kcal100Max),
    protein: snapshotValue(ing.per100.protein, 'ingredients.per100.protein', L.macro100Max),
    carbs: snapshotValue(ing.per100.carbs, 'ingredients.per100.carbs', L.macro100Max),
    fat: snapshotValue(ing.per100.fat, 'ingredients.per100.fat', L.macro100Max)
  }
  return out
}

export function validateRecipe (body) {
  strictKeys(body, ['name', 'kind', 'servings', 'cookedWeightG', 'ingredients', 'force'])
  const kind = oneOf(body.kind, 'kind', RECIPE_KINDS)
  const r = { name: str(body.name, 'name', L.nameMax), kind, servings: null, cookedWeightG: null, ingredients: [] }
  if (kind === 'serving') {
    if (!absent(body.cookedWeightG)) bad('cookedWeightG')
    r.servings = number(body.servings, 'servings', { min: 1, max: L.servingsMax, integer: true })
  } else {
    if (!absent(body.servings)) bad('servings')
    r.cookedWeightG = number(body.cookedWeightG, 'cookedWeightG', { max: L.cookedMax, above: true })
  }
  if (!Array.isArray(body.ingredients) || body.ingredients.length < 1 || body.ingredients.length > L.ingredientsMax) bad('ingredients')
  r.ingredients = body.ingredients.map(validateIngredient)
  // a basic's snapshot is checked like a product label (alcohol, polyols: "save anyway"); force is not stored
  const force = flag(body.force, 'force')
  if (!force && r.ingredients.some((i) => i.basic != null && !atwaterOk(i.per100))) throw httpError(400, 'atwater')
  return r
}

/** Shape only; the snapshot needs the store (see addLog). */
export function validateLog (body) {
  strictKeys(body, ['date', 'meal', 'refType', 'refId', 'amount', 'unit', 'label', 'kcal', 'protein', 'carbs', 'fat', 'force', 'requestId'])
  const e = {
    date: validDate(body.date) ?? bad('date'),
    meal: oneOf(body.meal, 'meal', FOOD_MEALS),
    refType: oneOf(body.refType, 'refType', REF_TYPES),
    requestId: pattern(body.requestId, 'requestId', REQUEST_ID_RE)
  }
  if (e.refType === 'quick') {
    for (const k of ['refId', 'amount', 'unit']) if (!absent(body[k])) bad(k)
    e.label = str(body.label, 'label', L.nameMax)
    e.macros = {
      kcal: number(body.kcal, 'kcal', { max: L.quickKcalMax }),
      protein: number(body.protein, 'protein', { max: L.quickMacroMax, optional: true }),
      carbs: number(body.carbs, 'carbs', { max: L.quickMacroMax, optional: true }),
      fat: number(body.fat, 'fat', { max: L.quickMacroMax, optional: true })
    }
    e.force = flag(body.force, 'force')
    return e
  }
  for (const k of ['label', 'kcal', 'protein', 'carbs', 'fat', 'force']) if (!absent(body[k])) bad(k)
  e.refId = id(body.refId, 'refId')
  e.amount = number(body.amount, 'amount', { max: L.amountMax, above: true })
  e.unit = oneOf(body.unit, 'unit', ENTRY_UNITS)
  return e
}

/** {goal?, targetWeightKg?}: at least one key; the goal is one of the plan goals, the target weight a
 * number of kg (1 decimal) within FOOD_LIMITS, or null to clear it. Only the keys sent are changed. */
export function validateSettings (body) {
  strictKeys(body, ['goal', 'targetWeightKg'])
  const out = {}
  if ('goal' in body) out.goal = oneOf(body.goal, 'goal', SETTINGS_GOALS)
  if ('targetWeightKg' in body) {
    out.targetWeightKg = body.targetWeightKg === null
      ? null
      : number(body.targetWeightKg, 'targetWeightKg', { min: L.targetWeightMin, max: L.targetWeightMax })
  }
  if (!Object.keys(out).length) bad('body')
  return out
}

/** ?from=&to= (YYYY-MM-DD, from <= to, at most FOOD_LIMITS.summaryDaysMax days inclusive). */
export function validateRange (params) {
  const from = validDate(params.get('from')) ?? bad('from')
  const to = validDate(params.get('to')) ?? bad('to')
  const days = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000) + 1
  if (days < 1 || days > L.summaryDaysMax) bad('to')
  return { from, to }
}

/* ---------- HTTP ---------- */
function send (res, status, body, extra = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra
  })
  res.end(payload)
}

function isJson (req) {
  const ct = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  return ct === 'application/json'
}

function readJson (req) {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > FOOD_BODY_LIMIT) return Promise.reject(httpError(413, 'payload_too_large'))
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let over = false
    req.on('data', (chunk) => {
      if (over) return
      size += chunk.length
      if (size > FOOD_BODY_LIMIT) {
        over = true
        reject(httpError(413, 'payload_too_large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (over) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(httpError(400, 'bad_json'))
      }
    })
    req.on('error', reject)
  })
}

/** The product ids of a recipe's ingredients (basics have none). */
function productIds (recipe) {
  return recipe.ingredients.filter((i) => i.basic == null).map((i) => i.productId)
}

function byIdOf (products) {
  const out = {}
  for (const p of products) out[p.id] = p
  return out
}

export function recipeView (recipe, byId) {
  const b = recipeBasis(recipe, byId)
  return {
    id: recipe.id,
    name: recipe.name,
    kind: recipe.kind,
    servings: recipe.servings,
    cookedWeightG: recipe.cookedWeightG,
    ingredients: recipe.ingredients.map((i) => i.basic != null
      ? { basic: i.basic, name: i.name, unit: i.unit, amount: i.amount, per100: i.per100 }
      : { productId: i.productId, amount: i.amount, name: byId[i.productId]?.name ?? null, unit: byId[i.productId]?.unit ?? null }),
    rawWeight: round1(b.rawWeight),
    complete: b.complete,
    missing: b.missing,
    totals: b.complete ? roundMacros(b.totals) : null,
    perServing: roundMacros(b.perServing),
    per100: roundMacros(b.per100),
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt
  }
}

export function createFoodRoutes ({ store, off, now = Date.now, log = console.log, writeLimit = FOOD_WRITE_LIMIT, summaryLimit = FOOD_SUMMARY_LIMIT, available = () => true, settingsAvailable = () => true, allowedHosts = [] }) {
  const writes = createWindowLimiter({ limit: writeLimit, windowMs: 60_000, now })
  const summaries = createWindowLimiter({ limit: summaryLimit, windowMs: 60_000, now })

  async function recipeViews (recipes) {
    const ids = [...new Set(recipes.flatMap(productIds))]
    const byId = byIdOf(await store.getProducts(ids))
    return recipes.map((r) => recipeView(r, byId))
  }

  /** Recipe product ingredients must be ACTIVE products (a basic carries its own snapshot). */
  async function checkIngredients (r) {
    const ids = [...new Set(productIds(r))]
    const found = await store.getProducts(ids)
    if (found.filter((p) => !p.archived).length !== ids.length) throw httpError(400, 'unknown_product')
  }

  /** The row this request id already stored, if any (a retry of the same add). */
  async function existing (requestId) {
    return requestId ? store.getLogByRequest(requestId) : null
  }

  /** {entry, created}: a retry with a known requestId returns the stored row, never a duplicate. */
  async function addLog (e) {
    const prior = await existing(e.requestId)
    if (prior) return { entry: prior, created: false }
    let macros, label, amount, unit
    if (e.refType === 'quick') {
      macros = roundMacros(e.macros)
      const { protein, carbs, fat } = macros
      if (!e.force && protein != null && carbs != null && fat != null && !atwaterOk(macros)) throw httpError(400, 'atwater')
      label = e.label
      amount = 1
      unit = 'serving'
    } else if (e.refType === 'product') {
      const p = await store.getProduct(e.refId)
      if (!p || p.archived) throw httpError(400, 'unknown_product')
      macros = productEntry(p, e.amount, e.unit)
      if (!macros) throw httpError(400, 'unit')
      label = p.name
      amount = e.amount
      unit = e.unit
    } else {
      const r = await store.getRecipe(e.refId)
      if (!r || r.archived) throw httpError(400, 'unknown_recipe')
      const byId = byIdOf(await store.getProducts(productIds(r)))
      if (!recipeBasis(r, byId).complete) throw httpError(400, 'recipe_incomplete')
      macros = recipeEntry(r, byId, e.amount, e.unit)
      if (!macros) throw httpError(400, 'unit')
      label = r.name
      amount = e.amount
      unit = e.unit
    }
    const entry = await store.insertLog({
      date: e.date, meal: e.meal, refType: e.refType, refId: e.refType === 'quick' ? null : e.refId, label, amount, unit, ...macros, requestId: e.requestId
    })
    if (entry) return { entry, created: true }
    // a concurrent retry stored it first (the unique request id): answer that row
    const winner = await existing(e.requestId)
    if (!winner) throw new Error('log insert returned no row')
    return { entry: winner, created: false }
  }

  async function dispatch (req, res, url, idParam) {
    const m = req.method
    const path = url.pathname
    if (path === '/food/settings') {
      if (m === 'GET') return send(res, 200, { settings: await store.getSettings() })
      return send(res, 200, { settings: await store.updateSettings(validateSettings(await readJson(req))) })
    }
    if (path === '/food/log/summary') {
      if (!summaries.take(req.socket?.remoteAddress ?? 'unknown')) throw httpError(429, 'rate_limited')
      const { from, to } = validateRange(url.searchParams)
      return send(res, 200, { from, to, days: daySummaries(await store.listLogRange(from, to)) })
    }
    if (path === '/food/products') {
      if (m === 'GET') return send(res, 200, { products: await store.listProducts() })
      return send(res, 201, { product: await store.insertProduct(validateProduct(await readJson(req))) })
    }
    if (path.startsWith('/food/products/')) {
      if (idParam == null) throw httpError(404, 'not_found')
      if (m === 'DELETE') {
        if (!(await store.archiveProduct(idParam))) throw httpError(404, 'not_found')
        return send(res, 200, { ok: true })
      }
      const p = await store.updateProduct(idParam, validateProduct(await readJson(req)))
      if (!p) throw httpError(404, 'not_found')
      return send(res, 200, { product: p })
    }
    if (path === '/food/recipes') {
      if (m === 'GET') return send(res, 200, { recipes: await recipeViews(await store.listRecipes()) })
      const r = validateRecipe(await readJson(req))
      await checkIngredients(r)
      const [view] = await recipeViews([await store.insertRecipe(r)])
      return send(res, 201, { recipe: view })
    }
    if (path.startsWith('/food/recipes/')) {
      if (idParam == null) throw httpError(404, 'not_found')
      if (m === 'DELETE') {
        if (!(await store.archiveRecipe(idParam))) throw httpError(404, 'not_found')
        return send(res, 200, { ok: true })
      }
      const r = validateRecipe(await readJson(req))
      await checkIngredients(r)
      const saved = await store.updateRecipe(idParam, r)
      if (!saved) throw httpError(404, 'not_found')
      const [view] = await recipeViews([saved])
      return send(res, 200, { recipe: view })
    }
    if (path === '/food/log') {
      if (m === 'GET') {
        const date = validDate(url.searchParams.get('date')) ?? bad('date')
        const entries = await store.listLog(date)
        return send(res, 200, { date, entries, totals: dayTotals(entries) })
      }
      const e = validateLog(await readJson(req))
      const { entry, created } = await addLog(e)
      return send(res, created ? 201 : 200, { entry, totals: dayTotals(await store.listLog(e.date)) })
    }
    if (path.startsWith('/food/log/')) {
      if (idParam == null || !(await store.deleteLog(idParam))) throw httpError(404, 'not_found')
      return send(res, 200, { ok: true })
    }
    // /food/off
    const barcode = url.searchParams.get('barcode')
    if (barcode != null) {
      if (!BARCODE_RE.test(barcode)) bad('barcode')
      return send(res, 200, { product: await off.byBarcode(barcode) })
    }
    const q = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim()
    if (q.length < L.queryMin || q.length > L.queryMax) bad('q')
    return send(res, 200, { results: await off.search(q) })
  }

  return {
    /** Handles /food and /food/*; false for any other path (the caller keeps routing). */
    async handle (req, res, url) {
      const path = url.pathname
      if (path !== '/food' && !path.startsWith('/food/')) return false
      try {
        if (!hostAllowed(hostOfHeader(req.headers.host), allowedHosts)) throw httpError(421, 'misdirected')
        if (req.headers['x-hc-food'] !== '1') throw httpError(403, 'forbidden')
        let route = null
        let match = null
        for (const r of ROUTES) {
          match = r.re.exec(path)
          if (match) { route = r; break }
        }
        // an unknown path is a 404 whatever is available; a known one needs its migration group
        if (!route) throw httpError(404, 'not_found')
        const group = route.group ?? 'food'
        if (!(group === 'settings' ? settingsAvailable() : available())) throw httpError(503, `${group}_unavailable`)
        if (!route.methods.includes(req.method)) {
          req.resume()
          send(res, 405, { error: 'method_not_allowed' }, { allow: route.methods.join(', ') })
          return true
        }
        if (WRITE_METHODS.has(req.method)) {
          const origin = req.headers.origin
          if (origin !== undefined && !hostAllowed(hostOfOrigin(origin), allowedHosts)) throw httpError(403, 'forbidden_origin')
          if (!writes.take(req.socket?.remoteAddress ?? 'unknown')) throw httpError(429, 'rate_limited')
          if (req.method !== 'DELETE' && !isJson(req)) throw httpError(415, 'unsupported_media_type')
        }
        if (req.method === 'GET' || req.method === 'DELETE') req.resume()
        await dispatch(req, res, url, match[1] != null ? pathId(match[1]) : null)
      } catch (err) {
        if (res.headersSent) return true
        if (err && err.status && err.code) {
          const body = { error: err.code }
          if (err.field) body.field = err.field
          if (err.status === 413) {
            // stop reading an oversized upload: answer, then drop the connection
            res.on('finish', () => req.destroy())
            send(res, 413, body, { connection: 'close' })
          } else {
            req.resume()
            send(res, err.status, body)
          }
        } else {
          log(JSON.stringify({ event: 'food_error', message: err?.message ?? String(err) }))
          send(res, 500, { error: 'internal' })
        }
      }
      return true
    }
  }
}
