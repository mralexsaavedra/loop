import { constants } from 'node:fs'
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

export const TRIGGER_FILE = 'refresh'
// At most one trigger write (= one host rebuild) per minute; clicks inside the
// window coalesce onto the current sequence instead of being refused.
export const MIN_TRIGGER_INTERVAL_MS = 60_000
// At most one Strava pull per 5 min from POST /sync (the timer loop is separate).
export const MIN_STRAVA_INTERVAL_MS = 5 * 60_000
// Upper bound on how long the trigger waits for the Strava pull it just kicked,
// so a hung Strava request can never block the page rebuild.
const DEFAULT_WAIT_MS = 90_000
// flush() waits this long for an in-flight run before forcing the write; below
// the 3 s shutdown cap in server.js so the forced write still fits in it.
export const FLUSH_WAIT_MS = 2_000
// Boot recovery waits this long before re-writing an unwritten seq.
export const BOOT_RECOVERY_DELAY_MS = 5_000
const SEQ_LINE = /^(\d{1,15})\n?$/

/** The trigger file holds ONE line, the sequence number. Anything else reads as 0. */
/** @param {unknown} text @returns {number} */
export function parseTriggerSeq (text) {
  const m = SEQ_LINE.exec(String(text ?? ''))
  return m ? Number(m[1]) : 0
}

/** The sequence in `<dir>/refresh`, 0 when missing or unreadable. @param {string} dir @returns {Promise<number>} */
export async function readTriggerSeq (dir) {
  try {
    return parseTriggerSeq(await readFile(path.join(dir, TRIGGER_FILE), 'utf8'))
  } catch {
    return 0
  }
}

/**
 * Writes `seq\n` to `<dir>/refresh` ATOMICALLY: a temp file in the same dir,
 * opened O_CREAT|O_EXCL|O_NOFOLLOW (never follows or reuses an existing path),
 * then renamed over the target. A symlink planted at the target is refused
 * outright. The host's systemd path unit (PathModified) fires on the rename
 * (IN_MOVED_TO), and refresh.sh never sees a half-written file.
 * @param {{ dir: string }} options @returns {(seq: number) => Promise<void>}
 */
export function createTriggerWriter ({ dir }) {
  const file = path.join(dir, TRIGGER_FILE)
  return async function writeTrigger (seq) {
    const target = await lstat(file).catch((/** @type {NodeJS.ErrnoException} */ err) => { if (err.code === 'ENOENT') return null; throw err })
    if (target?.isSymbolicLink()) {
      throw Object.assign(new Error(`refusing to write trigger: ${file} is a symlink`), { code: 'ESYMLINK' })
    }
    const tmp = path.join(dir, `.${TRIGGER_FILE}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
    let handle = null
    try {
      handle = await open(tmp, flags, 0o644)
      await handle.writeFile(`${seq}\n`, 'utf8')
      await handle.close()
      handle = null
      await rename(tmp, file)
    } catch (err) {
      await handle?.close().catch(() => {})
      await unlink(tmp).catch(() => {})
      throw err
    }
  }
}

/** `promise` settled (either way) or `ms` elapsed, whichever comes first; never rejects.
 * @param {Promise<unknown>} promise @param {number} ms @returns {Promise<unknown>} */
function settleWithin (promise, ms) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, ms) })
  return Promise.race([promise.catch(() => {}), timeout]).finally(() => clearTimeout(timer))
}

/**
 * The slice of status.js createSyncStatus the trigger uses.
 * @typedef {{ stravaFresh: (ms: number) => boolean, garminFresh?: (ms: number) => boolean, currentSeq: () => number, nextTriggerSeq: () => number,
 *   recordTrigger: (seq: number) => Promise<void>, recordTriggerError: (seq: number) => Promise<void> }} TriggerStatus
 * @typedef {{ runStrava?: (() => unknown) | null, runGarmin?: (() => unknown) | null, writeTrigger: (seq: number) => Promise<void>, status: TriggerStatus,
 *   now?: () => number, waitMs?: number, minTriggerIntervalMs?: number, minStravaIntervalMs?: number,
 *   log?: (line: string) => void }} TriggerOptions
 * A scheduled deferred write: its seq, timer, the promise handle() answered with and its resolver.
 * @typedef {{ seq: number, timer: NodeJS.Timeout, done: Promise<void>, resolve: (done: Promise<void>) => void }} Deferred
 */

/**
 * POST /sync, sequence protocol. Every accepted click gets a sequence number;
 * the host refresh (services/loop-web/refresh.sh) reports the highest one it
 * has published as `processedSeq` in status.json, so the page waits for
 * `processedSeq >= seq` — no clock comparison anywhere.
 *
 * Cost is bounded WITHOUT ever refusing the user (no 429) and WITHOUT ever
 * dropping a call that may carry newer data:
 *   - a click while a trigger is still pending (its Strava pull + write not
 *     done yet) coalesces onto that seq: 202 {seq: <current>, coalesced: true}.
 *     Safe, because the rebuild has not started, so it will see the new data;
 *   - a click within MIN_TRIGGER_INTERVAL_MS of the last completed write
 *     DEFERS: a new seq is assigned now and ONE trigger write is
 *     scheduled for lastWrittenAt + MIN_TRIGGER_INTERVAL_MS, answered as
 *     202 {seq: <deferred>, coalesced: true, deferred: true}. Later clicks in
 *     the window reuse that seq (no pile-up). Without this, a Shortcut that
 *     POSTs a payload and then calls /sync seconds after a click would be
 *     folded into a rebuild that already ran without its data;
 *   - otherwise a new seq is assigned and run at once.
 * A run skips the Strava pull when the last successful pull is
 * < MIN_STRAVA_INTERVAL_MS old (checked when the run starts, so a deferred run
 * obeys its own cooldown); the trigger file is written once the pull settles
 * (bounded by waitMs). So a flood costs at most one rebuild per minute and one
 * Strava pull per 5 min.
 *
 * The window is measured from the last write's COMPLETION, not from when its
 * run started, so a slow Strava pull cannot yield two writes seconds apart.
 *
 * Garmin (optional, garmin-sync.js): with `runGarmin` set, a run also starts the Garmin pull under the same 5 min
 * cooldown (its own last success, status.garminFresh), in parallel with Strava; the write waits for both, still
 * bounded by waitMs, and a Garmin failure is only its own (never the Strava pull's, never the write's). The
 * answer then carries `garmin: started | recent`; without `runGarmin` it is exactly the previous one.
 *
 * Nothing new is persisted: the deferred seq goes through the same
 * nextTriggerSeq(). On shutdown call flush(): it writes a pending deferred seq
 * at once (no Strava pull) and awaits an in-flight run, forcing a direct write
 * of the persisted seq if that run outlives its budget. If the process dies
 * without it, the DB seq is ahead of the trigger file; recover() at boot
 * writes it once, so the host rebuild processes it.
 *
 * Returns synchronously with `status`/`body` plus `done` (the background work;
 * for a deferred answer, the deferred write) so the HTTP layer answers at once
 * and tests can await the side effects.
 * @param {TriggerOptions} options
 */
export function createSyncTrigger ({
  runStrava,
  runGarmin = null,
  writeTrigger,
  status,
  now = Date.now,
  waitMs = DEFAULT_WAIT_MS,
  minTriggerIntervalMs = MIN_TRIGGER_INTERVAL_MS,
  minStravaIntervalMs = MIN_STRAVA_INTERVAL_MS,
  log = console.log
}) {
  let pending = false
  // when the last trigger write COMPLETED (rename done): the min interval runs
  // from here, so a slow Strava pull cannot squeeze two writes seconds apart
  let lastWrittenAt = -Infinity
  // `done` of the run currently pulling Strava / writing, so flush() can await it
  /** @type {Promise<void> | null} */
  let inflight = null
  // { seq, timer, done, resolve } while a deferred write is scheduled
  /** @type {Deferred | null} */
  let deferred = null

  /** @param {number} seq @param {{ skipStrava?: boolean }} [opts] */
  function run (seq, { skipStrava = false } = {}) {
    pending = true

    const stravaMode = !runStrava ? 'disabled' : skipStrava || status.stravaFresh(minStravaIntervalMs) ? 'recent' : 'started'
    // async wrapper: starts the pull now, and turns a synchronous throw into a rejection
    // runStrava is set whenever stravaMode is 'started'
    const strava = stravaMode === 'started' ? (async () => /** @type {() => unknown} */ (runStrava)())() : Promise.resolve()
    const garminMode = !runGarmin ? null : skipStrava || status.garminFresh?.(minStravaIntervalMs) ? 'recent' : 'started'
    const garmin = garminMode === 'started' ? (async () => /** @type {() => unknown} */ (runGarmin)())() : Promise.resolve()
    const started = stravaMode === 'started' || garminMode === 'started'
    // allSettled: a Garmin failure never cuts the wait for Strava short, nor the other way round
    const pulls = garminMode ? Promise.allSettled([strava, garmin]) : strava

    const done = settleWithin(pulls, started ? waitMs : 0)
      .then(() => writeTrigger(seq))
      .then(
        async () => {
          lastWrittenAt = now()
          pending = false
          await status.recordTrigger(seq)
          log(JSON.stringify({ event: 'sync_triggered', seq }))
        },
        async (err) => {
          pending = false
          // the message stays in the log; status only ever gets the coarse code
          log(JSON.stringify({ event: 'trigger_write_failed', seq, code: err.code ?? null, message: err.message }))
          await status.recordTriggerError(seq)
        }
      )
      .catch((err) => log(JSON.stringify({ event: 'trigger_status_failed', message: err.message })))
      .finally(() => {
        pending = false
        if (inflight === done) inflight = null
      })
    inflight = done

    return { stravaMode, garminMode, done }
  }

  /** @param {{ skipStrava?: boolean }} [opts] @returns {Promise<void>} */
  function fireDeferred (opts) {
    const d = deferred
    if (!d) return Promise.resolve()
    deferred = null
    clearTimeout(d.timer)
    const { done } = run(d.seq, opts)
    d.resolve(done)
    return done
  }

  /** @param {number} seq @param {number} delay @param {string} event @returns {Promise<void>} */
  function defer (seq, delay, event) {
    /** @type {((done: Promise<void>) => void) | undefined} */
    let resolve
    /** @type {Promise<void>} */
    const done = new Promise((r) => { resolve = r })
    const timer = setTimeout(() => { fireDeferred() }, delay)
    timer.unref?.()
    // the Promise executor ran synchronously: resolve is set
    deferred = { seq, timer, done, resolve: /** @type {(done: Promise<void>) => void} */ (resolve) }
    log(JSON.stringify({ event, seq, delayMs: delay }))
    return done
  }

  /** @param {number} t */
  function schedule (t) {
    if (!deferred) defer(status.nextTriggerSeq(), Math.max(0, lastWrittenAt + minTriggerIntervalMs - t), 'sync_deferred')
    // defer() above set it when it was not already
    const d = /** @type {Deferred} */ (deferred)
    return { status: 202, body: { ok: true, seq: d.seq, coalesced: true, deferred: true }, done: d.done }
  }

  /** Last resort at shutdown: write the persisted seq now, no Strava pull, never throws. */
  async function forceWrite () {
    const seq = status.currentSeq()
    log(JSON.stringify({ event: 'sync_flush_forced', seq }))
    try {
      await writeTrigger(seq)
      lastWrittenAt = now()
      await status.recordTrigger(seq)
    } catch (thrown) {
      const err = /** @type {NodeJS.ErrnoException} */ (thrown)
      log(JSON.stringify({ event: 'trigger_write_failed', seq, code: err.code ?? null, message: err.message }))
    }
  }

  return {
    handle () {
      const t = now()
      if (deferred) return schedule(t)
      if (pending) {
        return { status: 202, body: { ok: true, seq: status.currentSeq(), coalesced: true }, done: Promise.resolve() }
      }
      if (t - lastWrittenAt < minTriggerIntervalMs) return schedule(t)
      const seq = status.nextTriggerSeq()
      const { stravaMode, garminMode, done } = run(seq)
      const body = { ok: true, seq, coalesced: false, strava: stravaMode, ...(garminMode ? { garmin: garminMode } : {}) }
      return { status: 202, body, done }
    },

    /**
     * Boot recovery: a seq handed out but never written (e.g. a crash between
     * nextTriggerSeq() and the write) leaves the DB ahead of the trigger file,
     * and the host would never process it. Schedule ONE write of the current
     * seq after `delayMs`, and no earlier than lastWrittenAt + the min interval.
     * It is an ordinary deferred write: clicks meanwhile share its seq.
     * @param {{ fileSeq?: number, delayMs?: number, lastWrittenAt?: number | null }} [opts]
     */
    recover ({ fileSeq, delayMs = BOOT_RECOVERY_DELAY_MS, lastWrittenAt: lastAt = null } = {}) {
      if (Number.isFinite(lastAt)) lastWrittenAt = Math.max(lastWrittenAt, /** @type {number} */ (lastAt))
      const seq = status.currentSeq()
      if (deferred || pending || !(seq > (Number(fileSeq) || 0))) return Promise.resolve()
      const delay = Math.max(delayMs, lastWrittenAt + minTriggerIntervalMs - now())
      return defer(seq, delay, 'sync_recovery_scheduled')
    },

    /**
     * Shutdown: write a pending deferred seq now (no Strava pull) and wait for
     * an in-flight run, up to `waitMs`. If that budget runs out (e.g. a hung
     * Strava pull), write the persisted seq directly so the trigger file and the
     * DB seq agree. Resolves once done; never rejects.
     */
    async flush ({ waitMs: budget = FLUSH_WAIT_MS } = {}) {
      if (deferred) fireDeferred({ skipStrava: true })
      if (!inflight) return
      const TIMEOUT = Symbol('timeout')
      /** @type {NodeJS.Timeout | undefined} */
      let timer
      const timeout = new Promise((resolve) => { timer = setTimeout(resolve, budget, TIMEOUT) })
      const result = await Promise.race([inflight, timeout]).finally(() => clearTimeout(timer))
      if (result === TIMEOUT) await forceWrite()
    }
  }
}
