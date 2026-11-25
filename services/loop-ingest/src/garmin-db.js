/**
 * The Garmin source's persistence (sql/015_garmin.sql: garmin_activity, garmin_activity_workout, garmin_sync_state):
 * the transactional upsert of pulled activities, the newest stored start, the planned-workout rows and their retry
 * state, the sync state row, and the /export/garmin page (privacy boundary: never a name, a note or the payload).
 * Plain `fn(pool, ...)` functions; garmin-sync.js, status.js and export.js call them. No fetch here.
 */
import { BACKOFF_BASE_MIN, BACKOFF_CAP_MIN, MAX_ATTEMPTS } from './hr-db.js'

/** @typedef {import('./db.js').Queryable} Queryable @typedef {import('./db.js').Pool} Pool */
/** @typedef {import('./garmin.js').GarminActivity} GarminActivity @typedef {import('./garmin.js').CompactStep} CompactStep */
/** One /export/garmin row (the Contract). @typedef {{ id: string, start_local: string, start_utc: string, type: string,
 *   duration_s: number | null, avg_power: number | null, norm_power: number | null, avg_hr: number | null, max_hr: number | null,
 *   plan_status: 'ok' | 'none' | 'pending', plan: { steps: CompactStep[] } | null }} GarminExportRow */
/** The Garmin freshness state (ISO times and a coarse code). @typedef {{ okAt: string | null, error: string | null, errorAt: string | null }} GarminStatusState */

const ID_RE = /^\d{1,18}$/
const TIME_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/

/** @param {unknown} v @returns {number | null} */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The columns of one activity, or null when its id or start times are unusable. @param {GarminActivity} a */
function activityRow (a) {
  const id = String(a?.activityId ?? '')
  const local = TIME_RE.exec(String(a?.startTimeLocal ?? ''))
  const gmt = TIME_RE.exec(String(a?.startTimeGMT ?? ''))
  if (!ID_RE.test(id) || !local || !gmt) return null
  return [
    id,
    `${local[1]}T${local[2]}`,
    `${gmt[1]}T${gmt[2]}Z`,
    typeof a.activityType?.typeKey === 'string' && a.activityType.typeKey ? a.activityType.typeKey.slice(0, 64) : 'unknown',
    num(a.duration), num(a.movingDuration), num(a.avgPower), num(a.normPower), num(a.averageHR), num(a.maxHR),
    JSON.stringify(a)
  ]
}

/** Stores one page in one transaction (an edit replaces the row). Resolves the number stored.
 * @param {Pick<Pool, 'connect'>} pool @param {GarminActivity[]} activities @returns {Promise<number>} */
export async function upsertGarminActivities (pool, activities) {
  const rows = activities.map(activityRow).filter((r) => r !== null)
  if (rows.length === 0) return 0
  const client = await pool.connect()
  let failure
  try {
    await client.query('BEGIN')
    for (const values of rows) {
      await client.query(
        `INSERT INTO garmin_activity (id, start_local, start_utc, type, duration_s, moving_duration_s, avg_power, norm_power, avg_hr, max_hr, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE
           SET start_local = EXCLUDED.start_local, start_utc = EXCLUDED.start_utc, type = EXCLUDED.type,
               duration_s = EXCLUDED.duration_s, moving_duration_s = EXCLUDED.moving_duration_s,
               avg_power = EXCLUDED.avg_power, norm_power = EXCLUDED.norm_power,
               avg_hr = EXCLUDED.avg_hr, max_hr = EXCLUDED.max_hr, payload = EXCLUDED.payload, synced_at = now()`,
        values
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    failure = err
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release(failure)
  }
  return rows.length
}

/** The newest stored start (UTC) as epoch ms, or null when nothing is stored. @param {Queryable} pool */
export async function newestGarminStartMs (pool) {
  const { rows } = await pool.query('SELECT MAX(start_utc) AS newest FROM garmin_activity')
  const v = rows[0]?.newest
  if (v == null) return null
  const ms = new Date(v).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** The sync state row: { historyComplete, okAt, error, errorAt } (defaults when the row is missing). @param {Queryable} pool */
export async function loadGarminState (pool) {
  const { rows } = await pool.query('SELECT history_complete, ok_at, error, error_at FROM garmin_sync_state WHERE id = 1')
  const r = rows[0] ?? {}
  const iso = (/** @type {unknown} */ v) => (v == null ? null : new Date(/** @type {string} */ (v)).toISOString())
  return { historyComplete: r.history_complete === true, okAt: iso(r.ok_at), error: r.error ?? null, errorAt: iso(r.error_at) }
}

/** Marks the full history walk done (later runs only re-read the overlap window). @param {Queryable} pool */
export async function saveGarminHistoryComplete (pool) {
  await pool.query('UPDATE garmin_sync_state SET history_complete = true WHERE id = 1')
}

/** Writes the freshness state (status.js). @param {Queryable} pool @param {GarminStatusState} state */
export async function saveGarminStatus (pool, { okAt, error, errorAt }) {
  await pool.query('UPDATE garmin_sync_state SET ok_at = $1, error = $2, error_at = $3 WHERE id = 1', [okAt, error, errorAt])
}

/**
 * Activities with no planned-workout answer yet, plus the 'retry' ones whose back-off has elapsed (the HR
 * backfill's policy, hr-db.js), newest first -> [{id, attempts}].
 * @param {Queryable} pool @param {number} limit @returns {Promise<{ id: string, attempts: number }[]>}
 */
export async function pendingGarminWorkouts (pool, limit) {
  const { rows } = await pool.query(
    `SELECT a.id::text AS id, COALESCE(w.attempts, 0)::int AS attempts
       FROM garmin_activity a
       LEFT JOIN garmin_activity_workout w ON w.activity_id = a.id
      WHERE w.activity_id IS NULL
         OR (w.status = 'retry'
             AND w.last_error_at <= now() - make_interval(mins => LEAST($2 * power(2, GREATEST(w.attempts, 1) - 1), $3)::int))
      ORDER BY a.start_utc DESC, a.id DESC
      LIMIT $1`,
    [limit, BACKOFF_BASE_MIN, BACKOFF_CAP_MIN]
  )
  return rows.map((r) => ({ id: String(r.id), attempts: Number(r.attempts) || 0 }))
}

/** A definite answer: the compact steps ('ok') or null ('none'). @param {Queryable} pool @param {string} id @param {CompactStep[] | null} steps */
export async function saveGarminWorkout (pool, id, steps) {
  await pool.query(
    `INSERT INTO garmin_activity_workout (activity_id, status, steps, fetched_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (activity_id) DO UPDATE SET status = EXCLUDED.status, steps = EXCLUDED.steps, fetched_at = now()`,
    [id, steps ? 'ok' : 'none', steps ? JSON.stringify(steps) : null]
  )
}

/** One transient failure: 'retry', or 'failed' once attempts reaches MAX_ATTEMPTS.
 * @param {Queryable} pool @param {string} id @param {number} attempts @returns {Promise<'retry' | 'failed'>} */
export async function saveGarminWorkoutFailure (pool, id, attempts) {
  const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'retry'
  await pool.query(
    `INSERT INTO garmin_activity_workout (activity_id, status, steps, attempts, last_error_at, fetched_at)
     VALUES ($1, $2, NULL, $3, now(), now())
     ON CONFLICT (activity_id) DO UPDATE SET status = EXCLUDED.status, attempts = EXCLUDED.attempts, last_error_at = now(), fetched_at = now()`,
    [id, status, attempts]
  )
  return status
}

/** @param {any} s @returns {CompactStep} */
const exportStep = (s) => ({
  i: num(s?.i),
  intensity: typeof s?.intensity === 'string' ? s.intensity : null,
  dur_type: typeof s?.dur_type === 'string' ? s.dur_type : null,
  dur: num(s?.dur),
  target: typeof s?.target === 'string' ? s.target : null,
  low: num(s?.low),
  high: num(s?.high),
  value: num(s?.value)
})

/**
 * One joined row -> the Contract's export row. plan_status: 'ok' / 'none' as stored, 'failed' (gave up) reads as
 * 'none', anything else (no answer yet, a retry) as 'pending'. Steps are re-picked field by field, so nothing but
 * the Contract's step fields can ever leave.
 * @param {Record<string, any>} r @returns {GarminExportRow}
 */
export function toExportRow (r) {
  const status = r.plan_status === 'ok' && Array.isArray(r.steps) ? 'ok' : r.plan_status === 'none' || r.plan_status === 'failed' ? 'none' : 'pending'
  return {
    id: String(r.id),
    start_local: String(r.start_local),
    start_utc: String(r.start_utc),
    type: String(r.type),
    duration_s: num(r.duration_s),
    avg_power: num(r.avg_power),
    norm_power: num(r.norm_power),
    avg_hr: num(r.avg_hr),
    max_hr: num(r.max_hr),
    plan_status: status,
    plan: status === 'ok' ? { steps: r.steps.map(exportStep) } : null
  }
}

/**
 * One /export/garmin page, ascending by id after `sinceId` (the /export/strava paging). Only the Contract columns are
 * selected: never the payload, a name or a note.
 * @param {Queryable} pool @param {{ sinceId: string, limit: number }} page @returns {Promise<GarminExportRow[]>}
 */
export async function listGarminActivities (pool, { sinceId, limit }) {
  const { rows } = await pool.query(
    `SELECT a.id::text AS id,
            to_char(a.start_local, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_local,
            to_char(a.start_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_utc,
            a.type, a.duration_s, a.avg_power, a.norm_power, a.avg_hr, a.max_hr,
            w.status AS plan_status, w.steps
       FROM garmin_activity a
       LEFT JOIN garmin_activity_workout w ON w.activity_id = a.id
      WHERE a.id > $1
      ORDER BY a.id ASC
      LIMIT $2`,
    [sinceId, limit]
  )
  return rows.map(toExportRow)
}
