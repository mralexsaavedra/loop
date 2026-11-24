/**
 * The Strava activities' persistence (sql/002_strava.sql: strava_activity, strava_sync_state; sql/003_sync.sql: strava_token): the
 * rotated refresh token, the transactional upsert of pulled activities, the newest stored start, a rename's
 * write-back and the /export/strava page (privacy boundary: never `name` or the raw payload). Plain
 * `fn(pool, ...)` functions (and the token store factory); the pull (strava.js), the annotator
 * (strava-annotate.js) and the export handler (export.js) call them. No fetch here.
 */

/** @typedef {import('./db.js').Queryable} Queryable @typedef {import('./db.js').Pool} Pool */
/** The rotated refresh token's store (createTokenStore; strava.js createTokenProvider). @typedef {{ load: () => Promise<string | null>, save: (token: string) => Promise<void> }} TokenStore */
/** One activity as Strava's list returns it, stored whole as the payload (untrusted JSON). @typedef {Record<string, any>} StravaPayload */

/** Persistence for the rotated refresh token (single row, sql/003_sync.sql). */
/** @param {Queryable} pool @returns {TokenStore} */
export function createTokenStore (pool) {
  return {
    async load () {
      const { rows } = await pool.query('SELECT refresh_token FROM strava_token WHERE id = 1')
      return rows[0]?.refresh_token ?? null
    },
    async save (token) {
      await pool.query(
        `INSERT INTO strava_token (id, refresh_token, updated_at) VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET refresh_token = EXCLUDED.refresh_token, updated_at = now()`,
        [token]
      )
    }
  }
}

/** @param {Pick<Pool, 'connect'>} pool @param {StravaPayload[]} activities @returns {Promise<number>} */
export async function upsertActivities (pool, activities) {
  if (activities.length === 0) return 0

  const client = await pool.connect()
  let failure
  try {
    await client.query('BEGIN')
    for (const activity of activities) {
      await client.query(
        `INSERT INTO strava_activity (id, start_local, sport_type, name, payload)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
           SET payload = EXCLUDED.payload,
               name = EXCLUDED.name,
               sport_type = EXCLUDED.sport_type,
               synced_at = now()`,
        [
          // id_str: Strava ids can exceed 2^53 (64-bit from 2027-06-01) and JSON.parse rounds those numbers
          activity.id_str ?? String(activity.id),
          activity.start_date_local,
          activity.sport_type ?? activity.type ?? 'Unknown',
          activity.name ?? null,
          activity
        ]
      )
    }
    await client.query('UPDATE strava_sync_state SET last_synced_at = now() WHERE id = 1')
    await client.query('COMMIT')
  } catch (err) {
    failure = err
    // on a dead connection the ROLLBACK throws too: never let it hide the original error
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    // release(err) makes the pool discard a client that failed mid-transaction instead of reusing it
    client.release(failure)
  }

  return activities.length
}

/** The newest stored start (a `timestamp` column: a Date from pg), or null when nothing is stored. @param {Queryable} pool @returns {Promise<Date | string | null>} */
export async function lastSyncedStart (pool) {
  const { rows } = await pool.query('SELECT MAX(start_local) AS newest FROM strava_activity')
  return rows[0]?.newest ?? null
}

/** Keeps the stored row's name in step after a rename on Strava (strava-annotate.js). */
/** @param {Queryable} pool @param {string | number} id @param {string} name */
export async function renameStoredActivity (pool, id, name) {
  await pool.query(
    `UPDATE strava_activity SET name = $2, payload = jsonb_set(payload, '{name}', to_jsonb($2::text)) WHERE id = $1`,
    [String(id), name]
  )
}

/**
 * `start_local` is read from the JSONB payload, not the `start_local` column:
 * the upsert in strava.js never refreshes that column on an edit, so it can
 * go stale. The numeric fields go through `payload->'field'` (jsonb), which
 * never raises a cast error even if a field is absent (`suffer_score` = Strava
 * Relative Effort; both it and `kilojoules` are null when the activity has none;
 * `total_elevation_gain` is metres climbed, null on activities without it; `start_utc` is
 * Strava's UTC `start_date`, which with `start_local` gives the UTC offset of the ride window;
 * `device_watts` is true only when the watts came from a real power meter, not Strava's
 * estimate — the local power-meter energy correction needs both; `trainer` is Strava's indoor flag
 * (a trainer ride, filed as IndoorCycling by the repo); `hr_hist` = seconds per whole bpm
 * from the activity's HR stream (hr-zones.js, sql/008_strava_hr.sql), null until the backfill has
 * reached it or when it has no HR — the repo cuts the HR zones from it). `name` and the raw
 * payload are never selected — privacy boundary for this endpoint.
 * @param {Queryable} pool @param {{ sinceId: string, limit: number }} page
 */
export async function listStravaActivities (pool, { sinceId, limit }) {
  const { rows } = await pool.query(
    `SELECT id::text AS id,
            payload->>'start_date_local' AS start_local,
            sport_type,
            payload->'moving_time' AS moving_time,
            payload->'elapsed_time' AS elapsed_time,
            payload->'distance' AS distance,
            payload->'average_heartrate' AS average_heartrate,
            payload->'max_heartrate' AS max_heartrate,
            payload->'suffer_score' AS suffer_score,
            payload->'kilojoules' AS kilojoules,
            payload->'total_elevation_gain' AS total_elevation_gain,
            payload->>'start_date' AS start_utc,
            payload->'device_watts' AS device_watts,
            payload->'trainer' AS trainer,
            (SELECT h.hr_hist FROM strava_activity_hr h
              WHERE h.activity_id = strava_activity.id AND h.status = 'ok') AS hr_hist
       FROM strava_activity
      WHERE id > $1
      ORDER BY id ASC
      LIMIT $2`,
    [sinceId, limit]
  )
  return rows
}
