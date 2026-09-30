import test from 'node:test'
import assert from 'node:assert/strict'
import { createSyncStatus, shortError, STRAVA_STALE_MS } from '../src/status.js'

const T0 = Date.parse('2030-01-02T10:00:00Z')

/** Fake pg pool: answers the few statements status.js issues, records every call. */
function fakePool ({ state = null, lastPayload = null, failWrites = false } = {}) {
  const calls = []
  return {
    calls,
    async query (sql, values) {
      calls.push({ sql, values })
      if (/FROM sync_status/.test(sql)) return { rows: state ? [state] : [] }
      if (/FROM raw_payload/.test(sql)) return { rows: [{ last: lastPayload }] }
      if (/^\s*UPDATE sync_status/.test(sql)) {
        if (failWrites) throw new Error('db down')
        return { rows: [] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    }
  }
}

test('status snapshot carries ONLY timestamps, the short error and the configured flag', async () => {
  const pool = fakePool({
    state: { last_strava_ok_at: new Date(T0 - 3_600_000), last_strava_error: null, last_trigger_at: new Date(T0 - 60_000) },
    lastPayload: new Date(T0 - 300_000)
  })
  const status = createSyncStatus({ pool, stravaConfigured: true, now: () => T0 })
  await status.load()

  const snap = await status.snapshot()
  assert.deepEqual(snap, {
    lastShortcutAt: '2030-01-02T09:55:00.000Z',
    lastStravaOkAt: '2030-01-02T09:00:00.000Z',
    lastStravaError: null,
    lastTriggerAt: '2030-01-02T09:59:00.000Z',
    stravaConfigured: true
  })

  const payloadQuery = pool.calls.find((c) => /FROM raw_payload/.test(c.sql)).sql
  const selected = /SELECT\s+([\s\S]*?)\s+FROM/i.exec(payloadQuery)[1]
  assert.equal(selected, 'MAX(received_at) AS last', 'selects one timestamp, never payload columns')
})

test('an empty database reports nulls, not errors', async () => {
  const status = createSyncStatus({ pool: fakePool(), stravaConfigured: false, now: () => T0 })
  await status.load()
  assert.deepEqual(await status.snapshot(), {
    lastShortcutAt: null, lastStravaOkAt: null, lastStravaError: null, lastTriggerAt: null, stravaConfigured: false
  })
})

test('recordStravaOk clears the error and persists; recordStravaError keeps the last ok time', async () => {
  let t = T0
  const pool = fakePool()
  const status = createSyncStatus({ pool, stravaConfigured: true, now: () => t })
  await status.load()

  await status.recordStravaError('strava token refresh failed: 401')
  assert.equal((await status.snapshot()).lastStravaError, 'strava token refresh failed: 401')

  t += 1000
  await status.recordStravaOk()
  let snap = await status.snapshot()
  assert.equal(snap.lastStravaOkAt, '2030-01-02T10:00:01.000Z')
  assert.equal(snap.lastStravaError, null)

  t += 1000
  await status.recordStravaError('strava rate limit reached')
  snap = await status.snapshot()
  assert.equal(snap.lastStravaOkAt, '2030-01-02T10:00:01.000Z', 'an error never erases the last success')
  assert.equal(snap.lastStravaError, 'strava rate limit reached')

  const writes = pool.calls.filter((c) => /UPDATE sync_status/.test(c.sql))
  assert.equal(writes.length, 3, 'every change is persisted')
})

test('recordTrigger stores the request time', async () => {
  const status = createSyncStatus({ pool: fakePool(), stravaConfigured: false, now: () => T0 })
  await status.recordTrigger('2030-01-02T10:00:00.000Z')
  assert.equal((await status.snapshot()).lastTriggerAt, '2030-01-02T10:00:00.000Z')
})

test('a failed persist keeps the in-memory value and never throws', async () => {
  const logs = []
  const status = createSyncStatus({ pool: fakePool({ failWrites: true }), stravaConfigured: true, now: () => T0, log: (l) => logs.push(JSON.parse(l)) })
  await status.recordStravaOk()
  assert.equal((await status.snapshot()).lastStravaOkAt, '2030-01-02T10:00:00.000Z')
  assert.equal(logs[0].event, 'sync_status_persist_failed')
})

test('shortError: one line, capped, never empty', () => {
  assert.equal(shortError('a\n  b\tc'), 'a b c')
  assert.equal(shortError('x'.repeat(500)).length, 120)
  assert.equal(shortError(''), 'unknown error')
  assert.equal(shortError(undefined), 'unknown error')
})

test('health: degraded when Strava is configured and the last success is older than 6 h', async () => {
  let t = T0
  const status = createSyncStatus({ pool: fakePool(), stravaConfigured: true, now: () => t, startedAt: T0 })
  await status.recordStravaOk()
  assert.deepEqual(status.health(), { degraded: false })

  t = T0 + STRAVA_STALE_MS + 1
  assert.deepEqual(status.health(), { degraded: true, reason: 'strava_stale' })
  assert.equal(STRAVA_STALE_MS, 6 * 3_600_000)
})

test('health: a fresh start with no success yet gets the same 6 h grace from startup', async () => {
  let t = T0
  const status = createSyncStatus({ pool: fakePool(), stravaConfigured: true, now: () => t, startedAt: T0 })
  assert.deepEqual(status.health(), { degraded: false })
  t = T0 + STRAVA_STALE_MS + 1
  assert.equal(status.health().degraded, true)
})

test('health: never degraded when Strava is not configured', async () => {
  const status = createSyncStatus({ pool: fakePool(), stravaConfigured: false, now: () => T0 + 10 * STRAVA_STALE_MS, startedAt: T0 })
  assert.deepEqual(status.health(), { degraded: false })
})
