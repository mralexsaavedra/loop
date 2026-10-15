import test from 'node:test'
import assert from 'node:assert/strict'
import { createTokenProvider, fetchActivitiesSince, pullActivitiesSince, upsertActivities, classifyStravaError } from '../src/strava.js'

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

test('every Strava request carries a timeout signal (a hung request never blocks the shared sync)', async () => {
  const seen = []
  const getToken = createTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh',
    fetchImpl: async (url, opts) => { seen.push(opts && opts.signal); return tokenResponse('tok', 3600) }
  })
  await getToken()
  await fetchActivitiesSince(async () => 'tok', null, async (url, opts) => { seen.push(opts && opts.signal); return okJson([]) })
  assert.equal(seen.length, 2)
  for (const s of seen) assert.ok(s instanceof AbortSignal, 'an AbortSignal on every fetch')
})

// a regression here would loop forever and eat memory: fail fast instead
test('stops paging after a hard page limit instead of looping forever on full pages', { timeout: 5000 }, async () => {
  let pages = 0
  await assert.rejects(
    fetchActivitiesSince(async () => 'tok', null, async () => { pages += 1; return okJson(Array.from({ length: 100 }, (_, i) => ({ id: i }))) }),
    /strava activities: more than 200 pages/
  )
  assert.equal(pages, 200)
})

// --- incremental pull (C1): ascending pages, each handed over as it arrives ---------------------

test('a first pull (no stored activity) asks for ascending pages from after=0, never an uncursored newest-first walk', async () => {
  let seen = null
  await pullActivitiesSince(async () => 'tok', null, async () => {}, async (url) => { seen = url; return okJson([]) })
  assert.equal(seen.searchParams.get('after'), '0')
})

test('pullActivitiesSince hands every page to onPage before requesting the next one, and returns the total', async () => {
  const events = []
  const pages = [
    Array.from({ length: 100 }, (_, i) => ({ id: i })),
    [{ id: 100 }, { id: 101 }]
  ]
  let n = 0
  const total = await pullActivitiesSince(
    async () => 'tok',
    1_700_000_000,
    async (batch) => { events.push(`saved ${batch.length}`) },
    async (url) => { events.push(`page ${url.searchParams.get('page')}`); return okJson(pages[n++]) }
  )
  assert.equal(total, 102)
  assert.deepEqual(events, ['page 1', 'saved 100', 'page 2', 'saved 2'])
})

test('a 429 partway keeps the pages already handed over (the next run resumes from them)', async () => {
  const saved = []
  let n = 0
  await assert.rejects(
    pullActivitiesSince(async () => 'tok', null, async (batch) => { saved.push(...batch) }, async () => {
      n += 1
      if (n === 3) return { ok: false, status: 429 }
      return okJson(Array.from({ length: 100 }, (_, i) => ({ id: n * 1000 + i })))
    }),
    (err) => err.rateLimited === true
  )
  assert.equal(saved.length, 200, 'pages 1 and 2 were handed over before the rate limit')
})

test('a failing onPage stops the walk (no further page is requested)', async () => {
  let n = 0
  await assert.rejects(
    pullActivitiesSince(async () => 'tok', null, async () => { throw new Error('db down') }, async () => { n += 1; return okJson(Array.from({ length: 100 }, (_, i) => ({ id: i }))) }),
    /db down/
  )
  assert.equal(n, 1)
})

// --- single-flight token refresh (C5) ----------------------------------------------------------

test('two concurrent callers with no valid token trigger ONE refresh and get the same token', async () => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const getToken = createTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh',
    fetchImpl: async () => { calls += 1; await gate; return tokenResponse(`tok-${calls}`, 3600) }
  })
  const a = getToken()
  const b = getToken()
  release()
  assert.deepEqual(await Promise.all([a, b]), ['tok-1', 'tok-1'])
  assert.equal(calls, 1)
})

test('a failed shared refresh rejects every waiting caller and the next call refreshes again', async () => {
  let calls = 0
  const getToken = createTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh',
    fetchImpl: async () => { calls += 1; return calls === 1 ? { ok: false, status: 500 } : tokenResponse('tok', 3600) }
  })
  const results = await Promise.allSettled([getToken(), getToken()])
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected'])
  assert.equal(calls, 1)
  assert.equal(await getToken(), 'tok')
  assert.equal(calls, 2)
})

// --- upsertActivities on a dead connection (C6) ------------------------------------------------

test('a failing ROLLBACK never hides the original error, and the broken client is released as broken', async () => {
  const released = []
  const client = {
    query: async (sql) => {
      if (sql === 'ROLLBACK') throw new Error('Connection terminated')
      if (sql.startsWith('INSERT')) throw new Error('insert failed')
      return { rows: [] }
    },
    release: (err) => { released.push(err) }
  }
  await assert.rejects(upsertActivities({ connect: async () => client }, [{ id: 1, start_date_local: '2030-01-01T00:00:00Z' }]), /insert failed/)
  assert.equal(released.length, 1)
  assert.match(released[0]?.message ?? '', /insert failed/, 'release(err) so the pool discards the client')
})

test('a successful upsert releases the client normally', async () => {
  const released = []
  const client = { query: async () => ({ rows: [] }), release: (err) => { released.push(err) } }
  assert.equal(await upsertActivities({ connect: async () => client }, [{ id: 1, start_date_local: '2030-01-01T00:00:00Z' }]), 1)
  assert.deepEqual(released, [undefined])
})
