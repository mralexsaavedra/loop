import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBearerCheck } from './auth.js'
import { createStravaSync, startSyncLoop, isConfigured as stravaConfigured } from './sync.js'
import { createExportHandler, createStravaExportHandler, createGarminExportHandler } from './export.js'
import { createGarminSync, startGarminLoop, DEFAULT_GARMIN_SYNC_MINUTES } from './garmin-sync.js'
import { isGarminConfigured, garminKeyExpires } from './garmin.js'
import { createAthleteExportHandler } from './athlete.js'
import { createSyncStatus } from './status.js'
import { createTriggerWriter, createSyncTrigger, readTriggerSeq } from './trigger.js'
import { createSyncRoutes } from './sync-routes.js'
import { buildMode, createBuilder, createRefreshSpawner, readPublishedSeq, DEFAULT_SITE_DIR, DEFAULT_REFRESH_SCRIPT } from './builder.js'
import { createFoodStore } from './food-db.js'
import { createFoodRoutes } from './food.js'
import { createOffClient } from './off.js'
import { createJournalStore } from './journal-db.js'
import { createJournalRoutes } from './journal.js'
import { writeJson as send, parseAllowedHosts, containsNul } from './http.js'
import { createDocumentStore } from './documents-db.js'
import { moveIdentityToDocument } from './profile-db.js'
import { createDocumentRoutes } from './documents.js'
import { createFilesExportRoutes } from './files-export.js'
import { createActivityAnnotator, createStravaAnnotateRoutes } from './strava-annotate.js'

/** @typedef {import('node:http').IncomingMessage} Req @typedef {import('node:http').ServerResponse} Res */
/** The environment (process.env, or a test's object). @typedef {Record<string, string | undefined>} Env */
/** @typedef {import('./db.js').Queryable} Queryable */

/**
 * Read the body with a hard ceiling. Health Auto Export can be told to batch
 * requests, so rejecting an oversized upload is preferable to buffering it. A
 * declared Content-Length over the cap is refused before reading; a streamed body
 * stops being buffered at the cap. Either way the caller answers 413 and only then
 * closes the socket (see the catch in createHandler), so the client gets a response.
 * @param {Req} req @param {number} limit @returns {Promise<Buffer>}
 */
function readBody (req, limit) {
  const tooLarge = () => Object.assign(new Error('payload too large'), { status: 413 })
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) return Promise.reject(tooLarge())
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    let over = false

    req.on('data', (/** @type {Buffer} */ chunk) => {
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

// containsNul lives in http.js (documents.js shares it); re-exported for the existing importers
export { containsNul }

/** The data root of the loop-server image (its HC_DATA_DIR) when HC_DATA_DIR is unset. */
export const DEFAULT_DATA_DIR = '/data'

/** The upload ceiling: MAX_BODY_BYTES, else 8 MB, the most loop-web forwards (its client_max_body_size 8m). */
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024
/** @param {Env} env */
export function maxBodyBytes (env) {
  return numericEnv(env, 'MAX_BODY_BYTES', { def: DEFAULT_MAX_BODY_BYTES, min: 1024, max: 1024 * 1024 * 1024, integer: true })
}

/**
 * A numeric environment variable. Unset or blank = `def`; otherwise a plain decimal number (no unit, no hex)
 * within [min, max] (and whole when `integer`), else an Error `invalid NAME=<value>: ...` that main() turns into
 * one startup_failed line: a typo ('8m', 'abc', 0) must stop the service, never silently disable a limit (NaN)
 * or spin a timer (a 0-minute interval).
 * @param {Env} env @param {string} name
 * @param {{ def: number, min: number, max: number, integer?: boolean }} range
 * @returns {number}
 */
export function numericEnv (env, name, { def, min, max, integer = false }) {
  const raw = env[name]
  if (raw === undefined || String(raw).trim() === '') return def
  const s = String(raw).trim()
  const n = /^[+]?(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new Error(`invalid ${name}=${JSON.stringify(String(raw)).slice(0, 40)}: expected ${integer ? 'an integer' : 'a number'} from ${min} to ${max}`)
  }
  return n
}

/** The numeric settings main() reads (each through numericEnv; throws on the first invalid one). @param {Env} env */
export function envConfig (env) {
  return {
    port: numericEnv(env, 'PORT', { def: 8088, min: 1, max: 65_535, integer: true }),
    maxBodyBytes: maxBodyBytes(env),
    // at least a minute (Strava's rate limits), at most a week (setInterval overflows past ~24.8 days)
    stravaSyncMinutes: numericEnv(env, 'STRAVA_SYNC_MINUTES', { def: 30, min: 1, max: 10_080 })
  }
}

/**
 * The optional Garmin source (garmin-sync.js): `enabled` with a non-blank GARMIN_API_KEY; `syncMinutes` =
 * GARMIN_SYNC_MINUTES (default 60, 1-10080, checked only when enabled, so an install without Garmin never fails on
 * it); `keyExpires` = GARMIN_API_KEY_EXPIRES as YYYY-MM-DD, else null. The key itself is not returned: only
 * createGarminSync reads it. Throws on an invalid interval, like envConfig.
 * @param {Env} env
 */
export function garminConfig (env) {
  const enabled = isGarminConfigured(env)
  return {
    enabled,
    syncMinutes: enabled ? numericEnv(env, 'GARMIN_SYNC_MINUTES', { def: DEFAULT_GARMIN_SYNC_MINUTES, min: 1, max: 10_080 }) : DEFAULT_GARMIN_SYNC_MINUTES,
    keyExpires: enabled ? garminKeyExpires(env) : null
  }
}

/**
 * How the page gets rebuilt (builder.js): `mode` 'trigger' (HC_BUILD unset: write TRIGGER_DIR/refresh for the host)
 * or 'container' (HC_BUILD=container: run scripts/refresh.mjs in this container, publishing into `siteDir` =
 * HC_SITE_DIR, default /site, on POST /sync and every `refreshMinutes` = HC_REFRESH_MINUTES, default 60, 5-1440).
 * `dataDir` / `filesDir`: the data root the container-mode files export lists (files-export.js), as lib/paths.mjs
 * resolves it: HC_DATA_DIR (default /data, the image's), files/ = HC_FILES_DIR when set (else null = <dataDir>/files);
 * a relative value resolves against the repo root the image ships (/app).
 * Throws on an invalid value, like envConfig.
 * @param {Env} env
 */
export function buildConfig (env) {
  const mode = buildMode(env)
  const repoRoot = path.resolve(path.dirname(DEFAULT_REFRESH_SCRIPT), '..')
  const setting = (/** @type {string} */ name) => String(env[name] ?? '').trim()
  return {
    mode,
    siteDir: setting('HC_SITE_DIR') || DEFAULT_SITE_DIR,
    refreshMinutes: numericEnv(env, 'HC_REFRESH_MINUTES', { def: 60, min: 5, max: 1440 }),
    dataDir: path.resolve(repoRoot, setting('HC_DATA_DIR') || DEFAULT_DATA_DIR),
    filesDir: setting('HC_FILES_DIR') ? path.resolve(repoRoot, setting('HC_FILES_DIR')) : null
  }
}

/**
 * The request listener, with every dependency injected so the route table can be tested without
 * Postgres, Strava or the network (test/server.test.js). main() below wires the real ones.
 */
/** A route module: `handle(req, res, url)` answers and resolves true, or resolves false (the caller keeps routing).
 * @typedef {{ handle: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL) => Promise<boolean> }} RouteModule */
/** The default for an optional route module: handles nothing. @type {RouteModule} */
const NO_ROUTES = { handle: async () => false }

/**
 * createHandler's dependencies (main() wires the real ones, tests fakes).
 * @typedef {{
 *   token?: string | null, checkBearer?: (req: Req) => boolean, maxBodyBytes: number, pool: Queryable,
 *   ping: (pool: Queryable) => Promise<unknown>,
 *   insertRawPayload: (pool: Queryable, record: import('./raw-payload-db.js').RawPayloadRecord) => Promise<{ id: string | number, received_at: unknown }>,
 *   syncStatus: { health: () => object }, stravaEnabled: boolean, stravaSync: { runOnce: () => Promise<{ count: number }> } | null,
 *   garminEnabled?: boolean, garminSync?: { runOnce: () => Promise<{ count: number }> } | null, garminAvailable?: () => boolean,
 *   handleGarminExport?: (req: Req, res: Res, url: URL) => Promise<void>,
 *   foodRoutes: RouteModule, journalRoutes?: RouteModule, documentRoutes?: RouteModule, filesExportRoutes?: RouteModule,
 *   stravaAnnotateRoutes?: RouteModule,
 *   syncRoutes: { handleSync: (req: Req, res: Res) => unknown, handleStatus: (req: Req, res: Res) => Promise<void> },
 *   handleExport: (req: Req, res: Res, url: URL) => Promise<void>, handleStravaExport: (req: Req, res: Res, url: URL) => Promise<void>,
 *   handleAthleteExport: (req: Req, res: Res) => Promise<void>
 * }} HandlerDeps
 */

/** @param {HandlerDeps} deps @returns {(req: Req, res: Res) => Promise<void>} */
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
  journalRoutes = NO_ROUTES,
  documentRoutes = NO_ROUTES,
  // container mode only (files-export.js); outside it nothing handles /export/files, so it is the plain 404
  filesExportRoutes = NO_ROUTES,
  // POST /strava/activities/:id/annotate (strava-annotate.js); absent in tests that do not exercise it
  stravaAnnotateRoutes = NO_ROUTES,
  syncRoutes,
  handleExport,
  handleStravaExport,
  handleAthleteExport,
  // the optional Garmin source (garmin-sync.js); absent = not configured
  garminEnabled = false,
  garminSync = null,
  garminAvailable = () => false,
  handleGarminExport = createGarminExportHandler({ pool, token: token ?? '', configured: false, available: () => false, checkBearer })
}) {
  /** @param {Req} req @param {Res} res @param {string} source */
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
    // a server request always carries its url
    const url = new URL(/** @type {string} */ (req.url), 'http://localhost')

    try {
      if (req.method === 'GET' && url.pathname === '/healthz') {
        await ping(pool)
        // Still 200 when degraded: the container is alive and ingesting; the flag
        // says the Strava pull has not succeeded for 6 h (see status.js).
        send(res, 200, { ok: true, strava: stravaEnabled ? 'enabled' : 'disabled', garmin: garminEnabled ? 'enabled' : 'disabled', ...syncStatus.health() })
        return
      }

      if (await foodRoutes.handle(req, res, url)) return
      if (await journalRoutes.handle(req, res, url)) return
      if (await documentRoutes.handle(req, res, url)) return
      if (await filesExportRoutes.handle(req, res, url)) return
      if (await stravaAnnotateRoutes.handle(req, res, url)) return

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

      if (req.method === 'GET' && url.pathname === '/export/garmin') {
        await handleGarminExport(req, res, url)
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

      if (req.method === 'POST' && url.pathname === '/sync/garmin') {
        if (!checkBearer(req)) {
          send(res, 401, { error: 'unauthorized' })
          return
        }
        if (!garminSync) {
          send(res, 409, { error: 'garmin not configured' })
          return
        }
        if (!garminAvailable()) {
          send(res, 503, { error: 'garmin_unavailable' })
          return
        }
        const { count } = await garminSync.runOnce()
        send(res, 200, { ok: true, activities: count })
        return
      }

      send(res, 404, { error: 'not found' })
    } catch (err) {
      // readBody's 413 carries a status; anything else is a 500
      const e = /** @type {Error & { status?: number }} */ (err)
      const status = e.status ?? 500
      if (status >= 500) console.error(JSON.stringify({ event: 'error', message: e.message }))
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
 * @param {Env} env
 */
export function databaseConfig (env) {
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL }
  const { DB_HOST: host, POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: database } = env
  if (!host || !user || !password || !database) return null
  return { host, port: numericEnv(env, 'DB_PORT', { def: 5432, min: 1, max: 65_535, integer: true }), user, password, database }
}

/** How long a SIGTERM waits for in-flight requests before closing them (below the compose stop_grace_period). */
export const SHUTDOWN_DEADLINE_MS = 10_000
const POOL_END_CAP_MS = 2_000

/**
 * The SIGTERM / SIGINT handler: stop the background loops, stop accepting (closing idle keep-alive
 * connections), let in-flight requests finish for up to `deadlineMs`, then close whatever is left, wait for
 * `flush` (the pending trigger write, capped by the caller), close the pool (capped at 2 s) and exit 0. A
 * second signal returns the same shutdown.
 * @param {{ server: Pick<http.Server, 'close' | 'closeIdleConnections' | 'closeAllConnections'>, pool: { end: () => Promise<unknown> },
 *   stop?: () => void, flush?: () => unknown, deadlineMs?: number, exit?: (code: number) => void, log?: (line: string) => void }} deps
 */
export function createShutdown ({ server, pool, stop = () => {}, flush = async () => {}, deadlineMs = SHUTDOWN_DEADLINE_MS, exit = (code) => process.exit(code), log = console.log }) {
  /** @type {Promise<void> | null} */
  let running = null
  const capped = (/** @type {unknown} */ promise, /** @type {number} */ ms) => {
    /** @type {NodeJS.Timeout | undefined} */
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
      /** @type {NodeJS.Timeout | undefined} */
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

const INGEST_TOKEN = process.env.INGEST_TOKEN

async function main () {
  // a numeric variable that is set but invalid throws here: one startup_failed line, exit 1 (the catch below)
  const { port: PORT, maxBodyBytes: MAX_BODY_BYTES, stravaSyncMinutes } = envConfig(process.env)
  const build = buildConfig(process.env)
  const garmin = garminConfig(process.env)
  // container mode needs the repo's refresh script next to the service (the loop-server image); the plain
  // loop-ingest image does not ship it, so HC_BUILD=container there is a configuration error, not a failing build
  if (build.mode === 'container' && !fs.existsSync(DEFAULT_REFRESH_SCRIPT)) {
    throw new Error(`HC_BUILD=container needs ${DEFAULT_REFRESH_SCRIPT} (the loop-server image); this image only supports the trigger file`)
  }
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
  // In container mode there is no trigger file: the last publish's processedSeq (HC_SITE_DIR/status.json) seeds it.
  const TRIGGER_DIR = process.env.TRIGGER_DIR ?? '/trigger'
  const container = build.mode === 'container'
  const fileSeq = () => (container ? readPublishedSeq(build.siteDir) : readTriggerSeq(TRIGGER_DIR))
  const syncStatus = createSyncStatus({
    pool,
    stravaConfigured: STRAVA_ENABLED,
    garminConfigured: garmin.enabled,
    garminKeyExpires: garmin.keyExpires,
    readTriggerSeq: fileSeq
  })
  const stravaSync = STRAVA_ENABLED ? createStravaSync(pool, process.env, { status: syncStatus }) : null
  /** @type {ReturnType<typeof startSyncLoop> | null} */
  let stravaLoop = null

  // Garmin is optional too (GARMIN_API_KEY; docs/lan-services.md -> Garmin): its own loop, guard and status fields,
  // so a refused key or Garmin being down never touches Strava, the build or another route. Its tables are an
  // optional migration group: until 015_garmin.sql ran (or if it failed) the loop stays off and its routes answer 503.
  let garminReady = false
  const garminSync = garmin.enabled ? createGarminSync(pool, process.env, { status: syncStatus }) : null
  /** @type {ReturnType<typeof startGarminLoop> | null} */
  let garminLoop = null
  const handleGarminExport = createGarminExportHandler({ pool, token: INGEST_TOKEN, configured: garmin.enabled, available: () => garminReady, checkBearer })

  // On-demand refresh, sequence protocol: POST /sync assigns a sequence number,
  // kicks the (shared, never overlapping) Strava pull unless one succeeded in the
  // last 5 min, then atomically writes `seq` to TRIGGER_DIR/refresh, which the
  // host watches with a systemd path unit to rebuild the plan page. Repeated
  // clicks coalesce (never 429); a click inside the 60 s window after a finished
  // write gets a deferred seq, written when the window closes, so a Shortcut
  // payload that lands right after a rebuild still gets published.
  // Unauthenticated; see sync-routes.js.
  // Container mode (HC_BUILD=container, builder.js): the writer runs the in-container build for the seq instead,
  // one child at a time, clicks during a build coalescing onto one follow-up run; a failed build is reported as
  // lastTriggerError 'build'. The same seq protocol, coalescing and deferral apply (createSyncTrigger is unchanged).
  const builder = container
    ? createBuilder({
      spawnRefresh: createRefreshSpawner({ env: { ...process.env, HC_SITE_DIR: build.siteDir }, port: PORT }),
      onFailure: (seq) => syncStatus.recordTriggerError(seq, 'build')
    })
    : null
  const syncTrigger = createSyncTrigger({
    runStrava: stravaSync ? () => stravaSync.runOnce() : null,
    runGarmin: garminSync ? () => (garminReady ? garminSync.runOnce() : undefined) : null,
    writeTrigger: builder ? builder.writeTrigger : createTriggerWriter({ dir: TRIGGER_DIR }),
    status: syncStatus
  })
  const syncRoutes = createSyncRoutes({ status: syncStatus, trigger: syncTrigger })

  // Food log (docs/nutrition-food-log.md): products, recipes, the daily log and a server-side Open Food Facts
  // lookup under /food/*. Unauthenticated and LAN-only like /sync (a static page cannot hold a
  // secret). A Host allowlist (DNS rebinding), an Origin check on writes and the required X-HC-Food
  // header + JSON content type (a CORS preflight this server never approves) keep other websites out;
  // see food.js. A public proxy must never forward /food/*.
  // FOOD_ALLOWED_HOSTS: extra host names (besides IP literals, localhost, loop-ingest, host.docker.internal) the
  // page may be reached by; mirrors loop-web's PLAN_WEB_EXTRA_HOSTS. Empty by default.
  let foodReady = false // set once 006_food.sql ran; until then (or if it failed) /food/* answers 503
  let settingsReady = false // 007_settings.sql, its own group: only /food/settings depends on it
  let profileReady = false // 011_profile.sql + 012_documents.sql (the identity's profile document): only /food/profile depends on it
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

  // The owner's plan, training program and profile (sql/012_documents.sql) under /documents/:kind: bearer
  // token only, like /export/* (the coach and the server's own build are the clients, never the page), so
  // loop-web's nginx never proxies them. Its own optional group -> 503 until 012 ran. See documents.js.
  let documentsReady = false
  const documentRoutes = createDocumentRoutes({
    store: createDocumentStore(pool),
    available: () => documentsReady,
    checkBearer
  })

  // The processed data a coach clone mirrors (files-export.js): GET /export/files + /export/file, bearer token only,
  // container mode only (the server owns the data root there); loop-web's nginx never proxies them.
  const filesExportRoutes = createFilesExportRoutes({
    available: () => container,
    dataDir: build.dataDir,
    filesDir: build.filesDir,
    siteDir: build.siteDir,
    checkBearer
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
    documentRoutes,
    filesExportRoutes,
    stravaAnnotateRoutes: createStravaAnnotateRoutes({
      checkBearer,
      annotate: stravaSync ? createActivityAnnotator({ getAccessToken: stravaSync.getAccessToken, pool }) : null
    }),
    syncRoutes,
    handleExport,
    handleStravaExport,
    handleAthleteExport,
    garminEnabled: garmin.enabled,
    garminSync,
    garminAvailable: () => garminReady,
    handleGarminExport
  }))

  async function start () {
    // a failing optional migration is logged (<group>_migration_failed) and only disables its routes:
    // the food tables -> /food/* (but /food/settings), the settings table -> /food/settings
    const optional = await migrate(pool)
    foodReady = optional.food === true
    settingsReady = optional.settings === true
    journalReady = optional.journal === true
    documentsReady = optional.documents === true
    garminReady = optional.garmin === true
    // the onboarding needs both of its tables: app_profile (011) and the profile document (012) that holds the
    // identity; an onboarding row from before that layout moves its identity there first (profile-db.js)
    if (optional.profile === true && documentsReady) {
      try {
        await moveIdentityToDocument(pool)
        profileReady = true
      } catch (err) {
        console.error(JSON.stringify({ event: 'profile_identity_move_failed', message: /** @type {Error} */ (err).message }))
      }
    }
    await syncStatus.load() // never throws: a failed load is retried on the next status read
    // A seq handed out but never written (crash before the write) leaves the DB
    // ahead of the trigger file: write it once, shortly after boot, so the host
    // rebuild processes it and a waiting client completes.
    // Container mode needs no recovery: the boot build (builder.startTimer, after listen) publishes the current seq.
    if (!builder) {
      syncTrigger.recover({
        fileSeq: await fileSeq(),
        lastWrittenAt: syncStatus.lastTriggerAtMs()
      })
    }
    if (stravaSync) {
      stravaLoop = startSyncLoop(stravaSync, {
        intervalMinutes: stravaSyncMinutes
      })
    }
    if (garminSync && garminReady) {
      garminLoop = startGarminLoop(garminSync, { intervalMinutes: garmin.syncMinutes })
    }
    server.listen(PORT, () => {
      console.log(JSON.stringify({ event: 'listening', port: PORT, strava: STRAVA_ENABLED, garmin: garmin.enabled, build: build.mode }))
      // after listen: the build's syncs call back into this service
      builder?.startTimer({ intervalMs: build.refreshMinutes * 60_000, currentSeq: () => syncStatus.currentSeq() })
    })
  }

  // Graceful stop (docker compose stop / restart sends SIGTERM): stop the Strava loop, stop accepting, let
  // in-flight requests finish for up to SHUTDOWN_DEADLINE_MS, close the pool, exit. Meanwhile a pending
  // deferred seq is written and an in-flight run may finish; if it outlives flush's own 2 s budget, flush
  // writes the persisted seq directly (no Strava pull). Hard-capped at 3 s: a stuck write must not block
  // shutdown (boot recovery and the hourly refresh are the fallbacks).
  const shutdown = createShutdown({
    server,
    pool,
    stop: () => { stravaLoop?.stop(); garminLoop?.stop(); builder?.stop() },
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
