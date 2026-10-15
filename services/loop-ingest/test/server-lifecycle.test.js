import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { databaseConfig, createShutdown, SHUTDOWN_DEADLINE_MS } from '../src/server.js'

test('databaseConfig: the compose variables give the password verbatim (URL-special characters need no encoding)', () => {
  const password = 'p@ss:w/rd?#%41 x'
  assert.deepEqual(databaseConfig({ DB_HOST: 'loop-db', POSTGRES_USER: 'health', POSTGRES_PASSWORD: password, POSTGRES_DB: 'health' }),
    { host: 'loop-db', port: 5432, user: 'health', password, database: 'health' })
  assert.equal(databaseConfig({ DB_HOST: 'db', DB_PORT: '6543', POSTGRES_USER: 'u', POSTGRES_PASSWORD: 'p', POSTGRES_DB: 'd' }).port, 6543)
})

test('databaseConfig: an explicit DATABASE_URL still wins (an install that sets it keeps working)', () => {
  assert.deepEqual(databaseConfig({ DATABASE_URL: 'postgres://u:p@h:5432/d', DB_HOST: 'loop-db', POSTGRES_USER: 'x', POSTGRES_PASSWORD: 'y', POSTGRES_DB: 'z' }),
    { connectionString: 'postgres://u:p@h:5432/d' })
})

test('databaseConfig: null when neither DATABASE_URL nor the full DB_HOST + POSTGRES_* set is there', () => {
  assert.equal(databaseConfig({}), null)
  assert.equal(databaseConfig({ DB_HOST: 'loop-db', POSTGRES_USER: 'u', POSTGRES_DB: 'd' }), null, 'no password')
  assert.equal(databaseConfig({ POSTGRES_USER: 'u', POSTGRES_PASSWORD: 'p', POSTGRES_DB: 'd' }), null, 'no host')
})

/** A listening server whose handler holds each request until `release()` (or answers at once when `hold` is false). */
async function holdingServer () {
  let releaseAll
  const held = new Promise((resolve) => { releaseAll = resolve })
  let arrived
  const firstArrived = new Promise((resolve) => { arrived = resolve })
  const server = http.createServer(async (req, res) => {
    arrived()
    if (req.url === '/slow') await held
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('done')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port, release: releaseAll, firstArrived }
}
const get = (port, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, agent: false }, (res) => {
    let body = ''
    res.on('data', (d) => { body += d })
    res.on('end', () => resolve({ status: res.statusCode, body }))
  }).on('error', reject)
})

test('graceful shutdown: stop accepting, let the in-flight request finish, then flush, close the pool and exit 0', async () => {
  const h = await holdingServer()
  const steps = []
  const shutdown = createShutdown({
    server: h.server,
    stop: () => steps.push('stop'),
    flush: async () => { steps.push('flush') },
    pool: { end: async () => { steps.push('pool.end') } },
    exit: (code) => steps.push(`exit ${code}`),
    deadlineMs: 5000,
    log: (l) => steps.push(JSON.parse(l).event)
  })
  const inFlight = get(h.port, '/slow')
  await h.firstArrived
  const done = shutdown()
  assert.equal(shutdown(), done, 'a second signal does not start a second shutdown')
  await assert.rejects(get(h.port, '/'), /ECONNREFUSED/, 'no new connection once shutting down')
  assert.ok(!steps.includes('pool.end'), 'the pool stays open while a request is in flight')
  h.release()
  assert.deepEqual(await inFlight, { status: 200, body: 'done' }, 'the in-flight request completes')
  await done
  assert.deepEqual(steps, ['shutdown', 'stop', 'flush', 'pool.end', 'exit 0'])
})

test('graceful shutdown: a request still running at the deadline is cut off and the process exits anyway', async () => {
  const h = await holdingServer()
  const steps = []
  const shutdown = createShutdown({
    server: h.server,
    stop: () => {},
    flush: async () => {},
    pool: { end: async () => { steps.push('pool.end') } },
    exit: (code) => steps.push(`exit ${code}`),
    deadlineMs: 100,
    log: (l) => steps.push(JSON.parse(l).event)
  })
  const inFlight = get(h.port, '/slow').catch((err) => err.code)
  await h.firstArrived
  const t0 = Date.now()
  await shutdown()
  assert.ok(Date.now() - t0 < 2000, 'bounded by the deadline')
  assert.equal(await inFlight, 'ECONNRESET', 'the stuck request was closed')
  assert.deepEqual(steps, ['shutdown', 'shutdown_deadline', 'pool.end', 'exit 0'])
  h.release()
})

test('the shutdown deadline stays below the container stop grace period (docker would SIGKILL first)', async () => {
  const { readFile } = await import('node:fs/promises')
  const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8')
  const ingest = compose.slice(compose.indexOf('  loop-ingest:'))
  const grace = /^\s+stop_grace_period: (\d+)s$/m.exec(ingest)
  assert.ok(grace, 'loop-ingest sets stop_grace_period')
  assert.ok(SHUTDOWN_DEADLINE_MS + 3_000 + 2_000 <= Number(grace[1]) * 1000, 'deadline + flush cap + pool close fit in the grace period')
})
