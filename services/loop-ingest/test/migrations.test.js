import test from 'node:test'
import assert from 'node:assert/strict'
import { runMigrations, checksum, MIGRATION_LOCK_KEY } from '../src/migrations.js'

/**
 * A fake pool whose one client records every statement and keeps an in-memory schema_migrations ledger.
 * `fail` maps a migration's SQL text to the error it throws; `applied` seeds the ledger {file: checksum}.
 */
function fakePool ({ fail = {}, applied = {} } = {}) {
  const ledger = new Map(Object.entries(applied))
  const log = []
  let pending = null // the ledger row of the open transaction, committed on COMMIT
  let released = 0
  const client = {
    async query (sql, params = []) {
      log.push(params.length ? `${sql.trim().split('\n')[0]} [${params.join(',')}]` : sql.trim().split('\n')[0])
      if (fail[sql]) throw new Error(fail[sql])
      if (/^SELECT name, checksum FROM schema_migrations/.test(sql)) return { rows: [...ledger].map(([name, c]) => ({ name, checksum: c })) }
      if (/^INSERT INTO schema_migrations/.test(sql)) pending = params
      if (sql === 'COMMIT' && pending) { ledger.set(pending[0], pending[1]); pending = null }
      if (sql === 'ROLLBACK') pending = null
      return { rows: [] }
    },
    release () { released++ }
  }
  return { pool: { connect: async () => client }, log, ledger, released: () => released }
}
const readSql = async (f) => `SQL ${f}`
const ran = (log) => log.filter((l) => l.startsWith('SQL '))

test('first boot: every file runs once inside its own transaction and is recorded in the ledger, under the advisory lock', async () => {
  const f = fakePool()
  const r = await runMigrations(f.pool, { core: ['001', '005'], optional: { food: ['006'] }, readSql, log: () => {} })
  assert.deepEqual(r, { food: true })
  assert.deepEqual(ran(f.log), ['SQL 001', 'SQL 005', 'SQL 006'])
  assert.equal(f.log[0], `SELECT pg_advisory_lock($1) [${MIGRATION_LOCK_KEY}]`, 'the lock comes first')
  assert.equal(f.log.at(-1), `SELECT pg_advisory_unlock($1) [${MIGRATION_LOCK_KEY}]`, 'and is released last')
  assert.match(f.log[1], /CREATE TABLE IF NOT EXISTS schema_migrations/)
  const i = f.log.indexOf('SQL 001')
  assert.deepEqual(f.log.slice(i - 1, i + 3), ['BEGIN', 'SQL 001', `INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2) [001,${checksum('SQL 001')}]`, 'COMMIT'])
  assert.deepEqual([...f.ledger.keys()], ['001', '005', '006'])
  assert.equal(f.released(), 1)
})

test('a later boot runs only the files the ledger does not hold yet', async () => {
  const f = fakePool({ applied: { '001': checksum('SQL 001'), '006': checksum('SQL 006') } })
  await runMigrations(f.pool, { core: ['001', '009'], optional: { food: ['006'] }, readSql, log: () => {} })
  assert.deepEqual(ran(f.log), ['SQL 009'])
})

test('an applied file whose content changed refuses to start, before any migration runs, naming the file and the rule', async () => {
  const f = fakePool({ applied: { '001': checksum('SQL 001'), '009': checksum('the original 009') } })
  await assert.rejects(
    runMigrations(f.pool, { core: ['001', '009', '012'], optional: {}, readSql, log: () => {} }),
    (err) => {
      assert.equal(err.code, 'migration_checksum_mismatch')
      assert.match(err.message, /009 was changed after it was applied/)
      assert.match(err.message, /never edit an applied migration; add a new sql\/ file instead/)
      return true
    })
  assert.deepEqual(ran(f.log), [], 'nothing ran, not even the new 012')
  assert.equal(f.log.at(-1), `SELECT pg_advisory_unlock($1) [${MIGRATION_LOCK_KEY}]`, 'the lock is released on the way out')
  assert.equal(f.released(), 1)
})

test('CRLF line endings do not change the checksum (a Windows checkout is the same migration)', () => {
  assert.equal(checksum('A;\r\nB;\r\n'), checksum('A;\nB;\n'))
  assert.notEqual(checksum('A;\n'), checksum('A; \n'))
})

test('a failing OPTIONAL group is rolled back, logged and reported, never thrown, and stays pending for the next boot', async () => {
  const logged = []
  const f = fakePool({ fail: { 'SQL 006': 'permission denied for schema public' } })
  const r = await runMigrations(f.pool, { core: ['001', '005'], optional: { food: ['006'], journal: ['010'] }, readSql, log: (l) => logged.push(JSON.parse(l)) })
  assert.deepEqual(r, { food: false, journal: true })
  assert.deepEqual(ran(f.log), ['SQL 001', 'SQL 005', 'SQL 006', 'SQL 010'])
  assert.ok(f.log.includes('ROLLBACK'))
  assert.deepEqual([...f.ledger.keys()], ['001', '005', '010'], '006 is not recorded')
  assert.deepEqual(logged.filter((l) => l.event === 'food_migration_failed'), [{ event: 'food_migration_failed', message: 'permission denied for schema public' }])
})

test('a failing CORE migration still fails the start (ingest cannot run without its tables), and releases the lock', async () => {
  const f = fakePool({ fail: { 'SQL 002': 'boom' } })
  await assert.rejects(runMigrations(f.pool, { core: ['001', '002'], optional: { food: ['006'] }, readSql, log: () => {} }), /boom/)
  assert.deepEqual([...f.ledger.keys()], ['001'])
  assert.equal(f.log.at(-1), `SELECT pg_advisory_unlock($1) [${MIGRATION_LOCK_KEY}]`)
  assert.equal(f.released(), 1)
})

test('every sql/*.sql file is listed exactly once, core and each optional group in numeric order', async () => {
  const { readdir } = await import('node:fs/promises')
  const { CORE_MIGRATIONS, OPTIONAL_MIGRATIONS } = await import('../src/migrations.js')
  const onDisk = (await readdir(new URL('../sql/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort()
  const listed = [...CORE_MIGRATIONS, ...Object.values(OPTIONAL_MIGRATIONS).flat()]
  assert.deepEqual([...listed].sort(), onDisk, 'a new sql/ file must be added to CORE_MIGRATIONS or an OPTIONAL group, or it never runs')
  assert.equal(new Set(listed).size, listed.length, 'a migration is listed twice')
  for (const files of [CORE_MIGRATIONS, ...Object.values(OPTIONAL_MIGRATIONS)]) assert.deepEqual(files, [...files].sort(), 'out of numeric order')
})
