import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBearerCheck } from './auth.js'
import { createStravaSync, startSyncLoop, isConfigured as stravaConfigured } from './sync.js'
import { createExportHandler, createStravaExportHandler } from './export.js'
import { createAthleteExportHandler } from './athlete.js'
import { createSyncStatus } from './status.js'
import { createTriggerWriter, createSyncTrigger, readTriggerSeq } from './trigger.js'
import { createSyncRoutes } from './sync-routes.js'
import { createFoodStore } from './food-db.js'
import { createFoodRoutes } from './food.js'
import { createOffClient } from './off.js'
import { createJournalStore } from './journal-db.js'
import { createJournalRoutes } from './journal.js'
import { writeJson as send, parseAllowedHosts } from './http.js'

/**
 * Read the body with a hard ceiling. Health Auto Export can be told to batch
 * requests, so rejecting an oversized upload is preferable to buffering it. A
 * declared Content-Length over the cap is refused before reading; a streamed body
 * stops being buffered at the cap. Either way the caller answers 413 and only then
 * closes the socket (see the catch in createHandler), so the client gets a response.
 */
function readBody (req, limit) {
  const tooLarge = () => Object.assign(new Error('payload too large'), { status: 413 })
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) return Promise.reject(tooLarge())
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let over = false

    req.on('data', (chunk) => {
      if (over) return
      size += chunk.length
      if (size > limit) {
        over = true
        chunks.length = 0
        reject(tooLarge())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)) })
    req.on('error', reject)
  })
}

/** Whether any string (value or object key) in a parsed JSON value holds U+0000. Iterative: no recursion limit. */
export function containsNul (value) {
  const stack = [value]
  while (stack.length > 0) {
    const v = stack.pop()
    if (typeof v === 'string') {
      if (v.includes('\0')) return true
    } else if (Array.isArray(v)) {
      for (const item of v) stack.push(item)
    } else if (v !== null && typeof v === 'object') {
      for (const [k, item] of Object.entries(v)) {
        if (k.includes('\0')) return true
        stack.push(item)
      }
    }
  }
  return false
}

/** The upload ceiling: MAX_BODY_BYTES, else 8 MB, the most loop-web forwards (its client_max_body_size 8m). */
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024
export function maxBodyBytes (env) {
  return Number(env.MAX_BODY_BYTES ?? DEFAULT_MAX_BODY_BYTES)
}

/**
 * The request listener, with every dependency injected so the route table can be tested without
 * Postgres, Strava or the network (test/server.test.js). main() below wires the real ones.
 */
export function createHandler ({
  token,
  // one checker for every bearer route, so its failure count covers them all (auth.js)
  checkBearer = createBearerCheck(token),
  maxBodyBytes,
  pool,
  ping,
  insertRawPayload,
  syncStatus,
  stravaEnabled,
  stravaSync,
  foodRoutes,
  journalRoutes = { handle: async () => false },
  syncRoutes,
  handleExport,
  handleStravaExport,
  handleAthleteExport
}) {
  async function handleIngest (req, res, source) {
    if (!checkBearer(req)) {
      send(res, 401, { error: 'unauthorized' })
      return
    }

    const raw = await readBody(req, maxBodyBytes)
    if (raw.length === 0) {
      send(res, 400, { error: 'empty body' })
      return
    }

    let payload
    try {
      payload = JSON.parse(raw.toString('utf8'))
    } catch {
      send(res, 400, { error: 'body is not valid JSON' })
      return
    }
    // Valid JSON, but Postgres jsonb cannot store U+0000 ("unsupported Unicode escape sequence"): refuse it as
    // the client's error instead of a 500 the app would retry forever. Not stripped: raw_payload keeps what
    // was sent, byte for byte, or nothing.
    if (containsNul(payload)) {
      send(res, 400, { error: 'body contains a \\u0000 character, which cannot be stored', code: 'nul_character' })
      return
    }

    const saved = await insertRawPayload(pool, {
      source,
      automation: req.headers['automation-name'] ?? null,
      aggregation: req.headers['automation-aggregation'] ?? null,
      period: req.headers['automation-period'] ?? null,
      sessionId: req.headers['session-id'] ?? null,
      byteSize: raw.length,
      payload
    })

    // Log shape only — never payload contents.
    console.log(
      JSON.stringify({
        event: 'ingested',
        id: saved.id,
        source,
        bytes: raw.length,
        automation: req.headers['automation-name'] ?? null
      })
    )

    send(res, 202, { ok: true, id: String(saved.id), received_at: saved.received_at })
  }

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost')

    try {
      if (req.method === 'GET' && url.pathname === '/healthz') {
        await ping(pool)
        // Still 200 when degraded: the container is alive and ingesting; the flag
        // says the Strava pull has not succeeded for 6 h (see status.js).
        send(res, 200, { ok: true, strava: stravaEnabled ? 'enabled' : 'disabled', ...syncStatus.health() })
        return
      }

      if (await foodRoutes.handle(req, res, url)) return
      if (await journalRoutes.handle(req, res, url)) return

      if (req.method === 'POST' && url.pathname === '/sync') {
        req.resume() // any body is ignored: drain it, never buffer it
        syncRoutes.handleSync(req, res)
        return
      }

      if (req.method === 'GET' && url.pathname === '/sync/status') {
        await syncRoutes.handleStatus(req, res)
        return
      }

      if (req.method === 'POST' && url.pathname === '/ingest/health-auto-export') {
        await handleIngest(req, res, 'health-auto-export')
        return
      }

      if (req.method === 'GET' && url.pathname === '/export/raw') {
        await handleExport(req, res, url)
        return
      }

      if (req.method === 'GET' && url.pathname === '/export/strava') {
        await handleStravaExport(req, res, url)
        return
      }

      if (req.method === 'GET' && url.pathname === '/export/athlete') {
        await handleAthleteExport(req, res)
        return
      }

      if (req.method === 'POST' && url.pathname === '/sync/strava') {
        if (!checkBearer(req)) {
          send(res, 401, { error: 'unauthorized' })
          return
        }
        if (!stravaSync) {
          send(res, 409, { error: 'strava not configured' })
          return
        }
        const { count } = await stravaSync.runOnce()
        send(res, 200, { ok: true, activities: count })
        return
      }

      send(res, 404, { error: 'not found' })
    } catch (err) {
      const status = err.status ?? 500
      if (status >= 500) console.error(JSON.stringify({ event: 'error', message: err.message }))
      if (res.headersSent) return
      if (status === 413) {
        // the response first, then drop the connection (the rest of the upload is never read)
        res.on('finish', () => req.destroy())
        send(res, 413, { error: 'payload too large' }, { connection: 'close' })
        return
      }
      send(res, status, { error: 'internal error' })
    }
  }
}

/**
 * The database connection from the environment. DATABASE_URL wins when set (a connection string: any special
 * character in its password must be percent-encoded). Otherwise DB_HOST (+ DB_PORT, default 5432) with the
 * same POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB the database container gets, passed to the driver as
 * separate fields, so a password with @ : / ? # % needs no encoding (docker-compose.yml does this). null when
 * neither is complete.
 */
export function databaseConfig (env) {
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL }
  const { DB_HOST: host, POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: database } = env
  if (!host || !user || !password || !database) return null
  return { host, port: Number(env.DB_PORT || 5432), user, password, database }
}

/** How long a SIGTERM waits for in-flight requests before closing them (below the compose stop_grace_period). */
export const SHUTDOWN_DEADLINE_MS = 10_000
const POOL_END_CAP_MS = 2_000

/**
 * The SIGTERM / SIGINT handler: stop the background loops, stop accepting (closing idle keep-alive
 * connections), let in-flight requests finish for up to `deadlineMs`, then close whatever is left, wait for
 * `flush` (the pending trigger write, capped by the caller), close the pool (capped at 2 s) and exit 0. A
 * second signal returns the same shutdown.
 */
export function createShutdown ({ server, pool, stop = () => {}, flush = async () => {}, deadlineMs = SHUTDOWN_DEADLINE_MS, exit = (code) => process.exit(code), log = console.log }) {
  let running = null
  const capped = (promise, ms) => {
    let timer
    return Promise.race([Promise.resolve(promise).catch(() => {}), new Promise((resolve) => { timer = setTimeout(resolve, ms) })]).finally(() => clearTimeout(timer))
  }
  return function shutdown () {
    if (running) return running
    log(JSON.stringify({ event: 'shutdown', deadlineMs }))
    running = (async () => {
      stop()
      const flushed = flush()
      const drained = new Promise((resolve) => server.close(() => resolve(true)))
      server.closeIdleConnections?.()
      let timer
      const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(false), deadlineMs) })
      const clean = await Promise.race([drained, deadline])
      clearTimeout(timer)
      if (!clean) {
        log(JSON.stringify({ event: 'shutdown_deadline', deadlineMs }))
        server.closeAllConnections?.()
      }
      await Promise.resolve(flushed).catch(() => {})
      await capped(pool.end(), POOL_END_CAP_MS)
      exit(0)
    })()
    return running
  }
}

const PORT = Number(process.env.PORT ?? 8088)
const MAX_BODY_BYTES = maxBodyBytes(process.env)
const INGEST_TOKEN = process.env.INGEST_TOKEN

async function main () {
  if (!INGEST_TOKEN || INGEST_TOKEN.length < 32) {
    console.error('INGEST_TOKEN missing or shorter than 32 characters')
    process.exit(1)
  }
  const database = databaseConfig(process.env)
  if (!database) {
    console.error('database settings missing: set DB_HOST, POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB (docker-compose.yml does), or DATABASE_URL')
    process.exit(1)
  }

  // loaded here, not at the top: db.js pulls in the pg driver, which the test run does not install
  const { createPool, migrate, insertRawPayload, ping } = await import('./db.js')
  const pool = createPool(database)
  // one bearer checker for every token route: its `unauthorized` log lines carry one running count
  const checkBearer = createBearerCheck(INGEST_TOKEN)
  const handleExport = createExportHandler({ pool, token: INGEST_TOKEN, checkBearer })
  const handleStravaExport = createStravaExportHandler({ pool, token: INGEST_TOKEN, checkBearer })
  const handleAthleteExport = createAthleteExportHandler({ pool, token: INGEST_TOKEN, checkBearer })

  // Strava is optional: without credentials the service still ingests Apple Health.
  const STRAVA_ENABLED = stravaConfigured(process.env)
  // POST /sync writes TRIGGER_DIR/refresh (see below); its sequence number seeds
  // the status so the sequence never goes backwards even if the DB row is lost.
  const TRIGGER_DIR = process.env.TRIGGER_DIR ?? '/trigger'
  const syncStatus = createSyncStatus({
    pool,
    stravaConfigured: STRAVA_ENABLED,
    readTriggerSeq: () => readTriggerSeq(TRIGGER_DIR)
  })
  const stravaSync = STRAVA_ENABLED ? createStravaSync(pool, process.env, { status: syncStatus }) : null
  let stravaLoop = null

  // On-demand refresh, sequence protocol: POST /sync assigns a sequence number,
  // kicks the (shared, never overlapping) Strava pull unless one succeeded in the
  // last 5 min, then atomically writes `seq` to TRIGGER_DIR/refresh, which the
  // host watches with a systemd path unit to rebuild the plan page. Repeated
  // clicks coalesce (never 429); a click inside the 60 s window after a finished
  // write gets a deferred seq, written when the window closes, so a Shortcut
  // payload that lands right after a rebuild still gets published.
  // Unauthenticated; see sync-routes.js.
  const syncTrigger = createSyncTrigger({
    runStrava: stravaSync ? () => stravaSync.runOnce() : null,
    writeTrigger: createTriggerWriter({ dir: TRIGGER_DIR }),
    status: syncStatus
  })
  const syncRoutes = createSyncRoutes({ status: syncStatus, trigger: syncTrigger })

  // Food log (docs/nutrition-food-log.md): products, recipes, the daily log and a server-side Open Food Facts
  // lookup under /food/*. Unauthenticated and LAN-only like /sync (a static page cannot hold a
  // secret). A Host allowlist (DNS rebinding), an Origin check on writes and the required X-HC-Food
  // header + JSON content type (a CORS preflight this server never approves) keep other websites out;
  // see food.js. A public proxy must never forward /food/*.
  // FOOD_ALLOWED_HOSTS: extra host names (besides IP literals, localhost, host.docker.internal) the
  // page may be reached by; mirrors loop-web's PLAN_WEB_EXTRA_HOSTS. Empty by default.
  let foodReady = false // set once 006_food.sql ran; until then (or if it failed) /food/* answers 503
  let settingsReady = false // 007_settings.sql, its own group: only /food/settings depends on it
  let profileReady = false // 011_profile.sql, its own group: only /food/profile depends on it
  const foodRoutes = createFoodRoutes({
    store: createFoodStore(pool),
    off: createOffClient(),
    available: () => foodReady,
    settingsAvailable: () => settingsReady,
    profileAvailable: () => profileReady,
    allowedHosts: parseAllowedHosts(process.env.FOOD_ALLOWED_HOSTS)
  })
  // Behaviour journal (Q7) under /journal/*: same LAN-only layers as the food routes (its own
  // X-HC-Journal header), its own optional migration group (010_journal.sql) -> 503 until it ran.
  let journalReady = false
  const journalRoutes = createJournalRoutes({
    store: createJournalStore(pool),
    available: () => journalReady,
    allowedHosts: parseAllowedHosts(process.env.FOOD_ALLOWED_HOSTS)
  })

  const server = http.createServer(createHandler({
    token: INGEST_TOKEN,
    checkBearer,
    maxBodyBytes: MAX_BODY_BYTES,
    pool,
    ping,
    insertRawPayload,
    syncStatus,
    stravaEnabled: STRAVA_ENABLED,
    stravaSync,
    foodRoutes,
    journalRoutes,
    syncRoutes,
    handleExport,
    handleStravaExport,
    handleAthleteExport
  }))

  async function start () {
    // a failing optional migration is logged (<group>_migration_failed) and only disables its routes:
    // the food tables -> /food/* (but /food/settings), the settings table -> /food/settings
    const optional = await migrate(pool)
    foodReady = optional.food === true
    settingsReady = optional.settings === true
    profileReady = optional.profile === true
    journalReady = optional.journal === true
    await syncStatus.load() // never throws: a failed load is retried on the next status read
    // A seq handed out but never written (crash before the write) leaves the DB
    // ahead of the trigger file: write it once, shortly after boot, so the host
    // rebuild processes it and a waiting client completes.
    syncTrigger.recover({
      fileSeq: await readTriggerSeq(TRIGGER_DIR),
      lastWrittenAt: syncStatus.lastTriggerAtMs()
    })
    if (stravaSync) {
      stravaLoop = startSyncLoop(stravaSync, {
        intervalMinutes: Number(process.env.STRAVA_SYNC_MINUTES ?? 30)
      })
    }
    server.listen(PORT, () =>
      console.log(JSON.stringify({ event: 'listening', port: PORT, strava: STRAVA_ENABLED })))
  }

  // Graceful stop (docker compose stop / restart sends SIGTERM): stop the Strava loop, stop accepting, let
  // in-flight requests finish for up to SHUTDOWN_DEADLINE_MS, close the pool, exit. Meanwhile a pending
  // deferred seq is written and an in-flight run may finish; if it outlives flush's own 2 s budget, flush
  // writes the persisted seq directly (no Strava pull). Hard-capped at 3 s: a stuck write must not block
  // shutdown (boot recovery and the hourly refresh are the fallbacks).
  const shutdown = createShutdown({
    server,
    pool,
    stop: () => stravaLoop?.stop(),
    flush: () => Promise.race([syncTrigger.flush(), new Promise((resolve) => setTimeout(resolve, 3_000).unref())])
  })
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, shutdown)

  start().catch((err) => {
    console.error(JSON.stringify({ event: 'startup_failed', message: err.message }))
    process.exit(1)
  })
}

// Only when run as the entry point (node src/server.js): importing the module (tests) has no side
// effects — no env checks, no pg driver, no pool, no listener.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((err) => {
    console.error(JSON.stringify({ event: 'startup_failed', message: err.message }))
    process.exit(1)
  })
}
