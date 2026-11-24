import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { CORE_MIGRATIONS, OPTIONAL_MIGRATIONS, runMigrations } from './migrations.js'

// the raw_payload insert moved to raw-payload-db.js; it keeps its historical import path
export { insertRawPayload } from './raw-payload-db.js'

/**
 * The slice of the pg driver this service calls (pg ships no type declarations). `rows` are untyped database
 * rows (`any`): every reader re-checks or converts the columns it uses.
 * @typedef {{ rows: any[], rowCount: number | null }} QueryResult
 * @typedef {{ query: (text: string, values?: readonly unknown[]) => Promise<QueryResult> }} Queryable a pool or a client
 * @typedef {Queryable & { release: (err?: unknown) => void }} PoolClient a checked-out client; release it once
 * @typedef {Queryable & { connect: () => Promise<PoolClient>, end: () => Promise<void>,
 *   on: (event: 'error', listener: (err: Error) => void) => unknown }} Pool
 * @typedef {string | { connectionString?: string, host?: string, port?: number, user?: string, password?: string,
 *   database?: string }} Connection a connection string, or the pg config server.js databaseConfig returns
 */

/** The pool. `connection` is a connection string or a {host, port, user, password, database} object
 * (server.js databaseConfig). An idle client's error (a Postgres restart) is logged instead of crashing the
 * process, a connection attempt gives up after 5 s (so /healthz answers instead of hanging while the DB is
 * down) and a statement after 30 s. */
/** @param {Connection} connection
 * @param {{ Pool?: new (config: object) => Pool, log?: (line: string) => void }} [deps]
 * @returns {Pool} */
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
/** @param {Pool} pool @param {(line: string) => void} [log] */
export function migrate (pool, log = console.log) {
  const readSql = (/** @type {string} */ file) => readFile(fileURLToPath(new URL(`../sql/${file}`, import.meta.url)), 'utf8')
  return runMigrations(pool, { core: CORE_MIGRATIONS, optional: OPTIONAL_MIGRATIONS, readSql, log })
}

/** @param {Queryable} pool */
export async function ping (pool) {
  await pool.query('SELECT 1')
}
