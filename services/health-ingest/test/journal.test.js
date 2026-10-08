import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createJournalRoutes, validateDay } from '../src/journal.js'
import { JOURNAL_BEHAVIORS } from '../src/journal-calc.js'

/** In-memory stand-in for src/journal-db.js createJournalStore (same method contract). */
function memoryStore () {
  const db = { days: new Map(), disabled: null }
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))
  return {
    db,
    async getDay (date) { return clone(db.days.get(date) ?? null) },
    async putDay (d) {
      const row = { date: d.date, answers: clone(d.answers), notes: d.notes, updatedAt: '2030-01-10T12:00:00.000Z' }
      db.days.set(d.date, row)
      return clone(row)
    },
    async deleteDay (date) { db.days.delete(date) },
    async listRange (from, to) {
      return clone([...db.days.values()].filter((d) => d.date >= from && d.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1)))
    },
    async getDisabled () { return clone(db.disabled ?? []) },
    async setDisabled (list) { db.disabled = clone(list); return clone(list) }
  }
}

async function setup ({ store = memoryStore(), available, writeLimit, summaryLimit, allowedHosts, log = () => {} } = {}) {
  const routes = createJournalRoutes({ store, available, writeLimit, summaryLimit, allowedHosts, log })
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (!(await routes.handle(req, res, url))) { res.writeHead(404); res.end('{"error":"outer"}') }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  async function call (method, path, { body, headers = {}, raw } = {}) {
    const h = { 'x-hc-journal': '1', ...headers }
    let payload
    if (raw !== undefined) payload = raw
    else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] ??= 'application/json' }
    const res = await fetch(base + path, { method, headers: h, body: payload })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  function rawCall (method, path, { host, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path, headers: { 'x-hc-journal': '1', host, ...headers } }, (res) => {
        let text = ''
        res.on('data', (c) => { text += c })
        res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }))
      })
      req.on('error', reject)
      req.end()
    })
  }
  return { store, call, rawCall, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('only /journal and /journal/* are handled; other paths fall through', async (t) => {
  const s = await setup()
  t.after(s.close)
  const r = await s.call('GET', '/food/products')
  assert.equal(r.status, 404)
  assert.deepEqual(r.body, { error: 'outer' })
  assert.equal((await s.call('GET', '/journal/nope')).status, 404)
})

test('a missing X-HC-Journal header is 403; a foreign Host 421; a foreign Origin on a write 403', async (t) => {
  const s = await setup()
  t.after(s.close)
  assert.equal((await s.call('GET', '/journal/settings', { headers: { 'x-hc-journal': '0' } })).status, 403)
  assert.equal((await s.rawCall('GET', '/journal/settings', { host: 'evil.example' })).status, 421)
  assert.equal((await s.rawCall('GET', '/journal/settings', { host: 'host.docker.internal' })).status, 200)
  const w = await s.call('PUT', '/journal/day', { body: { date: '2030-01-10', answers: {} }, headers: { origin: 'http://evil.example' } })
  assert.deepEqual([w.status, w.body.error], [403, 'forbidden_origin'])
})

test('writes need application/json (415); bodies over 16 KB are 413; bad JSON 400', async (t) => {
  const s = await setup()
  t.after(s.close)
  const r = await s.call('PUT', '/journal/day', { raw: '{}', headers: { 'content-type': 'text/plain' } })
  assert.equal(r.status, 415)
  const big = await s.call('PUT', '/journal/day', { raw: JSON.stringify({ date: '2030-01-10', notes: 'x'.repeat(17 * 1024) }), headers: { 'content-type': 'application/json' } })
  assert.equal(big.status, 413)
  const bj = await s.call('PUT', '/journal/day', { raw: '{nope', headers: { 'content-type': 'application/json' } })
  assert.deepEqual([bj.status, bj.body.error], [400, 'bad_json'])
})

test('the group being unavailable answers 503 journal_unavailable on known paths only', async (t) => {
  const s = await setup({ available: () => false })
  t.after(s.close)
  assert.deepEqual(await s.call('GET', '/journal/day?date=2030-01-10'), { status: 503, body: { error: 'journal_unavailable' } })
  assert.equal((await s.call('GET', '/journal/nope')).status, 404)
})

test('a wrong method is 405 with Allow', async (t) => {
  const s = await setup()
  t.after(s.close)
  const r = await s.call('DELETE', '/journal/day')
  assert.equal(r.status, 405)
})

test('GET day of a never-journaled date is an empty day; PUT stores it and is idempotent', async (t) => {
  const s = await setup()
  t.after(s.close)
  const empty = await s.call('GET', '/journal/day?date=2030-01-10')
  assert.deepEqual(empty, { status: 200, body: { day: { date: '2030-01-10', answers: {}, notes: null, updatedAt: null } } })
  const body = { date: '2030-01-10', answers: { alcohol: 2, nap: false, screen_in_bed: true }, notes: '  late  work dinner ' }
  const a = await s.call('PUT', '/journal/day', { body })
  assert.equal(a.status, 200)
  assert.deepEqual(a.body.day.answers, { alcohol: 2, nap: false, screen_in_bed: true })
  assert.equal(a.body.day.notes, 'late work dinner')
  const b = await s.call('PUT', '/journal/day', { body })
  assert.deepEqual(b.body.day, a.body.day)
  assert.equal(s.store.db.days.size, 1)
  const g = await s.call('GET', '/journal/day?date=2030-01-10')
  assert.deepEqual(g.body.day.answers, { alcohol: 2, nap: false, screen_in_bed: true })
})

test('PUT with no answer and no note removes the day (not journaled again)', async (t) => {
  const s = await setup()
  t.after(s.close)
  await s.call('PUT', '/journal/day', { body: { date: '2030-01-10', answers: { nap: true } } })
  const r = await s.call('PUT', '/journal/day', { body: { date: '2030-01-10', answers: { nap: null }, notes: '' } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.day, { date: '2030-01-10', answers: {}, notes: null, updatedAt: null })
  assert.equal(s.store.db.days.size, 0)
})

test('validateDay: strict keys, real dates, yes/no booleans, drink counts 0..20, notes <= 500', () => {
  const field = (fn) => { try { fn(); return null } catch (e) { return e.field } }
  assert.equal(field(() => validateDay({ date: '2030-02-31', answers: {} })), 'date')
  assert.equal(field(() => validateDay({ date: '2030-01-10', answers: {}, extra: 1 })), 'extra')
  assert.equal(field(() => validateDay({ date: '2030-01-10', answers: [] })), 'answers')
  assert.equal(field(() => validateDay({ date: '2030-01-10', answers: { coffee: true } })), 'answers.coffee')
  assert.equal(field(() => validateDay({ date: '2030-01-10', answers: { nap: 1 } })), 'answers.nap')
  assert.equal(field(() => validateDay({ date: '2030-01-10', answers: { alcohol: true } })), 'answers.alcohol')
  assert.equal(field(() => validateDay({ date: '2030-01-10', answers: { alcohol: 1.5 } })), 'answers.alcohol')
  assert.equal(field(() => validateDay({ date: '2030-01-10', answers: { alcohol: 21 } })), 'answers.alcohol')
  assert.equal(field(() => validateDay({ date: '2030-01-10', answers: { alcohol: -1 } })), 'answers.alcohol')
  assert.equal(field(() => validateDay({ date: '2030-01-10', answers: {}, notes: 'x'.repeat(501) })), 'notes')
  assert.equal(field(() => validateDay({ date: '2030-01-10', answers: {}, notes: 5 })), 'notes')
  assert.deepEqual(validateDay({ date: '2030-01-10', answers: { alcohol: 0, ill: false } }), { date: '2030-01-10', answers: { alcohol: 0, ill: false }, notes: null })
  // every behaviour accepts its own kind
  const all = Object.fromEntries(JOURNAL_BEHAVIORS.map((b) => [b.key, b.kind === 'count' ? 20 : true]))
  assert.deepEqual(validateDay({ date: '2030-01-10', answers: all }).answers, all)
})

test('an invalid PUT answers 400 invalid with the field', async (t) => {
  const s = await setup()
  t.after(s.close)
  const r = await s.call('PUT', '/journal/day', { body: { date: '2030-01-10', answers: { alcohol: 'two' } } })
  assert.deepEqual(r, { status: 400, body: { error: 'invalid', field: 'answers.alcohol' } })
  assert.deepEqual((await s.call('GET', '/journal/day?date=nope')).body, { error: 'invalid', field: 'date' })
})

test('GET summary returns the journaled days in range, sorted; range capped at 366 days', async (t) => {
  const s = await setup()
  t.after(s.close)
  await s.call('PUT', '/journal/day', { body: { date: '2030-01-12', answers: { nap: true } } })
  await s.call('PUT', '/journal/day', { body: { date: '2030-01-10', answers: { alcohol: 3 }, notes: 'party' } })
  await s.call('PUT', '/journal/day', { body: { date: '2030-03-10', answers: { ill: true } } })
  const r = await s.call('GET', '/journal/summary?from=2030-01-01&to=2030-01-31')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.days.map((d) => d.date), ['2030-01-10', '2030-01-12'])
  assert.deepEqual(r.body.days[0], { date: '2030-01-10', answers: { alcohol: 3 }, notes: 'party' })
  assert.equal((await s.call('GET', '/journal/summary?from=2030-01-01&to=2031-01-02')).status, 400)
  assert.equal((await s.call('GET', '/journal/summary?from=2030-01-10&to=2030-01-09')).status, 400)
  assert.equal((await s.call('GET', '/journal/summary?from=2030-01-01&to=2031-01-01')).status, 200)
})

test('summary reads are rate limited (429) apart from writes', async (t) => {
  const s = await setup({ summaryLimit: 2 })
  t.after(s.close)
  const q = '/journal/summary?from=2030-01-01&to=2030-01-31'
  assert.equal((await s.call('GET', q)).status, 200)
  assert.equal((await s.call('GET', q)).status, 200)
  assert.deepEqual(await s.call('GET', q), { status: 429, body: { error: 'rate_limited' } })
})

test('writes are rate limited per client (429)', async (t) => {
  const s = await setup({ writeLimit: 1 })
  t.after(s.close)
  assert.equal((await s.call('PUT', '/journal/day', { body: { date: '2030-01-10', answers: {} } })).status, 200)
  assert.equal((await s.call('PUT', '/journal/day', { body: { date: '2030-01-10', answers: {} } })).status, 429)
})

test('settings: every behaviour on by default; PUT is a partial on/off merge; unknown keys refused', async (t) => {
  const s = await setup()
  t.after(s.close)
  const g = await s.call('GET', '/journal/settings')
  assert.equal(g.status, 200)
  assert.deepEqual(g.body.behaviors, Object.fromEntries(JOURNAL_BEHAVIORS.map((b) => [b.key, true])))
  const p = await s.call('PUT', '/journal/settings', { body: { behaviors: { nap: false, ill: false } } })
  assert.equal(p.status, 200)
  assert.equal(p.body.behaviors.nap, false)
  assert.equal(p.body.behaviors.ill, false)
  assert.equal(p.body.behaviors.alcohol, true)
  const p2 = await s.call('PUT', '/journal/settings', { body: { behaviors: { nap: true } } })
  assert.equal(p2.body.behaviors.nap, true)
  assert.equal(p2.body.behaviors.ill, false)
  assert.deepEqual(s.store.db.disabled, ['ill'])
  assert.deepEqual((await s.call('PUT', '/journal/settings', { body: { behaviors: { coffee: false } } })).body, { error: 'invalid', field: 'behaviors.coffee' })
  assert.deepEqual((await s.call('PUT', '/journal/settings', { body: { behaviors: { nap: 'no' } } })).body, { error: 'invalid', field: 'behaviors.nap' })
  assert.deepEqual((await s.call('PUT', '/journal/settings', { body: { other: 1 } })).body, { error: 'invalid', field: 'other' })
})

test('a store failure is a coarse 500 internal, logged without data', async (t) => {
  const logged = []
  const store = memoryStore()
  store.getDay = async () => { throw new Error('relation "journal_day" does not exist') }
  const s = await setup({ store, log: (l) => logged.push(JSON.parse(l)) })
  t.after(s.close)
  assert.deepEqual(await s.call('GET', '/journal/day?date=2030-01-10'), { status: 500, body: { error: 'internal' } })
  assert.equal(logged[0].event, 'journal_error')
})

test('prototype keys never pass as behaviours (answers and settings)', async (t) => {
  const field = (fn) => { try { fn(); return null } catch (e) { return e.field } }
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const answers = JSON.parse(`{"${k}": true}`)
    assert.equal(field(() => validateDay({ date: '2030-01-10', answers })), `answers.${k}`, k)
  }
  const s = await setup()
  t.after(s.close)
  for (const raw of ['{"behaviors":{"__proto__":false}}', '{"behaviors":{"constructor":false}}']) {
    const r = await s.call('PUT', '/journal/settings', { raw, headers: { 'content-type': 'application/json' } })
    assert.equal(r.status, 400, raw)
    assert.equal(r.body.error, 'invalid')
  }
  const d = await s.call('PUT', '/journal/day', { raw: '{"date":"2030-01-10","answers":{"__proto__":{"nap":true}}}', headers: { 'content-type': 'application/json' } })
  assert.deepEqual(d.body, { error: 'invalid', field: 'answers.__proto__' })
  assert.equal(s.store.db.days.size, 0)
})

test('notes keep their line breaks (spaces trimmed, at most one blank line)', () => {
  const d = validateDay({ date: '2030-01-10', answers: {}, notes: '  line one  \r\n\r\n\r\n  line   two \n' })
  assert.equal(d.notes, 'line one\n\nline two')
})
