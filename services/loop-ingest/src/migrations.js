/**
 * Runs the sql/ migrations. CORE files must all succeed (the ingest endpoints, /sync and the Strava
 * loop need their tables), so a failure there still fails the start. OPTIONAL groups (the food log)
 * are isolated: a failure is logged (`<group>_migration_failed`, message only, never data) and that
 * group is reported unavailable, so the rest of the service keeps running and the group's routes
 * answer 503 (see food.js). Kept apart from db.js, which loads the pg driver, so it can be tested.
 *
 * Ledger: `schema_migrations` (name, checksum, applied_at) records every file that ran, so a file runs
 * ONCE: each pending file runs in its own transaction together with its ledger row, so it is either
 * applied and recorded or neither. The whole run holds a session advisory lock (MIGRATION_LOCK_KEY),
 * so two processes never migrate at once; the second waits, then finds everything recorded. An
 * install from before the ledger has every file applied but none recorded: they run once more (each is
 * idempotent: IF NOT EXISTS, ON CONFLICT DO NOTHING, a CHECK dropped then re-created) and are recorded.
 * The run (lock wait included) has no statement_timeout; the pooled client gets the pool's back afterwards.
 * RULE: never edit an applied migration; add a new sql/ file. A recorded file whose content changed
 * (sha-256 of the text, line endings normalised) refuses the start before anything runs.
 * A new sql/ file must be listed below; test/migrations.test.js fails if one is missing.
 */
import { createHash } from 'node:crypto'

export const CORE_MIGRATIONS = ['001_init.sql', '002_strava.sql', '003_sync.sql', '004_athlete.sql', '005_athlete_refresh.sql', '008_strava_hr.sql', '009_strava_hr_retry.sql']
// optional groups: a failure disables only that feature (its routes answer 503)
export const OPTIONAL_MIGRATIONS = { food: ['006_food.sql'], settings: ['007_settings.sql'], profile: ['011_profile.sql'], journal: ['010_journal.sql'], documents: ['012_documents.sql'] }

/** pg_advisory_lock key of the migration run ('LOOP' as a 32-bit integer). */
export const MIGRATION_LOCK_KEY = 0x4c4f4f50

const LEDGER_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT         PRIMARY KEY,
  checksum    TEXT         NOT NULL,
  applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
)`

/** sha-256 (hex) of a migration's text; CRLF counts as LF, so a Windows checkout is the same file. */
export function checksum (sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
}

async function applyOne (client, file, sql) {
  await client.query('BEGIN')
  try {
    await client.query(sql)
    await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum(sql)])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  }
}

export async function runMigrations (pool, { core, optional = {}, readSql, log = console.log }) {
  const client = await pool.connect()
  let broken
  try {
    // The pool's 30 s statement_timeout (db.js) is for requests: a migration rewriting a big table, or the
    // wait for another process's lock, may take longer. Off for this session, restored before release.
    await client.query('SET statement_timeout = 0')
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    try {
      return await migrateLocked(client, { core, optional, readSql, log })
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {})
    }
  } finally {
    // RESET = the connection's startup value (the pool's 30 s); if even that fails, destroy the client
    await client.query('RESET statement_timeout').catch((err) => { broken = err })
    client.release(broken)
  }
}

async function migrateLocked (client, { core, optional, readSql, log }) {
  await client.query(LEDGER_SQL)
  const { rows } = await client.query('SELECT name, checksum FROM schema_migrations')
  const applied = new Map(rows.map((r) => [r.name, r.checksum]))
  const sqlOf = new Map()
  for (const file of [...core, ...Object.values(optional).flat()]) {
    const sql = await readSql(file)
    if (applied.has(file) && applied.get(file) !== checksum(sql)) {
      throw Object.assign(new Error(`migration ${file} was changed after it was applied (checksum differs from schema_migrations); ` +
        'never edit an applied migration; add a new sql/ file instead (restore the original file to start)'), { code: 'migration_checksum_mismatch' })
    }
    sqlOf.set(file, sql)
  }
  const pending = (files) => files.filter((f) => !applied.has(f))
  const run = async (file) => {
    await applyOne(client, file, sqlOf.get(file))
    log(JSON.stringify({ event: 'migration_applied', file }))
  }

  for (const file of pending(core)) await run(file)
  const available = {}
  for (const [group, files] of Object.entries(optional)) {
    try {
      for (const file of pending(files)) await run(file)
      available[group] = true
    } catch (err) {
      available[group] = false
      log(JSON.stringify({ event: `${group}_migration_failed`, message: err.message }))
    }
  }
  return available
}
