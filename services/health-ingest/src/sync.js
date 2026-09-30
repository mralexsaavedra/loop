import { createTokenProvider, createTokenStore, fetchActivitiesSince, upsertActivities, lastSyncedStart, classifyStravaError } from './strava.js'
import { createAthleteRefresher } from './athlete.js'

const DEFAULT_INTERVAL_MINUTES = 30
// How far back to re-read on every run, so an activity edited after upload
// (a renamed session, a description added by the coach) is picked up again.
const OVERLAP_DAYS = 7

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
 */
export function guardSync (run, { status = null, afterOk = null, log = console.log } = {}) {
  let inflight = null

  function startAfterOk () {
    const logFailure = (err) => log(JSON.stringify({ event: 'sync_after_ok_failed', message: err?.message }))
    try {
      Promise.resolve(afterOk()).catch(logFailure)
    } catch (err) {
      logFailure(err)
    }
  }

  return function runOnce () {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const result = await run()
        await status?.recordStravaOk()
        if (afterOk) startAfterOk()
        return result
      } catch (err) {
        await status?.recordStravaError(classifyStravaError(err))
        throw err
      } finally {
        inflight = null
      }
    })()
    return inflight
  }
}

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
  let athleteRun = Promise.resolve(null)
  const kickAthlete = () => { athleteRun = athlete.maybeRefresh(); return athleteRun }

  async function runOnce () {
    const newest = await lastSyncedStart(pool)

    // First run pulls everything; later runs re-read a short overlap window.
    const since = newest
      ? Math.floor((new Date(newest).getTime() - OVERLAP_DAYS * 86_400_000) / 1000)
      : null

    const activities = await fetchActivitiesSince(getAccessToken, since, fetchImpl)
    const count = await upsertActivities(pool, activities)
    return { count, since }
  }

  return {
    runOnce: guardSync(runOnce, { status, afterOk: kickAthlete, log }),
    // the latest background athlete refresh (tests / graceful shutdown); resolves, never rejects
    athleteIdle: () => athleteRun
  }
}

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
      log(JSON.stringify({ event: 'strava_sync_failed', message: err.message, rateLimited: Boolean(err.rateLimited) }))
    } finally {
      running = false
    }
  }

  tick()
  const timer = setInterval(tick, intervalMinutes * 60_000)
  timer.unref?.()
  return { stop: () => clearInterval(timer), tick }
}
