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
 * stored (ok / no_hr / not_found) and never fetched again.
 *
 * Failures (sql/009_strava_hr_retry.sql): a 429 is app-wide, so it stops the whole batch and nothing
 * is recorded for that activity. A TRANSIENT failure of one activity (5xx, network error, or no answer
 * within STREAMS_TIMEOUT_MS) only skips that activity: it is stored as status 'retry' with attempts + 1
 * and last_error_at, and the batch goes on with the next one. A 'retry' row is due again
 * BACKOFF_BASE_MIN * 2^(attempts - 1) minutes after its last failure (30 min, 1 h, 2 h, 4 h, capped
 * at BACKOFF_CAP_MIN); the MAX_ATTEMPTS-th failure stores 'failed' and it is never asked again. So one
 * activity that keeps failing can no longer block the backfill. Any other error (token refresh, 401,
 * the database) stops the batch without recording anything.
 */
const STREAMS_URL = 'https://www.strava.com/api/v3/activities/'
export const BATCH_PER_RUN = 10
// one streams request may take this long (headers + body) before it is aborted as a transient failure
export const STREAMS_TIMEOUT_MS = 15_000
// per-activity back-off after a transient failure, and the failure count that gives up on it
export const BACKOFF_BASE_MIN = 30
export const BACKOFF_CAP_MIN = 24 * 60
export const MAX_ATTEMPTS = 5
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

const transient = (message) => Object.assign(new Error(message), { transient: true })

/**
 * One streams call -> {status: 'ok'|'no_hr'|'not_found', hist?, seconds?}. Throws {rateLimited} on a
 * 429, {transient} on a 5xx, a network error or a timeout (this activity only), a plain error otherwise.
 */
export async function fetchHrStreams (getAccessToken, id, fetchImpl = fetch, { timeoutMs = STREAMS_TIMEOUT_MS } = {}) {
  if (!ID_RE.test(String(id))) return { status: 'not_found' }
  const token = await getAccessToken()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`${STREAMS_URL}${id}/streams?keys=time,heartrate&key_by_type=true`,
      { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal })
    if (res.status === 429) throw Object.assign(new Error('strava rate limit reached'), { rateLimited: true })
    if (res.status === 404) return { status: 'not_found' }
    if (res.status >= 500) throw transient(`strava streams failed: ${res.status}`)
    if (!res.ok) throw new Error(`strava streams failed: ${res.status}`)
    const h = hrHistogram(await res.json())
    return h ? { status: 'ok', ...h } : { status: 'no_hr' }
  } catch (err) {
    if (err.rateLimited || err.transient) throw err
    if (ctrl.signal.aborted) throw transient(`strava streams timed out after ${timeoutMs} ms`)
    if (err instanceof TypeError) throw transient(`strava streams network error: ${err.message}`)
    throw err
  } finally {
    clearTimeout(timer)
  }
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

/**
 * Activities with heart rate and no stored answer yet, plus the 'retry' ones whose back-off has
 * elapsed, newest first -> [{id, attempts}]. 'failed' rows are never selected again.
 */
export async function pendingHrActivities (pool, limit) {
  const { rows } = await pool.query(
    `SELECT a.id::text AS id, COALESCE(h.attempts, 0)::int AS attempts
       FROM strava_activity a
       LEFT JOIN strava_activity_hr h ON h.activity_id = a.id
      WHERE (h.activity_id IS NULL
             OR (h.status = 'retry'
                 AND h.last_error_at <= now() - make_interval(mins => LEAST($2 * power(2, GREATEST(h.attempts, 1) - 1), $3)::int)))
        AND (a.payload->'has_heartrate' = 'true'::jsonb OR jsonb_typeof(a.payload->'average_heartrate') = 'number')
      ORDER BY a.payload->>'start_date_local' DESC, a.id DESC
      LIMIT $1`,
    [limit, BACKOFF_BASE_MIN, BACKOFF_CAP_MIN]
  )
  return rows.map((r) => ({ id: r.id, attempts: Number(r.attempts) || 0 }))
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
 * Records one transient failure: 'retry' (or 'failed' once attempts reaches MAX_ATTEMPTS). fetched_at
 * is set too, so the failed call still counts against the 15-min / 24-h budget.
 */
export async function saveFailure (pool, id, attempts) {
  const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'retry'
  await pool.query(
    `INSERT INTO strava_activity_hr (activity_id, fetched_at, status, seconds, hr_hist, attempts, last_error_at)
     VALUES ($1, now(), $2, $3, $4, $5, now())
     ON CONFLICT (activity_id) DO UPDATE
       SET fetched_at = now(), status = EXCLUDED.status, attempts = EXCLUDED.attempts, last_error_at = now()`,
    [id, status, 0, null, attempts]
  )
  return status
}

/**
 * backfill(): one bounded batch (see the budget above). Never throws; returns {fetched, stored,
 * retried, pending, stop} where retried = transient failures recorded for back-off and stop =
 * 'budget' | 'rate_limited' | 'failed' | null. Concurrent calls share one in-flight batch.
 */
export function createHrBackfill ({ pool, getAccessToken, fetchImpl = fetch, log = console.log, limits = {} }) {
  let inflight = null

  async function run () {
    let fetched = 0
    let stored = 0
    let retried = 0
    try {
      const budget = streamBudget(await usedBudget(pool), limits)
      if (budget === 0) return { fetched, stored, retried, pending: null, stop: 'budget' }
      const pending = await pendingHrActivities(pool, budget)
      for (const { id, attempts } of pending) {
        fetched++
        let r
        try {
          r = await fetchHrStreams(getAccessToken, id, fetchImpl)
        } catch (err) {
          if (!err.transient) throw err
          const status = await saveFailure(pool, id, attempts + 1)
          retried++
          log(JSON.stringify({ event: 'strava_hr_activity_failed', id, attempts: attempts + 1, status, message: err.message }))
          continue
        }
        await saveHr(pool, id, r)
        stored++
      }
      log(JSON.stringify({ event: 'strava_hr_backfill', fetched, stored, retried }))
      return { fetched, stored, retried, pending: pending.length, stop: null }
    } catch (err) {
      log(JSON.stringify({ event: 'strava_hr_backfill_failed', fetched, stored, retried, message: err.message, rateLimited: Boolean(err.rateLimited) }))
      return { fetched, stored, retried, pending: null, stop: err.rateLimited ? 'rate_limited' : 'failed' }
    }
  }

  return {
    backfill () {
      if (!inflight) inflight = run().finally(() => { inflight = null })
      return inflight
    }
  }
}
