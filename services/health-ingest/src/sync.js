import { createTokenProvider, fetchActivitiesSince, upsertActivities, lastSyncedStart } from './strava.js'

const DEFAULT_INTERVAL_MINUTES = 30
// How far back to re-read on every run, so an activity edited after upload
// (a renamed session, a description added by the coach) is picked up again.
const OVERLAP_DAYS = 7

export function isConfigured (env) {
  return Boolean(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET && env.STRAVA_REFRESH_TOKEN)
}

export function createStravaSync (pool, env) {
  const getAccessToken = createTokenProvider({
    clientId: env.STRAVA_CLIENT_ID,
    clientSecret: env.STRAVA_CLIENT_SECRET,
    refreshToken: env.STRAVA_REFRESH_TOKEN
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

  return { runOnce }
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
