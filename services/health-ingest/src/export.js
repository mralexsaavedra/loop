import { isAuthorized } from './auth.js'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 1000

function badRequest (message) {
  return Object.assign(new Error(message), { status: 400 })
}

/**
 * Validate `?automation=…&since_id=…&limit=…`. Ids stay strings: they are
 * BIGSERIAL and must not lose precision in a JS number.
 */
export function parseExportQuery (searchParams) {
  const automation = searchParams.get('automation')
  if (!automation) throw badRequest('automation is required')

  const sinceId = searchParams.get('since_id') ?? '0'
  if (!/^\d{1,18}$/.test(sinceId)) throw badRequest('since_id must be a non-negative integer')

  const rawLimit = searchParams.get('limit')
  let limit = DEFAULT_LIMIT
  if (rawLimit != null) {
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) throw badRequest('limit must be a positive integer')
    limit = Math.min(Number(rawLimit), MAX_LIMIT)
  }

  return { automation, sinceId, limit }
}

export async function listRawPayloads (pool, { automation, sinceId, limit }) {
  const { rows } = await pool.query(
    `SELECT id, received_at, payload
       FROM raw_payload
      WHERE automation = $1 AND id > $2
      ORDER BY id ASC
      LIMIT $3`,
    [automation, sinceId, limit]
  )
  return rows
}

function send (res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

/**
 * GET /export/raw — hands stored payloads back to the local sync script,
 * oldest first, paged by `since_id`. Same bearer check as ingest; logs counts
 * only, never payload contents.
 */
export function createExportHandler ({ pool, token, log = console.log }) {
  return async function handleExport (req, res, url) {
    if (!isAuthorized(req.headers.authorization, token)) {
      send(res, 401, { error: 'unauthorized' })
      return
    }

    let query
    try {
      query = parseExportQuery(url.searchParams)
    } catch (err) {
      send(res, 400, { error: err.message })
      return
    }

    const rows = await listRawPayloads(pool, query)
    log(JSON.stringify({ event: 'exported', automation: query.automation, since_id: query.sinceId, count: rows.length }))
    send(res, 200, rows)
  }
}
