import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSyncStatus, STRAVA_STALE_MS, SNAPSHOT_TTL_MS, STATUS_CODES } from '../src/status.js'

const T0 = Date.parse('2030-01-02T10:00:00Z')
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Fake pg pool: answers the few statements status.js issues, records every call. */
function fakePool ({ state = null, lastPayload = null, failWrites = false, failReads = 0 } = {}) {
  const calls = []
  let readFailures = failReads
  return {
    calls,
    async query (sql, values) {
      calls.push({ sql, values })
      if (/FROM sync_status/.test(sql)) {
        if (readFailures > 0) { readFailures -= 1; throw new Error('connect ECONNREFUSED 10.0.0.5:5432') }
        return { rows: state ? [state] : [] }
      }
      if (/FROM raw_payload/.test(sql)) return { rows: [{ last: lastPayload }] }
      if (/^\s*UPDATE sync_status/.test(sql)) {
        if (failWrites) throw new Error('db down')
        return { rows: [] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    }
  }
}

const KEYS = ['lastShortcutAt', 'lastStravaError', 'lastStravaOkAt', 'lastTriggerAt', 'lastTriggerError', 'lastTriggerErrorSeq', 'stravaConfigured', 'triggerSeq']

test('snapshot: exact key set, ISO timestamps, coarse codes, the configured flag', async () => {
  const pool = fakePool({
    state: { last_strava_ok_at: new Date(T0 - 3_600_000), last_strava_error: null, last_trigger_at: new Date(T0 - 60_000), trigger_seq: '12' },
    lastPayload: new Date(T0 - 300_000)
  })
  const status = createSyncStatus({ pool, stravaConfigured: true, now: () => T0 })
  await status.load()

  assert.deepEqual(await status.snapshot(), {
    lastShortcutAt: '2030-01-02T09:55:00.000Z',
    lastStravaOkAt: '2030-01-02T09:00:00.000Z',
    lastStravaError: null,
    lastTriggerAt: '2030-01-02T09:59:00.000Z',
    lastTriggerError: null,
    lastTriggerErrorSeq: null,
    triggerSeq: 12,
    stravaConfigured: true
  })
  const payloadQuery = pool.calls.find((c) => /FROM raw_payload/.test(c.sql)).sql
  assert.equal(/SELECT\s+([\s\S]*?)\s+FROM/i.exec(payloadQuery)[1], 'MAX(received_at) AS last', 'selects one timestamp, never payload columns')
})

test('an empty database reports nulls and seq 0, not errors', async () => {
  const status = createSyncStatus({ pool: fakePool(), stravaConfigured: false, now: () => T0 })
  await status.load()
  const snap = await status.snapshot()
  assert.deepEqual(Object.keys(snap).sort(), KEYS)
  assert.equal(snap.triggerSeq, 0)
  assert.equal(snap.lastShortcutAt, null)
})

test('status codes are the fixed coarse set', () => {
  assert.deepEqual([...STATUS_CODES].sort(), ['strava_auth', 'strava_network', 'strava_other', 'strava_token_save', 'trigger_write'])
})

test('Strava errors are exposed ONLY as coarse codes; no raw error text ever leaks', async () => {
  let t = T0
  const pool = fakePool()
  const status = createSyncStatus({ pool, stravaConfigured: true, now: () => t, log: () => {} })
  await status.load()

  const cases = [
    ['strava_auth', 'strava_auth'],
    ['strava_network', 'strava_network'],
    ['strava token refresh failed: 401 secret=abc', 'strava_other'], // not a code -> never echoed
    [undefined, 'strava_other']
  ]
  for (const [input, expected] of cases) {
    t += SNAPSHOT_TTL_MS
    await status.recordStravaError(input)
    const snap = await status.snapshot()
    assert.equal(snap.lastStravaError, expected)
    assert.doesNotMatch(JSON.stringify(snap), /secret|refresh failed|401/)
  }
  const persisted = pool.calls.filter((c) => /UPDATE sync_status/.test(c.sql)).map((c) => JSON.stringify(c.values))
  for (const v of persisted) assert.doesNotMatch(v, /secret|refresh failed/, 'only codes reach the DB too')
})

test('a legacy raw message stored by an older version is sanitized on load', async () => {
  const pool = fakePool({ state: { last_strava_error: 'strava activities failed: 500 at https://x', last_strava_ok_at: null } })
  const status = createSyncStatus({ pool, stravaConfigured: true, now: () => T0 })
  await status.load()
  assert.equal((await status.snapshot()).lastStravaError, 'strava_other')
})

test('recordStravaOk clears the error; an error never erases the last success', async () => {
  let t = T0
  const status = createSyncStatus({ pool: fakePool(), stravaConfigured: true, now: () => t })
  await status.recordStravaError('strava_auth')
  t += 1000
  await status.recordStravaOk()
  let snap = await status.snapshot()
  assert.equal(snap.lastStravaOkAt, '2030-01-02T10:00:01.000Z')
  assert.equal(snap.lastStravaError, null)
  t += 1000
  await status.recordStravaError('strava_network')
  snap = await status.snapshot()
  assert.equal(snap.lastStravaOkAt, '2030-01-02T10:00:01.000Z')
  assert.equal(snap.lastStravaError, 'strava_network')
})

test('token save failure shows as strava_token_save until a later save succeeds', async () => {
  const status = createSyncStatus({ pool: fakePool(), stravaConfigured: true, now: () => T0 })
  await status.recordTokenSave(false)
  await status.recordStravaOk() // the pull itself worked
  assert.equal((await status.snapshot()).lastStravaError, 'strava_token_save')
  await status.recordTokenSave(true)
  assert.equal((await status.snapshot()).lastStravaError, null)
})

test('stravaFresh: true only when the last success is younger than the interval', async () => {
  let t = T0
  const status = createSyncStatus({ pool: fakePool(), stravaConfigured: true, now: () => t })
  assert.equal(status.stravaFresh(300_000), false, 'never succeeded')
  await status.recordStravaOk()
  t += 299_999
  assert.equal(status.stravaFresh(300_000), true)
  t += 1
  assert.equal(status.stravaFresh(300_000), false)
})

test('trigger sequence: increments synchronously, persisted monotonically (GREATEST)', async () => {
  const pool = fakePool({ state: { trigger_seq: 7 } })
  const status = createSyncStatus({ pool, stravaConfigured: false, now: () => T0 })
  await status.load()
  assert.equal(status.currentSeq(), 7)
  assert.equal(status.nextTriggerSeq(), 8)
  assert.equal(status.nextTriggerSeq(), 9)
  assert.equal(status.currentSeq(), 9)
  await new Promise((resolve) => setImmediate(resolve))
  const write = pool.calls.filter((c) => /UPDATE sync_status/.test(c.sql)).at(-1)
  assert.match(write.sql, /trigger_seq\s*=\s*GREATEST\(trigger_seq,/)
  assert.ok(write.values.includes(9))
})

test('load takes the max of the DB seq and the trigger file seq (seq never goes backwards)', async () => {
  const status = createSyncStatus({ pool: fakePool({ state: { trigger_seq: 3 } }), stravaConfigured: false, now: () => T0, readTriggerSeq: async () => 20 })
  await status.load()
  assert.equal(status.currentSeq(), 20)
})

test('a failed load is logged, never thrown, and retried on the next snapshot', async () => {
  const logs = []
  const pool = fakePool({ state: { trigger_seq: 5, last_strava_ok_at: new Date(T0) }, failReads: 1 })
  const status = createSyncStatus({ pool, stravaConfigured: true, now: () => T0, log: (l) => logs.push(JSON.parse(l)), readTriggerSeq: async () => 2 })
  await status.load()
  assert.equal(status.currentSeq(), 2, 'falls back to the trigger file seq')
  assert.equal(logs[0].event, 'sync_status_load_failed')
  assert.doesNotMatch(JSON.stringify(await status.snapshot()), /ECONNREFUSED/)
  assert.equal(status.currentSeq(), 5, 'the snapshot retried the load')
  assert.equal((await status.snapshot()).lastStravaOkAt, '2030-01-02T10:00:00.000Z')
})

test('recordTrigger / recordTriggerError expose trigger_write with its seq; a later success clears it', async () => {
  let t = T0
  const status = createSyncStatus({ pool: fakePool(), stravaConfigured: false, now: () => t })
  await status.recordTriggerError(3)
  let snap = await status.snapshot()
  assert.equal(snap.lastTriggerError, 'trigger_write')
  assert.equal(snap.lastTriggerErrorSeq, 3)
  t += 1000
  await status.recordTrigger(4)
  snap = await status.snapshot()
  assert.equal(snap.lastTriggerError, null)
  assert.equal(snap.lastTriggerErrorSeq, null)
  assert.equal(snap.lastTriggerAt, '2030-01-02T10:00:01.000Z')
})

test('snapshot is cached for 5 s (bounded DB load); own state changes invalidate it', async () => {
  let t = T0
  const pool = fakePool({ lastPayload: new Date(T0 - 60_000) })
  const status = createSyncStatus({ pool, stravaConfigured: false, now: () => t })
  const reads = () => pool.calls.filter((c) => /FROM raw_payload/.test(c.sql)).length
  assert.equal(SNAPSHOT_TTL_MS, 5000)
  await status.snapshot()
  t += 4999
  await status.snapshot()
  assert.equal(reads(), 1, 'served from cache inside the TTL')
  t += 1
  await status.snapshot()
  assert.equal(reads(), 2, 're-read after the TTL')
  await status.recordTriggerError(1)
  assert.equal((await status.snapshot()).lastTriggerError, 'trigger_write', 'a change is visible at once')
})

test('a failed persist keeps the in-memory value and never throws', async () => {
  const logs = []
  const status = createSyncStatus({ pool: fakePool({ failWrites: true }), stravaConfigured: true, now: () => T0, log: (l) => logs.push(JSON.parse(l)) })
  await status.recordStravaOk()
  assert.equal((await status.snapshot()).lastStravaOkAt, '2030-01-02T10:00:00.000Z')
  assert.equal(logs[0].event, 'sync_status_persist_failed')
})

test('health: degraded when the PERSISTED last success is older than 6 h (a restart does not reset it)', async () => {
  let t = T0
  const status = createSyncStatus({
    pool: fakePool({ state: { last_strava_ok_at: new Date(T0 - STRAVA_STALE_MS - 1) } }),
    stravaConfigured: true,
    now: () => t
  })
  await status.load()
  assert.deepEqual(status.health(), { degraded: true, reason: 'strava_stale' })
  await status.recordStravaOk()
  assert.deepEqual(status.health(), { degraded: false })
  t += STRAVA_STALE_MS + 1
  assert.deepEqual(status.health(), { degraded: true, reason: 'strava_stale' })
  assert.equal(STRAVA_STALE_MS, 6 * 3_600_000)
})

test('health: configured but never succeeded is degraded (no startup grace to hide a broken token)', async () => {
  const status = createSyncStatus({ pool: fakePool(), stravaConfigured: true, now: () => T0 })
  await status.load()
  assert.deepEqual(status.health(), { degraded: true, reason: 'strava_stale' })
})

test('health: never degraded when Strava is not configured', async () => {
  const status = createSyncStatus({ pool: fakePool(), stravaConfigured: false, now: () => T0 })
  assert.deepEqual(status.health(), { degraded: false })
})

test('every snapshot value is a timestamp, a code, a number or a boolean', async () => {
  const status = createSyncStatus({ pool: fakePool({ lastPayload: new Date(T0) }), stravaConfigured: true, now: () => T0 })
  await status.recordStravaError('strava_auth')
  await status.recordTriggerError(1)
  for (const [key, value] of Object.entries(await status.snapshot())) {
    if (value === null) continue
    if (key === 'stravaConfigured') assert.equal(typeof value, 'boolean')
    else if (key === 'triggerSeq' || key === 'lastTriggerErrorSeq') assert.ok(Number.isInteger(value))
    else if (key === 'lastStravaError' || key === 'lastTriggerError') assert.ok(STATUS_CODES.has(value))
    else assert.match(value, ISO, key)
  }
})

test('sql/003_sync.sql defines every sync_status column status.js reads or writes', () => {
  const sql = readFileSync(new URL('../sql/003_sync.sql', import.meta.url), 'utf8')
  const src = readFileSync(new URL('../src/status.js', import.meta.url), 'utf8')
  const used = new Set([...src.matchAll(/\b(last_[a-z_]+|trigger_seq|strava_token_save_failed)\b/g)].map((m) => m[1]))
  assert.ok(used.size >= 8)
  for (const col of used) assert.match(sql, new RegExp(`\\b${col}\\s+(TIMESTAMPTZ|TEXT|BIGINT|BOOLEAN)`), col)
})

test('lastTriggerAtMs: the persisted last trigger write as epoch ms, null when none', async () => {
  const empty = createSyncStatus({ pool: fakePool(), stravaConfigured: false, now: () => T0 })
  await empty.load()
  assert.equal(empty.lastTriggerAtMs(), null)
  const pool = fakePool({ state: { last_trigger_at: new Date(T0 - 60_000), trigger_seq: '3' } })
  const status = createSyncStatus({ pool, stravaConfigured: false, now: () => T0 })
  await status.load()
  assert.equal(status.lastTriggerAtMs(), T0 - 60_000)
})
