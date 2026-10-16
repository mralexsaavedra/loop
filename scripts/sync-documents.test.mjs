import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, DOCUMENT_FILES } from './sync-documents.mjs';

const PLAN = { data: { postre: [1], desayuno: [2] }, targets: {}, dayPlan: {} };
const TRAINING = { days: { '2030-01-01': { focus: 'x', blocks: [{ title: 't', lines: ['l'] }] } } };
const PROFILE = { birthdate: '1990-01-01', devices: [] };

/** A fake service: `docs` maps kind -> {status?, body?}; every request is recorded with its auth header. */
function run(docs, { root, env = {} } = {}) {
  const dir = root || fs.mkdtempSync(path.join(os.tmpdir(), 'hc-documents-'));
  const logs = []; const warns = []; const calls = [];
  const fetchImpl = async (url, init) => {
    const kind = url.split('/').pop();
    calls.push([url, init.headers.authorization, init.redirect]);
    const d = docs[kind] ?? { status: 404 };
    const status = d.status ?? 200;
    return { ok: status === 200, status, json: async () => d.body };
  };
  const fullEnv = { SYNC_DOCUMENTS_ROOT: dir, INGEST_URL: 'http://localhost:8089', INGEST_TOKEN: 'tok', ...env };
  return main({ env: fullEnv, log: (l) => logs.push(l), warn: (w) => warns.push(w), fetchImpl })
    .then((code) => ({ code, dir, logs, warns, calls }));
}
const body = (kind, document, revision = 1) => ({ body: { kind, document, revision, updatedAt: '2030-01-01T00:00:00.000Z' } });
const all = () => ({ plan: body('plan', PLAN), training: body('training', TRAINING), profile: body('profile', PROFILE) });
const read = (dir, kind) => fs.readFileSync(path.join(dir, DOCUMENT_FILES[kind]), 'utf8');

test('the three documents and the clone files they become', () => {
  assert.deepEqual(DOCUMENT_FILES, {
    profile: 'profile/profile.json',
    plan: 'data/nutrition/plan-data.json',
    training: 'data/training/training-data.json',
  });
});

test('each document is fetched with the bearer token and written to its file (2-space JSON, key order kept)', async () => {
  const r = await run(all());
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls, ['profile', 'plan', 'training'].map((k) => [`http://localhost:8089/documents/${k}`, 'Bearer tok', 'error']));
  assert.equal(read(r.dir, 'plan'), JSON.stringify(PLAN, null, 2) + '\n');
  assert.deepEqual(Object.keys(JSON.parse(read(r.dir, 'plan')).data), ['postre', 'desayuno']);
  assert.deepEqual(JSON.parse(read(r.dir, 'training')), TRAINING);
  assert.deepEqual(JSON.parse(read(r.dir, 'profile')), PROFILE);
  assert.deepEqual(r.logs, ['Documents: profile written -> profile/profile.json', 'Documents: plan written -> data/nutrition/plan-data.json', 'Documents: training written -> data/training/training-data.json']);
});

test('a file with the same content is never rewritten, even with other formatting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-documents-'));
  fs.mkdirSync(path.join(dir, 'data', 'nutrition'), { recursive: true });
  const hand = '{"data":{"postre":[1],"desayuno":[2]},\n  "targets":{},"dayPlan":{}}\n';
  const file = path.join(dir, DOCUMENT_FILES.plan);
  fs.writeFileSync(file, hand);
  const before = fs.statSync(file).mtimeMs;
  const r = await run({ plan: body('plan', PLAN) }, { root: dir });
  assert.equal(fs.readFileSync(file, 'utf8'), hand);
  assert.equal(fs.statSync(file).mtimeMs, before);
  assert.ok(r.logs.includes('Documents: plan unchanged'));
});

test('a changed document replaces the file', async () => {
  const first = await run(all());
  const next = { ...PLAN, page: { title: 'new' } };
  const r = await run({ ...all(), plan: body('plan', next, 2) }, { root: first.dir });
  assert.deepEqual(JSON.parse(read(r.dir, 'plan')), next);
  assert.ok(r.logs.includes('Documents: plan written -> data/nutrition/plan-data.json'));
});

test('a document never saved (null) keeps the existing file and writes none', async () => {
  const first = await run(all());
  const r = await run({ plan: body('plan', null, 0), training: body('training', null, 0), profile: body('profile', PROFILE) }, { root: first.dir });
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(read(r.dir, 'plan')), PLAN);
  assert.ok(r.logs.includes('Documents: plan not in the database yet; data/nutrition/plan-data.json kept'));
  const empty = await run({ plan: body('plan', null, 0), training: body('training', null, 0), profile: body('profile', null, 0) });
  assert.equal(fs.existsSync(path.join(empty.dir, 'data')), false);
  assert.equal(fs.existsSync(path.join(empty.dir, 'profile')), false);
});

test('an old service (404), an unavailable group (503) or a malformed body only warns and keeps the files', async () => {
  const first = await run(all());
  for (const bad of [{ status: 404 }, { status: 503 }, { body: { kind: 'plan', document: [] } }, { body: { kind: 'plan', document: { targets: {} } } }, { body: null }]) {
    const r = await run({ ...all(), plan: bad }, { root: first.dir });
    assert.equal(r.code, 0, JSON.stringify(bad));
    assert.match(r.warns[0], /^WARNING: plan document sync skipped \(.+\); data\/nutrition\/plan-data\.json is kept$/);
    assert.deepEqual(JSON.parse(read(r.dir, 'plan')), PLAN);
  }
});

test('no token: a warning, no request, no file touched', async () => {
  const r = await run(all(), { env: { INGEST_TOKEN: '', INGEST_ENV_FILE: '/nonexistent/.env' } });
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls, []);
  assert.match(r.warns[0], /^WARNING: document sync skipped \(no ingest token/);
  assert.equal(fs.existsSync(path.join(r.dir, 'profile')), false);
});

test('a 401 (wrong token) warns per document and keeps the files', async () => {
  const first = await run(all());
  const r = await run({ plan: { status: 401 }, training: { status: 401 }, profile: { status: 401 } }, { root: first.dir });
  assert.equal(r.code, 0);
  assert.equal(r.warns.length, 3);
  assert.match(r.warns[0], /HTTP 401/);
  assert.deepEqual(JSON.parse(read(r.dir, 'profile')), PROFILE);
});

test('a write failure is an ERROR and exit 1; the other documents still sync', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-documents-'));
  fs.writeFileSync(path.join(dir, 'profile'), 'not a dir');
  const r = await run(all(), { root: dir });
  assert.equal(r.code, 1);
  assert.match(r.warns[0], /^ERROR: profile document sync could not write profile\/profile\.json/);
  assert.deepEqual(JSON.parse(read(dir, 'plan')), PLAN);
});

test('a hand edit not pushed yet is kept with a warning, never overwritten', async () => {
  const first = await run(all());
  const file = path.join(first.dir, DOCUMENT_FILES.plan);
  const edited = { ...PLAN, page: { title: 'my edit' } };
  fs.writeFileSync(file, JSON.stringify(edited));
  // the database did not change: still the local edit wins
  const same = await run(all(), { root: first.dir });
  assert.equal(same.code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), edited);
  assert.equal(same.warns.length, 1);
  assert.match(same.warns[0], /^WARNING: data\/nutrition\/plan-data\.json has changes that are not in the database; kept\. Send them with `npm run documents -- push plan`, or take the database's with `npm run documents -- pull plan --force`/);
  // nor when the database moved on
  const moved = await run({ ...all(), plan: body('plan', { ...PLAN, page: { title: 'theirs' } }, 2) }, { root: first.dir });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), edited);
  assert.match(moved.warns[0], /has changes that are not in the database/);
});

test('a file from before the documents existed (no sync state) that differs is kept too', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-documents-'));
  fs.mkdirSync(path.join(dir, 'profile'));
  fs.writeFileSync(path.join(dir, DOCUMENT_FILES.profile), JSON.stringify({ birthdate: '1980-01-01' }));
  const r = await run(all(), { root: dir });
  assert.deepEqual(JSON.parse(read(dir, 'profile')), { birthdate: '1980-01-01' });
  assert.match(r.warns[0], /^WARNING: profile\/profile\.json has changes that are not in the database/);
  // a broken file is kept the same way
  fs.writeFileSync(path.join(dir, DOCUMENT_FILES.profile), '{broken');
  const broken = await run(all(), { root: dir });
  assert.equal(fs.readFileSync(path.join(dir, DOCUMENT_FILES.profile), 'utf8'), '{broken');
  assert.match(broken.warns[0], /has changes that are not in the database/);
});

test('force takes the database document over a local edit, backing the file up first (newest backup only)', async () => {
  const first = await run(all());
  const file = path.join(first.dir, DOCUMENT_FILES.plan);
  fs.writeFileSync(file, '{"mine":1}');
  const logs = []; const warns = [];
  const r = await main({
    env: { SYNC_DOCUMENTS_ROOT: first.dir, INGEST_URL: 'http://x', INGEST_TOKEN: 't' },
    log: (l) => logs.push(l), warn: (w) => warns.push(w), kinds: ['plan'], force: true,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => body('plan', PLAN).body }),
  });
  assert.equal(r, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), PLAN);
  const bak = path.join(first.dir, 'backups', 'data', 'nutrition', 'plan-data.json.documents.bak');
  assert.equal(fs.readFileSync(bak, 'utf8'), '{"mine":1}');
  assert.deepEqual(logs, ['Documents: plan written -> data/nutrition/plan-data.json (your version backed up to backups/data/nutrition/plan-data.json.documents.bak)']);
  assert.deepEqual(warns, []);
});
test('the sync state records each document\'s revision and content hash', async () => {
  const r = await run(all());
  const state = JSON.parse(fs.readFileSync(path.join(r.dir, 'data', 'profile', 'documents-sync.json'), 'utf8'));
  assert.deepEqual(Object.keys(state), ['profile', 'plan', 'training']);
  assert.equal(state.plan.revision, 1);
  assert.match(state.plan.hash, /^[0-9a-f]{64}$/);
});
