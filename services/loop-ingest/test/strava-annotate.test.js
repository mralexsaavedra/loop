import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {
  isDefaultActivityName, parseAnnotateBody, decideAnnotation, createActivityAnnotator, createStravaAnnotateRoutes,
  NAME_MAX, DESCRIPTION_MAX
} from '../src/strava-annotate.js'
import { createHandler } from '../src/server.js'
import { createBearerCheck } from '../src/auth.js'

const TOKEN = 'y'.repeat(40)
const silent = () => {}

test('isDefaultActivityName: Strava automatic titles in English and Spanish', () => {
  for (const name of ['Morning Run', 'Afternoon Ride', 'Evening Weight Training', 'Night Walk', 'Lunch Run',
    'Carrera matutina', 'Bicicleta por la tarde', 'Entrenamiento nocturno', 'Carrera vespertina',
    'Entrenamiento de la mañana', 'Carrera a la hora del almuerzo', '', '   ']) {
    assert.equal(isDefaultActivityName(name), true, name)
  }
})

test('isDefaultActivityName: a title the owner typed is kept', () => {
  for (const name of ['HP S5D1 · Tempo', 'Series en el Retiro', 'Hyrox sim', 'Tirada larga', 'Rodaje con Ana']) {
    assert.equal(isDefaultActivityName(name), false, name)
  }
})

test('parseAnnotateBody: valid bodies', () => {
  assert.deepEqual(parseAnnotateBody({ name: ' HP S5D1 ' }), { dryRun: false, name: 'HP S5D1' })
  assert.deepEqual(parseAnnotateBody({ description: 'A\r\nB\tC', dry_run: true }), { dryRun: true, description: 'A\nB\tC' })
})

test('parseAnnotateBody: refuses bad bodies with a coarse code', () => {
  const code = (body) => { try { parseAnnotateBody(body); return null } catch (err) { return [err.status, err.code, err.field] } }
  assert.deepEqual(code(null), [400, 'bad_body', undefined])
  assert.deepEqual(code([]), [400, 'bad_body', undefined])
  assert.deepEqual(code({}), [400, 'nothing_to_write', undefined])
  assert.deepEqual(code({ dry_run: true }), [400, 'nothing_to_write', undefined])
  assert.deepEqual(code({ name: 'x', sport_type: 'Run' }), [400, 'unknown_field', 'sport_type'])
  assert.deepEqual(code({ name: 3 }), [400, 'bad_field', 'name'])
  assert.deepEqual(code({ name: '  ' }), [400, 'bad_field', 'name'])
  assert.deepEqual(code({ name: 'x'.repeat(NAME_MAX + 1) }), [400, 'bad_field', 'name'])
  assert.deepEqual(code({ name: 'a\nb' }), [400, 'bad_field', 'name'])
  assert.deepEqual(code({ description: 'x'.repeat(DESCRIPTION_MAX + 1) }), [400, 'bad_field', 'description'])
  assert.deepEqual(code({ description: 'a\u0007b' }), [400, 'bad_field', 'description'])
  assert.deepEqual(code({ name: 'a\u0000' }), [400, 'nul_character', undefined])
  assert.deepEqual(code({ name: 'x', dry_run: 'yes' }), [400, 'bad_field', 'dry_run'])
})

test('decideAnnotation: never overwrites what the owner wrote', () => {
  const wanted = { name: 'HP S5D1 · Tempo', description: 'A · Tempo' }
  assert.deepEqual(decideAnnotation({ name: 'Morning Run', description: null }, wanted).fields, wanted)
  assert.deepEqual(decideAnnotation({ name: 'Morning Run', description: '  ' }, wanted).fields, wanted)
  assert.deepEqual(decideAnnotation({ name: 'Rodaje con Ana', description: '' }, wanted).fields, { description: 'A · Tempo' })
  assert.deepEqual(decideAnnotation({ name: 'Morning Run', description: 'mine' }, wanted).fields, { name: 'HP S5D1 · Tempo' })
  assert.deepEqual(decideAnnotation({ name: 'Mine', description: 'mine' }, wanted).fields, {})
  // only the fields asked for
  assert.deepEqual(decideAnnotation({ name: 'Morning Run', description: '' }, { description: 'D' }).fields, { description: 'D' })
})

/** A fake Strava: GET returns `activity`, PUT answers `putStatus` and records the body. */
function fakeStrava ({ activity = { name: 'Morning Run', description: null }, getStatus = 200, putStatus = 200, throwOn = null } = {}) {
  const calls = []
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), method: opts.method, auth: opts.headers.authorization, body: opts.body ? JSON.parse(opts.body) : undefined })
    if (throwOn === opts.method) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
    const status = opts.method === 'GET' ? getStatus : putStatus
    return new Response(status === 200 ? JSON.stringify(opts.method === 'GET' ? activity : { ...activity, ...JSON.parse(opts.body) }) : '{}', { status })
  }
  return { calls, fetchImpl }
}

test('annotator: writes the default name and the missing description with one PUT', async () => {
  const strava = fakeStrava()
  const queries = []
  const pool = { query: async (sql, params) => { queries.push(params) } }
  const annotate = createActivityAnnotator({ getAccessToken: async () => 'tok', pool, fetchImpl: strava.fetchImpl, log: silent })
  const out = await annotate('123', { dryRun: false, name: 'HP S5D1', description: 'A · Tempo' })
  assert.equal(out.updated, true)
  assert.equal(out.name_changed, true)
  assert.equal(out.description_changed, true)
  assert.deepEqual(strava.calls.map((c) => [c.method, c.url]), [
    ['GET', 'https://www.strava.com/api/v3/activities/123'],
    ['PUT', 'https://www.strava.com/api/v3/activities/123']
  ])
  assert.equal(strava.calls[1].auth, 'Bearer tok')
  assert.deepEqual(strava.calls[1].body, { name: 'HP S5D1', description: 'A · Tempo' })
  assert.deepEqual(queries, [['123', 'HP S5D1']])
})

test('annotator: nothing safe to write → no PUT, updated false', async () => {
  const strava = fakeStrava({ activity: { name: 'Rodaje con Ana', description: 'mine' } })
  const annotate = createActivityAnnotator({ getAccessToken: async () => 'tok', fetchImpl: strava.fetchImpl, log: silent })
  const out = await annotate('5', { dryRun: false, name: 'HP', description: 'D' })
  assert.equal(out.updated, false)
  assert.equal(out.current_name, 'Rodaje con Ana')
  assert.equal(out.name_is_default, false)
  assert.equal(out.had_description, true)
  assert.deepEqual(strava.calls.map((c) => c.method), ['GET'])
})

test('annotator: dry_run reports the decision and writes nothing', async () => {
  const strava = fakeStrava()
  const annotate = createActivityAnnotator({ getAccessToken: async () => 'tok', fetchImpl: strava.fetchImpl, log: silent })
  const out = await annotate('5', { dryRun: true, name: 'HP', description: 'D' })
  assert.deepEqual(out, {
    id: '5', current_name: 'Morning Run', name_is_default: true, had_description: false,
    name_changed: true, description_changed: true, dry_run: true, updated: false
  })
  assert.deepEqual(strava.calls.map((c) => c.method), ['GET'])
})

test('annotator: Strava failures map to coarse codes', async () => {
  const run = async (opts) => {
    const strava = fakeStrava(opts)
    const annotate = createActivityAnnotator({ getAccessToken: async () => 'tok', fetchImpl: strava.fetchImpl, log: silent })
    try { await annotate('5', { dryRun: false, description: 'D' }); return null } catch (err) { return [err.status, err.code] }
  }
  assert.deepEqual(await run({ putStatus: 401 }), [409, 'strava_write_scope_missing'])
  assert.deepEqual(await run({ putStatus: 403 }), [409, 'strava_write_scope_missing'])
  assert.deepEqual(await run({ getStatus: 404 }), [404, 'activity_not_found'])
  assert.deepEqual(await run({ getStatus: 401 }), [502, 'strava_auth'])
  assert.deepEqual(await run({ getStatus: 429 }), [429, 'strava_rate_limited'])
  assert.deepEqual(await run({ putStatus: 500 }), [502, 'strava_error'])
  assert.deepEqual(await run({ throwOn: 'GET' }), [502, 'strava_network'])
  const failingToken = createActivityAnnotator({ getAccessToken: async () => { throw new Error('strava token refresh failed: 400') }, fetchImpl: fakeStrava().fetchImpl, log: silent })
  await assert.rejects(failingToken('5', { dryRun: false, description: 'D' }), (err) => err.status === 502 && err.code === 'strava_auth')
})

test('annotator: a failed row update after a successful PUT is logged, not an error', async () => {
  const strava = fakeStrava()
  const lines = []
  const pool = { query: async () => { throw new Error('db down') } }
  const annotate = createActivityAnnotator({ getAccessToken: async () => 'tok', pool, fetchImpl: strava.fetchImpl, log: (l) => lines.push(l) })
  const out = await annotate('5', { dryRun: false, name: 'HP' })
  assert.equal(out.updated, true)
  assert.ok(lines.some((l) => l.includes('strava_annotate_store_failed')))
})

/** The real createHandler with the annotate routes; every other dependency is an inert stub. */
function serve (annotate) {
  const checkBearer = createBearerCheck(TOKEN, { log: silent })
  const noop = async () => {}
  const handler = createHandler({
    token: TOKEN,
    checkBearer,
    maxBodyBytes: 64,
    pool: {},
    ping: noop,
    insertRawPayload: noop,
    syncStatus: { health: () => ({}) },
    stravaEnabled: annotate !== null,
    stravaSync: null,
    foodRoutes: { handle: async () => false },
    stravaAnnotateRoutes: createStravaAnnotateRoutes({ checkBearer, annotate }),
    syncRoutes: { handleSync: noop, handleStatus: noop },
    handleExport: noop,
    handleStravaExport: noop,
    handleAthleteExport: noop
  })
  const server = http.createServer(handler)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`
    resolve({
      close: () => new Promise((r) => server.close(r)),
      async call (method, path, { auth = true, json = true, body } = {}) {
        const headers = {}
        if (auth) headers.authorization = `Bearer ${TOKEN}`
        if (json) headers['content-type'] = 'application/json'
        const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: await res.json() }
      }
    })
  }))
}

test('route: POST /strava/activities/:id/annotate end to end', async (t) => {
  const seen = []
  const app = await serve(async (id, wanted) => { seen.push([id, wanted]); return { id, updated: true } })
  t.after(app.close)

  const ok = await app.call('POST', '/strava/activities/123/annotate', { body: { name: 'HP', dry_run: true } })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body, { ok: true, id: '123', updated: true })
  assert.deepEqual(seen, [['123', { dryRun: true, name: 'HP' }]])

  assert.equal((await app.call('POST', '/strava/activities/123/annotate', { auth: false, body: { name: 'HP' } })).status, 401)
  const noJson = await app.call('POST', '/strava/activities/123/annotate', { json: false, body: { name: 'HP' } })
  assert.deepEqual([noJson.status, noJson.body.error], [415, 'json_required'])
  const bad = await app.call('POST', '/strava/activities/123/annotate', { body: { title: 'HP' } })
  assert.deepEqual([bad.status, bad.body], [400, { error: 'unknown_field', field: 'title' }])
  const get = await app.call('GET', '/strava/activities/123/annotate', { json: false })
  assert.equal(get.status, 405)
  assert.equal((await app.call('POST', '/strava/activities/abc/annotate', { body: { name: 'HP' } })).status, 404)
  assert.equal(seen.length, 1)
})

test('route: Strava errors answer their coarse code', async (t) => {
  const app = await serve(async () => { throw Object.assign(new Error('x'), { status: 409, code: 'strava_write_scope_missing' }) })
  t.after(app.close)
  const res = await app.call('POST', '/strava/activities/1/annotate', { body: { description: 'D' } })
  assert.deepEqual([res.status, res.body], [409, { error: 'strava_write_scope_missing' }])
})

test('route: 409 when Strava is not configured, after the bearer check', async (t) => {
  const app = await serve(null)
  t.after(app.close)
  assert.equal((await app.call('POST', '/strava/activities/1/annotate', { auth: false, body: { name: 'HP' } })).status, 401)
  const res = await app.call('POST', '/strava/activities/1/annotate', { body: { name: 'HP' } })
  assert.deepEqual([res.status, res.body], [409, { error: 'strava not configured' }])
})
