import { isAuthorized } from './auth.js'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 1000

function badRequest (message) {
  return Object.assign(new Error(message), { status: 400 })
}

/**
 * Validate `?since_id=…&limit=…`, shared by every paged export endpoint. Ids
 * stay strings: they are BIGINT/BIGSERIAL and must not lose precision in a
 * JS number.
 */
export function parsePaging (searchParams) {
  const sinceId = searchParams.get('since_id') ?? '0'
  if (!/^\d{1,18}$/.test(sinceId)) throw badRequest('since_id must be a non-negative integer')

  const rawLimit = searchParams.get('limit')
  let limit = DEFAULT_LIMIT
  if (rawLimit != null) {
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) throw badRequest('limit must be a positive integer')
    limit = Math.min(Number(rawLimit), MAX_LIMIT)
  }

  return { sinceId, limit }
}

/** Validate `?automation=…&since_id=…&limit=…`. */
export function parseExportQuery (searchParams) {
  const automation = searchParams.get('automation')
  if (!automation) throw badRequest('automation is required')

  const { sinceId, limit } = parsePaging(searchParams)
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

/**
 * `start_local` is read from the JSONB payload, not the `start_local` column:
 * the upsert in strava.js never refreshes that column on an edit, so it can
 * go stale. The numeric fields go through `payload->'field'` (jsonb), which
 * never raises a cast error even if a field is absent. `name` and the raw
 * payload are never selected — privacy boundary for this endpoint.
 */
export async function listStravaActivities (pool, { sinceId, limit }) {
  const { rows } = await pool.query(
    `SELECT id::text AS id,
            payload->>'start_date_local' AS start_local,
            sport_type,
            payload->'moving_time' AS moving_time,
            payload->'elapsed_time' AS elapsed_time,
            payload->'distance' AS distance,
            payload->'average_heartrate' AS average_heartrate,
            payload->'max_heartrate' AS max_heartrate
       FROM strava_activity
      WHERE id > $1
      ORDER BY id ASC
      LIMIT $2`,
    [sinceId, limit]
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

/**
 * GET /export/strava — hands stored Strava activities back to the local sync
 * script, oldest first, paged by `since_id`. Same bearer check and
 * counts-only logging as `/export/raw`; never logs activity field values.
 */
export function createStravaExportHandler ({ pool, token, log = console.log }) {
  return async function handleStravaExport (req, res, url) {
    if (!isAuthorized(req.headers.authorization, token)) {
      send(res, 401, { error: 'unauthorized' })
      return
    }

    let query
    try {
      query = parsePaging(url.searchParams)
    } catch (err) {
      send(res, 400, { error: err.message })
      return
    }

    const rows = await listStravaActivities(pool, query)
    log(JSON.stringify({ event: 'exported', since_id: query.sinceId, count: rows.length }))
    send(res, 200, rows)
  }
}
