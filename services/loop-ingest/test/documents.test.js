import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createDocumentRoutes, validateDocument, DOCUMENT_KINDS, DOCUMENT_BODY_LIMIT } from '../src/documents.js'
import { createBearerCheck } from '../src/auth.js'

const TOKEN = 't'.repeat(40)
const AUTH = { authorization: `Bearer ${TOKEN}` }
const JSON_AUTH = { ...AUTH, 'content-type': 'application/json' }

const PLAN = { data: {}, targets: {}, dayPlan: {} }
const TRAINING = { days: {} }
const PROFILE = { name: 'Ana' }

/** An in-memory store with the same contract as documents-db.js (revision counter, conditional put). */
function memoryStore () {
  const rows = new Map()
  return {
    rows,
    async get (kind) {
      const r = rows.get(kind)
      return r ? { ...r } : null
    },
    async put (kind, data, expected) {
      const cur = rows.get(kind)
      if ((cur?.revision ?? 0) !== expected) return null
      const row = { data: structuredClone(data), revision: expected + 1, updatedAt: `2030-01-01T00:00:0${expected + 1}.000Z` }
      rows.set(kind, row)
      return { ...row }
    }
  }
}

async function setup ({ available = () => true, store = memoryStore() } = {}) {
  const logs = []
  const routes = createDocumentRoutes({
    store,
    available,
    checkBearer: createBearerCheck(TOKEN, { log: () => {} }),
    log: (line) => logs.push(JSON.parse(line))
  })
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (!(await routes.handle(req, res, url))) {
      res.writeHead(599)
      res.end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    store,
    logs,
    close: () => new Promise((resolve) => server.close(resolve)),
    async call (method, path, { headers = {}, body } = {}) {
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
      const text = await res.text()
      return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers }
    }
  }
}

test('kinds are plan, training and profile', () => {
  assert.deepEqual([...DOCUMENT_KINDS], ['plan', 'training', 'profile'])
})

test('other paths are not handled', async (t) => {
  const s = await setup()
  t.after(s.close)
  assert.equal((await s.call('GET', '/documentsx', { headers: AUTH })).status, 599)
  assert.equal((await s.call('GET', '/food/profile', { headers: AUTH })).status, 599)
})

test('every route needs the bearer token, checked before anything else', async (t) => {
  const s = await setup({ available: () => false })
  t.after(s.close)
  for (const [method, path] of [['GET', '/documents/plan'], ['PUT', '/documents/plan'], ['GET', '/documents/nope'], ['DELETE', '/documents/plan']]) {
    const r = await s.call(method, path)
    assert.equal(r.status, 401, `${method} ${path}`)
    assert.deepEqual(r.body, { error: 'unauthorized' })
  }
  const wrong = await s.call('GET', '/documents/plan', { headers: { authorization: 'Bearer nope' } })
  assert.equal(wrong.status, 401)
  // an unauthenticated upload is never read: the answer closes the connection
  const upload = await s.call('PUT', '/documents/plan', { headers: { 'content-type': 'application/json' }, body: { revision: 0, document: PLAN } })
  assert.equal(upload.status, 401)
  assert.equal(upload.headers.get('connection'), 'close')
})

test('an unknown kind is 404, another method 405 with Allow', async (t) => {
  const s = await setup()
  t.after(s.close)
  const missing = await s.call('GET', '/documents/settings', { headers: AUTH })
  assert.equal(missing.status, 404)
  assert.deepEqual(missing.body, { error: 'not_found' })
  assert.equal((await s.call('GET', '/documents', { headers: AUTH })).status, 404)
  assert.equal((await s.call('GET', '/documents/plan/1', { headers: AUTH })).status, 404)
  const del = await s.call('DELETE', '/documents/plan', { headers: AUTH })
  assert.equal(del.status, 405)
  assert.deepEqual(del.body, { error: 'method_not_allowed' })
  assert.equal(del.headers.get('allow'), 'GET, PUT')
})

test('503 documents_unavailable while the migration group is not ready', async (t) => {
  const s = await setup({ available: () => false })
  t.after(s.close)
  const r = await s.call('GET', '/documents/plan', { headers: AUTH })
  assert.equal(r.status, 503)
  assert.deepEqual(r.body, { error: 'documents_unavailable' })
})

test('GET before the first save: document null, revision 0', async (t) => {
  const s = await setup()
  t.after(s.close)
  for (const kind of DOCUMENT_KINDS) {
    const r = await s.call('GET', `/documents/${kind}`, { headers: AUTH })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body, { kind, document: null, revision: 0, updatedAt: null })
    assert.equal(r.headers.get('cache-control'), 'no-store')
  }
})

test('PUT stores the document, bumps the revision and GET returns it unchanged', async (t) => {
  const s = await setup()
  t.after(s.close)
  const doc = { ...PLAN, page: { title: 'Plan · ñ' }, list: [1, 2.5, null, true] }
  const put = await s.call('PUT', '/documents/plan', { headers: JSON_AUTH, body: { revision: 0, document: doc } })
  assert.equal(put.status, 200)
  assert.deepEqual(put.body, { kind: 'plan', revision: 1, updatedAt: '2030-01-01T00:00:01.000Z' })
  const got = await s.call('GET', '/documents/plan', { headers: AUTH })
  assert.deepEqual(got.body, { kind: 'plan', document: doc, revision: 1, updatedAt: '2030-01-01T00:00:01.000Z' })
  assert.deepEqual(s.store.rows.get('plan').data, doc)
  // the log line has the shape, never the content
  assert.deepEqual(s.logs, [{ event: 'document_saved', kind: 'plan', revision: 1, bytes: Buffer.byteLength(JSON.stringify(doc)) }])
  // the other kinds are untouched
  assert.equal(s.store.rows.has('training'), false)
})

test('a stale revision is 409 revision_conflict with the current revision; nothing changes', async (t) => {
  const s = await setup()
  t.after(s.close)
  await s.call('PUT', '/documents/training', { headers: JSON_AUTH, body: { revision: 0, document: TRAINING } })
  const before = structuredClone(s.store.rows.get('training'))
  for (const revision of [0, 2]) {
    const r = await s.call('PUT', '/documents/training', { headers: JSON_AUTH, body: { revision, document: { days: { x: 1 } } } })
    assert.equal(r.status, 409)
    assert.deepEqual(r.body, { error: 'revision_conflict', revision: 1 })
  }
  assert.deepEqual(s.store.rows.get('training'), before)
  // the INTEGER ceiling itself is a well-formed (if stale) revision
  const ceiling = await s.call('PUT', '/documents/training', { headers: JSON_AUTH, body: { revision: 2 ** 31 - 1, document: TRAINING } })
  assert.deepEqual([ceiling.status, ceiling.body], [409, { error: 'revision_conflict', revision: 1 }])
  const next = await s.call('PUT', '/documents/training', { headers: JSON_AUTH, body: { revision: 1, document: { days: {} } } })
  assert.equal(next.body.revision, 2)
})

test('PUT body checks: JSON content type, valid JSON, revision, document shape, U+0000', async (t) => {
  const s = await setup()
  t.after(s.close)
  const put = (body, headers = JSON_AUTH) => s.call('PUT', '/documents/profile', { headers, body })
  assert.deepEqual(await put({ revision: 0, document: PROFILE }, { ...AUTH, 'content-type': 'text/plain' }).then((r) => [r.status, r.body]), [415, { error: 'unsupported_media_type' }])
  assert.deepEqual(await put('{nope').then((r) => [r.status, r.body]), [400, { error: 'bad_json' }])
  for (const revision of [undefined, -1, 1.5, '0', null, 2 ** 31, 2 ** 40]) {
    const r = await put({ revision, document: PROFILE })
    assert.deepEqual([r.status, r.body], [400, { error: 'invalid', field: 'revision' }], String(revision))
  }
  for (const document of [undefined, null, [], 'x', 3]) {
    const r = await put({ revision: 0, document })
    assert.deepEqual([r.status, r.body], [400, { error: 'invalid', field: 'document' }], JSON.stringify(document))
  }
  const extra = await put({ revision: 0, document: PROFILE, other: 1 })
  assert.deepEqual([extra.status, extra.body], [400, { error: 'invalid', field: 'other' }])
  const nul = await put({ revision: 0, document: { name: 'A\u0000' } })
  assert.deepEqual([nul.status, nul.body], [400, { error: 'invalid', field: 'document', reason: 'nul_character' }])
  assert.equal(s.store.rows.size, 0)
})

test('the body limit is DOCUMENT_BODY_LIMIT (256 KB), far above the 16 KB of the page routes', async (t) => {
  assert.equal(DOCUMENT_BODY_LIMIT, 256 * 1024)
  const s = await setup()
  t.after(s.close)
  // a 40 KB plan (the personal plan is ~36 KB) is accepted
  const big = { ...PLAN, page: { notes: 'x'.repeat(40 * 1024) } }
  assert.equal((await s.call('PUT', '/documents/plan', { headers: JSON_AUTH, body: { revision: 0, document: big } })).status, 200)
  const over = { ...PLAN, page: { notes: 'x'.repeat(DOCUMENT_BODY_LIMIT) } }
  const r = await s.call('PUT', '/documents/plan', { headers: JSON_AUTH, body: { revision: 1, document: over } })
  assert.equal(r.status, 413)
  assert.deepEqual(r.body, { error: 'payload_too_large' })
  assert.equal(s.store.rows.get('plan').revision, 1)
})

test('validateDocument: the structural shape each kind needs (the full check runs in the coach and the build)', () => {
  assert.equal(validateDocument('plan', PLAN), null)
  assert.equal(validateDocument('training', TRAINING), null)
  assert.equal(validateDocument('profile', {}), null)
  for (const key of ['data', 'targets', 'dayPlan']) {
    const doc = { ...PLAN }
    delete doc[key]
    assert.equal(validateDocument('plan', doc), key)
    assert.equal(validateDocument('plan', { ...PLAN, [key]: [] }), key)
  }
  assert.equal(validateDocument('training', {}), 'days')
  assert.equal(validateDocument('training', { days: [] }), 'days')
  for (const kind of DOCUMENT_KINDS) {
    for (const bad of [null, [], 'x', 1]) assert.equal(validateDocument(kind, bad), 'document')
  }
})

test('the tracked example seeds pass the service shape check', async () => {
  const { readFile } = await import('node:fs/promises')
  const root = new URL('../../../', import.meta.url)
  const read = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'))
  assert.equal(validateDocument('plan', await read('data/nutrition/plan-data.example.json')), null)
  assert.equal(validateDocument('training', await read('data/training/training-data.example.json')), null)
  assert.equal(validateDocument('profile', await read('profile/profile.example.json')), null)
})

test('migration 012_documents.sql is its own optional group, idempotent, JSON (key order kept) not JSONB', async () => {
  const { readFile } = await import('node:fs/promises')
  const { CORE_MIGRATIONS, OPTIONAL_MIGRATIONS } = await import('../src/migrations.js')
  assert.deepEqual(OPTIONAL_MIGRATIONS.documents, ['012_documents.sql'])
  assert.ok(!CORE_MIGRATIONS.includes('012_documents.sql'))
  const sql = await readFile(new URL('../sql/012_documents.sql', import.meta.url), 'utf8')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS app_document\b/)
  assert.doesNotMatch(sql, /CREATE TABLE (?!IF NOT EXISTS)/)
  assert.match(sql, /kind\s+TEXT\s+PRIMARY KEY CHECK \(kind IN \('plan', 'training', 'profile'\)\)/)
  assert.match(sql, /data\s+JSON\s+NOT NULL/)
})

test('validateDocument: plan.data is a list or an object of lists per category (the cheap shape rule of lib/nutrition/macros.mjs dataShapeErrors)', () => {
  assert.equal(validateDocument('plan', { data: { x: { y: 1 } }, targets: {}, dayPlan: {} }), 'data')
  assert.equal(validateDocument('plan', { ...PLAN, data: { ...PLAN.data, x: 1 } }), 'data')
  assert.equal(validateDocument('plan', { ...PLAN, data: { ...PLAN.data, x: [null] } }), 'data')
  assert.equal(validateDocument('plan', { ...PLAN, data: { a: [{}], b: { train: [{}], rest: [] } } }), null)
})
