/**
 * Per-activity heart-rate time histograms from Strava streams (sql/008_strava_hr.sql), the input of
 * the per-workout HR zones (time in zone 0-5) the plan page shows on a session's day panel.
 *
 * GET /activities/{id}/streams?keys=time,heartrate&key_by_type=true returns the sampled time
 * (seconds from the start) and heart rate of one activity. Only an AGGREGATE is kept: seconds spent
 * at each whole bpm ({"142": 37, ...}), never the raw stream. The zones themselves are % of max HR
 * and are cut on the repo side (data/apple-health/sync-strava.mjs), because the max HR can come from
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
import { usedBudget, pendingHrActivities, saveHr, saveFailure } from './hr-db.js'

// the persistence and its back-off policy moved to hr-db.js; they keep their historical import path
export { BACKOFF_BASE_MIN, BACKOFF_CAP_MIN, MAX_ATTEMPTS, usedBudget, pendingHrActivities, saveHr, saveFailure } from './hr-db.js'

const STREAMS_URL = 'https://www.strava.com/api/v3/activities/'
export const BATCH_PER_RUN = 10
// one streams request may take this long (headers + body) before it is aborted as a transient failure
export const STREAMS_TIMEOUT_MS = 15_000
export const WINDOW_MAX = 30
export const DAY_MAX = 300
// samples further apart than this are a pause or a sensor dropout: that gap is not counted
export const MAX_GAP_S = 30
// a reading outside this range is a sensor artefact, not a heart rate
const HR_MIN = 30
const HR_MAX = 250
const ID_RE = /^\d{1,19}$/

/**
 * @typedef {import('./strava.js').GetAccessToken} GetAccessToken @typedef {import('./strava.js').FetchImpl} FetchImpl
 * @typedef {import('./strava.js').Log} Log @typedef {import('./strava.js').StravaError} StravaError
 * @typedef {import('./db.js').Queryable} Queryable @typedef {import('./hr-db.js').HrResult} HrResult
 */
/** One backfill batch's outcome. @typedef {{ fetched: number, stored: number, retried: number, pending: number | null, stop: 'budget' | 'rate_limited' | 'failed' | null }} BackfillResult */

/**
 * Streams (key_by_type) -> {hist: {bpm: seconds}, seconds} or null when there is no usable heart
 * rate. Each sample owns the time until the next one (time[i+1] - time[i]); a gap > MAX_GAP_S, a
 * non-increasing time, or a missing / implausible HR sample adds nothing. The last sample has no
 * successor and adds nothing.
 * @param {any} streams Strava's streams JSON (untrusted; every sample is checked)
 * @returns {{ hist: Record<number, number>, seconds: number } | null}
 */
export function hrHistogram (streams) {
  const t = streams?.time?.data
  const hr = streams?.heartrate?.data
  if (!Array.isArray(t) || !Array.isArray(hr)) return null
  /** @type {Record<number, number>} */
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

const transient = (/** @type {string} */ message) => Object.assign(new Error(message), { transient: true })

/**
 * One streams call -> {status: 'ok'|'no_hr'|'not_found', hist?, seconds?}. Throws {rateLimited} on a
 * 429, {transient} on a 5xx, a network error or a timeout (this activity only), a plain error otherwise.
 * @param {GetAccessToken} getAccessToken @param {string | number} id @param {FetchImpl} [fetchImpl]
 * @param {{ timeoutMs?: number }} [options] @returns {Promise<HrResult>}
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
    const e = /** @type {StravaError} */ (err)
    if (e.rateLimited || e.transient) throw err
    if (ctrl.signal.aborted) throw transient(`strava streams timed out after ${timeoutMs} ms`)
    if (err instanceof TypeError) throw transient(`strava streams network error: ${err.message}`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * How many streams this run may fetch: the per-run batch, capped by the 15-min and 24-h budgets.
 * @param {{ lastWindow: unknown, lastDay: unknown }} used
 * @param {{ batch?: number, windowMax?: number, dayMax?: number }} [limits]
 */
export function streamBudget ({ lastWindow, lastDay }, { batch = BATCH_PER_RUN, windowMax = WINDOW_MAX, dayMax = DAY_MAX } = {}) {
  return Math.max(0, Math.min(batch, windowMax - (Number(lastWindow) || 0), dayMax - (Number(lastDay) || 0)))
}

/**
 * backfill(): one bounded batch (see the budget above). Never throws; returns {fetched, stored,
 * retried, pending, stop} where retried = transient failures recorded for back-off and stop =
 * 'budget' | 'rate_limited' | 'failed' | null. Concurrent calls share one in-flight batch.
 * @param {{ pool: Queryable, getAccessToken: GetAccessToken, fetchImpl?: FetchImpl, log?: Log,
 *   limits?: { batch?: number, windowMax?: number, dayMax?: number } }} options
 */
export function createHrBackfill ({ pool, getAccessToken, fetchImpl = fetch, log = console.log, limits = {} }) {
  /** @type {Promise<BackfillResult> | null} */
  let inflight = null

  /** @returns {Promise<BackfillResult>} */
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
          const e = /** @type {StravaError} */ (err)
          if (!e.transient) throw err
          const status = await saveFailure(pool, id, attempts + 1)
          retried++
          log(JSON.stringify({ event: 'strava_hr_activity_failed', id, attempts: attempts + 1, status, message: e.message }))
          continue
        }
        await saveHr(pool, id, r)
        stored++
      }
      log(JSON.stringify({ event: 'strava_hr_backfill', fetched, stored, retried }))
      return { fetched, stored, retried, pending: pending.length, stop: null }
    } catch (err) {
      const e = /** @type {StravaError} */ (err)
      log(JSON.stringify({ event: 'strava_hr_backfill_failed', fetched, stored, retried, message: e.message, rateLimited: Boolean(e.rateLimited) }))
      return { fetched, stored, retried, pending: null, stop: e.rateLimited ? 'rate_limited' : 'failed' }
    }
  }

  return {
    backfill () {
      if (!inflight) inflight = run().finally(() => { inflight = null })
      return inflight
    }
  }
}
