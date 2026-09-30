#!/usr/bin/env node
/* Profile sync — pulls the Strava athlete snapshot the self-hosted ingest service stores
 * (services/health-ingest, GET /export/athlete) into data/profile/, for the page's profile sheet.
 *
 *   node data/profile/sync-profile.js      (part of `npm run sync`, after the Strava sync)
 *
 * Env    : INGEST_URL (default http://localhost:8088), INGEST_TOKEN (falls back to
 *          services/health-ingest/.env, like the other syncs).
 * Writes : data/profile/strava-profile.json (only when its content changed, temp file + rename)
 *          and data/profile/avatar.jpg (Strava's `profile_medium`, a small JPEG capped at
 *          MAX_AVATAR_BYTES; downloaded only when the photo URL changed or the file is missing).
 *          Both are gitignored (personal).
 * Errors : no token / unreachable service / an ingest image without the endpoint (404) -> exit 1
 *          and NO file touched, so the previous snapshot keeps feeding the build. A failed avatar
 *          download is only a warning: the previous avatar stays, exit 0.
 */
const fs = require('fs')
const path = require('path')
const common = require('../apple-health/sync-common.js')

// SYNC_PROFILE_OUT_DIR / INGEST_ENV_FILE exist ONLY so the child-process tests can point main()
// at a disposable tmp dir / env file — unset in production.
const OUT = process.env.SYNC_PROFILE_OUT_DIR || __dirname
const PROFILE_JSON = 'strava-profile.json'
const AVATAR_FILE = 'avatar.jpg'
const MAX_AVATAR_BYTES = 60 * 1024

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const list = (v) => (Array.isArray(v) ? v : [])

/** The /export/athlete body reduced to the fields the build reads (unknown keys dropped). */
function normalizeExport (body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('unexpected response shape (expected an object)')
  return {
    fetchedAt: str(body.fetchedAt),
    firstname: str(body.firstname),
    lastname: str(body.lastname),
    city: str(body.city),
    state: str(body.state),
    country: str(body.country),
    profile: str(body.profile),
    profileMedium: str(body.profileMedium),
    measurementPreference: str(body.measurementPreference),
    athleteType: str(body.athleteType),
    bikes: list(body.bikes),
    shoes: list(body.shoes),
    gearScopeMissing: Boolean(body.gearScopeMissing),
    devices: list(body.devices)
  }
}

/**
 * 'download' | 'keep' | 'remove'. No snapshot on the service yet (fetchedAt null) -> keep
 * whatever is on disk; a snapshot without a photo -> remove the old one.
 */
function planAvatar ({ next, prev, avatarExists }) {
  if (!next.fetchedAt) return 'keep'
  if (!next.profileMedium) return avatarExists ? 'remove' : 'keep'
  if (avatarExists && prev && prev.profileMedium === next.profileMedium) return 'keep'
  return 'download'
}

/** null when `buf` is an acceptable avatar, else the reason. */
function checkAvatar (buf) {
  if (!buf || !buf.length) return 'empty image'
  if (buf.length > MAX_AVATAR_BYTES) return `too large (${buf.length} bytes, cap ${MAX_AVATAR_BYTES})`
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return 'not a JPEG'
  return null
}

async function downloadAvatar (url, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (!/^https:\/\//.test(String(url))) throw new Error('avatar URL is not https')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`avatar download answered HTTP ${res.status}`)
    const announced = Number(res.headers && res.headers.get && res.headers.get('content-length'))
    if (announced > MAX_AVATAR_BYTES) throw new Error(`too large (${announced} bytes, cap ${MAX_AVATAR_BYTES})`)
    const buf = Buffer.from(await res.arrayBuffer())
    const bad = checkAvatar(buf)
    if (bad) throw new Error(bad)
    return buf
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`avatar download timed out after ${timeoutMs / 1000} s`)
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

/** Writes the snapshot (when changed) and settles the avatar. Returns a small report. */
async function syncProfile (dir, body, { fetchImpl = fetch, writeAtomic = common.writeAtomic } = {}) {
  const next = normalizeExport(body)
  fs.mkdirSync(dir, { recursive: true })
  const jsonPath = path.join(dir, PROFILE_JSON)
  const avatarPath = path.join(dir, AVATAR_FILE)
  const prevText = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, 'utf8') : null
  const prev = prevText ? readJsonOrNull(jsonPath) : null
  const text = JSON.stringify(next, null, 2) + '\n'

  const action = planAvatar({ next, prev, avatarExists: fs.existsSync(avatarPath) })
  let avatar = 'kept'
  if (action === 'remove') {
    fs.rmSync(avatarPath, { force: true })
    avatar = 'removed'
  } else if (action === 'download') {
    try {
      writeAtomic(avatarPath, await downloadAvatar(next.profileMedium, { fetchImpl }))
      avatar = 'downloaded'
    } catch (err) {
      avatar = `failed: ${err.message}`
    }
  }

  const profileWritten = text !== prevText
  if (profileWritten) writeAtomic(jsonPath, text)
  return { profileWritten, avatar, bikes: next.bikes.length, shoes: next.shoes.length, devices: next.devices.length, gearScopeMissing: next.gearScopeMissing, snapshot: Boolean(next.fetchedAt) }
}

function errorMessage (err, baseUrl) {
  if (err && err.status === 404) return 'ERROR: ingest service has no /export/athlete — rebuild/restart the health-ingest container. No files touched.'
  const cause = (err && err.cause && (err.cause.code || err.cause.message)) || (err && err.message)
  return `ERROR: could not read from the ingest service at ${baseUrl} (${cause}). Is it running? No files touched.`
}

async function main () {
  const baseUrl = (process.env.INGEST_URL || common.DEFAULT_URL).replace(/\/+$/, '')
  const token = common.readIngestToken(process.env, process.env.INGEST_ENV_FILE || common.ENV_FILE)
  if (!token) {
    console.error('ERROR: no ingest token. Set INGEST_TOKEN or create services/health-ingest/.env. No files touched.')
    process.exit(1)
  }
  let body
  try {
    body = normalizeExport(await common.fetchJson(`${baseUrl}/export/athlete`, token))
  } catch (err) {
    console.error(errorMessage(err, baseUrl))
    process.exit(1)
  }
  const r = await syncProfile(OUT, body)
  console.log(`Profile: ${r.snapshot ? 'Strava snapshot' : 'no Strava snapshot yet'}; ${r.bikes} bike(s), ${r.shoes} shoe(s), ${r.devices} device(s); ${r.profileWritten ? 'written' : 'unchanged'}; avatar ${r.avatar}`)
  if (r.avatar.startsWith('failed')) console.error(`WARNING: avatar not updated (${r.avatar.slice(8)}); the previous one is kept.`)
  if (r.gearScopeMissing) {
    console.error('NOTE: Strava returned no gear — the token lacks the profile:read_all scope. ' +
      'Re-authorize (services/health-ingest/README.md, "Gear needs the profile:read_all scope").')
  }
}

if (require.main === module) main()

module.exports = {
  PROFILE_JSON,
  AVATAR_FILE,
  MAX_AVATAR_BYTES,
  normalizeExport,
  planAvatar,
  checkAvatar,
  downloadAvatar,
  syncProfile,
  errorMessage,
  main
}
