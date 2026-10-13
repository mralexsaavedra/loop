/* Tests for the settings snapshot sync (ingest service GET /food/settings -> data/profile/settings.json).
 * SYNTHETIC values only, no network: the fetch is injected, and main() talks to a throwaway local server. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import * as ss from './sync-settings.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { normalizeSettings, fetchSettings, syncSettings, SETTINGS_JSON } = ss;
const SCRIPT = path.join(__dirname, 'sync-settings.mjs');

const BODY = { settings: { goal: 'cut', targetWeightKg: 72.5, updatedAt: '2030-01-05T08:00:00.000Z' } };
const NOW = new Date('2030-01-06T09:00:00.000Z');
const tmpDir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sync-settings-${tag}-`));
const readJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_JSON), 'utf8'));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ---- shape -----------------------------------------------------------------------------

test('normalizeSettings keeps goal / target / updatedAt and drops unknown keys', () => {
  assert.deepEqual(normalizeSettings({ settings: { ...BODY.settings, extra: 1 } }), BODY.settings);
  assert.deepEqual(normalizeSettings({ settings: { goal: null, targetWeightKg: null, updatedAt: null } }), { goal: null, targetWeightKg: null, updatedAt: null });
});

test('normalizeSettings refuses a malformed body (unknown goal, out-of-range target, not an object)', () => {
  assert.throws(() => normalizeSettings(null), /unexpected response shape/);
  assert.throws(() => normalizeSettings({ settings: [] }), /unexpected response shape/);
  assert.throws(() => normalizeSettings({ settings: { goal: 'shred' } }), /goal/);
  assert.throws(() => normalizeSettings({ settings: { goal: 'cut', targetWeightKg: 5 } }), /targetWeightKg/);
  assert.throws(() => normalizeSettings({ settings: { goal: 'cut', targetWeightKg: '72' } }), /targetWeightKg/);
  assert.throws(() => normalizeSettings({ settings: { goal: 'cut', updatedAt: 'yesterday' } }), /updatedAt/);
});

// ---- request ---------------------------------------------------------------------------

test('fetchSettings sends X-HC-Food: 1 (the food layer guard) and no bearer token', async () => {
  let seen;
  const out = await fetchSettings('http://localhost:8088/', { fetchImpl: async (url, init) => { seen = { url, init }; return json(200, BODY); } });
  assert.equal(seen.url, 'http://localhost:8088/food/settings');
  assert.equal(seen.init.headers['x-hc-food'], '1');
  assert.equal(seen.init.headers.authorization, undefined);
  assert.deepEqual(out, BODY);
});

test('fetchSettings keeps the HTTP status on the error (404 old image, 503 settings unavailable, 421 host)', async () => {
  for (const status of [404, 421, 503]) {
    await assert.rejects(fetchSettings('http://x', { fetchImpl: async () => json(status, { error: 'x' }) }), (err) => err.status === status);
  }
});

// ---- disk ------------------------------------------------------------------------------

test('syncSettings writes {goal, targetWeightKg, updatedAt, fetchedAt}; a same-day rerun with the same content touches nothing', () => {
  const dir = tmpDir('write');
  const r1 = syncSettings(dir, BODY, { now: NOW });
  assert.equal(r1.written, true);
  assert.deepEqual(readJson(dir), { ...BODY.settings, fetchedAt: NOW.toISOString() });
  assert.deepEqual(fs.readdirSync(dir), [SETTINGS_JSON], 'no temp leftovers');
  const mtime = fs.statSync(path.join(dir, SETTINGS_JSON)).mtimeMs;
  const r2 = syncSettings(dir, BODY, { now: new Date('2030-01-06T20:00:00.000Z') });
  assert.equal(r2.written, false);
  assert.equal(fs.statSync(path.join(dir, SETTINGS_JSON)).mtimeMs, mtime);
  assert.equal(readJson(dir).fetchedAt, NOW.toISOString());
  fs.rmSync(dir, { recursive: true });
});

test('syncSettings rewrites on a content change, and refreshes fetchedAt once per day when unchanged', () => {
  const dir = tmpDir('change');
  syncSettings(dir, BODY, { now: NOW });
  const changed = { settings: { ...BODY.settings, targetWeightKg: 71 } };
  assert.equal(syncSettings(dir, changed, { now: NOW }).written, true);
  assert.equal(readJson(dir).targetWeightKg, 71);
  const nextDay = new Date('2030-01-07T06:00:00.000Z');
  assert.equal(syncSettings(dir, changed, { now: nextDay }).written, true, 'a new day refreshes fetchedAt');
  assert.equal(readJson(dir).fetchedAt, nextDay.toISOString());
  fs.rmSync(dir, { recursive: true });
});

test('syncSettings replaces a broken previous file', () => {
  const dir = tmpDir('broken');
  fs.writeFileSync(path.join(dir, SETTINGS_JSON), '{not json');
  assert.equal(syncSettings(dir, BODY, { now: NOW }).written, true);
  assert.equal(readJson(dir).goal, 'cut');
  fs.rmSync(dir, { recursive: true });
});

// ---- main(): a missing / old / unavailable service is a warning, never a failed sync -------

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function run(env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, ...env } }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

test('main(): 200 -> writes the snapshot, exit 0', async () => {
  let headers;
  const server = await serve((req, res) => { headers = req.headers; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(BODY)); });
  const dir = tmpDir('main-ok');
  const r = await run({ INGEST_URL: `http://localhost:${server.address().port}`, SYNC_PROFILE_OUT_DIR: dir });
  server.close();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(headers['x-hc-food'], '1');
  assert.equal(readJson(dir).goal, 'cut');
  assert.match(r.stdout, /Settings: goal cut, target 72\.5 kg; written/);
  fs.rmSync(dir, { recursive: true });
});

test('main(): 503 / 404 / unreachable -> WARNING, the previous file kept byte for byte, exit 0', async () => {
  const dir = tmpDir('main-warn');
  const prev = JSON.stringify({ ...BODY.settings, fetchedAt: NOW.toISOString() }) + '\n';
  fs.writeFileSync(path.join(dir, SETTINGS_JSON), prev);
  for (const status of [503, 404]) {
    const server = await serve((req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end('{"error":"x"}'); });
    const r = await run({ INGEST_URL: `http://localhost:${server.address().port}`, SYNC_PROFILE_OUT_DIR: dir });
    server.close();
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /^WARNING: /m);
  }
  const r = await run({ INGEST_URL: 'http://127.0.0.1:9', SYNC_PROFILE_OUT_DIR: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /WARNING: could not read the settings/);
  assert.equal(fs.readFileSync(path.join(dir, SETTINGS_JSON), 'utf8'), prev);
  fs.rmSync(dir, { recursive: true });
});

test('the goal list and target range are the shared ones (lib/nutrition/foodlog.mjs)', async () => {
  const { SETTINGS_GOALS, FOOD_LIMITS } = await import('../../lib/nutrition/foodlog.mjs');
  assert.deepEqual(ss.GOALS, [...SETTINGS_GOALS]);
  assert.equal(ss.TARGET_MIN, FOOD_LIMITS.targetWeightMin);
  assert.equal(ss.TARGET_MAX, FOOD_LIMITS.targetWeightMax);
});
