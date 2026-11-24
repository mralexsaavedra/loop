import test from 'node:test'
import assert from 'node:assert/strict'
import { createPool } from '../src/db.js'

class FakePool {
  /** @param {Record<string, unknown>} opts */
  constructor (opts) {
    this.opts = opts
    /** @type {Record<string, (err: Error) => void>} */
    this.handlers = {}
  }

  /** @param {string} ev @param {(err: Error) => void} fn */
  on (ev, fn) { this.handlers[ev] = fn; return this }
}

test('createPool: an idle-client error is logged, never an uncaught crash; connections and statements time out', () => {
  /** @type {string[]} */
  const logs = []
  // the fake has only the constructor and `on` createPool calls; read back as the fake to inspect it
  const Pool = /** @type {new (config: object) => import('../src/db.js').Pool} */ (/** @type {unknown} */ (FakePool))
  const pool = /** @type {FakePool} */ (/** @type {unknown} */ (createPool('postgres://x', { Pool, log: (l) => logs.push(l) })))
  assert.equal(typeof pool.handlers.error, 'function', 'an error listener (a Postgres restart would otherwise kill the process)')
  pool.handlers.error(new Error('terminating connection due to administrator command'))
  assert.equal(logs.length, 1)
  assert.match(logs[0], /"event":"db_pool_error"/)
  assert.equal(pool.opts.connectionTimeoutMillis, 5000, '/healthz answers instead of hanging when the DB is down')
  assert.equal(pool.opts.statement_timeout, 30000)
  assert.equal(pool.opts.connectionString, 'postgres://x')
})
