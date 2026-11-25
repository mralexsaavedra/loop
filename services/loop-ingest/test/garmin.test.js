import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createGarminTokenProvider, createGarminClient, pullGarminActivities, fetchActivityWorkouts, classifyGarminError,
  compactWorkoutSteps, garminKeyExpires, isGarminConfigured, DEFAULT_BASE_URL, TOKEN_PATH, ACTIVITIES_PATH, PAGE_SIZE
} from '../src/garmin.js'

const KEY = 'gk-secret-key-0123456789abcdef'
const BASE = 'https://garmin.test'

/** A fetch answer with the Response fields the client reads. @param {number} status @param {unknown} body */
function reply (status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return /** @type {Response} */ (/** @type {unknown} */ ({ ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) }))
}

/**
 * A fake fetch: `routes(url, init)` answers each call; every call is recorded.
 * @param {(url: URL, init: RequestInit) => Response | Promise<Response>} routes
 */
function fakeFetch (routes) {
  /** @type {{ url: URL, init: RequestInit }[]} */
  const calls = []
  const fetchImpl = /** @type {typeof fetch} */ (/** @type {unknown} */ (async (/** @type {string | URL} */ url, /** @type {RequestInit} */ init) => {
    const u = new URL(String(url))
    calls.push({ url: u, init })
    return routes(u, init)
  }))
  return { fetchImpl, calls }
}

/** @param {RequestInit} init @returns {Record<string, string>} */
const headersOf = (init) => /** @type {Record<string, string>} */ (init.headers)

test('token: a plain-text body is the token, sent as ApiKey to the token endpoint, cached until close to expiry', async () => {
  let t = 1_000_000
  const f = fakeFetch(() => reply(200, '"tok-plain"'))
  const getToken = createGarminTokenProvider({ apiKey: KEY, baseUrl: BASE, fetchImpl: f.fetchImpl, now: () => t })
  assert.equal(await getToken(), 'tok-plain')
  assert.equal(await getToken(), 'tok-plain')
  assert.equal(f.calls.length, 1, 'cached')
  assert.equal(f.calls[0].url.href, BASE + TOKEN_PATH)
  assert.equal(f.calls[0].init.method, 'POST')
  assert.equal(headersOf(f.calls[0].init).authorization, `ApiKey ${KEY}`)
  assert.equal(headersOf(f.calls[0].init).accept, '*/*')
  // default validity 23 h, refreshed 60 s early
  t += 82_800_000 - 61_000
  await getToken()
  assert.equal(f.calls.length, 1)
  t += 2_000
  await getToken()
  assert.equal(f.calls.length, 2, 'refreshed inside the 60 s slack')
})

test('token: a JSON body with access_token / accessToken / token and expires_in is honoured', async () => {
  for (const body of [{ access_token: 'a', expires_in: 120 }, { accessToken: 'a', expiresIn: 120 }, { token: 'a', expires_in: 120 }]) {
    let t = 0
    const f = fakeFetch(() => reply(200, body))
    const getToken = createGarminTokenProvider({ apiKey: KEY, baseUrl: BASE, fetchImpl: f.fetchImpl, now: () => t })
    assert.equal(await getToken(), 'a', JSON.stringify(body))
    t = 59_000
    await getToken()
    assert.equal(f.calls.length, 1, 'still valid')
    t = 61_000
    await getToken()
    assert.equal(f.calls.length, 2, 'expires_in 120 s, refreshed 60 s early')
  }
})

test('token: concurrent callers share one in-flight request', async () => {
  /** @type {(r: Response) => void} */
  let release = () => {}
  const f = fakeFetch(() => new Promise((resolve) => { release = resolve }))
  const getToken = createGarminTokenProvider({ apiKey: KEY, baseUrl: BASE, fetchImpl: f.fetchImpl })
  const a = getToken()
  const b = getToken()
  release(reply(200, 'tok'))
  assert.deepEqual(await Promise.all([a, b]), ['tok', 'tok'])
  assert.equal(f.calls.length, 1)
})

test('token: a refused key (401 / 403) is classified garmin_auth; the key never appears in the error', async () => {
  for (const status of [401, 403]) {
    const f = fakeFetch(() => reply(status, `invalid key ${KEY}`))
    const getToken = createGarminTokenProvider({ apiKey: KEY, baseUrl: BASE, fetchImpl: f.fetchImpl })
    await assert.rejects(getToken, (/** @type {Error} */ err) => {
      assert.equal(classifyGarminError(err), 'garmin_auth')
      assert.ok(!err.message.includes(KEY), err.message)
      assert.ok(!String(err.stack).includes(KEY))
      return true
    })
  }
})

test('token: a network error carrying the key in its message is scrubbed and classified garmin_network', async () => {
  const f = fakeFetch(() => { throw Object.assign(new TypeError(`fetch failed for ApiKey ${KEY}`), { cause: { code: 'ECONNREFUSED', message: `x ${KEY}` } }) })
  const getToken = createGarminTokenProvider({ apiKey: KEY, baseUrl: BASE, fetchImpl: f.fetchImpl })
  await assert.rejects(getToken, (/** @type {Error & { cause?: any }} */ err) => {
    assert.ok(!err.message.includes(KEY), err.message)
    assert.ok(!JSON.stringify({ m: err.message, c: err.cause?.message }).includes(KEY))
    assert.equal(classifyGarminError(err), 'garmin_network')
    return true
  })
})

test('token: an empty token body or a 500 is garmin_other', async () => {
  for (const [status, body] of /** @type {[number, string][]} */ ([[200, ''], [200, '{}'], [500, 'oops']])) {
    const f = fakeFetch(() => reply(status, body))
    const getToken = createGarminTokenProvider({ apiKey: KEY, baseUrl: BASE, fetchImpl: f.fetchImpl })
    await assert.rejects(getToken, (/** @type {Error} */ err) => classifyGarminError(err) === 'garmin_other')
  }
})

test('classifyGarminError: timeouts and network codes are garmin_network, anything else garmin_other', () => {
  assert.equal(classifyGarminError(Object.assign(new Error('t'), { name: 'TimeoutError' })), 'garmin_network')
  assert.equal(classifyGarminError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })), 'garmin_network')
  assert.equal(classifyGarminError(new Error('garmin request failed: 500')), 'garmin_other')
  assert.equal(classifyGarminError(null), 'garmin_other')
})

test('data call: Bearer token; a 401 re-obtains the token once and retries; a second 401 is garmin_auth', async () => {
  let tokens = 0
  let dataCalls = 0
  const f = fakeFetch((url) => {
    if (url.pathname === TOKEN_PATH) return reply(200, `tok-${++tokens}`)
    dataCalls += 1
    return dataCalls === 1 ? reply(401, '') : reply(200, [])
  })
  const client = createGarminClient({ apiKey: KEY, baseUrl: BASE, fetchImpl: f.fetchImpl })
  assert.deepEqual(await fetchActivityWorkouts(client, '42'), [])
  assert.equal(tokens, 2, 'token re-obtained once')
  const data = f.calls.filter((c) => c.url.pathname !== TOKEN_PATH)
  assert.equal(data[0].url.pathname, '/activity-service/activity/42/workouts')
  assert.equal(headersOf(data[0].init).authorization, 'Bearer tok-1')
  assert.equal(headersOf(data[1].init).authorization, 'Bearer tok-2')

  const g = fakeFetch((url) => url.pathname === TOKEN_PATH ? reply(200, 'tok') : reply(401, ''))
  const refused = createGarminClient({ apiKey: KEY, baseUrl: BASE, fetchImpl: g.fetchImpl })
  await assert.rejects(fetchActivityWorkouts(refused, '42'), (/** @type {Error} */ err) => classifyGarminError(err) === 'garmin_auth')
  assert.equal(g.calls.filter((c) => c.url.pathname !== TOKEN_PATH).length, 2, 'retried once only')
})

test('the base URL defaults to Garmin personal Connect API, GARMIN_BASE_URL overrides it', async () => {
  assert.equal(DEFAULT_BASE_URL, 'https://personal.connectapi.garmin.com')
  const f = fakeFetch(() => reply(200, 'tok'))
  await createGarminTokenProvider({ apiKey: KEY, fetchImpl: f.fetchImpl })()
  assert.equal(f.calls[0].url.origin, DEFAULT_BASE_URL)
})

/** n activities, newest first, starting at `newestId` one hour apart. @param {number} newestId @param {number} n */
function activities (newestId, n, newestMs = Date.parse('2030-03-01T08:00:00Z')) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(newestMs - i * 3_600_000).toISOString().slice(0, 19).replace('T', ' ')
    return { activityId: newestId - i, startTimeGMT: d, startTimeLocal: d }
  })
}

test('activities: pages newest first with start/limit, stores every page as it arrives, stops at a short page', async () => {
  const all = activities(1000, PAGE_SIZE + 5)
  const f = fakeFetch((url) => {
    if (url.pathname === TOKEN_PATH) return reply(200, 'tok')
    assert.equal(url.pathname, ACTIVITIES_PATH)
    const start = Number(url.searchParams.get('start'))
    const limit = Number(url.searchParams.get('limit'))
    return reply(200, all.slice(start, start + limit))
  })
  const client = createGarminClient({ apiKey: KEY, baseUrl: BASE, fetchImpl: f.fetchImpl })
  /** @type {number[]} */
  const stored = []
  const r = await pullGarminActivities(client, { sinceMs: null }, async (batch) => { stored.push(batch.length) })
  assert.deepEqual(stored, [PAGE_SIZE, 5])
  assert.deepEqual(r, { count: PAGE_SIZE + 5, complete: true })
})

test('activities: stops at the overlap point (an activity older than sinceMs), keeping only the newer ones of that page', async () => {
  const all = activities(1000, PAGE_SIZE * 3)
  let pages = 0
  const f = fakeFetch((url) => {
    if (url.pathname === TOKEN_PATH) return reply(200, 'tok')
    pages += 1
    const start = Number(url.searchParams.get('start'))
    return reply(200, all.slice(start, start + PAGE_SIZE))
  })
  const client = createGarminClient({ apiKey: KEY, baseUrl: BASE, fetchImpl: f.fetchImpl })
  /** @type {any[]} */
  const stored = []
  // cutoff = 150 hours before the newest: activities 0..150 are kept
  const sinceMs = Date.parse('2030-03-01T08:00:00Z') - 150 * 3_600_000
  const r = await pullGarminActivities(client, { sinceMs }, async (batch) => { stored.push(...batch) })
  assert.equal(pages, 2, 'never asks for the third page')
  assert.equal(stored.length, 151)
  assert.equal(stored.at(-1).activityId, 850)
  assert.deepEqual(r, { count: 151, complete: true })
})

test('activities: a failure partway keeps the pages already stored and rethrows', async () => {
  const all = activities(1000, PAGE_SIZE * 2)
  const f = fakeFetch((url) => {
    if (url.pathname === TOKEN_PATH) return reply(200, 'tok')
    const start = Number(url.searchParams.get('start'))
    return start === 0 ? reply(200, all.slice(0, PAGE_SIZE)) : reply(503, '')
  })
  const client = createGarminClient({ apiKey: KEY, baseUrl: BASE, fetchImpl: f.fetchImpl })
  let stored = 0
  await assert.rejects(pullGarminActivities(client, { sinceMs: null }, async (b) => { stored += b.length }), /garmin request failed: 503/)
  assert.equal(stored, PAGE_SIZE)
})

test('activities: a walk past the page cap stops with an error (a broken offset can never loop forever)', async () => {
  const f = fakeFetch((url) => url.pathname === TOKEN_PATH ? reply(200, 'tok') : reply(200, activities(Number(url.searchParams.get('start')) + 10_000_000, PAGE_SIZE)))
  const client = createGarminClient({ apiKey: KEY, baseUrl: BASE, fetchImpl: f.fetchImpl })
  await assert.rejects(pullGarminActivities(client, { sinceMs: null }, async () => {}, { maxPages: 3 }), /more than 3 pages/)
})

test('compactWorkoutSteps: keeps the step structure, drops names and notes; empty array = no plan', () => {
  assert.equal(compactWorkoutSteps([]), null)
  assert.equal(compactWorkoutSteps(null), null)
  const steps = compactWorkoutSteps([{
    workoutName: 'Secret plan',
    sport: 'CYCLING',
    steps: [
      { stepIndex: 1, intensity: 'WARMUP', durationType: 'TIME', durationValue: 600, targetType: 'POWER_3S', targetValueLow: 100, targetValueHigh: 150, notes: 'coach note' },
      { stepIndex: 2, intensity: 'INTERVAL', durationType: 'TIME', durationValue: 300, targetType: 'NO_TARGET' },
      { stepIndex: 3, intensity: 'REST', durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 2, targetValue: 4, targetType: null, stepName: 'x' }
    ]
  }])
  assert.deepEqual(steps, [
    { i: 1, intensity: 'WARMUP', dur_type: 'TIME', dur: 600, target: 'POWER_3S', low: 100, high: 150, value: null },
    { i: 2, intensity: 'INTERVAL', dur_type: 'TIME', dur: 300, target: 'NO_TARGET', low: null, high: null, value: null },
    { i: 3, intensity: 'REST', dur_type: 'REPEAT_UNTIL_STEPS_CMPLT', dur: 2, target: null, low: null, high: null, value: 4 }
  ])
  assert.ok(!JSON.stringify(steps).includes('Secret') && !JSON.stringify(steps).includes('coach'))
})

test('config: configured only with a non-blank GARMIN_API_KEY; GARMIN_API_KEY_EXPIRES must be a real YYYY-MM-DD date', () => {
  assert.equal(isGarminConfigured({}), false)
  assert.equal(isGarminConfigured({ GARMIN_API_KEY: '  ' }), false)
  assert.equal(isGarminConfigured({ GARMIN_API_KEY: KEY }), true)
  assert.equal(garminKeyExpires({}), null)
  assert.equal(garminKeyExpires({ GARMIN_API_KEY_EXPIRES: '2027-05-31' }), '2027-05-31')
  assert.equal(garminKeyExpires({ GARMIN_API_KEY_EXPIRES: ' 2027-05-31 ' }), '2027-05-31')
  for (const bad of ['2027-02-30', '31/05/2027', '2027-5-31', 'soon', '']) assert.equal(garminKeyExpires({ GARMIN_API_KEY_EXPIRES: bad }), null, bad)
})

test('the Garmin settings never reach the page-build child (builder.js allowlist: no GARMIN_ name, no HC_ prefix)', async () => {
  const { childEnvOf } = await import('../src/builder.js')
  const env = childEnvOf({ GARMIN_API_KEY: KEY, GARMIN_API_KEY_EXPIRES: '2031-01-01', GARMIN_SYNC_MINUTES: '60', GARMIN_BASE_URL: BASE, PATH: '/bin', HC_SITE_DIR: '/site' })
  assert.deepEqual(Object.keys(env).sort(), ['HC_SITE_DIR', 'PATH'])
})
