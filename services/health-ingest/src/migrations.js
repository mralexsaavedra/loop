/**
 * Runs the sql/ migrations. CORE files must all succeed (the ingest endpoints, /sync and the Strava
 * loop need their tables), so a failure there still fails the start. OPTIONAL groups (the food log)
 * are isolated: a failure is logged (`<group>_migration_failed`, message only, never data) and that
 * group is reported unavailable, so the rest of the service keeps running and the group's routes
 * answer 503 (see food.js). Kept apart from db.js, which loads the pg driver, so it can be tested.
 */
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
