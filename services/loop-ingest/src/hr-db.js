/**
 * The heart-rate backfill's persistence (sql/008_strava_hr.sql + 009_strava_hr_retry.sql: strava_activity_hr, one row per activity) and
 * the pending-activity read over strava_activity. The back-off policy lives here because the pending query
 * computes it in SQL. Plain `fn(pool, ...)` functions; the backfill (hr-zones.js) calls them. No fetch here.
 */

// per-activity back-off after a transient failure, and the failure count that gives up on it
export const BACKOFF_BASE_MIN = 30
export const BACKOFF_CAP_MIN = 24 * 60
export const MAX_ATTEMPTS = 5

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
