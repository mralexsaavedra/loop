import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { main, parseCommand } from './documents.mjs';
import { main as sync } from './sync-documents.mjs';
import { DOCUMENT_FILES } from './lib/documents.mjs';
import { createDocumentRoutes } from '../services/loop-ingest/src/documents.js';
import { createBearerCheck } from '../services/loop-ingest/src/auth.js';

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const TOKEN = 'k'.repeat(32);
const readRepo = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));
// the tracked example seeds pass every rule of the page build
const PLAN = readRepo('data/nutrition/plan-data.example.json');
const TRAINING = readRepo('data/training/training-data.example.json');
const PROFILE = readRepo('profile/profile.example.json');

/** The real document routes over HTTP with an in-memory store (same contract as documents-db.js). */
async function service() {
  const rows = new Map();
  const store = {
    async get(kind) { return rows.get(kind) ?? null; },
    async put(kind, data, expected) {
      if ((rows.get(kind)?.revision ?? 0) !== expected) return null;
      const row = { data: structuredClone(data), revision: expected + 1, updatedAt: '2030-01-01T00:00:00.000Z' };
      rows.set(kind, row);
      return row;
    },
  };
  const routes = createDocumentRoutes({ store, checkBearer: createBearerCheck(TOKEN, { log: () => {} }), log: () => {} });
  const server = http.createServer((req, res) => routes.handle(req, res, new URL(req.url, 'http://x')));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { rows, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

/** A clone root with ingredients.json (the plan's full validation reads it) and the given documents as files. */
function clone(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-docs-cli-'));
  fs.mkdirSync(path.join(root, 'data', 'nutrition'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'data', 'nutrition', 'ingredients.json'), path.join(root, 'data', 'nutrition', 'ingredients.json'));
  for (const [kind, doc] of Object.entries(files)) {
    const file = path.join(root, DOCUMENT_FILES[kind]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2));
  }
  return root;
}

async function cli(svc, root, argv, env = {}) {
  const logs = []; const warns = [];
  const code = await main({ argv, env: { SYNC_DOCUMENTS_ROOT: root, INGEST_URL: svc.url, INGEST_TOKEN: TOKEN, ...env }, log: (l) => logs.push(l), warn: (w) => warns.push(w) });
  return { code, logs, warns };
}
const fileOf = (root, kind) => JSON.parse(fs.readFileSync(path.join(root, DOCUMENT_FILES[kind]), 'utf8'));

test('usage: push / pull + a kind or all, --force; anything else is exit 2', () => {
  assert.deepEqual(parseCommand(['push', 'plan']), { command: 'push', kinds: ['plan'], all: false, force: false });
  assert.deepEqual(parseCommand(['pull', 'all', '--force']), { command: 'pull', kinds: ['profile', 'plan', 'training'], all: true, force: true });
  for (const bad of [[], ['push'], ['push', 'settings'], ['send', 'plan'], ['push', 'plan', 'extra'], ['push', 'plan', '--nope']]) {
    const r = parseCommand(bad);
    assert.equal(r.exit, 2, bad.join(' '));
    assert.match(r.err, /^ERROR: .*\n\nUsage: npm run documents -- <push\|pull>/s);
  }
  assert.equal(parseCommand(['--help']).exit, 0);
});

test('push all imports the three files (revision 1) and records the sync state; a second push is a no-op', async (t) => {
  const svc = await service();
  t.after(svc.close);
  const root = clone({ profile: PROFILE, plan: PLAN, training: TRAINING });
  const r = await cli(svc, root, ['push', 'all']);
  assert.equal(r.code, 0, r.warns.join('\n'));
  assert.deepEqual(r.logs, [
    'Documents: profile pushed from loop-data/cache/profile.json (revision 1)',
    'Documents: plan pushed from loop-data/cache/plan.json (revision 1)',
    'Documents: training pushed from loop-data/cache/training.json (revision 1)',
  ]);
  assert.equal(JSON.stringify(svc.rows.get('plan').data), JSON.stringify(PLAN));
  const again = await cli(svc, root, ['push', 'all']);
  assert.equal(again.code, 0);
  assert.deepEqual(again.logs.map((l) => l.replace(/ \(revision \d\)/, '')), ['Documents: profile already in the database', 'Documents: plan already in the database', 'Documents: training already in the database']);
  assert.equal(svc.rows.get('plan').revision, 1);
});

test('the edit loop: sync, edit the file, push; the next sync leaves it alone', async (t) => {
  const svc = await service();
  t.after(svc.close);
  const root = clone({ plan: PLAN });
  await cli(svc, root, ['push', 'plan']);
  const edited = { ...PLAN, page: { ...PLAN.page, title: 'Edited' } };
  fs.writeFileSync(path.join(root, DOCUMENT_FILES.plan), JSON.stringify(edited, null, 2));
  const r = await cli(svc, root, ['push', 'plan']);
  assert.deepEqual([r.code, r.logs], [0, ['Documents: plan pushed from loop-data/cache/plan.json (revision 2)']]);
  assert.equal(svc.rows.get('plan').data.page.title, 'Edited');
  const logs = []; const warns = [];
  await sync({ env: { SYNC_DOCUMENTS_ROOT: root, INGEST_URL: svc.url, INGEST_TOKEN: TOKEN }, log: (l) => logs.push(l), warn: (w) => warns.push(w), kinds: ['plan'] });
  assert.deepEqual([logs, warns], [['Documents: plan unchanged'], []]);
});

test('a file that breaks the build rules is never sent (plan: validateNutrition; profile: validateManual; training: validateProgram)', async (t) => {
  const svc = await service();
  t.after(svc.close);
  const badPlan = { ...PLAN, dayPlan: { ...PLAN.dayPlan, train: { meals: [{ slot: 'x', ref: 'nope' }] } } };
  const root = clone({ plan: badPlan, profile: { ...PROFILE, heightCm: 900 }, training: { days: { 'not-a-date': {} } } });
  const r = await cli(svc, root, ['push', 'all']);
  assert.equal(r.code, 1);
  assert.equal(r.warns.length, 3);
  assert.match(r.warns[0], /^ERROR: profile not pushed: loop-data\/cache\/profile\.json breaks the rules the page build applies:\n {2}- heightCm must be a number of centimetres/);
  assert.match(r.warns[1], /^ERROR: plan not pushed: loop-data\/cache\/plan\.json breaks the rules the page build applies:\n {2}- plan-data\.json validation failed/);
  assert.match(r.warns[2], /^ERROR: training not pushed: .*day key "not-a-date" is not an ISO date/s);
  assert.equal(svc.rows.size, 0);
  // broken JSON is refused the same way; a missing file is skipped by `push all` but an error when named alone
  const empty = clone({ training: '{broken' });
  const e = await cli(svc, empty, ['push', 'all']);
  assert.equal(e.code, 1);
  assert.deepEqual(e.logs, ['Documents: profile skipped (loop-data/cache/profile.json does not exist)', 'Documents: plan skipped (loop-data/cache/plan.json does not exist)']);
  assert.deepEqual(e.warns.length, 1);
  assert.match(e.warns[0], /^ERROR: training not pushed: loop-data\/cache\/training\.json is not valid JSON/);
  const named = await cli(svc, empty, ['push', 'profile']);
  assert.deepEqual([named.code, named.warns], [1, ['ERROR: profile not pushed: loop-data/cache/profile.json does not exist']]);
  assert.equal(svc.rows.size, 0);
});

test('a database changed since the last sync is never overwritten: push refuses, --force replaces it', async (t) => {
  const svc = await service();
  t.after(svc.close);
  const mine = clone({ profile: PROFILE });
  await cli(svc, mine, ['push', 'profile']);
  // another clone (the second machine) pushes a change
  const other = clone({ profile: PROFILE });
  await cli(svc, other, ['pull', 'profile']);
  fs.writeFileSync(path.join(other, DOCUMENT_FILES.profile), JSON.stringify({ ...PROFILE, city: 'Other' }));
  assert.equal((await cli(svc, other, ['push', 'profile'])).code, 0);
  // mine edits too, from revision 1
  fs.writeFileSync(path.join(mine, DOCUMENT_FILES.profile), JSON.stringify({ ...PROFILE, city: 'Mine' }));
  const r = await cli(svc, mine, ['push', 'profile']);
  assert.equal(r.code, 1);
  assert.match(r.warns[0], /^ERROR: profile not pushed: the database changed since your last sync \(revision 2, yours 1\)\. Take the database's with `npm run documents -- pull profile --force`/);
  assert.equal(svc.rows.get('profile').data.city, 'Other');
  const forced = await cli(svc, mine, ['push', 'profile', '--force']);
  assert.deepEqual([forced.code, forced.logs], [0, ['Documents: profile pushed from loop-data/cache/profile.json (revision 3)']]);
  assert.equal(svc.rows.get('profile').data.city, 'Mine');
});

test('a first push over a document the database already has (no sync state here) refuses unless --force', async (t) => {
  const svc = await service();
  t.after(svc.close);
  await cli(svc, clone({ training: TRAINING }), ['push', 'training']);
  const stale = clone({ training: { ...TRAINING, coach: 'old' } });
  const r = await cli(svc, stale, ['push', 'training']);
  assert.equal(r.code, 1);
  assert.match(r.warns[0], /the database changed since your last sync \(revision 1, yours 0\)/);
});

test('pull: writes the database document; with a local edit it keeps the file and exits 1, --force backs it up and replaces it', async (t) => {
  const svc = await service();
  t.after(svc.close);
  await cli(svc, clone({ plan: PLAN }), ['push', 'plan']);
  const root = clone({ plan: { ...PLAN, page: { ...PLAN.page, title: 'local' } } });
  const kept = await cli(svc, root, ['pull', 'plan']);
  assert.equal(kept.code, 1);
  assert.equal(fileOf(root, 'plan').page.title, 'local');
  const forced = await cli(svc, root, ['pull', 'plan', '--force']);
  assert.equal(forced.code, 0);
  assert.equal(JSON.stringify(fileOf(root, 'plan')), JSON.stringify(PLAN));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'backups', 'loop-data', 'cache', 'plan.json.documents.bak'), 'utf8')).page.title, 'local');
});

test('no token: nothing pushed, exit 1; a wrong token: the service refusal is reported', async (t) => {
  const svc = await service();
  t.after(svc.close);
  const root = clone({ profile: PROFILE });
  const none = await cli(svc, root, ['push', 'profile'], { INGEST_TOKEN: '', INGEST_ENV_FILE: '/nonexistent/.env' });
  assert.deepEqual([none.code, none.warns], [1, ['ERROR: no ingest token: set INGEST_TOKEN or create services/loop-ingest/.env. Nothing pushed.']]);
  const wrong = await cli(svc, root, ['push', 'profile'], { INGEST_TOKEN: 'wrong' });
  assert.equal(wrong.code, 1);
  assert.match(wrong.warns[0], /^ERROR: profile not pushed: the data service could not be read \(ingest service answered HTTP 401\)$/);
  assert.equal(svc.rows.size, 0);
  const pullNone = await cli(svc, root, ['pull', 'profile'], { INGEST_TOKEN: '', INGEST_ENV_FILE: '/nonexistent/.env' });
  assert.equal(pullNone.code, 1);
});

test('push all on an install with only some files imports those and exits 0', async (t) => {
  const svc = await service();
  t.after(svc.close);
  const r = await cli(svc, clone({ plan: PLAN }), ['push', 'all']);
  assert.equal(r.code, 0, r.warns.join('\n'));
  assert.deepEqual([...svc.rows.keys()], ['plan']);
});

test('a database reset since the last sync (document gone) takes the push without --force', async (t) => {
  const svc = await service();
  t.after(svc.close);
  const root = clone({ training: TRAINING });
  await cli(svc, root, ['push', 'training']);
  svc.rows.clear();
  const r = await cli(svc, root, ['push', 'training']);
  assert.deepEqual([r.code, r.logs], [0, ['Documents: training pushed from loop-data/cache/training.json (revision 1)']]);
});

test('a push that loses a race to another writer names both ways out', async (t) => {
  const svc = await service();
  t.after(svc.close);
  const root = clone({ profile: PROFILE });
  await cli(svc, root, ['push', 'profile']);
  fs.writeFileSync(path.join(root, DOCUMENT_FILES.profile), JSON.stringify({ ...PROFILE, city: 'Mine' }));
  // another writer saves between this push's read and its write
  const env = { SYNC_DOCUMENTS_ROOT: root, INGEST_URL: svc.url, INGEST_TOKEN: TOKEN };
  const warns = [];
  const racing = async (url, init) => {
    if (init?.method === 'PUT') {
      const row = svc.rows.get('profile');
      svc.rows.set('profile', { ...row, data: { ...row.data, city: 'Theirs' }, revision: row.revision + 1 });
    }
    return fetch(url, init);
  };
  const code = await main({ argv: ['push', 'profile'], env, log: () => {}, warn: (w) => warns.push(w), fetchImpl: racing });
  assert.equal(code, 1);
  assert.match(warns[0], /^ERROR: profile not pushed: the database changed while pushing \(revision 2\)\. Take the database's with `npm run documents -- pull profile --force`.*or replace it with `npm run documents -- push profile --force`$/);
  assert.equal(svc.rows.get('profile').data.city, 'Theirs');
});

test('HC_DATA_DIR: push reads <data root>/cache and records cache/.sync-state.json; validation still uses the clone\'s ingredients.json', async (t) => {
  const svc = await service();
  t.after(svc.close);
  const root = clone();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-docs-cli-root-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  fs.mkdirSync(path.join(data, 'cache'));
  fs.writeFileSync(path.join(data, 'cache', 'plan.json'), JSON.stringify(PLAN));
  const r = await cli(svc, root, ['push', 'plan'], { HC_DATA_DIR: data });
  assert.equal(r.code, 0, r.warns.join('\n'));
  assert.deepEqual(r.logs, [`Documents: plan pushed from ${path.join(data, 'cache', 'plan.json')} (revision 1)`]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'cache', '.sync-state.json'), 'utf8')).plan.revision, 1);
  assert.equal(fs.existsSync(path.join(root, 'loop-data', 'cache', '.sync-state.json')), false);
  const missing = await cli(svc, root, ['push', 'training'], { HC_DATA_DIR: data });
  assert.equal(missing.code, 1);
  assert.match(missing.warns[0], new RegExp(`training not pushed: ${path.join(data, 'cache', 'training.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} does not exist`));
});
