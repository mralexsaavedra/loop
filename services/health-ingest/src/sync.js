import { createTokenProvider, createTokenStore, fetchActivitiesSince, upsertActivities, lastSyncedStart } from './strava.js'

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
 * each outcome in the freshness status (status.js). Errors are rethrown.
 */
export function guardSync (run, { status = null } = {}) {
  let inflight = null

  return function runOnce () {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const result = await run()
        await status?.recordStravaOk()
        return result
      } catch (err) {
        await status?.recordStravaError(err.message)
        throw err
      } finally {
        inflight = null
      }
    })()
    return inflight
  }
}

export function createStravaSync (pool, env, { status = null } = {}) {
  const getAccessToken = createTokenProvider({
    clientId: env.STRAVA_CLIENT_ID,
    clientSecret: env.STRAVA_CLIENT_SECRET,
    // bootstrap only: a rotated token persisted in strava_token wins (strava.js)
    refreshToken: env.STRAVA_REFRESH_TOKEN,
    store: createTokenStore(pool)
  })

  async function runOnce () {
    const newest = await lastSyncedStart(pool)

    // First run pulls everything; later runs re-read a short overlap window.
    const since = newest
      ? Math.floor((new Date(newest).getTime() - OVERLAP_DAYS * 86_400_000) / 1000)
      : null

    const activities = await fetchActivitiesSince(getAccessToken, since)
    const count = await upsertActivities(pool, activities)
    return { count, since }
  }

  return { runOnce: guardSync(runOnce, { status }) }
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
