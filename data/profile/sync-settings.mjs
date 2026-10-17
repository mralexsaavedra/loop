#!/usr/bin/env node
/* Settings sync — snapshots the user's goal + target weight that the LAN page stores on the ingest
 * service (services/loop-ingest, GET /food/settings, sql/007_settings.sql) into
 * loop-data/profile/settings.json, so read-only consumers (the coach subagents, which only read files)
 * see the same goal the page uses.
 *
 *   node data/profile/sync-settings.mjs     (part of `npm run sync`, after the profile sync)
 *
 * Env    : INGEST_URL (default http://localhost:<INGEST_PORT of this clone's services/loop-ingest/.env>, else :8088). No token: /food/* is the unauthenticated,
 *          LAN-only food layer; the request carries `X-HC-Food: 1` and the URL's Host must be one the
 *          service accepts (an IP literal, localhost, or a name in its FOOD_ALLOWED_HOSTS).
 * Writes : loop-data/profile/settings.json = {goal, targetWeightKg, updatedAt, fetchedAt} (temp file +
 *          rename), only when goal / target / updatedAt changed or the stored fetchedAt is from an
 *          earlier UTC day (so fetchedAt stays an honest "last seen" at day precision without a
 *          rewrite on every run). Gitignored (loop-data/profile/*).
 * Errors : unreachable service, 404 (an image without the endpoint), 503 (settings migration
 *          unavailable), 421 (host not allowed) or a malformed body -> one `WARNING:` line, the old
 *          file kept, exit 0: the settings are optional and must never fail `npm run sync`. Only a
 *          failed write exits 1.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as common from '../apple-health/sync-common.mjs'
import { isMain } from '../../scripts/lib/is-main.mjs'
import { dataPaths } from '../../lib/paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Default: lib/paths.mjs profileDir (data/profile, or <HC_DATA_DIR>/profile).
// SYNC_PROFILE_OUT_DIR exists ONLY so the child-process tests can point main() at a tmp dir
const defaultOut = (env) => env.SYNC_PROFILE_OUT_DIR || dataPaths({ repoRoot: path.resolve(__dirname, '..', '..'), env }).profileDir
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
  return common.fetchJson(`${String(baseUrl).replace(/\/+$/, '')}/food/settings`, null, {
    fetchImpl, timeoutMs, headers: { 'x-hc-food': '1', accept: 'application/json' }, redirect: 'error'
  })
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
  if (status === 404) return 'WARNING: the ingest service has no /food/settings — rebuild/restart the loop-ingest container. settings.json kept.'
  if (status === 503) return 'WARNING: the ingest service answered 503 (settings unavailable: its 007_settings migration failed). settings.json kept.'
  if (status === 421) return `WARNING: the ingest service refused the host of ${baseUrl} (421) — use localhost / an IP, or add the name to FOOD_ALLOWED_HOSTS. settings.json kept.`
  const cause = (err && err.cause && (err.cause.code || err.cause.message)) || (err && err.message)
  return `WARNING: could not read the settings from ${baseUrl} (${cause}). settings.json kept.`
}

const USAGE = `Usage: node data/profile/sync-settings.mjs

Snapshots the page's settings (goal, target weight) from the ingest service into loop-data/profile/settings.json.
  -h, --help   this help
Env: INGEST_URL, INGEST_ENV_FILE (default services/loop-ingest/.env, for its INGEST_PORT).`

// The CLI entry; env / log / error / fetchImpl / outDir are injectable for tests. Returns the exit code: an
// unreachable service is a warning (0), a failed write 1.
async function main ({ env = process.env, log = console.log, error = console.error, fetchImpl = fetch, outDir = defaultOut(env) } = {}) {
  const baseUrl = common.readBaseUrl(env)
  let body
  try {
    body = await fetchSettings(baseUrl, { fetchImpl })
    normalizeSettings(body)
  } catch (err) {
    error(warning(err, baseUrl))
    return 0
  }
  try {
    const r = syncSettings(outDir, body)
    const s = r.settings
    log(`Settings: goal ${s.goal || 'not set'}, target ${s.targetWeightKg != null ? `${s.targetWeightKg} kg` : 'not set'}; ${r.written ? 'written' : 'unchanged'}`)
    return 0
  } catch (err) {
    error(`ERROR: settings sync failed (${(err && err.message) || err}). The file is only ever replaced atomically.`)
    return 1
  }
}

if (isMain(import.meta.url)) common.runCli(() => main(), { guardDataRoot: true, usage: USAGE })

export { SETTINGS_JSON, GOALS, TARGET_MIN, TARGET_MAX, normalizeSettings, fetchSettings, syncSettings, warning, main }
