/**
 * Food log routes (docs/nutrition-food-log.md), mounted by server.js under /food/ and reached from the LAN
 * plan page through loop-web's /api/food/ proxy:
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
 *   GET    /food/settings            the user's goal + target weight (one row, sql/007_settings.sql)
 *   GET    /food/profile             the in-page onboarding document (profile + accepted targets), null before the first save
 *   PUT    /food/profile             replaces it (validateProfile; one row, sql/011_profile.sql, its own optional `profile` group)
 *   PUT    /food/settings            partial update {goal?, targetWeightKg?} (targetWeightKg null clears it)
 *
 * The settings live in their OWN optional migration group (`settings`): when 007 fails only
 * /food/settings answers 503 settings_unavailable, and when the food tables fail it keeps working.
 *
 * Security. A static page cannot hold a secret, so these routes are UNAUTHENTICATED like /sync and
 * meant for the LAN only (a public reverse proxy must NEVER forward /food/*, see README). Layers:
 *   - Host check (DNS rebinding): the Host must be an IP literal, localhost, loop-ingest (the loop-web proxy
 *     hop over loop-net; host.docker.internal, its former name, still passes) or a name in FOOD_ALLOWED_HOSTS,
 *     else 421. A rebinding page (its own name
 *     resolved to a LAN address) is refused here and, first, by loop-web's nginx Host map;
 *   - on writes (http.js writeOriginOk, 403 forbidden_origin): Sec-Fetch-Site, when sent, must be same-origin, and
 *     an Origin must name an allowed host and, behind loop-web, be exactly the host[:port] nginx was asked for
 *     (X-Forwarded-Host), so another LAN address or port cannot write;
 *   - every request must carry the custom header `X-HC-Food: 1` (403) and every write
 *     `Content-Type: application/json` (415): from another site both force a CORS preflight, which this
 *     server never approves (it sends no CORS headers at all), so a plain cross-site request is not sent.
 * Together they stop a website opened on a LAN device from reading or writing the log; none of them
 * stops a device on the LAN that talks to the service directly (that is the LAN-only trust model).
 * Bodies are capped at 16 KB (413), writes share one rate limit per client address (429; behind
 * loop-web every request comes from nginx, so it is one shared budget), the whole feature answers 503
 * food_unavailable when its tables failed to migrate, and every error is a COARSE code
 * ({error, field?}), never raw DB text.
 *
 * Validation is strict and by hand: unknown keys are refused, strings trimmed and length-capped,
 * numbers finite, rounded to 1 decimal and THEN checked against the shared FOOD_LIMITS (so 0.04 g is
 * 0 and refused where > 0 is required), dates must round trip, and a label whose kcal disagree with 4 p + 4 c + 9 f by more than 25 % is refused with
 * `atwater` unless the request says `force: true` (fibre / polyols make real labels deviate).
 *
 * The generic HTTP pieces (send, readJson, httpError, validDate, the Host / Origin checks) live in http.js,
 * shared with journal.js and the other route modules.
 */
import {
  FOOD_STORES, FOOD_UNITS, ENTRY_UNITS, FOOD_SOURCES, RECIPE_KINDS, REF_TYPES, FOOD_MEALS, FOOD_LIMITS as L, RECIPE_BASIC_UNITS,
  SETTINGS_GOALS, round1, roundMacros, productEntry, recipeBasis, recipeEntry, dayTotals, daySummaries, atwaterOk
} from './food-calc.js'
import { createWindowLimiter } from './limits.js'
import {
  JSON_BODY_LIMIT, httpError, send, isJson, readJson, validDate, hostAllowed, hostOfHeader, writeOriginOk, hasControlChars
} from './http.js'

export const FOOD_BODY_LIMIT = JSON_BODY_LIMIT // readJson's cap (http.js), named for the food tests
export const FOOD_WRITE_LIMIT = 60 // per client address per minute
export const FOOD_SUMMARY_LIMIT = 30 // GET /food/log/summary per client address per minute (a read of up to 120 days)
// limits: FOOD_LIMITS (food-calc.js, generated from lib/nutrition/foodlog.mjs, which is authoritative)
const ID_RE = /^[1-9][0-9]{0,15}$/
const BARCODE_RE = new RegExp(L.barcodePattern)
const BASIC_KEY_RE = new RegExp(L.basicKeyPattern)
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/ // the page's per-add id (a UUID), makes a retry idempotent
const OFF_CODE_RE = /^[0-9]{1,14}$/
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE'])

// path pattern -> allowed methods (+ the optional migration group it needs, default food)
const ROUTES = [
  { re: /^\/food\/settings$/, methods: ['GET', 'PUT'], group: 'settings' },
  { re: /^\/food\/profile$/, methods: ['GET', 'PUT'], group: 'profile' },
  { re: /^\/food\/log\/summary$/, methods: ['GET'] },
  { re: /^\/food\/products$/, methods: ['GET', 'POST'] },
  { re: /^\/food\/products\/([^/]+)$/, methods: ['PUT', 'DELETE'] },
  { re: /^\/food\/recipes$/, methods: ['GET', 'POST'] },
  { re: /^\/food\/recipes\/([^/]+)$/, methods: ['PUT', 'DELETE'] },
  { re: /^\/food\/log$/, methods: ['GET', 'POST'] },
  { re: /^\/food\/log\/([^/]+)$/, methods: ['DELETE'] },
  { re: /^\/food\/off$/, methods: ['GET'] }
]

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
  if (typeof v !== 'string' || hasControlChars(v)) bad(field)
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

// The onboarding document (PUT /food/profile). Coarse bounds only: the host sync and the build re-check the
// targets against lib/nutrition/energy.mjs (the service is built from its own directory and cannot import lib/).
const PROFILE_SEX = ['male', 'female']
export const PROFILE_ACTIVITY = ['sedentary', 'light', 'active']
const PROFILE_DAY_TYPES = ['rest', 'gym', 'bike', 'bikeLong']
// lib/nutrition/energy.mjs SPORTS (a test pins the copy)
export const PROFILE_SPORTS = ['strength', 'running', 'cycling', 'swimming', 'hybrid', 'team', 'yoga', 'other']

/** The optional sports list: [{sport, minutes (15-600), perWeek (1-14)}], one entry per sport; any fault = 'sports'. */
function profileSports (v) {
  const ok = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi
  if (!Array.isArray(v) || v.length > PROFILE_SPORTS.length) bad('sports')
  const seen = new Set()
  return v.map((s) => {
    if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).some((k) => !['sport', 'minutes', 'perWeek'].includes(k))) bad('sports')
    if (!PROFILE_SPORTS.includes(s.sport) || seen.has(s.sport) || !ok(s.minutes, 15, 600) || !ok(s.perWeek, 1, 14)) bad('sports')
    seen.add(s.sport)
    return { sport: s.sport, minutes: s.minutes, perWeek: s.perWeek }
  })
}

/** A real YYYY-MM-DD calendar date from 1900 on (validDate is for log dates, 2000-2100), else null. */
function birthDate (v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const [y, m, d] = v.split('-').map(Number)
  return y >= 1900 && new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === v ? v : null
}

/** Whole years from an ISO birthdate to the instant `nowMs` (UTC calendar). */
function ageAt (birthdate, nowMs) {
  const [by, bm, bd] = birthdate.split('-').map(Number)
  const t = new Date(nowMs)
  const ty = t.getUTCFullYear(); const tm = t.getUTCMonth() + 1; const td = t.getUTCDate()
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0)
}

/** The whole onboarding document: {name?, sex, birthdate (adult), heightCm, weightKg, activity, sports?, goals (the
 * goals the safety screen allowed), targets {goal: {dayType: {kcal, p, f}}} (all twelve cells)}. */
export function validateProfile (body, nowMs = Date.now()) {
  strictKeys(body, ['name', 'sex', 'birthdate', 'heightCm', 'weightKg', 'activity', 'sports', 'goals', 'targets'])
  const out = {}
  const name = str(body.name, 'name', 60, true)
  if (name !== null) out.name = name
  out.sex = oneOf(body.sex, 'sex', PROFILE_SEX)
  out.birthdate = birthDate(body.birthdate) ?? bad('birthdate')
  const age = ageAt(out.birthdate, nowMs)
  if (age < 18 || age > 100) bad('birthdate')
  out.heightCm = number(body.heightCm, 'heightCm', { min: 120, max: 230 })
  out.weightKg = number(body.weightKg, 'weightKg', { min: 30, max: 250 })
  out.activity = oneOf(body.activity, 'activity', PROFILE_ACTIVITY)
  if (body.sports !== undefined) out.sports = profileSports(body.sports)
  if (!Array.isArray(body.goals) || !body.goals.length || new Set(body.goals).size !== body.goals.length) bad('goals')
  for (const g of body.goals) oneOf(g, 'goals', SETTINGS_GOALS)
  out.goals = [...body.goals]
  strictKeys(body.targets, SETTINGS_GOALS, 'targets.')
  out.targets = {}
  for (const g of SETTINGS_GOALS) {
    strictKeys(body.targets[g], PROFILE_DAY_TYPES, `targets.${g}.`)
    out.targets[g] = {}
    for (const d of PROFILE_DAY_TYPES) {
      const at = `targets.${g}.${d}`
      const c = body.targets[g][d]
      strictKeys(c, ['kcal', 'p', 'f'], `${at}.`)
      out.targets[g][d] = {
        kcal: number(c.kcal, `${at}.kcal`, { min: 800, max: 6000, integer: true }),
        p: number(c.p, `${at}.p`, { min: 20, max: 400, integer: true }),
        f: number(c.f, `${at}.f`, { min: 10, max: 300, integer: true })
      }
    }
  }
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

/** The ROUTES entry a path matches, with its regex match; null for an unknown path. */
function routeOf (path) {
  for (const route of ROUTES) {
    const match = route.re.exec(path)
    if (match) return { route, match }
  }
  return null
}

/** The macros SNAPSHOT a new log entry stores, with its label, amount and unit: a quick entry as typed (its
 * macros must pass Atwater unless forced), a product or a complete recipe computed here (food-calc.js). */
async function logSnapshot (store, e) {
  if (e.refType === 'quick') {
    const macros = roundMacros(e.macros)
    const { protein, carbs, fat } = macros
    if (!e.force && protein != null && carbs != null && fat != null && !atwaterOk(macros)) throw httpError(400, 'atwater')
    return { macros, label: e.label, amount: 1, unit: 'serving' }
  }
  if (e.refType === 'product') {
    const p = await store.getProduct(e.refId)
    if (!p || p.archived) throw httpError(400, 'unknown_product')
    const macros = productEntry(p, e.amount, e.unit)
    if (!macros) throw httpError(400, 'unit')
    return { macros, label: p.name, amount: e.amount, unit: e.unit }
  }
  const r = await store.getRecipe(e.refId)
  if (!r || r.archived) throw httpError(400, 'unknown_recipe')
  const byId = byIdOf(await store.getProducts(productIds(r)))
  if (!recipeBasis(r, byId).complete) throw httpError(400, 'recipe_incomplete')
  const macros = recipeEntry(r, byId, e.amount, e.unit)
  if (!macros) throw httpError(400, 'unit')
  return { macros, label: r.name, amount: e.amount, unit: e.unit }
}

/** A failed request's answer: a known httpError as {error, field?} (an oversized upload is answered, then its
 * connection dropped), anything else logged and answered 500. */
function sendError (err, req, res, log) {
  if (res.headersSent) return
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

async function recipeViews (store, recipes) {
  const ids = [...new Set(recipes.flatMap(productIds))]
  const byId = byIdOf(await store.getProducts(ids))
  return recipes.map((r) => recipeView(r, byId))
}

/** Recipe product ingredients must be ACTIVE products (a basic carries its own snapshot). */
async function checkIngredients (store, r) {
  const ids = [...new Set(productIds(r))]
  const found = await store.getProducts(ids)
  if (found.filter((p) => !p.archived).length !== ids.length) throw httpError(400, 'unknown_product')
}

/** The row this request id already stored, if any (a retry of the same add). */
async function existing (store, requestId) {
  return requestId ? store.getLogByRequest(requestId) : null
}

/** {entry, created}: a retry with a known requestId returns the stored row, never a duplicate. */
async function addLog (store, e) {
  const prior = await existing(store, e.requestId)
  if (prior) return { entry: prior, created: false }
  const { macros, label, amount, unit } = await logSnapshot(store, e)
  const entry = await store.insertLog({
    date: e.date, meal: e.meal, refType: e.refType, refId: e.refType === 'quick' ? null : e.refId, label, amount, unit, ...macros, requestId: e.requestId
  })
  if (entry) return { entry, created: true }
  // a concurrent retry stored it first (the unique request id): answer that row
  const winner = await existing(store, e.requestId)
  if (!winner) throw new Error('log insert returned no row')
  return { entry: winner, created: false }
}

// /food/products and /food/products/:id (DELETE = archive)
async function products (store, req, res, path, idParam) {
  if (path === '/food/products') {
    if (req.method === 'GET') return send(res, 200, { products: await store.listProducts() })
    return send(res, 201, { product: await store.insertProduct(validateProduct(await readJson(req))) })
  }
  if (idParam == null) throw httpError(404, 'not_found')
  if (req.method === 'DELETE') {
    if (!(await store.archiveProduct(idParam))) throw httpError(404, 'not_found')
    return send(res, 200, { ok: true })
  }
  const p = await store.updateProduct(idParam, validateProduct(await readJson(req)))
  if (!p) throw httpError(404, 'not_found')
  return send(res, 200, { product: p })
}

// /food/recipes and /food/recipes/:id (DELETE = archive), answered with their computed macros
async function recipes (store, req, res, path, idParam) {
  if (path === '/food/recipes') {
    if (req.method === 'GET') return send(res, 200, { recipes: await recipeViews(store, await store.listRecipes()) })
    const r = validateRecipe(await readJson(req))
    await checkIngredients(store, r)
    const [view] = await recipeViews(store, [await store.insertRecipe(r)])
    return send(res, 201, { recipe: view })
  }
  if (idParam == null) throw httpError(404, 'not_found')
  if (req.method === 'DELETE') {
    if (!(await store.archiveRecipe(idParam))) throw httpError(404, 'not_found')
    return send(res, 200, { ok: true })
  }
  const r = validateRecipe(await readJson(req))
  await checkIngredients(store, r)
  const saved = await store.updateRecipe(idParam, r)
  if (!saved) throw httpError(404, 'not_found')
  const [view] = await recipeViews(store, [saved])
  return send(res, 200, { recipe: view })
}

// /food/log?date= (a day + its totals), POST /food/log (add) and DELETE /food/log/:id
async function logEntries (store, req, res, url, idParam) {
  if (url.pathname === '/food/log') {
    if (req.method === 'GET') {
      const date = validDate(url.searchParams.get('date')) ?? bad('date')
      const entries = await store.listLog(date)
      return send(res, 200, { date, entries, totals: dayTotals(entries) })
    }
    const e = validateLog(await readJson(req))
    const { entry, created } = await addLog(store, e)
    return send(res, created ? 201 : 200, { entry, totals: dayTotals(await store.listLog(e.date)) })
  }
  if (idParam == null || !(await store.deleteLog(idParam))) throw httpError(404, 'not_found')
  return send(res, 200, { ok: true })
}

// /food/off?barcode= | ?q=: the Open Food Facts lookup (src/off.js)
async function offLookup (off, res, url) {
  const barcode = url.searchParams.get('barcode')
  if (barcode != null) {
    if (!BARCODE_RE.test(barcode)) bad('barcode')
    return send(res, 200, { product: await off.byBarcode(barcode) })
  }
  const q = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim()
  if (q.length < L.queryMin || q.length > L.queryMax) bad('q')
  return send(res, 200, { results: await off.search(q) })
}

export function createFoodRoutes ({ store, off, now = Date.now, log = console.log, writeLimit = FOOD_WRITE_LIMIT, summaryLimit = FOOD_SUMMARY_LIMIT, available = () => true, settingsAvailable = () => true, profileAvailable = () => true, allowedHosts = [] }) {
  const writes = createWindowLimiter({ limit: writeLimit, windowMs: 60_000, now })
  const summaries = createWindowLimiter({ limit: summaryLimit, windowMs: 60_000, now })

  async function dispatch (req, res, url, idParam) {
    const m = req.method
    const path = url.pathname
    if (path === '/food/settings') {
      if (m === 'GET') return send(res, 200, { settings: await store.getSettings() })
      return send(res, 200, { settings: await store.updateSettings(validateSettings(await readJson(req))) })
    }
    if (path === '/food/profile') {
      if (m === 'GET') return send(res, 200, { profile: await store.getProfile() })
      return send(res, 200, { profile: await store.putProfile(validateProfile(await readJson(req), now())) })
    }
    if (path === '/food/log/summary') {
      if (!summaries.take(req.socket?.remoteAddress ?? 'unknown')) throw httpError(429, 'rate_limited')
      const { from, to } = validateRange(url.searchParams)
      return send(res, 200, { from, to, days: daySummaries(await store.listLogRange(from, to)) })
    }
    if (path === '/food/products' || path.startsWith('/food/products/')) return products(store, req, res, path, idParam)
    if (path === '/food/recipes' || path.startsWith('/food/recipes/')) return recipes(store, req, res, path, idParam)
    if (path === '/food/log' || path.startsWith('/food/log/')) return logEntries(store, req, res, url, idParam)
    return offLookup(off, res, url)
  }

  /** The checks before a known route runs: its migration group is ready, the method is allowed (else a 405 is
   * sent and false returned) and a write passes the origin, rate and content-type checks. */
  function admit (req, res, route) {
    const group = route.group ?? 'food'
    const ready = group === 'settings' ? settingsAvailable() : group === 'profile' ? profileAvailable() : available()
    if (!ready) throw httpError(503, `${group}_unavailable`)
    if (!route.methods.includes(req.method)) {
      req.resume()
      send(res, 405, { error: 'method_not_allowed' }, { allow: route.methods.join(', ') })
      return false
    }
    if (WRITE_METHODS.has(req.method)) {
      if (!writeOriginOk(req.headers, allowedHosts)) throw httpError(403, 'forbidden_origin')
      if (!writes.take(req.socket?.remoteAddress ?? 'unknown')) throw httpError(429, 'rate_limited')
      if (req.method !== 'DELETE' && !isJson(req)) throw httpError(415, 'unsupported_media_type')
    }
    return true
  }

  return {
    /** Handles /food and /food/*; false for any other path (the caller keeps routing). */
    async handle (req, res, url) {
      const path = url.pathname
      if (path !== '/food' && !path.startsWith('/food/')) return false
      try {
        if (!hostAllowed(hostOfHeader(req.headers.host), allowedHosts)) throw httpError(421, 'misdirected')
        if (req.headers['x-hc-food'] !== '1') throw httpError(403, 'forbidden')
        // an unknown path is a 404 whatever is available; a known one needs its migration group
        const hit = routeOf(path)
        if (!hit) throw httpError(404, 'not_found')
        if (!admit(req, res, hit.route)) return true
        if (req.method === 'GET' || req.method === 'DELETE') req.resume()
        await dispatch(req, res, url, hit.match[1] != null ? pathId(hit.match[1]) : null)
      } catch (err) {
        sendError(err, req, res, log)
      }
      return true
    }
  }
}
