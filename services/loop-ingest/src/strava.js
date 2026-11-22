const TOKEN_URL = 'https://www.strava.com/oauth/token'
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities'
const PAGE_SIZE = 100
// a hung request must never block the shared sync run (POST /sync, the timer and /sync/strava join it)
const FETCH_TIMEOUT_MS = 15_000
// 200 x 100 = 20,000 activities per run: decades of history even on a first pull; more means a broken cursor.
// Every page is stored as it arrives (pullActivitiesSince), so even hitting this cap keeps the progress.
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

  async function refresh () {
    let used = await loadCurrent()
    let res = await requestToken(used)
    if (!res.ok && (res.status === 400 || res.status === 401) && used !== refreshToken) {
      log(JSON.stringify({ event: 'strava_stored_token_rejected', status: res.status }))
      used = refreshToken
      res = await requestToken(used)
    }

    if (!res.ok) throw new Error(`strava token refresh failed: ${res.status}`)

    const body = /** @type {{ access_token: string, expires_at: number, refresh_token?: string }} */ (await res.json())
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

  // Single flight: callers that find no valid token while a refresh is running (the activity pull, the
  // athlete refresh and the HR backfill share this provider) wait for THAT refresh instead of starting
  // their own, so a rotating refresh token is never spent twice.
  let inflight = null
  return function getAccessToken () {
    // 60s of slack so a token cannot expire mid-request.
    if (accessToken && Date.now() < expiresAt - 60_000) return Promise.resolve(accessToken)
    if (!inflight) inflight = refresh().finally(() => { inflight = null })
    return inflight
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

/**
 * Walk /athlete/activities from `sinceEpochSeconds` (a unix timestamp; 0 when nothing is stored yet). With
 * `after` set Strava returns the activities ASCENDING, so every page is handed to `onPage` (awaited) before
 * the next one is requested: the caller stores it right away, and a rate limit (429) or any failure partway
 * keeps everything already stored. The next run then resumes from the newest stored activity instead of
 * starting over, so a long first history completes over a few runs. Resolves the number of activities.
 */
export async function pullActivitiesSince (getAccessToken, sinceEpochSeconds, onPage, fetchImpl = fetch) {
  let total = 0
  let page = 1

  while (true) {
    const url = new URL(ACTIVITIES_URL)
    url.searchParams.set('per_page', String(PAGE_SIZE))
    url.searchParams.set('page', String(page))
    url.searchParams.set('after', String(sinceEpochSeconds ?? 0))

    const token = await getAccessToken()
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })

    if (res.status === 429) {
      throw Object.assign(new Error('strava rate limit reached'), { rateLimited: true })
    }
    if (!res.ok) throw new Error(`strava activities failed: ${res.status}`)

    const batch = /** @type {object[]} */ (await res.json())
    if (batch.length > 0) await onPage(batch)
    total += batch.length
    if (batch.length < PAGE_SIZE) return total
    if (page >= MAX_PAGES) throw new Error(`strava activities: more than ${MAX_PAGES} pages`)

    page += 1
  }
}

/** pullActivitiesSince, collected into one array (no incremental storage). */
export async function fetchActivitiesSince (getAccessToken, sinceEpochSeconds, fetchImpl = fetch) {
  const collected = []
  await pullActivitiesSince(getAccessToken, sinceEpochSeconds, (batch) => { collected.push(...batch) }, fetchImpl)
  return collected
}

// the persistence moved to strava-db.js; its functions keep their historical import path
export { createTokenStore, upsertActivities, lastSyncedStart } from './strava-db.js'
