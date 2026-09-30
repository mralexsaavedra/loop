/**
 * Sync freshness for GET /sync/status and /healthz. Holds ONLY timestamps,
 * sequence numbers, COARSE error codes (STATUS_CODES) and whether Strava is
 * configured. The endpoint is unauthenticated, so nothing here may ever carry
 * health data or raw error text: messages go to the logs, codes come here.
 *
 * State lives in memory and is persisted to the single-row `sync_status` table
 * (sql/003_sync.sql) so a restart keeps it, including the last Strava success
 * that drives the 6 h degraded check. The last Shortcut time is read live as
 * MAX(received_at). The snapshot is cached for SNAPSHOT_TTL_MS so polling (or
 * a flood) costs at most one DB read per 5 s.
 */
export const STRAVA_STALE_MS = 6 * 3_600_000
export const SNAPSHOT_TTL_MS = 5000
export const STATUS_CODES = new Set(['strava_auth', 'strava_network', 'strava_other', 'strava_token_save', 'trigger_write'])
const STRAVA_PULL_CODES = new Set(['strava_auth', 'strava_network', 'strava_other'])

function toIso (value) {
  if (value == null) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function toSeq (value) {
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : 0
}

/** Anything that is not a known pull code (e.g. a raw message) becomes strava_other. */
function pullCode (value) {
  return STRAVA_PULL_CODES.has(value) ? value : 'strava_other'
}

export function createSyncStatus ({ pool, stravaConfigured, now = Date.now, readTriggerSeq = null, log = console.log }) {
  const state = {
    stravaOkAt: null,
    stravaError: null,
    stravaErrorAt: null,
    tokenSaveFailed: false,
    triggerAt: null,
    triggerSeq: 0,
    triggerError: null,
    triggerErrorSeq: null
  }
  let loaded = false
  let cache = null

  function changed () { cache = null }

  async function persist () {
    try {
      await pool.query(
        `UPDATE sync_status
            SET last_strava_ok_at = $1, last_strava_error = $2, last_strava_error_at = $3,
                last_trigger_at = $4, trigger_seq = GREATEST(trigger_seq, $5),
                last_trigger_error = $6, last_trigger_error_seq = $7, strava_token_save_failed = $8
          WHERE id = 1`,
        [state.stravaOkAt, state.stravaError, state.stravaErrorAt, state.triggerAt, state.triggerSeq,
          state.triggerError, state.triggerErrorSeq, state.tokenSaveFailed]
      )
    } catch (err) {
      // Freshness bookkeeping must never fail a sync or a request.
      log(JSON.stringify({ event: 'sync_status_persist_failed', message: err.message }))
    }
  }

  async function load () {
    const fileSeq = readTriggerSeq ? toSeq(await readTriggerSeq().catch(() => 0)) : 0
    state.triggerSeq = Math.max(state.triggerSeq, fileSeq)
    try {
      const { rows } = await pool.query(
        `SELECT last_strava_ok_at, last_strava_error, last_strava_error_at, last_trigger_at, trigger_seq,
                last_trigger_error, last_trigger_error_seq, strava_token_save_failed
           FROM sync_status WHERE id = 1`
      )
      loaded = true
      changed()
      const row = rows[0]
      if (!row) return
      // in-memory values recorded before a (retried) load win over the DB copy
      state.stravaOkAt = state.stravaOkAt ?? toIso(row.last_strava_ok_at)
      if (state.stravaError == null && row.last_strava_error != null) {
        state.stravaError = pullCode(row.last_strava_error)
        state.stravaErrorAt = toIso(row.last_strava_error_at)
      }
      state.triggerAt = state.triggerAt ?? toIso(row.last_trigger_at)
      state.triggerSeq = Math.max(state.triggerSeq, toSeq(row.trigger_seq))
      if (state.triggerError == null && row.last_trigger_error === 'trigger_write') {
        state.triggerError = 'trigger_write'
        state.triggerErrorSeq = row.last_trigger_error_seq == null ? null : toSeq(row.last_trigger_error_seq)
      }
      state.tokenSaveFailed = state.tokenSaveFailed || row.strava_token_save_failed === true
    } catch (err) {
      log(JSON.stringify({ event: 'sync_status_load_failed', message: err.message }))
    }
  }

  return {
    /** Never throws; a failure is logged and the load is retried on the next snapshot. */
    load,

    currentSeq () { return state.triggerSeq },

    /** Synchronous increment (so two concurrent clicks can never share a new seq); persisted best-effort. */
    nextTriggerSeq () {
      state.triggerSeq += 1
      changed()
      persist()
      return state.triggerSeq
    },

    stravaFresh (ms) {
      return state.stravaOkAt != null && now() - Date.parse(state.stravaOkAt) < ms
    },

    async recordStravaOk () {
      state.stravaOkAt = new Date(now()).toISOString()
      state.stravaError = null
      state.stravaErrorAt = null
      changed()
      await persist()
    },

    /** `code` should be one of strava_auth / strava_network / strava_other; anything else is coerced. */
    async recordStravaError (code) {
      state.stravaError = pullCode(code)
      state.stravaErrorAt = new Date(now()).toISOString()
      changed()
      await persist()
    },

    async recordTokenSave (ok) {
      state.tokenSaveFailed = !ok
      changed()
      await persist()
    },

    async recordTrigger (seq) {
      state.triggerAt = new Date(now()).toISOString()
      if (state.triggerErrorSeq == null || state.triggerErrorSeq <= seq) {
        state.triggerError = null
        state.triggerErrorSeq = null
      }
      changed()
      await persist()
    },

    async recordTriggerError (seq) {
      state.triggerError = 'trigger_write'
      state.triggerErrorSeq = seq
      changed()
      await persist()
    },

    async snapshot () {
      const t = now()
      if (cache && t - cache.at < SNAPSHOT_TTL_MS) return cache.value
      if (!loaded) await load()
      let lastShortcutAt = null
      try {
        const { rows } = await pool.query('SELECT MAX(received_at) AS last FROM raw_payload')
        lastShortcutAt = toIso(rows[0]?.last)
      } catch (err) {
        log(JSON.stringify({ event: 'sync_status_read_failed', message: err.message }))
      }
      const value = {
        lastShortcutAt,
        lastStravaOkAt: state.stravaOkAt,
        lastStravaError: state.stravaError ?? (state.tokenSaveFailed ? 'strava_token_save' : null),
        lastTriggerAt: state.triggerAt,
        lastTriggerError: state.triggerError,
        lastTriggerErrorSeq: state.triggerErrorSeq,
        triggerSeq: state.triggerSeq,
        stravaConfigured: Boolean(stravaConfigured)
      }
      cache = { at: t, value }
      return value
    },

    /**
     * Degraded = Strava configured and no success within 6 h, measured from the
     * PERSISTED last success. Never succeeded counts as degraded: a restart
     * loop must not hide a permanently broken token behind a fresh grace period.
     */
    health () {
      if (!stravaConfigured) return { degraded: false }
      const okAt = state.stravaOkAt ? Date.parse(state.stravaOkAt) : null
      return okAt == null || now() - okAt > STRAVA_STALE_MS ? { degraded: true, reason: 'strava_stale' } : { degraded: false }
    }
  }
}
