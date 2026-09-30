import test from 'node:test'
import assert from 'node:assert/strict'
import { createSyncRoutes } from '../src/sync-routes.js'
import { createRateLimiter, createSyncTrigger } from '../src/trigger.js'
import { createSyncStatus } from '../src/status.js'

function fakeRes () {
  return {
    status: null,
    headers: null,
    body: null,
    headersSent: false,
    writeHead (status, headers) { this.status = status; this.headers = headers; this.headersSent = true },
    end (payload) { this.body = JSON.parse(payload) }
  }
}

function fakePool () {
  const calls = []
  return {
    calls,
    async query (sql) {
      calls.push(sql)
      if (/FROM raw_payload/.test(sql)) return { rows: [{ last: new Date('2030-01-02T09:55:00Z') }] }
      return { rows: [] }
    }
  }
}

function setup ({ now = () => Date.parse('2030-01-02T10:00:00Z') } = {}) {
  const pool = fakePool()
  const status = createSyncStatus({ pool, stravaConfigured: true, now, log: () => {} })
  const written = []
  const trigger = createSyncTrigger({
    limiter: createRateLimiter({ intervalMs: 60_000, now }),
    runStrava: async () => ({ count: 1 }),
    writeTrigger: async (iso) => { written.push(iso) },
    status,
    now,
    log: () => {}
  })
  return { pool, written, routes: createSyncRoutes({ trigger, status }) }
}

test('POST /sync answers 202 JSON without any auth header', async () => {
  const { routes, written } = setup()
  const res = fakeRes()
  const done = routes.handleSync({ headers: {} }, res)
  assert.equal(res.status, 202)
  assert.equal(res.headers['content-type'], 'application/json')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.equal(res.body.ok, true)
  await done
  assert.equal(written.length, 1)
})

test('a second POST /sync within 60 s answers 429 with a Retry-After header', async () => {
  const { routes } = setup()
  await routes.handleSync({ headers: {} }, fakeRes())
  const res = fakeRes()
  await routes.handleSync({ headers: {} }, res)
  assert.equal(res.status, 429)
  assert.equal(res.headers['retry-after'], '60')
})

test('GET /sync/status: exact key set, timestamps only, no-store', async () => {
  const { routes } = setup()
  await routes.handleSync({ headers: {} }, fakeRes())
  const res = fakeRes()
  await routes.handleStatus({ headers: {} }, res)

  assert.equal(res.status, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.deepEqual(Object.keys(res.body).sort(), ['lastShortcutAt', 'lastStravaError', 'lastStravaOkAt', 'lastTriggerAt', 'stravaConfigured'])
  assert.equal(res.body.lastShortcutAt, '2030-01-02T09:55:00.000Z')
  assert.equal(res.body.lastTriggerAt, '2030-01-02T10:00:00.000Z')
  for (const [key, value] of Object.entries(res.body)) {
    if (key === 'stravaConfigured') assert.equal(typeof value, 'boolean')
    else if (key === 'lastStravaError') assert.ok(value === null || typeof value === 'string')
    else assert.ok(value === null || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value), `${key} must be an ISO timestamp`)
  }
})
