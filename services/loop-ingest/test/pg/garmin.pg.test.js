/**
 * The Garmin tables (sql/015_garmin.sql) on a real Postgres with the real migrations: the activity upsert, the
 * planned-workout rows and their retry state, the history flag, the freshness row and the /export/garmin page.
 * No network: Garmin answers are fixtures. Skips without TEST_DATABASE_URL (see pg-helper.js).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { skip, freshDatabase } from './pg-helper.js'
import { createPool, migrate } from '../../src/db.js'
import {
  upsertGarminActivities, newestGarminStartMs, pendingGarminWorkouts, saveGarminWorkout, saveGarminWorkoutFailure,
  listGarminActivities, loadGarminState, saveGarminHistoryComplete
} from '../../src/garmin-db.js'
import { createSyncStatus } from '../../src/status.js'

const quiet = () => {}
/** @type {Awaited<ReturnType<typeof freshDatabase>>} */
let db
/** @type {import('../../src/db.js').Pool} */
let pool
test.before(async () => {
  if (skip) return
  db = await freshDatabase()
  pool = createPool(db.url, { log: quiet })
  const optional = await migrate(pool, quiet)
  assert.equal(optional.garmin, true)
})
test.after(async () => {
  if (skip) return
  await pool.end()
  await db.drop()
})

const ride = (/** @type {number} */ id, /** @type {string} */ gmt, extra = {}) => ({
  activityId: id, activityName: 'Secret name', description: 'notes', startTimeLocal: gmt.replace('08:', '09:'), startTimeGMT: gmt,
  activityType: { typeKey: 'indoor_cycling' }, duration: 3600, movingDuration: 3500, avgPower: 118, normPower: 125, averageHR: 140, maxHR: 170, ...extra
})

test('garmin: upsert (an edit replaces), workouts ok / none / retry, the export rows, the history flag', { skip }, async () => {
  assert.equal(await upsertGarminActivities(pool, [ride(1, '2030-03-01 08:00:00'), ride(2, '2030-03-02 08:00:00'), ride(3, '2030-03-03 08:00:00')]), 3)
  await upsertGarminActivities(pool, [ride(1, '2030-03-01 08:00:00', { avgPower: 120 })])
  assert.equal(await newestGarminStartMs(pool), Date.parse('2030-03-03T08:00:00Z'))

  assert.deepEqual((await pendingGarminWorkouts(pool, 10)).map((p) => p.id), ['3', '2', '1'], 'newest first')
  await saveGarminWorkout(pool, '1', [{ i: 1, intensity: 'ACTIVE', dur_type: 'TIME', dur: 4200, target: 'POWER_3S', low: 125, high: 135, value: null }])
  await saveGarminWorkout(pool, '2', null)
  assert.equal(await saveGarminWorkoutFailure(pool, '3', 1), 'retry')
  assert.deepEqual(await pendingGarminWorkouts(pool, 10), [], 'a fresh retry waits for its back-off')

  const rows = await listGarminActivities(pool, { sinceId: '0', limit: 10 })
  assert.deepEqual(rows[0], {
    id: '1', start_local: '2030-03-01T09:00:00', start_utc: '2030-03-01T08:00:00Z', type: 'indoor_cycling', duration_s: 3600,
    avg_power: 120, norm_power: 125, avg_hr: 140, max_hr: 170, plan_status: 'ok',
    plan: { steps: [{ i: 1, intensity: 'ACTIVE', dur_type: 'TIME', dur: 4200, target: 'POWER_3S', low: 125, high: 135, value: null }] }
  })
  assert.deepEqual(rows.map((r) => [r.id, r.plan_status]), [['1', 'ok'], ['2', 'none'], ['3', 'pending']])
  assert.ok(!JSON.stringify(rows).includes('Secret') && !JSON.stringify(rows).includes('notes'))
  assert.deepEqual((await listGarminActivities(pool, { sinceId: '1', limit: 1 })).map((r) => r.id), ['2'])

  assert.equal((await loadGarminState(pool)).historyComplete, false)
  await saveGarminHistoryComplete(pool)
  assert.equal((await loadGarminState(pool)).historyComplete, true)
})

test('garmin status: the freshness row persists and a fresh status loads it back', { skip }, async () => {
  const s = createSyncStatus({ pool, stravaConfigured: false, garminConfigured: true, log: quiet })
  await s.recordGarminError('garmin_auth')
  const t = createSyncStatus({ pool, stravaConfigured: false, garminConfigured: true, log: quiet })
  await t.load()
  const snap = await t.snapshot()
  assert.equal(snap.lastGarminError, 'garmin_auth')
  assert.equal(snap.lastStravaError, null)
})
