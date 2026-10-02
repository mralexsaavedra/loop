import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createFoodStore } from '../src/food-db.js'

function fakePool (handler = () => ({ rows: [] })) {
  const calls = []
  return { calls, query: async (sql, values) => { calls.push({ sql, values }); return handler(sql, values) } }
}

const PRODUCT_ROW = {
  id: '7', name: 'Yogur', brand: null, store: 'mercadona', barcode: '8480000123456', unit: 'g',
  kcal_100: '60.0', protein_100: '10.0', carbs_100: '4.0', fat_100: '0.2', serving_size: '125.0',
  source: 'label', off_code: null, archived: false,
  created_at: new Date('2030-01-10T10:00:00Z'), updated_at: new Date('2030-01-10T11:00:00Z')
}

test('migration 006_food.sql is registered (as the optional food group) and is idempotent', async () => {
  // db.js loads pg, which the test run does not install: read its migration list as text
  const db = await readFile(fileURLToPath(new URL('../src/db.js', import.meta.url)), 'utf8')
  assert.match(db, /'005_athlete_refresh\.sql'\]/)
  assert.match(db, /OPTIONAL_MIGRATIONS = \{ food: \['006_food\.sql'\], settings: \['007_settings\.sql'\] \}/, 'the food tables and the settings are isolated, optional groups')
  const sql = await readFile(fileURLToPath(new URL('../sql/006_food.sql', import.meta.url)), 'utf8')
  for (const table of ['food_product', 'food_recipe', 'food_log']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`))
  }
  assert.doesNotMatch(sql, /CREATE TABLE (?!IF NOT EXISTS)/)
  assert.doesNotMatch(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/)
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON food_product \(barcode\) WHERE barcode IS NOT NULL AND NOT archived/)
  assert.match(sql, /store\s+IN \('mercadona', 'dia', 'eroski', 'other'\)/)
  assert.match(sql, /meal\s+IN \('breakfast', 'lunch', 'preworkout', 'postworkout', 'dinner', 'snack'\)/)
})

test('products map numeric strings to numbers and dates to ISO', async () => {
  const pool = fakePool(() => ({ rows: [PRODUCT_ROW] }))
  const [p] = await createFoodStore(pool).listProducts()
  assert.deepEqual(p, {
    id: 7, name: 'Yogur', brand: null, store: 'mercadona', barcode: '8480000123456', unit: 'g',
    per100: { kcal: 60, protein: 10, carbs: 4, fat: 0.2 }, servingSize: 125, source: 'label', offCode: null,
    archived: false, createdAt: '2030-01-10T10:00:00.000Z', updatedAt: '2030-01-10T11:00:00.000Z'
  })
  assert.match(pool.calls[0].sql, /WHERE NOT archived/)
})

test('insertProduct is parameterized; a unique violation becomes 409 barcode_exists', async () => {
  const pool = fakePool(() => ({ rows: [PRODUCT_ROW] }))
  const store = createFoodStore(pool)
  await store.insertProduct({ name: "O'Brien", brand: null, store: 'dia', barcode: null, unit: 'g', per100: { kcal: 1, protein: 0, carbs: 0, fat: 0 }, servingSize: null, source: 'manual', offCode: null })
  assert.doesNotMatch(pool.calls[0].sql, /O'Brien/)
  assert.ok(pool.calls[0].values.includes("O'Brien"))

  const dup = createFoodStore(fakePool(() => { throw Object.assign(new Error('duplicate key value violates unique constraint "food_product_barcode_uq"'), { code: '23505' }) }))
  await assert.rejects(dup.insertProduct({ name: 'x', store: 'dia', unit: 'g', per100: { kcal: 1, protein: 0, carbs: 0, fat: 0 }, source: 'manual' }),
    (e) => e.status === 409 && e.code === 'barcode_exists')
})

test('archive only touches an active row and reports whether it did', async () => {
  const pool = fakePool(() => ({ rowCount: 0, rows: [] }))
  assert.equal(await createFoodStore(pool).archiveProduct(3), false)
  assert.match(pool.calls[0].sql, /UPDATE food_product SET archived = true.*WHERE id = \$1 AND NOT archived/s)
})

test('recipes keep ingredients as JSON; log rows come back with a YYYY-MM-DD date string', async () => {
  const pool = fakePool((sql) => {
    if (/FROM food_recipe/.test(sql)) return { rows: [{ id: '2', name: 'R', kind: 'batch', servings: null, cooked_weight_g: '1000.0', ingredients: [{ productId: 7, amount: 300 }], archived: false, created_at: new Date(0), updated_at: new Date(0) }] }
    return { rows: [{ id: '9', date: '2030-01-10', meal: 'lunch', ref_type: 'quick', ref_id: null, label: 'X', amount: '1.0', unit: 'serving', kcal: '250.0', protein: null, carbs: '30.5', fat: null, created_at: new Date(0) }] }
  })
  const store = createFoodStore(pool)
  const [r] = await store.listRecipes()
  assert.deepEqual([r.id, r.kind, r.servings, r.cookedWeightG, r.ingredients], [2, 'batch', null, 1000, [{ productId: 7, amount: 300 }]])
  const [e] = await store.listLog('2030-01-10')
  assert.deepEqual([e.id, e.date, e.refType, e.refId, e.amount, e.kcal, e.protein, e.carbs], [9, '2030-01-10', 'quick', null, 1, 250, null, 30.5])
  const logSql = pool.calls.at(-1).sql
  assert.match(logSql, /to_char\(date, 'YYYY-MM-DD'\) AS date/)
  assert.match(logSql, /ORDER BY created_at, id/)
  assert.deepEqual(pool.calls.at(-1).values, ['2030-01-10'])
})

test('insertLog is idempotent on the request id (ON CONFLICT DO NOTHING -> null); getLogByRequest finds the stored row', async () => {
  const pool = fakePool(() => ({ rows: [] }))
  const store = createFoodStore(pool)
  const r = await store.insertLog({ date: '2030-01-10', meal: 'snack', refType: 'quick', label: 'x', amount: 1, unit: 'serving', kcal: 1, protein: null, carbs: null, fat: null, requestId: 'abc-12345' })
  assert.equal(r, null)
  assert.match(pool.calls[0].sql, /ON CONFLICT \(request_id\) WHERE request_id IS NOT NULL DO NOTHING/)
  assert.equal(pool.calls[0].values.at(-1), 'abc-12345')
  await store.getLogByRequest('abc-12345')
  assert.match(pool.calls[1].sql, /WHERE request_id = \$1/)
  const sql = await readFile(fileURLToPath(new URL('../sql/006_food.sql', import.meta.url)), 'utf8')
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS food_log_request_uq ON food_log \(request_id\) WHERE request_id IS NOT NULL/)
})

test('recipe ingredients: a basic snapshot comes back with its key, name, unit, amount and per-100 macros; a product row is unchanged', async () => {
  const egg = { basic: 'huevo', name: 'Huevo', unit: 'ud', amount: '2', per100: { kcal: 72, protein: '6.3', carbs: 0.4, fat: 5 } }
  const pool = fakePool(() => ({ rows: [{ id: '3', name: 'Tortilla', kind: 'serving', servings: 2, cooked_weight_g: null, ingredients: [{ productId: '7', amount: 300 }, egg], archived: false, created_at: new Date(0), updated_at: new Date(0) }] }))
  const store = createFoodStore(pool)
  const [r] = await store.listRecipes()
  assert.deepEqual(r.ingredients, [
    { productId: 7, amount: 300 },
    { basic: 'huevo', name: 'Huevo', unit: 'ud', amount: 2, per100: { kcal: 72, protein: 6.3, carbs: 0.4, fat: 5 } }
  ])
  await store.insertRecipe({ name: 'Tortilla', kind: 'serving', servings: 2, cookedWeightG: null, ingredients: r.ingredients })
  assert.deepEqual(JSON.parse(pool.calls.at(-1).values[4]), r.ingredients, 'stored as given (JSONB, no migration)')
})

test('migration 007_settings.sql: one idempotent settings row, goal + target weight constrained like the API', async () => {
  const sql = await readFile(fileURLToPath(new URL('../sql/007_settings.sql', import.meta.url)), 'utf8')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS app_settings\b/)
  assert.doesNotMatch(sql, /CREATE TABLE (?!IF NOT EXISTS)/)
  assert.match(sql, /CHECK \(id = 1\)/, 'one row')
  assert.match(sql, /goal IN \('maintain', 'cut', 'bulk'\)/)
  assert.match(sql, /target_weight_kg BETWEEN 35 AND 250/)
})

test('settings: no row yet = every field null; a row maps NUMERIC to a number', async () => {
  const empty = fakePool(() => ({ rows: [] }))
  assert.deepEqual(await createFoodStore(empty).getSettings(), { goal: null, targetWeightKg: null, updatedAt: null })
  assert.match(empty.calls[0].sql, /FROM app_settings WHERE id = 1/)
  const pool = fakePool(() => ({ rows: [{ goal: 'cut', target_weight_kg: '72.5', updated_at: new Date('2030-01-10T10:00:00Z') }] }))
  assert.deepEqual(await createFoodStore(pool).getSettings(), { goal: 'cut', targetWeightKg: 72.5, updatedAt: '2030-01-10T10:00:00.000Z' })
})

test('updateSettings: a parameterized partial upsert, only the keys sent change', async () => {
  const pool = fakePool(() => ({ rows: [{ goal: 'cut', target_weight_kg: null, updated_at: new Date('2030-01-10T10:00:00Z') }] }))
  const store = createFoodStore(pool)
  await store.updateSettings({ goal: 'cut' })
  assert.match(pool.calls[0].sql, /INSERT INTO app_settings \(id, goal, target_weight_kg\) VALUES \(1, \$1, \$2\)/)
  assert.match(pool.calls[0].sql, /ON CONFLICT \(id\) DO UPDATE/)
  assert.deepEqual(pool.calls[0].values, ['cut', null, true, false])
  await store.updateSettings({ targetWeightKg: null })
  assert.deepEqual(pool.calls[1].values, [null, null, false, true], 'clearing the target sends it')
  await store.updateSettings({ goal: 'bulk', targetWeightKg: 80 })
  assert.deepEqual(pool.calls[2].values, ['bulk', 80, true, true])
})

test('listLogRange: entries between two dates, oldest first, dates as text', async () => {
  const pool = fakePool(() => ({ rows: [{ id: '3', date: '2030-01-09', meal: 'lunch', ref_type: 'quick', ref_id: null, label: 'x', amount: '1.0', unit: 'serving', kcal: '500.0', protein: null, carbs: '50.0', fat: '10.0', request_id: null, created_at: new Date('2030-01-09T12:00:00Z') }] }))
  const rows = await createFoodStore(pool).listLogRange('2030-01-01', '2030-01-10')
  assert.match(pool.calls[0].sql, /WHERE date BETWEEN \$1::date AND \$2::date ORDER BY date, created_at, id/)
  assert.deepEqual(pool.calls[0].values, ['2030-01-01', '2030-01-10'])
  assert.equal(rows[0].date, '2030-01-09')
  assert.equal(rows[0].kcal, 500)
  assert.equal(rows[0].protein, null)
})
