/**
 * The Strava athlete snapshot's persistence (sql/004_athlete.sql + 005_athlete_refresh.sql: the single strava_athlete row) and the
 * reads over stored activities it needs (devices, gear ids). Plain `fn(pool, ...)` functions, the convention of
 * the Strava modules; the refresher and the /export/athlete handler (athlete.js) call them. No fetch here.
 */

/** @typedef {import('./db.js').Queryable} Queryable */
/**
 * The snapshot to store: Strava's athlete payload (untrusted JSON) and the shaped gear (athlete.js buildGear).
 * @typedef {{ athlete: Record<string, any> | null | undefined, gear: { bikes: object[], shoes: object[] } | null | undefined,
 *   gearScopeMissing: boolean, gearPartial?: boolean }} AthleteSnapshot
 */
/** One device seen on stored activities. @typedef {{ name: string, count: number, lastUsed: string | null }} Device */

/** @param {Queryable} pool @param {AthleteSnapshot} snapshot */
export async function saveAthlete (pool, { athlete, gear, gearScopeMissing, gearPartial = false }) {
  await pool.query(
    `INSERT INTO strava_athlete (id, fetched_at, athlete, gear, gear_scope_missing, gear_partial, last_ok_at, last_failure_at)
     VALUES (1, now(), $1, $2, $3, $4, now(), NULL)
     ON CONFLICT (id) DO UPDATE
       SET fetched_at = now(), athlete = EXCLUDED.athlete, gear = EXCLUDED.gear,
           gear_scope_missing = EXCLUDED.gear_scope_missing, gear_partial = EXCLUDED.gear_partial,
           last_ok_at = now(), last_failure_at = NULL`,
    // stringified: node-postgres would turn a JS array into a PG array literal, not JSON
    [JSON.stringify(athlete ?? {}), JSON.stringify(gear ?? { bikes: [], shoes: [] }), Boolean(gearScopeMissing), Boolean(gearPartial)]
  )
}

/** Stamps a failed refresh; before any snapshot exists it creates a row with no snapshot (fetched_at NULL). @param {Queryable} pool @param {number} at epoch ms */
export async function recordAthleteFailure (pool, at) {
  await pool.query(
    `INSERT INTO strava_athlete (id, fetched_at, athlete, last_failure_at) VALUES (1, NULL, '{}', $1)
     ON CONFLICT (id) DO UPDATE SET last_failure_at = EXCLUDED.last_failure_at`,
    [new Date(at).toISOString()]
  )
}

/** The snapshot row, or null (untyped: toAthleteExport re-reads every field). @param {Queryable} pool @returns {Promise<Record<string, any> | null>} */
export async function loadAthlete (pool) {
  const { rows } = await pool.query('SELECT fetched_at, athlete, gear, gear_scope_missing, gear_partial, last_ok_at, last_failure_at FROM strava_athlete WHERE id = 1')
  return rows[0] ?? null
}

/** Devices seen on stored activities (Strava's `device_name`), newest use first. @param {Queryable} pool @returns {Promise<Device[]>} */
export async function listDevices (pool) {
  const { rows } = await pool.query(
    `SELECT payload->>'device_name' AS name, count(*)::int AS count, max(payload->>'start_date_local') AS last
       FROM strava_activity
      WHERE coalesce(payload->>'device_name', '') <> ''
      GROUP BY 1
      ORDER BY 3 DESC, 1 ASC`
  )
  return rows.map((r) => ({ name: r.name, count: Number(r.count) || 0, lastUsed: typeof r.last === 'string' ? r.last.slice(0, 10) : null }))
}

/** Gear ids referenced by stored activities. @param {Queryable} pool @returns {Promise<string[]>} */
export async function activityGearIds (pool) {
  const { rows } = await pool.query(
    `SELECT DISTINCT payload->>'gear_id' AS id
       FROM strava_activity
      WHERE coalesce(payload->>'gear_id', '') <> ''
      ORDER BY 1`
  )
  return rows.map((r) => r.id)
}
