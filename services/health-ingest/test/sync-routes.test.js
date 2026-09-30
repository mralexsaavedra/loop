import test from 'node:test'
import assert from 'node:assert/strict'
import { createSyncRoutes } from '../src/sync-routes.js'
import { createSyncTrigger } from '../src/trigger.js'
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
  return {
    async query (sql) {
      if (/FROM raw_payload/.test(sql)) return { rows: [{ last: new Date('2030-01-02T09:55:00Z') }] }
      if (/FROM sync_status/.test(sql)) return { rows: [{ trigger_seq: 41 }] }
      return { rows: [] }
    }
  }
}

async function setup ({ now = () => Date.parse('2030-01-02T10:00:00Z'), runStrava = async () => ({ count: 1 }), writeTrigger } = {}) {
  const status = createSyncStatus({ pool: fakePool(), stravaConfigured: true, now, log: () => {} })
  await status.load()
  const written = []
  const trigger = createSyncTrigger({
    runStrava,
    writeTrigger: writeTrigger ?? (async (seq) => { written.push(seq) }),
    status,
    now,
    log: () => {}
  })
  return { written, routes: createSyncRoutes({ trigger, status }) }
}

test('POST /sync answers 202 {seq, coalesced} JSON without any auth header', async () => {
  const { routes, written } = await setup()
  const res = fakeRes()
  const done = routes.handleSync({ headers: {} }, res)
  assert.equal(res.status, 202)
  assert.equal(res.headers['content-type'], 'application/json')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.equal(res.body.seq, 42, 'continues the persisted sequence')
  assert.equal(res.body.coalesced, false)
  await done
  assert.deepEqual(written, [42])
})

test('a second POST /sync within 60 s is NOT refused: 202, coalesced onto the same seq, no Retry-After', async () => {
  const { routes, written } = await setup()
  await routes.handleSync({ headers: {} }, fakeRes())
  const res = fakeRes()
  await routes.handleSync({ headers: {} }, res)
  assert.equal(res.status, 202)
  assert.deepEqual(res.body, { ok: true, seq: 42, coalesced: true })
  assert.equal(res.headers['retry-after'], undefined)
  assert.deepEqual(written, [42])
})

test('GET /sync/status: exact key set, no-store, the trigger seq', async () => {
  const { routes } = await setup()
  await routes.handleSync({ headers: {} }, fakeRes())
  const res = fakeRes()
  await routes.handleStatus({ headers: {} }, res)
  assert.equal(res.status, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.deepEqual(Object.keys(res.body).sort(), [
    'lastShortcutAt', 'lastStravaError', 'lastStravaOkAt', 'lastTriggerAt', 'lastTriggerError', 'lastTriggerErrorSeq', 'stravaConfigured', 'triggerSeq'
  ])
  assert.equal(res.body.lastShortcutAt, '2030-01-02T09:55:00.000Z')
  assert.equal(res.body.lastTriggerAt, '2030-01-02T10:00:00.000Z')
  assert.equal(res.body.triggerSeq, 42)
})

test('GET /sync/status never leaks raw error text from a failed pull or trigger write', async () => {
  const { routes } = await setup({
    runStrava: async () => { throw new Error('strava token refresh failed: 401 client_secret=hunter2') },
    writeTrigger: async () => { throw Object.assign(new Error('EACCES: permission denied, open /trigger/.refresh.tmp'), { code: 'EACCES' }) }
  })
  await routes.handleSync({ headers: {} }, fakeRes())
  const res = fakeRes()
  await routes.handleStatus({ headers: {} }, res)
  assert.equal(res.body.lastTriggerError, 'trigger_write')
  assert.equal(res.body.lastTriggerErrorSeq, 42)
  const raw = JSON.stringify(res.body)
  assert.doesNotMatch(raw, /EACCES|permission|hunter2|refresh failed|\/trigger/)
})
