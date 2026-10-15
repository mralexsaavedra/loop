/**
 * The real-Postgres suite's helper (test/pg/*.test.js, `npm run test:pg`). Set TEST_DATABASE_URL to a
 * server where the user may CREATE DATABASE (e.g. postgres://postgres:x@127.0.0.1:5544/postgres): every
 * test file gets its own fresh, EMPTY database (loop_test_<random>) and drops it at the end, so the real
 * migrations always start from nothing and the files may run in parallel. Without the variable every
 * test skips, so `npm test` needs no database.
 */
import { randomBytes } from 'node:crypto'
import pg from 'pg'

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || ''
/** node:test `skip` option: false with a database, else the reason. */
export const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL not set (real-Postgres suite, npm run test:pg)'

async function admin (sql) {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL })
  await client.connect()
  try { await client.query(sql) } finally { await client.end() }
}

/** A fresh empty database: { url, drop() }. */
export async function freshDatabase () {
  const name = `loop_test_${randomBytes(6).toString('hex')}`
  await admin(`CREATE DATABASE ${name}`)
  const u = new URL(TEST_DATABASE_URL)
  u.pathname = `/${name}`
  return { name, url: u.toString(), drop: () => admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`) }
}
