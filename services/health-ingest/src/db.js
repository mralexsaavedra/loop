import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const MIGRATIONS = ['001_init.sql', '002_strava.sql', '003_sync.sql', '004_athlete.sql']

export function createPool (connectionString) {
  return new pg.Pool({ connectionString, max: 4, idleTimeoutMillis: 30_000 })
}

export async function migrate (pool) {
  for (const file of MIGRATIONS) {
    const path = fileURLToPath(new URL(`../sql/${file}`, import.meta.url))
    await pool.query(await readFile(path, 'utf8'))
  }
}

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

export async function ping (pool) {
  await pool.query('SELECT 1')
}
