/**
 * The single source of name / sex / birthdate / height (src/profile-db.js) against a real Postgres: the page
 * onboarding (app_profile) keeps only its own fields, the identity lives in the profile document (app_document).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { skip, freshDatabase } from './pg-helper.js'
import { createPool, migrate } from '../../src/db.js'
import { createProfileStore, moveIdentityToDocument } from '../../src/profile-db.js'
import { createDocumentStore } from '../../src/documents-db.js'

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

const cells = (kcal) => ({ rest: { kcal, p: 100, f: 50 }, gym: { kcal, p: 100, f: 50 }, bike: { kcal, p: 100, f: 50 }, bikeLong: { kcal, p: 100, f: 50 } })
const OWN = { weightKg: 60, activity: 'light', goals: ['maintain'], targets: { maintain: cells(1800), cut: cells(1600), bulk: cells(2000) } }
const WIZARD = { name: 'Ana', sex: 'female', birthdate: '1995-03-02', heightCm: 165, ...OWN }

async function reset () {
  await pool.query('DELETE FROM app_profile')
  await pool.query('DELETE FROM app_document')
}
const rawRow = async () => (await pool.query('SELECT data FROM app_profile WHERE id = 1')).rows[0]?.data ?? null

test('a wizard save stores the identity in the profile document and only its own fields in the onboarding row', { skip }, async () => {
  await reset()
  const store = createProfileStore(pool)
  const docs = createDocumentStore(pool)
  assert.equal(await store.getProfile(), null)
  const saved = await store.putProfile(WIZARD)
  const { updatedAt, ...composed } = saved
  assert.deepEqual(composed, WIZARD)
  assert.equal(typeof updatedAt, 'string')
  assert.deepEqual(await rawRow(), OWN, 'no identity field in the onboarding row')
  const doc = await docs.get('profile')
  assert.deepEqual([doc.data, doc.revision], [{ name: 'Ana', sex: 'female', birthdate: '1995-03-02', heightCm: 165 }, 1])
  const { updatedAt: _u, ...read } = await store.getProfile()
  assert.deepEqual(read, WIZARD)
})

test('a wizard save keeps the rest of an existing profile document, its key order, and bumps its revision', { skip }, async () => {
  await reset()
  const docs = createDocumentStore(pool)
  await docs.put('profile', { devices: [{ name: 'Watch' }], heightCm: 180, maxHr: 190 }, 0)
  await createProfileStore(pool).putProfile({ ...WIZARD, name: undefined })
  const doc = await docs.get('profile')
  assert.equal(doc.revision, 2)
  assert.deepEqual(Object.keys(doc.data), ['devices', 'heightCm', 'maxHr', 'sex', 'birthdate'])
  assert.deepEqual(doc.data, { devices: [{ name: 'Watch' }], heightCm: 165, maxHr: 190, sex: 'female', birthdate: '1995-03-02' })
  // a save with the same identity does not write the document again
  await createProfileStore(pool).putProfile({ ...WIZARD, name: undefined })
  assert.equal((await docs.get('profile')).revision, 2)
})

test('a wizard save without a name leaves the document name alone', { skip }, async () => {
  await reset()
  const store = createProfileStore(pool)
  await store.putProfile(WIZARD)
  const { name: _n, ...noName } = WIZARD
  const { updatedAt: _u, ...read } = await store.putProfile(noName)
  assert.equal(read.name, 'Ana')
})

test('the identity is read from the profile document: a coach edit there is what the page sees', { skip }, async () => {
  await reset()
  const store = createProfileStore(pool)
  const docs = createDocumentStore(pool)
  await store.putProfile(WIZARD)
  const doc = await docs.get('profile')
  await docs.put('profile', { ...doc.data, heightCm: 166 }, doc.revision)
  assert.equal((await store.getProfile()).heightCm, 166)
  // no onboarding row: null, whatever the document holds (the owner's case: a profile without the page wizard)
  await pool.query('DELETE FROM app_profile')
  assert.equal(await store.getProfile(), null)
})

test('concurrent wizard and coach saves: no lost update, the document revision counts both', { skip }, async () => {
  await reset()
  const store = createProfileStore(pool)
  const docs = createDocumentStore(pool)
  await docs.put('profile', { devices: [] }, 0)
  const coach = docs.put('profile', { devices: [{ name: 'Edge' }] }, 1)
  const wizard = store.putProfile(WIZARD)
  const [coachRow] = await Promise.all([coach, wizard])
  const doc = await docs.get('profile')
  assert.equal(doc.data.sex, 'female', 'the wizard identity is in the document')
  if (coachRow) {
    // the coach saved first or second: either way both changes are present, at revision 3
    assert.deepEqual(doc.data.devices, [{ name: 'Edge' }])
    assert.equal(doc.revision, 3)
  } else {
    // the coach lost its compare-and-set (the wizard saved first): its push is refused, nothing overwritten
    assert.equal(doc.revision, 2)
  }
})

test('moveIdentityToDocument: an onboarding row from before moves its identity into the document, once', { skip }, async () => {
  await reset()
  const logs = []
  await pool.query('INSERT INTO app_profile (id, data) VALUES (1, $1)', [JSON.stringify(WIZARD)])
  assert.deepEqual(await moveIdentityToDocument(pool, (l) => logs.push(JSON.parse(l))), { moved: ['name', 'sex', 'birthdate', 'heightCm'] })
  assert.deepEqual(await rawRow(), OWN)
  const doc = await createDocumentStore(pool).get('profile')
  assert.deepEqual([doc.data, doc.revision], [{ name: 'Ana', sex: 'female', birthdate: '1995-03-02', heightCm: 165 }, 1])
  assert.deepEqual(logs, [{ event: 'profile_identity_moved', keys: ['name', 'sex', 'birthdate', 'heightCm'], kept: [] }])
  // a second start has nothing to move
  assert.deepEqual(await moveIdentityToDocument(pool, quiet), { moved: [] })
  assert.equal((await createDocumentStore(pool).get('profile')).revision, 1)
  const { updatedAt: _u, ...read } = await createProfileStore(pool).getProfile()
  assert.deepEqual(read, WIZARD)
})

test('moveIdentityToDocument: a value the document already has wins over the old onboarding copy', { skip }, async () => {
  await reset()
  await createDocumentStore(pool).put('profile', { heightCm: 170, devices: [] }, 0)
  await pool.query('INSERT INTO app_profile (id, data) VALUES (1, $1)', [JSON.stringify(WIZARD)])
  const logs = []
  await moveIdentityToDocument(pool, (l) => logs.push(JSON.parse(l)))
  assert.deepEqual(logs, [{ event: 'profile_identity_moved', keys: ['name', 'sex', 'birthdate', 'heightCm'], kept: ['heightCm'] }])
  const doc = await createDocumentStore(pool).get('profile')
  assert.deepEqual(doc.data, { heightCm: 170, devices: [], name: 'Ana', sex: 'female', birthdate: '1995-03-02' })
  assert.equal(doc.revision, 2)
  assert.deepEqual(await rawRow(), OWN)
})

test('moveIdentityToDocument: no onboarding row, or one without identity: nothing written', { skip }, async () => {
  await reset()
  assert.deepEqual(await moveIdentityToDocument(pool, quiet), { moved: [] })
  await pool.query('INSERT INTO app_profile (id, data) VALUES (1, $1)', [JSON.stringify(OWN)])
  assert.deepEqual(await moveIdentityToDocument(pool, quiet), { moved: [] })
  assert.equal(await createDocumentStore(pool).get('profile'), null)
})
