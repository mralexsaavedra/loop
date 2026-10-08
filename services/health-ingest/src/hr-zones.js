/**
 * Per-activity heart-rate time histograms from Strava streams (sql/008_strava_hr.sql), the input of
 * the per-workout HR zones (time in zone 0-5) the plan page shows on a session's day panel.
 *
 * GET /activities/{id}/streams?keys=time,heartrate&key_by_type=true returns the sampled time
 * (seconds from the start) and heart rate of one activity. Only an AGGREGATE is kept: seconds spent
 * at each whole bpm ({"142": 37, ...}), never the raw stream. The zones themselves are % of max HR
 * and are cut on the repo side (data/apple-health/sync-strava.js), because the max HR can come from
 * the local profile.json; a 1-bpm histogram gives exactly the same time in zone as the stream.
 *
 * Rate limits (Strava: 100 requests / 15 min and 1000 / day per app, shared with the activity pull
 * and the athlete refresh): the backfill fetches at most BATCH_PER_RUN streams per sync run, newest
 * activity first, and never more than WINDOW_MAX in the last 15 minutes or DAY_MAX in the last 24 h
 * (counted from the table itself, so a restart does not reset the budget). Every definite answer is
 * stored (ok / no_hr / not_found) and never fetched again; a 429 or a transient failure stops the run
 * and the activity is retried on a later one.
 */
const STREAMS_URL = 'https://www.strava.com/api/v3/activities/'
export const BATCH_PER_RUN = 10
export const WINDOW_MAX = 30
export const DAY_MAX = 300
// samples further apart than this are a pause or a sensor dropout: that gap is not counted
export const MAX_GAP_S = 30
// a reading outside this range is a sensor artefact, not a heart rate
const HR_MIN = 30
const HR_MAX = 250
const ID_RE = /^\d{1,19}$/

/**
 * Streams (key_by_type) -> {hist: {bpm: seconds}, seconds} or null when there is no usable heart
 * rate. Each sample owns the time until the next one (time[i+1] - time[i]); a gap > MAX_GAP_S, a
 * non-increasing time, or a missing / implausible HR sample adds nothing. The last sample has no
 * successor and adds nothing.
 */
export function hrHistogram (streams) {
  const t = streams?.time?.data
  const hr = streams?.heartrate?.data
  if (!Array.isArray(t) || !Array.isArray(hr)) return null
  const hist = {}
  let seconds = 0
  const n = Math.min(t.length, hr.length)
  for (let i = 0; i < n - 1; i++) {
    const dt = t[i + 1] - t[i]
    if (!(dt > 0) || dt > MAX_GAP_S) continue
    const h = hr[i]
    if (typeof h !== 'number' || !(h >= HR_MIN && h <= HR_MAX)) continue
    const b = Math.round(h)
    hist[b] = (hist[b] || 0) + dt
    seconds += dt
  }
  return seconds > 0 ? { hist, seconds } : null
}

/** One streams call -> {status: 'ok'|'no_hr'|'not_found', hist?, seconds?}; throws on 429 / other failures. */
export async function fetchHrStreams (getAccessToken, id, fetchImpl = fetch, signal) {
  if (!ID_RE.test(String(id))) return { status: 'not_found' }
  const token = await getAccessToken()
  const res = await fetchImpl(`${STREAMS_URL}${id}/streams?keys=time,heartrate&key_by_type=true`,
    { headers: { authorization: `Bearer ${token}` }, signal })
  if (res.status === 429) throw Object.assign(new Error('strava rate limit reached'), { rateLimited: true })
  if (res.status === 404) return { status: 'not_found' }
  if (!res.ok) throw new Error(`strava streams failed: ${res.status}`)
  const h = hrHistogram(await res.json())
  return h ? { status: 'ok', ...h } : { status: 'no_hr' }
}

/** How many streams this run may fetch: the per-run batch, capped by the 15-min and 24-h budgets. */
export function streamBudget ({ lastWindow, lastDay }, { batch = BATCH_PER_RUN, windowMax = WINDOW_MAX, dayMax = DAY_MAX } = {}) {
  return Math.max(0, Math.min(batch, windowMax - (Number(lastWindow) || 0), dayMax - (Number(lastDay) || 0)))
}

export async function usedBudget (pool) {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE fetched_at > now() - interval '15 minutes')::int AS last_window,
            count(*) FILTER (WHERE fetched_at > now() - interval '24 hours')::int AS last_day
       FROM strava_activity_hr`
  )
  return { lastWindow: rows[0]?.last_window ?? 0, lastDay: rows[0]?.last_day ?? 0 }
}

/** Activities with heart rate and no stored histogram yet, newest first. */
export async function pendingHrActivities (pool, limit) {
  const { rows } = await pool.query(
    `SELECT a.id::text AS id
       FROM strava_activity a
       LEFT JOIN strava_activity_hr h ON h.activity_id = a.id
      WHERE h.activity_id IS NULL
        AND (a.payload->'has_heartrate' = 'true'::jsonb OR jsonb_typeof(a.payload->'average_heartrate') = 'number')
      ORDER BY a.payload->>'start_date_local' DESC, a.id DESC
      LIMIT $1`,
    [limit]
  )
  return rows.map((r) => r.id)
}

export async function saveHr (pool, id, { status, hist = null, seconds = 0 }) {
  await pool.query(
    `INSERT INTO strava_activity_hr (activity_id, fetched_at, status, seconds, hr_hist)
     VALUES ($1, now(), $2, $3, $4)
     ON CONFLICT (activity_id) DO UPDATE
       SET fetched_at = now(), status = EXCLUDED.status, seconds = EXCLUDED.seconds, hr_hist = EXCLUDED.hr_hist`,
    [id, status, Math.round(seconds), hist ? JSON.stringify(hist) : null]
  )
}

/**
 * backfill(): one bounded batch (see the budget above). Never throws; returns {fetched, stored,
 * pending, stop} where stop = 'budget' | 'rate_limited' | 'failed' | null. Concurrent calls share
 * one in-flight batch.
 */
export function createHrBackfill ({ pool, getAccessToken, fetchImpl = fetch, log = console.log, limits = {} }) {
  let inflight = null

  async function run () {
    let fetched = 0
    let stored = 0
    try {
      const budget = streamBudget(await usedBudget(pool), limits)
      if (budget === 0) return { fetched, stored, pending: null, stop: 'budget' }
      const ids = await pendingHrActivities(pool, budget)
      for (const id of ids) {
        fetched++
        const r = await fetchHrStreams(getAccessToken, id, fetchImpl)
        await saveHr(pool, id, r)
        stored++
      }
      log(JSON.stringify({ event: 'strava_hr_backfill', fetched, stored }))
      return { fetched, stored, pending: ids.length, stop: null }
    } catch (err) {
      log(JSON.stringify({ event: 'strava_hr_backfill_failed', fetched, stored, message: err.message, rateLimited: Boolean(err.rateLimited) }))
      return { fetched, stored, pending: null, stop: err.rateLimited ? 'rate_limited' : 'failed' }
    }
  }

  return {
    backfill () {
      if (!inflight) inflight = run().finally(() => { inflight = null })
      return inflight
    }
  }
}
