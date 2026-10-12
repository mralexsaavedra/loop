/**
 * HTTP layer for the on-demand refresh. Both routes are UNAUTHENTICATED on
 * purpose: the static plan page cannot hold a secret. That is safe because
 * POST /sync only schedules work the service already does on a timer and
 * never refuses or locks anyone out: repeated clicks COALESCE onto the pending
 * sequence, or onto ONE deferred sequence written when the 60 s window closes
 * (at most one rebuild per minute, one Strava pull per 5 min, see trigger.js),
 * it reads no body and returns only a sequence number.
 * GET /sync/status returns timestamps, sequence numbers and coarse error codes
 * (status.js), cached for 5 s, never health data or raw error text. The data
 * endpoints (/ingest, /export) keep their bearer token; a public reverse proxy
 * should forward only /ingest/* and /sync (see README).
 */
import { writeJson } from './http.js'

// no-store but no nosniff header: the historical /sync response, kept byte for byte
const send = (res, status, body) => writeJson(res, status, body, { 'cache-control': 'no-store' })

export function createSyncRoutes ({ trigger, status }) {
  return {
    /** Answers at once; returns the background work's promise (tests await it). */
    handleSync (req, res) {
      const result = trigger.handle()
      send(res, result.status, result.body)
      return result.done
    },

    async handleStatus (req, res) {
      send(res, 200, await status.snapshot())
    }
  }
}
