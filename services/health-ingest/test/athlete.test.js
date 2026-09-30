import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchAthlete, fetchGearDetails, gearIdsOf, isGearScopeMissing, buildGear,
  saveAthlete, loadAthlete, listDevices, activityGearIds, toAthleteExport,
  createAthleteRefresher, createAthleteExportHandler, ATHLETE_REFRESH_MS, ATHLETE_RETRY_MS
} from '../src/athlete.js'

const TOKEN = 'a'.repeat(64)
const okJson = (body) => ({ ok: true, status: 200, json: async () => body })

// SYNTHETIC athlete, shaped like Strava's detailed representation (profile:read_all scope)
const ATHLETE = {
  id: 1,
  username: 'demo',
  firstname: 'Alex',
  lastname: 'Example',
  city: 'Sampletown',
  state: 'Region',
  country: 'Nowhere',
  sex: 'M',
  weight: 70,
  athlete_type: 0,
  measurement_preference: 'meters',
  profile: 'https://img.example.test/large.jpg',
  profile_medium: 'https://img.example.test/medium.jpg',
  bikes: [{ id: 'b1', name: 'Road bike', primary: true, distance: 1234567.8, retired: false }],
  shoes: [{ id: 'g2', name: 'Trainers', primary: false, distance: 745000, retired: false },
    { id: 'g3', name: 'Old trainers', primary: false, distance: 910000, retired: true }]
}

function fakePool (handlers = []) {
  const calls = []
  return {
    calls,
    query: async (sql, values) => {
      calls.push({ sql, values })
      for (const [re, rows] of handlers) if (re.test(sql)) return { rows: typeof rows === 'function' ? rows(values) : rows }
      return { rows: [] }
    }
  }
}

function fakeRes () {
  return {
    status: null,
    body: null,
    writeHead (status) { this.status = status },
    end (payload) { this.body = JSON.parse(payload) }
  }
}

// ---- Strava calls ----------------------------------------------------------------------

test('fetchAthlete GETs /athlete with the bearer token', async () => {
  const seen = []
  const athlete = await fetchAthlete(async () => 'tok', async (url, opts) => { seen.push([String(url), opts.headers.authorization]); return okJson(ATHLETE) })
  assert.equal(athlete.firstname, 'Alex')
  assert.deepEqual(seen, [['https://www.strava.com/api/v3/athlete', 'Bearer tok']])
})

test('fetchAthlete throws a coded error on a rejected or rate-limited call', async () => {
  await assert.rejects(fetchAthlete(async () => 'tok', async () => ({ ok: false, status: 401 })), /strava athlete failed: 401/)
  await assert.rejects(fetchAthlete(async () => 'tok', async () => ({ ok: false, status: 429 })), (err) => err.rateLimited === true)
})

test('fetchGearDetails fetches each id and tolerates a failed one', async () => {
  const urls = []
  const out = await fetchGearDetails(async () => 'tok', ['b1', 'g2'], async (url) => {
    urls.push(String(url))
    if (String(url).endsWith('/g2')) return { ok: false, status: 403 }
    return okJson({ id: 'b1', brand_name: 'Brand', model_name: 'Model', frame_type: 3, weight: 8.2 })
  })
  assert.deepEqual(urls, ['https://www.strava.com/api/v3/gear/b1', 'https://www.strava.com/api/v3/gear/g2'])
  assert.deepEqual(out, { b1: { id: 'b1', brand_name: 'Brand', model_name: 'Model', frame_type: 3, weight: 8.2 } })
})

test('fetchGearDetails only requests well-formed gear ids (no path injection)', async () => {
  const urls = []
  await fetchGearDetails(async () => 'tok', ['b1', '../athlete', 'g2?x=1', ''], async (url) => { urls.push(String(url)); return okJson({}) })
  assert.deepEqual(urls, ['https://www.strava.com/api/v3/gear/b1'])
})

test('gearIdsOf unions athlete gear and activity gear ids, deduped and capped', () => {
  assert.deepEqual(gearIdsOf(ATHLETE, ['b1', 'b9']), ['b1', 'g2', 'g3', 'b9'])
  assert.deepEqual(gearIdsOf({}, []), [])
  const many = Array.from({ length: 40 }, (_, i) => `b${i}`)
  assert.equal(gearIdsOf({}, many).length, 20)
})

// ---- scope detection -------------------------------------------------------------------

test('gear scope is missing when /athlete has no bikes/shoes arrays (read-only token)', () => {
  const { bikes, shoes, ...summary } = ATHLETE
  assert.equal(isGearScopeMissing(summary, []), true)
  assert.equal(isGearScopeMissing(ATHLETE, ['b1']), false)
})

test('empty gear arrays count as missing scope only when activities reference gear', () => {
  const empty = { ...ATHLETE, bikes: [], shoes: [] }
  assert.equal(isGearScopeMissing(empty, []), false, 'an athlete with no gear at all')
  assert.equal(isGearScopeMissing(empty, ['b1']), true)
})

// ---- gear shaping ----------------------------------------------------------------------

test('buildGear merges summary and detail, maps frame types, splits bikes and shoes', () => {
  const gear = buildGear(ATHLETE, { b1: { id: 'b1', brand_name: 'Brand', model_name: 'Model', frame_type: 3, weight: 8.2, distance: 1300000 } })
  assert.deepEqual(gear.bikes, [{ id: 'b1', name: 'Road bike', brand: 'Brand', model: 'Model', frameType: 'road', weightKg: 8.2, distanceM: 1300000, retired: false, primary: true }])
  assert.equal(gear.shoes.length, 2)
  assert.deepEqual(gear.shoes[1], { id: 'g3', name: 'Old trainers', brand: null, model: null, distanceM: 910000, retired: true, primary: false })
})

test('buildGear falls back to detail-only gear (scope missing, /gear/{id} answered)', () => {
  const gear = buildGear({}, { b7: { id: 'b7', name: 'Gravel', frame_type: 5, distance: 5000, retired: true }, g8: { id: 'g8', name: 'Racer', distance: 100 } })
  assert.equal(gear.bikes[0].frameType, 'gravel')
  assert.equal(gear.bikes[0].retired, true)
  assert.equal(gear.shoes[0].name, 'Racer')
})

test('buildGear never emits NaN or non-numeric distances', () => {
  const gear = buildGear({ bikes: [{ id: 'b1', name: 'X', distance: 'lots' }] }, {})
  assert.equal(gear.bikes[0].distanceM, null)
  assert.equal(gear.bikes[0].weightKg, null)
})

// ---- persistence -----------------------------------------------------------------------

test('saveAthlete upserts the single snapshot row with parameters', async () => {
  const pool = fakePool()
  await saveAthlete(pool, { athlete: ATHLETE, gear: { bikes: [], shoes: [] }, gearScopeMissing: true })
  assert.match(pool.calls[0].sql, /INSERT INTO strava_athlete/)
  assert.match(pool.calls[0].sql, /ON CONFLICT \(id\) DO UPDATE/)
  assert.equal(pool.calls[0].values[2], true)
})

test('loadAthlete returns null when no snapshot is stored', async () => {
  assert.equal(await loadAthlete(fakePool()), null)
})

test('listDevices groups stored activities by device_name (count + last used day)', async () => {
  const pool = fakePool([[/device_name/, [{ name: 'Demo Watch', count: 3, last: '2030-01-05T07:00:00Z' }]]])
  assert.deepEqual(await listDevices(pool), [{ name: 'Demo Watch', count: 3, lastUsed: '2030-01-05' }])
  assert.match(pool.calls[0].sql, /GROUP BY/)
})

test('activityGearIds lists distinct non-null gear ids', async () => {
  const pool = fakePool([[/gear_id/, [{ id: 'b1' }, { id: 'g2' }]]])
  assert.deepEqual(await activityGearIds(pool), ['b1', 'g2'])
})

// ---- export shape ----------------------------------------------------------------------

test('toAthleteExport exposes only the profile fields, never ids/username/weight/raw payload', () => {
  const out = toAthleteExport({
    fetched_at: new Date('2030-01-06T08:00:00Z'),
    athlete: ATHLETE,
    gear: buildGear(ATHLETE, {}),
    gear_scope_missing: false
  }, [{ name: 'Demo Watch', count: 2, lastUsed: '2030-01-05' }])
  assert.deepEqual(Object.keys(out).sort(), ['athleteType', 'bikes', 'city', 'country', 'devices', 'fetchedAt', 'firstname', 'gearScopeMissing', 'lastname', 'measurementPreference', 'profile', 'profileMedium', 'shoes', 'state'])
  assert.equal(out.athleteType, 'cyclist')
  assert.equal(out.fetchedAt, '2030-01-06T08:00:00.000Z')
  assert.equal(out.profileMedium, 'https://img.example.test/medium.jpg')
  assert.doesNotMatch(JSON.stringify(out), /username|"sex"|"weight"/)
})

test('toAthleteExport drops a non-https photo (Strava placeholder paths)', () => {
  const out = toAthleteExport({ fetched_at: null, athlete: { ...ATHLETE, profile: 'avatar/athlete/large.png', profile_medium: 'http://x/y.jpg' }, gear: null, gear_scope_missing: false }, [])
  assert.equal(out.profile, null)
  assert.equal(out.profileMedium, null)
})

test('toAthleteExport with no snapshot still returns devices and empty gear', () => {
  const out = toAthleteExport(null, [{ name: 'Demo Watch', count: 1, lastUsed: '2030-01-01' }])
  assert.equal(out.fetchedAt, null)
  assert.equal(out.firstname, null)
  assert.deepEqual(out.bikes, [])
  assert.equal(out.devices.length, 1)
})

// ---- refresher: at most once per 24 h, never throws -------------------------------------

function refresherPool (fetchedAt) {
  const state = { row: fetchedAt ? { fetched_at: new Date(fetchedAt), athlete: {}, gear: {}, gear_scope_missing: false } : null, saved: null }
  return {
    state,
    pool: fakePool([
      [/FROM strava_athlete/, () => (state.row ? [state.row] : [])],
      [/gear_id/, [{ id: 'b1' }]],
      [/INSERT INTO strava_athlete/, (values) => { state.saved = values; return [] }]
    ])
  }
}

test('refresher fetches when no snapshot exists and stores athlete + gear', async () => {
  const { pool, state } = refresherPool(null)
  const urls = []
  const r = createAthleteRefresher({
    pool,
    getAccessToken: async () => 'tok',
    fetchImpl: async (url) => { urls.push(String(url)); return String(url).endsWith('/athlete') ? okJson(ATHLETE) : okJson({ id: 'b1', brand_name: 'B' }) },
    log: () => {}
  })
  assert.equal(await r.maybeRefresh(), 'refreshed')
  assert.ok(urls[0].endsWith('/athlete'))
  assert.ok(state.saved, 'snapshot stored')
  assert.equal(JSON.parse(state.saved[1]).bikes[0].brand, 'B')
})

test('refresher skips while the stored snapshot is younger than 24 h', async () => {
  const now = Date.parse('2030-01-02T12:00:00Z')
  const { pool } = refresherPool(now - ATHLETE_REFRESH_MS + 60_000)
  let calls = 0
  const r = createAthleteRefresher({ pool, getAccessToken: async () => 'tok', fetchImpl: async () => { calls++; return okJson(ATHLETE) }, now: () => now, log: () => {} })
  assert.equal(await r.maybeRefresh(), 'fresh')
  assert.equal(calls, 0)
})

test('refresher never throws; after a failure it waits the retry delay', async () => {
  let now = Date.parse('2030-01-02T12:00:00Z')
  const { pool } = refresherPool(null)
  const logs = []
  let calls = 0
  const r = createAthleteRefresher({ pool, getAccessToken: async () => 'tok', fetchImpl: async () => { calls++; return { ok: false, status: 500 } }, now: () => now, log: (l) => logs.push(l) })
  assert.equal(await r.maybeRefresh(), 'failed')
  assert.match(logs[0], /strava_athlete_failed/)
  assert.equal(await r.maybeRefresh(), 'backoff')
  assert.equal(calls, 1)
  now += ATHLETE_RETRY_MS + 1
  await r.maybeRefresh()
  assert.equal(calls, 2)
})

test('refresher records gearScopeMissing for a read-only token and still stores the athlete', async () => {
  const { pool, state } = refresherPool(null)
  const { bikes, shoes, ...summary } = ATHLETE
  const r = createAthleteRefresher({
    pool,
    getAccessToken: async () => 'tok',
    fetchImpl: async (url) => (String(url).endsWith('/athlete') ? okJson(summary) : { ok: false, status: 403 }),
    log: () => {}
  })
  assert.equal(await r.maybeRefresh(), 'refreshed')
  assert.equal(state.saved[2], true)
})

// ---- GET /export/athlete ---------------------------------------------------------------

test('athlete export rejects requests without the bearer token (no query before auth)', async () => {
  const pool = fakePool()
  const handle = createAthleteExportHandler({ pool, token: TOKEN, log: () => {} })
  const res = fakeRes()
  await handle({ headers: {} }, res)
  assert.equal(res.status, 401)
  assert.equal(pool.calls.length, 0)
})

test('athlete export answers the filtered snapshot and logs no field values', async () => {
  const pool = fakePool([
    [/FROM strava_athlete/, [{ fetched_at: new Date('2030-01-06T08:00:00Z'), athlete: ATHLETE, gear: buildGear(ATHLETE, {}), gear_scope_missing: false }]],
    [/device_name/, [{ name: 'Demo Watch', count: 2, last: '2030-01-05T07:00:00Z' }]]
  ])
  const logs = []
  const handle = createAthleteExportHandler({ pool, token: TOKEN, log: (l) => logs.push(l) })
  const res = fakeRes()
  await handle({ headers: { authorization: `Bearer ${TOKEN}` } }, res)
  assert.equal(res.status, 200)
  assert.equal(res.body.firstname, 'Alex')
  assert.equal(res.body.bikes.length, 1)
  assert.equal(res.body.devices[0].name, 'Demo Watch')
  assert.doesNotMatch(logs.join('\n'), /Alex|Sampletown|Demo Watch/)
})

// ---- schema + wiring ---------------------------------------------------------------------

test('sql/004_athlete.sql defines every strava_athlete column athlete.js reads or writes, and db.js runs it', async () => {
  const { readFileSync } = await import('node:fs')
  const sql = readFileSync(new URL('../sql/004_athlete.sql', import.meta.url), 'utf8')
  for (const col of ['fetched_at', 'athlete', 'gear', 'gear_scope_missing']) assert.match(sql, new RegExp(`\\b${col}\\b`))
  assert.match(sql, /CREATE TABLE IF NOT EXISTS strava_athlete/, 'idempotent')
  assert.match(readFileSync(new URL('../src/db.js', import.meta.url), 'utf8'), /'004_athlete\.sql'/)
})

test('server.js routes GET /export/athlete through the bearer-checked handler', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
  assert.match(src, /url\.pathname === '\/export\/athlete'/)
  assert.match(src, /createAthleteExportHandler\(\{ pool, token: INGEST_TOKEN \}\)/)
})
