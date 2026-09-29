import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseExportQuery, listRawPayloads, createExportHandler,
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

test('lists payloads with a parameterized, id-ordered query', async () => {
  const pool = fakePool([{ id: '13', received_at: 't', payload: { hrv: '' } }])
  const rows = await listRawPayloads(pool, { automation: 'a', sinceId: '12', limit: 5 })
  assert.equal(rows.length, 1)
  assert.deepEqual(pool.calls[0].values, ['a', '12', 5])
  assert.match(pool.calls[0].sql, /automation = \$1/)
  assert.match(pool.calls[0].sql, /id > \$2/)
  assert.match(pool.calls[0].sql, /ORDER BY id ASC/)
  assert.match(pool.calls[0].sql, /LIMIT \$3/)
})

function fakeRes () {
  return {
    status: null,
    body: null,
    writeHead (status) { this.status = status },
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
  const pool = fakePool([{ id: '3', received_at: 't', payload: { hrv: 'secret-values' } }])
  const handle = createExportHandler({ pool, token: TOKEN, log: (line) => logged.push(line) })
  const res = fakeRes()
  await handle({ headers: { authorization: `Bearer ${TOKEN}` } }, res,
    new URL('http://x/export/raw?automation=a&since_id=2'))
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, [{ id: '3', received_at: 't', payload: { hrv: 'secret-values' } }])
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
