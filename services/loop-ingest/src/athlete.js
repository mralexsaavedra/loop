import { createBearerCheck } from './auth.js'
import { writeJson as send } from './http.js'
import { saveAthlete, recordAthleteFailure, loadAthlete, listDevices, activityGearIds } from './athlete-db.js'

// the persistence moved to athlete-db.js; its functions keep their historical import path
export { saveAthlete, recordAthleteFailure, loadAthlete, listDevices, activityGearIds } from './athlete-db.js'

/**
 * Strava athlete profile + gear snapshot (sql/004_athlete.sql), refreshed from the sync loop at
 * most once per 24 h, and read back by the repo's profile sync through GET /export/athlete.
 *
 * Scope caveat: Strava only returns `bikes` / `shoes` (and `measurement_preference`) on
 * GET /athlete when the token carries `profile:read_all`. A `read,activity:read_all` token gets
 * the summary athlete without them; that is detected (isGearScopeMissing) and exposed as the
 * coarse `gearScopeMissing` flag instead of failing. Gear ids referenced by stored activities are
 * still tried one by one through GET /gear/{id}, best effort.
 */
const ATHLETE_URL = 'https://www.strava.com/api/v3/athlete'
const GEAR_URL = 'https://www.strava.com/api/v3/gear/'
export const ATHLETE_REFRESH_MS = 24 * 3600 * 1000
// after a failed refresh, wait this long before the next attempt (the sync loop runs every 30 min)
export const ATHLETE_RETRY_MS = 3600 * 1000
// a snapshot whose gear list is incomplete (a transient /gear/{id} failure) is refreshed this soon
export const GEAR_PARTIAL_RETRY_MS = 3600 * 1000
// hard cap on one whole refresh (athlete + every gear call); its Strava calls are aborted past it
export const ATHLETE_TIMEOUT_MS = 60 * 1000
const MAX_GEAR = 20
// Strava gear ids: "b<digits>" for bikes, "g<digits>" for shoes
const GEAR_ID_RE = /^[bg]\d{1,18}$/
/** @type {Record<string, string>} */
const FRAME_TYPES = { 1: 'mtb', 2: 'cross', 3: 'road', 4: 'tt', 5: 'gravel' }
/** @type {Record<string, string>} */
const ATHLETE_TYPES = { 0: 'cyclist', 1: 'runner' }

/**
 * @typedef {import('./strava.js').GetAccessToken} GetAccessToken @typedef {import('./strava.js').FetchImpl} FetchImpl
 * @typedef {import('./strava.js').Log} Log @typedef {import('./strava.js').StravaError} StravaError
 * @typedef {import('./db.js').Queryable} Queryable @typedef {import('./athlete-db.js').Device} Device
 * @typedef {import('node:http').IncomingMessage} Req @typedef {import('node:http').ServerResponse} Res
 */
/** Strava's athlete / gear JSON or a stored snapshot row: untrusted, every field is re-checked (num, str, httpsUrl). @typedef {Record<string, any>} StravaJson */
/** One shaped bike or shoe of the snapshot (shapeGear). @typedef {{ id: string | null, name: string | null, brand: string | null, model: string | null, frameType?: string | null, weightKg?: number | null, distanceM: number | null, retired: boolean, primary: boolean }} Gear */
/** The 'refreshed' | 'fresh' | 'backoff' | 'failed' outcome of maybeRefresh. @typedef {'refreshed' | 'fresh' | 'backoff' | 'failed'} RefreshOutcome */

const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (/** @type {unknown} */ v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const httpsUrl = (/** @type {unknown} */ v) => (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : null)

/**
 * @param {string} url @param {GetAccessToken} getAccessToken @param {FetchImpl} fetchImpl @param {string} label
 * @param {AbortSignal | undefined} signal @returns {Promise<any>} the untrusted JSON body
 */
async function stravaGet (url, getAccessToken, fetchImpl, label, signal) {
  const token = await getAccessToken()
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal })
  if (res.status === 429) throw Object.assign(new Error('strava rate limit reached'), { rateLimited: true })
  if (!res.ok) throw new Error(`strava ${label} failed: ${res.status}`)
  return res.json()
}

/** @param {GetAccessToken} getAccessToken @param {FetchImpl} [fetchImpl] @param {AbortSignal} [signal] @returns {Promise<StravaJson>} */
export function fetchAthlete (getAccessToken, fetchImpl = fetch, signal) {
  return stravaGet(ATHLETE_URL, getAccessToken, fetchImpl, 'athlete', signal)
}

/**
 * GET /gear/{id} per well-formed id; a failed id is skipped. Returns {details: {id: detail}, partial}.
 * `partial` = some id failed TRANSIENTLY (5xx / network), so the list is worth retrying soon. A 4xx
 * (403 without profile:read_all, 404 for gear that is not the athlete's) is a definite answer and
 * does not make the snapshot partial, or a read-only token would re-poll every gear id hourly
 * forever. A 429 or an abort still fails the whole refresh.
 * @param {GetAccessToken} getAccessToken @param {string[]} ids @param {FetchImpl} [fetchImpl] @param {AbortSignal} [signal]
 * @returns {Promise<{ details: Record<string, StravaJson>, partial: boolean }>}
 */
export async function fetchGearDetails (getAccessToken, ids, fetchImpl = fetch, signal) {
  /** @type {Record<string, StravaJson>} */
  const details = {}
  let partial = false
  for (const id of ids) {
    if (!GEAR_ID_RE.test(String(id))) continue
    try {
      details[id] = await stravaGet(GEAR_URL + id, getAccessToken, fetchImpl, 'gear', signal)
    } catch (err) {
      const e = /** @type {StravaError} */ (err)
      if (e.rateLimited || e.name === 'AbortError' || signal?.aborted) throw err
      const status = Number(/: (\d{3})$/.exec(e.message)?.[1])
      if (!(status >= 400 && status < 500)) partial = true
    }
  }
  return { details, partial }
}

/** @param {StravaJson | null | undefined} athlete @returns {any[]} */
const gearList = (athlete) => [
  ...(Array.isArray(athlete?.bikes) ? athlete.bikes : []),
  ...(Array.isArray(athlete?.shoes) ? athlete.shoes : [])
]

/**
 * Every gear id worth a detail call: the athlete's own gear first, then ids seen on activities.
 * @param {StravaJson | null | undefined} athlete @param {string[] | null | undefined} activityIds @returns {string[]}
 */
export function gearIdsOf (athlete, activityIds) {
  const ids = [...gearList(athlete).map((g) => g && g.id), ...(activityIds || [])]
  return [...new Set(ids.filter((id) => typeof id === 'string' && GEAR_ID_RE.test(id)))].slice(0, MAX_GEAR)
}

/**
 * True when the token evidently lacks profile:read_all: /athlete carries neither `bikes` nor
 * `shoes`, or both are empty while stored activities reference gear.
 * @param {StravaJson | null | undefined} athlete @param {string[] | null | undefined} activityIds
 */
export function isGearScopeMissing (athlete, activityIds) {
  const hasArrays = Array.isArray(athlete?.bikes) || Array.isArray(athlete?.shoes)
  if (!hasArrays) return true
  return gearList(athlete).length === 0 && (activityIds || []).length > 0
}

/** @param {StravaJson | null | undefined} summary @param {StravaJson | null | undefined} detail @param {'bike' | 'shoe'} kind @returns {Gear} */
function shapeGear (summary, detail, kind) {
  const s = summary || {}
  const d = detail || {}
  const pick = (/** @type {string} */ k) => (d[k] !== undefined ? d[k] : s[k])
  const base = {
    id: str(s.id) || str(d.id),
    name: str(pick('name')),
    brand: str(d.brand_name),
    model: str(d.model_name)
  }
  const tail = {
    distanceM: num(d.distance) ?? num(s.distance),
    retired: Boolean(pick('retired')),
    primary: Boolean(pick('primary'))
  }
  if (kind === 'shoe') return { ...base, ...tail }
  return { ...base, frameType: FRAME_TYPES[d.frame_type] || null, weightKg: num(d.weight), ...tail }
}

/**
 * Athlete summary gear + /gear/{id} details -> {bikes, shoes}; detail-only ids fill in when the scope is missing.
 * @param {StravaJson | null | undefined} athlete @param {Record<string, StravaJson>} [details]
 * @returns {{ bikes: Gear[], shoes: Gear[] }}
 */
export function buildGear (athlete, details = {}) {
  /** @type {Gear[]} */
  const bikes = []
  /** @type {Gear[]} */
  const shoes = []
  const seen = new Set()
  for (const [kind, list] of /** @type {['bike' | 'shoe', unknown][]} */ ([['bike', athlete?.bikes], ['shoe', athlete?.shoes]])) {
    for (const g of Array.isArray(list) ? list : []) {
      if (!g || typeof g !== 'object') continue
      seen.add(g.id)
      ;(kind === 'bike' ? bikes : shoes).push(shapeGear(g, details[g.id], kind))
    }
  }
  for (const [id, d] of Object.entries(details || {})) {
    if (seen.has(id) || !d) continue
    if (id.startsWith('b')) bikes.push(shapeGear({ id }, d, 'bike'))
    else if (id.startsWith('g')) shoes.push(shapeGear({ id }, d, 'shoe'))
  }
  return { bikes, shoes }
}

const epochMs = (/** @type {unknown} */ v) => {
  const t = v ? new Date(/** @type {string | number | Date} */ (v)).getTime() : 0
  return Number.isFinite(t) ? t : 0
}

/**
 * The /export/athlete body: profile fields only. Never the athlete id, username, sex, weight or
 * the raw payload (the repo takes body weight from the scale, not from Strava).
 * @param {StravaJson | null | undefined} row the stored snapshot (loadAthlete) @param {Device[] | null | undefined} devices
 */
export function toAthleteExport (row, devices) {
  const a = row?.athlete || {}
  const gear = row?.gear || {}
  const fetched = row?.fetched_at ? new Date(row.fetched_at) : null
  return {
    fetchedAt: fetched && !Number.isNaN(fetched.getTime()) ? fetched.toISOString() : null,
    firstname: str(a.firstname),
    lastname: str(a.lastname),
    city: str(a.city),
    state: str(a.state),
    country: str(a.country),
    profile: httpsUrl(a.profile),
    profileMedium: httpsUrl(a.profile_medium),
    measurementPreference: str(a.measurement_preference),
    athleteType: ATHLETE_TYPES[a.athlete_type] || null,
    bikes: Array.isArray(gear.bikes) ? gear.bikes : [],
    shoes: Array.isArray(gear.shoes) ? gear.shoes : [],
    gearScopeMissing: Boolean(row?.gear_scope_missing),
    devices: devices || []
  }
}

/**
 * maybeRefresh(): fetch /athlete (+ gear) when the stored snapshot is older than 24 h (1 h when its
 * gear list was partial), at most one attempt per ATHLETE_RETRY_MS after a failure. The failure time
 * is persisted in strava_athlete, so a restart does not retry immediately. Concurrent calls share one
 * in-flight refresh (it never overlaps itself), and the whole refresh is capped at `timeoutMs` (its
 * Strava calls are aborted). Never throws: returns 'refreshed' | 'fresh' | 'backoff' | 'failed'.
 * @param {{ pool: Queryable, getAccessToken: GetAccessToken, fetchImpl?: FetchImpl, now?: () => number, log?: Log, timeoutMs?: number }} options
 */
export function createAthleteRefresher ({ pool, getAccessToken, fetchImpl = fetch, now = Date.now, log = console.log, timeoutMs = ATHLETE_TIMEOUT_MS }) {
  // in-memory copy of the last failure: still backs off when the failure could not be persisted
  let lastFailure = 0
  /** @type {Promise<RefreshOutcome> | null} */
  let inflight = null

  /** @returns {Promise<RefreshOutcome>} */
  async function refresh () {
    if (lastFailure && now() - lastFailure < ATHLETE_RETRY_MS) return 'backoff'
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const row = await loadAthlete(pool)
      const failedAt = epochMs(row?.last_failure_at)
      if (failedAt > epochMs(row?.last_ok_at) && now() - failedAt < ATHLETE_RETRY_MS) return 'backoff'
      const fetchedAt = epochMs(row?.fetched_at)
      const maxAge = row?.gear_partial ? GEAR_PARTIAL_RETRY_MS : ATHLETE_REFRESH_MS
      if (fetchedAt && now() - fetchedAt < maxAge) return 'fresh'

      const athlete = await fetchAthlete(getAccessToken, fetchImpl, ctrl.signal)
      const usedIds = await activityGearIds(pool)
      const { details, partial } = await fetchGearDetails(getAccessToken, gearIdsOf(athlete, usedIds), fetchImpl, ctrl.signal)
      const gear = buildGear(athlete, details)
      const gearScopeMissing = isGearScopeMissing(athlete, usedIds)
      await saveAthlete(pool, { athlete, gear, gearScopeMissing, gearPartial: partial })
      lastFailure = 0
      log(JSON.stringify({ event: 'strava_athlete', bikes: gear.bikes.length, shoes: gear.shoes.length, gearScopeMissing, gearPartial: partial }))
      return 'refreshed'
    } catch (err) {
      const e = /** @type {StravaError} */ (err)
      lastFailure = now()
      const message = ctrl.signal.aborted ? `timed out after ${timeoutMs} ms` : e.message
      log(JSON.stringify({ event: 'strava_athlete_failed', message, rateLimited: Boolean(e.rateLimited) }))
      try {
        await recordAthleteFailure(pool, lastFailure)
      } catch (dbErr) {
        log(JSON.stringify({ event: 'strava_athlete_failure_not_saved', message: /** @type {Error} */ (dbErr).message }))
      }
      return 'failed'
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    maybeRefresh () {
      if (!inflight) inflight = refresh().finally(() => { inflight = null })
      return inflight
    }
  }
}

/**
 * GET /export/athlete — same bearer check as every /export/* route; logs counts only.
 * @param {{ pool: Queryable, token?: string | null, log?: Log, checkBearer?: (req: Req) => boolean }} options
 */
export function createAthleteExportHandler ({ pool, token, log = console.log, checkBearer = createBearerCheck(token) }) {
  /** @param {Req} req @param {Res} res */
  return async function handleAthleteExport (req, res) {
    if (!checkBearer(req)) {
      send(res, 401, { error: 'unauthorized' })
      return
    }
    const [row, devices] = await Promise.all([loadAthlete(pool), listDevices(pool)])
    const body = toAthleteExport(row, devices)
    log(JSON.stringify({ event: 'exported_athlete', snapshot: Boolean(row), bikes: body.bikes.length, shoes: body.shoes.length, devices: devices.length }))
    send(res, 200, body)
  }
}
