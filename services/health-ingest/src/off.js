/**
 * Open Food Facts lookups for the food log, done server side (the page never calls OFF). Only
 * normalized fields leave this module: { code, name, brand, stores, unit, per100 { kcal, protein,
 * carbs, fat }, servingSize, complete }. A nutriment OFF does not state (or states implausibly) is
 * null, never 0, and `complete` is false: the page then asks the user to fill the gaps from the label.
 * Nothing is saved here; the user confirms every value before POST /food/products.
 *
 * OFF etiquette: a descriptive User-Agent (no personal data), at most 10 searches / min and 100
 * product reads / min (token buckets; over the limit -> 429 off_rate_limited without calling OFF),
 * an in-memory LRU cache (24 h, not-found for 1 h, an upstream failure for 60 s) so a repeated scan
 * costs nothing, one shared request for concurrent identical lookups, an 8 s timeout,
 * no redirects and a response size cap. Errors are coarse codes: off_not_found (404),
 * off_rate_limited (429), off_unavailable (502: network, timeout, 5xx, oversized or malformed body).
 */
import { createTokenBucket } from './limits.js'
import { round1 } from './food-calc.js'

export const OFF_BASE = 'https://world.openfoodfacts.org'
export const OFF_USER_AGENT = 'health-coach/1.0 (self-hosted personal food log)'
const FIELDS = 'code,product_name,product_name_es,brands,stores,quantity,product_quantity_unit,serving_quantity,nutriments'
const KJ_PER_KCAL = 4.184
const MAX_RESULTS = 10
const NOT_FOUND_TTL_MS = 3_600_000
// an upstream 429 / 5xx / timeout is remembered this long, so retries do not hammer OFF
const FAILURE_TTL_MS = 60_000

function offError (status, code) {
  return Object.assign(new Error(code), { status, code })
}
/** A failure that came from OFF (or the way there): cached briefly, see FAILURE_TTL_MS. */
function upstream (status, code) {
  return Object.assign(offError(status, code), { upstream: true })
}
/** A number in [0, max] (numeric strings accepted), else null. */
function value (v, max) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 && n <= max ? round1(n) : null
}
function text (v, max) {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

export function normalizeOffProduct (p) {
  const n = (p && p.nutriments) || {}
  let kcal = value(n['energy-kcal_100g'], 900)
  if (kcal == null && n['energy-kcal_100g'] == null) {
    const kj = value(n['energy-kj_100g'], 900 * KJ_PER_KCAL) ?? value(n.energy_100g, 900 * KJ_PER_KCAL)
    kcal = kj == null ? null : round1(kj / KJ_PER_KCAL)
  }
  const per100 = {
    kcal,
    protein: value(n.proteins_100g, 100),
    carbs: value(n.carbohydrates_100g, 100),
    fat: value(n.fat_100g, 100)
  }
  const name = text(p?.product_name_es, 120) ?? text(p?.product_name, 120)
  const liquid = p?.product_quantity_unit === 'ml' || /\d\s*(ml|cl|l)\b/i.test(String(p?.quantity ?? ''))
  const serving = value(p?.serving_quantity, 5000)
  return {
    code: text(String(p?.code ?? ''), 14),
    name,
    brand: text(String(p?.brands ?? '').split(',')[0], 80),
    stores: text(p?.stores, 120),
    unit: liquid ? 'ml' : 'g',
    per100,
    servingSize: serving > 0 ? serving : null,
    complete: name != null && Object.values(per100).every((v) => v != null)
  }
}

async function readCapped (res, max) {
  const declared = Number(res.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > max) throw upstream(502, 'off_unavailable')
  const reader = res.body?.getReader?.()
  if (!reader) throw upstream(502, 'off_unavailable')
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value: chunk } = await reader.read()
    if (done) break
    size += chunk.byteLength
    if (size > max) {
      reader.cancel().catch(() => {})
      throw upstream(502, 'off_unavailable')
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'))
  } catch {
    throw upstream(502, 'off_unavailable')
  }
}

export function createOffClient ({
  fetch = globalThis.fetch,
  now = Date.now,
  timeoutMs = 8000,
  maxBytes = 1_000_000,
  cacheTtlMs = 24 * 3_600_000,
  cacheMax = 200
} = {}) {
  const buckets = {
    search: createTokenBucket({ capacity: 10, perMs: 60_000, now }),
    product: createTokenBucket({ capacity: 100, perMs: 60_000, now })
  }
  const cache = new Map()

  function cached (key) {
    const hit = cache.get(key)
    if (!hit) return undefined
    if (now() >= hit.expires) { cache.delete(key); return undefined }
    cache.delete(key) // LRU: move to the back
    cache.set(key, hit)
    return hit
  }
  function remember (key, entry, ttl) {
    cache.delete(key)
    while (cache.size >= cacheMax) cache.delete(cache.keys().next().value)
    cache.set(key, { ...entry, expires: now() + ttl })
  }

  const inflight = new Map()
  /** Cache (values and failures), then one shared in-flight request per key. Our own token-bucket
   * refusal is not cached (it clears as soon as a token is back). */
  function lookup (key, load) {
    const hit = cached(key)
    if (hit) return hit.error ? Promise.reject(offError(hit.error.status, hit.error.code)) : Promise.resolve(hit.value)
    if (inflight.has(key)) return inflight.get(key)
    const p = load().then((value) => {
      remember(key, { value }, cacheTtlMs)
      return value
    }, (err) => {
      if (err && err.ttl) remember(key, { error: { status: err.status, code: err.code } }, err.ttl)
      else if (err && err.upstream) remember(key, { error: { status: err.status, code: err.code } }, FAILURE_TTL_MS)
      throw offError(err.status ?? 502, err.code ?? 'off_unavailable')
    }).finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  }

  async function get (url, bucket) {
    if (!buckets[bucket].take()) throw offError(429, 'off_rate_limited')
    // the timeout covers the whole exchange, body included
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      let res
      try {
        res = await fetch(url, {
          headers: { 'user-agent': OFF_USER_AGENT, accept: 'application/json' },
          redirect: 'error',
          signal: ctl.signal
        })
      } catch {
        throw upstream(502, 'off_unavailable')
      }
      if (res.status === 429) throw upstream(429, 'off_rate_limited')
      if (res.status === 404) return { status: 404, body: null }
      if (!res.ok) throw upstream(502, 'off_unavailable')
      return { status: res.status, body: await readCapped(res, maxBytes) }
    } catch (err) {
      throw err && err.code ? err : upstream(502, 'off_unavailable')
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    byBarcode (code) {
      return lookup(`p:${code}`, async () => {
        const r = await get(`${OFF_BASE}/api/v2/product/${encodeURIComponent(code)}?fields=${FIELDS}`, 'product')
        if (r.status === 404 || !r.body || r.body.status === 0 || !r.body.product) {
          throw Object.assign(offError(404, 'off_not_found'), { ttl: Math.min(NOT_FOUND_TTL_MS, cacheTtlMs) })
        }
        return normalizeOffProduct({ code, ...r.body.product })
      })
    },

    search (q) {
      const terms = q.replace(/\s+/g, ' ').trim()
      return lookup(`s:${terms.toLowerCase()}`, async () => {
        const params = new URLSearchParams({
          search_terms: terms, search_simple: '1', action: 'process', json: '1', page_size: String(MAX_RESULTS), fields: FIELDS
        })
        const r = await get(`${OFF_BASE}/cgi/search.pl?${params}`, 'search')
        const products = Array.isArray(r.body?.products) ? r.body.products : []
        return products.map(normalizeOffProduct).filter((p) => p.code).slice(0, MAX_RESULTS)
      })
    }
  }
}
