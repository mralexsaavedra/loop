/**
 * Runs the sql/ migrations. CORE files must all succeed (the ingest endpoints, /sync and the Strava
 * loop need their tables), so a failure there still fails the start. OPTIONAL groups (the food log)
 * are isolated: a failure is logged (`<group>_migration_failed`, message only, never data) and that
 * group is reported unavailable, so the rest of the service keeps running and the group's routes
 * answer 503 (see food.js). Kept apart from db.js, which loads the pg driver, so it can be tested.
 * Every file is idempotent and runs on every start (no applied-migrations table): a rollout is just a
 * restart. A new sql/ file must be listed below; test/migrations.test.js fails if one is missing.
 */

export const CORE_MIGRATIONS = ['001_init.sql', '002_strava.sql', '003_sync.sql', '004_athlete.sql', '005_athlete_refresh.sql', '008_strava_hr.sql', '009_strava_hr_retry.sql']
// optional groups: a failure disables only that feature (its routes answer 503)
export const OPTIONAL_MIGRATIONS = { food: ['006_food.sql'], settings: ['007_settings.sql', '011_profile.sql'], journal: ['010_journal.sql'] }

export async function runMigrations (pool, { core, optional = {}, readSql, log = console.log }) {
  for (const file of core) await pool.query(await readSql(file))
  const available = {}
  for (const [group, files] of Object.entries(optional)) {
    try {
      for (const file of files) await pool.query(await readSql(file))
      available[group] = true
    } catch (err) {
      available[group] = false
      log(JSON.stringify({ event: `${group}_migration_failed`, message: err.message }))
    }
  }
  return available
}
