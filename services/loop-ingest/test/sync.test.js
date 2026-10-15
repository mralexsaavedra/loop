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

test('afterOk runs once per successful run, after the status is recorded, and the caller does not wait for it', async () => {
  const status = fakeStatus()
  let finishAfter
  let afterCalls = 0
  const runOnce = guardSync(async () => ({ count: 1 }), {
    status,
    afterOk: () => { afterCalls++; status.events.push('after'); return new Promise((resolve) => { finishAfter = resolve }) }
  })
  const [a, b] = await Promise.all([runOnce(), runOnce()])
  assert.deepEqual(a, { count: 1 })
  assert.equal(b, a)
  assert.equal(afterCalls, 1, 'one hook per shared run')
  assert.deepEqual(status.events, ['ok', 'after'], 'the activity outcome is recorded first')
  finishAfter()
})

test('afterOk is skipped on a failed run, and a throwing / rejecting hook never fails the run', async () => {
  let afterCalls = 0
  const failing = guardSync(async () => { throw new Error('strava activities failed: 500') }, { afterOk: () => { afterCalls++ } })
  await assert.rejects(failing())
  assert.equal(afterCalls, 0)

  const logs = []
  const sync = guardSync(async () => ({ count: 0 }), { afterOk: () => { throw new Error('boom') }, log: (l) => logs.push(l) })
  assert.deepEqual(await sync(), { count: 0 })
  const rejecting = guardSync(async () => ({ count: 0 }), { afterOk: async () => { throw new Error('later') }, log: (l) => logs.push(l) })
  assert.deepEqual(await rejecting(), { count: 0 })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(logs.length, 2)
})

test('createStravaSync returns the activity result without waiting for the athlete refresh, which then runs in the background', async () => {
  const { createStravaSync } = await import('../src/sync.js')
  const client = { query: async () => ({ rows: [] }), release () {} }
  const pool = { connect: async () => client, query: async () => ({ rows: [] }) }
  const urls = []
  let releaseAthlete
  const athleteGate = new Promise((resolve) => { releaseAthlete = resolve })
  const fetchImpl = async (url) => {
    const u = String(url)
    urls.push(u)
    if (u.includes('/oauth/token')) return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 }) }
    if (u.includes('/athlete/activities')) return { ok: true, status: 200, json: async () => [] }
    if (u.endsWith('/api/v3/athlete')) { await athleteGate; return { ok: false, status: 500 } }
    return { ok: false, status: 500 }
  }
  const sync = createStravaSync(pool, { STRAVA_CLIENT_ID: 'i', STRAVA_CLIENT_SECRET: 's', STRAVA_REFRESH_TOKEN: 'r' }, { fetchImpl, log: () => {} })
  const result = await sync.runOnce()
  assert.equal(result.count, 0)
  assert.equal(result.athlete, undefined, 'the activity result no longer carries the profile outcome')
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(urls.some((u) => u.endsWith('/api/v3/athlete')), 'the athlete refresh was kicked off')
  releaseAthlete()
  assert.equal(await sync.athleteIdle(), 'failed', 'the background refresh settles on its own and never throws')
})

test('a rejected token is recorded as strava_auth', async () => {
  const status = fakeStatus()
  const runOnce = guardSync(async () => { throw new Error('strava token refresh failed: 401') }, { status })
  await assert.rejects(runOnce())
  assert.deepEqual(status.events, ['error: strava_auth'])
})

test('createStravaSync runs one HR-stream backfill batch after the athlete refresh, in the background', async () => {
  const { createStravaSync } = await import('../src/sync.js')
  const client = { query: async () => ({ rows: [] }), release () {} }
  const saved = []
  const pool = {
    connect: async () => client,
    query: async (sql, values) => {
      if (/LEFT JOIN strava_activity_hr/.test(sql)) return { rows: [{ id: '77' }] }
      if (/INSERT INTO strava_activity_hr/.test(sql)) saved.push(values)
      return { rows: [] }
    }
  }
  const urls = []
  const fetchImpl = async (url) => {
    const u = String(url)
    urls.push(u)
    if (u.includes('/oauth/token')) return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 }) }
    if (u.includes('/athlete/activities')) return { ok: true, status: 200, json: async () => [] }
    if (u.includes('/activities/77/streams')) return { ok: true, status: 200, json: async () => ({ time: { data: [0, 4] }, heartrate: { data: [140, 141] } }) }
    return { ok: false, status: 500 }
  }
  const sync = createStravaSync(pool, { STRAVA_CLIENT_ID: 'i', STRAVA_CLIENT_SECRET: 's', STRAVA_REFRESH_TOKEN: 'r' }, { fetchImpl, log: () => {} })
  await sync.runOnce()
  await new Promise((resolve) => setImmediate(resolve))
  const r = await sync.hrIdle()
  assert.deepEqual(r, { fetched: 1, stored: 1, retried: 0, pending: 1, stop: null })
  assert.ok(urls.findIndex((u) => u.endsWith('/api/v3/athlete')) < urls.findIndex((u) => u.includes('/streams')), 'athlete first, then streams')
  assert.equal(saved[0][0], '77')
})

// C1: the first pull of a long history is incremental: every page is upserted as it arrives, so a rate
// limit partway keeps them, and the next run resumes from the newest stored activity instead of page 1.
function memoryPool () {
  const rows = new Map()
  const client = {
    async query (sql, values) {
      if (/^INSERT INTO strava_activity /.test(sql)) rows.set(values[0], values[1])
      return { rows: [] }
    },
    release () {}
  }
  return {
    rows,
    connect: async () => client,
    query: async (sql) => {
      if (/MAX\(start_local\)/.test(sql)) return { rows: [{ newest: rows.size ? [...rows.values()].sort().at(-1) : null }] }
      return { rows: [] }
    }
  }
}

test('createStravaSync: a first pull hit by a 429 keeps its pages, and the next run resumes from the newest stored one', async () => {
  const { createStravaSync } = await import('../src/sync.js')
  const pool = memoryPool()
  const afters = []
  let activityCalls = 0
  const day = (i) => new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().replace('.000Z', 'Z')
  const fetchImpl = async (url) => {
    const u = new URL(String(url))
    if (u.pathname.endsWith('/oauth/token')) return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 }) }
    if (u.pathname.endsWith('/athlete/activities')) {
      activityCalls += 1
      afters.push(u.searchParams.get('after'))
      if (activityCalls === 2) return { ok: false, status: 429 }
      if (activityCalls === 1) return { ok: true, status: 200, json: async () => Array.from({ length: 100 }, (_, i) => ({ id: i + 1, start_date_local: day(i) })) }
      return { ok: true, status: 200, json: async () => [{ id: 500, start_date_local: day(200) }] }
    }
    return { ok: false, status: 500 }
  }
  const sync = createStravaSync(pool, { STRAVA_CLIENT_ID: 'i', STRAVA_CLIENT_SECRET: 's', STRAVA_REFRESH_TOKEN: 'r' }, { fetchImpl, log: () => {} })

  await assert.rejects(sync.runOnce(), (err) => err.rateLimited === true)
  assert.equal(pool.rows.size, 100, 'the first page was stored before the rate limit')
  assert.equal(afters[0], '0', 'the first pull walks ascending from the beginning')

  const result = await sync.runOnce()
  assert.equal(result.count, 1)
  assert.equal(pool.rows.size, 101)
  const resumedFrom = Number(afters[2])
  assert.equal(resumedFrom, Date.parse(day(99)) / 1000 - 7 * 86_400, 'resumed from the newest stored start (minus the 7-day overlap), not page 1 of everything')
  await sync.hrIdle()
})

test('a failed status write after a good pull is its own log event, never reported as a Strava failure', async () => {
  const events = []
  const logs = []
  let afterCalls = 0
  const status = {
    async recordStravaOk () { throw new Error('connect ECONNREFUSED db') },
    async recordStravaError (code) { events.push(`error: ${code}`) }
  }
  const runOnce = guardSync(async () => ({ count: 3 }), { status, afterOk: () => { afterCalls++ }, log: (l) => logs.push(JSON.parse(l)) })
  assert.deepEqual(await runOnce(), { count: 3 }, 'the pull succeeded: the caller gets its result')
  assert.deepEqual(events, [], 'no strava error recorded')
  assert.deepEqual(logs, [{ event: 'sync_status_write_failed', outcome: 'ok', message: 'connect ECONNREFUSED db' }])
  assert.equal(afterCalls, 1, 'the after-ok work still runs')
})

test('a failed status write after a failed pull is logged and the Strava error is still rethrown', async () => {
  const logs = []
  const status = { async recordStravaOk () {}, async recordStravaError () { throw new Error('db down') } }
  const runOnce = guardSync(async () => { throw new Error('strava activities failed: 401') }, { status, log: (l) => logs.push(JSON.parse(l)) })
  await assert.rejects(runOnce(), /activities failed: 401/)
  assert.deepEqual(logs, [{ event: 'sync_status_write_failed', outcome: 'error', message: 'db down' }])
})
