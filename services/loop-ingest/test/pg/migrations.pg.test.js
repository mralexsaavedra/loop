/**
 * The real migrations (sql/) on a real Postgres: an empty database, a pre-ledger install with data, a
 * second boot, an edited migration and two processes booting at once. Skips without TEST_DATABASE_URL.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { skip, freshDatabase } from './pg-helper.js'
import { createPool, migrate } from '../../src/db.js'
import { CORE_MIGRATIONS, OPTIONAL_MIGRATIONS, checksum } from '../../src/migrations.js'

const ALL = [...CORE_MIGRATIONS, ...Object.values(OPTIONAL_MIGRATIONS).flat()]
const readSql = (f) => readFile(new URL(`../../sql/${f}`, import.meta.url), 'utf8')
const quiet = () => {}

async function withDb (fn) {
  const db = await freshDatabase()
  const pool = createPool(db.url, { log: quiet })
  try { await fn(pool, db) } finally { await pool.end(); await db.drop() }
}
async function ledger (pool) {
  const { rows } = await pool.query('SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name')
  return rows
}

test('an empty database: every migration runs once, every group is available, the ledger holds each file with its checksum', { skip }, () => withDb(async (pool) => {
  const events = []
  const available = await migrate(pool, (l) => events.push(JSON.parse(l)))
  assert.deepEqual(available, { food: true, settings: true, profile: true, journal: true })
  assert.deepEqual(events.map((e) => e.file).sort(), [...ALL].sort())
  const rows = await ledger(pool)
  assert.deepEqual(rows.map((r) => r.name), [...ALL].sort())
  for (const r of rows) assert.equal(r.checksum, checksum(await readSql(r.name)), r.name)
  for (const t of ['raw_payload', 'strava_activity', 'sync_status', 'strava_athlete', 'food_product', 'food_log', 'app_settings', 'strava_activity_hr', 'journal_day', 'app_profile']) {
    const { rows: [{ ok }] } = await pool.query('SELECT to_regclass($1) IS NOT NULL AS ok', [t])
    assert.equal(ok, true, t)
  }
}))

test('a second boot runs nothing: 009 no longer re-creates its CHECK on every start', { skip }, () => withDb(async (pool) => {
  await migrate(pool, quiet)
  const oid = async () => (await pool.query("SELECT oid FROM pg_constraint WHERE conname = 'strava_activity_hr_status_check'")).rows[0].oid
  const before = await oid()
  const events = []
  assert.deepEqual(await migrate(pool, (l) => events.push(l)), { food: true, settings: true, profile: true, journal: true })
  assert.deepEqual(events, [], 'nothing applied')
  assert.equal(await oid(), before, 'the constraint was not dropped and re-added')
}))

test('an install from before the ledger (every file applied, none recorded, data in the tables): first boot keeps every row and fills the ledger', { skip }, () => withDb(async (pool) => {
  // what the pre-ledger service did on every boot: run each file, record nothing
  for (const f of ALL) await pool.query(await readSql(f))
  await pool.query("INSERT INTO raw_payload (source, byte_size, payload) VALUES ('health-auto-export', 2, '{}')")
  await pool.query("INSERT INTO strava_activity (id, start_local, sport_type, payload) VALUES (42, '2026-10-01T08:00:00', 'Ride', '{\"has_heartrate\": true}')")
  await pool.query("INSERT INTO strava_activity_hr (activity_id, status, attempts) VALUES (42, 'retry', 2)")
  await pool.query("INSERT INTO food_product (name, store, unit, kcal_100, protein_100, carbs_100, fat_100, source) VALUES ('Oats', 'other', 'g', 370, 13, 60, 7, 'manual')")
  await pool.query("INSERT INTO food_log (date, meal, ref_type, label, amount, unit, kcal) VALUES ('2026-10-01', 'breakfast', 'quick', 'Coffee', 1, 'serving', 5)")
  await pool.query("INSERT INTO app_settings (id, goal, target_weight_kg) VALUES (1, 'cut', 70)")
  await pool.query("INSERT INTO journal_day (date, answers) VALUES ('2026-10-01', '{\"alcohol\": 0}')")
  await pool.query('INSERT INTO app_profile (id, data) VALUES (1, \'{"sex": "m"}\')')
  await pool.query('UPDATE sync_status SET trigger_seq = 17 WHERE id = 1')
  const counts = async () => (await pool.query(`SELECT
      (SELECT count(*) FROM raw_payload)::int AS raw, (SELECT count(*) FROM strava_activity)::int AS strava,
      (SELECT count(*) FROM strava_activity_hr WHERE status = 'retry' AND attempts = 2)::int AS hr,
      (SELECT count(*) FROM food_product)::int AS products, (SELECT count(*) FROM food_log)::int AS log,
      (SELECT goal FROM app_settings) AS goal, (SELECT count(*) FROM journal_day)::int AS journal,
      (SELECT data->>'sex' FROM app_profile) AS sex, (SELECT trigger_seq FROM sync_status)::int AS seq`)).rows[0]
  const before = await counts()
  assert.deepEqual(before, { raw: 1, strava: 1, hr: 1, products: 1, log: 1, goal: 'cut', journal: 1, sex: 'm', seq: 17 })

  assert.deepEqual(await migrate(pool, quiet), { food: true, settings: true, profile: true, journal: true })
  assert.deepEqual(await counts(), before, 'every row survives')
  assert.deepEqual((await ledger(pool)).map((r) => r.name), [...ALL].sort(), 'the ledger is filled')
}))

test('an applied migration edited afterwards refuses the start with a clear message', { skip }, () => withDb(async (pool) => {
  await migrate(pool, quiet)
  await pool.query("UPDATE schema_migrations SET checksum = 'edited' WHERE name = '009_strava_hr_retry.sql'")
  await assert.rejects(migrate(pool, quiet), (err) => {
    assert.equal(err.code, 'migration_checksum_mismatch')
    assert.match(err.message, /009_strava_hr_retry\.sql was changed after it was applied/)
    assert.match(err.message, /never edit an applied migration; add a new sql\/ file instead/)
    return true
  })
  const { rows: [{ locks }] } = await pool.query("SELECT count(*)::int AS locks FROM pg_locks WHERE locktype = 'advisory'")
  assert.equal(locks, 0, 'the advisory lock was released')
}))

test('two processes booting at once on an empty database: the advisory lock serialises them, each file applied exactly once', { skip }, () => withDb(async (pool, db) => {
  const other = createPool(db.url, { log: quiet })
  try {
    const applied = []
    const log = (l) => { const e = JSON.parse(l); if (e.event === 'migration_applied') applied.push(e.file) }
    const results = await Promise.all([migrate(pool, log), migrate(other, log), migrate(pool, log)])
    for (const r of results) assert.deepEqual(r, { food: true, settings: true, profile: true, journal: true })
    assert.deepEqual([...applied].sort(), [...ALL].sort(), 'no file ran twice')
    assert.equal((await ledger(pool)).length, ALL.length)
  } finally { await other.end() }
}))
