#!/usr/bin/env node
/* Settings sync — snapshots the user's goal + target weight that the LAN page stores on the ingest
 * service (services/health-ingest, GET /food/settings, sql/007_settings.sql) into
 * data/profile/settings.json, so read-only consumers (the coach subagents, which only read files)
 * see the same goal the page uses.
 *
 *   node data/profile/sync-settings.js      (part of `npm run sync`, after the profile sync)
 *
 * Env    : INGEST_URL (default http://localhost:8088). No token: /food/* is the unauthenticated,
 *          LAN-only food layer; the request carries `X-HC-Food: 1` and the URL's Host must be one the
 *          service accepts (an IP literal, localhost, or a name in its FOOD_ALLOWED_HOSTS).
 * Writes : data/profile/settings.json = {goal, targetWeightKg, updatedAt, fetchedAt} (temp file +
 *          rename), only when goal / target / updatedAt changed or the stored fetchedAt is from an
 *          earlier UTC day (so fetchedAt stays an honest "last seen" at day precision without a
 *          rewrite on every run). Gitignored (data/profile/*).
 * Errors : unreachable service, 404 (an image without the endpoint), 503 (settings migration
 *          unavailable), 421 (host not allowed) or a malformed body -> one `WARNING:` line, the old
 *          file kept, exit 0: the settings are optional and must never fail `npm run sync`. Only a
 *          failed write exits 1.
 */
const fs = require('fs')
const path = require('path')
const common = require('../apple-health/sync-common.mjs')

// SYNC_PROFILE_OUT_DIR exists ONLY so the child-process tests can point main() at a tmp dir
const OUT = process.env.SYNC_PROFILE_OUT_DIR || __dirname
const SETTINGS_JSON = 'settings.json'
// copies of lib/nutrition/foodlog.mjs SETTINGS_GOALS / FOOD_LIMITS.targetWeight* (a test pins them equal)
const GOALS = ['maintain', 'cut', 'bulk']
const TARGET_MIN = 35
const TARGET_MAX = 250

const isIsoInstant = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v)

/** The GET /food/settings body ({settings: {...}}) reduced to the three stored fields; throws when malformed. */
function normalizeSettings (body) {
  const s = body && body.settings
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('unexpected response shape (expected {settings: {...}})')
  const goal = s.goal == null ? null : s.goal
  if (goal !== null && !GOALS.includes(goal)) throw new Error(`unexpected goal ${JSON.stringify(goal)}`)
  const t = s.targetWeightKg == null ? null : s.targetWeightKg
  if (t !== null && !(typeof t === 'number' && Number.isFinite(t) && t >= TARGET_MIN && t <= TARGET_MAX)) throw new Error('unexpected targetWeightKg')
  const u = s.updatedAt == null ? null : s.updatedAt
  if (u !== null && !isIsoInstant(u)) throw new Error('unexpected updatedAt')
  return { goal, targetWeightKg: t, updatedAt: u }
}

/** GET <base>/food/settings with the food layer's header; the HTTP status (if any) is kept on err.status. */
async function fetchSettings (baseUrl, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/food/settings`, {
      headers: { 'x-hc-food': '1', accept: 'application/json' },
      signal: ctrl.signal,
      redirect: 'error'
    })
    if (!res.ok) throw Object.assign(new Error(`ingest service answered HTTP ${res.status}`), { status: res.status })
    return await res.json()
  } catch (err) {
    if (err.name === 'AbortError' || ctrl.signal.aborted) throw new Error(`request timed out after ${timeoutMs / 1000} s`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function readJsonOrNull (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

const sameContent = (a, b) => a.goal === b.goal && a.targetWeightKg === b.targetWeightKg && a.updatedAt === b.updatedAt

/** Writes settings.json when the content changed or the stored fetchedAt is from an earlier UTC day. */
function syncSettings (dir, body, { now = new Date(), writeAtomic = common.writeAtomic } = {}) {
  const next = normalizeSettings(body)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, SETTINGS_JSON)
  const prev = readJsonOrNull(file)
  const fetchedAt = now.toISOString()
  const prevOk = prev && typeof prev === 'object' && !Array.isArray(prev)
  const fresh = prevOk && typeof prev.fetchedAt === 'string' && prev.fetchedAt.slice(0, 10) === fetchedAt.slice(0, 10)
  if (prevOk && fresh && sameContent(prev, next)) return { written: false, settings: next }
  writeAtomic(file, JSON.stringify({ ...next, fetchedAt }, null, 2) + '\n')
  return { written: true, settings: next }
}

function warning (err, baseUrl) {
  const status = err && err.status
  if (status === 404) return 'WARNING: the ingest service has no /food/settings — rebuild/restart the health-ingest container. settings.json kept.'
  if (status === 503) return 'WARNING: the ingest service answered 503 (settings unavailable: its 007_settings migration failed). settings.json kept.'
  if (status === 421) return `WARNING: the ingest service refused the host of ${baseUrl} (421) — use localhost / an IP, or add the name to FOOD_ALLOWED_HOSTS. settings.json kept.`
  const cause = (err && err.cause && (err.cause.code || err.cause.message)) || (err && err.message)
  return `WARNING: could not read the settings from ${baseUrl} (${cause}). settings.json kept.`
}

async function main () {
  const baseUrl = (process.env.INGEST_URL || common.DEFAULT_URL).replace(/\/+$/, '')
  let body
  try {
    body = await fetchSettings(baseUrl)
    normalizeSettings(body)
  } catch (err) {
    console.error(warning(err, baseUrl))
    return
  }
  try {
    const r = syncSettings(OUT, body)
    const s = r.settings
    console.log(`Settings: goal ${s.goal || 'not set'}, target ${s.targetWeightKg != null ? `${s.targetWeightKg} kg` : 'not set'}; ${r.written ? 'written' : 'unchanged'}`)
  } catch (err) {
    console.error(`ERROR: settings sync failed (${(err && err.message) || err}). The file is only ever replaced atomically.`)
    process.exit(1)
  }
}

if (require.main === module) main()

module.exports = { SETTINGS_JSON, GOALS, TARGET_MIN, TARGET_MAX, normalizeSettings, fetchSettings, syncSettings, warning, main }
