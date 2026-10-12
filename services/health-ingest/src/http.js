/**
 * Shared HTTP helpers for the route modules (food.js, journal.js, athlete.js, export.js, sync-routes.js,
 * server.js). No dependencies and no state: response writing, the capped JSON body reader, the coarse
 * error object and the LAN-only Host / Origin checks the unauthenticated page routes share (the
 * security model is documented in food.js's header).
 */

/** The JSON body cap of readJson (413 above it). */
export const JSON_BODY_LIMIT = 16 * 1024

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/
const IPV6_RE = /^\[[0-9a-f:.]+\]$/
const LOCAL_HOSTS = ['localhost', 'host.docker.internal']

/** An Error carrying the HTTP status and a coarse {error: code, field?} for the response. */
export function httpError (status, code, field) {
  return Object.assign(new Error(code), { status, code, field })
}

/**
 * A JSON response with only content-type and content-length, then `headers` in the given order. The
 * bearer-token routes (/export/*, /ingest) and /sync use it directly with their historical headers.
 */
export function writeJson (res, status, body, headers = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...headers
  })
  res.end(payload)
}

/** The page routes' JSON response: never cached, never sniffed; `extra` headers come last (may override). */
export function send (res, status, body, extra = {}) {
  writeJson(res, status, body, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra
  })
}

/** Whether the request declares `Content-Type: application/json` (parameters and case ignored). */
export function isJson (req) {
  const ct = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  return ct === 'application/json'
}

/** The parsed JSON body; 413 payload_too_large over JSON_BODY_LIMIT (declared or counted), 400 bad_json. */
export function readJson (req) {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > JSON_BODY_LIMIT) return Promise.reject(httpError(413, 'payload_too_large'))
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let over = false
    req.on('data', (chunk) => {
      if (over) return
      size += chunk.length
      if (size > JSON_BODY_LIMIT) {
        over = true
        reject(httpError(413, 'payload_too_large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (over) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(httpError(400, 'bad_json'))
      }
    })
    req.on('error', reject)
  })
}

/** YYYY-MM-DD that is a real calendar day (2026-02-31 is refused), years 2000-2100. */
export function validDate (s) {
  const m = typeof s === 'string' ? DATE_RE.exec(s) : null
  if (!m) return null
  const y = Number(m[1])
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3])))
  return y >= 2000 && y <= 2100 && d.toISOString().slice(0, 10) === s ? s : null
}

/** An allowed host name (no port): an IP literal, localhost, host.docker.internal or an allowlisted name. */
export function hostAllowed (hostname, extra = []) {
  const h = String(hostname || '').toLowerCase()
  if (!h) return false
  return IPV4_RE.test(h) || IPV6_RE.test(h) || LOCAL_HOSTS.includes(h) || extra.includes(h)
}
/** The host part of a Host header ("192.168.1.10:8090" -> "192.168.1.10", "[::1]:8088" -> "[::1]"). */
export function hostOfHeader (v) {
  const s = String(v || '').trim()
  const m = /^(\[[^\]]*\]|[^:]*)(?::\d+)?$/.exec(s)
  return m ? m[1] : ''
}
/** The host of an Origin header, or null when it is not a URL ("null", garbage). */
export function hostOfOrigin (v) {
  try {
    const u = new URL(v)
    return /^https?:$/.test(u.protocol) ? u.hostname : null
  } catch {
    return null
  }
}
/** FOOD_ALLOWED_HOSTS: comma / space separated names, lowercased. */
export function parseAllowedHosts (v) {
  return String(v || '').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
}
