/**
 * HTTP layer for the on-demand refresh. Both routes are UNAUTHENTICATED on
 * purpose: the static plan page cannot hold a secret. That is safe because
 * POST /sync only schedules work the service already does on a timer (global
 * 1-per-60 s rate limit, no body read, nothing returned but a time) and
 * GET /sync/status exposes timestamps and a short error string, never health
 * data. The data endpoints (/ingest, /export) keep their bearer token.
 */
function send (res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...extraHeaders
  })
  res.end(payload)
}

export function createSyncRoutes ({ trigger, status }) {
  return {
    /** Answers at once; returns the background work's promise (tests await it). */
    handleSync (req, res) {
      const result = trigger.handle()
      const headers = result.status === 429 ? { 'retry-after': String(result.retryAfterSec) } : {}
      send(res, result.status, result.body, headers)
      return result.done
    },

    async handleStatus (req, res) {
      send(res, 200, await status.snapshot())
    }
  }
}
