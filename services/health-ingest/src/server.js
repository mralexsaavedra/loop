import http from 'node:http'
import { isAuthorized } from './auth.js'
import { createPool, migrate, insertRawPayload, ping } from './db.js'
import { createStravaSync, startSyncLoop, isConfigured as stravaConfigured } from './sync.js'
import { createExportHandler, createStravaExportHandler } from './export.js'
import { createAthleteExportHandler } from './athlete.js'
import { createSyncStatus } from './status.js'
import { createTriggerWriter, createSyncTrigger, readTriggerSeq } from './trigger.js'
import { createSyncRoutes } from './sync-routes.js'
import { createFoodStore } from './food-db.js'
import { createFoodRoutes, parseAllowedHosts } from './food.js'
import { createOffClient } from './off.js'

const PORT = Number(process.env.PORT ?? 8088)
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 32 * 1024 * 1024)
const INGEST_TOKEN = process.env.INGEST_TOKEN
const DATABASE_URL = process.env.DATABASE_URL

if (!INGEST_TOKEN || INGEST_TOKEN.length < 32) {
  console.error('INGEST_TOKEN missing or shorter than 32 characters')
  process.exit(1)
}
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}

const pool = createPool(DATABASE_URL)
const handleExport = createExportHandler({ pool, token: INGEST_TOKEN })
const handleStravaExport = createStravaExportHandler({ pool, token: INGEST_TOKEN })
const handleAthleteExport = createAthleteExportHandler({ pool, token: INGEST_TOKEN })

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

// Food log (Nutrición part 2): products, recipes, the daily log and a server-side Open Food Facts
// lookup under /food/*. Unauthenticated and LAN-only like /sync (a static page cannot hold a
// secret). A Host allowlist (DNS rebinding), an Origin check on writes and the required X-HC-Food
// header + JSON content type (a CORS preflight this server never approves) keep other websites out;
// see food.js. A public proxy must never forward /food/*.
// FOOD_ALLOWED_HOSTS: extra host names (besides IP literals, localhost, host.docker.internal) the
// page may be reached by; mirrors plan-web's PLAN_WEB_EXTRA_HOSTS. Empty by default.
let foodReady = false // set once 006_food.sql ran; until then (or if it failed) /food/* answers 503
let settingsReady = false // 007_settings.sql, its own group: only /food/settings depends on it
const foodRoutes = createFoodRoutes({
  store: createFoodStore(pool),
  off: createOffClient(),
  available: () => foodReady,
  settingsAvailable: () => settingsReady,
  allowedHosts: parseAllowedHosts(process.env.FOOD_ALLOWED_HOSTS)
})

function send (res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

/**
 * Read the body with a hard ceiling. Health Auto Export can be told to batch
 * requests, so rejecting an oversized upload is preferable to buffering it.
 */
function readBody (req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0

    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function handleIngest (req, res, source) {
  if (!isAuthorized(req.headers.authorization, INGEST_TOKEN)) {
    send(res, 401, { error: 'unauthorized' })
    return
  }

  const raw = await readBody(req, MAX_BODY_BYTES)
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  try {
    if (req.method === 'GET' && url.pathname === '/healthz') {
      await ping(pool)
      // Still 200 when degraded: the container is alive and ingesting; the flag
      // says the Strava pull has not succeeded for 6 h (see status.js).
      send(res, 200, { ok: true, strava: STRAVA_ENABLED ? 'enabled' : 'disabled', ...syncStatus.health() })
      return
    }

    if (await foodRoutes.handle(req, res, url)) return

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
      if (!isAuthorized(req.headers.authorization, INGEST_TOKEN)) {
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
    if (!res.headersSent) send(res, status, { error: status === 413 ? 'payload too large' : 'internal error' })
  }
})

async function start () {
  // a failing optional migration is logged (<group>_migration_failed) and only disables its routes:
  // the food tables -> /food/* (but /food/settings), the settings table -> /food/settings
  const optional = await migrate(pool)
  foodReady = optional.food === true
  settingsReady = optional.settings === true
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

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stravaLoop?.stop()
    // Write a pending deferred seq now and let an in-flight run finish; if it
    // outlives flush's own 2 s budget, flush writes the persisted seq directly
    // (no Strava pull). Hard-capped at 3 s: a stuck write must not block
    // shutdown (boot recovery and the hourly refresh are the fallbacks).
    const flushed = Promise.race([syncTrigger.flush(), new Promise((resolve) => setTimeout(resolve, 3_000).unref())])
    server.close(() => flushed.then(() => pool.end()).then(() => process.exit(0)))
  })
}

start().catch((err) => {
  console.error(JSON.stringify({ event: 'startup_failed', message: err.message }))
  process.exit(1)
})
