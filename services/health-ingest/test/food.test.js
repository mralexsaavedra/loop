import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createFoodRoutes, FOOD_BODY_LIMIT } from '../src/food.js'

/** In-memory stand-in for src/food-db.js createFoodStore (same method contract). */
function memoryStore () {
  const db = { product: [], recipe: [], log: [] }
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
    async insertLog (e) {
      const row = { id: ++seq, ...clone(e), createdAt: stamp() }
      db.log.push(row)
      return clone(row)
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

async function setup ({ store = memoryStore(), off = stubOff(), writeLimit, log = () => {} } = {}) {
  const routes = createFoodRoutes({ store, off, writeLimit, log })
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
  return { store, off, call, close: () => new Promise((resolve) => server.close(resolve)) }
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
