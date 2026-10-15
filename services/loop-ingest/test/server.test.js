import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHandler } from '../src/server.js'
import { createFoodRoutes } from '../src/food.js'
import { createJournalRoutes } from '../src/journal.js'

const TOKEN = 'x'.repeat(40)

/** Every dependency stubbed: no Postgres, no Strava, no network beyond 127.0.0.1. */
function setup ({ stravaSync = null, foodRoutes, journalRoutes } = {}) {
  const calls = []
  const mark = (name, status = 200) => async (req, res) => {
    calls.push(name)
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ route: name }))
  }
  const deps = {
    token: TOKEN,
    maxBodyBytes: 64,
    pool: {},
    ping: async () => { calls.push('ping') },
    insertRawPayload: async (_pool, row) => { calls.push(['insert', row.source, row.byteSize]); return { id: 7, received_at: '2030-01-01T00:00:00Z' } },
    syncStatus: { health: () => ({ degraded: false }) },
    stravaEnabled: stravaSync !== null,
    stravaSync,
    foodRoutes: foodRoutes ?? {
      async handle (req, res, url) {
        if (url.pathname !== '/food' && !url.pathname.startsWith('/food/')) return false
        await mark('food')(req, res)
        return true
      }
    },
    ...(journalRoutes ? { journalRoutes } : {}),
    syncRoutes: { handleSync: mark('sync', 202), handleStatus: mark('syncStatus') },
    handleExport: mark('exportRaw'),
    handleStravaExport: mark('exportStrava'),
    handleAthleteExport: mark('exportAthlete')
  }
  const server = http.createServer(createHandler(deps))
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`
    resolve({
      calls,
      base,
      close: () => new Promise((r) => server.close(r)),
      async call (method, path, { headers = {}, body } = {}) {
        const res = await fetch(base + path, { method, headers, body })
        const text = await res.text()
        return { status: res.status, body: text ? JSON.parse(text) : null }
      }
    })
  }))
}

test('each method + path reaches its handler', async (t) => {
  const s = await setup()
  t.after(s.close)
  const cases = [
    ['GET', '/sync/status', 'syncStatus', 200],
    ['POST', '/sync', 'sync', 202],
    ['GET', '/export/raw?since=2030-01-01', 'exportRaw', 200],
    ['GET', '/export/strava', 'exportStrava', 200],
    ['GET', '/export/athlete', 'exportAthlete', 200],
    ['GET', '/food/products', 'food', 200],
    ['POST', '/food', 'food', 200]
  ]
  for (const [method, path, route, status] of cases) {
    const r = await s.call(method, path)
    assert.equal(r.status, status, `${method} ${path}`)
    assert.deepEqual(r.body, { route }, `${method} ${path}`)
  }
})

test('GET /healthz pings the pool and reports strava + status health', async (t) => {
  const s = await setup()
  t.after(s.close)
  const r = await s.call('GET', '/healthz')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { ok: true, strava: 'disabled', degraded: false })
  assert.deepEqual(s.calls, ['ping'])
})

test('unknown paths and wrong methods on known paths answer 404 without reaching a handler', async (t) => {
  const s = await setup()
  t.after(s.close)
  const cases = [
    ['GET', '/'], ['GET', '/nope'], ['GET', '/sync'], ['POST', '/sync/status'],
    ['POST', '/export/raw'], ['DELETE', '/export/strava'], ['GET', '/ingest/health-auto-export'],
    ['GET', '/sync/strava'], ['POST', '/healthz'], ['GET', '/foods'], ['GET', '/export/raw/x']
  ]
  for (const [method, path] of cases) {
    const r = await s.call(method, path)
    assert.equal(r.status, 404, `${method} ${path}`)
    assert.deepEqual(r.body, { error: 'not found' }, `${method} ${path}`)
  }
  assert.deepEqual(s.calls, [], 'no handler ran')
})

test('an unknown /food/* subpath is 404 through the real food routes, never another route', async (t) => {
  const foodRoutes = createFoodRoutes({
    store: {},
    off: {},
    available: () => false,
    settingsAvailable: () => false,
    allowedHosts: [],
    log: () => {}
  })
  const s = await setup({ foodRoutes })
  t.after(s.close)
  const h = { 'x-hc-food': '1' }
  for (const path of ['/food/nope', '/food/products/1/extra', '/food/settings/x', '/food/']) {
    const r = await s.call('GET', path, { headers: h })
    assert.equal(r.status, 404, path)
    assert.deepEqual(r.body, { error: 'not_found' }, path)
  }
  // a known food path with the migration missing is 503, proving the dispatch reached food.js
  assert.equal((await s.call('GET', '/food/products', { headers: h })).status, 503)
})

test('/journal/* reaches the real journal routes (503 while its migration is missing, 404 unknown)', async (t) => {
  const journalRoutes = createJournalRoutes({ store: {}, available: () => false, allowedHosts: [], log: () => {} })
  const s = await setup({ journalRoutes })
  t.after(s.close)
  const h = { 'x-hc-journal': '1' }
  assert.equal((await s.call('GET', '/journal/settings', { headers: h })).status, 503)
  const r = await s.call('GET', '/journal/nope', { headers: h })
  assert.deepEqual([r.status, r.body], [404, { error: 'not_found' }])
  // without journal routes wired, the outer router still answers its own 404
  const plain = await setup()
  t.after(plain.close)
  assert.deepEqual((await plain.call('GET', '/journal/settings', { headers: h })).body, { error: 'not found' })
})

test('POST /ingest/health-auto-export: bearer, empty / bad / oversized body, then stored', async (t) => {
  const s = await setup()
  t.after(s.close)
  const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
  assert.equal((await s.call('POST', '/ingest/health-auto-export', { body: '{}' })).status, 401)
  assert.equal((await s.call('POST', '/ingest/health-auto-export', { headers: { authorization: 'Bearer wrong' }, body: '{}' })).status, 401)
  assert.deepEqual(await s.call('POST', '/ingest/health-auto-export', { headers: auth }), { status: 400, body: { error: 'empty body' } })
  assert.deepEqual(await s.call('POST', '/ingest/health-auto-export', { headers: auth, body: '{nope' }), { status: 400, body: { error: 'body is not valid JSON' } })
  const big = await s.call('POST', '/ingest/health-auto-export', { headers: auth, body: JSON.stringify({ a: 'y'.repeat(100) }) })
  assert.deepEqual(big, { status: 413, body: { error: 'payload too large' } }, 'over maxBodyBytes: a real 413 response, not a reset socket')
  const ok = await s.call('POST', '/ingest/health-auto-export', { headers: auth, body: '{"data":1}' })
  assert.equal(ok.status, 202)
  assert.deepEqual(ok.body, { ok: true, id: '7', received_at: '2030-01-01T00:00:00Z' })
  assert.deepEqual(s.calls, [['insert', 'health-auto-export', 10]])
})

/** A raw request whose body is streamed in `chunks` (chunked encoding unless `length` is declared). */
function rawPost (port, { length, chunks }) {
  return new Promise((resolve, reject) => {
    const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(length ? { 'content-length': length } : {}) }
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/ingest/health-auto-export', headers }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (d) => { text += d })
      res.on('end', () => resolve({ status: res.statusCode, connection: res.headers.connection, body: JSON.parse(text) }))
    })
    req.on('error', reject)
    let i = 0
    const next = () => {
      if (i === chunks.length) return req.end()
      req.write(chunks[i++], () => setTimeout(next, 5))
    }
    next()
  })
}

test('an oversized ingest body gets its 413 response (connection: close) before the socket is closed: declared or streamed', async () => {
  const s = await setup()
  try {
    const port = Number(new URL(s.base).port)
    // a declared Content-Length over the cap: refused before reading the body
    assert.deepEqual(await rawPost(port, { length: 200, chunks: ['y'.repeat(200)] }), { status: 413, connection: 'close', body: { error: 'payload too large' } })
    // chunked, no declared length: the cap is hit while streaming
    assert.deepEqual(await rawPost(port, { chunks: ['{"a":"', 'y'.repeat(40), 'y'.repeat(40), 'y'.repeat(40), '"}'] }), { status: 413, connection: 'close', body: { error: 'payload too large' } })
    assert.deepEqual(s.calls, [], 'nothing stored')
  } finally {
    await s.close()
  }
})

test('POST /sync/strava: 401 without the bearer, 409 when Strava is off, else runs one pull', async (t) => {
  const off = await setup()
  t.after(off.close)
  const auth = { authorization: `Bearer ${TOKEN}` }
  assert.equal((await off.call('POST', '/sync/strava')).status, 401)
  assert.deepEqual(await off.call('POST', '/sync/strava', { headers: auth }), { status: 409, body: { error: 'strava not configured' } })

  let runs = 0
  const on = await setup({ stravaSync: { runOnce: async () => { runs++; return { count: 3 } } } })
  t.after(on.close)
  assert.deepEqual(await on.call('POST', '/sync/strava', { headers: auth }), { status: 200, body: { ok: true, activities: 3 } })
  assert.equal(runs, 1)
  assert.equal((await on.call('GET', '/healthz')).body.strava, 'enabled')
})

test('a handler that throws answers a coarse 500, never the error text', async (t) => {
  const orig = console.error
  console.error = () => {}
  t.after(() => { console.error = orig })
  const s2 = await setup({ stravaSync: { runOnce: async () => { throw new Error('secret db detail') } } })
  t.after(s2.close)
  const r = await s2.call('POST', '/sync/strava', { headers: { authorization: `Bearer ${TOKEN}` } })
  assert.deepEqual(r, { status: 500, body: { error: 'internal error' } })
})

test('importing server.js has no side effects (no listener, no exit without env)', async () => {
  // reaching this file at all proves the import did not call process.exit despite the missing env
  assert.equal(typeof createHandler, 'function')
})
