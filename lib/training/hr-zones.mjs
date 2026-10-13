/* Per-workout HR zones (workout-zones.csv) from the per-activity HR histograms the ingest service
 * stores (services/health-ingest/src/hr-zones.js: seconds per whole bpm, `hr_hist` on
 * GET /export/strava). Used by data/apple-health/sync-strava.js (CommonJS, through require(esm)); the plan
 * page reads the CSV back through lib/training/read.mjs. Pure: the profile.json max HR is read by
 * lib/profile/read.mjs readProfileMaxHr.
 *
 * Zone model (the reference's, % of max HR): Z0 < 50 %, Z1 50-60, Z2 60-70, Z3 70-80, Z4 80-90,
 * Z5 >= 90 % (a reading above the max HR counts as Z5). Max HR = profile/profile.json `maxHr` when
 * set (a measured value wins), else the highest `max_heartrate` Strava reports on the activities of
 * the last 12 months (365 days ending at the newest activity, not the clock, so a re-run of the
 * same data writes the same bytes). Each row records the max HR it used and where it came from.
 *
 * `start` (local ISO WITH its UTC offset, blank when the ingest image does not export start_date) and
 * `elapsed_s` (elapsed, else moving time) were appended later: they are the activity's window, which
 * the Shortcut HR sync (lib/health/hr-hourly.mjs) leaves out of the all-day load so day strain
 * (lib/score/strain.mjs) never counts the same minutes twice. Readers are positional.
 */
const ZONES_CSV = 'workout-zones.csv'
const ZONES_HEADER = 'date,activity_id,type,max_hr,max_hr_source,hr_avg,hr_max,z0_s,z1_s,z2_s,z3_s,z4_s,z5_s,source,start,elapsed_s'
// lower bounds of Z1..Z5, % of max HR
const ZONE_CUTS = [50, 60, 70, 80, 90]
const OBSERVED_DAYS = 365
const MAX_HR_MIN = 100
const MAX_HR_MAX = 230

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** bpm -> zone 0..5 for a max HR (exact % comparison, no rounding: 95 of 190 = 50 % = Z1). */
function zoneOf (bpm, maxHr) {
  const pct = (bpm * 100) / maxHr
  let z = 0
  for (const cut of ZONE_CUTS) if (pct >= cut) z++
  return z
}

/** {"bpm": seconds} -> [z0..z5] seconds (whole seconds), or null when the histogram is empty / unusable. */
function zonesFromHist (hist, maxHr) {
  if (!hist || typeof hist !== 'object' || !(maxHr > 0)) return null
  const out = [0, 0, 0, 0, 0, 0]
  let total = 0
  for (const [k, v] of Object.entries(hist)) {
    const bpm = Number(k)
    const s = finite(v)
    if (!Number.isFinite(bpm) || bpm <= 0 || !(s > 0)) continue
    out[zoneOf(bpm, maxHr)] += s
    total += s
  }
  return total > 0 ? out.map(Math.round) : null
}

/** A plausible max HR from profile.json (`maxHr`, 100-230 bpm), else null. */
function validMaxHr (v) {
  const n = finite(v)
  return n != null && n >= MAX_HR_MIN && n <= MAX_HR_MAX ? Math.round(n) : null
}

const dayOf = (a) => (a && typeof a.start_local === 'string' ? a.start_local.slice(0, 10) : null)
const dayNum = (iso) => Date.parse(iso + 'T00:00:00Z') / 86400000

/** Highest Strava max_heartrate over the 365 days ending at the newest activity; null without HR. */
function observedMaxHr (activities) {
  const dated = (activities || []).filter((a) => dayOf(a))
  if (!dated.length) return null
  const newest = dated.map(dayOf).sort().pop()
  let best = null
  for (const a of dated) {
    if (dayNum(newest) - dayNum(dayOf(a)) >= OBSERVED_DAYS) continue
    const h = finite(a.max_heartrate)
    if (h != null && h >= MAX_HR_MIN && h <= 250 && (best == null || h > best)) best = h
  }
  return best != null ? Math.round(best) : null
}

/** {maxHr, source: 'profile'|'observed'} or null when neither is known. */
function pickMaxHr (activities, profileMaxHr) {
  const p = validMaxHr(profileMaxHr)
  if (p != null) return { maxHr: p, source: 'profile' }
  const o = observedMaxHr(activities)
  return o != null ? { maxHr: o, source: 'observed' } : null
}

/** Elapsed seconds of an activity (elapsed_time, else moving_time), '' when neither is usable. */
function elapsedOf (a) {
  const e = finite(a.elapsed_time) > 0 ? a.elapsed_time : finite(a.moving_time) > 0 ? a.moving_time : null
  return e != null ? Math.round(e) : ''
}

/**
 * activities (with hr_hist) -> {text, rows, max} — the whole workout-zones.csv, sorted by local start
 * then id; `type` = the workouts.csv type (translateType); `startOf(activity)` -> the local ISO start
 * with its offset (or null). text is null when no activity has a
 * histogram AND none could ever have one (an older ingest image: no `hr_hist` key at all).
 */
function buildZones (activities, { translateType, source, profileMaxHr = null, startOf = () => null }) {
  const list = (activities || []).filter((a) => a && dayOf(a))
  const max = pickMaxHr(list, profileMaxHr)
  const rows = []
  if (max) {
    for (const a of list) {
      const z = zonesFromHist(a.hr_hist, max.maxHr)
      if (!z) continue
      const avg = finite(a.average_heartrate)
      const mx = finite(a.max_heartrate)
      rows.push({ a, line: [dayOf(a), a.id, translateType(a.sport_type), max.maxHr, max.source,
        avg != null ? Math.round(avg) : '', mx != null ? Math.round(mx) : '', ...z, source, startOf(a) || '', elapsedOf(a)].join(',') })
    }
  }
  rows.sort((x, y) => (x.a.start_local < y.a.start_local ? -1 : x.a.start_local > y.a.start_local ? 1 : String(x.a.id) < String(y.a.id) ? -1 : 1))
  return { text: [ZONES_HEADER, ...rows.map((r) => r.line)].join('\n') + '\n', rows: rows.length, max }
}

export { ZONES_CSV, ZONES_HEADER, ZONE_CUTS, elapsedOf, OBSERVED_DAYS, MAX_HR_MIN, MAX_HR_MAX, zoneOf, zonesFromHist, validMaxHr, observedMaxHr, pickMaxHr, buildZones }
