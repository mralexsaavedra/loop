/**
 * Garmin Connect Personal API client (optional source; docs/lan-services.md -> Garmin). No SQL here: the
 * persistence lives in garmin-db.js, the sync loop in garmin-sync.js.
 *
 * The credential is a personal API key the owner creates on Garmin Connect (it expires after at most a year).
 * It is exchanged for a short-lived access token (POST TOKEN_PATH, `Authorization: ApiKey <key>`); the token
 * stays in memory only. The key is never logged, never stored, never passed to the page build, and every error
 * that leaves this module has it scrubbed (scrubKey), so not even a library message can leak it.
 *
 * A refused key (401 / 403 on the token exchange, or a data call still refused after one fresh token) is
 * classified `garmin_auth`; GET /sync/status exposes only that coarse code (status.js), the page warns.
 */
import { classifyStravaError } from './strava.js'

export const DEFAULT_BASE_URL = 'https://personal.connectapi.garmin.com'
export const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token'
export const ACTIVITIES_PATH = '/activitylist-service/activities/search/activities'
export const PAGE_SIZE = 100
// 100 x 100 = 10,000 activities on a full walk; more means a broken offset
export const MAX_PAGES = 100
// a hung request must never block the shared sync run
export const FETCH_TIMEOUT_MS = 15_000
// the token's validity when the endpoint does not say (23 h); refreshed 60 s before it runs out
export const DEFAULT_TOKEN_MS = 82_800_000
const TOKEN_SLACK_MS = 60_000
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const ID_RE = /^\d{1,19}$/

/** The fetch the Garmin calls use (tests pass a fake). @typedef {typeof fetch} FetchImpl */
/** Resolves a valid access token; `invalidate()` drops the cached one. @typedef {(() => Promise<string>) & { invalidate: () => void }} GetGarminToken */
/** A failed Garmin call: `garminAuth` when the key or token was refused. @typedef {Error & { garminAuth?: boolean, status?: number, code?: string, cause?: any }} GarminError */
/** What the data calls need. @typedef {{ getToken: GetGarminToken, baseUrl: string, fetchImpl: FetchImpl }} GarminClient */
/** One activity summary as the activity list returns it (untrusted JSON). @typedef {Record<string, any>} GarminActivity */
/** One planned step in the stored / exported compact form (no names, no notes).
 * @typedef {{ i: number | null, intensity: string | null, dur_type: string | null, dur: number | null, target: string | null,
 *   low: number | null, high: number | null, value: number | null }} CompactStep */

/** @param {Record<string, string | undefined>} env */
export function isGarminConfigured (env) {
  return Boolean(String(env.GARMIN_API_KEY ?? '').trim())
}

/** GARMIN_BASE_URL (tests) or the real API. @param {Record<string, string | undefined>} env */
export function garminBaseUrl (env) {
  return String(env.GARMIN_BASE_URL ?? '').trim() || DEFAULT_BASE_URL
}

/**
 * GARMIN_API_KEY_EXPIRES: the expiry date Garmin showed when the key was created (the API never reports it).
 * A real calendar date YYYY-MM-DD, else null.
 * @param {Record<string, string | undefined>} env @returns {string | null}
 */
export function garminKeyExpires (env) {
  const s = String(env.GARMIN_API_KEY_EXPIRES ?? '').trim()
  const m = DATE_RE.exec(s)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === s ? s : null
}

/**
 * Removes every occurrence of the key from an error's message and stack, through its whole `cause` chain and the
 * `errors` of an AggregateError (in place, cycles skipped), and returns it.
 * @param {unknown} err @param {string} apiKey @returns {GarminError}
 */
function scrubKey (err, apiKey) {
  const e = /** @type {GarminError} */ (err instanceof Error ? err : new Error(String(err)))
  if (!apiKey) return e
  const clean = (/** @type {string} */ s) => s.split(apiKey).join('[redacted]')
  const seen = new Set()
  /** @type {unknown[]} */
  const queue = [e]
  while (queue.length) {
    const target = /** @type {any} */ (queue.shift())
    if (!target || typeof target !== 'object' || seen.has(target)) continue
    seen.add(target)
    for (const field of ['message', 'stack']) {
      try {
        if (typeof target[field] === 'string' && target[field].includes(apiKey)) target[field] = clean(target[field])
      } catch {}
    }
    try { queue.push(target.cause) } catch {}
    try { if (Array.isArray(target.errors)) queue.push(...target.errors) } catch {}
  }
  return e
}

/** The token from the endpoint's body: plain text (maybe quoted) or JSON. @param {string} text */
function parseTokenBody (text) {
  const raw = String(text ?? '').trim()
  /** @type {unknown} */
  let parsed = raw
  try { parsed = JSON.parse(raw) } catch {}
  if (typeof parsed === 'string') return { token: parsed.trim(), expiresInS: null }
  if (parsed && typeof parsed === 'object') {
    const b = /** @type {Record<string, unknown>} */ (parsed)
    const token = [b.access_token, b.accessToken, b.token].find((v) => typeof v === 'string' && v.trim())
    const exp = Number(b.expires_in ?? b.expiresIn)
    return { token: typeof token === 'string' ? token.trim() : '', expiresInS: Number.isFinite(exp) && exp > 0 ? exp : null }
  }
  return { token: '', expiresInS: null }
}

/**
 * The access-token provider: one token in memory, re-obtained 60 s before it runs out, one request in flight at
 * a time (concurrent callers share it).
 * @param {{ apiKey: string, baseUrl?: string, fetchImpl?: FetchImpl, now?: () => number }} options
 * @returns {GetGarminToken}
 */
export function createGarminTokenProvider ({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, now = Date.now }) {
  /** @type {string | null} */
  let token = null
  let expiresAt = 0
  /** @type {Promise<string> | null} */
  let inflight = null

  async function obtain () {
    let res
    try {
      res = await fetchImpl(new URL(TOKEN_PATH, baseUrl), {
        method: 'POST',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { authorization: `ApiKey ${apiKey}`, accept: '*/*' }
      })
    } catch (err) {
      throw scrubKey(err, apiKey)
    }
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error(`garmin token refused: ${res.status}`), { garminAuth: true, status: res.status })
    }
    if (!res.ok) throw Object.assign(new Error(`garmin token failed: ${res.status}`), { status: res.status })
    let text
    try { text = await res.text() } catch (err) { throw scrubKey(err, apiKey) }
    const { token: value, expiresInS } = parseTokenBody(text)
    if (!value) throw new Error('garmin token response empty')
    token = value
    expiresAt = now() + (expiresInS != null ? expiresInS * 1000 : DEFAULT_TOKEN_MS)
    return token
  }

  const getToken = /** @type {GetGarminToken} */ (function getToken () {
    if (token && now() < expiresAt - TOKEN_SLACK_MS) return Promise.resolve(token)
    if (!inflight) inflight = obtain().finally(() => { inflight = null })
    return inflight
  })
  getToken.invalidate = () => { token = null; expiresAt = 0 }
  return getToken
}

/** @param {{ apiKey: string, baseUrl?: string, fetchImpl?: FetchImpl, now?: () => number }} options @returns {GarminClient} */
export function createGarminClient ({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, now = Date.now }) {
  return { getToken: createGarminTokenProvider({ apiKey, baseUrl, fetchImpl, now }), baseUrl, fetchImpl }
}

/**
 * One authenticated GET -> the parsed JSON body; a 401 re-obtains the token once and retries; 404 -> null.
 * @param {GarminClient} client @param {string} pathAndQuery
 */
async function garminGet ({ getToken, baseUrl, fetchImpl }, pathAndQuery) {
  const url = new URL(pathAndQuery, baseUrl)
  const call = async () => fetchImpl(url, {
    headers: { authorization: `Bearer ${await getToken()}`, accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  let res = await call()
  if (res.status === 401) {
    getToken.invalidate()
    res = await call()
  }
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error(`garmin data refused: ${res.status}`), { garminAuth: true, status: res.status })
  }
  if (res.status === 404) return null
  if (res.status === 429) throw Object.assign(new Error('garmin rate limit reached'), { status: 429 })
  if (!res.ok) throw Object.assign(new Error(`garmin request failed: ${res.status}`), { status: res.status })
  return res.json()
}

/** "YYYY-MM-DD HH:MM:SS" (UTC) -> epoch ms, or NaN. @param {unknown} s */
export function gmtMs (s) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(s ?? ''))
  return m ? Date.parse(`${m[1]}T${m[2]}Z`) : NaN
}

/**
 * Walks the activity list NEWEST FIRST (start / limit paging). Every page is handed to `onPage` (awaited) before
 * the next one is asked for, so a failure partway keeps what was stored. With `sinceMs` the walk stops at the
 * overlap point: the first activity that started before it (only the newer ones of that page are handed over);
 * with null it walks the whole history. Resolves { count, complete } (complete = the walk reached its end).
 * @param {GarminClient} client @param {{ sinceMs: number | null }} window
 * @param {(batch: GarminActivity[]) => unknown} onPage @param {{ maxPages?: number }} [options]
 */
export async function pullGarminActivities (client, { sinceMs }, onPage, { maxPages = MAX_PAGES } = {}) {
  let count = 0
  for (let page = 0; page < maxPages; page++) {
    const body = await garminGet(client, `${ACTIVITIES_PATH}?start=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`)
    const batch = Array.isArray(body) ? body : []
    const kept = sinceMs == null ? batch : batch.filter((a) => !(gmtMs(a?.startTimeGMT) < sinceMs))
    const reachedOverlap = kept.length < batch.length
    if (kept.length > 0) await onPage(kept)
    count += kept.length
    if (reachedOverlap || batch.length < PAGE_SIZE) return { count, complete: true }
  }
  throw new Error(`garmin activities: more than ${maxPages} pages`)
}

/**
 * The planned workout(s) of one activity: an array, empty when it followed no workout (a 404 reads as empty).
 * @param {GarminClient} client @param {string} id @returns {Promise<any[]>}
 */
export async function fetchActivityWorkouts (client, id) {
  if (!ID_RE.test(String(id))) throw new Error('garmin activity id invalid')
  const body = await garminGet(client, `/activity-service/activity/${id}/workouts`)
  return Array.isArray(body) ? body : []
}

/** @param {unknown} v @returns {number | null} */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** @param {unknown} v @returns {string | null} */
const str = (v) => (typeof v === 'string' && v ? v.slice(0, 64) : null)

/**
 * The first workout's steps in the compact form (the privacy boundary: no workout or step names, no notes),
 * or null when there is no planned workout with steps.
 * @param {unknown} workouts @returns {CompactStep[] | null}
 */
export function compactWorkoutSteps (workouts) {
  if (!Array.isArray(workouts)) return null
  const first = workouts.find((w) => Array.isArray(w?.steps) && w.steps.length > 0)
  if (!first) return null
  return first.steps.map((/** @type {any} */ s) => ({
    i: num(s?.stepIndex),
    intensity: str(s?.intensity),
    dur_type: str(s?.durationType),
    dur: num(s?.durationValue),
    target: str(s?.targetType),
    low: num(s?.targetValueLow),
    high: num(s?.targetValueHigh),
    value: num(s?.targetValue)
  }))
}

/**
 * Coarse, non-sensitive code for a failed Garmin call (GET /sync/status exposes only this): garmin_auth (the key
 * or the token was refused), garmin_network (could not reach Garmin), garmin_other.
 * @param {GarminError | null | undefined} err
 */
export function classifyGarminError (err) {
  if (!err) return 'garmin_other'
  if (err.garminAuth || /garmin (token|data) refused: (401|403)\b/.test(String(err.message ?? ''))) return 'garmin_auth'
  // the network test (timeouts, connection codes, undici's "fetch failed") is the Strava one: same transport
  return classifyStravaError(err) === 'strava_network' ? 'garmin_network' : 'garmin_other'
}
