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
 *
 * Security. A static page cannot hold a secret, so these routes are UNAUTHENTICATED like /sync and
 * meant for the LAN only (a public reverse proxy must NEVER forward /food/*, see README). What keeps
 * a malicious website opened on a LAN device from writing here: every request must carry the custom
 * header `X-HC-Food: 1` (403 otherwise) and every write `Content-Type: application/json` (415): both
 * force a CORS preflight, which this server never approves (it sends no CORS headers at all), so a
 * cross-site request is never sent. Bodies are capped at 16 KB (413), writes are rate limited per
 * client address (429), and every error is a COARSE code ({error, field?}), never raw DB text.
 *
 * Validation is strict and by hand: unknown keys are refused, strings trimmed and length-capped,
 * numbers finite and in sane ranges (per 100: kcal <= 900, each macro <= 100 g), dates must round
 * trip, and a label whose kcal disagree with 4 p + 4 c + 9 f by more than 25 % is refused with
 * `atwater` unless the request says `force: true` (fibre / polyols make real labels deviate).
 */
import {
  FOOD_STORES, FOOD_UNITS, ENTRY_UNITS, FOOD_SOURCES, RECIPE_KINDS, REF_TYPES, FOOD_MEALS,
  round1, roundMacros, productEntry, recipeBasis, recipeEntry, dayTotals, atwaterOk
} from './food-calc.js'
import { createWindowLimiter } from './limits.js'

export const FOOD_BODY_LIMIT = 16 * 1024
export const FOOD_WRITE_LIMIT = 60 // per client address per minute
const MAX_AMOUNT = 5000 // g, ml or servings in one entry
const MAX_INGREDIENTS = 40
const ID_RE = /^[1-9][0-9]{0,15}$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const BARCODE_RE = /^[0-9]{8,14}$/
const OFF_CODE_RE = /^[0-9]{1,14}$/
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE'])

// path pattern -> allowed methods
const ROUTES = [
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
function number (v, field, { min = 0, max, above = false, optional = false, integer = false }) {
  if (optional && absent(v)) return null
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(field)
  if (above ? v <= min : v < min) bad(field)
  if (v > max) bad(field)
  if (integer && !Number.isInteger(v)) bad(field)
  return integer ? v : round1(v)
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

export function validateProduct (body) {
  strictKeys(body, ['name', 'brand', 'store', 'barcode', 'unit', 'per100', 'servingSize', 'source', 'offCode', 'force'])
  const p = {
    name: str(body.name, 'name', 120),
    brand: str(body.brand, 'brand', 80, true),
    store: oneOf(body.store, 'store', FOOD_STORES),
    barcode: pattern(body.barcode, 'barcode', BARCODE_RE),
    unit: oneOf(body.unit, 'unit', FOOD_UNITS),
    per100: null,
    servingSize: number(body.servingSize, 'servingSize', { max: 5000, above: true, optional: true }),
    source: oneOf(body.source, 'source', FOOD_SOURCES),
    offCode: pattern(body.offCode, 'offCode', OFF_CODE_RE)
  }
  strictKeys(body.per100, ['kcal', 'protein', 'carbs', 'fat'], 'per100.')
  p.per100 = {
    kcal: number(body.per100.kcal, 'per100.kcal', { max: 900 }),
    protein: number(body.per100.protein, 'per100.protein', { max: 100 }),
    carbs: number(body.per100.carbs, 'per100.carbs', { max: 100 }),
    fat: number(body.per100.fat, 'per100.fat', { max: 100 })
  }
  const force = flag(body.force, 'force')
  if (!force && !atwaterOk(p.per100)) throw httpError(400, 'atwater')
  return p
}

export function validateRecipe (body) {
  strictKeys(body, ['name', 'kind', 'servings', 'cookedWeightG', 'ingredients'])
  const kind = oneOf(body.kind, 'kind', RECIPE_KINDS)
  const r = { name: str(body.name, 'name', 120), kind, servings: null, cookedWeightG: null, ingredients: [] }
  if (kind === 'serving') {
    if (!absent(body.cookedWeightG)) bad('cookedWeightG')
    r.servings = number(body.servings, 'servings', { min: 1, max: 100, integer: true })
  } else {
    if (!absent(body.servings)) bad('servings')
    r.cookedWeightG = number(body.cookedWeightG, 'cookedWeightG', { max: 20000, above: true })
  }
  if (!Array.isArray(body.ingredients) || body.ingredients.length < 1 || body.ingredients.length > MAX_INGREDIENTS) bad('ingredients')
  r.ingredients = body.ingredients.map((ing) => {
    strictKeys(ing, ['productId', 'amount'], 'ingredients.')
    return { productId: id(ing.productId, 'ingredients.productId'), amount: number(ing.amount, 'ingredients.amount', { max: 10000, above: true }) }
  })
  return r
}

/** Shape only; the snapshot needs the store (see addLog). */
export function validateLog (body) {
  strictKeys(body, ['date', 'meal', 'refType', 'refId', 'amount', 'unit', 'label', 'kcal', 'protein', 'carbs', 'fat', 'force'])
  const e = {
    date: validDate(body.date) ?? bad('date'),
    meal: oneOf(body.meal, 'meal', FOOD_MEALS),
    refType: oneOf(body.refType, 'refType', REF_TYPES)
  }
  if (e.refType === 'quick') {
    for (const k of ['refId', 'amount', 'unit']) if (!absent(body[k])) bad(k)
    e.label = str(body.label, 'label', 120)
    e.macros = {
      kcal: number(body.kcal, 'kcal', { max: 5000 }),
      protein: number(body.protein, 'protein', { max: 500, optional: true }),
      carbs: number(body.carbs, 'carbs', { max: 500, optional: true }),
      fat: number(body.fat, 'fat', { max: 500, optional: true })
    }
    e.force = flag(body.force, 'force')
    return e
  }
  for (const k of ['label', 'kcal', 'protein', 'carbs', 'fat', 'force']) if (!absent(body[k])) bad(k)
  e.refId = id(body.refId, 'refId')
  e.amount = number(body.amount, 'amount', { max: MAX_AMOUNT, above: true })
  e.unit = oneOf(body.unit, 'unit', ENTRY_UNITS)
  return e
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
    ingredients: recipe.ingredients.map((i) => ({
      productId: i.productId, amount: i.amount, name: byId[i.productId]?.name ?? null, unit: byId[i.productId]?.unit ?? null
    })),
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

export function createFoodRoutes ({ store, off, now = Date.now, log = console.log, writeLimit = FOOD_WRITE_LIMIT }) {
  const writes = createWindowLimiter({ limit: writeLimit, windowMs: 60_000, now })

  async function recipeViews (recipes) {
    const ids = [...new Set(recipes.flatMap((r) => r.ingredients.map((i) => i.productId)))]
    const byId = byIdOf(await store.getProducts(ids))
    return recipes.map((r) => recipeView(r, byId))
  }

  /** Recipe ingredients must be ACTIVE products. */
  async function checkIngredients (r) {
    const ids = [...new Set(r.ingredients.map((i) => i.productId))]
    const found = await store.getProducts(ids)
    if (found.filter((p) => !p.archived).length !== ids.length) throw httpError(400, 'unknown_product')
  }

  async function addLog (e) {
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
      const byId = byIdOf(await store.getProducts(r.ingredients.map((i) => i.productId)))
      if (!recipeBasis(r, byId).complete) throw httpError(400, 'recipe_incomplete')
      macros = recipeEntry(r, byId, e.amount, e.unit)
      if (!macros) throw httpError(400, 'unit')
      label = r.name
      amount = e.amount
      unit = e.unit
    }
    return store.insertLog({
      date: e.date, meal: e.meal, refType: e.refType, refId: e.refType === 'quick' ? null : e.refId, label, amount, unit, ...macros
    })
  }

  async function dispatch (req, res, url, idParam) {
    const m = req.method
    const path = url.pathname
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
      const entry = await addLog(e)
      return send(res, 201, { entry, totals: dayTotals(await store.listLog(e.date)) })
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
    if (q.length < 2 || q.length > 80) bad('q')
    return send(res, 200, { results: await off.search(q) })
  }

  return {
    /** Handles /food and /food/*; false for any other path (the caller keeps routing). */
    async handle (req, res, url) {
      const path = url.pathname
      if (path !== '/food' && !path.startsWith('/food/')) return false
      try {
        if (req.headers['x-hc-food'] !== '1') throw httpError(403, 'forbidden')
        let route = null
        let match = null
        for (const r of ROUTES) {
          match = r.re.exec(path)
          if (match) { route = r; break }
        }
        if (!route) throw httpError(404, 'not_found')
        if (!route.methods.includes(req.method)) {
          req.resume()
          send(res, 405, { error: 'method_not_allowed' }, { allow: route.methods.join(', ') })
          return true
        }
        if (WRITE_METHODS.has(req.method)) {
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
