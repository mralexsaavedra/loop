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

test('migration 006_food.sql is registered last and is idempotent', async () => {
  // db.js loads pg, which the test run does not install: read its migration list as text
  const db = await readFile(fileURLToPath(new URL('../src/db.js', import.meta.url)), 'utf8')
  assert.match(db, /'005_athlete_refresh\.sql', '006_food\.sql'\]/)
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
