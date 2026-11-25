import test from 'node:test'
import assert from 'node:assert/strict'
import {
  upsertGarminActivities, newestGarminStartMs, pendingGarminWorkouts, saveGarminWorkout, saveGarminWorkoutFailure,
  listGarminActivities, toExportRow
} from '../src/garmin-db.js'

/** @typedef {{ sql: string, values: readonly unknown[] }} Call */
/** A fake pool + client that records every statement and answers `rows` to SELECTs. @param {any[]} [rows] */
function fakePool (rows = []) {
  /** @type {Call[]} */
  const calls = []
  let released = 0
  const query = async (/** @type {string} */ sql, /** @type {readonly unknown[]} */ values = []) => {
    calls.push({ sql, values })
    return { rows: /^\s*SELECT/.test(sql) ? rows : [], rowCount: 0 }
  }
  const pool = /** @type {any} */ ({ calls, query, connect: async () => ({ query, release: () => { released++ } }), released: () => released })
  return pool
}

test('upsert: one transaction, the Contract columns from the summary, the summary as payload; invalid rows skipped', async () => {
  const pool = fakePool()
  const n = await upsertGarminActivities(pool, [
    { activityId: 7, activityName: 'Name', startTimeLocal: '2030-03-01 09:00:00', startTimeGMT: '2030-03-01 08:00:00', activityType: { typeKey: 'indoor_cycling' }, duration: 3600.5, movingDuration: 3500, avgPower: 118, normPower: 125, averageHR: 140, maxHR: 170 },
    { activityId: 'x', startTimeLocal: '2030-03-01 09:00:00', startTimeGMT: '2030-03-01 08:00:00' },
    { activityId: 8, startTimeLocal: 'bad', startTimeGMT: '2030-03-01 08:00:00' }
  ])
  assert.equal(n, 1)
  const sqls = pool.calls.map((/** @type {Call} */ c) => c.sql.trim().split('\n')[0])
  assert.equal(sqls[0], 'BEGIN')
  assert.equal(sqls.at(-1), 'COMMIT')
  const insert = pool.calls.find((/** @type {Call} */ c) => /INSERT INTO garmin_activity/.test(c.sql))
  assert.deepEqual(insert.values.slice(0, 10), ['7', '2030-03-01T09:00:00', '2030-03-01T08:00:00Z', 'indoor_cycling', 3600.5, 3500, 118, 125, 140, 170])
  assert.equal(JSON.parse(String(insert.values[10])).activityName, 'Name', 'the summary is kept for later phases')
  assert.equal(pool.released(), 1)
})

test('upsert: a failing statement rolls back and rethrows', async () => {
  const pool = fakePool()
  const failing = { ...pool, connect: async () => ({ query: async (/** @type {string} */ sql) => { if (/INSERT/.test(sql)) throw new Error('db'); return { rows: [] } }, release: () => {} }) }
  await assert.rejects(upsertGarminActivities(failing, [{ activityId: 1, startTimeLocal: '2030-03-01 09:00:00', startTimeGMT: '2030-03-01 08:00:00' }]), /db/)
})

test('newest start: MAX(start_utc) as epoch ms, null when empty', async () => {
  assert.equal(await newestGarminStartMs(fakePool([{ newest: new Date('2030-03-01T08:00:00Z') }])), Date.parse('2030-03-01T08:00:00Z'))
  assert.equal(await newestGarminStartMs(fakePool([{ newest: null }])), null)
})

test('workouts: pending = no row or a due retry, newest first; ok/none/retry/failed are stored', async () => {
  const pool = fakePool([{ id: '9', attempts: 2 }])
  assert.deepEqual(await pendingGarminWorkouts(pool, 50), [{ id: '9', attempts: 2 }])
  assert.match(pool.calls[0].sql, /LEFT JOIN garmin_activity_workout/)
  assert.match(pool.calls[0].sql, /status = 'retry'/)
  assert.match(pool.calls[0].sql, /ORDER BY a\.start_utc DESC/)
  assert.equal(pool.calls[0].values[0], 50)

  const w = fakePool()
  await saveGarminWorkout(w, '9', /** @type {any} */ ([{ i: 1 }]))
  await saveGarminWorkout(w, '10', null)
  assert.deepEqual(w.calls[0].values, ['9', 'ok', '[{"i":1}]'])
  assert.deepEqual(w.calls[1].values, ['10', 'none', null])
  assert.equal(await saveGarminWorkoutFailure(w, '11', 1), 'retry')
  assert.equal(await saveGarminWorkoutFailure(w, '11', 5), 'failed')
})

test('export query: parameterized, ascending by id, never a name or the payload', async () => {
  const pool = fakePool([])
  await listGarminActivities(pool, { sinceId: '10', limit: 5 })
  const { sql, values } = pool.calls[0]
  assert.deepEqual(values, ['10', 5])
  assert.match(sql, /a\.id > \$1/)
  assert.match(sql, /ORDER BY a\.id ASC/)
  assert.match(sql, /LIMIT \$2/)
  assert.doesNotMatch(sql, /payload|name|notes|SELECT \*/i)
})

test('export row: exactly the Contract shape; plan only when ok; pending when no answer yet or retrying', () => {
  const base = { id: '7', start_local: '2030-03-01T09:00:00', start_utc: '2030-03-01T08:00:00Z', type: 'indoor_cycling', duration_s: 3600, avg_power: 118, norm_power: 125, avg_hr: 140, max_hr: 170 }
  const steps = [{ i: 1, intensity: 'ACTIVE', dur_type: 'TIME', dur: 4200, target: 'POWER_3S', low: 125, high: 135, value: null }]
  const ok = toExportRow({ ...base, plan_status: 'ok', steps })
  assert.deepEqual(Object.keys(ok), ['id', 'start_local', 'start_utc', 'type', 'duration_s', 'avg_power', 'norm_power', 'avg_hr', 'max_hr', 'plan_status', 'plan'])
  assert.deepEqual(ok.plan, { steps })
  assert.equal(ok.plan_status, 'ok')
  assert.deepEqual(toExportRow({ ...base, plan_status: 'none', steps: null }).plan, null)
  assert.equal(toExportRow({ ...base, plan_status: null, steps: null }).plan_status, 'pending')
  assert.equal(toExportRow({ ...base, plan_status: 'retry', steps: null }).plan_status, 'pending')
  assert.equal(toExportRow({ ...base, plan_status: 'failed', steps: null }).plan_status, 'none')
  // a stored step carrying an unexpected field (a name) never reaches the export
  const leaky = toExportRow({ ...base, plan_status: 'ok', steps: [{ ...steps[0], notes: 'coach', stepName: 'x' }] })
  assert.ok(!JSON.stringify(leaky).includes('coach') && !JSON.stringify(leaky).includes('stepName'))
  // numbers: null when absent or not numeric
  assert.equal(toExportRow({ ...base, avg_power: null, plan_status: 'none', steps: null }).avg_power, null)
})
