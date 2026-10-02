import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { runMigrations } from './migrations.js'

const MIGRATIONS = ['001_init.sql', '002_strava.sql', '003_sync.sql', '004_athlete.sql', '005_athlete_refresh.sql']
// optional groups: a failure disables only that feature (its routes answer 503), see migrations.js
const OPTIONAL_MIGRATIONS = { food: ['006_food.sql'], settings: ['007_settings.sql'] }

export function createPool (connectionString) {
  return new pg.Pool({ connectionString, max: 4, idleTimeoutMillis: 30_000 })
}

/** Runs every migration; resolves { food, settings: boolean } (false = that group failed, see migrations.js). */
export function migrate (pool, log = console.log) {
  const readSql = (file) => readFile(fileURLToPath(new URL(`../sql/${file}`, import.meta.url)), 'utf8')
  return runMigrations(pool, { core: MIGRATIONS, optional: OPTIONAL_MIGRATIONS, readSql, log })
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
