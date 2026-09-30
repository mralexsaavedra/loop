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
const SEQ_LINE = /^(\d{1,15})\n?$/

/** The trigger file holds ONE line, the sequence number. Anything else reads as 0. */
export function parseTriggerSeq (text) {
  const m = SEQ_LINE.exec(String(text ?? ''))
  return m ? Number(m[1]) : 0
}

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
 */
export function createTriggerWriter ({ dir }) {
  const file = path.join(dir, TRIGGER_FILE)
  return async function writeTrigger (seq) {
    const target = await lstat(file).catch((err) => { if (err.code === 'ENOENT') return null; throw err })
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

function settleWithin (promise, ms) {
  let timer
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, ms) })
  return Promise.race([promise.catch(() => {}), timeout]).finally(() => clearTimeout(timer))
}

/**
 * POST /sync, sequence protocol. Every accepted click gets a sequence number;
 * the host refresh (services/plan-web/refresh.sh) reports the highest one it
 * has published as `processedSeq` in status.json, so the page waits for
 * `processedSeq >= seq` — no clock comparison anywhere.
 *
 * Cost is bounded WITHOUT ever refusing the owner (no 429):
 *   - a click while a trigger is still pending (its Strava pull + write not
 *     done yet) or within MIN_TRIGGER_INTERVAL_MS of the last one COALESCES:
 *     202 {seq: <current>, coalesced: true}, no work at all;
 *   - otherwise a new seq is assigned; the Strava pull is skipped when the
 *     last successful pull is < MIN_STRAVA_INTERVAL_MS old; the trigger file
 *     is written once the pull settles (bounded by waitMs).
 * So a flood costs at most one rebuild per minute and one Strava pull per 5 min.
 *
 * Returns synchronously with `status`/`body` plus `done` (the background work)
 * so the HTTP layer answers at once and tests can await the side effects.
 */
export function createSyncTrigger ({
  runStrava,
  writeTrigger,
  status,
  now = Date.now,
  waitMs = DEFAULT_WAIT_MS,
  minTriggerIntervalMs = MIN_TRIGGER_INTERVAL_MS,
  minStravaIntervalMs = MIN_STRAVA_INTERVAL_MS,
  log = console.log
}) {
  let pending = false
  let lastAcceptedAt = -Infinity

  return {
    handle () {
      const t = now()
      if (pending || t - lastAcceptedAt < minTriggerIntervalMs) {
        return { status: 202, body: { ok: true, seq: status.currentSeq(), coalesced: true }, done: Promise.resolve() }
      }
      pending = true
      lastAcceptedAt = t
      const seq = status.nextTriggerSeq()

      const stravaMode = !runStrava ? 'disabled' : status.stravaFresh(minStravaIntervalMs) ? 'recent' : 'started'
      // async wrapper: starts the pull now, and turns a synchronous throw into a rejection
      const strava = stravaMode === 'started' ? (async () => runStrava())() : Promise.resolve()

      const done = settleWithin(strava, stravaMode === 'started' ? waitMs : 0)
        .then(() => writeTrigger(seq))
        .then(
          async () => {
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
        .finally(() => { pending = false })

      return { status: 202, body: { ok: true, seq, coalesced: false, strava: stravaMode }, done }
    }
  }
}
