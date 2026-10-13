#!/usr/bin/env node
/* Strava sync — pulls every stored Strava activity from the self-hosted ingest service
 * (services/health-ingest, GET /export/strava) and MERGES them into workouts.csv, so rides
 * logged only on Strava (not captured by the Watch) show up on the Entrenos dashboard.
 *
 *   npm run sync:strava
 *
 * Env    : INGEST_URL (default http://localhost:8088), INGEST_TOKEN (falls back to
 *          services/health-ingest/.env, same file sync-shortcut.js reads).
 * Writes : data/apple-health/extract/workouts.csv + rides.csv (ride windows + power flag for the
 *          active-energy correction, see rideRow) + workout-zones.csv (per-activity time in HR
 *          zone 0-5 from the ingest's HR histograms, see lib/training/hr-zones.mjs) + _meta.json
 *          (each via temp file + rename; _meta.json first, belt and braces — see the orphan-safety note below). Nothing is
 *          written if the service can't be reached, answers a non-array, or there is no token.
 *
 * Strategy: FULL pull every run — since_id is used only for keyset pagination against
 * /export/strava, never as an incremental cursor. Strava ids are not insertion order and an
 * edited activity keeps its id, so an id cursor would miss edits.
 *
 * Merge rule (sync-common.js mergeCsv with exportWins: false): every Strava activity is ALWAYS
 * written, even on a date the export also covers — Strava is the only source of Relative Effort,
 * kJ and elevation, so dropping it on every Watch day would blind the load score. A Watch copy of
 * the same session is deduped at READ time by lib/training/sessions.mjs mergeSameDay (Strava
 * supersedes the Watch rows of the same date + modality when it covers at least half their
 * minutes); every workouts.csv reader goes through it. Rows this sync wrote before are
 * identified by the EXACT source tag "Strava API" (not the historical "Strava" tag some rows
 * already carry from the old /sync/strava ingest loop — those are left untouched) and rebuilt
 * from scratch every run, so a date dropping out of the ledger (e.g. after extract.js rewrote
 * _meta.json) can never leave a stale Strava-tagged row behind — see the orphan-safety test.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as common from './sync-common.mjs'
import { WORKOUTS_HEADER } from './samples.mjs'
import * as zones from '../../lib/training/hr-zones.mjs'
import { readProfileMaxHr } from '../../lib/profile/read.mjs'
import { isMain } from '../../scripts/lib/is-main.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))

const STRAVA_SOURCE = 'Strava API'
// SYNC_STRAVA_OUT_DIR / INGEST_ENV_FILE overrides exist ONLY so the child-process error-path
// tests below can point main() at a disposable tmp dir / tmp env file instead of the real
// personal data/apple-health/extract or services/health-ingest/.env — unset in production.
const OUT = process.env.SYNC_STRAVA_OUT_DIR || path.join(DIR, 'extract')
const WORKOUTS_CSV = 'workouts.csv'

// sport_type -> workouts.csv `type` (matches extract.js's HKWorkoutActivityType-derived strings, so
// a Watch copy and a Strava copy of one session land in the SAME physical modality and
// lib/training/sessions.mjs mergeSameDay counts them once). Racket, team and outdoor sports map to
// the Apple type the Watch writes (Tennis, Soccer…; Padel has no Apple type and keeps its name): all
// land in the `other` modality (lib/score/modality.mjs), never gym. Strava's generic "Workout" (where
// a Watch "Other" workout lands when it syncs) maps to "Other", the Watch's generic label that
// modality.mjs counts as gym. Anything not in this table lands on FALLBACK_TYPE "Unmapped" (a
// non-gym type -> `other`; it used to be "Other", which filed every unknown sport, e.g. tennis, as
// gym load) and is counted in the sync's `unmapped` report instead of aborting the sync.
const SPORT_TYPE_MAP = {
  Run: 'Running', TrailRun: 'Running', VirtualRun: 'Running',
  Ride: 'Cycling', VirtualRide: 'Cycling', EBikeRide: 'Cycling', EMountainBikeRide: 'Cycling',
  MountainBikeRide: 'Cycling', GravelRide: 'Cycling', Handcycle: 'Cycling', Velomobile: 'Cycling',
  WeightTraining: 'TraditionalStrengthTraining',
  HighIntensityIntervalTraining: 'HighIntensityIntervalTraining',
  Crossfit: 'CrossTraining',
  Workout: 'Other',
  Walk: 'Walking', Hike: 'Hiking', Swim: 'Swimming',
  Rowing: 'Rowing', VirtualRow: 'Rowing',
  Elliptical: 'Elliptical', Pilates: 'Pilates', Yoga: 'Yoga', StairStepper: 'StairClimbing',
  // racket + team sports
  Tennis: 'Tennis', TableTennis: 'TableTennis', Squash: 'Squash', Badminton: 'Badminton',
  Racquetball: 'Racquetball', Pickleball: 'Pickleball', Padel: 'Padel',
  Soccer: 'Soccer', Basketball: 'Basketball', Volleyball: 'Volleyball', Golf: 'Golf',
  // outdoor / board sports
  RockClimbing: 'Climbing', AlpineSki: 'DownhillSkiing', BackcountrySki: 'CrossCountrySkiing',
  NordicSki: 'CrossCountrySkiing', Snowboard: 'Snowboarding', Snowshoe: 'SnowSports',
  IceSkate: 'SkatingSports', InlineSkate: 'SkatingSports', Skateboard: 'SkatingSports',
  Kayaking: 'PaddleSports', Canoeing: 'PaddleSports', StandUpPaddling: 'PaddleSports',
  Surfing: 'SurfingSports', Kitesurf: 'SailingSports', Windsurf: 'SailingSports', Sail: 'Sailing'
}
const FALLBACK_TYPE = 'Unmapped'

function translateType (sportType) {
  return SPORT_TYPE_MAP[sportType] || FALLBACK_TYPE
}

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const round2 = (v) => Math.round(v * 100) / 100
const bpmRound = (v) => Math.round(v)
// Relative Effort is an integer score; 0 and 1 are genuine values, only absence is blank
const reCell = (v) => (numOrNull(v) != null ? Math.round(v) : '')
const kjCell = (v) => (numOrNull(v) != null ? round2(v) : '')
// metres climbed, 1 decimal; 0 is a genuine value (a flat or indoor ride)
const elevCell = (v) => (numOrNull(v) != null ? Math.round(v * 10) / 10 : '')

/**
 * One Strava activity -> one workouts.csv row, or null when there is no usable duration or
 * date. `moving_time` is preferred over `elapsed_time` (matches the Watch's pause-excluded
 * duration; elapsed time would inflate rides with café stops).
 */
function toRow (activity) {
  const startLocal = activity && activity.start_local
  if (!startLocal || typeof startLocal !== 'string') return null
  const date = startLocal.slice(0, 10)

  const movingTime = numOrNull(activity.moving_time)
  const elapsedTime = numOrNull(activity.elapsed_time)
  const durationSec = movingTime > 0 ? movingTime : elapsedTime
  if (!(durationSec > 0)) return null
  const durationMin = round2(durationSec / 60)

  const sportType = activity.sport_type
  const mapped = Object.prototype.hasOwnProperty.call(SPORT_TYPE_MAP, sportType)
  const type = translateType(sportType)

  const hrAvg = numOrNull(activity.average_heartrate)
  const hrMax = numOrNull(activity.max_heartrate)
  const distance = numOrNull(activity.distance)
  const distanceKm = distance > 0 ? round2(distance / 1000) : null

  const line = [
    date, type, durationMin, '',
    hrAvg != null ? bpmRound(hrAvg) : '',
    '',
    hrMax != null ? bpmRound(hrMax) : '',
    STRAVA_SOURCE,
    distanceKm != null ? distanceKm : '',
    reCell(activity.suffer_score),
    kjCell(activity.kilojoules),
    elevCell(activity.total_elevation_gain)
  ].join(',')

  return { date, line, mapped, sportType, hasHr: hrAvg != null }
}

// many activities -> { rows: [{date,line,hasHr}], unmapped: {sport_type: n}, dropped: n }.
// `dropped` counts activities toRow() could not translate at all (no date/duration) — these
// never reach the merge. `hasHr` travels with each row so the caller can count noHr against the
// rows actually written.
function buildRows (activities) {
  const rows = []
  const unmapped = {}
  let dropped = 0
  for (const activity of activities) {
    const r = toRow(activity)
    if (!r) { dropped++; continue }
    if (!r.mapped) unmapped[r.sportType || 'null'] = (unmapped[r.sportType || 'null'] || 0) + 1
    rows.push({ date: r.date, line: r.line, hasHr: r.hasHr })
  }
  return { rows, unmapped, dropped }
}

// ---- rides.csv: the ride windows lib/health/ride-energy.mjs needs --------------------------
// workouts.csv has no start time, and adding columns there would touch extract.js, every
// positional reader and the demo generator for data only Strava has and one reader uses. So the
// window lives in its own small file, rebuilt from scratch on every (full) pull: one row per
// cycling-family activity. `start` = ISO local start WITH its UTC offset (start_date_local -
// start_date); blank when the ingest image does not export start_date, and device_watts blank
// when it does not export the flag — the correction then skips the ride (degrades to the Watch).
const RIDES_CSV = 'rides.csv'
const RIDES_HEADER = 'date,start,elapsed_s,kilojoules,device_watts,source'

// "2026-09-26T09:02:00Z" (local wall clock, Strava's fake Z) + "2026-09-26T07:02:00Z" (UTC)
// -> "2026-09-26T09:02:00+02:00"; null when either is unusable or the offset is implausible
function localIsoWithOffset (startLocal, startUtc) {
  const wall = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/.exec(startLocal || '')
  if (!wall || typeof startUtc !== 'string') return null
  const off = (Date.parse(wall[1] + 'Z') - Date.parse(startUtc)) / 60000
  if (!Number.isFinite(off) || Math.abs(off) > 14 * 60 || off % 15 !== 0) return null
  const a = Math.abs(off)
  return `${wall[1]}${off < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

/** One Strava activity -> one rides.csv line, or null (not a ride, no start, no duration). */
function rideRow (activity) {
  if (!activity || translateType(activity.sport_type) !== 'Cycling') return null
  const startLocal = activity.start_local
  if (!startLocal || typeof startLocal !== 'string') return null
  const elapsed = numOrNull(activity.elapsed_time) > 0 ? numOrNull(activity.elapsed_time) : numOrNull(activity.moving_time)
  if (!(elapsed > 0)) return null
  const dw = activity.device_watts === true ? 'true' : activity.device_watts === false ? 'false' : ''
  return [startLocal.slice(0, 10), localIsoWithOffset(startLocal, activity.start_utc) || '', Math.round(elapsed),
    kjCell(activity.kilojoules), dw, STRAVA_SOURCE].join(',')
}

/** activities -> { rows, power (device_watts true + kJ), withStart (start with an offset) } for _meta.json */
function ridesStats (activities) {
  const lines = activities.map(rideRow).filter(Boolean).map((l) => l.split(','))
  return { rows: lines.length, power: lines.filter((c) => c[4] === 'true' && c[3] !== '').length, withStart: lines.filter((c) => c[1] !== '').length }
}

/** activities -> the whole rides.csv text, sorted by local start. */
function buildRides (activities) {
  const rows = activities.map((a) => ({ a, line: rideRow(a) })).filter((r) => r.line)
    .sort((x, y) => (x.a.start_local < y.a.start_local ? -1 : x.a.start_local > y.a.start_local ? 1 : x.line < y.line ? -1 : x.line > y.line ? 1 : 0))
  return [RIDES_HEADER, ...rows.map((r) => r.line)].join('\n') + '\n'
}

const range = (dates) => (dates.length ? `${dates[0]}..${dates[dates.length - 1]}` : 'n/a')

const SYNC_NOTE = 'Strava rows (npm run sync:strava) are always kept, also on dates the export covers, and are rebuilt on every sync from source="Strava API"; readers dedupe a Watch copy of the same session (lib/training/sessions.mjs mergeSameDay: Strava wins per date + modality when it covers at least half the Watch minutes). Historical source=Strava rows (from the old ingest /sync/strava loop) are left untouched. rides.csv (ride start with offset, elapsed time, kJ, device_watts: the windows of the power-meter active-energy correction) and workout-zones.csv (per-activity seconds in HR zone 0-5, % of max HR) are rebuilt from scratch on every sync. Accepted limitations: deleted Strava activities are not removed, and edits older than the ingest service\'s 7-day overlap window are never picked up. See docs/data-pipeline.md.'

// Pure: refresh the workouts rows/range + record the sync. Deterministic (no timestamps) so
// re-running an unchanged sync rewrites identical bytes.
function updateMeta (meta, merged, info) {
  // rides.csv (ride windows for the active-energy correction) is rebuilt every run: its row count
  // and how many rides can feed the correction (real power + kJ; a start with offset)
  const out = JSON.parse(JSON.stringify(meta))
  out.rows = out.rows || {}
  out.ranges = out.ranges || {}
  out.rows.workouts = merged.rows
  out.ranges.workouts = range(merged.dates)
  out.stravaSync = {
    activities: info.activities,
    added: merged.added,
    noHr: info.noHr,
    dropped: info.dropped,
    range: range(merged.addedDates),
    unmapped: info.unmapped,
    owned: { [WORKOUTS_CSV]: merged.addedDates }
  }
  if (info.rides) {
    out.rows.rides = info.rides.rows
    out.stravaSync.rides = info.rides
  }
  // workout-zones.csv: rows + the max HR every row was cut with and where it came from
  if (info.zones) {
    out.rows['workout-zones'] = info.zones.rows
    out.stravaSync.zones = { rows: info.zones.rows, maxHr: info.zones.max ? info.zones.max.maxHr : null, maxHrSource: info.zones.max ? info.zones.max.source : null }
  }
  out.notes = Array.isArray(out.notes) ? out.notes : []
  for (const n of out.notes.filter((n) => /^Strava rows \(npm run sync:strava\)/.test(n) && n !== SYNC_NOTE)) {
    out.notes.splice(out.notes.indexOf(n), 1)
  }
  if (!out.notes.includes(SYNC_NOTE)) out.notes.push(SYNC_NOTE)
  return out
}

// Pure planner: activities (full pull) + a reader (name -> text|null) -> files to write.
function planSync (activities, readFile, { profileMaxHr = null } = {}) {
  const { rows, unmapped, dropped } = buildRows(activities)
  const existing = readFile(WORKOUTS_CSV)
  const metaText = readFile('_meta.json')
  const prevMeta = metaText != null ? JSON.parse(metaText) : null

  // Crash-window safety: a row is dropped ONLY when its own source tag is the exact
  // "Strava API" match — never by a ledger date. A ledger can go stale (e.g. extract.js
  // crashes between rewriting workouts.csv and _meta.json, leaving a pre-crash ledger next to
  // a fresh export CSV); dropping by ledger date would delete a real export/manual row that
  // merely happens to share a date the ledger once claimed. `stravaSync.owned` in _meta.json
  // stays pure REPORTING metadata (which dates this sync added last run), never a merge input.
  const merged = common.mergeCsv(existing, WORKOUTS_HEADER, rows, {
    sourceCol: 7,
    isOwn: (s) => s === STRAVA_SOURCE,
    exportWins: false
  })

  // every translated row is written (exportWins: false), so noHr counts them all
  const noHr = rows.filter((r) => !r.hasHr).length

  const writes = {}
  const ridesText = buildRides(activities)
  const ridesExisting = readFile(RIDES_CSV)
  if (ridesText !== ridesExisting && (ridesExisting != null || ridesText !== `${RIDES_HEADER}\n`)) writes[RIDES_CSV] = ridesText
  // workout-zones.csv is rebuilt from scratch like rides.csv; never created header-only
  const z = zones.buildZones(activities, { translateType, source: STRAVA_SOURCE, profileMaxHr, startOf: (a) => localIsoWithOffset(a.start_local, a.start_utc) })
  const zonesExisting = readFile(zones.ZONES_CSV)
  if (z.text !== zonesExisting && (zonesExisting != null || z.rows > 0)) writes[zones.ZONES_CSV] = z.text
  const csvHasContent = !(existing == null && rows.length === 0) // never create an empty CSV
  if (csvHasContent && merged.text !== existing) writes[WORKOUTS_CSV] = merged.text

  if (csvHasContent || prevMeta) {
    const meta = updateMeta(prevMeta || {}, merged, { activities: activities.length, unmapped, noHr, dropped, rides: ridesStats(activities), zones: (zonesExisting != null || z.rows > 0) ? z : null })
    const text = JSON.stringify(meta, null, 2) + '\n'
    if (text !== metaText) writes['_meta.json'] = text
  }

  return { writes, merged, unmapped, noHr, dropped, zones: z }
}

// plan + apply against a directory of extract CSVs. _meta.json is written BEFORE workouts.csv
// (belt and braces): even though every run rebuilds its own rows from the source tag alone (so
// a crash between the two renames can never turn a Strava row into a pseudo-export row), writing
// the ledger first means a reader that only sees the new _meta.json still gets accurate metadata.
// _meta.json is shared with sync-shortcut.js (both scripts can touch the same extract/ dir), so
// the whole read-plan-write sequence runs under an exclusive lock to prevent a lost update.
function syncDir (dir, activities, { writeAtomic = common.writeAtomic, profileMaxHr = null } = {}) {
  fs.mkdirSync(dir, { recursive: true }) // the lockfile itself needs the directory to exist
  return common.withLock(path.join(dir, '_meta.json.lock'), () => {
    const readFile = (name) => {
      const p = path.join(dir, name)
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
    }
    const plan = planSync(activities, readFile, { profileMaxHr })
    if (plan.writes['_meta.json'] != null) writeAtomic(path.join(dir, '_meta.json'), plan.writes['_meta.json'])
    if (plan.writes[WORKOUTS_CSV] != null) writeAtomic(path.join(dir, WORKOUTS_CSV), plan.writes[WORKOUTS_CSV])
    if (plan.writes[RIDES_CSV] != null) writeAtomic(path.join(dir, RIDES_CSV), plan.writes[RIDES_CSV])
    if (plan.writes[zones.ZONES_CSV] != null) writeAtomic(path.join(dir, zones.ZONES_CSV), plan.writes[zones.ZONES_CSV])
    return plan
  })
}

// full pull, paged via since_id, from GET /export/strava
function fetchActivities ({ baseUrl, token, sinceId = '0', limit = 500, timeoutMs = 15000, fetchImpl = fetch }) {
  return common.fetchPages({
    baseUrl,
    token,
    sinceId,
    limit,
    timeoutMs,
    fetchImpl,
    buildUrl: ({ baseUrl: base, since, limit: lim }) => `${base}/export/strava?since_id=${since}&limit=${lim}`
  })
}

// An ingest image built before elevation was added stores activities without
// total_elevation_gain, so the elevation_m column would silently stay blank. Strava always sends
// the field (0 for an indoor ride), so its absence on EVERY activity points at a stale image.
function staleImageWarning (activities) {
  if (!activities || !activities.length) return null
  if (activities.some(a => a && a.total_elevation_gain != null)) return null
  return 'WARNING: no activity carries total_elevation_gain — the ingest image is probably stale. ' +
    'Rebuild it (docker compose up -d --build health-ingest) and re-run to fill elevation_m.'
}

// An ingest image built before the energy correction exports neither start_date nor
// device_watts, so no ride can correct the Watch's active energy. Rides with kJ but none carrying
// either field point at a stale image (false is a real value: Strava's estimated power).
function stalePowerWarning (activities) {
  const rides = (activities || []).filter((a) => a && translateType(a.sport_type) === 'Cycling' && numOrNull(a.kilojoules) > 0)
  if (!rides.length) return null
  if (rides.some((a) => typeof a.device_watts === 'boolean' && a.start_utc)) return null
  return 'WARNING: no ride carries device_watts / start_date — the ingest image is probably stale, so the power-meter ' +
    'active-energy correction is off. Rebuild it (docker compose up -d --build health-ingest) and re-run.'
}

// An ingest image built before the HR-stream backfill exports no `hr_hist` at all (null = not
// fetched yet / no HR is a real value), so no workout can get HR zones.
function staleZonesWarning (activities) {
  if (!activities || !activities.length) return null
  if (activities.some((a) => a && Object.prototype.hasOwnProperty.call(a, 'hr_hist'))) return null
  return 'WARNING: no activity carries hr_hist — the ingest image predates the HR zones. Rebuild it ' +
    '(docker compose up -d --build health-ingest) and re-run once the backfill has fetched some streams.'
}

const PROFILE_JSON = process.env.SYNC_STRAVA_PROFILE || path.join(DIR, '..', '..', 'profile', 'profile.json')

async function main () {
  const t0 = Date.now()
  const baseUrl = process.env.INGEST_URL || common.DEFAULT_URL
  const token = common.readIngestToken(process.env, process.env.INGEST_ENV_FILE || common.ENV_FILE)
  if (!token) {
    console.error('ERROR: no ingest token. Set INGEST_TOKEN or create services/health-ingest/.env. No files touched.')
    process.exit(1)
  }

  let activities
  try {
    activities = await fetchActivities({ baseUrl, token })
  } catch (err) {
    if (err.status === 404) {
      console.error('ERROR: ingest service has no /export/strava — rebuild/restart the health-ingest container. No files touched.')
    } else {
      const cause = (err.cause && err.cause.code) || (err.cause && err.cause.message) || err.message
      console.error(`ERROR: could not read from the ingest service at ${baseUrl} (${cause}). Is it running? No files touched.`)
    }
    process.exit(1)
  }

  const stale = staleImageWarning(activities)
  if (stale) console.error(stale)
  const stalePower = stalePowerWarning(activities)
  if (stalePower) console.error(stalePower)
  const staleZones = staleZonesWarning(activities)
  if (staleZones) console.error(staleZones)
  const prof = readProfileMaxHr(PROFILE_JSON)
  if (prof.error) console.error(`WARNING: ${PROFILE_JSON} — ${prof.error}; using the observed max HR for the HR zones.`)
  const plan = syncDir(OUT, activities, { profileMaxHr: prof.maxHr })
  const durationMs = Date.now() - t0
  console.log(`Synced ${activities.length} Strava activities in ${durationMs}ms; ${plan.merged.added} row(s) added for ${range(plan.merged.addedDates)}; ${plan.merged.rows} rows total`)
  if (plan.noHr) console.log(`  ${plan.noHr} row(s) written without HR`)
  if (plan.dropped) console.log(`  ${plan.dropped} activity(ies) dropped (no usable date/duration)`)
  if (Object.keys(plan.unmapped).length) console.log(`  unmapped sport types: ${JSON.stringify(plan.unmapped)}`)
  if (plan.zones.rows) console.log(`  ${plan.zones.rows} workout(s) with HR zones (max HR ${plan.zones.max.maxHr} bpm, ${plan.zones.max.source})`)
  if (!Object.keys(plan.writes).length) console.log('  (no changes)')
}

if (isMain(import.meta.url)) main()

export {
  STRAVA_SOURCE,
  SPORT_TYPE_MAP,
  FALLBACK_TYPE,
  WORKOUTS_CSV,
  WORKOUTS_HEADER,
  translateType,
  toRow,
  buildRows,
  updateMeta,
  planSync,
  syncDir,
  fetchActivities,
  staleImageWarning,
  RIDES_CSV,
  RIDES_HEADER,
  rideRow,
  buildRides,
  stalePowerWarning,
  staleZonesWarning,
  main
}
