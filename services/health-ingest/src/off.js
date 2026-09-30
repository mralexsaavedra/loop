/**
 * Open Food Facts lookups for the food log, done server side (the page never calls OFF). Only
 * normalized fields leave this module: { code, name, brand, stores, unit, per100 { kcal, protein,
 * carbs, fat }, servingSize, complete }. A nutriment OFF does not state (or states implausibly) is
 * null, never 0, and `complete` is false: the page then asks the owner to fill the gaps from the label.
 * Nothing is saved here; the owner confirms every value before POST /food/products.
 *
 * OFF etiquette: a descriptive User-Agent (no personal data), at most 10 searches / min and 100
 * product reads / min (token buckets; over the limit -> 429 off_rate_limited without calling OFF),
 * an in-memory LRU cache (24 h, not-found for 1 h) so a repeated scan costs nothing, an 8 s timeout,
 * no redirects and a response size cap. Errors are coarse codes: off_not_found (404),
 * off_rate_limited (429), off_unavailable (502: network, timeout, 5xx, oversized or malformed body).
 */
import { createTokenBucket } from './limits.js'

export const OFF_BASE = 'https://world.openfoodfacts.org'
export const OFF_USER_AGENT = 'health-coach/1.0 (self-hosted personal food log)'
const FIELDS = 'code,product_name,product_name_es,brands,stores,quantity,product_quantity_unit,serving_quantity,nutriments'
const KJ_PER_KCAL = 4.184
const MAX_RESULTS = 10
const NOT_FOUND_TTL_MS = 3_600_000

function offError (status, code) {
  return Object.assign(new Error(code), { status, code })
}
function round1 (v) {
  return Math.round(v * 10 + 1e-9) / 10
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
  if (Number.isFinite(declared) && declared > max) throw offError(502, 'off_unavailable')
  const reader = res.body?.getReader?.()
  if (!reader) throw offError(502, 'off_unavailable')
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value: chunk } = await reader.read()
    if (done) break
    size += chunk.byteLength
    if (size > max) {
      reader.cancel().catch(() => {})
      throw offError(502, 'off_unavailable')
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'))
  } catch {
    throw offError(502, 'off_unavailable')
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
        throw offError(502, 'off_unavailable')
      }
      if (res.status === 429) throw offError(429, 'off_rate_limited')
      if (res.status === 404) return { status: 404, body: null }
      if (!res.ok) throw offError(502, 'off_unavailable')
      return { status: res.status, body: await readCapped(res, maxBytes) }
    } catch (err) {
      throw err && err.code ? err : offError(502, 'off_unavailable')
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async byBarcode (code) {
      const key = `p:${code}`
      const hit = cached(key)
      if (hit) {
        if (hit.notFound) throw offError(404, 'off_not_found')
        return hit.value
      }
      const r = await get(`${OFF_BASE}/api/v2/product/${encodeURIComponent(code)}?fields=${FIELDS}`, 'product')
      if (r.status === 404 || !r.body || r.body.status === 0 || !r.body.product) {
        remember(key, { notFound: true }, Math.min(NOT_FOUND_TTL_MS, cacheTtlMs))
        throw offError(404, 'off_not_found')
      }
      const value = normalizeOffProduct({ code, ...r.body.product })
      remember(key, { value }, cacheTtlMs)
      return value
    },

    async search (q) {
      const terms = q.replace(/\s+/g, ' ').trim()
      const key = `s:${terms.toLowerCase()}`
      const hit = cached(key)
      if (hit) return hit.value
      const params = new URLSearchParams({
        search_terms: terms, search_simple: '1', action: 'process', json: '1', page_size: String(MAX_RESULTS), fields: FIELDS
      })
      const r = await get(`${OFF_BASE}/cgi/search.pl?${params}`, 'search')
      const products = Array.isArray(r.body?.products) ? r.body.products : []
      const value = products.map(normalizeOffProduct).filter((p) => p.code).slice(0, MAX_RESULTS)
      remember(key, { value }, cacheTtlMs)
      return value
    }
  }
}
