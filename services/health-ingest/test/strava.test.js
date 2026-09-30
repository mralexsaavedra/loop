import test from 'node:test'
import assert from 'node:assert/strict'
import { createTokenProvider, fetchActivitiesSince, classifyStravaError } from '../src/strava.js'

const okJson = (body) => ({ ok: true, status: 200, json: async () => body })

function tokenResponse (token, secondsFromNow) {
  return okJson({ access_token: token, expires_at: Math.floor(Date.now() / 1000) + secondsFromNow })
}

test('caches the access token until it is close to expiry', async () => {
  let calls = 0
  const getToken = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    refreshToken: 'refresh',
    fetchImpl: async () => { calls += 1; return tokenResponse('tok-1', 3600) }
  })

  assert.equal(await getToken(), 'tok-1')
  assert.equal(await getToken(), 'tok-1')
  assert.equal(calls, 1, 'second call must reuse the cached token')
})

test('refreshes a token that is inside the expiry slack window', async () => {
  let calls = 0
  const getToken = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    refreshToken: 'refresh',
    fetchImpl: async () => { calls += 1; return tokenResponse(`tok-${calls}`, 30) }
  })

  await getToken()
  await getToken()
  assert.equal(calls, 2, 'a token expiring in 30s is within the 60s slack and must refresh')
})

test('throws a clear error when the refresh is rejected', async () => {
  const getToken = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    refreshToken: 'bad',
    fetchImpl: async () => ({ ok: false, status: 401 })
  })

  await assert.rejects(getToken, /token refresh failed: 401/)
})

test('pages until a short batch ends the walk', async () => {
  const pages = [
    Array.from({ length: 100 }, (_, i) => ({ id: i })),
    Array.from({ length: 100 }, (_, i) => ({ id: 100 + i })),
    [{ id: 200 }]
  ]
  let page = 0

  const activities = await fetchActivitiesSince(
    async () => 'tok',
    null,
    async () => okJson(pages[page++])
  )

  assert.equal(activities.length, 201)
  assert.equal(page, 3)
})

test('stops after a single page when the batch is short', async () => {
  let calls = 0
  const activities = await fetchActivitiesSince(
    async () => 'tok',
    null,
    async () => { calls += 1; return okJson([{ id: 1 }, { id: 2 }]) }
  )

  assert.equal(activities.length, 2)
  assert.equal(calls, 1)
})

test('passes the after cursor as a unix timestamp', async () => {
  let seen = null
  await fetchActivitiesSince(
    async () => 'tok',
    1_700_000_000,
    async (url) => { seen = url; return okJson([]) }
  )

  assert.equal(seen.searchParams.get('after'), '1700000000')
  assert.equal(seen.searchParams.get('per_page'), '100')
})

test('flags a rate limit distinctly from other failures', async () => {
  await assert.rejects(
    fetchActivitiesSince(async () => 'tok', null, async () => ({ ok: false, status: 429 })),
    (err) => err.rateLimited === true && /rate limit/.test(err.message)
  )
})

// --- refresh token rotation ------------------------------------------------

function memoryStore (initial = null) {
  const saved = []
  return { saved, load: async () => initial, save: async (token) => { saved.push(token); initial = token } }
}

function rotatingFetch (seen, { rotateTo = null, failFor = [] } = {}) {
  return async (url, init) => {
    const body = JSON.parse(init.body)
    seen.push(body.refresh_token)
    if (failFor.includes(body.refresh_token)) return { ok: false, status: 400 }
    return okJson({
      access_token: `acc-${seen.length}`,
      expires_at: Math.floor(Date.now() / 1000) + 30, // inside the slack: every call refreshes
      ...(rotateTo ? { refresh_token: rotateTo(seen.length) } : {})
    })
  }
}

test('persists a rotated refresh token and uses it on the next refresh', async () => {
  const seen = []
  const store = memoryStore()
  const getToken = createTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'env-token', store,
    fetchImpl: rotatingFetch(seen, { rotateTo: (n) => `rotated-${n}` })
  })

  await getToken()
  await getToken()
  assert.deepEqual(seen, ['env-token', 'rotated-1'], 'the second refresh uses the rotated token, not the env value')
  assert.deepEqual(store.saved, ['rotated-1', 'rotated-2'])
})

test('prefers the stored token over the env value from the first refresh', async () => {
  const seen = []
  const getToken = createTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'env-token', store: memoryStore('stored-token'),
    fetchImpl: rotatingFetch(seen)
  })
  await getToken()
  assert.deepEqual(seen, ['stored-token'])
})

test('an unchanged refresh token is not re-saved', async () => {
  const store = memoryStore('same')
  const getToken = createTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'env-token', store,
    fetchImpl: rotatingFetch([], { rotateTo: () => 'same' })
  })
  await getToken()
  assert.deepEqual(store.saved, [])
})

test('a rejected stored token falls back to the env bootstrap token once', async () => {
  const seen = []
  const store = memoryStore('revoked')
  const getToken = createTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'env-token', store,
    fetchImpl: rotatingFetch(seen, { failFor: ['revoked'], rotateTo: () => 'fresh' }),
    log: () => {}
  })
  assert.equal(await getToken(), 'acc-2')
  assert.deepEqual(seen, ['revoked', 'env-token'])
  assert.deepEqual(store.saved, ['fresh'])
})

test('a rejected env token is not retried', async () => {
  const seen = []
  const getToken = createTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'env-token', store: memoryStore(),
    fetchImpl: rotatingFetch(seen, { failFor: ['env-token'] }),
    log: () => {}
  })
  await assert.rejects(getToken, /token refresh failed: 400/)
  assert.deepEqual(seen, ['env-token'])
})

test('a failing token store never blocks the refresh', async () => {
  const seen = []
  const getToken = createTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'env-token',
    store: { load: async () => { throw new Error('db down') }, save: async () => { throw new Error('db down') } },
    fetchImpl: rotatingFetch(seen, { rotateTo: () => 'rotated' }),
    sleep: async () => {},
    log: () => {}
  })
  assert.equal(await getToken(), 'acc-1')
  await getToken()
  assert.deepEqual(seen, ['env-token', 'rotated'], 'the rotated token is kept in memory even when it cannot be persisted')
})

test('token save is retried up to 3 times with backoff; success reports ok', async () => {
  let attempts = 0
  const waits = []
  const results = []
  const getToken = createTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'env-token',
    store: { load: async () => null, save: async () => { attempts += 1; if (attempts < 3) throw new Error('db blip') } },
    fetchImpl: rotatingFetch([], { rotateTo: () => 'rotated' }),
    sleep: async (ms) => { waits.push(ms) },
    onSaveResult: (ok) => results.push(ok),
    log: () => {}
  })
  await getToken()
  assert.equal(attempts, 3)
  assert.equal(waits.length, 2)
  assert.ok(waits[1] > waits[0], 'backoff grows')
  assert.deepEqual(results, [true])
})

test('token save failing 3 times reports the failure and retries the unsaved token on the next refresh', async () => {
  let failing = true
  const saved = []
  const results = []
  const getToken = createTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'env-token',
    store: { load: async () => null, save: async (t) => { if (failing) throw new Error('db down'); saved.push(t) } },
    fetchImpl: rotatingFetch([], { rotateTo: () => 'rotated' }),
    sleep: async () => {},
    onSaveResult: (ok) => results.push(ok),
    log: () => {}
  })
  await getToken()
  assert.deepEqual(results, [false])
  failing = false
  await getToken() // Strava returns the same 'rotated' token: still saved, because it never was
  assert.deepEqual(saved, ['rotated'])
  assert.deepEqual(results, [false, true])
})

test('a failed store load is retried on the next refresh instead of pinning the env token', async () => {
  const seen = []
  let loads = 0
  const getToken = createTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'env-token',
    store: { load: async () => { loads += 1; if (loads === 1) throw new Error('db down'); return 'stored-token' }, save: async () => {} },
    fetchImpl: rotatingFetch(seen),
    log: () => {}
  })
  await getToken()
  await getToken()
  assert.deepEqual(seen, ['env-token', 'stored-token'])
  assert.equal(loads, 2)
})

test('classifyStravaError maps failures to coarse codes', () => {
  assert.equal(classifyStravaError(new Error('strava token refresh failed: 401')), 'strava_auth')
  assert.equal(classifyStravaError(new Error('strava token refresh failed: 400')), 'strava_auth')
  assert.equal(classifyStravaError(new Error('strava activities failed: 403')), 'strava_auth')
  assert.equal(classifyStravaError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })), 'strava_network')
  assert.equal(classifyStravaError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })), 'strava_network')
  assert.equal(classifyStravaError(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'strava_network')
  assert.equal(classifyStravaError(new Error('strava activities failed: 500')), 'strava_other')
  assert.equal(classifyStravaError(Object.assign(new Error('strava rate limit reached'), { rateLimited: true })), 'strava_other')
  assert.equal(classifyStravaError(undefined), 'strava_other')
})
