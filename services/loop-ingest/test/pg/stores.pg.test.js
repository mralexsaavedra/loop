/**
 * The service's main DB paths on a real Postgres with the real migrations: ingest insert + export, the food
 * log (products, recipes, entries, settings, profile, through the HTTP routes too), the journal, the Strava
 * upsert / token / HR / athlete tables and the sync status row. No network: Strava payloads are fixtures.
 * Skips without TEST_DATABASE_URL (see pg-helper.js).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { skip, freshDatabase } from './pg-helper.js'
import { createPool, migrate, insertRawPayload, ping } from '../../src/db.js'
import { listRawPayloads, listStravaActivities } from '../../src/export.js'
import { createFoodStore } from '../../src/food-db.js'
import { createFoodRoutes } from '../../src/food.js'
import { createJournalStore } from '../../src/journal-db.js'
import { createJournalRoutes } from '../../src/journal.js'
import { createDocumentStore } from '../../src/documents-db.js'
import { upsertActivities, lastSyncedStart, createTokenStore } from '../../src/strava.js'
import { saveHr, saveFailure, pendingHrActivities } from '../../src/hr-zones.js'
import { saveAthlete, loadAthlete, listDevices } from '../../src/athlete.js'
import { createSyncStatus } from '../../src/status.js'
import { createHandler, databaseConfig } from '../../src/server.js'

const quiet = () => {}
let db, pool
test.before(async () => {
  if (skip) return
  db = await freshDatabase()
  pool = createPool(db.url, { log: quiet })
  await migrate(pool, quiet)
})
test.after(async () => {
  if (skip) return
  await pool.end()
  await db.drop()
})

test('ingest: a payload is stored and paged back by the export query', { skip }, async () => {
  await ping(pool)
  const a = await insertRawPayload(pool, { source: 'health-auto-export', automation: 'shortcut', aggregation: null, period: null, sessionId: 's1', byteSize: 11, payload: { data: [1] } })
  const b = await insertRawPayload(pool, { source: 'health-auto-export', automation: 'shortcut', aggregation: null, period: null, sessionId: 's2', byteSize: 11, payload: { data: [2] } })
  assert.ok(a.received_at instanceof Date)
  const page = await listRawPayloads(pool, { automation: 'shortcut', sinceId: a.id, limit: 10 })
  assert.deepEqual(page.rows.map((r) => [String(r.id), r.payload]), [[String(b.id), { data: [2] }]])
  assert.equal(page.more, false)
})

test('food store: products (barcode unique among active ones), recipes, entries (request id makes a retry idempotent), settings, profile', { skip }, async () => {
  const store = createFoodStore(pool)
  const yog = { name: 'Yogur', brand: 'Hacendado', store: 'mercadona', barcode: '8480000123456', unit: 'g', per100: { kcal: 60, protein: 10, carbs: 4, fat: 0.2 }, servingSize: 125, source: 'label' }
  const p = await store.insertProduct(yog)
  assert.equal(p.name, 'Yogur')
  assert.deepEqual(p.per100, { kcal: 60, protein: 10, carbs: 4, fat: 0.2 }, 'NUMERIC comes back as numbers')
  await assert.rejects(store.insertProduct(yog), (e) => e.status === 409 && e.code === 'barcode_exists')
  assert.equal((await store.updateProduct(p.id, { ...yog, name: 'Yogur natural' })).name, 'Yogur natural')
  assert.equal(await store.archiveProduct(p.id), true)
  assert.equal(await store.archiveProduct(p.id), false)
  const again = await store.insertProduct(yog) // an archived barcode may be re-added
  assert.deepEqual((await store.listProducts()).map((x) => x.id), [again.id])
  assert.equal((await store.getProducts([p.id, again.id])).length, 2, 'archived ones are still readable')

  const r = await store.insertRecipe({ name: 'Bowl', kind: 'serving', servings: 2, ingredients: [{ productId: again.id, amount: 250 }] })
  assert.deepEqual(r.ingredients, [{ productId: again.id, amount: 250 }])
  assert.equal((await store.updateRecipe(r.id, { name: 'Bowl 2', kind: 'batch', cookedWeightG: 500, ingredients: [] })).cookedWeightG, 500)
  assert.equal(await store.archiveRecipe(r.id), true)
  assert.deepEqual(await store.listRecipes(), [])

  const entry = { date: '2030-01-10', meal: 'breakfast', refType: 'product', refId: again.id, label: 'Yogur', amount: 125, unit: 'g', kcal: 75, protein: 12.5, carbs: 5, fat: 0.3, requestId: 'req-00000001' }
  const e1 = await store.insertLog(entry)
  assert.equal(await store.insertLog(entry), null, 'the same request id is not inserted twice')
  assert.equal((await store.getLogByRequest('req-00000001')).id, e1.id)
  await store.insertLog({ ...entry, refType: 'quick', refId: null, requestId: null, protein: null, carbs: null, fat: null, date: '2030-01-11' })
  assert.deepEqual((await store.listLog('2030-01-10')).map((x) => x.id), [e1.id])
  assert.deepEqual((await store.listLogRange('2030-01-01', '2030-01-31')).map((x) => x.date), ['2030-01-10', '2030-01-11'])
  assert.equal(await store.deleteLog(e1.id), true)
  assert.equal(await store.deleteLog(e1.id), false)
  await assert.rejects(store.insertLog({ ...entry, requestId: null, meal: 'brunch' }), /food_log_meal_check/, 'the CHECK constraints hold')

  assert.deepEqual(await store.getSettings(), { goal: null, targetWeightKg: null, updatedAt: null }, 'no row yet = nothing set')
  const first = await store.updateSettings({ goal: 'cut' })
  assert.deepEqual([first.goal, first.targetWeightKg, typeof first.updatedAt], ['cut', null, 'string'])
  const s = await store.updateSettings({ targetWeightKg: 70.5 })
  assert.deepEqual([s.goal, s.targetWeightKg], ['cut', 70.5], 'a partial update keeps the other key')
  assert.equal((await store.updateSettings({ targetWeightKg: null })).targetWeightKg, null)

  assert.equal(await store.getProfile(), null)
  const { updatedAt, ...doc } = await store.putProfile({ sex: 'f', heightCm: 165 })
  assert.deepEqual([doc, typeof updatedAt], [{ sex: 'f', heightCm: 165 }, 'string'])
  const { updatedAt: _u, ...replaced } = await store.putProfile({ sex: 'm' })
  assert.deepEqual(replaced, { sex: 'm' }, 'a put replaces the whole document')
})

test('journal store: a day upserts, lists by range, deletes; the disabled list round-trips', { skip }, async () => {
  const store = createJournalStore(pool)
  assert.equal(await store.getDay('2030-01-10'), null)
  await store.putDay({ date: '2030-01-10', answers: { alcohol: 2 }, notes: null })
  const d = await store.putDay({ date: '2030-01-10', answers: { alcohol: 0, lateCaffeine: true }, notes: 'ok' })
  assert.deepEqual([d.answers, d.notes], [{ alcohol: 0, lateCaffeine: true }, 'ok'])
  await store.putDay({ date: '2030-01-12', answers: {}, notes: null })
  assert.deepEqual((await store.listRange('2030-01-01', '2030-01-11')).map((x) => x.date), ['2030-01-10'])
  await store.deleteDay('2030-01-10')
  assert.equal(await store.getDay('2030-01-10'), null)
  assert.deepEqual(await store.getDisabled(), [])
  assert.deepEqual(await store.setDisabled(['alcohol']), ['alcohol'])
  assert.deepEqual(await store.getDisabled(), ['alcohol'])
})

test('document store: compare-and-set on the revision, key order kept, one winner per race', { skip }, async () => {
  const store = createDocumentStore(pool)
  assert.equal(await store.get('plan'), null)
  // keys deliberately out of sorted order: JSONB would reorder them, the JSON column must not
  const doc = { zeta: 1, data: { postre: [1], desayuno: [2], a: 3 }, targets: {}, dayPlan: {} }
  const first = await store.put('plan', doc, 0)
  assert.equal(first.revision, 1)
  assert.match(first.updatedAt, /^\d{4}-\d{2}-\d{2}T/)
  const got = await store.get('plan')
  assert.equal(JSON.stringify(got.data), JSON.stringify(doc))
  assert.equal(got.revision, 1)
  assert.equal(await store.put('plan', doc, 0), null, 'a second first-save loses')
  assert.equal(await store.put('plan', doc, 5), null, 'a wrong revision loses')
  assert.equal((await store.get('plan')).revision, 1)
  const results = await Promise.all([store.put('plan', { ...doc, n: 1 }, 1), store.put('plan', { ...doc, n: 2 }, 1)])
  assert.equal(results.filter(Boolean).length, 1, 'exactly one concurrent save wins')
  assert.equal((await store.get('plan')).revision, 2)
  // kinds are independent and the CHECK refuses others
  assert.equal(await store.get('training'), null)
  await assert.rejects(store.put('settings', {}, 0))
})

test('strava: activities upsert (an edit replaces the payload), the token rotates, HR rows and their retry state, the athlete snapshot', { skip }, async () => {
  const ride = { id: 101, start_date_local: '2030-01-10T08:00:00Z', start_date: '2030-01-10T07:00:00Z', sport_type: 'Ride', name: 'Morning', has_heartrate: true, distance: 30000, device_name: 'Edge 840' }
  const run = { id: 102, start_date_local: '2030-01-11T08:00:00Z', type: 'Run', name: 'Run', has_heartrate: true }
  assert.equal(await upsertActivities(pool, [ride, run]), 2)
  assert.equal(await upsertActivities(pool, [{ ...ride, name: 'Edited', distance: 31000 }]), 1)
  const rows = await listStravaActivities(pool, { sinceId: 0, limit: 10 })
  assert.deepEqual(rows.map((r) => [r.id, r.sport_type, r.distance]), [['101', 'Ride', 31000], ['102', 'Run', null]])
  const { rows: [{ synced }] } = await pool.query('SELECT last_synced_at IS NOT NULL AS synced FROM strava_sync_state')
  assert.equal(synced, true)
  assert.ok(await lastSyncedStart(pool))

  const tokens = createTokenStore(pool)
  assert.equal(await tokens.load(), null)
  await tokens.save('rt-1')
  await tokens.save('rt-2')
  assert.equal(await tokens.load(), 'rt-2')

  assert.deepEqual((await pendingHrActivities(pool, 10)).map((x) => x.id), ['102', '101'])
  await saveHr(pool, 101, { status: 'ok', hist: { 120: 60 }, seconds: 60 })
  assert.equal(await saveFailure(pool, 102, 1), 'retry')
  assert.deepEqual((await pendingHrActivities(pool, 10)).map((x) => x.id), [], 'a fresh retry waits for its back-off')
  assert.equal(await saveFailure(pool, 102, 5), 'failed')
  assert.deepEqual((await listStravaActivities(pool, { sinceId: 0, limit: 1 }))[0].hr_hist, { 120: 60 })

  await saveAthlete(pool, { athlete: { id: 9 }, gear: { bikes: [{ id: 'b1' }], shoes: [] }, gearScopeMissing: false })
  const a = await loadAthlete(pool)
  assert.deepEqual([a.athlete, a.gear.bikes.length, a.gear_scope_missing], [{ id: 9 }, 1, false])
  assert.deepEqual((await listDevices(pool)).map((d) => d.name), ['Edge 840'])
})

test('sync status: the row persists and a fresh status loads it back', { skip }, async () => {
  const s = createSyncStatus({ pool, stravaConfigured: true, log: quiet })
  await s.load()
  await s.recordStravaOk()
  await s.recordTrigger(s.nextTriggerSeq())
  const t = createSyncStatus({ pool, stravaConfigured: true, log: quiet })
  await t.load()
  assert.equal(t.currentSeq(), 1)
  assert.ok(t.lastTriggerAtMs() > 0)
})

test('HTTP: the food and journal routes write through to Postgres', { skip }, async () => {
  const foodRoutes = createFoodRoutes({ store: createFoodStore(pool), off: {}, available: () => true, settingsAvailable: () => true, profileAvailable: () => true, allowedHosts: [] })
  const journalRoutes = createJournalRoutes({ store: createJournalStore(pool), available: () => true, allowedHosts: [] })
  const server = http.createServer(createHandler({ token: 'x'.repeat(32), maxBodyBytes: 1024, pool, ping, insertRawPayload, syncStatus: { health: () => ({}) }, foodRoutes, journalRoutes }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const call = async (method, path, body, extra = {}) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'x-hc-food': '1', 'x-hc-journal': '1', 'content-type': 'application/json', ...extra }, body: body && JSON.stringify(body)
    })
    return { status: res.status, body: await res.json() }
  }
  try {
    assert.equal((await call('GET', '/healthz')).status, 200)
    const p = await call('POST', '/food/products', { name: 'Oats', store: 'other', unit: 'g', per100: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 }, source: 'manual' })
    assert.equal(p.status, 201)
    const e = await call('POST', '/food/log', { date: '2030-02-01', meal: 'breakfast', refType: 'product', refId: p.body.product.id, amount: 50, unit: 'g' })
    assert.equal(e.status, 201)
    const day = await call('GET', '/food/log?date=2030-02-01')
    assert.deepEqual([day.status, day.body.entries.length, day.body.totals.kcal], [200, 1, 186])
    // a serving logged within amountMax whose snapshot overflows NUMERIC(7,1) / NUMERIC(6,1): 400, not a 500
    const big = await call('POST', '/food/products', { name: 'Big', store: 'other', unit: 'g', per100: { kcal: 900, protein: 0, carbs: 0, fat: 100 }, servingSize: 5000, source: 'manual' })
    const over = await call('POST', '/food/log', { date: '2030-02-01', meal: 'lunch', refType: 'product', refId: big.body.product.id, amount: 30, unit: 'serving' })
    assert.deepEqual([over.status, over.body], [400, { error: 'invalid', field: 'amount' }])
    const edge = await call('POST', '/food/log', { date: '2030-02-01', meal: 'lunch', refType: 'product', refId: big.body.product.id, amount: 19.9, unit: 'serving' })
    assert.deepEqual([edge.status, edge.body.entry.fat], [201, 99500], 'the largest storable amounts still log')
    const j = await call('PUT', '/journal/day', { date: '2030-02-01', answers: { alcohol: 1 } })
    assert.equal(j.status, 200)
    assert.deepEqual((await createJournalStore(pool).getDay('2030-02-01')).answers, { alcohol: 1 })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('a password with URL-special characters connects through databaseConfig (the compose fields), no encoding', { skip }, async () => {
  const password = 'p@ss:w/rd?#%41 x'
  const role = `loop_pw_${process.pid}`
  await pool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`)
  const u = new URL(db.url)
  const other = createPool(databaseConfig({ DB_HOST: u.hostname, DB_PORT: u.port, POSTGRES_USER: role, POSTGRES_PASSWORD: password, POSTGRES_DB: db.name }), { log: quiet })
  try {
    const { rows: [{ who }] } = await other.query('SELECT current_user AS who')
    assert.equal(who, role)
  } finally {
    await other.end()
    await pool.query(`DROP ROLE ${role}`)
  }
})

test('strava (C1): a first pull cut by a 429 keeps the stored pages and the next run resumes from them', { skip }, async () => {
  const { createStravaSync } = await import('../../src/sync.js')
  await pool.query('TRUNCATE strava_activity CASCADE')
  const day = (i) => new Date(Date.UTC(2021, 0, 1) + i * 86_400_000).toISOString().replace('.000Z', 'Z')
  const afters = []
  let calls = 0
  const fetchImpl = async (url) => {
    const u = new URL(String(url))
    if (u.pathname.endsWith('/oauth/token')) return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 }) }
    if (u.pathname.endsWith('/athlete/activities')) {
      calls += 1
      afters.push(Number(u.searchParams.get('after')))
      if (calls === 2) return { ok: false, status: 429 }
      if (calls === 1) return { ok: true, status: 200, json: async () => Array.from({ length: 100 }, (_, i) => ({ id: 9000 + i, start_date_local: day(i), sport_type: 'Ride', name: `r${i}` })) }
      return { ok: true, status: 200, json: async () => [{ id: 9999, start_date_local: day(150), sport_type: 'Run', name: 'last' }] }
    }
    return { ok: false, status: 500 }
  }
  const sync = createStravaSync(pool, { STRAVA_CLIENT_ID: 'i', STRAVA_CLIENT_SECRET: 's', STRAVA_REFRESH_TOKEN: 'r' }, { fetchImpl, log: quiet })
  await assert.rejects(sync.runOnce(), (err) => err.rateLimited === true)
  const count = async () => Number((await pool.query('SELECT count(*) AS n FROM strava_activity')).rows[0].n)
  assert.equal(await count(), 100, 'page 1 committed before the 429')
  assert.equal(afters[0], 0)
  const resumed = await sync.runOnce()
  assert.equal(resumed.count, 1)
  // start_local is a timestamp WITHOUT time zone, read back in the process's zone: within a day of the
  // newest stored start minus the 7-day overlap (the overlap absorbs the offset), never 0 (page 1 again)
  assert.equal(afters[2], resumed.since)
  assert.ok(Math.abs(resumed.since - (Date.parse(day(99)) / 1000 - 7 * 86_400)) <= 14 * 3600, `resumed from MAX(start_local) minus the overlap (${resumed.since})`)
  assert.equal(await count(), 101)
  await sync.hrIdle()
})

test('ingest (C3): Postgres jsonb refuses U+0000, which is why the route answers 400 before inserting', { skip }, async () => {
  await assert.rejects(
    insertRawPayload(pool, { source: 'health-auto-export', automation: null, aggregation: null, period: null, sessionId: null, byteSize: 1, payload: { a: 'x\u0000' } }),
    /unsupported Unicode escape sequence/
  )
})

test('food / journal / profile text with U+0000: Postgres refuses it (22021), so the routes answer 400 invalid, never 500', { skip }, async () => {
  await assert.rejects(pool.query('SELECT $1::text', ['a\u0000b']), (err) => err.code === '22021')
  const foodRoutes = createFoodRoutes({ store: createFoodStore(pool), off: {}, available: () => true, settingsAvailable: () => true, profileAvailable: () => true, allowedHosts: [] })
  const journalRoutes = createJournalRoutes({ store: createJournalStore(pool), available: () => true, allowedHosts: [] })
  const server = http.createServer(createHandler({ token: 'x'.repeat(32), maxBodyBytes: 1024, pool, ping, insertRawPayload, syncStatus: { health: () => ({}) }, foodRoutes, journalRoutes }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const call = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'x-hc-food': '1', 'x-hc-journal': '1', 'content-type': 'application/json' }, body: JSON.stringify(body)
    })
    return [res.status, await res.json()]
  }
  try {
    assert.deepEqual(await call('POST', '/food/products', { name: 'Oats\u0000', store: 'other', unit: 'g', per100: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 }, source: 'manual' }),
      [400, { error: 'invalid', field: 'name' }])
    assert.deepEqual(await call('POST', '/food/log', { date: '2030-02-02', meal: 'snack', refType: 'quick', label: 'x\u0000', kcal: 10 }), [400, { error: 'invalid', field: 'label' }])
    assert.deepEqual(await call('PUT', '/journal/day', { date: '2030-02-02', answers: {}, notes: 'n\u0000' }), [400, { error: 'invalid', field: 'notes' }])
    const targets = Object.fromEntries(['maintain', 'cut', 'bulk'].map((g) => [g, Object.fromEntries(['rest', 'gym', 'bike', 'bikeLong'].map((d) => [d, { kcal: 2200, p: 140, f: 70 }]))]))
    assert.deepEqual(await call('PUT', '/food/profile', { name: 'A\u0000', sex: 'male', birthdate: '1990-01-01', heightCm: 180, weightKg: 75, activity: 'active', goals: ['maintain'], targets }),
      [400, { error: 'invalid', field: 'name' }])
    const quick = await call('POST', '/food/log', { date: '2030-02-02', meal: 'snack', refType: 'quick', label: 'tab\there', kcal: 10 })
    assert.equal(quick[0], 201, 'a tab is fine (collapsed to a space)')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('export (C2): a page stops once the stored byte_size sum passes the budget, at least one row, more = true; paging on reaches every row', { skip }, async () => {
  const ids = []
  for (const size of [600, 600, 600, 5000, 10]) {
    ids.push(String((await insertRawPayload(pool, { source: 'health-auto-export', automation: 'budget', aggregation: null, period: null, sessionId: null, byteSize: size, payload: { size } })).id))
  }
  const one = await listRawPayloads(pool, { automation: 'budget', sinceId: '0', limit: 500, maxBytes: 1000 })
  assert.deepEqual([one.rows.map((r) => String(r.id)), one.more], [ids.slice(0, 2), true], '600 before the 2nd row (< 1000): sent; 1200 before the 3rd')
  const two = await listRawPayloads(pool, { automation: 'budget', sinceId: ids[1], limit: 500, maxBytes: 1000 })
  assert.deepEqual([two.rows.map((r) => String(r.id)), two.more], [ids.slice(2, 4), true], 'a 5000-byte row after 600 still goes: the budget is checked before each row')
  const big = await listRawPayloads(pool, { automation: 'budget', sinceId: ids[2], limit: 500, maxBytes: 1000 })
  assert.deepEqual([big.rows.map((r) => String(r.id)), big.more], [[ids[3]], true], 'one row over the budget alone')
  const last = await listRawPayloads(pool, { automation: 'budget', sinceId: ids[3], limit: 500, maxBytes: 1000 })
  assert.deepEqual([last.rows.map((r) => String(r.id)), last.more], [[ids[4]], false])
  const limited = await listRawPayloads(pool, { automation: 'budget', sinceId: '0', limit: 2 })
  assert.deepEqual([limited.rows.length, limited.more], [2, false], 'the default 32 MB budget: only the row limit cut it')
})
