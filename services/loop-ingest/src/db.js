import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { CORE_MIGRATIONS, OPTIONAL_MIGRATIONS, runMigrations } from './migrations.js'

// the raw_payload insert moved to raw-payload-db.js; it keeps its historical import path
export { insertRawPayload } from './raw-payload-db.js'

/** The pool. `connection` is a connection string or a {host, port, user, password, database} object
 * (server.js databaseConfig). An idle client's error (a Postgres restart) is logged instead of crashing the
 * process, a connection attempt gives up after 5 s (so /healthz answers instead of hanging while the DB is
 * down) and a statement after 30 s. */
export function createPool (connection, { Pool = pg.Pool, log = console.error } = {}) {
  const pool = new Pool({
    ...(typeof connection === 'string' ? { connectionString: connection } : connection),
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000
  })
  pool.on('error', (err) => log(JSON.stringify({ event: 'db_pool_error', message: err.message })))
  return pool
}

/** Runs every migration; resolves { food, settings, profile, journal: boolean } (false = that group failed, see migrations.js). */
export function migrate (pool, log = console.log) {
  const readSql = (file) => readFile(fileURLToPath(new URL(`../sql/${file}`, import.meta.url)), 'utf8')
  return runMigrations(pool, { core: CORE_MIGRATIONS, optional: OPTIONAL_MIGRATIONS, readSql, log })
}

export async function ping (pool) {
  await pool.query('SELECT 1')
}
