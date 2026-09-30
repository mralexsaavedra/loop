/**
 * Sync freshness for GET /sync/status and /healthz. Holds ONLY timestamps, a
 * short error string and whether Strava is configured — the endpoint is
 * unauthenticated, so nothing here may ever carry health data.
 *
 * Strava ok/error times and the last trigger live in memory and are persisted
 * to the single-row `sync_status` table (sql/003_sync.sql) so a restart keeps
 * them. The last Shortcut time is read live as MAX(received_at).
 */
export const STRAVA_STALE_MS = 6 * 3_600_000
const MAX_ERROR_LENGTH = 120

export function shortError (message) {
  const line = String(message ?? '').replace(/\s+/g, ' ').trim()
  return line ? line.slice(0, MAX_ERROR_LENGTH) : 'unknown error'
}

function toIso (value) {
  if (value == null) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function createSyncStatus ({ pool, stravaConfigured, now = Date.now, startedAt = now(), log = console.log }) {
  const state = { stravaOkAt: null, stravaError: null, stravaErrorAt: null, triggerAt: null }

  async function persist () {
    try {
      await pool.query(
        `UPDATE sync_status
            SET last_strava_ok_at = $1, last_strava_error = $2, last_strava_error_at = $3, last_trigger_at = $4
          WHERE id = 1`,
        [state.stravaOkAt, state.stravaError, state.stravaErrorAt, state.triggerAt]
      )
    } catch (err) {
      // Freshness bookkeeping must never fail a sync or a request.
      log(JSON.stringify({ event: 'sync_status_persist_failed', message: shortError(err.message) }))
    }
  }

  return {
    async load () {
      const { rows } = await pool.query(
        'SELECT last_strava_ok_at, last_strava_error, last_strava_error_at, last_trigger_at FROM sync_status WHERE id = 1'
      )
      const row = rows[0]
      if (!row) return
      state.stravaOkAt = toIso(row.last_strava_ok_at)
      state.stravaError = row.last_strava_error ?? null
      state.stravaErrorAt = toIso(row.last_strava_error_at)
      state.triggerAt = toIso(row.last_trigger_at)
    },

    async recordStravaOk () {
      state.stravaOkAt = new Date(now()).toISOString()
      state.stravaError = null
      state.stravaErrorAt = null
      await persist()
    },

    async recordStravaError (message) {
      state.stravaError = shortError(message)
      state.stravaErrorAt = new Date(now()).toISOString()
      await persist()
    },

    async recordTrigger (iso) {
      state.triggerAt = toIso(iso)
      await persist()
    },

    async snapshot () {
      const { rows } = await pool.query('SELECT MAX(received_at) AS last FROM raw_payload')
      return {
        lastShortcutAt: toIso(rows[0]?.last),
        lastStravaOkAt: state.stravaOkAt,
        lastStravaError: state.stravaError,
        lastTriggerAt: state.triggerAt,
        stravaConfigured: Boolean(stravaConfigured)
      }
    },

    /** Degraded = Strava configured but no success for 6 h (counted from startup when none yet). */
    health () {
      if (!stravaConfigured) return { degraded: false }
      const reference = state.stravaOkAt ? Date.parse(state.stravaOkAt) : startedAt
      return now() - reference > STRAVA_STALE_MS ? { degraded: true, reason: 'strava_stale' } : { degraded: false }
    }
  }
}
