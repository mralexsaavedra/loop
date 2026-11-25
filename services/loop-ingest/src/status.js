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
 *
 * Garmin (optional, garmin-sync.js): only when `garminConfigured`, its last success and coarse code
 * (garmin_auth / garmin_network / garmin_other) live in their own row (garmin_sync_state, sql/015_garmin.sql,
 * through garmin-db.js), never in the Strava fields, and never degrade /healthz. `garminKeyExpires` is the
 * owner-given GARMIN_API_KEY_EXPIRES date (the API does not report it), already validated (garmin.js).
 */
import { saveSyncStatus, loadSyncStatus } from './sync-status-db.js'
import { loadGarminState, saveGarminStatus } from './garmin-db.js'
import { lastRawPayloadAt } from './raw-payload-db.js'

export const STRAVA_STALE_MS = 6 * 3_600_000
export const SNAPSHOT_TTL_MS = 5000
export const STATUS_CODES = new Set(['strava_auth', 'strava_network', 'strava_other', 'strava_token_save', 'trigger_write', 'build',
  'garmin_auth', 'garmin_network', 'garmin_other'])
// the trigger's codes: trigger_write = the host trigger file could not be written; build = the in-container build
// (container mode, builder.js) exited non-zero or could not start
const TRIGGER_CODES = new Set(['trigger_write', 'build'])
const STRAVA_PULL_CODES = new Set(['strava_auth', 'strava_network', 'strava_other'])
const GARMIN_CODES = new Set(['garmin_auth', 'garmin_network', 'garmin_other'])

/** The in-memory sync state (persisted by sync-status-db.js): ISO times, sequence numbers and coarse codes only.
 * @typedef {{ stravaOkAt: string | null, stravaError: string | null, stravaErrorAt: string | null,
 *   tokenSaveFailed: boolean, triggerAt: string | null, triggerSeq: number, triggerError: string | null,
 *   triggerErrorSeq: number | null }} SyncState */
/** GET /sync/status's body. @typedef {{ lastShortcutAt: string | null, lastStravaOkAt: string | null,
 *   lastStravaError: string | null, lastTriggerAt: string | null, lastTriggerError: string | null,
 *   lastTriggerErrorSeq: number | null, triggerSeq: number, stravaConfigured: boolean, garminConfigured: boolean,
 *   lastGarminOkAt: string | null, lastGarminError: string | null, garminKeyExpires: string | null }} SyncSnapshot */

/** @param {unknown} value a timestamp (Date, string or epoch ms) @returns {string | null} */
function toIso (value) {
  if (value == null) return null
  const d = new Date(/** @type {string | number | Date} */ (value))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** @param {unknown} value @returns {number} */
function toSeq (value) {
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : 0
}

/** Anything that is not a known pull code (e.g. a raw message) becomes strava_other. */
/** @param {unknown} value @returns {string} */
function pullCode (value) {
  // has() of a non-string is simply false, so the cast never lets one through
  const code = /** @type {string} */ (value)
  return STRAVA_PULL_CODES.has(code) ? code : 'strava_other'
}

/** A Garmin code, or garmin_other for anything else. @param {unknown} value @returns {string} */
function garminCode (value) {
  const code = /** @type {string} */ (value)
  return GARMIN_CODES.has(code) ? code : 'garmin_other'
}

/**
 * @param {{ pool: import('./db.js').Queryable, stravaConfigured?: unknown, garminConfigured?: unknown,
 *   garminKeyExpires?: string | null, now?: () => number,
 *   readTriggerSeq?: (() => Promise<number>) | null, log?: (line: string) => void }} options
 */
export function createSyncStatus ({ pool, stravaConfigured, garminConfigured = false, garminKeyExpires = null, now = Date.now, readTriggerSeq = null, log = console.log }) {
  /** The Garmin freshness (its own row; only touched when configured). @type {import('./garmin-db.js').GarminStatusState} */
  const garmin = { okAt: null, error: null, errorAt: null }
  let garminLoaded = !garminConfigured
  /** @type {SyncState} */
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
  /** @type {{ at: number, value: SyncSnapshot } | null} */
  let cache = null

  function changed () { cache = null }

  async function persist () {
    try {
      await saveSyncStatus(pool, state)
    } catch (err) {
      // Freshness bookkeeping must never fail a sync or a request.
      log(JSON.stringify({ event: 'sync_status_persist_failed', message: /** @type {Error} */ (err).message }))
    }
  }

  async function persistGarmin () {
    try {
      await saveGarminStatus(pool, garmin)
    } catch (err) {
      log(JSON.stringify({ event: 'garmin_status_persist_failed', message: /** @type {Error} */ (err).message }))
    }
  }

  // its own read, apart from the main row: a missing Garmin table (its optional migration failed) never hides the rest
  async function loadGarmin () {
    try {
      const row = await loadGarminState(pool)
      garminLoaded = true
      changed()
      garmin.okAt = garmin.okAt ?? row.okAt
      if (garmin.error == null && row.error != null) {
        garmin.error = garminCode(row.error)
        garmin.errorAt = row.errorAt
      }
    } catch (err) {
      log(JSON.stringify({ event: 'garmin_status_load_failed', message: /** @type {Error} */ (err).message }))
    }
  }

  async function load () {
    if (!garminLoaded) await loadGarmin()
    const fileSeq = readTriggerSeq ? toSeq(await readTriggerSeq().catch(() => 0)) : 0
    state.triggerSeq = Math.max(state.triggerSeq, fileSeq)
    try {
      const row = await loadSyncStatus(pool)
      loaded = true
      changed()
      if (!row) return
      // in-memory values recorded before a (retried) load win over the DB copy
      state.stravaOkAt = state.stravaOkAt ?? toIso(row.last_strava_ok_at)
      if (state.stravaError == null && row.last_strava_error != null) {
        state.stravaError = pullCode(row.last_strava_error)
        state.stravaErrorAt = toIso(row.last_strava_error_at)
      }
      state.triggerAt = state.triggerAt ?? toIso(row.last_trigger_at)
      state.triggerSeq = Math.max(state.triggerSeq, toSeq(row.trigger_seq))
      if (state.triggerError == null && TRIGGER_CODES.has(row.last_trigger_error)) {
        state.triggerError = row.last_trigger_error
        state.triggerErrorSeq = row.last_trigger_error_seq == null ? null : toSeq(row.last_trigger_error_seq)
      }
      state.tokenSaveFailed = state.tokenSaveFailed || row.strava_token_save_failed === true
    } catch (err) {
      log(JSON.stringify({ event: 'sync_status_load_failed', message: /** @type {Error} */ (err).message }))
    }
  }

  return {
    /** Never throws; a failure is logged and the load is retried on the next snapshot. */
    load,

    currentSeq () { return state.triggerSeq },

    /** When the last trigger write was recorded (epoch ms), or null; seeds the boot recovery's min interval. */
    lastTriggerAtMs () {
      const t = state.triggerAt ? Date.parse(state.triggerAt) : NaN
      return Number.isFinite(t) ? t : null
    },

    /** Synchronous increment (so two concurrent clicks can never share a new seq); persisted best-effort. */
    nextTriggerSeq () {
      state.triggerSeq += 1
      changed()
      persist()
      return state.triggerSeq
    },

    /** @param {number} ms */
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
    /** @param {unknown} code */
    async recordStravaError (code) {
      state.stravaError = pullCode(code)
      state.stravaErrorAt = new Date(now()).toISOString()
      changed()
      await persist()
    },

    /** @param {number} ms */
    garminFresh (ms) {
      return garmin.okAt != null && now() - Date.parse(garmin.okAt) < ms
    },

    async recordGarminOk () {
      garmin.okAt = new Date(now()).toISOString()
      garmin.error = null
      garmin.errorAt = null
      changed()
      await persistGarmin()
    },

    /** `code` should be garmin_auth / garmin_network / garmin_other; anything else is coerced to garmin_other. */
    /** @param {unknown} code */
    async recordGarminError (code) {
      garmin.error = garminCode(code)
      garmin.errorAt = new Date(now()).toISOString()
      changed()
      await persistGarmin()
    },

    /** @param {boolean} ok */
    async recordTokenSave (ok) {
      state.tokenSaveFailed = !ok
      changed()
      await persist()
    },

    /** @param {number} seq */
    async recordTrigger (seq) {
      state.triggerAt = new Date(now()).toISOString()
      if (state.triggerErrorSeq == null || state.triggerErrorSeq <= seq) {
        state.triggerError = null
        state.triggerErrorSeq = null
      }
      changed()
      await persist()
    },

    /** `code`: trigger_write (default) or build; anything else is coerced to trigger_write. */
    /** @param {number} seq @param {string} [code] */
    async recordTriggerError (seq, code = 'trigger_write') {
      state.triggerError = TRIGGER_CODES.has(code) ? code : 'trigger_write'
      state.triggerErrorSeq = seq
      changed()
      await persist()
    },

    /** @returns {Promise<SyncSnapshot>} */
    async snapshot () {
      const t = now()
      if (cache && t - cache.at < SNAPSHOT_TTL_MS) return cache.value
      if (!loaded) await load()
      else if (!garminLoaded) await loadGarmin()
      let lastShortcutAt = null
      try {
        lastShortcutAt = toIso(await lastRawPayloadAt(pool))
      } catch (err) {
        log(JSON.stringify({ event: 'sync_status_read_failed', message: /** @type {Error} */ (err).message }))
      }
      const value = {
        lastShortcutAt,
        lastStravaOkAt: state.stravaOkAt,
        lastStravaError: state.stravaError ?? (state.tokenSaveFailed ? 'strava_token_save' : null),
        lastTriggerAt: state.triggerAt,
        lastTriggerError: state.triggerError,
        lastTriggerErrorSeq: state.triggerErrorSeq,
        triggerSeq: state.triggerSeq,
        stravaConfigured: Boolean(stravaConfigured),
        garminConfigured: Boolean(garminConfigured),
        lastGarminOkAt: garmin.okAt,
        lastGarminError: garmin.error,
        garminKeyExpires: garminConfigured ? garminKeyExpires : null
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
