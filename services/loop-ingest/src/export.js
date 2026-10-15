import { createBearerCheck } from './auth.js'
import { writeJson as send } from './http.js'

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

/**
 * The byte budget of one /export/raw page: payloads are up to MAX_BODY_BYTES (8 MB) each, so 500 of them could
 * be gigabytes in the service's memory (512 MB limit). A page stops after the payload that takes the sum of
 * `byte_size` past it; it always holds at least one row, so the cursor always advances.
 */
export const EXPORT_PAGE_BYTES = 32 * 1024 * 1024

/**
 * One page of stored payloads, oldest first: { rows, more }. First the ids + sizes of up to `limit` rows (never
 * the payloads), then the payloads of the prefix that fits `maxBytes`. `more` = the budget, not the row limit,
 * cut the page: rows after it exist (GET /export/raw sends it as `X-Has-More`).
 */
export async function listRawPayloads (pool, { automation, sinceId, limit, maxBytes = EXPORT_PAGE_BYTES }) {
  const { rows: sizes } = await pool.query(
    `SELECT id, byte_size
       FROM raw_payload
      WHERE automation = $1 AND id > $2
      ORDER BY id ASC
      LIMIT $3`,
    [automation, sinceId, limit]
  )
  if (!sizes.length) return { rows: [], more: false }
  let taken = 0
  let bytes = 0
  while (taken < sizes.length && (taken === 0 || bytes < maxBytes)) bytes += Number(sizes[taken++].byte_size) || 0
  const { rows } = await pool.query(
    `SELECT id, received_at, payload
       FROM raw_payload
      WHERE automation = $1 AND id > $2 AND id <= $3
      ORDER BY id ASC`,
    [automation, sinceId, String(sizes[taken - 1].id)]
  )
  return { rows, more: taken < sizes.length }
}

/**
 * `start_local` is read from the JSONB payload, not the `start_local` column:
 * the upsert in strava.js never refreshes that column on an edit, so it can
 * go stale. The numeric fields go through `payload->'field'` (jsonb), which
 * never raises a cast error even if a field is absent (`suffer_score` = Strava
 * Relative Effort; both it and `kilojoules` are null when the activity has none;
 * `total_elevation_gain` is metres climbed, null on activities without it; `start_utc` is
 * Strava's UTC `start_date`, which with `start_local` gives the UTC offset of the ride window;
 * `device_watts` is true only when the watts came from a real power meter, not Strava's
 * estimate — the local power-meter energy correction needs both; `hr_hist` = seconds per whole bpm
 * from the activity's HR stream (hr-zones.js, sql/008_strava_hr.sql), null until the backfill has
 * reached it or when it has no HR — the repo cuts the HR zones from it). `name` and the raw
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
            payload->'max_heartrate' AS max_heartrate,
            payload->'suffer_score' AS suffer_score,
            payload->'kilojoules' AS kilojoules,
            payload->'total_elevation_gain' AS total_elevation_gain,
            payload->>'start_date' AS start_utc,
            payload->'device_watts' AS device_watts,
            (SELECT h.hr_hist FROM strava_activity_hr h
              WHERE h.activity_id = strava_activity.id AND h.status = 'ok') AS hr_hist
       FROM strava_activity
      WHERE id > $1
      ORDER BY id ASC
      LIMIT $2`,
    [sinceId, limit]
  )
  return rows
}

/**
 * GET /export/raw — hands stored payloads back to the local sync script,
 * oldest first, paged by `since_id`. Same bearer check as ingest; logs counts
 * only, never payload contents.
 */
export function createExportHandler ({ pool, token, log = console.log, checkBearer = createBearerCheck(token) }) {
  return async function handleExport (req, res, url) {
    if (!checkBearer(req)) {
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

    const { rows, more } = await listRawPayloads(pool, query)
    log(JSON.stringify({ event: 'exported', automation: query.automation, since_id: query.sinceId, count: rows.length, more }))
    // the body stays the plain array the paging contract expects; `X-Has-More: true` = a byte-capped short
    // page with rows after it (a client that only checks `page.length < limit` stops and resumes from its
    // cursor on its next run)
    send(res, 200, rows, { 'x-has-more': String(more) })
  }
}

/**
 * GET /export/strava — hands stored Strava activities back to the local sync
 * script, oldest first, paged by `since_id`. Same bearer check and
 * counts-only logging as `/export/raw`; never logs activity field values.
 */
export function createStravaExportHandler ({ pool, token, log = console.log, checkBearer = createBearerCheck(token) }) {
  return async function handleStravaExport (req, res, url) {
    if (!checkBearer(req)) {
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
