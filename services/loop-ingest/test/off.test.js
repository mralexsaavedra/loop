import test from 'node:test'
import assert from 'node:assert/strict'
import { createOffClient, normalizeOffProduct, OFF_USER_AGENT, OFF_BASE } from '../src/off.js'

const json = (body, { status = 200, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json', ...headers }),
  body: new Blob([JSON.stringify(body)]).stream()
})

const PRODUCT = {
  code: '8480000123456',
  product_name: 'Natural yogurt',
  product_name_es: 'Yogur natural',
  brands: 'Hacendado, Mercadona',
  stores: 'Mercadona',
  quantity: '4 x 125 g',
  serving_quantity: 125,
  nutriments: { 'energy-kcal_100g': 61, proteins_100g: 4.1, carbohydrates_100g: '4.6', fat_100g: 3 }
}

test('normalize: prefers the Spanish name, first brand, kcal, numeric strings; complete when all four macros exist', () => {
  assert.deepEqual(normalizeOffProduct(PRODUCT), {
    code: '8480000123456', name: 'Yogur natural', brand: 'Hacendado', stores: 'Mercadona', unit: 'g',
    per100: { kcal: 61, protein: 4.1, carbs: 4.6, fat: 3 }, servingSize: 125, complete: true
  })
})

test('normalize: missing nutriments are null (never 0) and complete:false; kcal from kJ when only kJ is given', () => {
  const n = normalizeOffProduct({ code: '12345678', product_name: 'Zumo', quantity: '1 l', nutriments: { 'energy-kj_100g': 184, carbohydrates_100g: 10 } })
  assert.deepEqual(n.per100, { kcal: 44, protein: null, carbs: 10, fat: null })
  assert.equal(n.complete, false)
  assert.equal(n.unit, 'ml', 'a litre quantity is a liquid')
  assert.equal(n.servingSize, null)
  assert.equal(n.brand, null)
  const e = normalizeOffProduct({ code: '12345678', product_name: 'X', nutriments: { energy_100g: 418.4, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0 } })
  assert.equal(e.per100.kcal, 100, 'energy_100g is kJ')
  assert.equal(e.complete, true, '0 is a real value when OFF states it')
})

test('normalize: implausible values are dropped to null, never passed on', () => {
  const n = normalizeOffProduct({ code: '12345678', product_name: 'X', nutriments: { 'energy-kcal_100g': 4000, proteins_100g: -2, carbohydrates_100g: 'abc', fat_100g: 150 } })
  assert.deepEqual(n.per100, { kcal: null, protein: null, carbs: null, fat: null })
  assert.equal(n.complete, false)
  assert.equal(normalizeOffProduct({ code: '12345678', nutriments: {} }).complete, false, 'no name')
})

test('barcode lookup: v2 product URL, descriptive User-Agent, no redirects, a timeout signal; cached for later calls', async () => {
  const calls = []
  const fetch = async (url, init) => { calls.push({ url, init }); return json({ status: 1, product: PRODUCT }) }
  const off = createOffClient({ fetch })
  const p = await off.byBarcode('8480000123456')
  assert.equal(p.name, 'Yogur natural')
  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.startsWith(`${OFF_BASE}/api/v2/product/8480000123456?`))
  assert.equal(calls[0].init.headers['user-agent'], OFF_USER_AGENT)
  assert.match(OFF_USER_AGENT, /^loop\/\d/)
  assert.doesNotMatch(OFF_USER_AGENT, /@/, 'no personal email')
  assert.equal(calls[0].init.redirect, 'error')
  assert.ok(calls[0].init.signal, 'a timeout signal')
  await off.byBarcode('8480000123456')
  assert.equal(calls.length, 1, 'served from the cache')
})

test('barcode not found -> off_not_found (404); OFF 429 -> off_rate_limited; network / 5xx -> off_unavailable', async () => {
  const notFound = createOffClient({ fetch: async () => json({ status: 0, status_verbose: 'product not found' }, { status: 404 }) })
  await assert.rejects(notFound.byBarcode('00000000'), (e) => e.status === 404 && e.code === 'off_not_found')
  const limited = createOffClient({ fetch: async () => json({}, { status: 429 }) })
  await assert.rejects(limited.byBarcode('12345678'), (e) => e.status === 429 && e.code === 'off_rate_limited')
  const down = createOffClient({ fetch: async () => { throw new TypeError('fetch failed') } })
  await assert.rejects(down.byBarcode('12345678'), (e) => e.status === 502 && e.code === 'off_unavailable')
  const five = createOffClient({ fetch: async () => json({}, { status: 503 }) })
  await assert.rejects(five.search('avena'), (e) => e.status === 502 && e.code === 'off_unavailable')
})

test('a response over the size cap is refused (declared or streamed)', async () => {
  const declared = createOffClient({ maxBytes: 100, fetch: async () => json({ status: 1, product: PRODUCT }, { headers: { 'content-length': '5000' } }) })
  await assert.rejects(declared.byBarcode('12345678'), (e) => e.code === 'off_unavailable')
  const streamed = createOffClient({ maxBytes: 100, fetch: async () => json({ status: 1, product: PRODUCT }) })
  await assert.rejects(streamed.byBarcode('12345678'), (e) => e.code === 'off_unavailable')
})

test('a hung request is aborted by the timeout', async () => {
  const off = createOffClient({
    timeoutMs: 20,
    fetch: (url, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason)) })
  })
  await assert.rejects(off.byBarcode('12345678'), (e) => e.code === 'off_unavailable')
})

test('search: text query, at most 10 normalized results with a code', async () => {
  let seen
  const fetch = async (url) => {
    seen = new URL(url)
    return json({ products: [PRODUCT, { product_name: 'no code' }, ...Array.from({ length: 12 }, (_, i) => ({ ...PRODUCT, code: String(10000000 + i) }))] })
  }
  const off = createOffClient({ fetch })
  const r = await off.search('  Yogur  ')
  assert.equal(seen.searchParams.get('search_terms'), 'Yogur')
  assert.equal(seen.searchParams.get('json'), '1')
  assert.equal(r.length, 10)
  assert.ok(r.every((x) => x.code))
})

test('rate limits: search <= 10/min, product <= 100/min (token buckets); cache hits are free', async () => {
  let t = 0
  let n = 0
  const fetch = async (url) => { n++; return url.includes('/api/v2/product/') ? json({ status: 1, product: PRODUCT }) : json({ products: [] }) }
  const off = createOffClient({ fetch, now: () => t })
  for (let i = 0; i < 10; i++) await off.search(`q${i}`)
  await assert.rejects(off.search('q10'), (e) => e.status === 429 && e.code === 'off_rate_limited')
  await off.search('q0') // cached
  t += 6_000 // one token back (10/min)
  await off.search('q11')
  for (let i = 0; i < 100; i++) await off.byBarcode(String(20000000 + i))
  await assert.rejects(off.byBarcode('30000000'), (e) => e.code === 'off_rate_limited')
  assert.equal(n, 111)
})

test('the cache expires after its TTL and is bounded (LRU)', async () => {
  let t = 0
  let n = 0
  const off = createOffClient({ fetch: async () => { n++; return json({ status: 1, product: PRODUCT }) }, now: () => t, cacheTtlMs: 1000, cacheMax: 2 })
  await off.byBarcode('11111111')
  t = 1001
  await off.byBarcode('11111111')
  assert.equal(n, 2, 'expired')
  await off.byBarcode('22222222')
  await off.byBarcode('33333333') // evicts 11111111
  await off.byBarcode('11111111')
  assert.equal(n, 5)
})

test('an upstream 429 / 5xx / timeout is remembered for ~60 s (no hammering), then retried', async () => {
  let t = 0
  let n = 0
  const off = createOffClient({ now: () => t, fetch: async () => { n++; return json({}, { status: 503 }) } })
  await assert.rejects(off.byBarcode('12345678'), (e) => e.code === 'off_unavailable')
  await assert.rejects(off.byBarcode('12345678'), (e) => e.code === 'off_unavailable')
  assert.equal(n, 1, 'served from the negative cache')
  t = 61_000
  await assert.rejects(off.byBarcode('12345678'))
  assert.equal(n, 2)
  let m = 0
  const limited = createOffClient({ now: () => t, fetch: async () => { m++; return json({}, { status: 429 }) } })
  await assert.rejects(limited.search('avena'), (e) => e.code === 'off_rate_limited')
  await assert.rejects(limited.search('avena'), (e) => e.code === 'off_rate_limited')
  assert.equal(m, 1)
})

test('concurrent identical misses share ONE upstream request', async () => {
  let n = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const off = createOffClient({ fetch: async () => { n++; await gate; return json({ status: 1, product: PRODUCT }) } })
  const a = off.byBarcode('8480000123456')
  const b = off.byBarcode('8480000123456')
  release()
  const [x, y] = await Promise.all([a, b])
  assert.equal(n, 1)
  assert.deepEqual(x, y)
})
