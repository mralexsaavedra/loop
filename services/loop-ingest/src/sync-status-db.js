/**
 * The freshness bookkeeping's persistence (sql/003_sync.sql: the single sync_status row). status.js keeps the
 * state in memory and decides what wins; these functions only write and read the row (callers catch their errors:
 * bookkeeping must never fail a sync or a request).
 */

/** Writes the in-memory state; `trigger_seq` only ever grows (GREATEST). */
export async function saveSyncStatus (pool, state) {
  await pool.query(
    `UPDATE sync_status
            SET last_strava_ok_at = $1, last_strava_error = $2, last_strava_error_at = $3,
                last_trigger_at = $4, trigger_seq = GREATEST(trigger_seq, $5),
                last_trigger_error = $6, last_trigger_error_seq = $7, strava_token_save_failed = $8
          WHERE id = 1`,
    [state.stravaOkAt, state.stravaError, state.stravaErrorAt, state.triggerAt, state.triggerSeq,
      state.triggerError, state.triggerErrorSeq, state.tokenSaveFailed]
  )
}

/** The stored row, or undefined before the first write. */
export async function loadSyncStatus (pool) {
  const { rows } = await pool.query(
    `SELECT last_strava_ok_at, last_strava_error, last_strava_error_at, last_trigger_at, trigger_seq,
                last_trigger_error, last_trigger_error_seq, strava_token_save_failed
           FROM sync_status WHERE id = 1`
  )
  return rows[0]
}
