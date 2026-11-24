import { createBearerCheck } from './auth.js'
import { writeJson as send } from './http.js'
import { listStravaActivities } from './strava-db.js'
import { listRawPayloads } from './raw-payload-db.js'

// the strava_activity read moved to strava-db.js; it keeps its historical import path
export { listStravaActivities } from './strava-db.js'
// the raw_payload page moved to raw-payload-db.js; it keeps its historical import path
export { EXPORT_PAGE_BYTES, listRawPayloads } from './raw-payload-db.js'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 1000

/** @typedef {import('node:http').IncomingMessage} Req @typedef {import('node:http').ServerResponse} Res */

/** @param {string} message */
function badRequest (message) {
  return Object.assign(new Error(message), { status: 400 })
}

/**
 * Validate `?since_id=…&limit=…`, shared by every paged export endpoint. Ids
 * stay strings: they are BIGINT/BIGSERIAL and must not lose precision in a
 * JS number.
 * @param {URLSearchParams} searchParams
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

/** Validate `?automation=…&since_id=…&limit=…`. @param {URLSearchParams} searchParams */
export function parseExportQuery (searchParams) {
  const automation = searchParams.get('automation')
  if (!automation) throw badRequest('automation is required')

  const { sinceId, limit } = parsePaging(searchParams)
  return { automation, sinceId, limit }
}

/**
 * GET /export/raw — hands stored payloads back to the local sync script,
 * oldest first, paged by `since_id`. Same bearer check as ingest; logs counts
 * only, never payload contents.
 * @param {{ pool: Parameters<typeof listRawPayloads>[0], token: string, log?: (line: string) => void,
 *   checkBearer?: (req: Req) => boolean }} opts
 */
export function createExportHandler ({ pool, token, log = console.log, checkBearer = createBearerCheck(token) }) {
  /** @param {Req} req @param {Res} res @param {URL} url */
  return async function handleExport (req, res, url) {
    if (!checkBearer(req)) {
      send(res, 401, { error: 'unauthorized' })
      return
    }

    let query
    try {
      query = parseExportQuery(url.searchParams)
    } catch (err) {
      send(res, 400, { error: /** @type {Error} */ (err).message })
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
 * @param {{ pool: Parameters<typeof listStravaActivities>[0], token: string, log?: (line: string) => void,
 *   checkBearer?: (req: Req) => boolean }} opts
 */
export function createStravaExportHandler ({ pool, token, log = console.log, checkBearer = createBearerCheck(token) }) {
  /** @param {Req} req @param {Res} res @param {URL} url */
  return async function handleStravaExport (req, res, url) {
    if (!checkBearer(req)) {
      send(res, 401, { error: 'unauthorized' })
      return
    }

    let query
    try {
      query = parsePaging(url.searchParams)
    } catch (err) {
      send(res, 400, { error: /** @type {Error} */ (err).message })
      return
    }

    const rows = await listStravaActivities(pool, query)
    log(JSON.stringify({ event: 'exported', since_id: query.sinceId, count: rows.length }))
    send(res, 200, rows)
  }
}
