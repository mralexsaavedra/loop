import test from 'node:test'
import assert from 'node:assert/strict'
import { runMigrations } from '../src/migrations.js'

test('core migrations run in order; a failing OPTIONAL one (the food tables) is logged and reported, never thrown', async () => {
  const ran = []
  const logged = []
  const pool = { query: async (sql) => { ran.push(sql); if (sql === 'SQL 006') throw new Error('permission denied for schema public') } }
  const r = await runMigrations(pool, { core: ['001', '005'], optional: { food: ['006'] }, readSql: async (f) => `SQL ${f}`, log: (l) => logged.push(JSON.parse(l)) })
  assert.deepEqual(ran, ['SQL 001', 'SQL 005', 'SQL 006'])
  assert.deepEqual(r, { food: false })
  assert.equal(logged.length, 1)
  assert.equal(logged[0].event, 'food_migration_failed')
})

test('a failing CORE migration still fails the start (ingest cannot run without its tables)', async () => {
  const pool = { query: async (sql) => { if (sql === 'SQL 002') throw new Error('boom') } }
  await assert.rejects(runMigrations(pool, { core: ['001', '002'], optional: { food: ['006'] }, readSql: async (f) => `SQL ${f}`, log: () => {} }), /boom/)
})

test('all good: every optional group is available', async () => {
  const r = await runMigrations({ query: async () => ({}) }, { core: ['001'], optional: { food: ['006'] }, readSql: async (f) => f, log: () => {} })
  assert.deepEqual(r, { food: true })
})
