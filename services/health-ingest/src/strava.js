const TOKEN_URL = 'https://www.strava.com/oauth/token'
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities'
const PAGE_SIZE = 100
// a hung request must never block the shared sync run (POST /sync, the timer and /sync/strava join it)
const FETCH_TIMEOUT_MS = 15_000
// 200 x 100 = 20,000 activities: decades of history even on a first pull (no cursor); more means a broken cursor
const MAX_PAGES = 200

/**
 * Strava access tokens live ~6 hours and stay in memory. The refresh token is
 * the durable credential, and Strava may ROTATE it on any refresh: the token
 * endpoint then returns a new `refresh_token` and the old one stops working
 * later. The rotated value is persisted through `store` (the single-row
 * `strava_token` table, see createTokenStore) and preferred over the env
 * value, which stays the bootstrap. If the stored token is rejected (e.g. the
 * owner re-authorized and put a new token in .env), the env token is tried
 * once.
 *
 * Store failures never block a refresh, and never silently lose a rotation:
 *   - a failed load is retried on the next refresh (the env token is used
 *     meanwhile, but is not pinned as "the stored one");
 *   - a save is retried SAVE_ATTEMPTS times with growing backoff; if it still
 *     fails the rotated token is kept in memory, `onSaveResult(false)` is
 *     reported (status code strava_token_save) and the save is tried again on
 *     the next refresh even if Strava does not rotate again.
 */
const SAVE_ATTEMPTS = 3
const SAVE_BACKOFF_MS = 250
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function createTokenProvider ({
  clientId,
  clientSecret,
  refreshToken,
  store = null,
  fetchImpl = fetch,
  sleep = delay,
  onSaveResult = null,
  log = console.log
}) {
  let accessToken = null
  let expiresAt = 0
  let current = null // from a successful store load or a rotation
  let loaded = false // true only after a store load SUCCEEDED
  let unsaved = null // a rotated token whose save failed

  async function loadCurrent () {
    if (current) return current
    if (!store || loaded) return refreshToken
    try {
      const stored = await store.load()
      loaded = true
      if (stored) current = stored
    } catch (err) {
      log(JSON.stringify({ event: 'strava_token_load_failed', message: err.message }))
    }
    return current || refreshToken
  }

  async function saveWithRetry (token) {
    for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
      try {
        await store.save(token)
        return true
      } catch (err) {
        log(JSON.stringify({ event: 'strava_token_save_failed', attempt, message: err.message }))
        if (attempt < SAVE_ATTEMPTS) await sleep(SAVE_BACKOFF_MS * 2 ** (attempt - 1))
      }
    }
    return false
  }

  function requestToken (token) {
    return fetchImpl(TOKEN_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
    if (rotated) current = rotated
    else if (loaded || used !== refreshToken) current = used

    if (rotated && store && (rotated !== used || unsaved === rotated)) {
      const ok = await saveWithRetry(rotated)
      unsaved = ok ? null : rotated
      try { await onSaveResult?.(ok) } catch {}
    }
    return accessToken
  }
}

const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET'])

/**
 * Coarse, non-sensitive code for a failed pull (GET /sync/status exposes only
 * this; the message stays in the logs): strava_auth (the token or the grant
 * was rejected), strava_network (could not reach Strava), strava_other.
 */
export function classifyStravaError (err) {
  if (!err) return 'strava_other'
  const message = String(err.message ?? '')
  if (/token refresh failed: (400|401|403)\b/.test(message) || /activities failed: (401|403)\b/.test(message)) return 'strava_auth'
  const code = err.code ?? err.cause?.code
  if (err.name === 'AbortError' || err.name === 'TimeoutError' || NETWORK_CODES.has(code) || (err.name === 'TypeError' && /fetch failed/.test(message))) {
    return 'strava_network'
  }
  return 'strava_other'
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
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })

    if (res.status === 429) {
      const err = new Error('strava rate limit reached')
      err.rateLimited = true
      throw err
    }
    if (!res.ok) throw new Error(`strava activities failed: ${res.status}`)

    const batch = await res.json()
    collected.push(...batch)
    if (batch.length < PAGE_SIZE) return collected
    if (page >= MAX_PAGES) throw new Error(`strava activities: more than ${MAX_PAGES} pages`)

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
