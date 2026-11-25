import test from 'node:test'
import assert from 'node:assert/strict'
import { createGarminSync, startGarminLoop, OVERLAP_DAYS, WORKOUTS_PER_RUN } from '../src/garmin-sync.js'
import { TOKEN_PATH, ACTIVITIES_PATH } from '../src/garmin.js'

const KEY = 'gk-secret-key-0123456789abcdef'
const ENV = { GARMIN_API_KEY: KEY, GARMIN_BASE_URL: 'https://garmin.test' }
const NEWEST = Date.parse('2030-03-01T08:00:00Z')
const quiet = () => {}

/** @param {number} status @param {unknown} body */
function reply (status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return /** @type {Response} */ (/** @type {unknown} */ ({ ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) }))
}

/** In-memory stand-in for garmin-db.js. @param {{ historyComplete?: boolean, newest?: number | null, pending?: { id: string, attempts: number }[] }} [seed] */
function fakeDb ({ historyComplete = false, newest = null, pending = [] } = {}) {
  /** @type {string[]} */
  const events = []
  /** @type {any[]} */
  const stored = []
  const db = {
    events,
    stored,
    historyComplete,
    loadGarminState: async () => ({ historyComplete: db.historyComplete, okAt: null, error: null, errorAt: null }),
    newestGarminStartMs: async () => newest,
    upsertGarminActivities: async (/** @type {any} */ _pool, /** @type {any[]} */ batch) => { stored.push(...batch); return batch.length },
    saveGarminHistoryComplete: async () => { db.historyComplete = true; events.push('history_complete') },
    pendingGarminWorkouts: async (/** @type {any} */ _pool, /** @type {number} */ limit) => { events.push(`pending ${limit}`); return pending },
    saveGarminWorkout: async (/** @type {any} */ _pool, /** @type {string} */ id, /** @type {any} */ steps) => { events.push(`workout ${id} ${steps ? 'ok' : 'none'}`) },
    saveGarminWorkoutFailure: async (/** @type {any} */ _pool, /** @type {string} */ id, /** @type {number} */ attempts) => { events.push(`workout ${id} retry ${attempts}`); return /** @type {'retry'} */ ('retry') }
  }
  return db
}

function fakeStatus () {
  /** @type {string[]} */
  const events = []
  return {
    events,
    recordGarminOk: async () => { events.push('ok') },
    recordGarminError: async (/** @type {string} */ code) => { events.push(`error: ${code}`) }
  }
}

/** @param {(url: URL) => Response} route */
function fetchVia (route) {
  /** @type {URL[]} */
  const calls = []
  const fetchImpl = /** @type {typeof fetch} */ (/** @type {unknown} */ (async (/** @type {URL} */ url) => {
    const u = new URL(String(url))
    calls.push(u)
    return u.pathname === TOKEN_PATH ? reply(200, 'tok') : route(u)
  }))
  return { fetchImpl, calls }
}

test('first run walks the whole history and marks it complete; a later run re-reads only the 7-day overlap', async () => {
  const acts = [{ activityId: 3, startTimeGMT: '2030-03-01 08:00:00', startTimeLocal: '2030-03-01 09:00:00' }]
  const f = fetchVia(() => reply(200, acts))
  const db = fakeDb({ newest: NEWEST })
  const status = fakeStatus()
  const sync = createGarminSync(/** @type {any} */ ({}), ENV, { status, fetchImpl: f.fetchImpl, db, log: quiet })
  assert.deepEqual(await sync.runOnce(), { count: 1, sinceMs: null })
  await sync.backfillIdle()
  assert.ok(db.events.includes('history_complete'))
  assert.deepEqual(status.events, ['ok'])

  const r = await sync.runOnce()
  assert.equal(r.sinceMs, NEWEST - OVERLAP_DAYS * 86_400_000)
  assert.equal(OVERLAP_DAYS, 7)
  assert.ok(f.calls.some((u) => u.pathname === ACTIVITIES_PATH && u.searchParams.get('start') === '0'))
})

test('a refused key is recorded as garmin_auth, the error rethrown without the key, no backfill', async () => {
  const fetchImpl = /** @type {typeof fetch} */ (/** @type {unknown} */ (async () => reply(401, '')))
  const db = fakeDb()
  const status = fakeStatus()
  const sync = createGarminSync(/** @type {any} */ ({}), ENV, { status, fetchImpl, db, log: quiet })
  await assert.rejects(sync.runOnce(), (/** @type {Error} */ err) => !err.message.includes(KEY))
  await sync.backfillIdle()
  assert.deepEqual(status.events, ['error: garmin_auth'])
  assert.ok(!db.events.some((e) => e.startsWith('pending')), 'no backfill after a failed run')
})

test('concurrent callers share one run (the loop, POST /sync and POST /sync/garmin never overlap)', async () => {
  let pages = 0
  const f = fetchVia(() => { pages++; return reply(200, []) })
  const sync = createGarminSync(/** @type {any} */ ({}), ENV, { status: fakeStatus(), fetchImpl: f.fetchImpl, db: fakeDb(), log: quiet })
  await Promise.all([sync.runOnce(), sync.runOnce()])
  assert.equal(pages, 1)
})

test('backfill after an ok run: a plan -> ok, an empty answer -> none, a failure -> retry with attempts + 1; capped per run', async () => {
  const pending = [{ id: '1', attempts: 0 }, { id: '2', attempts: 0 }, { id: '3', attempts: 2 }]
  const f = fetchVia((u) => {
    if (u.pathname === ACTIVITIES_PATH) return reply(200, [])
    if (u.pathname === '/activity-service/activity/1/workouts') return reply(200, [{ workoutName: 'n', steps: [{ stepIndex: 1, intensity: 'ACTIVE', durationType: 'TIME', durationValue: 60 }] }])
    if (u.pathname === '/activity-service/activity/2/workouts') return reply(200, [])
    return reply(500, '')
  })
  const db = fakeDb({ pending })
  const sync = createGarminSync(/** @type {any} */ ({}), ENV, { status: fakeStatus(), fetchImpl: f.fetchImpl, db, log: quiet })
  await sync.runOnce()
  const result = await sync.backfillIdle()
  assert.deepEqual(db.events.filter((e) => e !== 'history_complete'), [`pending ${WORKOUTS_PER_RUN}`, 'workout 1 ok', 'workout 2 none', 'workout 3 retry 3'])
  assert.deepEqual(result, { fetched: 3, stored: 2, retried: 1, stop: null })
  assert.equal(WORKOUTS_PER_RUN, 50)
})

test('backfill: a refused token or a rate limit stops the batch without recording that activity', async () => {
  for (const status of [403, 429]) {
    const f = fetchVia((u) => u.pathname === ACTIVITIES_PATH ? reply(200, []) : reply(status, ''))
    const db = fakeDb({ pending: [{ id: '1', attempts: 0 }, { id: '2', attempts: 0 }] })
    const sync = createGarminSync(/** @type {any} */ ({}), ENV, { status: fakeStatus(), fetchImpl: f.fetchImpl, db, log: quiet })
    await sync.runOnce()
    const result = await sync.backfillIdle()
    assert.deepEqual(db.events.filter((e) => e.startsWith('workout')), [], String(status))
    assert.equal(result?.stop, status === 429 ? 'rate_limited' : 'failed')
  }
})

test('the loop logs counts, never throws, and keeps running after a failure', async () => {
  /** @type {string[]} */
  const lines = []
  let calls = 0
  const loop = startGarminLoop({ runOnce: async () => { calls++; if (calls === 1) throw Object.assign(new Error('garmin token refused: 401'), { garminAuth: true }); return { count: 4 } } }, { intervalMinutes: 60, log: (l) => lines.push(l) })
  await new Promise((resolve) => setImmediate(resolve))
  await loop.tick()
  loop.stop()
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [
    { event: 'garmin_sync_failed', code: 'garmin_auth' },
    { event: 'garmin_sync', activities: 4 }
  ])
})
