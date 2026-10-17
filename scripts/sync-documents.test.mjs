import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, DOCUMENT_FILES } from './sync-documents.mjs';
import { dataPaths } from '../lib/paths.mjs';

const PLAN = { data: { postre: [{ n: 'p' }], desayuno: [{ n: 'd' }] }, targets: {}, dayPlan: {} };
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
    profile: 'loop-data/cache/profile.json',
    plan: 'loop-data/cache/plan.json',
    training: 'loop-data/cache/training.json',
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
  assert.deepEqual(r.logs, ['Documents: profile written -> loop-data/cache/profile.json', 'Documents: plan written -> loop-data/cache/plan.json', 'Documents: training written -> loop-data/cache/training.json']);
});

test('a file with the same content is never rewritten, even with other formatting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-documents-'));
  fs.mkdirSync(path.join(dir, 'loop-data', 'cache'), { recursive: true });
  const hand = '{"data":{"postre":[{"n":"p"}],"desayuno":[{"n":"d"}]},\n  "targets":{},"dayPlan":{}}\n';
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
  assert.ok(r.logs.includes('Documents: plan written -> loop-data/cache/plan.json'));
});

test('a document never saved (null) keeps the existing file and writes none', async () => {
  const first = await run(all());
  const r = await run({ plan: body('plan', null, 0), training: body('training', null, 0), profile: body('profile', PROFILE) }, { root: first.dir });
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(read(r.dir, 'plan')), PLAN);
  assert.ok(r.logs.includes('Documents: plan not in the database yet; loop-data/cache/plan.json kept'));
  const empty = await run({ plan: body('plan', null, 0), training: body('training', null, 0), profile: body('profile', null, 0) });
  assert.equal(fs.existsSync(path.join(empty.dir, 'loop-data', 'cache', 'plan.json')), false);
  assert.equal(fs.existsSync(path.join(empty.dir, 'loop-data', 'cache', 'training.json')), false);
  assert.equal(fs.existsSync(path.join(empty.dir, 'loop-data', 'cache', 'profile.json')), false);
});

test('an old service (404), an unavailable group (503) or a malformed body only warns and keeps the files', async () => {
  const first = await run(all());
  for (const bad of [{ status: 404 }, { status: 503 }, { body: { kind: 'plan', document: [] } }, { body: { kind: 'plan', document: { targets: {} } } }, { body: null }]) {
    const r = await run({ ...all(), plan: bad }, { root: first.dir });
    assert.equal(r.code, 0, JSON.stringify(bad));
    assert.match(r.warns[0], /^WARNING: plan document sync skipped \(.+\); loop-data\/cache\/plan\.json is kept$/);
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
  // a directory where the atomic write puts its temporary file (sync-common writeAtomic: <file>.<pid>.tmp)
  fs.mkdirSync(path.join(dir, 'loop-data', 'cache', `profile.json.${process.pid}.tmp`, 'x'), { recursive: true });
  const r = await run(all(), { root: dir });
  assert.equal(r.code, 1);
  assert.match(r.warns[0], /^ERROR: profile document sync could not write loop-data\/cache\/profile\.json/);
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
  assert.match(same.warns[0], /^WARNING: loop-data\/cache\/plan\.json has changes that are not in the database; kept\. Send them with `npm run documents -- push plan`, or take the database's with `npm run documents -- pull plan --force`/);
  // nor when the database moved on
  const moved = await run({ ...all(), plan: body('plan', { ...PLAN, page: { title: 'theirs' } }, 2) }, { root: first.dir });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), edited);
  assert.match(moved.warns[0], /has changes that are not in the database/);
});

test('a file from before the documents existed (no sync state) that differs is kept too', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-documents-'));
  fs.mkdirSync(path.join(dir, 'loop-data', 'cache'), { recursive: true });
  fs.writeFileSync(path.join(dir, DOCUMENT_FILES.profile), JSON.stringify({ birthdate: '1980-01-01' }));
  const r = await run(all(), { root: dir });
  assert.deepEqual(JSON.parse(read(dir, 'profile')), { birthdate: '1980-01-01' });
  assert.match(r.warns[0], /^WARNING: loop-data\/cache\/profile\.json has changes that are not in the database/);
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
  const bak = path.join(first.dir, 'backups', 'loop-data', 'cache', 'plan.json.documents.bak');
  assert.equal(fs.readFileSync(bak, 'utf8'), '{"mine":1}');
  assert.deepEqual(logs, ['Documents: plan written -> loop-data/cache/plan.json (your version backed up to backups/loop-data/cache/plan.json.documents.bak)']);
  assert.deepEqual(warns, []);
});
test('the sync state records each document\'s revision and content hash', async () => {
  const r = await run(all());
  const state = JSON.parse(fs.readFileSync(path.join(r.dir, 'loop-data', 'cache', '.sync-state.json'), 'utf8'));
  assert.deepEqual(Object.keys(state), ['profile', 'plan', 'training']);
  assert.equal(state.plan.revision, 1);
  assert.match(state.plan.hash, /^[0-9a-f]{64}$/);
});

test('HC_DATA_DIR: the documents land in <data root>/cache, the state in cache/.sync-state.json, a forced pull backs up to backups/cache/', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-documents-root-'));
  try {
    const r = await run(all(), { env: { HC_DATA_DIR: data } });
    assert.equal(r.code, 0);
    const paths = dataPaths({ repoRoot: r.dir, env: { HC_DATA_DIR: data } });
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.documents.plan, 'utf8')), PLAN);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'cache', 'training.json'), 'utf8')), TRAINING);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'cache', 'profile.json'), 'utf8')), PROFILE);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(data, 'cache', '.sync-state.json'), 'utf8'))), ['profile', 'plan', 'training']);
    assert.equal(fs.existsSync(path.join(r.dir, DOCUMENT_FILES.plan)), false, 'nothing under the default data root');
    assert.equal(fs.existsSync(path.join(r.dir, 'loop-data', 'cache', '.sync-state.json')), false);
    assert.equal(r.logs[1], `Documents: plan written -> ${paths.documents.plan}`);
    // a local edit, then a forced pull: backed up inside the clone, under the path relative to the data root
    fs.writeFileSync(paths.documents.plan, '{"mine":1}');
    const logs = [];
    assert.equal(await main({
      env: { SYNC_DOCUMENTS_ROOT: r.dir, HC_DATA_DIR: data, INGEST_URL: 'http://x', INGEST_TOKEN: 't' },
      log: (l) => logs.push(l), warn: () => {}, kinds: ['plan'], force: true,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => body('plan', PLAN).body }),
    }), 0);
    assert.equal(fs.readFileSync(path.join(r.dir, 'backups', 'cache', 'plan.json.documents.bak'), 'utf8'), '{"mine":1}');
    assert.deepEqual(logs, [`Documents: plan written -> ${paths.documents.plan} (your version backed up to ${path.join('backups', 'cache', 'plan.json.documents.bak')})`]);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('a document file left at its old path is one WARNING (edits there are ignored); the sync still runs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-documents-'));
  fs.mkdirSync(path.join(dir, 'profile'));
  fs.writeFileSync(path.join(dir, 'profile', 'profile.json'), '{}');
  const r = await run(all(), { root: dir });
  assert.equal(r.code, 0);
  assert.deepEqual(r.warns, ['WARNING: profile/profile.json is at the old path, but the data root loop-data is in use: edits there are ignored; run npm run migrate:data-root']);
  assert.deepEqual(JSON.parse(read(dir, 'profile')), PROFILE, 'the data root copy is the one written');
  assert.equal(fs.readFileSync(path.join(dir, 'profile', 'profile.json'), 'utf8'), '{}', 'the old file is left alone');
  // all three, under an HC_DATA_DIR outside the clone
  for (const rel of ['data/nutrition/plan-data.json', 'data/training/training-data.json']) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), '{}');
  }
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-documents-root-'));
  try {
    const three = await run(all(), { root: dir, env: { HC_DATA_DIR: data } });
    assert.deepEqual(three.warns, [`WARNING: profile/profile.json, data/nutrition/plan-data.json, data/training/training-data.json are at the old paths, but the data root ${data} is in use: edits there are ignored; run npm run migrate:data-root`]);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
  // no old file: no warning
  assert.deepEqual((await run(all())).warns, []);
});
