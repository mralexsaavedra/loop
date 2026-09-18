import test from 'node:test'
import assert from 'node:assert/strict'
import { createTokenProvider, fetchActivitiesSince } from '../src/strava.js'

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
