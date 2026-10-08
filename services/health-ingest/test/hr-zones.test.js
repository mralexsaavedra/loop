import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  hrHistogram, fetchHrStreams, streamBudget, createHrBackfill, BATCH_PER_RUN, WINDOW_MAX, DAY_MAX, MAX_GAP_S,
  STREAMS_TIMEOUT_MS, MAX_ATTEMPTS, BACKOFF_BASE_MIN, BACKOFF_CAP_MIN
} from '../src/hr-zones.js'

const streams = (time, heartrate) => ({ time: { data: time }, heartrate: { data: heartrate } })
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })

test('hrHistogram: each sample owns the time until the next; the last sample adds nothing', () => {
  const h = hrHistogram(streams([0, 1, 3, 6], [100, 100.4, 150, 190]))
  assert.deepEqual(h, { hist: { 100: 3, 150: 3 }, seconds: 6 })
})

test('hrHistogram: a gap over MAX_GAP_S (pause / dropout) and a non-increasing time add nothing', () => {
  const h = hrHistogram(streams([0, 5, 5 + MAX_GAP_S + 1, 5 + MAX_GAP_S + 1, 5 + MAX_GAP_S + 3], [120, 130, 140, 141, 142]))
  // 0->5 at 120 counts; 5->36 (gap) skipped; 36->36 (dt 0) skipped; 36->38 at 141 counts
  assert.deepEqual(h, { hist: { 120: 5, 141: 2 }, seconds: 7 })
  assert.deepEqual(hrHistogram(streams([0, MAX_GAP_S], [120, 120])), { hist: { 120: MAX_GAP_S }, seconds: MAX_GAP_S })
})

test('hrHistogram: missing or implausible HR samples are skipped; no heartrate stream -> null', () => {
  assert.deepEqual(hrHistogram(streams([0, 1, 2, 3, 4], [null, 0, 260, 140, 141])), { hist: { 140: 1 }, seconds: 1 })
  assert.equal(hrHistogram({ time: { data: [0, 1, 2] } }), null)
  assert.equal(hrHistogram(streams([0, 1], [null, null])), null)
  assert.equal(hrHistogram(null), null)
})

test('fetchHrStreams: asks for time + heartrate keyed by type; 404 -> not_found, no HR -> no_hr, 429 throws rateLimited', async () => {
  const urls = []
  const ok = async (url) => { urls.push(String(url)); return json(200, streams([0, 2], [150, 151])) }
  assert.deepEqual(await fetchHrStreams(async () => 'tok', '42', ok), { status: 'ok', hist: { 150: 2 }, seconds: 2 })
  assert.equal(urls[0], 'https://www.strava.com/api/v3/activities/42/streams?keys=time,heartrate&key_by_type=true')
  assert.deepEqual(await fetchHrStreams(async () => 'tok', '42', async () => json(404, {})), { status: 'not_found' })
  assert.deepEqual(await fetchHrStreams(async () => 'tok', '42', async () => json(200, { time: { data: [0, 1] } })), { status: 'no_hr' })
  await assert.rejects(fetchHrStreams(async () => 'tok', '42', async () => json(429, {})), (e) => e.rateLimited === true)
  await assert.rejects(fetchHrStreams(async () => 'tok', '42', async () => json(503, {})), /streams failed: 503/)
  assert.deepEqual(await fetchHrStreams(async () => 'tok', '../x', ok), { status: 'not_found' }) // never hits the network
  assert.equal(urls.length, 1)
})

test('streamBudget: the per-run batch, capped by the 15-min and 24-h budgets', () => {
  assert.equal(streamBudget({ lastWindow: 0, lastDay: 0 }), BATCH_PER_RUN)
  assert.equal(streamBudget({ lastWindow: WINDOW_MAX - 3, lastDay: 0 }), 3)
  assert.equal(streamBudget({ lastWindow: 0, lastDay: DAY_MAX - 1 }), 1)
  assert.equal(streamBudget({ lastWindow: WINDOW_MAX + 5, lastDay: 0 }), 0)
  assert.ok(BATCH_PER_RUN <= WINDOW_MAX && WINDOW_MAX < 100 && DAY_MAX < 1000, 'stays well inside Strava 100 / 15 min, 1000 / day')
})

// a fake pool for the backfill: the budget counts, the pending ids, and the saved rows
function fakePool ({ used = { last_window: 0, last_day: 0 }, pending = [] } = {}) {
  const saved = []
  const calls = []
  return {
    saved,
    calls,
    async query (sql, values) {
      calls.push({ sql, values })
      if (/FROM strava_activity_hr\s*$/.test(sql.trim()) || /last_window/.test(sql)) return { rows: [used] }
      if (/LEFT JOIN strava_activity_hr/.test(sql)) return { rows: pending.slice(0, values[0]).map((p) => (typeof p === 'string' ? { id: p, attempts: 0 } : p)) }
      if (/INSERT INTO strava_activity_hr/.test(sql)) { saved.push(values); return { rows: [] } }
      throw new Error('unexpected sql ' + sql)
    }
  }
}

test('backfill: fetches at most the budget, newest first as the query orders them, and stores every definite answer', async () => {
  const pool = fakePool({ used: { last_window: WINDOW_MAX - 2, last_day: 0 }, pending: ['9', '8', '7', '6'] })
  const fetched = []
  const fetchImpl = async (url) => {
    const id = /activities\/(\d+)\//.exec(String(url))[1]
    fetched.push(id)
    return id === '8' ? json(200, { time: { data: [0, 1] } }) : json(200, streams([0, 10], [140, 141]))
  }
  const r = await createHrBackfill({ pool, getAccessToken: async () => 't', fetchImpl, log: () => {} }).backfill()
  assert.deepEqual(fetched, ['9', '8'])
  assert.deepEqual(r, { fetched: 2, stored: 2, retried: 0, pending: 2, stop: null })
  assert.deepEqual(pool.saved.map((v) => [v[0], v[1], v[2], v[3]]), [['9', 'ok', 10, '{"140":10}'], ['8', 'no_hr', 0, null]])
  const q = pool.calls.find((c) => /LEFT JOIN/.test(c.sql)).sql
  assert.match(q, /ORDER BY a\.payload->>'start_date_local' DESC/)
  assert.match(q, /h\.activity_id IS NULL/)
})

test('fetchHrStreams: a request slower than the timeout is aborted and thrown as transient', async () => {
  assert.equal(STREAMS_TIMEOUT_MS, 15_000)
  const hang = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })
  await assert.rejects(fetchHrStreams(async () => 'tok', '42', hang, { timeoutMs: 5 }), (e) => e.transient === true && /timed out/.test(e.message))
  // a 5xx and a network error are transient too; a 401 is not (it is the whole service, not this activity)
  await assert.rejects(fetchHrStreams(async () => 'tok', '42', async () => json(502, {})), (e) => e.transient === true)
  await assert.rejects(fetchHrStreams(async () => 'tok', '42', async () => { throw new TypeError('fetch failed') }), (e) => e.transient === true)
  await assert.rejects(fetchHrStreams(async () => 'tok', '42', async () => json(401, {})), (e) => !e.transient && !e.rateLimited)
})

test('backfill: a 5xx / timeout on one activity is recorded for back-off and the batch goes on with the next one', async () => {
  const pool = fakePool({ pending: ['3', { id: '2', attempts: 1 }, '1'] })
  const fetchImpl = async (url) => (/\/2\//.test(String(url)) ? json(503, {}) : json(200, streams([0, 5], [150, 150])))
  const r = await createHrBackfill({ pool, getAccessToken: async () => 't', fetchImpl, log: () => {} }).backfill()
  assert.deepEqual(r, { fetched: 3, stored: 2, retried: 1, pending: 3, stop: null })
  assert.deepEqual(pool.saved.map((v) => [v[0], v[1]]), [['3', 'ok'], ['2', 'retry'], ['1', 'ok']])
  const failure = pool.calls.find((c) => /INSERT INTO strava_activity_hr/.test(c.sql) && c.values[1] === 'retry')
  assert.equal(failure.values[4], 2, 'attempts counts this failure')
  assert.match(failure.sql, /last_error_at/)
})

test('backfill: the pending query skips an activity still in its back-off window and every failed one', async () => {
  const pool = fakePool({ pending: [] })
  await createHrBackfill({ pool, getAccessToken: async () => 't', fetchImpl: async () => json(500, {}), log: () => {} }).backfill()
  const c = pool.calls.find((x) => /LEFT JOIN strava_activity_hr/.test(x.sql))
  assert.match(c.sql, /h\.status = 'retry'/)
  assert.match(c.sql, /h\.last_error_at <= now\(\) - make_interval/)
  assert.doesNotMatch(c.sql, /'failed'/, 'failed rows are never selected again')
  assert.deepEqual(c.values.slice(1), [BACKOFF_BASE_MIN, BACKOFF_CAP_MIN])
  assert.equal(BACKOFF_BASE_MIN, 30)
  assert.equal(BACKOFF_CAP_MIN, 24 * 60)
})

test(`backfill: the ${MAX_ATTEMPTS}th transient failure marks the activity failed (no more retries)`, async () => {
  const pool = fakePool({ pending: [{ id: '5', attempts: MAX_ATTEMPTS - 1 }] })
  const r = await createHrBackfill({ pool, getAccessToken: async () => 't', fetchImpl: async () => json(500, {}), log: () => {} }).backfill()
  assert.equal(r.retried, 1)
  assert.deepEqual([pool.saved[0][0], pool.saved[0][1], pool.saved[0][4]], ['5', 'failed', MAX_ATTEMPTS])
})

test('backfill: a non-transient error (e.g. 401) still stops the whole batch', async () => {
  const pool = fakePool({ pending: ['2', '1'] })
  const r = await createHrBackfill({ pool, getAccessToken: async () => 't', fetchImpl: async () => json(401, {}), log: () => {} }).backfill()
  assert.deepEqual(r, { fetched: 1, stored: 0, retried: 0, pending: null, stop: 'failed' })
  assert.equal(pool.saved.length, 0)
})

test('backfill: an exhausted budget makes no Strava call; a 429 stops the batch without storing that activity', async () => {
  let calls = 0
  const none = await createHrBackfill({ pool: fakePool({ used: { last_window: 0, last_day: DAY_MAX }, pending: ['1'] }), getAccessToken: async () => 't', fetchImpl: async () => { calls++ }, log: () => {} }).backfill()
  assert.equal(none.stop, 'budget')
  assert.equal(calls, 0)

  const pool = fakePool({ pending: ['3', '2', '1'] })
  const logs = []
  const fetchImpl = async (url) => (/\/2\//.test(String(url)) ? json(429, {}) : json(200, streams([0, 5], [150, 150])))
  const r = await createHrBackfill({ pool, getAccessToken: async () => 't', fetchImpl, log: (l) => logs.push(JSON.parse(l)) }).backfill()
  assert.deepEqual(r, { fetched: 2, stored: 1, retried: 0, pending: null, stop: 'rate_limited' })
  assert.deepEqual(pool.saved.map((v) => v[0]), ['3'])
  assert.equal(logs.at(-1).event, 'strava_hr_backfill_failed')
  assert.equal(logs.at(-1).rateLimited, true)
})

test('008_strava_hr.sql is idempotent: only IF NOT EXISTS creates, no drops or destructive alters', async () => {
  const sql = await readFile(new URL('../sql/008_strava_hr.sql', import.meta.url), 'utf8')
  const stmts = sql.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)
  assert.ok(stmts.length >= 2)
  for (const s of stmts) assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS /, s)
  assert.doesNotMatch(sql, /\bDROP\b|\bTRUNCATE\b|\bDELETE FROM\b/i)
  assert.match(sql, /hr_hist\s+JSONB/)
  assert.doesNotMatch(sql, /heartrate\s+(JSONB|INTEGER\[\])/i, 'never the raw stream')
})

test('db.js runs 008_strava_hr.sql as a core migration, after the strava tables it references', async () => {
  const src = await readFile(new URL('../src/db.js', import.meta.url), 'utf8')
  const core = /const MIGRATIONS = \[([^\]]*)\]/.exec(src)[1]
  assert.ok(core.indexOf("'008_strava_hr.sql'") > core.indexOf("'002_strava.sql'"))
  assert.ok(core.indexOf("'009_strava_hr_retry.sql'") > core.indexOf("'008_strava_hr.sql'"), '009 runs after the table it alters')
})

test('009_strava_hr_retry.sql is idempotent: IF NOT EXISTS columns, the status check re-created in place, no data loss', async () => {
  const sql = await readFile(new URL('../sql/009_strava_hr_retry.sql', import.meta.url), 'utf8')
  const stmts = sql.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)
  const addCol = stmts.filter((s) => /ADD COLUMN/.test(s))
  assert.equal(addCol.length, 2)
  for (const s of addCol) assert.match(s, /^ALTER TABLE strava_activity_hr ADD COLUMN IF NOT EXISTS /)
  assert.match(sql, /attempts\s+INTEGER\s+NOT NULL DEFAULT 0/)
  assert.match(sql, /last_error_at\s+TIMESTAMPTZ/)
  // a re-run drops the check only to re-add it, so the ADD can never collide with the previous run
  const drop = stmts.findIndex((s) => /DROP CONSTRAINT IF EXISTS strava_activity_hr_status_check$/.test(s))
  const add = stmts.findIndex((s) => /ADD CONSTRAINT strava_activity_hr_status_check\s+CHECK/.test(s))
  assert.ok(drop >= 0 && add === drop + 1)
  assert.match(stmts[add], /'ok', 'no_hr', 'not_found', 'retry', 'failed'/)
  assert.doesNotMatch(sql, /DROP (TABLE|COLUMN)|\bTRUNCATE\b|\bDELETE FROM\b/i)
})
