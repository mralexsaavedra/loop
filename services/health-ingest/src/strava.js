const TOKEN_URL = 'https://www.strava.com/oauth/token'
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities'
const PAGE_SIZE = 100

/**
 * Strava access tokens live ~6 hours and stay in memory. The refresh token is
 * the durable credential, and Strava may ROTATE it on any refresh: the token
 * endpoint then returns a new `refresh_token` and the old one stops working
 * later. The rotated value is persisted through `store` (the single-row
 * `strava_token` table, see createTokenStore) and preferred over the env
 * value, which stays the bootstrap. If the stored token is rejected (e.g. the
 * owner re-authorized and put a new token in .env), the env token is tried
 * once. A failing store never blocks a refresh: the rotated token is still
 * kept in memory.
 */
export function createTokenProvider ({ clientId, clientSecret, refreshToken, store = null, fetchImpl = fetch, log = console.log }) {
  let accessToken = null
  let expiresAt = 0
  let current = null
  let loaded = false

  async function loadCurrent () {
    if (loaded) return current
    loaded = true
    try {
      current = (store && await store.load()) || null
    } catch (err) {
      log(JSON.stringify({ event: 'strava_token_load_failed', message: err.message }))
    }
    current = current || refreshToken
    return current
  }

  function requestToken (token) {
    return fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: token
      })
    })
  }

  return async function getAccessToken () {
    // 60s of slack so a token cannot expire mid-request.
    if (accessToken && Date.now() < expiresAt - 60_000) return accessToken

    let used = await loadCurrent()
    let res = await requestToken(used)
    if (!res.ok && (res.status === 400 || res.status === 401) && used !== refreshToken) {
      log(JSON.stringify({ event: 'strava_stored_token_rejected', status: res.status }))
      used = refreshToken
      res = await requestToken(used)
    }

    if (!res.ok) throw new Error(`strava token refresh failed: ${res.status}`)

    const body = await res.json()
    accessToken = body.access_token
    expiresAt = body.expires_at * 1000

    const rotated = body.refresh_token
    current = rotated || used
    if (rotated && rotated !== used && store) {
      try {
        await store.save(rotated)
      } catch (err) {
        log(JSON.stringify({ event: 'strava_token_save_failed', message: err.message }))
      }
    }
    return accessToken
  }
}

/** Persistence for the rotated refresh token (single row, sql/003_sync.sql). */
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

/**
 * Walk /athlete/activities newest-first, stopping once we reach activities we
 * already hold. `after` is a unix timestamp; Strava returns them ascending when
 * it is set, so we page until exhausted.
 */
export async function fetchActivitiesSince (getAccessToken, sinceEpochSeconds, fetchImpl = fetch) {
  const collected = []
  let page = 1

  while (true) {
    const url = new URL(ACTIVITIES_URL)
    url.searchParams.set('per_page', String(PAGE_SIZE))
    url.searchParams.set('page', String(page))
    if (sinceEpochSeconds) url.searchParams.set('after', String(sinceEpochSeconds))

    const token = await getAccessToken()
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } })

    if (res.status === 429) {
      const err = new Error('strava rate limit reached')
      err.rateLimited = true
      throw err
    }
    if (!res.ok) throw new Error(`strava activities failed: ${res.status}`)

    const batch = await res.json()
    collected.push(...batch)
    if (batch.length < PAGE_SIZE) return collected

    page += 1
  }
}

export async function upsertActivities (pool, activities) {
  if (activities.length === 0) return 0

  const client = await pool.connect()
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
          activity.id,
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
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return activities.length
}

export async function lastSyncedStart (pool) {
  const { rows } = await pool.query('SELECT MAX(start_local) AS newest FROM strava_activity')
  return rows[0]?.newest ?? null
}
