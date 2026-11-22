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
 *   GET    /food/settings            the user's goal + target weight + page language (one row, sql/007_settings.sql + 013)
 *   GET    /food/profile             the in-page onboarding document (profile + accepted targets), null before the first save
 *   PUT    /food/profile             saves it (validateProfile; its own fields replace the app_profile row, sql/011; name / sex /
 *                                     birthdate / height merge into the profile document, sql/012: profile-db.js; needs both groups)
 *   PUT    /food/settings            partial update {goal?, targetWeightKg?, locale?} (targetWeightKg / locale null clears it)
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
 * This module is the HTTP layer only: the route table, the admission checks above, reading the body and
 * answering. Validation lives in food-validate.js and settings-profile.js (strict and by hand: unknown keys
 * refused, numbers rounded then bound-checked, dates round trip, the Atwater check on labels); the use cases (the
 * log entry's macros SNAPSHOT, recipe views, idempotent adds) in food-usecases.js over the store (food-db.js).
 *
 * The generic HTTP pieces (send, readJson, httpError, validDate, the Host / Origin checks) live in http.js,
 * shared with journal.js and the other route modules.
 */
import { FOOD_LIMITS as L } from './food-calc.js'
import { createWindowLimiter } from './limits.js'
import {
  JSON_BODY_LIMIT, httpError, send, isJson, readJson, validDate, hostAllowed, hostOfHeader, writeOriginOk
} from './http.js'
import { bad } from './validate.js'
import { BARCODE_RE, validateProduct, validateRecipe, validateLog, validateRange } from './food-validate.js'
import { validateSettings, validateProfile } from './settings-profile.js'
import { createFoodService } from './food-usecases.js'

// the validators and the recipe view keep their historical import path
export { validateProduct, validateRecipe, validateLog, validateRange } from './food-validate.js'
export { SETTINGS_LOCALES, validateSettings, validateProfile } from './settings-profile.js'
export { recipeView } from './food-usecases.js'

export const FOOD_BODY_LIMIT = JSON_BODY_LIMIT // readJson's cap (http.js), named for the food tests
export const FOOD_WRITE_LIMIT = 60 // per client address per minute
export const FOOD_SUMMARY_LIMIT = 30 // GET /food/log/summary per client address per minute (a read of up to 120 days)
const ID_RE = /^[1-9][0-9]{0,15}$/
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

function pathId (s) {
  return ID_RE.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : null
}

/** The ROUTES entry a path matches, with its regex match; null for an unknown path. */
function routeOf (path) {
  for (const route of ROUTES) {
    const match = route.re.exec(path)
    if (match) return { route, match }
  }
  return null
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

// /food/products and /food/products/:id (DELETE = archive)
async function products (food, req, res, path, idParam) {
  if (path === '/food/products') {
    if (req.method === 'GET') return send(res, 200, { products: await food.listProducts() })
    return send(res, 201, { product: await food.createProduct(validateProduct(await readJson(req))) })
  }
  if (idParam == null) throw httpError(404, 'not_found')
  if (req.method === 'DELETE') {
    await food.archiveProduct(idParam)
    return send(res, 200, { ok: true })
  }
  return send(res, 200, { product: await food.updateProduct(idParam, validateProduct(await readJson(req))) })
}

// /food/recipes and /food/recipes/:id (DELETE = archive), answered with their computed macros
async function recipes (food, req, res, path, idParam) {
  if (path === '/food/recipes') {
    if (req.method === 'GET') return send(res, 200, { recipes: await food.listRecipes() })
    return send(res, 201, { recipe: await food.createRecipe(validateRecipe(await readJson(req))) })
  }
  if (idParam == null) throw httpError(404, 'not_found')
  if (req.method === 'DELETE') {
    await food.archiveRecipe(idParam)
    return send(res, 200, { ok: true })
  }
  return send(res, 200, { recipe: await food.updateRecipe(idParam, validateRecipe(await readJson(req))) })
}

// /food/log?date= (a day + its totals), POST /food/log (add) and DELETE /food/log/:id
async function logEntries (food, req, res, url, idParam) {
  if (url.pathname === '/food/log') {
    if (req.method === 'GET') {
      const date = validDate(url.searchParams.get('date')) ?? bad('date')
      const { entries, totals } = await food.dayLog(date)
      return send(res, 200, { date, entries, totals })
    }
    const { entry, created, totals } = await food.addLog(validateLog(await readJson(req)))
    return send(res, created ? 201 : 200, { entry, totals })
  }
  if (idParam == null) throw httpError(404, 'not_found')
  await food.deleteLog(idParam)
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
  const food = createFoodService(store)

  async function dispatch (req, res, url, idParam) {
    const m = req.method
    const path = url.pathname
    if (path === '/food/settings') {
      if (m === 'GET') return send(res, 200, { settings: await food.getSettings() })
      return send(res, 200, { settings: await food.updateSettings(validateSettings(await readJson(req))) })
    }
    if (path === '/food/profile') {
      if (m === 'GET') return send(res, 200, { profile: await food.getProfile() })
      return send(res, 200, { profile: await food.putProfile(validateProfile(await readJson(req), now())) })
    }
    if (path === '/food/log/summary') {
      if (!summaries.take(req.socket?.remoteAddress ?? 'unknown')) throw httpError(429, 'rate_limited')
      const { from, to } = validateRange(url.searchParams)
      return send(res, 200, { from, to, days: await food.summary(from, to) })
    }
    if (path === '/food/products' || path.startsWith('/food/products/')) return products(food, req, res, path, idParam)
    if (path === '/food/recipes' || path.startsWith('/food/recipes/')) return recipes(food, req, res, path, idParam)
    if (path === '/food/log' || path.startsWith('/food/log/')) return logEntries(food, req, res, url, idParam)
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
