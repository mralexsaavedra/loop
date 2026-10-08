import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createJournalStore } from '../src/journal-db.js'

function fakePool (handler = () => ({ rows: [] })) {
  const calls = []
  return { calls, query: async (sql, values) => { calls.push({ sql, values }); return handler(sql, values) } }
}

test('migration 010_journal.sql is its own optional group and is idempotent', async () => {
  const db = await readFile(fileURLToPath(new URL('../src/db.js', import.meta.url)), 'utf8')
  assert.match(db, /journal: \['010_journal\.sql'\]/)
  const sql = await readFile(fileURLToPath(new URL('../sql/010_journal.sql', import.meta.url)), 'utf8')
  for (const table of ['journal_day', 'journal_settings']) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`))
  assert.doesNotMatch(sql, /CREATE TABLE (?!IF NOT EXISTS)/)
})

test('getDay maps the row (date string, ISO timestamp); a missing day is null', async () => {
  const pool = fakePool(() => ({ rows: [{ date: '2030-01-10', answers: { nap: true }, notes: null, updated_at: new Date('2030-01-10T21:00:00Z') }] }))
  const d = await createJournalStore(pool).getDay('2030-01-10')
  assert.deepEqual(d, { date: '2030-01-10', answers: { nap: true }, notes: null, updatedAt: '2030-01-10T21:00:00.000Z' })
  assert.deepEqual(pool.calls[0].values, ['2030-01-10'])
  assert.equal(await createJournalStore(fakePool()).getDay('2030-01-10'), null)
})

test('putDay is a parameterized upsert on the date; answers sent as JSON text', async () => {
  const pool = fakePool(() => ({ rows: [{ date: '2030-01-10', answers: { alcohol: 1 }, notes: "O'Brien", updated_at: null }] }))
  await createJournalStore(pool).putDay({ date: '2030-01-10', answers: { alcohol: 1 }, notes: "O'Brien" })
  assert.match(pool.calls[0].sql, /ON CONFLICT \(date\) DO UPDATE/)
  assert.doesNotMatch(pool.calls[0].sql, /O'Brien/)
  assert.deepEqual(pool.calls[0].values, ['2030-01-10', '{"alcohol":1}', "O'Brien"])
})

test('disabled list: none without a row; setDisabled upserts the one row', async () => {
  assert.deepEqual(await createJournalStore(fakePool()).getDisabled(), [])
  const pool = fakePool(() => ({ rows: [{ disabled: ['nap'] }] }))
  assert.deepEqual(await createJournalStore(pool).setDisabled(['nap']), ['nap'])
  assert.match(pool.calls[0].sql, /ON CONFLICT \(id\) DO UPDATE/)
})
