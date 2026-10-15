import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time bearer token check.
 *
 * Health Auto Export can only send a static header, so the token is the whole
 * security boundary for the ingest endpoint. Compare it without leaking length
 * or content through timing.
 */
export function isAuthorized (headerValue, expectedToken) {
  if (!expectedToken) return false
  if (typeof headerValue !== 'string') return false

  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim())
  if (!match) return false

  const provided = Buffer.from(match[1], 'utf8')
  const expected = Buffer.from(expectedToken, 'utf8')
  if (provided.length !== expected.length) return false

  return timingSafeEqual(provided, expected)
}

/**
 * isAuthorized on a request, plus an audit line for every failure: `{event: 'unauthorized', path, reason,
 * remote, count}` where reason is missing (no Authorization header), malformed (not `Bearer <token>`) or
 * invalid (a wrong token), and count is the number of failures since this checker was created (one per
 * process: a rising count in `docker compose logs` is a misconfigured client or someone guessing). Never logs
 * the presented token, the expected one or the query string.
 */
export function createBearerCheck (expectedToken, { log = (line) => console.log(line) } = {}) {
  let failures = 0
  return function checkBearer (req) {
    const header = req.headers.authorization
    if (isAuthorized(header, expectedToken)) return true
    failures += 1
    const reason = typeof header !== 'string' || header.trim() === ''
      ? 'missing'
      : /^Bearer\s+\S/i.test(header.trim()) ? 'invalid' : 'malformed'
    let path = null
    try { path = new URL(req.url, 'http://localhost').pathname } catch {}
    log(JSON.stringify({ event: 'unauthorized', path, reason, remote: req.socket?.remoteAddress ?? null, count: failures }))
    return false
  }
}
