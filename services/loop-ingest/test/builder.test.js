import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildMode, createBuilder, createRefreshSpawner, readPublishedSeq, DEFAULT_REFRESH_SCRIPT } from '../src/builder.js'
import { createSyncTrigger } from '../src/trigger.js'
import { createSyncStatus } from '../src/status.js'
import { createSyncRoutes } from '../src/sync-routes.js'
import { buildConfig } from '../src/server.js'

/** A controllable fake child: finish(code) ends it. */
function fakeSpawner () {
  const runs = []
  function spawnRefresh (seq) {
    let finish
    const exited = new Promise((resolve) => { finish = (code = 0, signal = null) => resolve({ code, signal }) })
    const child = { exitCode: null, signalCode: null, killed: [], kill (sig) { this.killed.push(sig) } }
    runs.push({ seq, finish, child })
    return { child, exited }
  }
  return { runs, spawnRefresh }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('HC_BUILD: unset / blank = trigger (the host file, unchanged default), container = in-container build, else refused', () => {
  assert.equal(buildMode({}), 'trigger')
  assert.equal(buildMode({ HC_BUILD: '  ' }), 'trigger')
  assert.equal(buildMode({ HC_BUILD: 'container' }), 'container')
  assert.throws(() => buildMode({ HC_BUILD: 'docker' }), /^Error: invalid HC_BUILD="docker"/)
  assert.deepEqual(buildConfig({}), { mode: 'trigger', siteDir: '/site', refreshMinutes: 60, dataDir: '/data', filesDir: null })
  assert.deepEqual(buildConfig({ HC_BUILD: 'container', HC_SITE_DIR: '/srv/site', HC_REFRESH_MINUTES: '15' }), { mode: 'container', siteDir: '/srv/site', refreshMinutes: 15, dataDir: '/data', filesDir: null })
  // the data root the files export lists (lib/paths.mjs: HC_DATA_DIR, files/ = HC_FILES_DIR when set; relative = against the repo root)
  assert.deepEqual(buildConfig({ HC_DATA_DIR: '/srv/data', HC_FILES_DIR: '/srv/files' }), { mode: 'trigger', siteDir: '/site', refreshMinutes: 60, dataDir: '/srv/data', filesDir: '/srv/files' })
  const rel = buildConfig({ HC_DATA_DIR: 'loop-data', HC_FILES_DIR: 'owner-files' })
  assert.equal(rel.dataDir, path.resolve(path.dirname(DEFAULT_REFRESH_SCRIPT), '..', 'loop-data'))
  assert.equal(rel.filesDir, path.resolve(path.dirname(DEFAULT_REFRESH_SCRIPT), '..', 'owner-files'))
  for (const v of ['0', '4', '2000', 'abc']) assert.throws(() => buildConfig({ HC_REFRESH_MINUTES: v }), /^Error: invalid HC_REFRESH_MINUTES=/, v)
})

test('a request while idle starts one child for that seq and resolves at once', async () => {
  const { runs, spawnRefresh } = fakeSpawner()
  const builder = createBuilder({ spawnRefresh, log: () => {} })
  await builder.writeTrigger(5)
  assert.deepEqual(runs.map((r) => r.seq), [5])
  runs[0].finish(0)
  await builder.idle()
})

test('requests during a build coalesce onto ONE follow-up run for the highest seq (never two children at once)', async () => {
  const { runs, spawnRefresh } = fakeSpawner()
  const builder = createBuilder({ spawnRefresh, log: () => {} })
  builder.request(1)
  builder.request(3)
  builder.request(2)
  builder.request(4)
  assert.equal(runs.length, 1, 'serialized')
  runs[0].finish(0)
  await tick(); await tick()
  assert.deepEqual(runs.map((r) => r.seq), [1, 4])
  runs[1].finish(0)
  await builder.idle()
  assert.equal(runs.length, 2)
})

test('a child that exits non-zero, dies on a signal or cannot start is reported as a failure for its seq', async () => {
  const { runs, spawnRefresh } = fakeSpawner()
  const failed = []
  const builder = createBuilder({ spawnRefresh, onFailure: async (seq) => { failed.push(seq) }, log: () => {} })
  builder.request(7)
  runs[0].finish(1)
  await builder.idle()
  builder.request(8)
  runs[1].finish(null, 'SIGKILL')
  await builder.idle()
  builder.request(9)
  runs[2].finish(0)
  await builder.idle()
  assert.deepEqual(failed, [7, 8])

  const throwing = createBuilder({ spawnRefresh: () => { throw new Error('EAGAIN') }, onFailure: async (seq) => { failed.push(seq) }, log: () => {} })
  throwing.request(10)
  await throwing.idle()
  assert.deepEqual(failed, [7, 8, 10])
})

test('the timer: one run after the boot delay, then one per interval, each for the CURRENT seq', async () => {
  const { runs, spawnRefresh } = fakeSpawner()
  const timeouts = []
  const intervals = []
  const builder = createBuilder({
    spawnRefresh,
    log: () => {},
    setTimer: (fn, ms) => { timeouts.push({ fn, ms }); return { unref () {} } },
    clearTimer: () => {},
    setRepeat: (fn, ms) => { intervals.push({ fn, ms }); return { unref () {} } },
    clearRepeat: () => {}
  })
  let seq = 12
  builder.startTimer({ intervalMs: 3_600_000, currentSeq: () => seq, bootDelayMs: 5000 })
  assert.equal(timeouts[0].ms, 5000)
  assert.equal(intervals[0].ms, 3_600_000)
  timeouts[0].fn()
  assert.deepEqual(runs.map((r) => r.seq), [12])
  runs[0].finish(0)
  await builder.idle()
  seq = 13
  intervals[0].fn()
  assert.deepEqual(runs.map((r) => r.seq), [12, 13])
  runs[1].finish(0)
  await builder.idle()
})

test('stop: the running child gets SIGTERM, nothing queued or requested afterwards runs', async () => {
  const { runs, spawnRefresh } = fakeSpawner()
  const builder = createBuilder({ spawnRefresh, log: () => {} })
  builder.request(1)
  builder.request(2)
  builder.stop()
  assert.deepEqual(runs[0].child.killed, ['SIGTERM'])
  builder.request(3)
  runs[0].finish(null, 'SIGTERM')
  await builder.idle()
  assert.deepEqual(runs.map((r) => r.seq), [1])
})

test('POST /sync in container mode: the seq protocol is unchanged, the build is started for the seq, a failed build shows as lastTriggerError build', async () => {
  const pool = { async query (sql) { return /FROM sync_status/.test(sql) ? { rows: [{ trigger_seq: 41 }] } : { rows: [] } } }
  const status = createSyncStatus({ pool, stravaConfigured: false, log: () => {} })
  await status.load()
  const { runs, spawnRefresh } = fakeSpawner()
  const builder = createBuilder({ spawnRefresh, onFailure: (seq) => status.recordTriggerError(seq, 'build'), log: () => {} })
  const trigger = createSyncTrigger({ runStrava: null, writeTrigger: builder.writeTrigger, status, log: () => {} })
  const routes = createSyncRoutes({ trigger, status })
  const res = { writeHead (s) { this.status = s }, end (p) { this.body = JSON.parse(p) } }
  await routes.handleSync({ headers: {} }, res)
  assert.equal(res.status, 202)
  assert.deepEqual(res.body, { ok: true, seq: 42, coalesced: false, strava: 'disabled' })
  assert.deepEqual(runs.map((r) => r.seq), [42])
  let snap = await status.snapshot()
  assert.equal(snap.lastTriggerError, null)
  runs[0].finish(1)
  await builder.idle()
  snap = await status.snapshot()
  assert.equal(snap.lastTriggerError, 'build')
  assert.equal(snap.lastTriggerErrorSeq, 42)
})

test('readPublishedSeq: processedSeq of <site>/status.json, 0 when missing or garbled', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'builder-site-'))
  try {
    assert.equal(await readPublishedSeq(dir), 0)
    writeFileSync(path.join(dir, 'status.json'), '{"publishedAt":"x","processedSeq":17}')
    assert.equal(await readPublishedSeq(dir), 17)
    writeFileSync(path.join(dir, 'status.json'), '{"processedSeq":-1}')
    assert.equal(await readPublishedSeq(dir), 0)
    writeFileSync(path.join(dir, 'status.json'), 'nope')
    assert.equal(await readPublishedSeq(dir), 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the real spawner runs `node <script> --seq N --wait-lock` from the repo root with INGEST_URL on loopback', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'builder-spawn-'))
  try {
    mkdirSync(path.join(root, 'scripts'))
    const script = path.join(root, 'scripts', 'refresh.mjs')
    const out = path.join(root, 'out.json')
    writeFileSync(script, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), url: process.env.INGEST_URL, site: process.env.HC_SITE_DIR })); process.exit(Number(process.argv[3]) === 2 ? 3 : 0)\n`)
    const spawnRefresh = createRefreshSpawner({ script, env: { PATH: process.env.PATH, HC_SITE_DIR: '/x/site' }, port: 9123, log: () => {} })
    const { exited } = spawnRefresh(1)
    assert.deepEqual(await exited, { code: 0, signal: null })
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { argv: ['--seq', '1', '--wait-lock'], cwd: root, url: 'http://127.0.0.1:9123', site: '/x/site' })
    assert.equal((await spawnRefresh(2).exited).code, 3)
    const missing = createRefreshSpawner({ script, nodePath: path.join(root, 'no-node'), env: {}, log: () => {} })
    assert.deepEqual(await missing(3).exited, { code: null, signal: null })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the default refresh script is the repo root scripts/refresh.mjs (the loop-server image layout)', () => {
  assert.match(DEFAULT_REFRESH_SCRIPT, /scripts[\\/]refresh\.mjs$/)
  assert.equal(path.basename(path.dirname(path.dirname(DEFAULT_REFRESH_SCRIPT))), path.basename(path.resolve(import.meta.dirname, '..', '..', '..')))
})

test('the refresh child gets an allowlisted environment: what refresh.mjs, the syncs and the build read, never the database password or the Strava secrets', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'builder-env-'))
  try {
    mkdirSync(path.join(root, 'scripts'))
    const script = path.join(root, 'scripts', 'refresh.mjs')
    const out = path.join(root, 'env.json')
    writeFileSync(script, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.env))\n`)
    const env = {
      PATH: process.env.PATH, HOME: '/home/node', TZ: 'Europe/Madrid', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=512',
      HC_BUILD: 'container', HC_DATA_DIR: '/data', HC_SITE_DIR: '/site', HC_VERSION: '1.0.0', HC_IMPORT_TIMEOUT: '1800', INGEST_TOKEN: 'tok', ASTRO_TELEMETRY_DISABLED: '1', LOCALE: 'es',
      POSTGRES_PASSWORD: 'secret-db', POSTGRES_USER: 'loop', DB_HOST: 'loop-db', STRAVA_CLIENT_SECRET: 'secret-strava', STRAVA_REFRESH_TOKEN: 'secret-refresh', STRAVA_CLIENT_ID: '1', FOOD_ALLOWED_HOSTS: 'x', DATABASE_URL: 'postgres://u:p@h/d'
    }
    assert.equal((await createRefreshSpawner({ script, env, port: 9124, log: () => {} })(1).exited).code, 0)
    const got = JSON.parse(readFileSync(out, 'utf8'))
    for (const k of ['PATH', 'HOME', 'TZ', 'LANG', 'LC_ALL', 'NODE_ENV', 'NODE_OPTIONS', 'HC_BUILD', 'HC_DATA_DIR', 'HC_SITE_DIR', 'HC_VERSION', 'HC_IMPORT_TIMEOUT', 'INGEST_TOKEN', 'ASTRO_TELEMETRY_DISABLED', 'LOCALE']) assert.equal(got[k], env[k], k)
    assert.equal(got.INGEST_URL, 'http://127.0.0.1:9124')
    for (const k of ['POSTGRES_PASSWORD', 'POSTGRES_USER', 'DB_HOST', 'STRAVA_CLIENT_SECRET', 'STRAVA_REFRESH_TOKEN', 'STRAVA_CLIENT_ID', 'FOOD_ALLOWED_HOSTS', 'DATABASE_URL']) assert.equal(got[k], undefined, k)
    assert.ok(!JSON.stringify(got).includes('secret'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
