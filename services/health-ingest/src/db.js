import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { CORE_MIGRATIONS, OPTIONAL_MIGRATIONS, runMigrations } from './migrations.js'

export function createPool (connectionString) {
  return new pg.Pool({ connectionString, max: 4, idleTimeoutMillis: 30_000 })
}

/** Runs every migration; resolves { food, settings, profile, journal: boolean } (false = that group failed, see migrations.js). */
export function migrate (pool, log = console.log) {
  const readSql = (file) => readFile(fileURLToPath(new URL(`../sql/${file}`, import.meta.url)), 'utf8')
  return runMigrations(pool, { core: CORE_MIGRATIONS, optional: OPTIONAL_MIGRATIONS, readSql, log })
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
