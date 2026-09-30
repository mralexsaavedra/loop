import test from 'node:test'
import assert from 'node:assert/strict'
import { guardSync } from '../src/sync.js'

function fakeStatus () {
  const events = []
  return {
    events,
    recordStravaOk: async () => { events.push('ok') },
    recordStravaError: async (code) => { events.push(`error: ${code}`) }
  }
}

test('concurrent callers share ONE in-flight run (the loop and POST /sync never overlap)', async () => {
  let runs = 0
  let finish
  const runOnce = guardSync(() => { runs += 1; return new Promise((resolve) => { finish = resolve }) }, { status: fakeStatus() })

  const a = runOnce()
  const b = runOnce()
  finish({ count: 2 })
  assert.deepEqual(await a, { count: 2 })
  assert.deepEqual(await b, { count: 2 })
  assert.equal(runs, 1)

  const c = runOnce()
  finish({ count: 0 })
  await c
  assert.equal(runs, 2, 'a call after the previous run settled starts a new one')
})

test('a successful run records ok; a failed one records the error and rethrows', async () => {
  const status = fakeStatus()
  let fail = false
  const runOnce = guardSync(async () => { if (fail) throw new Error('strava activities failed: 500'); return { count: 1 } }, { status })

  await runOnce()
  fail = true
  await assert.rejects(runOnce(), /activities failed: 500/)
  assert.deepEqual(status.events, ['ok', 'error: strava_other'], 'status gets the coarse code, never the message')

  fail = false
  await runOnce()
  assert.equal(status.events.at(-1), 'ok', 'the guard is released after a failure')
})

test('works without a status recorder', async () => {
  const runOnce = guardSync(async () => ({ count: 0 }))
  assert.deepEqual(await runOnce(), { count: 0 })
})

test('createStravaSync refreshes the athlete snapshot after the activity pull; a profile failure never fails the run', async () => {
  const { createStravaSync } = await import('../src/sync.js')
  const client = { query: async () => ({ rows: [] }), release () {} }
  const pool = { connect: async () => client, query: async () => ({ rows: [] }) }
  const urls = []
  const fetchImpl = async (url) => {
    const u = String(url)
    urls.push(u)
    if (u.includes('/oauth/token')) return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 }) }
    if (u.includes('/athlete/activities')) return { ok: true, status: 200, json: async () => [] }
    return { ok: false, status: 500 }
  }
  const sync = createStravaSync(pool, { STRAVA_CLIENT_ID: 'i', STRAVA_CLIENT_SECRET: 's', STRAVA_REFRESH_TOKEN: 'r' }, { fetchImpl, log: () => {} })
  const result = await sync.runOnce()
  assert.equal(result.count, 0)
  assert.equal(result.athlete, 'failed')
  assert.ok(urls.some((u) => u.endsWith('/api/v3/athlete')), 'the athlete endpoint was called')
})

test('a rejected token is recorded as strava_auth', async () => {
  const status = fakeStatus()
  const runOnce = guardSync(async () => { throw new Error('strava token refresh failed: 401') }, { status })
  await assert.rejects(runOnce())
  assert.deepEqual(status.events, ['error: strava_auth'])
})
