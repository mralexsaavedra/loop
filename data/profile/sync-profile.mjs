#!/usr/bin/env node
/* Profile sync — pulls the Strava athlete snapshot the self-hosted ingest service stores
 * (services/loop-ingest, GET /export/athlete) into data/profile/, for the page's profile sheet.
 *
 *   node data/profile/sync-profile.mjs     (part of `npm run sync`, after the Strava sync)
 *
 * Env    : INGEST_URL (default http://localhost:<INGEST_PORT of this clone's services/loop-ingest/.env>, else :8088), INGEST_TOKEN (falls back to
 *          services/loop-ingest/.env, like the other syncs).
 * Writes : data/profile/strava-profile.json (only when its content changed, temp file + rename)
 *          and data/profile/avatar.jpg (Strava's `profile_medium`: only from Strava's photo hosts,
 *          https, no redirects, image/jpeg|png + JPEG/PNG magic bytes, streamed with a hard
 *          MAX_AVATAR_BYTES cap). The snapshot's `avatarSourceUrl` = the URL the saved photo came
 *          from, set only after a successful download (photo written first, then the JSON); a
 *          download is planned whenever it differs from profileMedium or the file is missing, so a
 *          failed one is retried next run. Both files are gitignored (personal).
 * Errors : no token / unreachable service / an ingest image without the endpoint (404) -> exit 1
 *          and NO file touched, so the previous snapshot keeps feeding the build. A failed avatar
 *          download is only a warning: the previous avatar stays, exit 0. Anything else -> one
 *          `ERROR:` line, exit 1.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as common from '../apple-health/sync-common.mjs'
import { isMain } from '../../scripts/lib/is-main.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
 * whatever is on disk; a snapshot without a photo -> remove the old one. The decision compares
 * the URL the saved photo was actually downloaded from (`avatarSourceUrl`, set only after a
 * successful download), not the last profileMedium seen, so a failed download is retried.
 */
function planAvatar ({ next, prev, avatarExists }) {
  if (!next.fetchedAt) return 'keep'
  if (!next.profileMedium) return avatarExists ? 'remove' : 'keep'
  if (avatarExists && prev && prev.avatarSourceUrl === next.profileMedium) return 'keep'
  return 'download'
}

/*
 * Strava's API returns `profile_medium` as a URL on its photo CDN — historically and today the
 * CloudFront distribution dgalywyr863hv.cloudfront.net (".../pictures/athletes/<id>/<n>/<n>/medium.jpg"),
 * with strava.com hosts for its own assets. Only those are fetched: an exact CloudFront host (NOT
 * any *.cloudfront.net, which anyone can create) and the strava.com domain. Extend this list only
 * with a host seen in a real /athlete response.
 */
const AVATAR_HOSTS = ['dgalywyr863hv.cloudfront.net']
const AVATAR_HOST_SUFFIXES = ['.strava.com']

function isAllowedAvatarUrl (value) {
  let u
  try {
    u = new URL(String(value))
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false
  const host = u.hostname.toLowerCase()
  return AVATAR_HOSTS.includes(host) || AVATAR_HOST_SUFFIXES.some((s) => host.endsWith(s))
}

/** null when `buf` is an acceptable avatar, else the reason. */
function checkAvatar (buf) {
  if (!buf || !buf.length) return 'empty image'
  if (buf.length > MAX_AVATAR_BYTES) return `too large (${buf.length} bytes, cap ${MAX_AVATAR_BYTES})`
  if (!imageKind(buf)) return 'not a JPEG or PNG'
  return null
}

/** Reads the body chunk by chunk and gives up (cancelling the stream) as soon as it passes `cap`. */
// JPEG (FF D8 FF) or PNG (89 50 4E 47); null otherwise
function imageKind (buf) {
  if (!buf || buf.length < 4) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  return null
}

async function readCapped (res, cap) {
  if (!res.body || typeof res.body.getReader !== 'function') throw new Error('avatar response has no body')
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) {
      await reader.cancel().catch(() => {})
      throw new Error(`too large (over ${cap} bytes)`)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

async function downloadAvatar (url, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (!isAllowedAvatarUrl(url)) throw new Error('not an allowed Strava photo URL')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    // a redirect could leave the allowlisted host, so it is an error, never followed
    const res = await fetchImpl(url, { signal: ctrl.signal, redirect: 'error' })
    if (!res.ok) throw new Error(`avatar download answered HTTP ${res.status}`)
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    // Strava labels some PNG photos image/jpeg, so the bytes decide the format, not the header
    if (type !== 'image/jpeg' && type !== 'image/png') {
      await res.body?.cancel().catch(() => {})
      throw new Error(`unexpected content-type ${type || '(none)'}, expected image/jpeg or image/png`)
    }
    const announced = Number(res.headers.get('content-length'))
    if (announced > MAX_AVATAR_BYTES) {
      await res.body?.cancel().catch(() => {})
      throw new Error(`too large (${announced} bytes, cap ${MAX_AVATAR_BYTES})`)
    }
    const buf = await readCapped(res, MAX_AVATAR_BYTES)
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
  const avatarExists = fs.existsSync(avatarPath)

  // The photo is settled FIRST and the JSON written after it, recording where the photo on disk came
  // from (avatarSourceUrl). A crash in between leaves at worst an old source URL next to a new photo,
  // which only causes one extra download — never a JSON naming a photo that was not saved.
  const action = planAvatar({ next, prev, avatarExists })
  let avatar = 'kept'
  let avatarSourceUrl = avatarExists && prev && typeof prev.avatarSourceUrl === 'string' ? prev.avatarSourceUrl : null
  if (action === 'remove') {
    fs.rmSync(avatarPath, { force: true })
    avatar = 'removed'
    avatarSourceUrl = null
  } else if (action === 'download') {
    try {
      writeAtomic(avatarPath, await downloadAvatar(next.profileMedium, { fetchImpl }))
      avatar = 'downloaded'
      avatarSourceUrl = next.profileMedium
    } catch (err) {
      avatar = `failed: ${err.message}`
    }
  }

  const text = JSON.stringify({ ...next, avatarSourceUrl }, null, 2) + '\n'
  const profileWritten = text !== prevText
  if (profileWritten) writeAtomic(jsonPath, text)
  return { profileWritten, avatar, bikes: next.bikes.length, shoes: next.shoes.length, devices: next.devices.length, gearScopeMissing: next.gearScopeMissing, snapshot: Boolean(next.fetchedAt) }
}

function errorMessage (err, baseUrl) {
  if (err && err.status === 404) return 'ERROR: ingest service has no /export/athlete — rebuild/restart the loop-ingest container. No files touched.'
  const cause = (err && err.cause && (err.cause.code || err.cause.message)) || (err && err.message)
  return `ERROR: could not read from the ingest service at ${baseUrl} (${cause}). Is it running? No files touched.`
}

async function main () {
  const baseUrl = common.readBaseUrl(process.env, process.env.INGEST_ENV_FILE || common.ENV_FILE)
  const token = common.readIngestToken(process.env, process.env.INGEST_ENV_FILE || common.ENV_FILE)
  if (!token) {
    console.error('ERROR: no ingest token. Set INGEST_TOKEN or create services/loop-ingest/.env. No files touched.')
    process.exit(1)
  }
  let body
  try {
    body = normalizeExport(await common.fetchJson(`${baseUrl}/export/athlete`, token))
  } catch (err) {
    console.error(errorMessage(err, baseUrl))
    process.exit(1)
  }
  let r
  try {
    r = await syncProfile(OUT, body)
  } catch (err) {
    console.error(`ERROR: profile sync failed (${(err && err.message) || err}). Files are only ever replaced atomically, so each one is either the previous or the new version.`)
    process.exit(1)
  }
  console.log(`Profile: ${r.snapshot ? 'Strava snapshot' : 'no Strava snapshot yet'}; ${r.bikes} bike(s), ${r.shoes} shoe(s), ${r.devices} device(s); ${r.profileWritten ? 'written' : 'unchanged'}; avatar ${r.avatar}`)
  if (r.avatar.startsWith('failed')) console.error(`WARNING: avatar not updated (${r.avatar.slice(8)}); the previous one is kept.`)
  if (r.gearScopeMissing) {
    console.error('NOTE: Strava returned no gear — the token lacks the profile:read_all scope. ' +
      'Re-authorize (services/loop-ingest/README.md, "Gear needs the profile:read_all scope").')
  }
}

if (isMain(import.meta.url)) main()

export {
  PROFILE_JSON,
  AVATAR_FILE,
  MAX_AVATAR_BYTES,
  normalizeExport,
  planAvatar,
  checkAvatar,
  isAllowedAvatarUrl,
  AVATAR_HOSTS,
  AVATAR_HOST_SUFFIXES,
  downloadAvatar,
  syncProfile,
  errorMessage,
  main
}
