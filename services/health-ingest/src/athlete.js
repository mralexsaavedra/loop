import { isAuthorized } from './auth.js'

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
const MAX_GEAR = 20
// Strava gear ids: "b<digits>" for bikes, "g<digits>" for shoes
const GEAR_ID_RE = /^[bg]\d{1,18}$/
const FRAME_TYPES = { 1: 'mtb', 2: 'cross', 3: 'road', 4: 'tt', 5: 'gravel' }
const ATHLETE_TYPES = { 0: 'cyclist', 1: 'runner' }

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const httpsUrl = (v) => (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : null)

async function stravaGet (url, getAccessToken, fetchImpl, label) {
  const token = await getAccessToken()
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } })
  if (res.status === 429) throw Object.assign(new Error('strava rate limit reached'), { rateLimited: true })
  if (!res.ok) throw new Error(`strava ${label} failed: ${res.status}`)
  return res.json()
}

export function fetchAthlete (getAccessToken, fetchImpl = fetch) {
  return stravaGet(ATHLETE_URL, getAccessToken, fetchImpl, 'athlete')
}

/** GET /gear/{id} per well-formed id; a failed id is skipped. Returns {id: detail}. */
export async function fetchGearDetails (getAccessToken, ids, fetchImpl = fetch) {
  const out = {}
  for (const id of ids) {
    if (!GEAR_ID_RE.test(String(id))) continue
    try {
      out[id] = await stravaGet(GEAR_URL + id, getAccessToken, fetchImpl, 'gear')
    } catch (err) {
      if (err.rateLimited) throw err
    }
  }
  return out
}

const gearList = (athlete) => [
  ...(Array.isArray(athlete?.bikes) ? athlete.bikes : []),
  ...(Array.isArray(athlete?.shoes) ? athlete.shoes : [])
]

/** Every gear id worth a detail call: the athlete's own gear first, then ids seen on activities. */
export function gearIdsOf (athlete, activityIds) {
  const ids = [...gearList(athlete).map((g) => g && g.id), ...(activityIds || [])]
  return [...new Set(ids.filter((id) => typeof id === 'string' && GEAR_ID_RE.test(id)))].slice(0, MAX_GEAR)
}

/**
 * True when the token evidently lacks profile:read_all: /athlete carries neither `bikes` nor
 * `shoes`, or both are empty while stored activities reference gear.
 */
export function isGearScopeMissing (athlete, activityIds) {
  const hasArrays = Array.isArray(athlete?.bikes) || Array.isArray(athlete?.shoes)
  if (!hasArrays) return true
  return gearList(athlete).length === 0 && (activityIds || []).length > 0
}

function shapeGear (summary, detail, kind) {
  const s = summary || {}
  const d = detail || {}
  const pick = (k) => (d[k] !== undefined ? d[k] : s[k])
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

/** Athlete summary gear + /gear/{id} details -> {bikes, shoes}; detail-only ids fill in when the scope is missing. */
export function buildGear (athlete, details = {}) {
  const bikes = []
  const shoes = []
  const seen = new Set()
  for (const [kind, list] of [['bike', athlete?.bikes], ['shoe', athlete?.shoes]]) {
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

export async function saveAthlete (pool, { athlete, gear, gearScopeMissing }) {
  await pool.query(
    `INSERT INTO strava_athlete (id, fetched_at, athlete, gear, gear_scope_missing)
     VALUES (1, now(), $1, $2, $3)
     ON CONFLICT (id) DO UPDATE
       SET fetched_at = now(), athlete = EXCLUDED.athlete, gear = EXCLUDED.gear,
           gear_scope_missing = EXCLUDED.gear_scope_missing`,
    // stringified: node-postgres would turn a JS array into a PG array literal, not JSON
    [JSON.stringify(athlete ?? {}), JSON.stringify(gear ?? { bikes: [], shoes: [] }), Boolean(gearScopeMissing)]
  )
}

export async function loadAthlete (pool) {
  const { rows } = await pool.query('SELECT fetched_at, athlete, gear, gear_scope_missing FROM strava_athlete WHERE id = 1')
  return rows[0] ?? null
}

/** Devices seen on stored activities (Strava's `device_name`), newest use first. */
export async function listDevices (pool) {
  const { rows } = await pool.query(
    `SELECT payload->>'device_name' AS name, count(*)::int AS count, max(payload->>'start_date_local') AS last
       FROM strava_activity
      WHERE coalesce(payload->>'device_name', '') <> ''
      GROUP BY 1
      ORDER BY 3 DESC, 1 ASC`
  )
  return rows.map((r) => ({ name: r.name, count: Number(r.count) || 0, lastUsed: typeof r.last === 'string' ? r.last.slice(0, 10) : null }))
}

export async function activityGearIds (pool) {
  const { rows } = await pool.query(
    `SELECT DISTINCT payload->>'gear_id' AS id
       FROM strava_activity
      WHERE coalesce(payload->>'gear_id', '') <> ''
      ORDER BY 1`
  )
  return rows.map((r) => r.id)
}

/**
 * The /export/athlete body: profile fields only. Never the athlete id, username, sex, weight or
 * the raw payload (the repo takes body weight from the scale, not from Strava).
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
 * maybeRefresh(): fetch /athlete (+ gear) when the stored snapshot is older than 24 h, at most
 * one attempt per ATHLETE_RETRY_MS after a failure. Never throws: a profile failure must not
 * fail the activity sync. Returns 'refreshed' | 'fresh' | 'backoff' | 'failed'.
 */
export function createAthleteRefresher ({ pool, getAccessToken, fetchImpl = fetch, now = Date.now, log = console.log }) {
  let lastFailure = 0

  return {
    async maybeRefresh () {
      if (lastFailure && now() - lastFailure < ATHLETE_RETRY_MS) return 'backoff'
      try {
        const row = await loadAthlete(pool)
        const fetchedAt = row?.fetched_at ? new Date(row.fetched_at).getTime() : 0
        if (fetchedAt && now() - fetchedAt < ATHLETE_REFRESH_MS) return 'fresh'

        const athlete = await fetchAthlete(getAccessToken, fetchImpl)
        const usedIds = await activityGearIds(pool)
        const details = await fetchGearDetails(getAccessToken, gearIdsOf(athlete, usedIds), fetchImpl)
        const gear = buildGear(athlete, details)
        const gearScopeMissing = isGearScopeMissing(athlete, usedIds)
        await saveAthlete(pool, { athlete, gear, gearScopeMissing })
        lastFailure = 0
        log(JSON.stringify({ event: 'strava_athlete', bikes: gear.bikes.length, shoes: gear.shoes.length, gearScopeMissing }))
        return 'refreshed'
      } catch (err) {
        lastFailure = now()
        log(JSON.stringify({ event: 'strava_athlete_failed', message: err.message, rateLimited: Boolean(err.rateLimited) }))
        return 'failed'
      }
    }
  }
}

function send (res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

/** GET /export/athlete — same bearer check as every /export/* route; logs counts only. */
export function createAthleteExportHandler ({ pool, token, log = console.log }) {
  return async function handleAthleteExport (req, res) {
    if (!isAuthorized(req.headers.authorization, token)) {
      send(res, 401, { error: 'unauthorized' })
      return
    }
    const [row, devices] = await Promise.all([loadAthlete(pool), listDevices(pool)])
    const body = toAthleteExport(row, devices)
    log(JSON.stringify({ event: 'exported_athlete', snapshot: Boolean(row), bikes: body.bikes.length, shoes: body.shoes.length, devices: devices.length }))
    send(res, 200, body)
  }
}
