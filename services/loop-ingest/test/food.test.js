import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createFoodRoutes, FOOD_BODY_LIMIT } from '../src/food.js'
import { hostAllowed, parseAllowedHosts } from '../src/http.js'

/** In-memory stand-in for src/food-db.js createFoodStore (same method contract). */
function memoryStore () {
  const db = { product: [], recipe: [], log: [], settings: null, profile: null }
  let seq = 0
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))
  const stamp = () => new Date(Date.UTC(2030, 0, 10, 12, 0, seq)).toISOString()
  return {
    db,
    async listProducts () { return clone(db.product.filter((p) => !p.archived)) },
    async getProducts (ids) { return clone(db.product.filter((p) => ids.includes(p.id))) },
    async getProduct (id) { return clone(db.product.find((p) => p.id === id) ?? null) },
    async insertProduct (p) {
      if (p.barcode && db.product.some((x) => !x.archived && x.barcode === p.barcode)) {
        throw Object.assign(new Error('dup'), { status: 409, code: 'barcode_exists' })
      }
      const row = { id: ++seq, ...clone(p), archived: false, createdAt: stamp(), updatedAt: stamp() }
      db.product.push(row)
      return clone(row)
    },
    async updateProduct (id, p) {
      const row = db.product.find((x) => x.id === id && !x.archived)
      if (!row) return null
      if (p.barcode && db.product.some((x) => x.id !== id && !x.archived && x.barcode === p.barcode)) {
        throw Object.assign(new Error('dup'), { status: 409, code: 'barcode_exists' })
      }
      Object.assign(row, clone(p), { updatedAt: stamp() })
      return clone(row)
    },
    async archiveProduct (id) {
      const row = db.product.find((x) => x.id === id && !x.archived)
      if (!row) return false
      row.archived = true
      return true
    },
    async listRecipes () { return clone(db.recipe.filter((r) => !r.archived)) },
    async getRecipe (id) { return clone(db.recipe.find((r) => r.id === id) ?? null) },
    async insertRecipe (r) {
      const row = { id: ++seq, ...clone(r), archived: false, createdAt: stamp(), updatedAt: stamp() }
      db.recipe.push(row)
      return clone(row)
    },
    async updateRecipe (id, r) {
      const row = db.recipe.find((x) => x.id === id && !x.archived)
      if (!row) return null
      Object.assign(row, clone(r), { updatedAt: stamp() })
      return clone(row)
    },
    async archiveRecipe (id) {
      const row = db.recipe.find((x) => x.id === id && !x.archived)
      if (!row) return false
      row.archived = true
      return true
    },
    async listLog (date) { return clone(db.log.filter((e) => e.date === date)) },
    async getLogByRequest (requestId) { return clone(db.log.find((e) => e.requestId === requestId) ?? null) },
    async insertLog (e) {
      if (e.requestId && db.log.some((x) => x.requestId === e.requestId)) return null
      const row = { id: ++seq, ...clone(e), createdAt: stamp() }
      db.log.push(row)
      return clone(row)
    },
    async listLogRange (from, to) { return clone(db.log.filter((e) => e.date >= from && e.date <= to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))) },
    async getSettings () { return clone(db.settings ?? { goal: null, targetWeightKg: null, updatedAt: null }) },
    async updateSettings (patch) {
      db.settings = { ...(db.settings ?? { goal: null, targetWeightKg: null }), ...clone(patch), updatedAt: stamp() }
      return clone(db.settings)
    },
    async getProfile () { return db.profile ? clone(db.profile) : null },
    async putProfile (data) {
      db.profile = { ...clone(data), updatedAt: stamp() }
      return clone(db.profile)
    },
    async deleteLog (id) {
      const i = db.log.findIndex((e) => e.id === id)
      if (i < 0) return false
      db.log.splice(i, 1)
      return true
    }
  }
}

function stubOff () {
  const calls = []
  return {
    calls,
    async byBarcode (code) {
      calls.push(['barcode', code])
      if (code === '00000000') throw Object.assign(new Error('nf'), { status: 404, code: 'off_not_found' })
      if (code === '11111111') throw Object.assign(new Error('limit'), { status: 429, code: 'off_rate_limited' })
      return { code, name: 'Demo yogurt', brand: 'Demo', stores: 'Demo store', unit: 'g', per100: { kcal: 60, protein: 10, carbs: 4, fat: null }, servingSize: 125, complete: false }
    },
    async search (q) {
      calls.push(['search', q])
      return [{ code: '8400000000001', name: 'Demo oats', brand: null, stores: null, unit: 'g', per100: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 }, servingSize: null, complete: true }]
    }
  }
}

async function setup ({ store = memoryStore(), off = stubOff(), writeLimit, summaryLimit, log = () => {}, available, settingsAvailable, profileAvailable, allowedHosts } = {}) {
  const routes = createFoodRoutes({ store, off, writeLimit, summaryLimit, log, available, settingsAvailable, profileAvailable, allowedHosts })
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (!(await routes.handle(req, res, url))) { res.writeHead(404); res.end() }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  async function call (method, path, { body, headers = {}, raw } = {}) {
    const h = { 'x-hc-food': '1', ...headers }
    let payload
    if (raw !== undefined) payload = raw
    else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] ??= 'application/json' }
    const res = await fetch(base + path, { method, headers: h, body: payload })
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
  }
  /** A raw request with any Host / Origin (fetch does not let a test forge Host). */
  function rawCall (method, path, { host, headers = {}, body } = {}) {
    const port = server.address().port
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const h = { 'x-hc-food': '1', host: host ?? `127.0.0.1:${port}`, ...headers }
    if (payload !== undefined) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(payload) }
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
        let text = ''
        res.on('data', (c) => { text += c })
        res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }))
      })
      req.on('error', reject)
      req.end(payload)
    })
  }
  return { store, off, call, rawCall, close: () => new Promise((resolve) => server.close(resolve)) }
}

const YOGURT = { name: 'Yogur natural', brand: 'Hacendado', store: 'mercadona', barcode: '8480000123456', unit: 'g', per100: { kcal: 60, protein: 10, carbs: 4, fat: 0.2 }, servingSize: 125, source: 'label' }
const MILK = { name: 'Leche semidesnatada', brand: null, store: 'dia', barcode: null, unit: 'ml', per100: { kcal: 46, protein: 3.4, carbs: 4.8, fat: 1.6 }, servingSize: null, source: 'off', offCode: '8480000999999' }
const OATS = { name: 'Copos de avena', store: 'eroski', unit: 'g', per100: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 }, source: 'manual' }

test('every /food request needs the X-HC-Food header: 403 without it, for reads too', async () => {
  const t = await setup()
  try {
    for (const [method, path] of [['GET', '/food/products'], ['POST', '/food/products'], ['GET', '/food/log?date=2030-01-10'], ['DELETE', '/food/log/1'], ['OPTIONS', '/food/products']]) {
      const r = await t.call(method, path, { headers: { 'x-hc-food': '' } })
      assert.equal(r.status, 403, `${method} ${path}`)
      assert.deepEqual(r.body, { error: 'forbidden' })
    }
    const wrong = await t.call('GET', '/food/products', { headers: { 'x-hc-food': '0' } })
    assert.equal(wrong.status, 403)
  } finally { await t.close() }
})

test('no CORS headers on any /food answer (a cross-site preflight is never approved)', async () => {
  const t = await setup()
  try {
    const answers = [
      await t.call('OPTIONS', '/food/products', { headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-hc-food,content-type' } }),
      await t.call('GET', '/food/products', { headers: { origin: 'https://evil.example' } }),
      await t.call('POST', '/food/products', { body: YOGURT, headers: { origin: 'https://evil.example' } })
    ]
    for (const r of answers) {
      for (const [k] of r.headers) assert.doesNotMatch(k, /^access-control-/i)
      assert.equal(r.headers.get('cache-control'), 'no-store')
    }
  } finally { await t.close() }
})

test('writes need Content-Type application/json: 415 otherwise, and nothing is stored', async () => {
  const t = await setup()
  try {
    const r = await t.call('POST', '/food/products', { raw: JSON.stringify(YOGURT), headers: { 'content-type': 'text/plain' } })
    assert.equal(r.status, 415)
    assert.deepEqual(r.body, { error: 'unsupported_media_type' })
    const form = await t.call('POST', '/food/log', { raw: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    assert.equal(form.status, 415)
    const ok = await t.call('POST', '/food/products', { body: YOGURT, headers: { 'content-type': 'application/json; charset=utf-8' } })
    assert.equal(ok.status, 201)
    assert.equal(t.store.db.product.length, 1)
  } finally { await t.close() }
})

test('a body over 16 KB is refused with 413 (declared or streamed)', async () => {
  const t = await setup()
  try {
    assert.equal(FOOD_BODY_LIMIT, 16 * 1024)
    const big = JSON.stringify({ ...YOGURT, name: 'x'.repeat(FOOD_BODY_LIMIT) })
    const r = await t.call('POST', '/food/products', { raw: big, headers: { 'content-type': 'application/json' } })
    assert.equal(r.status, 413)
    assert.deepEqual(r.body, { error: 'payload_too_large' })
    assert.equal(t.store.db.product.length, 0)
  } finally { await t.close() }
})

test('malformed JSON -> 400 bad_json; unknown keys and bad values -> 400 invalid with the field, never raw text', async () => {
  const t = await setup()
  try {
    assert.deepEqual((await t.call('POST', '/food/products', { raw: '{"name":', headers: { 'content-type': 'application/json' } })).body, { error: 'bad_json' })
    const cases = [
      [{ ...YOGURT, extra: 1 }, 'extra'],
      [{ ...YOGURT, name: '   ' }, 'name'],
      [{ ...YOGURT, store: 'lidl' }, 'store'],
      [{ ...YOGURT, unit: 'oz' }, 'unit'],
      [{ ...YOGURT, barcode: '12ab' }, 'barcode'],
      [{ ...YOGURT, per100: { ...YOGURT.per100, kcal: 901 } }, 'per100.kcal'],
      [{ ...YOGURT, per100: { ...YOGURT.per100, protein: 101 } }, 'per100.protein'],
      [{ ...YOGURT, per100: { ...YOGURT.per100, fat: -1 } }, 'per100.fat'],
      [{ ...YOGURT, per100: { ...YOGURT.per100, carbs: null } }, 'per100.carbs'],
      [{ ...YOGURT, per100: { ...YOGURT.per100, carbs: '4' } }, 'per100.carbs'],
      [{ ...YOGURT, servingSize: 0 }, 'servingSize'],
      [{ ...YOGURT, source: 'web' }, 'source']
    ]
    for (const [body, field] of cases) {
      const r = await t.call('POST', '/food/products', { body })
      assert.equal(r.status, 400, field)
      assert.deepEqual(r.body, { error: 'invalid', field }, field)
    }
    assert.equal(t.store.db.product.length, 0)
  } finally { await t.close() }
})

test('products: create (trimmed, 1 decimal), list, edit, archive; Atwater mismatch needs force', async () => {
  const t = await setup()
  try {
    const created = await t.call('POST', '/food/products', { body: { ...YOGURT, name: '  Yogur natural  ', per100: { kcal: 60, protein: 10.04, carbs: 4, fat: 0.2 } } })
    assert.equal(created.status, 201)
    const p = created.body.product
    assert.equal(p.name, 'Yogur natural')
    assert.equal(p.per100.protein, 10)
    assert.equal(p.store, 'mercadona')
    assert.equal(typeof p.id, 'number')

    const off = await t.call('POST', '/food/products', { body: { ...YOGURT, barcode: null, per100: { kcal: 100, protein: 30, carbs: 30, fat: 10 } } })
    assert.equal(off.status, 400)
    assert.deepEqual(off.body, { error: 'atwater' })
    const forced = await t.call('POST', '/food/products', { body: { ...YOGURT, barcode: null, per100: { kcal: 100, protein: 30, carbs: 30, fat: 10 }, force: true } })
    assert.equal(forced.status, 201)

    assert.equal((await t.call('POST', '/food/products', { body: MILK })).status, 201)
    const list = await t.call('GET', '/food/products')
    assert.equal(list.status, 200)
    assert.equal(list.body.products.length, 3)
    assert.deepEqual(list.body.products.map((x) => x.store).sort(), ['dia', 'mercadona', 'mercadona'])

    const edited = await t.call('PUT', `/food/products/${p.id}`, { body: { ...YOGURT, per100: { kcal: 62, protein: 10, carbs: 4.5, fat: 0.2 } } })
    assert.equal(edited.status, 200)
    assert.equal(edited.body.product.per100.kcal, 62)

    assert.equal((await t.call('DELETE', `/food/products/${p.id}`)).status, 200)
    assert.equal((await t.call('GET', '/food/products')).body.products.length, 2)
    assert.equal((await t.call('DELETE', `/food/products/${p.id}`)).status, 404, 'already archived')
    assert.equal((await t.call('PUT', '/food/products/999', { body: YOGURT })).status, 404)
    assert.equal((await t.call('PUT', '/food/products/abc', { body: YOGURT })).status, 404)
  } finally { await t.close() }
})

test('a duplicate barcode among active products -> 409 barcode_exists', async () => {
  const t = await setup()
  try {
    assert.equal((await t.call('POST', '/food/products', { body: YOGURT })).status, 201)
    const dup = await t.call('POST', '/food/products', { body: { ...YOGURT, name: 'Otro' } })
    assert.equal(dup.status, 409)
    assert.deepEqual(dup.body, { error: 'barcode_exists' })
  } finally { await t.close() }
})

test('recipes: macros computed from the products (per serving / per 100 g cooked), never typed', async () => {
  const t = await setup()
  try {
    const oats = (await t.call('POST', '/food/products', { body: OATS })).body.product
    const milk = (await t.call('POST', '/food/products', { body: MILK })).body.product
    const r = await t.call('POST', '/food/recipes', { body: { name: 'Porridge', kind: 'serving', servings: 2, ingredients: [{ productId: oats.id, amount: 80 }, { productId: milk.id, amount: 300 }] } })
    assert.equal(r.status, 201)
    assert.deepEqual(r.body.recipe.perServing, { kcal: 218, protein: 10.5, carbs: 30.7, fat: 5.2 })
    assert.equal(r.body.recipe.per100, null)
    assert.equal(r.body.recipe.complete, true)
    assert.deepEqual(r.body.recipe.ingredients.map((i) => i.name), ['Copos de avena', 'Leche semidesnatada'])

    const typed = await t.call('POST', '/food/recipes', { body: { name: 'X', kind: 'serving', servings: 1, ingredients: [{ productId: oats.id, amount: 50 }], kcal: 999 } })
    assert.deepEqual(typed.body, { error: 'invalid', field: 'kcal' })

    const batch = await t.call('POST', '/food/recipes', { body: { name: 'Lentejas', kind: 'batch', cookedWeightG: 1000, ingredients: [{ productId: oats.id, amount: 300 }] } })
    assert.equal(batch.status, 201)
    assert.deepEqual(batch.body.recipe.per100, { kcal: 112, protein: 4.1, carbs: 17.6, fat: 2.1 })

    assert.deepEqual((await t.call('POST', '/food/recipes', { body: { name: 'B', kind: 'batch', servings: 2, ingredients: [{ productId: oats.id, amount: 1 }] } })).body, { error: 'invalid', field: 'servings' })
    assert.deepEqual((await t.call('POST', '/food/recipes', { body: { name: 'B', kind: 'serving', servings: 0, ingredients: [{ productId: oats.id, amount: 1 }] } })).body, { error: 'invalid', field: 'servings' })
    assert.deepEqual((await t.call('POST', '/food/recipes', { body: { name: 'B', kind: 'serving', servings: 1, ingredients: [] } })).body, { error: 'invalid', field: 'ingredients' })
    assert.deepEqual((await t.call('POST', '/food/recipes', { body: { name: 'B', kind: 'serving', servings: 1, ingredients: [{ productId: 999, amount: 10 }] } })).body, { error: 'unknown_product' })

    const list = await t.call('GET', '/food/recipes')
    assert.equal(list.body.recipes.length, 2)
    const upd = await t.call('PUT', `/food/recipes/${r.body.recipe.id}`, { body: { name: 'Porridge', kind: 'serving', servings: 1, ingredients: [{ productId: oats.id, amount: 80 }, { productId: milk.id, amount: 300 }] } })
    assert.equal(upd.body.recipe.perServing.kcal, 436)
    assert.equal((await t.call('DELETE', `/food/recipes/${r.body.recipe.id}`)).status, 200)
    assert.equal((await t.call('GET', '/food/recipes')).body.recipes.length, 1)
  } finally { await t.close() }
})

test('a recipe keeps its macros after one of its products is archived', async () => {
  const t = await setup()
  try {
    const oats = (await t.call('POST', '/food/products', { body: OATS })).body.product
    await t.call('POST', '/food/recipes', { body: { name: 'Avena', kind: 'serving', servings: 1, ingredients: [{ productId: oats.id, amount: 50 }] } })
    await t.call('DELETE', `/food/products/${oats.id}`)
    const [r] = (await t.call('GET', '/food/recipes')).body.recipes
    assert.equal(r.complete, true)
    assert.equal(r.perServing.kcal, 186)
  } finally { await t.close() }
})

test('log: product / recipe / quick entries store a SNAPSHOT; later product edits never rewrite history', async () => {
  const t = await setup()
  try {
    const yog = (await t.call('POST', '/food/products', { body: YOGURT })).body.product
    const oats = (await t.call('POST', '/food/products', { body: OATS })).body.product
    const rec = (await t.call('POST', '/food/recipes', { body: { name: 'Avena', kind: 'serving', servings: 2, ingredients: [{ productId: oats.id, amount: 100 }] } })).body.recipe

    const a = await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'breakfast', refType: 'product', refId: yog.id, amount: 1, unit: 'serving' } })
    assert.equal(a.status, 201)
    assert.deepEqual([a.body.entry.kcal, a.body.entry.protein, a.body.entry.carbs, a.body.entry.fat], [75, 12.5, 5, 0.3])
    assert.equal(a.body.entry.label, 'Yogur natural')
    assert.equal(a.body.totals.kcal, 75)

    const b = await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'breakfast', refType: 'recipe', refId: rec.id, amount: 1, unit: 'serving' } })
    assert.equal(b.body.entry.kcal, 186)
    const c = await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'snack', refType: 'quick', label: 'Pintxo', kcal: 250 } })
    assert.equal(c.status, 201)
    assert.equal(c.body.entry.protein, null, 'unknown macros stay null, never 0')
    assert.deepEqual(c.body.totals.missing, { protein: true, carbs: true, fat: true })

    await t.call('PUT', `/food/products/${yog.id}`, { body: { ...YOGURT, per100: { kcal: 120, protein: 20, carbs: 8, fat: 0.4 } } })
    const day = await t.call('GET', '/food/log?date=2030-01-10')
    assert.equal(day.status, 200)
    assert.equal(day.body.date, '2030-01-10')
    assert.equal(day.body.entries.length, 3)
    assert.equal(day.body.entries[0].kcal, 75, 'the snapshot is unchanged')
    assert.equal(day.body.totals.kcal, 75 + 186 + 250)
    assert.equal(day.body.totals.count, 3)
    assert.equal((await t.call('GET', '/food/log?date=2030-01-11')).body.entries.length, 0)

    assert.equal((await t.call('DELETE', `/food/log/${a.body.entry.id}`)).status, 200)
    assert.equal((await t.call('DELETE', `/food/log/${a.body.entry.id}`)).status, 404)
    assert.equal((await t.call('GET', '/food/log?date=2030-01-10')).body.entries.length, 2)
  } finally { await t.close() }
})

test('log validation: date round trip, meal slot, a unit the product cannot take, archived refs', async () => {
  const t = await setup()
  try {
    const milk = (await t.call('POST', '/food/products', { body: MILK })).body.product
    const base = { date: '2030-01-10', meal: 'lunch', refType: 'product', refId: milk.id, amount: 250, unit: 'ml' }
    assert.equal((await t.call('POST', '/food/log', { body: base })).status, 201)
    assert.deepEqual((await t.call('POST', '/food/log', { body: { ...base, date: '2030-02-31' } })).body, { error: 'invalid', field: 'date' })
    assert.deepEqual((await t.call('POST', '/food/log', { body: { ...base, meal: 'brunch' } })).body, { error: 'invalid', field: 'meal' })
    assert.deepEqual((await t.call('POST', '/food/log', { body: { ...base, amount: 0 } })).body, { error: 'invalid', field: 'amount' })
    assert.deepEqual((await t.call('POST', '/food/log', { body: { ...base, unit: 'serving' } })).body, { error: 'unit' })
    assert.deepEqual((await t.call('POST', '/food/log', { body: { ...base, unit: 'g' } })).body, { error: 'unit' })
    assert.deepEqual((await t.call('POST', '/food/log', { body: { ...base, refId: 999 } })).body, { error: 'unknown_product' })
    assert.deepEqual((await t.call('POST', '/food/log', { body: { ...base, refType: 'recipe', refId: 999, unit: 'serving' } })).body, { error: 'unknown_recipe' })
    assert.deepEqual((await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'snack', refType: 'quick', label: 'X', kcal: 100, protein: 30, carbs: 30, fat: 10 } })).body, { error: 'atwater' })
    assert.equal((await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'snack', refType: 'quick', label: 'X', kcal: 100, protein: 30, carbs: 30, fat: 10, force: true } })).status, 201)
    assert.deepEqual((await t.call('GET', '/food/log?date=nope')).body, { error: 'invalid', field: 'date' })
    assert.deepEqual((await t.call('GET', '/food/log')).body, { error: 'invalid', field: 'date' })
    await t.call('DELETE', `/food/products/${milk.id}`)
    assert.deepEqual((await t.call('POST', '/food/log', { body: base })).body, { error: 'unknown_product' })
  } finally { await t.close() }
})

test('OFF lookup is proxied server side with coarse errors; nothing is saved', async () => {
  const t = await setup()
  try {
    const one = await t.call('GET', '/food/off?barcode=8480000123456')
    assert.equal(one.status, 200)
    assert.equal(one.body.product.complete, false)
    assert.equal(one.body.product.per100.fat, null)
    const found = await t.call('GET', '/food/off?q=avena')
    assert.equal(found.body.results.length, 1)
    assert.deepEqual(t.off.calls, [['barcode', '8480000123456'], ['search', 'avena']])
    assert.equal(t.store.db.product.length, 0, 'a lookup never saves')
    assert.deepEqual((await t.call('GET', '/food/off?barcode=123')).body, { error: 'invalid', field: 'barcode' })
    assert.deepEqual((await t.call('GET', '/food/off?q=a')).body, { error: 'invalid', field: 'q' })
    assert.deepEqual((await t.call('GET', '/food/off')).body, { error: 'invalid', field: 'q' })
    const nf = await t.call('GET', '/food/off?barcode=00000000')
    assert.equal(nf.status, 404)
    assert.deepEqual(nf.body, { error: 'off_not_found' })
    const rl = await t.call('GET', '/food/off?barcode=11111111')
    assert.equal(rl.status, 429)
    assert.deepEqual(rl.body, { error: 'off_rate_limited' })
  } finally { await t.close() }
})

test('writes are rate limited per client (429 rate_limited); reads are not', async () => {
  const t = await setup({ writeLimit: 3 })
  try {
    for (let i = 0; i < 3; i++) assert.equal((await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'snack', refType: 'quick', label: 'x', kcal: 10 } })).status, 201)
    const r = await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'snack', refType: 'quick', label: 'x', kcal: 10 } })
    assert.equal(r.status, 429)
    assert.deepEqual(r.body, { error: 'rate_limited' })
    assert.equal((await t.call('GET', '/food/log?date=2030-01-10')).status, 200)
  } finally { await t.close() }
})

test('unknown paths / methods and store failures answer coarse codes, never raw DB text', async () => {
  const store = memoryStore()
  store.listProducts = async () => { throw new Error('relation "food_product" does not exist at character 15') }
  const logged = []
  const t = await setup({ store, log: (l) => logged.push(l) })
  try {
    assert.deepEqual((await t.call('GET', '/food/nope')).body, { error: 'not_found' })
    assert.equal((await t.call('PATCH', '/food/products/1', { body: {} })).status, 405)
    const r = await t.call('GET', '/food/products')
    assert.equal(r.status, 500)
    assert.deepEqual(r.body, { error: 'internal' })
    assert.doesNotMatch(JSON.stringify(r.body), /relation|food_product/)
    assert.equal(logged.length, 1)
  } finally { await t.close() }
})

test('handle() returns false for non-/food paths so the server keeps routing', async () => {
  const routes = createFoodRoutes({ store: memoryStore(), off: stubOff(), log: () => {} })
  assert.equal(await routes.handle({ method: 'GET', headers: {} }, {}, new URL('http://x/foods')), false)
  assert.equal(await routes.handle({ method: 'GET', headers: {} }, {}, new URL('http://x/sync')), false)
})

test('DNS rebinding: a Host that is not an IP literal, localhost, loop-ingest (the loop-web hop), host.docker.internal or allowlisted -> 421, reads included', async () => {
  const t = await setup({ allowedHosts: ['plan.lan'] })
  try {
    for (const host of ['evil.example', 'evil.example:8090', 'loop-ingest.evil.example', 'plan.lan.evil.example', '192.168.1.10.nip.io', '[::1].evil.example']) {
      const r = await t.rawCall('GET', '/food/products', { host })
      assert.equal(r.status, 421, host)
      assert.deepEqual(r.body, { error: 'misdirected' })
    }
    for (const host of ['192.168.1.10:8090', '127.0.0.1', 'localhost:8088', 'LOCALHOST', 'loop-ingest', 'loop-ingest:8088', 'host.docker.internal:8088', '[::1]:8088', '[fd00::12]', 'plan.lan', 'Plan.Lan:8090']) {
      assert.equal((await t.rawCall('GET', '/food/products', { host })).status, 200, host)
    }
  } finally { await t.close() }
})

test('writes with an Origin header: its host must pass the same check (403 forbidden_origin otherwise); no Origin is fine', async () => {
  const t = await setup()
  try {
    const body = { date: '2030-01-10', meal: 'snack', refType: 'quick', label: 'x', kcal: 10 }
    for (const origin of ['http://evil.example', 'https://evil.example:8090', 'null', 'not a url']) {
      const r = await t.rawCall('POST', '/food/log', { body, headers: { origin } })
      assert.equal(r.status, 403, origin)
      assert.deepEqual(r.body, { error: 'forbidden_origin' })
    }
    assert.equal(t.store.db.log.length, 0)
    assert.equal((await t.rawCall('POST', '/food/log', { body, headers: { origin: 'http://192.168.1.10:8090' } })).status, 201)
    assert.equal((await t.rawCall('POST', '/food/log', { body, headers: { origin: 'http://[fd00::12]:8090' } })).status, 201)
    assert.equal((await t.rawCall('POST', '/food/log', { body })).status, 201)
    assert.equal((await t.rawCall('DELETE', '/food/log/999', { headers: { origin: 'http://evil.example' } })).status, 403)
    assert.equal((await t.rawCall('GET', '/food/products', { headers: { origin: 'http://evil.example' } })).status, 200, 'reads: CORS already hides the answer')
  } finally { await t.close() }
})

test('writes through loop-web: the Origin must be the host nginx was asked for (X-Forwarded-Host) and Sec-Fetch-Site, when sent, same-origin; the SSO tunnel host works', async () => {
  const t = await setup({ allowedHosts: ['plan.example.com'] })
  try {
    const body = { date: '2030-01-10', meal: 'snack', refType: 'quick', label: 'x', kcal: 10 }
    const lan = { 'x-forwarded-host': '192.168.1.10:8090', 'sec-fetch-site': 'same-origin' }
    for (const [headers, why] of [
      [{ ...lan, origin: 'http://192.168.1.20:8090' }, 'another LAN address'],
      [{ ...lan, origin: 'http://192.168.1.10:9999' }, 'another port of the same address'],
      [{ ...lan, origin: 'http://192.168.1.10:8090', 'sec-fetch-site': 'cross-site' }, 'cross-site'],
      [{ ...lan, origin: 'http://192.168.1.10:8090', 'sec-fetch-site': 'same-site' }, 'same-site'],
      [{ 'x-forwarded-host': 'plan.example.com', origin: 'https://evil.example' }, 'tunnel host, foreign origin']
    ]) {
      const r = await t.rawCall('POST', '/food/log', { body, headers })
      assert.deepEqual([r.status, r.body.error], [403, 'forbidden_origin'], why)
    }
    assert.equal((await t.rawCall('DELETE', '/food/log/1', { headers: { ...lan, origin: 'http://192.168.1.20:8090' } })).status, 403)
    assert.equal(t.store.db.log.length, 0)
    assert.equal((await t.rawCall('POST', '/food/log', { body, headers: { ...lan, origin: 'http://192.168.1.10:8090' } })).status, 201, 'the LAN page')
    assert.equal((await t.rawCall('POST', '/food/log', { body, headers: { 'x-forwarded-host': 'plan.example.com', 'sec-fetch-site': 'same-origin', origin: 'https://plan.example.com' } })).status, 201, 'the SSO tunnel')
    assert.equal((await t.rawCall('POST', '/food/log', { body, headers: { 'x-forwarded-host': '192.168.1.10:8090' } })).status, 201, 'curl through nginx (the food-log skill): no Origin')
  } finally { await t.close() }
})

test('numbers are rounded to 1 decimal BEFORE the bounds: 0.04 becomes 0 and is refused where > 0 is required', async () => {
  const t = await setup()
  try {
    assert.deepEqual((await t.call('POST', '/food/products', { body: { ...YOGURT, servingSize: 0.04 } })).body, { error: 'invalid', field: 'servingSize' })
    const ok = await t.call('POST', '/food/products', { body: { ...YOGURT, barcode: null, servingSize: 0.05 } })
    assert.equal(ok.status, 201)
    assert.equal(ok.body.product.servingSize, 0.1)
    assert.deepEqual((await t.call('POST', '/food/products', { body: { ...YOGURT, barcode: null, per100: { ...YOGURT.per100, kcal: 900.04 }, force: true } })).status, 201, '900.04 rounds to 900: within the bound')
    assert.deepEqual((await t.call('POST', '/food/products', { body: { ...YOGURT, barcode: null, per100: { ...YOGURT.per100, kcal: 900.05 }, force: true } })).body, { error: 'invalid', field: 'per100.kcal' })
    const id = ok.body.product.id
    assert.deepEqual((await t.call('POST', '/food/recipes', { body: { name: 'R', kind: 'batch', cookedWeightG: 0.04, ingredients: [{ productId: id, amount: 10 }] } })).body, { error: 'invalid', field: 'cookedWeightG' })
    assert.deepEqual((await t.call('POST', '/food/recipes', { body: { name: 'R', kind: 'serving', servings: 1, ingredients: [{ productId: id, amount: 0.04 }] } })).body, { error: 'invalid', field: 'ingredients.amount' })
    assert.deepEqual((await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'lunch', refType: 'product', refId: id, amount: 0.04, unit: 'g' } })).body, { error: 'invalid', field: 'amount' })
  } finally { await t.close() }
})

test('the food tables failed to migrate: every /food route answers 503 food_unavailable (the rest of the service is untouched)', async () => {
  const t = await setup({ available: () => false })
  try {
    for (const [m, path] of [['GET', '/food/products'], ['GET', '/food/log?date=2030-01-10'], ['GET', '/food/off?q=avena']]) {
      const r = await t.call(m, path)
      assert.equal(r.status, 503, path)
      assert.deepEqual(r.body, { error: 'food_unavailable' })
    }
    assert.equal((await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'snack', refType: 'quick', label: 'x', kcal: 1 } })).status, 503)
    assert.equal(t.off.calls.length, 0)
  } finally { await t.close() }
})

test('idempotent add: a retry with the same requestId returns the existing row (200), never a duplicate', async () => {
  const t = await setup()
  try {
    const body = { date: '2030-01-10', meal: 'snack', refType: 'quick', label: 'Barrita', kcal: 200, requestId: '0b8f7a4e-3c21-4d7e-9a55-1f2e3d4c5b6a' }
    const first = await t.call('POST', '/food/log', { body })
    assert.equal(first.status, 201)
    const again = await t.call('POST', '/food/log', { body })
    assert.equal(again.status, 200)
    assert.equal(again.body.entry.id, first.body.entry.id)
    assert.equal(again.body.totals.count, 1)
    assert.equal(t.store.db.log.length, 1)
    assert.equal((await t.call('POST', '/food/log', { body: { ...body, requestId: 'other-request-0001' } })).status, 201)
    assert.deepEqual((await t.call('POST', '/food/log', { body: { ...body, requestId: 'bad id!' } })).body, { error: 'invalid', field: 'requestId' })
    assert.deepEqual((await t.call('POST', '/food/log', { body: { ...body, requestId: 'short' } })).body, { error: 'invalid', field: 'requestId' })
  } finally { await t.close() }
})

test('a concurrent retry that loses the insert race still answers the winner (200)', async () => {
  const store = memoryStore()
  const insert = store.insertLog
  store.insertLog = async (e) => { await insert(e); return null } // stored, but this call lost the race
  const t = await setup({ store })
  try {
    const r = await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'snack', refType: 'quick', label: 'x', kcal: 5, requestId: 'race-request-0001' } })
    assert.equal(r.status, 200)
    assert.equal(r.body.entry.label, 'x')
  } finally { await t.close() }
})

test('hostAllowed / parseAllowedHosts: literals, local names and the allowlist only', () => {
  assert.equal(hostAllowed(''), false)
  assert.equal(hostAllowed(null), false)
  assert.equal(hostAllowed('10.0.0.5'), true)
  assert.equal(hostAllowed('[fe80::1]'), true)
  assert.equal(hostAllowed('fe80::1'), false, 'a bare v6 address is not a Host value')
  assert.equal(hostAllowed('nas.local'), false)
  assert.equal(hostAllowed('nas.local', parseAllowedHosts(' Plan.Lan, nas.local ')), true)
  assert.deepEqual(parseAllowedHosts(''), [])
  assert.deepEqual(parseAllowedHosts(undefined), [])
})

/* ---------- recipes with basics of the public food DB (a SNAPSHOT per ingredient) ---------- */
const B_BANANA = { basic: 'platano', name: 'Plátano', unit: 'g', amount: 240, per100: { kcal: 88, protein: 0.8, carbs: 22.5, fat: 0.3 } }
const B_EGGS = { basic: 'huevo', name: 'Huevo', unit: 'ud', amount: 2, per100: { kcal: 72, protein: 6.3, carbs: 0.4, fat: 5 } }
const B_BEER = { basic: 'cerveza', name: 'Cerveza', unit: 'ml', amount: 330, per100: { kcal: 47, protein: 0, carbs: 3.6, fat: 0 } }

test('recipes mix products and basics: macros from the label + the snapshots (g per 100, ud per unit), per serving and per batch', async () => {
  const t = await setup()
  try {
    const oats = (await t.call('POST', '/food/products', { body: OATS })).body.product
    const body = { name: 'Tortitas', kind: 'serving', servings: 2, ingredients: [{ productId: oats.id, amount: 80 }, B_BANANA, B_EGGS] }
    const r = await t.call('POST', '/food/recipes', { body })
    assert.equal(r.status, 201)
    assert.equal(r.body.recipe.complete, true)
    assert.deepEqual(r.body.recipe.perServing, { kcal: 326, protein: 12.7, carbs: 50.9, fat: 8.2 })
    assert.deepEqual(r.body.recipe.totals, { kcal: 653, protein: 25.3, carbs: 101.8, fat: 16.3 })
    assert.equal(r.body.recipe.rawWeight, 320)
    assert.deepEqual(r.body.recipe.ingredients, [
      { productId: oats.id, amount: 80, name: 'Copos de avena', unit: 'g' },
      B_BANANA,
      B_EGGS
    ], 'a basic is listed with its name, unit, amount and snapshot')
    assert.deepEqual(t.store.db.recipe[0].ingredients, [{ productId: oats.id, amount: 80 }, B_BANANA, B_EGGS], 'stored exactly as validated')

    const batch = await t.call('POST', '/food/recipes', { body: { name: 'Masa', kind: 'batch', cookedWeightG: 500, ingredients: body.ingredients } })
    assert.deepEqual(batch.body.recipe.per100, { kcal: 131, protein: 5.1, carbs: 20.4, fat: 3.3 })

    const log = await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'breakfast', refType: 'recipe', refId: batch.body.recipe.id, amount: 250, unit: 'g' } })
    assert.equal(log.status, 201)
    assert.deepEqual([log.body.entry.kcal, log.body.entry.protein, log.body.entry.carbs, log.body.entry.fat], [326, 12.7, 50.9, 8.2])

    const list = (await t.call('GET', '/food/recipes')).body.recipes
    assert.equal(list.length, 2)
    assert.ok(list.every((x) => x.complete))
  } finally { await t.close() }
})

test('a recipe of basics only needs no product', async () => {
  const t = await setup()
  try {
    const r = await t.call('POST', '/food/recipes', { body: { name: 'Huevos', kind: 'serving', servings: 1, ingredients: [{ ...B_EGGS, amount: 3 }] } })
    assert.equal(r.status, 201)
    assert.deepEqual(r.body.recipe.perServing, { kcal: 216, protein: 18.9, carbs: 1.2, fat: 15 })
    const e = await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'dinner', refType: 'recipe', refId: r.body.recipe.id, amount: 1, unit: 'serving' } })
    assert.equal(e.body.entry.kcal, 216)
  } finally { await t.close() }
})

test('existing product-only recipes keep working unchanged (stored and listed in the old shape)', async () => {
  const t = await setup()
  try {
    const oats = (await t.call('POST', '/food/products', { body: OATS })).body.product
    // a row written before basics existed
    t.store.db.recipe.push({ id: 500, name: 'Vieja', kind: 'serving', servings: 1, cookedWeightG: null, ingredients: [{ productId: oats.id, amount: 50 }], archived: false, createdAt: null, updatedAt: null })
    const [r] = (await t.call('GET', '/food/recipes')).body.recipes
    assert.deepEqual(r.ingredients, [{ productId: oats.id, amount: 50, name: 'Copos de avena', unit: 'g' }])
    assert.equal(r.perServing.kcal, 186)
    const e = await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'breakfast', refType: 'recipe', refId: 500, amount: 1, unit: 'serving' } })
    assert.equal(e.body.entry.kcal, 186)
  } finally { await t.close() }
})

test('a basic ingredient is validated strictly: key pattern, name, unit, amount, per-100 macros; unknown keys refused', async () => {
  const t = await setup()
  try {
    const recipe = (ing) => ({ name: 'R', kind: 'serving', servings: 1, ingredients: [ing] })
    const cases = [
      [{ ...B_EGGS, extra: 1 }, 'ingredients.extra'],
      [{ ...B_EGGS, productId: 1 }, 'ingredients.productId'],
      [{ ...B_EGGS, basic: 'Huevo' }, 'ingredients.basic'],
      [{ ...B_EGGS, basic: '../etc' }, 'ingredients.basic'],
      [{ ...B_EGGS, basic: 'x'.repeat(65) }, 'ingredients.basic'],
      [{ ...B_EGGS, basic: 7 }, 'ingredients.basic'],
      [{ ...B_EGGS, basic: '' }, 'ingredients.basic'],
      [{ ...B_EGGS, name: '  ' }, 'ingredients.name'],
      [{ ...B_EGGS, name: 'x'.repeat(121) }, 'ingredients.name'],
      [{ ...B_EGGS, unit: 'serving' }, 'ingredients.unit'],
      [{ ...B_EGGS, unit: 'oz' }, 'ingredients.unit'],
      [{ ...B_EGGS, amount: 0 }, 'ingredients.amount'],
      [{ ...B_EGGS, amount: 10001 }, 'ingredients.amount'],
      [{ ...B_EGGS, amount: '2' }, 'ingredients.amount'],
      [{ ...B_EGGS, per100: null }, 'ingredients.per100'],
      [{ ...B_EGGS, per100: [72, 6.3, 0.4, 5] }, 'ingredients.per100'],
      [{ ...B_EGGS, per100: { ...B_EGGS.per100, fibre: 1 } }, 'ingredients.per100.fibre'],
      [{ ...B_EGGS, per100: { ...B_EGGS.per100, kcal: 901 } }, 'ingredients.per100.kcal'],
      [{ ...B_EGGS, per100: { ...B_EGGS.per100, protein: 101 } }, 'ingredients.per100.protein'],
      [{ ...B_EGGS, per100: { ...B_EGGS.per100, fat: -1 } }, 'ingredients.per100.fat'],
      [{ ...B_EGGS, per100: { ...B_EGGS.per100, carbs: null } }, 'ingredients.per100.carbs'],
      [{ ...B_EGGS, per100: { ...B_EGGS.per100, carbs: '0.4' } }, 'ingredients.per100.carbs'],
      [{ ...B_EGGS, per100: { ...B_EGGS.per100, kcal: Infinity } }, 'ingredients.per100.kcal']
    ]
    for (const [ing, field] of cases) {
      const r = await t.call('POST', '/food/recipes', { body: recipe(ing) })
      assert.equal(r.status, 400, field)
      assert.deepEqual(r.body, { error: 'invalid', field }, field)
    }
    assert.equal(t.store.db.recipe.length, 0)
    // a recipe never accepts typed macros, also next to basics
    const typed = await t.call('POST', '/food/recipes', { body: { ...recipe(B_EGGS), perServing: { kcal: 1 } } })
    assert.deepEqual(typed.body, { error: 'invalid', field: 'perServing' })
  } finally { await t.close() }
})

test('a basic snapshot whose kcal disagree with its macros needs force (like a product label); force is never stored', async () => {
  const t = await setup()
  try {
    const body = { name: 'Guiso a la cerveza', kind: 'serving', servings: 4, ingredients: [B_EGGS, B_BEER] }
    const r = await t.call('POST', '/food/recipes', { body })
    assert.deepEqual([r.status, r.body], [400, { error: 'atwater' }])
    assert.deepEqual((await t.call('POST', '/food/recipes', { body: { ...body, force: 'yes' } })).body, { error: 'invalid', field: 'force' })
    const ok = await t.call('POST', '/food/recipes', { body: { ...body, force: true } })
    assert.equal(ok.status, 201)
    assert.equal('force' in t.store.db.recipe[0], false)
    const upd = await t.call('PUT', `/food/recipes/${ok.body.recipe.id}`, { body })
    assert.deepEqual(upd.body, { error: 'atwater' }, 'every save checks again')
  } finally { await t.close() }
})

test('archiving a product of a recipe that mixes basics: the recipe keeps its macros and stays loggable; re-saving it with that product is refused (rules unchanged)', async () => {
  const t = await setup()
  try {
    const oats = (await t.call('POST', '/food/products', { body: OATS })).body.product
    const body = { name: 'Tortitas', kind: 'serving', servings: 2, ingredients: [{ productId: oats.id, amount: 80 }, B_BANANA, B_EGGS] }
    const rec = (await t.call('POST', '/food/recipes', { body })).body.recipe
    assert.equal((await t.call('DELETE', `/food/products/${oats.id}`)).status, 200)
    const [r] = (await t.call('GET', '/food/recipes')).body.recipes
    assert.equal(r.complete, true)
    assert.equal(r.perServing.kcal, 326)
    const e = await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'lunch', refType: 'recipe', refId: rec.id, amount: 1, unit: 'serving' } })
    assert.equal(e.body.entry.kcal, 326)
    assert.deepEqual((await t.call('PUT', `/food/recipes/${rec.id}`, { body })).body, { error: 'unknown_product' })
    const basicsOnly = await t.call('PUT', `/food/recipes/${rec.id}`, { body: { ...body, ingredients: [B_BANANA, B_EGGS] } })
    assert.equal(basicsOnly.status, 200)
  } finally { await t.close() }
})

test('a reasonable recipe of 20 ingredients (products + basics with long names) fits the 16 KB body cap; the cap still applies', async () => {
  const t = await setup()
  try {
    const ids = []
    for (let i = 0; i < 10; i++) ids.push((await t.call('POST', '/food/products', { body: { ...OATS, name: `Producto ${i}` } })).body.product.id)
    const ingredients = []
    for (let i = 0; i < 20; i++) {
      ingredients.push(i % 2
        ? { productId: ids[i >> 1], amount: 1234.5 }
        : { basic: `basico_largo_${i}`, name: 'Pechuga de pollo a la plancha sin piel ' + 'x'.repeat(40), unit: 'g', amount: 1234.5, per100: { kcal: 113.25, protein: 23.45, carbs: 0.05, fat: 1.25 } })
    }
    const body = { name: 'R'.repeat(120), kind: 'batch', cookedWeightG: 19999.5, ingredients, force: true }
    const size = Buffer.byteLength(JSON.stringify(body))
    assert.ok(size < FOOD_BODY_LIMIT / 2, `20 ingredients = ${size} bytes`)
    assert.equal((await t.call('POST', '/food/recipes', { body })).status, 201)
    // even the largest recipe the limits allow (40 basics, every string at its cap) fits
    const worst = { ...body, ingredients: Array.from({ length: 40 }, (_, i) => ({ basic: 'k'.repeat(62) + String(i).padStart(2, '0'), name: 'n'.repeat(120), unit: 'ml', amount: 9999.9, per100: { kcal: 899.99, protein: 99.99, carbs: 99.99, fat: 99.99 } })) }
    assert.ok(Buffer.byteLength(JSON.stringify(worst)) < FOOD_BODY_LIMIT, 'worst case under the cap')
    // over the cap: 413, nothing stored
    const before = t.store.db.recipe.length
    const big = await t.call('POST', '/food/recipes', { body: { ...body, ingredients: [{ ...ingredients[0], name: 'x'.repeat(FOOD_BODY_LIMIT) }] } })
    assert.equal(big.status, 413)
    assert.equal(t.store.db.recipe.length, before)
  } finally { await t.close() }
})

/* ---------- settings (goal + target weight) and the log summary ---------- */
test('settings: GET before any write = nulls; PUT is a partial update; null clears the target', async () => {
  const t = await setup()
  try {
    assert.deepEqual((await t.call('GET', '/food/settings')).body, { settings: { goal: null, targetWeightKg: null, updatedAt: null } })
    let r = await t.call('PUT', '/food/settings', { body: { goal: 'cut' } })
    assert.equal(r.status, 200)
    assert.equal(r.body.settings.goal, 'cut')
    assert.equal(r.body.settings.targetWeightKg, null)
    r = await t.call('PUT', '/food/settings', { body: { targetWeightKg: 72.46 } })
    assert.deepEqual([r.body.settings.goal, r.body.settings.targetWeightKg], ['cut', 72.5], 'goal kept, weight rounded to 1 decimal')
    r = await t.call('PUT', '/food/settings', { body: { targetWeightKg: null } })
    assert.deepEqual([r.body.settings.goal, r.body.settings.targetWeightKg], ['cut', null])
    assert.equal((await t.call('GET', '/food/settings')).body.settings.goal, 'cut')
  } finally { await t.close() }
})

test('settings: strict validation with coarse codes (unknown keys, bad goal, out-of-range weight, empty body)', async () => {
  const t = await setup()
  try {
    const put = async (body) => (await t.call('PUT', '/food/settings', { body })).body
    assert.deepEqual(await put({ goal: 'shred' }), { error: 'invalid', field: 'goal' })
    assert.deepEqual(await put({ goal: null }), { error: 'invalid', field: 'goal' })
    assert.deepEqual(await put({ targetWeightKg: 34.9 }), { error: 'invalid', field: 'targetWeightKg' })
    assert.deepEqual(await put({ targetWeightKg: 250.1 }), { error: 'invalid', field: 'targetWeightKg' })
    assert.deepEqual(await put({ targetWeightKg: '72' }), { error: 'invalid', field: 'targetWeightKg' })
    assert.deepEqual(await put({ weight: 72 }), { error: 'invalid', field: 'weight' })
    assert.deepEqual(await put({}), { error: 'invalid', field: 'body' })
    assert.deepEqual(await put([]), { error: 'invalid', field: 'body' })
    assert.equal(t.store.db.settings, null, 'nothing stored')
    assert.equal((await t.call('POST', '/food/settings', { body: { goal: 'cut' } })).status, 405)
  } finally { await t.close() }
})

test('settings: the food layers apply (X-HC-Food, JSON content type, Origin, Host)', async () => {
  const t = await setup()
  try {
    assert.equal((await t.call('GET', '/food/settings', { headers: { 'x-hc-food': '0' } })).status, 403)
    assert.equal((await t.call('PUT', '/food/settings', { raw: '{"goal":"cut"}', headers: { 'content-type': 'text/plain' } })).status, 415)
    assert.equal((await t.rawCall('PUT', '/food/settings', { body: { goal: 'cut' }, headers: { origin: 'https://evil.example' } })).status, 403)
    assert.equal((await t.rawCall('GET', '/food/settings', { host: 'evil.example' })).status, 421)
    assert.equal(t.store.db.settings, null)
  } finally { await t.close() }
})

test('settings is its own migration group: 503 settings_unavailable alone, and it survives a failed food group', async () => {
  const off = await setup({ settingsAvailable: () => false })
  try {
    assert.deepEqual((await off.call('GET', '/food/settings')).body, { error: 'settings_unavailable' })
    assert.equal((await off.call('PUT', '/food/settings', { body: { goal: 'cut' } })).status, 503)
    assert.equal((await off.call('GET', '/food/products')).status, 200, 'the food log is untouched')
  } finally { await off.close() }
  const noFood = await setup({ available: () => false })
  try {
    assert.equal((await noFood.call('GET', '/food/settings')).status, 200)
    assert.deepEqual((await noFood.call('GET', '/food/log/summary?from=2030-01-01&to=2030-01-10')).body, { error: 'food_unavailable' })
  } finally { await noFood.close() }
})

test('log summary: per-day sums + entries per group from the stored snapshots, inside [from, to]', async () => {
  const t = await setup()
  try {
    const add = (date, meal, kcal, protein = 10) => t.call('POST', '/food/log', { body: { date, meal, refType: 'quick', label: 'x', kcal, protein, carbs: 10, fat: 5, force: true } })
    await add('2030-01-08', 'breakfast', 300)
    await add('2030-01-09', 'breakfast', 400)
    await add('2030-01-09', 'lunch', 700)
    await add('2030-01-09', 'dinner', 600)
    await add('2030-01-09', 'snack', 150, null)
    await add('2030-01-12', 'lunch', 999)
    const r = await t.call('GET', '/food/log/summary?from=2030-01-08&to=2030-01-10')
    assert.equal(r.status, 200)
    assert.deepEqual(r.body, {
      from: '2030-01-08',
      to: '2030-01-10',
      days: [
        { date: '2030-01-08', k: 300, p: 10, c: 10, f: 5, n: 1, missing: { p: false, c: false, f: false }, groups: { breakfast: 1, lunch: 0, dinner: 0, addon: 0 } },
        { date: '2030-01-09', k: 1850, p: 30, c: 40, f: 20, n: 4, missing: { p: true, c: false, f: false }, groups: { breakfast: 1, lunch: 1, dinner: 1, addon: 1 } }
      ]
    })
  } finally { await t.close() }
})

test('log summary: both dates required and real, from <= to, at most 120 days', async () => {
  const t = await setup()
  try {
    const get = async (q) => (await t.call('GET', '/food/log/summary' + q)).body
    assert.deepEqual(await get(''), { error: 'invalid', field: 'from' })
    assert.deepEqual(await get('?from=2030-01-01'), { error: 'invalid', field: 'to' })
    assert.deepEqual(await get('?from=2030-02-31&to=2030-03-01'), { error: 'invalid', field: 'from' })
    assert.deepEqual(await get('?from=2030-01-10&to=2030-01-09'), { error: 'invalid', field: 'to' })
    assert.deepEqual(await get('?from=2030-01-01&to=2030-05-01'), { error: 'invalid', field: 'to' }, '121 days')
    assert.equal((await t.call('GET', '/food/log/summary?from=2030-01-01&to=2030-04-30')).status, 200, '120 days')
    assert.equal((await t.call('DELETE', '/food/log/summary')).status, 405, 'never read as a log id')
  } finally { await t.close() }
})

test('an unknown /food/* path is a 404 even when the food tables are down; a known one is the 503', async () => {
  const t = await setup({ available: () => false, settingsAvailable: () => false })
  try {
    assert.deepEqual((await t.call('GET', '/food/nope')).body, { error: 'not_found' })
    assert.equal((await t.call('GET', '/food/log/summary?from=2030-01-01&to=2030-01-02')).status, 503)
    assert.equal((await t.call('GET', '/food/settings')).status, 503)
  } finally { await t.close() }
})

test('log summary reads are rate limited per client address (429 rate_limited, nothing read)', async () => {
  let reads = 0
  const store = memoryStore()
  const inner = store.listLogRange
  store.listLogRange = (...a) => { reads++; return inner(...a) }
  const t = await setup({ store, summaryLimit: 2 })
  try {
    const q = '/food/log/summary?from=2030-01-01&to=2030-01-02'
    assert.equal((await t.call('GET', q)).status, 200)
    assert.equal((await t.call('GET', q)).status, 200)
    assert.deepEqual((await t.call('GET', q)).body, { error: 'rate_limited' })
    assert.equal(reads, 2)
  } finally { await t.close() }
})

/* ---------- the in-page onboarding profile ---------- */
const cells = (kcal, p, f) => ({ rest: { kcal, p, f }, gym: { kcal: kcal + 350, p, f }, bike: { kcal: kcal + 850, p, f }, bikeLong: { kcal: kcal + 1450, p, f } })
const PROFILE = {
  name: 'Ana', sex: 'female', birthdate: '1997-05-20', heightCm: 165, weightKg: 60, activity: 'light',
  goals: ['maintain', 'cut', 'bulk'],
  targets: { maintain: cells(1800, 108, 48), cut: cells(1550, 120, 48), bulk: cells(1950, 108, 48) }
}

test('profile: GET before any write = null; PUT stores the whole document and returns it', async () => {
  const t = await setup()
  try {
    assert.deepEqual((await t.call('GET', '/food/profile')).body, { profile: null })
    const r = await t.call('PUT', '/food/profile', { body: PROFILE })
    assert.equal(r.status, 200)
    assert.equal(r.body.profile.sex, 'female')
    assert.deepEqual(r.body.profile.targets, PROFILE.targets)
    assert.ok(r.body.profile.updatedAt)
    assert.deepEqual((await t.call('GET', '/food/profile')).body.profile.goals, ['maintain', 'cut', 'bulk'])
    assert.equal('sports' in r.body.profile, false, 'sports are optional')
  } finally { await t.close() }
})

test('profile: sports are stored when well-formed and refused otherwise', async () => {
  const t = await setup()
  try {
    const sports = [{ sport: 'running', minutes: 45, perWeek: 3 }, { sport: 'cycling', minutes: 180, perWeek: 1 }]
    const r = await t.call('PUT', '/food/profile', { body: { ...PROFILE, sports } })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.profile.sports, sports)
    const put = async (s) => (await t.call('PUT', '/food/profile', { body: { ...PROFILE, sports: s } })).body
    assert.deepEqual(await put('running'), { error: 'invalid', field: 'sports' })
    assert.deepEqual(await put([{ sport: 'golf', minutes: 45, perWeek: 3 }]), { error: 'invalid', field: 'sports' })
    assert.deepEqual(await put([{ sport: 'running', minutes: 10, perWeek: 3 }]), { error: 'invalid', field: 'sports' })
    assert.deepEqual(await put([{ sport: 'running', minutes: 45, perWeek: 15 }]), { error: 'invalid', field: 'sports' })
    assert.deepEqual(await put([{ sport: 'running', minutes: 45, perWeek: 3, x: 1 }]), { error: 'invalid', field: 'sports' })
    assert.deepEqual(await put([sports[0], sports[0]]), { error: 'invalid', field: 'sports' })
    assert.deepEqual(t.store.db.profile.sports, sports, 'refusals keep the stored document')
  } finally { await t.close() }
})

test('profile: strict validation with coarse codes; nothing stored on a refusal', async () => {
  const t = await setup()
  try {
    const put = async (patch) => (await t.call('PUT', '/food/profile', { body: { ...PROFILE, ...patch } })).body
    assert.deepEqual(await put({ sex: 'x' }), { error: 'invalid', field: 'sex' })
    assert.deepEqual(await put({ birthdate: '1997-02-30' }), { error: 'invalid', field: 'birthdate' })
    assert.deepEqual(await put({ birthdate: '2015-01-01' }), { error: 'invalid', field: 'birthdate' }, 'under 18')
    assert.deepEqual(await put({ heightCm: 90 }), { error: 'invalid', field: 'heightCm' })
    assert.deepEqual(await put({ weightKg: 300 }), { error: 'invalid', field: 'weightKg' })
    assert.deepEqual(await put({ activity: 'pro' }), { error: 'invalid', field: 'activity' })
    assert.deepEqual(await put({ goals: [] }), { error: 'invalid', field: 'goals' })
    assert.deepEqual(await put({ goals: ['cut', 'shred'] }), { error: 'invalid', field: 'goals' })
    assert.deepEqual(await put({ name: 'x'.repeat(61) }), { error: 'invalid', field: 'name' })
    assert.deepEqual(await put({ extra: 1 }), { error: 'invalid', field: 'extra' })
    assert.deepEqual(await put({ targets: { ...PROFILE.targets, cut: undefined } }), { error: 'invalid', field: 'targets.cut' })
    assert.deepEqual(await put({ targets: { ...PROFILE.targets, cut: { ...PROFILE.targets.cut, rest: { kcal: 500, p: 120, f: 48 } } } }), { error: 'invalid', field: 'targets.cut.rest.kcal' })
    assert.deepEqual(await put({ targets: { ...PROFILE.targets, cut: { ...PROFILE.targets.cut, rest: { kcal: 1550.5, p: 120, f: 48 } } } }), { error: 'invalid', field: 'targets.cut.rest.kcal' })
    assert.deepEqual(await put({ targets: { ...PROFILE.targets, cut: { ...PROFILE.targets.cut, gym: { kcal: 1900, p: 120, f: 48, c: 1 } } } }), { error: 'invalid', field: 'targets.cut.gym.c' })
    assert.equal(t.store.db.profile, null, 'nothing stored')
    assert.equal((await t.call('POST', '/food/profile', { body: PROFILE })).status, 405)
  } finally { await t.close() }
})

test('profile: the food layers apply (X-HC-Food header)', async () => {
  const t = await setup()
  try {
    assert.equal((await t.call('GET', '/food/profile', { headers: { 'x-hc-food': '0' } })).status, 403)
    assert.equal((await t.call('PUT', '/food/profile', { body: PROFILE, headers: { 'x-hc-food': '0' } })).status, 403)
  } finally { await t.close() }
})

test('profile: its own optional group, so a failed 011 migration leaves /food/settings working (and the other way round)', async () => {
  const noProfile = await setup({ profileAvailable: () => false })
  try {
    assert.deepEqual((await noProfile.call('GET', '/food/profile')).body, { error: 'profile_unavailable' })
    assert.equal((await noProfile.call('GET', '/food/profile')).status, 503)
    assert.equal((await noProfile.call('GET', '/food/settings')).status, 200)
  } finally { await noProfile.close() }
  const noSettings = await setup({ settingsAvailable: () => false })
  try {
    assert.equal((await noSettings.call('GET', '/food/settings')).status, 503)
    assert.equal((await noSettings.call('GET', '/food/profile')).status, 200)
  } finally { await noSettings.close() }
})

// U+0000 cannot be stored by Postgres (text 22021, jsonb 22P05): it was a 500. It and the other C0 controls
// (but tab, line feed, carriage return) are refused as 400 invalid, naming the field.
test('text fields refuse U+0000 and the C0 control characters (tab / LF / CR still pass, collapsed to a space)', async () => {
  const t = await setup()
  try {
    for (const bad of ['a\u0000b', 'a\u0001', '\u0007bell', 'a\u000bb', 'a\u000cb', 'esc\u001b[0m', 'a\u001fb']) {
      const p = await t.call('POST', '/food/products', { body: { ...YOGURT, barcode: null, name: bad } })
      assert.deepEqual([p.status, p.body], [400, { error: 'invalid', field: 'name' }], JSON.stringify(bad))
      const l = await t.call('POST', '/food/log', { body: { date: '2030-01-10', meal: 'snack', refType: 'quick', label: bad, kcal: 10 } })
      assert.deepEqual([l.status, l.body], [400, { error: 'invalid', field: 'label' }], JSON.stringify(bad))
      const pr = await t.call('PUT', '/food/profile', { body: { ...PROFILE, name: bad } })
      assert.deepEqual([pr.status, pr.body], [400, { error: 'invalid', field: 'name' }], JSON.stringify(bad))
    }
    assert.equal(t.store.db.product.length, 0)
    const ok = await t.call('POST', '/food/products', { body: { ...YOGURT, barcode: null, name: 'Yogur\tnatural\r\nbio' } })
    assert.equal(ok.status, 201)
    assert.equal(ok.body.product.name, 'Yogur natural bio')
  } finally { await t.close() }
})

test('log: a snapshot too big for the stored columns (kcal NUMERIC(7,1), macros NUMERIC(6,1)) is refused 400 on amount, never a 500', async () => {
  const t = await setup()
  try {
    // within every input limit: a 5000 g serving of a 900 kcal / 100 g food, logged 30 times = 1 350 000 kcal
    const big = (await t.call('POST', '/food/products', { body: { name: 'Big', store: 'other', unit: 'g', per100: { kcal: 900, protein: 0, carbs: 0, fat: 100 }, servingSize: 5000, source: 'manual' } })).body.product
    const base = { date: '2030-01-10', meal: 'lunch', refType: 'product', refId: big.id, unit: 'serving' }
    const r = await t.call('POST', '/food/log', { body: { ...base, amount: 30 } })
    assert.deepEqual([r.status, r.body], [400, { error: 'invalid', field: 'amount' }])
    // kcal fits (22 * 45 000 = 990 000) but fat does not (22 * 5000 g = 110 000 g > 99 999.9)
    assert.deepEqual((await t.call('POST', '/food/log', { body: { ...base, amount: 22 } })).body, { error: 'invalid', field: 'amount' })
    // a large but storable entry still logs (2 servings = 90 000 kcal, 10 000 g fat)
    const ok = await t.call('POST', '/food/log', { body: { ...base, amount: 2 } })
    assert.equal(ok.status, 201)
    assert.equal(ok.body.entry.kcal, 90000)
  } finally { await t.close() }
})
