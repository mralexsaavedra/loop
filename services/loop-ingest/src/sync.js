import { createTokenProvider, createTokenStore, pullActivitiesSince, upsertActivities, lastSyncedStart, classifyStravaError } from './strava.js'
import { createAthleteRefresher } from './athlete.js'
import { createHrBackfill } from './hr-zones.js'

const DEFAULT_INTERVAL_MINUTES = 30
// How far back to re-read on every run, so an activity edited after upload
// (a renamed session, a description added by the coach) is picked up again.
const OVERLAP_DAYS = 7

/**
 * @typedef {import('./strava.js').Log} Log @typedef {import('./strava.js').FetchImpl} FetchImpl
 * @typedef {import('./strava.js').StravaError} StravaError @typedef {import('./db.js').Pool} Pool
 * @typedef {ReturnType<typeof import('./status.js').createSyncStatus>} SyncStatus
 * @typedef {ReturnType<typeof createStravaSync>} StravaSync
 */
/** The Strava settings this module reads from the environment. @typedef {Record<string, string | undefined>} Env */

/** @param {Env} env */
export function isConfigured (env) {
  return Boolean(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET && env.STRAVA_REFRESH_TOKEN)
}

/**
 * Wraps a sync run so every caller (the interval loop, POST /sync, POST
 * /sync/strava) shares ONE in-flight run instead of overlapping, and records
 * each outcome in the freshness status (status.js) — as a COARSE code only
 * (classifyStravaError); the message is rethrown for the caller's log.
 *
 * `afterOk` (optional) is started once per SUCCESSFUL run, after the outcome is recorded, and is
 * NOT awaited: callers get the activity result immediately. A throw / rejection from it is logged
 * and never fails the run.
 * @template T
 * @param {() => Promise<T>} run
 * @param {{ status?: Pick<SyncStatus, 'recordStravaError' | 'recordStravaOk'> | null, afterOk?: (() => unknown) | null, log?: Log }} [options]
 * @returns {() => Promise<T>}
 */
export function guardSync (run, { status = null, afterOk = null, log = console.log } = {}) {
  /** @type {Promise<T> | null} */
  let inflight = null

  /** Only called when afterOk is set (runOnce checks it). */
  function startAfterOk () {
    const logFailure = (/** @type {Error | null | undefined} */ err) => log(JSON.stringify({ event: 'sync_after_ok_failed', message: err?.message }))
    try {
      Promise.resolve(/** @type {() => unknown} */ (afterOk)()).catch(logFailure)
    } catch (err) {
      logFailure(/** @type {Error} */ (err))
    }
  }

  // The status write is bookkeeping, apart from the pull: a failed write (the database down) is its own log
  // event and never turns a good pull into a Strava failure, nor hides the pull's own error.
  /** @param {'ok' | 'error'} outcome @param {() => unknown} write */
  async function record (outcome, write) {
    try {
      await write()
    } catch (err) {
      log(JSON.stringify({ event: 'sync_status_write_failed', outcome, message: /** @type {Error | null | undefined} */ (err)?.message }))
    }
  }

  return function runOnce () {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        let result
        try {
          result = await run()
        } catch (err) {
          await record('error', () => status?.recordStravaError(classifyStravaError(/** @type {StravaError} */ (err))))
          throw err
        }
        await record('ok', () => status?.recordStravaOk())
        if (afterOk) startAfterOk()
        return result
      } finally {
        inflight = null
      }
    })()
    return inflight
  }
}

/**
 * @param {Pool} pool @param {Env} env
 * @param {{ status?: SyncStatus | null, fetchImpl?: FetchImpl, log?: Log }} [options]
 */
export function createStravaSync (pool, env, { status = null, fetchImpl = fetch, log = console.log } = {}) {
  const getAccessToken = createTokenProvider({
    clientId: env.STRAVA_CLIENT_ID,
    clientSecret: env.STRAVA_CLIENT_SECRET,
    // bootstrap only: a rotated token persisted in strava_token wins (strava.js)
    refreshToken: env.STRAVA_REFRESH_TOKEN,
    store: createTokenStore(pool),
    onSaveResult: status ? (ok) => status.recordTokenSave(ok) : null,
    fetchImpl
  })
  // the athlete profile + gear snapshot is kicked off AFTER a successful activity pull has been
  // recorded, in the background (at most once per 24 h, one in flight at a time, own timeout —
  // athlete.js); it never throws, so a profile failure or a slow Strava can not delay or fail the
  // activity pull, its status or a waiting POST /sync
  const athlete = createAthleteRefresher({ pool, getAccessToken, fetchImpl, log })
  /** @type {Promise<string | null>} */
  let athleteRun = Promise.resolve(null)
  // then one bounded batch of the HR-stream backfill (hr-zones.js: <= 10 streams per run, newest
  // first, inside its own 15-min / 24-h budget), AFTER the athlete call so the two never overlap;
  // it never throws either
  const hr = createHrBackfill({ pool, getAccessToken, fetchImpl, log })
  /** @type {Promise<import('./hr-zones.js').BackfillResult | null>} */
  let hrRun = Promise.resolve(null)
  const refreshAthleteThenBackfillHr = () => {
    athleteRun = athlete.maybeRefresh()
    hrRun = athleteRun.then(() => hr.backfill())
    return hrRun
  }

  async function runOnce () {
    const newest = await lastSyncedStart(pool)

    // First run walks the whole history from the beginning (after=0); later runs re-read a short overlap
    // window. Either way every page is upserted as it arrives, so a first pull cut short by a rate limit
    // resumes here, from the newest activity it already stored, on the next run.
    const since = newest
      ? Math.floor((new Date(newest).getTime() - OVERLAP_DAYS * 86_400_000) / 1000)
      : 0

    const count = await pullActivitiesSince(getAccessToken, since, (batch) => upsertActivities(pool, batch), fetchImpl)
    return { count, since }
  }

  return {
    runOnce: guardSync(runOnce, { status, afterOk: refreshAthleteThenBackfillHr, log }),
    // the shared single-flight token provider, for the routes that call Strava on request (strava-annotate.js)
    getAccessToken,
    // the latest background athlete refresh (tests / graceful shutdown); resolves, never rejects
    athleteIdle: () => athleteRun,
    // the latest background HR backfill batch; resolves, never rejects
    hrIdle: () => hrRun
  }
}

/** @param {Pick<StravaSync, 'runOnce'>} sync @param {{ intervalMinutes?: number, log?: Log }} [options] */
export function startSyncLoop (sync, { intervalMinutes = DEFAULT_INTERVAL_MINUTES, log = console.log } = {}) {
  let running = false

  async function tick () {
    if (running) return
    running = true
    try {
      const { count } = await sync.runOnce()
      log(JSON.stringify({ event: 'strava_sync', activities: count }))
    } catch (err) {
      // A failed sync must never take the ingest endpoint down with it.
      const e = /** @type {StravaError} */ (err)
      log(JSON.stringify({ event: 'strava_sync_failed', message: e.message, rateLimited: Boolean(e.rateLimited) }))
    } finally {
      running = false
    }
  }

  tick()
  const timer = setInterval(tick, intervalMinutes * 60_000)
  timer.unref?.()
  return { stop: () => clearInterval(timer), tick }
}
