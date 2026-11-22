/**
 * The stored Shortcut payloads' persistence (sql/001_init.sql: raw_payload): the ingest insert, the paged
 * /export/raw read and the newest receipt time GET /sync/status reports. Plain `fn(pool, ...)` functions; the
 * ingest route (server.js), the export handler (export.js) and the sync status (status.js) call them. Never
 * imports the pg driver (db.js owns the pool), so the route modules stay importable without it.
 */

export async function insertRawPayload (pool, record) {
  const { rows } = await pool.query(
    `INSERT INTO raw_payload (source, automation, aggregation, period, session_id, byte_size, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, received_at`,
    [
      record.source,
      record.automation,
      record.aggregation,
      record.period,
      record.sessionId,
      record.byteSize,
      record.payload
    ]
  )
  return rows[0]
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

/** The newest payload's receipt time (raw `received_at`, null when none is stored). */
export async function lastRawPayloadAt (pool) {
  const { rows } = await pool.query('SELECT MAX(received_at) AS last FROM raw_payload')
  return rows[0]?.last
}
