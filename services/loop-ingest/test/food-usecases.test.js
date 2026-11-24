// The food use cases without HTTP (src/food-usecases.js): the routes are covered over HTTP in food.test.js;
// these pin the use-case contract the routes rely on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFoodService } from '../src/food-usecases.js'

/** @typedef {import('../src/http.js').HttpError} HttpError */
/** @typedef {import('../src/food-db.js').FoodStore} FoodStore */
/** A stored log row as the fake keeps it. @typedef {{ id: number } & Record<string, unknown>} Row */

/** @type {import('../src/food-validate.js').LogInput} */
const QUICK = { date: '2026-11-22', meal: 'lunch', refType: 'quick', label: 'Bocadillo', macros: { kcal: 500, protein: null, carbs: null, fat: null }, force: false, requestId: 'req-00000001' }

/** A store holding log rows in memory; `raceOnce` makes the first insert lose to a concurrent retry. */
function logStore ({ raceOnce = false } = {}) {
  /** @type {Row[]} */
  const rows = []
  let race = raceOnce
  const save = (/** @type {object} */ e) => { const row = { id: rows.length + 1, ...e }; rows.push(row); return row }
  return {
    rows,
    /** @param {string} id */
    async getLogByRequest (id) { return rows.find((r) => r.requestId === id) ?? null },
    /** @param {object} e */
    async insertLog (e) {
      if (race) { race = false; save(e); return null } // the unique request id: another request stored it first
      return save(e)
    },
    /** @param {string} date */
    async listLog (date) { return rows.filter((r) => r.date === date) },
    /** @param {number} id */
    async deleteLog (id) { return rows.some((r) => r.id === id) },
    async archiveProduct () { return false },
    async updateProduct () { return null }
  }
}
/** The fake holds only the log methods the use cases under test call. @param {ReturnType<typeof logStore>} store */
const asStore = (store) => /** @type {FoodStore} */ (/** @type {unknown} */ (store))

test('addLog stores a quick entry once and answers a retry with the stored row', async () => {
  const store = logStore()
  const food = createFoodService(asStore(store))
  const first = await food.addLog(QUICK)
  assert.equal(first.created, true)
  assert.equal(first.entry.label, 'Bocadillo')
  assert.equal(first.totals.kcal, 500)
  const retry = await food.addLog(QUICK)
  assert.equal(retry.created, false)
  assert.equal(retry.entry.id, first.entry.id)
  assert.equal(store.rows.length, 1)
})

test('addLog answers the winning row when a concurrent retry stored it first', async () => {
  const store = logStore({ raceOnce: true })
  const { entry, created, totals } = await createFoodService(asStore(store)).addLog(QUICK)
  assert.equal(created, false)
  assert.equal(entry.requestId, QUICK.requestId)
  assert.equal(totals.kcal, 500)
  assert.equal(store.rows.length, 1)
})

test('archive, update and delete of a missing row are 404 not_found', async () => {
  const food = createFoodService(asStore(logStore()))
  for (const run of [() => food.archiveProduct(7), () => food.updateProduct(7, /** @type {import('../src/food-validate.js').ProductInput} */ ({})), () => food.deleteLog(7)]) {
    await assert.rejects(run, (/** @type {HttpError} */ err) => err.status === 404 && err.code === 'not_found')
  }
})
