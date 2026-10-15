import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseExportQuery, listRawPayloads, createExportHandler, EXPORT_PAGE_BYTES,
  parsePaging, listStravaActivities, createStravaExportHandler
} from '../src/export.js'

const TOKEN = 'a'.repeat(64)
const params = (qs) => new URL(`http://x/export/raw?${qs}`).searchParams

test('parses a full export query', () => {
  assert.deepEqual(parseExportQuery(params('automation=my-shortcut&since_id=12&limit=50')),
    { automation: 'my-shortcut', sinceId: '12', limit: 50 })
})

test('defaults since_id to 0 and caps the limit', () => {
  assert.deepEqual(parseExportQuery(params('automation=a')), { automation: 'a', sinceId: '0', limit: 500 })
  assert.equal(parseExportQuery(params('automation=a&limit=99999')).limit, 1000)
})

test('rejects a missing automation or non-numeric ids', () => {
  for (const qs of ['', 'automation=', 'automation=a&since_id=-1', 'automation=a&since_id=1;drop',
    'automation=a&limit=0', 'automation=a&limit=abc']) {
    assert.throws(() => parseExportQuery(params(qs)), (err) => err.status === 400, qs)
  }
})

function fakePool (rows) {
  const calls = []
  return { calls, query: async (sql, values) => { calls.push({ sql, values }); return { rows } } }
}

/** A fake pool for the two-step raw export: the id + byte_size scan, then the payloads up to the chosen id. */
function rawPool (stored) {
  const calls = []
  return {
    calls,
    query: async (sql, values) => {
      calls.push({ sql, values })
      const after = stored.filter((r) => BigInt(r.id) > BigInt(values[1]))
      if (/byte_size/.test(sql)) return { rows: after.slice(0, values[2]).map((r) => ({ id: r.id, byte_size: r.byte_size })) }
      return { rows: after.filter((r) => BigInt(r.id) <= BigInt(values[2])).map(({ id, received_at: at, payload }) => ({ id, received_at: at, payload })) }
    }
  }
}
const MB = 1024 * 1024
const stored = (sizes) => sizes.map((size, i) => ({ id: String(13 + i), received_at: 't', byte_size: size, payload: { n: i } }))

test('lists payloads with parameterized, id-ordered queries', async () => {
  const pool = rawPool(stored([100]))
  const page = await listRawPayloads(pool, { automation: 'a', sinceId: '12', limit: 5 })
  assert.deepEqual(page, { rows: [{ id: '13', received_at: 't', payload: { n: 0 } }], more: false })
  assert.deepEqual(pool.calls[0].values, ['a', '12', 5])
  assert.match(pool.calls[0].sql, /automation = \$1/)
  assert.match(pool.calls[0].sql, /id > \$2/)
  assert.match(pool.calls[0].sql, /ORDER BY id ASC/)
  assert.match(pool.calls[0].sql, /LIMIT \$3/)
  assert.doesNotMatch(pool.calls[0].sql, /\bpayload\b/, 'the scan reads sizes, never the payloads')
  assert.deepEqual(pool.calls[1].values, ['a', '12', '13'])
  assert.match(pool.calls[1].sql, /id <= \$3/)
})

test('a page stops once its payloads pass the byte budget (32 MB): the row that crosses it is the last, `more` says the rest is there', async () => {
  assert.equal(EXPORT_PAGE_BYTES, 32 * MB)
  const pool = rawPool(stored([10 * MB, 10 * MB, 10 * MB, 10 * MB, 10 * MB]))
  const page = await listRawPayloads(pool, { automation: 'a', sinceId: '12', limit: 500 })
  assert.deepEqual(page.rows.map((r) => r.id), ['13', '14', '15', '16'], '30 MB before the 4th row: it is still sent; 40 MB before the 5th')
  assert.equal(page.more, true)
  const rest = await listRawPayloads(pool, { automation: 'a', sinceId: '16', limit: 500 })
  assert.deepEqual([rest.rows.map((r) => r.id), rest.more], [['17'], false])
})

test('a single payload over the budget is still returned on its own (the cursor always advances)', async () => {
  const pool = rawPool(stored([40 * MB, 1]))
  const page = await listRawPayloads(pool, { automation: 'a', sinceId: '0', limit: 500, maxBytes: 32 * MB })
  assert.deepEqual([page.rows.map((r) => r.id), page.more], [['13'], true])
})

test('more is false on a full row-limited page (the client pages on as before) and on an empty one', async () => {
  const full = await listRawPayloads(rawPool(stored([1, 1, 1])), { automation: 'a', sinceId: '0', limit: 2 })
  assert.deepEqual([full.rows.length, full.more], [2, false])
  const empty = await listRawPayloads(rawPool([]), { automation: 'a', sinceId: '0', limit: 2 })
  assert.deepEqual(empty, { rows: [], more: false })
})

function fakeRes () {
  return {
    status: null,
    body: null,
    headers: null,
    writeHead (status, headers = {}) { this.status = status; this.headers = headers },
    end (payload) { this.body = JSON.parse(payload) }
  }
}

test('export handler rejects requests without the bearer token', async () => {
  const pool = fakePool([])
  const handle = createExportHandler({ pool, token: TOKEN, log: () => {} })
  const res = fakeRes()
  await handle({ headers: {} }, res, new URL('http://x/export/raw?automation=a'))
  assert.equal(res.status, 401)
  assert.equal(pool.calls.length, 0, 'no query before auth')
})

test('export handler returns rows and logs counts only', async () => {
  const logged = []
  const pool = rawPool([{ id: '3', received_at: 't', byte_size: 30, payload: { hrv: 'secret-values' } }])
  const handle = createExportHandler({ pool, token: TOKEN, log: (line) => logged.push(line) })
  const res = fakeRes()
  await handle({ headers: { authorization: `Bearer ${TOKEN}` } }, res,
    new URL('http://x/export/raw?automation=a&since_id=2'))
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, [{ id: '3', received_at: 't', payload: { hrv: 'secret-values' } }], 'the body stays a plain array')
  assert.equal(res.headers['x-has-more'], 'false')
  assert.equal(logged.length, 1)
  assert.ok(!logged[0].includes('secret-values'), 'payload contents never logged')
})

test('export handler answers 400 on a bad query', async () => {
  const handle = createExportHandler({ pool: fakePool([]), token: TOKEN, log: () => {} })
  const res = fakeRes()
  await handle({ headers: { authorization: `Bearer ${TOKEN}` } }, res, new URL('http://x/export/raw'))
  assert.equal(res.status, 400)
})

// ---- /export/strava -----------------------------------------------------------------------

test('parsePaging defaults since_id to 0 and the limit to 500, caps at 1000', () => {
  assert.deepEqual(parsePaging(params('')), { sinceId: '0', limit: 500 })
  assert.equal(parsePaging(params('limit=99999')).limit, 1000)
  assert.deepEqual(parsePaging(params('since_id=42&limit=10')), { sinceId: '42', limit: 10 })
})

test('parsePaging rejects a non-numeric/negative since_id or a non-positive limit', () => {
  for (const qs of ['since_id=-1', 'since_id=1;drop', 'limit=0', 'limit=abc', 'limit=-5']) {
    assert.throws(() => parsePaging(params(qs)), (err) => err.status === 400, qs)
  }
})

test('parseExportQuery still requires automation and reuses parsePaging for since_id/limit', () => {
  assert.deepEqual(parseExportQuery(params('automation=a&since_id=12&limit=50')),
    { automation: 'a', sinceId: '12', limit: 50 })
  assert.throws(() => parseExportQuery(params('automation=a&limit=0')), (err) => err.status === 400)
})

test('lists strava activities with a parameterized, id-ordered query exposing only safe fields', async () => {
  const pool = fakePool([{
    id: '99', start_local: '2026-08-20T07:00:00', sport_type: 'Run',
    moving_time: 1800, elapsed_time: 1900, distance: 5000, average_heartrate: 150, max_heartrate: 172
  }])
  const rows = await listStravaActivities(pool, { sinceId: '10', limit: 5 })
  assert.equal(rows.length, 1)
  assert.deepEqual(pool.calls[0].values, ['10', 5])
  assert.match(pool.calls[0].sql, /id > \$1/)
  assert.match(pool.calls[0].sql, /ORDER BY id ASC/)
  assert.match(pool.calls[0].sql, /LIMIT \$2/)
  assert.match(pool.calls[0].sql, /payload->>'start_date_local'/)
  assert.match(pool.calls[0].sql, /payload->'moving_time'/)
  assert.match(pool.calls[0].sql, /payload->'suffer_score' AS suffer_score/)
  assert.match(pool.calls[0].sql, /payload->'kilojoules' AS kilojoules/)
  assert.match(pool.calls[0].sql, /payload->'total_elevation_gain' AS total_elevation_gain/)
  assert.doesNotMatch(pool.calls[0].sql, /\bname\b/)
  assert.doesNotMatch(pool.calls[0].sql, /SELECT \*/)
})

test('strava export handler rejects requests without the bearer token before any query', async () => {
  const pool = fakePool([])
  const handle = createStravaExportHandler({ pool, token: TOKEN, log: () => {} })
  const res = fakeRes()
  await handle({ headers: {} }, res, new URL('http://x/export/strava'))
  assert.equal(res.status, 401)
  assert.equal(pool.calls.length, 0, 'no query before auth')
})

test('strava export handler answers 400 on a bad since_id/limit', async () => {
  const handle = createStravaExportHandler({ pool: fakePool([]), token: TOKEN, log: () => {} })
  const res = fakeRes()
  await handle({ headers: { authorization: `Bearer ${TOKEN}` } }, res, new URL('http://x/export/strava?since_id=-1'))
  assert.equal(res.status, 400)
})

test('strava export handler returns 200 and logs counts + since_id only, never field values', async () => {
  const logged = []
  const pool = fakePool([{ id: '99', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800, elapsed_time: 1900, distance: 5000, average_heartrate: 150, max_heartrate: 172 }])
  const handle = createStravaExportHandler({ pool, token: TOKEN, log: (line) => logged.push(line) })
  const res = fakeRes()
  await handle({ headers: { authorization: `Bearer ${TOKEN}` } }, res, new URL('http://x/export/strava?since_id=5'))
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, pool.calls.length ? [{ id: '99', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800, elapsed_time: 1900, distance: 5000, average_heartrate: 150, max_heartrate: 172 }] : [])
  assert.equal(logged.length, 1)
  const parsed = JSON.parse(logged[0])
  assert.equal(parsed.event, 'exported')
  assert.equal(parsed.since_id, '5')
  assert.equal(parsed.count, 1)
  assert.ok(!logged[0].includes('150'), 'field values never logged')
})

test('strava export passes suffer_score/kilojoules through, and null when the activity has none', async () => {
  const pool = fakePool([
    { id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800, suffer_score: 87, kilojoules: null },
    { id: '2', start_local: '2026-08-21T07:00:00', sport_type: 'Ride', moving_time: 3600, suffer_score: null, kilojoules: 640.5 }
  ])
  const rows = await listStravaActivities(pool, { sinceId: '0', limit: 5 })
  assert.equal(rows[0].suffer_score, 87)
  assert.equal(rows[0].kilojoules, null)
  assert.equal(rows[1].suffer_score, null)
  assert.equal(rows[1].kilojoules, 640.5)
})

test('strava export passes total_elevation_gain through (metres), null when the activity has none', async () => {
  const pool = fakePool([
    { id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 3600, total_elevation_gain: 412.4 },
    { id: '2', start_local: '2026-08-21T07:00:00', sport_type: 'VirtualRide', moving_time: 3600, total_elevation_gain: null }
  ])
  const rows = await listStravaActivities(pool, { sinceId: '0', limit: 5 })
  assert.equal(rows[0].total_elevation_gain, 412.4)
  assert.equal(rows[1].total_elevation_gain, null)
})

test('strava export exposes the UTC start and device_watts (ride window + real power for the energy correction)', async () => {
  const pool = fakePool([])
  await listStravaActivities(pool, { sinceId: '0', limit: 5 })
  assert.match(pool.calls[0].sql, /payload->>'start_date' AS start_utc/)
  assert.match(pool.calls[0].sql, /payload->'device_watts' AS device_watts/)
})

test('strava export carries the HR histogram (hr_hist) of the activity, only for an ok row, never the stream', async () => {
  const pool = fakePool([{ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 600, hr_hist: { 150: 600 } }])
  const rows = await listStravaActivities(pool, { sinceId: '0', limit: 5 })
  assert.deepEqual(rows[0].hr_hist, { 150: 600 })
  const sql = pool.calls[0].sql
  assert.match(sql, /SELECT h\.hr_hist FROM strava_activity_hr h/)
  assert.match(sql, /h\.activity_id = strava_activity\.id AND h\.status = 'ok'\) AS hr_hist/)
  assert.doesNotMatch(sql, /stream/)
})

test('export handler: a byte-capped page answers X-Has-More: true and logs it', async () => {
  const logged = []
  const handle = createExportHandler({ pool: rawPool(stored([40 * MB, 1])), token: TOKEN, log: (line) => logged.push(JSON.parse(line)) })
  const res = fakeRes()
  await handle({ headers: { authorization: `Bearer ${TOKEN}` } }, res, new URL('http://x/export/raw?automation=a'))
  assert.deepEqual([res.status, res.body.map((r) => r.id), res.headers['x-has-more']], [200, ['13'], 'true'])
  assert.deepEqual(logged, [{ event: 'exported', automation: 'a', since_id: '0', count: 1, more: true }])
})
