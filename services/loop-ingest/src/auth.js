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
