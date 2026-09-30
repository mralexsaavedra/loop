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

test('a rejected token is recorded as strava_auth', async () => {
  const status = fakeStatus()
  const runOnce = guardSync(async () => { throw new Error('strava token refresh failed: 401') }, { status })
  await assert.rejects(runOnce())
  assert.deepEqual(status.events, ['error: strava_auth'])
})
