// The food use cases without HTTP (src/food-usecases.js): the routes are covered over HTTP in food.test.js;
// these pin the use-case contract the routes rely on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFoodService } from '../src/food-usecases.js'

const QUICK = { date: '2026-11-22', meal: 'lunch', refType: 'quick', label: 'Bocadillo', macros: { kcal: 500, protein: null, carbs: null, fat: null }, force: false, requestId: 'req-00000001' }

/** A store holding log rows in memory; `raceOnce` makes the first insert lose to a concurrent retry. */
function logStore ({ raceOnce = false } = {}) {
  const rows = []
  let race = raceOnce
  const save = (e) => { const row = { id: rows.length + 1, ...e }; rows.push(row); return row }
  return {
    rows,
    async getLogByRequest (id) { return rows.find((r) => r.requestId === id) ?? null },
    async insertLog (e) {
      if (race) { race = false; save(e); return null } // the unique request id: another request stored it first
      return save(e)
    },
    async listLog (date) { return rows.filter((r) => r.date === date) },
    async deleteLog (id) { return rows.some((r) => r.id === id) },
    async archiveProduct () { return false },
    async updateProduct () { return null }
  }
}

test('addLog stores a quick entry once and answers a retry with the stored row', async () => {
  const store = logStore()
  const food = createFoodService(store)
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
  const { entry, created, totals } = await createFoodService(store).addLog(QUICK)
  assert.equal(created, false)
  assert.equal(entry.requestId, QUICK.requestId)
  assert.equal(totals.kcal, 500)
  assert.equal(store.rows.length, 1)
})

test('archive, update and delete of a missing row are 404 not_found', async () => {
  const food = createFoodService(logStore())
  for (const run of [() => food.archiveProduct(7), () => food.updateProduct(7, {}), () => food.deleteLog(7)]) {
    await assert.rejects(run, (err) => err.status === 404 && err.code === 'not_found')
  }
})
