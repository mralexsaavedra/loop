import { writeFile } from 'node:fs/promises'
import path from 'node:path'

export const TRIGGER_FILE = 'refresh'
const DEFAULT_INTERVAL_MS = 60_000
// Upper bound on how long the trigger waits for the Strava pull it just kicked,
// so a hung Strava request can never block the page rebuild.
const DEFAULT_WAIT_MS = 90_000

/**
 * Global (not per-client) limiter: POST /sync is unauthenticated, so the only
 * protection against abuse is that at most one request per interval does any
 * work at all. A refused take does not extend the window.
 */
export function createRateLimiter ({ intervalMs = DEFAULT_INTERVAL_MS, now = Date.now } = {}) {
  let last = -Infinity
  return {
    take () {
      const t = now()
      const elapsed = t - last
      if (elapsed < intervalMs) {
        return { ok: false, retryAfterSec: Math.ceil((intervalMs - elapsed) / 1000) }
      }
      last = t
      return { ok: true }
    }
  }
}

/**
 * Writes the request time into `<dir>/refresh`. The host watches that file
 * with a systemd path unit (PathModified) and runs the page refresh; a plain
 * write + close is exactly what PathModified reacts to.
 */
export function createTriggerWriter ({ dir }) {
  const file = path.join(dir, TRIGGER_FILE)
  return async function writeTrigger (iso) {
    await writeFile(file, `${iso}\n`, 'utf8')
  }
}

function settleWithin (promise, ms) {
  let timer
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, ms) })
  return Promise.race([promise.catch(() => {}), timeout]).finally(() => clearTimeout(timer))
}

/**
 * POST /sync. Returns synchronously with the HTTP answer (`status`, `body`,
 * `retryAfterSec` on 429) plus `done`, a promise for the background work, so
 * callers answer 202 at once and tests can await the side effects.
 *
 * Work: kick the Strava pull (shared, never overlapping — see sync.js), wait
 * for it to settle (bounded by waitMs), then write the trigger so the host
 * rebuild reads what the pull just stored. A failed pull still triggers: the
 * rebuild then uses what is already stored.
 */
export function createSyncTrigger ({
  limiter,
  runStrava,
  writeTrigger,
  status,
  now = Date.now,
  waitMs = DEFAULT_WAIT_MS,
  log = console.log
}) {
  return {
    handle () {
      const verdict = limiter.take()
      if (!verdict.ok) {
        return {
          status: 429,
          retryAfterSec: verdict.retryAfterSec,
          body: { error: 'rate limited', retryAfterSec: verdict.retryAfterSec },
          done: Promise.resolve()
        }
      }

      const requestedAt = new Date(now()).toISOString()
      // async wrapper: starts the pull now, and turns a synchronous throw into a rejection
      const strava = runStrava ? (async () => runStrava())() : Promise.resolve()

      const done = settleWithin(strava, runStrava ? waitMs : 0)
        .then(() => writeTrigger(requestedAt))
        .then(() => status.recordTrigger(requestedAt))
        .then(() => log(JSON.stringify({ event: 'sync_triggered', requestedAt })))
        .catch((err) => log(JSON.stringify({ event: 'trigger_write_failed', code: err.code ?? null, message: err.message })))

      return {
        status: 202,
        body: { ok: true, strava: runStrava ? 'started' : 'disabled', requestedAt },
        done
      }
    }
  }
}
