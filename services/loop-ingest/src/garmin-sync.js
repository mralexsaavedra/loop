/**
 * The Garmin sync loop (optional: only with GARMIN_API_KEY; docs/lan-services.md -> Garmin). Apart from the Strava
 * loop in every way: its own guard (sync.js guardSync, one run at a time), its own timer, its own status fields, so
 * a Garmin failure (a refused key, Garmin down) never touches the Strava pull, the build trigger or another route,
 * and what is already stored stays.
 *
 * A run walks the activity list newest first (garmin.js pullGarminActivities) and upserts every page as it arrives.
 * Until a full history walk has finished once (garmin_sync_state.history_complete) every run walks the whole list,
 * so a first pull cut short never leaves a gap; afterwards a run re-reads OVERLAP_DAYS before the newest stored
 * start. After an ok run a bounded backfill (not awaited) asks for the planned workout of at most WORKOUTS_PER_RUN
 * activities with no answer yet or a due retry (the HR backfill's back-off, hr-db.js), newest first.
 */
import { guardSync } from './sync.js'
import {
  createGarminClient, pullGarminActivities, fetchActivityWorkouts, compactWorkoutSteps, classifyGarminError, garminBaseUrl
} from './garmin.js'
import * as garminDb from './garmin-db.js'

export const OVERLAP_DAYS = 7
export const WORKOUTS_PER_RUN = 50
export const DEFAULT_GARMIN_SYNC_MINUTES = 60

/** @typedef {import('./garmin.js').FetchImpl} FetchImpl @typedef {import('./garmin.js').GarminError} GarminError */
/** @typedef {(line: string) => void} Log */
/** The slice of status.js the loop records into. @typedef {{ recordGarminOk: () => Promise<void>, recordGarminError: (code: string) => Promise<void> }} GarminStatus */
/** One backfill batch's outcome. @typedef {{ fetched: number, stored: number, retried: number, stop: 'rate_limited' | 'failed' | null }} WorkoutBackfillResult */
/** The persistence functions (garmin-db.js; tests pass fakes). @typedef {Pick<typeof garminDb, 'loadGarminState' | 'newestGarminStartMs' |
 *   'upsertGarminActivities' | 'saveGarminHistoryComplete' | 'pendingGarminWorkouts' | 'saveGarminWorkout' | 'saveGarminWorkoutFailure'>} GarminDb */

/**
 * @param {import('./db.js').Pool} pool @param {Record<string, string | undefined>} env
 * @param {{ status?: GarminStatus | null, fetchImpl?: FetchImpl, log?: Log, db?: GarminDb, workoutsPerRun?: number }} [options]
 */
export function createGarminSync (pool, env, { status = null, fetchImpl = fetch, log = console.log, db = garminDb, workoutsPerRun = WORKOUTS_PER_RUN } = {}) {
  const client = createGarminClient({ apiKey: String(env.GARMIN_API_KEY ?? '').trim(), baseUrl: garminBaseUrl(env), fetchImpl })

  async function run () {
    const state = await db.loadGarminState(pool)
    const newest = state.historyComplete ? await db.newestGarminStartMs(pool) : null
    const sinceMs = newest != null ? newest - OVERLAP_DAYS * 86_400_000 : null
    const { count, complete } = await pullGarminActivities(client, { sinceMs }, (batch) => db.upsertGarminActivities(pool, batch))
    if (complete && !state.historyComplete) await db.saveGarminHistoryComplete(pool)
    return { count, sinceMs }
  }

  /** @returns {Promise<WorkoutBackfillResult>} */
  async function backfillOnce () {
    /** @type {WorkoutBackfillResult} */
    const result = { fetched: 0, stored: 0, retried: 0, stop: null }
    for (const { id, attempts } of await db.pendingGarminWorkouts(pool, workoutsPerRun)) {
      result.fetched += 1
      let workouts
      try {
        workouts = await fetchActivityWorkouts(client, id)
      } catch (thrown) {
        const err = /** @type {GarminError} */ (thrown)
        // a refused token and a rate limit hold for every activity: stop the batch, record nothing for this one
        if (err.status === 429) { result.stop = 'rate_limited'; break }
        if (classifyGarminError(err) === 'garmin_auth') { result.stop = 'failed'; break }
        await db.saveGarminWorkoutFailure(pool, id, attempts + 1)
        result.retried += 1
        continue
      }
      await db.saveGarminWorkout(pool, id, compactWorkoutSteps(workouts))
      result.stored += 1
    }
    return result
  }

  /** @type {Promise<WorkoutBackfillResult | null>} */
  let backfillRun = Promise.resolve(null)
  let backfilling = false
  function backfill () {
    if (backfilling) return backfillRun
    backfilling = true
    backfillRun = backfillOnce()
      .then((r) => { log(JSON.stringify({ event: 'garmin_workouts', ...r })); return r }, (err) => {
        log(JSON.stringify({ event: 'garmin_workouts_failed', code: classifyGarminError(err) }))
        return null
      })
      .finally(() => { backfilling = false })
    return backfillRun
  }

  // guardSync records through the Strava-named recorder: this adapter sends the outcome to the Garmin fields, with
  // the Garmin code of the run's own error (guardSync hands over a Strava classification only)
  /** @type {unknown} */
  let lastError = null
  const runAndKeepError = async () => {
    try {
      return await run()
    } catch (err) {
      lastError = err
      throw err
    }
  }
  const recorder = status && {
    recordStravaOk: () => status.recordGarminOk(),
    recordStravaError: () => status.recordGarminError(classifyGarminError(/** @type {GarminError} */ (lastError)))
  }

  return {
    runOnce: guardSync(runAndKeepError, { status: recorder, afterOk: backfill, log }),
    /** The latest background workout backfill; resolves, never rejects. */
    backfillIdle: () => backfillRun
  }
}

/** The timer: one run now, then every `intervalMinutes`; logs counts and a coarse code only, never throws.
 * @param {{ runOnce: () => Promise<{ count: number }> }} sync @param {{ intervalMinutes?: number, log?: Log }} [options] */
export function startGarminLoop (sync, { intervalMinutes = DEFAULT_GARMIN_SYNC_MINUTES, log = console.log } = {}) {
  let running = false

  async function tick () {
    if (running) return
    running = true
    try {
      const { count } = await sync.runOnce()
      log(JSON.stringify({ event: 'garmin_sync', activities: count }))
    } catch (err) {
      log(JSON.stringify({ event: 'garmin_sync_failed', code: classifyGarminError(/** @type {GarminError} */ (err)) }))
    } finally {
      running = false
    }
  }

  tick()
  const timer = setInterval(tick, intervalMinutes * 60_000)
  timer.unref?.()
  return { stop: () => clearInterval(timer), tick }
}
