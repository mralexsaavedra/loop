#!/usr/bin/env node
/* Strava sync — pulls every stored Strava activity from the self-hosted ingest service
 * (services/health-ingest, GET /export/strava) and MERGES them into workouts.csv, so rides
 * logged only on Strava (not captured by the Watch) show up on the Entrenos dashboard.
 *
 *   npm run sync:strava
 *
 * Env    : INGEST_URL (default http://localhost:8088), INGEST_TOKEN (falls back to
 *          services/health-ingest/.env, same file sync-shortcut.js reads).
 * Writes : data/apple-health/extract/workouts.csv + _meta.json (each via temp file + rename;
 *          _meta.json first, belt and braces — see the orphan-safety note below). Nothing is
 *          written if the service can't be reached, answers a non-array, or there is no token.
 *
 * Strategy: FULL pull every run — since_id is used only for keyset pagination against
 * /export/strava, never as an incremental cursor. Strava ids are not insertion order and an
 * edited activity keeps its id, so an id cursor would miss edits.
 *
 * Merge rule (shared with sync-shortcut.js via sync-common.js): export-derived rows ALWAYS
 * win. Rows this sync wrote before are identified by the EXACT source tag "Strava API" (not
 * the historical "Strava" tag some rows already carry from the old /sync/strava ingest loop —
 * those are left untouched) and rebuilt from scratch every run; they are added only for DATES
 * the export does not cover. Every run rebuilds ALL of its own rows from the current activity
 * set, so a date dropping out of the ledger (e.g. after extract.js rewrote _meta.json) can
 * never leave a stale Strava-tagged row behind — see the orphan-safety test.
 */
const fs = require('fs')
const path = require('path')
const common = require('./sync-common.js')
const { WORKOUTS_HEADER } = require('./samples.js')

const STRAVA_SOURCE = 'Strava API'
// SYNC_STRAVA_OUT_DIR / INGEST_ENV_FILE overrides exist ONLY so the child-process error-path
// tests below can point main() at a disposable tmp dir / tmp env file instead of the real
// personal data/apple-health/extract or services/health-ingest/.env — unset in production.
const OUT = process.env.SYNC_STRAVA_OUT_DIR || path.join(__dirname, 'extract')
const WORKOUTS_CSV = 'workouts.csv'

// sport_type -> workouts.csv `type` (matches extract.js's HKWorkoutActivityType-derived strings).
// Anything not in this table lands on Other (routed to the dashboard's 'hiit' bucket) and is
// counted in the sync's `unmapped` report instead of aborting the sync.
const SPORT_TYPE_MAP = {
  Run: 'Running', TrailRun: 'Running', VirtualRun: 'Running',
  Ride: 'Cycling', VirtualRide: 'Cycling', EBikeRide: 'Cycling', EMountainBikeRide: 'Cycling',
  MountainBikeRide: 'Cycling', GravelRide: 'Cycling', Handcycle: 'Cycling', Velomobile: 'Cycling',
  WeightTraining: 'TraditionalStrengthTraining',
  HighIntensityIntervalTraining: 'HighIntensityIntervalTraining',
  Crossfit: 'CrossTraining',
  Walk: 'Walking', Hike: 'Hiking', Swim: 'Swimming',
  Rowing: 'Rowing', VirtualRow: 'Rowing',
  Elliptical: 'Elliptical', Pilates: 'Pilates', Yoga: 'Yoga'
}
const FALLBACK_TYPE = 'Other'

function translateType (sportType) {
  return SPORT_TYPE_MAP[sportType] || FALLBACK_TYPE
}

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const round2 = (v) => Math.round(v * 100) / 100
const bpmRound = (v) => Math.round(v)
// Relative Effort is an integer score; 0 and 1 are genuine values, only absence is blank
const reCell = (v) => (numOrNull(v) != null ? Math.round(v) : '')
const kjCell = (v) => (numOrNull(v) != null ? round2(v) : '')

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
    kjCell(activity.kilojoules)
  ].join(',')

  return { date, line, mapped, sportType, hasHr: hrAvg != null }
}

// many activities -> { rows: [{date,line,hasHr}], unmapped: {sport_type: n}, dropped: n }.
// `dropped` counts activities toRow() could not translate at all (no date/duration) — these
// never reach the merge. `hasHr` travels with each row so the caller can count noHr AFTER
// merging, against rows actually written, not against every translated activity (a date the
// export already covers is dropped by the merge and must not inflate noHr).
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

const range = (dates) => (dates.length ? `${dates[0]}..${dates[dates.length - 1]}` : 'n/a')

const SYNC_NOTE = 'Strava rows (npm run sync:strava) fill only dates the export does not cover and are rebuilt on every sync from source="Strava API"; historical source=Strava rows (from the old ingest /sync/strava loop) are left untouched. Accepted limitations: date-level precedence can drop a Strava-only activity on a mixed day, deleted Strava activities are not removed, and edits older than the ingest service\'s 7-day overlap window are never picked up. See CLAUDE.md.'

// Pure: refresh the workouts rows/range + record the sync. Deterministic (no timestamps) so
// re-running an unchanged sync rewrites identical bytes.
function updateMeta (meta, merged, info) {
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
  out.notes = Array.isArray(out.notes) ? out.notes : []
  for (const n of out.notes.filter((n) => /^Strava rows \(npm run sync:strava\)/.test(n) && n !== SYNC_NOTE)) {
    out.notes.splice(out.notes.indexOf(n), 1)
  }
  if (!out.notes.includes(SYNC_NOTE)) out.notes.push(SYNC_NOTE)
  return out
}

// Pure planner: activities (full pull) + a reader (name -> text|null) -> files to write.
function planSync (activities, readFile) {
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
    isOwn: (s) => s === STRAVA_SOURCE
  })

  // noHr counts rows actually WRITTEN (i.e. on a date the merge added), not every translated
  // activity — a date the export already covers never reaches the CSV and must not inflate it.
  const addedDateSet = new Set(merged.addedDates)
  const noHr = rows.filter((r) => addedDateSet.has(r.date) && !r.hasHr).length

  const writes = {}
  const csvHasContent = !(existing == null && rows.length === 0) // never create an empty CSV
  if (csvHasContent && merged.text !== existing) writes[WORKOUTS_CSV] = merged.text

  if (csvHasContent || prevMeta) {
    const meta = updateMeta(prevMeta || {}, merged, { activities: activities.length, unmapped, noHr, dropped })
    const text = JSON.stringify(meta, null, 2) + '\n'
    if (text !== metaText) writes['_meta.json'] = text
  }

  return { writes, merged, unmapped, noHr, dropped }
}

// plan + apply against a directory of extract CSVs. _meta.json is written BEFORE workouts.csv
// (belt and braces): even though every run rebuilds its own rows from the source tag alone (so
// a crash between the two renames can never turn a Strava row into a pseudo-export row), writing
// the ledger first means a reader that only sees the new _meta.json still gets accurate metadata.
// _meta.json is shared with sync-shortcut.js (both scripts can touch the same extract/ dir), so
// the whole read-plan-write sequence runs under an exclusive lock to prevent a lost update.
function syncDir (dir, activities, { writeAtomic = common.writeAtomic } = {}) {
  fs.mkdirSync(dir, { recursive: true }) // the lockfile itself needs the directory to exist
  return common.withLock(path.join(dir, '_meta.json.lock'), () => {
    const readFile = (name) => {
      const p = path.join(dir, name)
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
    }
    const plan = planSync(activities, readFile)
    if (plan.writes['_meta.json'] != null) writeAtomic(path.join(dir, '_meta.json'), plan.writes['_meta.json'])
    if (plan.writes[WORKOUTS_CSV] != null) writeAtomic(path.join(dir, WORKOUTS_CSV), plan.writes[WORKOUTS_CSV])
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

  const plan = syncDir(OUT, activities)
  const durationMs = Date.now() - t0
  console.log(`Synced ${activities.length} Strava activities in ${durationMs}ms; ${plan.merged.added} row(s) added for ${range(plan.merged.addedDates)}; ${plan.merged.rows} rows total`)
  if (plan.noHr) console.log(`  ${plan.noHr} row(s) written without HR`)
  if (plan.dropped) console.log(`  ${plan.dropped} activity(ies) dropped (no usable date/duration)`)
  if (Object.keys(plan.unmapped).length) console.log(`  unmapped sport types: ${JSON.stringify(plan.unmapped)}`)
  if (!Object.keys(plan.writes).length) console.log('  (no changes)')
}

if (require.main === module) main()

module.exports = {
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
  main
}
