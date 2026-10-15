/* Tests for the food log export (ingest service GET /food/log/summary -> data/nutrition/foodlog-daily.csv).
 * SYNTHETIC values only, no network: the fetch is injected, and main() talks to a throwaway local server. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import * as sf from './sync-foodlog.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { normalizeSummary, fetchSummary, syncFoodlog, windowFor, toCsv, CSV_FILE, META_FILE, HEADER } = sf;
const SCRIPT = path.join(__dirname, 'sync-foodlog.mjs');

const DAY1 = { date: '2030-01-04', k: 2100, p: 140.5, c: 230, f: 60.2, n: 6, missing: { p: false, c: false, f: false }, groups: { breakfast: 2, lunch: 2, dinner: 1, addon: 1 } };
const DAY2 = { date: '2030-01-05', k: 900, p: 40, c: null, f: 30, n: 2, missing: { p: true, c: true, f: false }, groups: { breakfast: 1, lunch: 0, dinner: 0, addon: 1 } };
const BODY = { from: '2029-09-08', to: '2030-01-05', days: [DAY1, DAY2] };
const NOW = new Date('2030-01-05T09:00:00.000Z');
const tmpDir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sync-foodlog-${tag}-`));
const readCsv = (dir) => fs.readFileSync(path.join(dir, CSV_FILE), 'utf8');
const readMeta = (dir) => JSON.parse(fs.readFileSync(path.join(dir, META_FILE), 'utf8'));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ---- window ----------------------------------------------------------------------------

test('windowFor spans exactly summaryDaysMax days ending on the local date', async () => {
  const { FOOD_LIMITS } = await import('../../lib/nutrition/foodlog.mjs');
  assert.equal(sf.DAYS_MAX, FOOD_LIMITS.summaryDaysMax);
  const w = windowFor(new Date(2030, 0, 5, 23, 30));
  assert.equal(w.to, '2030-01-05');
  const days = Math.round((Date.parse(w.to + 'T00:00:00Z') - Date.parse(w.from + 'T00:00:00Z')) / 86400000) + 1;
  assert.equal(days, FOOD_LIMITS.summaryDaysMax);
});

// ---- shape -----------------------------------------------------------------------------

test('normalizeSummary keeps the per-day fields and drops unknown keys', () => {
  const out = normalizeSummary({ ...BODY, extra: 1, days: [{ ...DAY1, extra: 2 }, DAY2] });
  assert.deepEqual(out, { from: BODY.from, to: BODY.to, days: [DAY1, DAY2] });
});

test('normalizeSummary refuses a malformed body', () => {
  assert.throws(() => normalizeSummary(null), /unexpected response shape/);
  assert.throws(() => normalizeSummary({ from: BODY.from, to: BODY.to, days: {} }), /unexpected response shape/);
  assert.throws(() => normalizeSummary({ ...BODY, from: 'x' }), /from/);
  assert.throws(() => normalizeSummary({ ...BODY, days: [{ ...DAY1, date: '2030-02-31' }] }), /date/);
  assert.throws(() => normalizeSummary({ ...BODY, days: [{ ...DAY1, date: '2030-01-06' }] }), /date/, 'outside the window');
  assert.throws(() => normalizeSummary({ ...BODY, days: [{ ...DAY1, k: '2100' }] }), /kcal/);
  assert.throws(() => normalizeSummary({ ...BODY, days: [{ ...DAY1, p: -1 }] }), /protein/);
  assert.throws(() => normalizeSummary({ ...BODY, days: [{ ...DAY1, n: 0 }] }), /entries/);
  assert.throws(() => normalizeSummary({ ...BODY, days: [{ ...DAY1, missing: null }] }), /missing/);
  assert.throws(() => normalizeSummary({ ...BODY, days: [{ ...DAY1, groups: { breakfast: 1 } }] }), /groups/);
  assert.throws(() => normalizeSummary({ ...BODY, days: [DAY1, DAY1] }), /duplicate/);
});

test('toCsv writes one row per day; an unknown macro is blank (never 0) and missing macros are listed', () => {
  const csv = toCsv([DAY1, DAY2]);
  assert.equal(csv, [
    HEADER.join(','),
    '2030-01-04,2100,140.5,230,60.2,6,2,2,1,1,',
    '2030-01-05,900,40,,30,2,1,0,0,1,protein;carbs',
  ].join('\n') + '\n');
});

// ---- request ---------------------------------------------------------------------------

test('fetchSummary sends X-HC-Food: 1, no bearer token, and the window as from / to', async () => {
  let seen;
  const out = await fetchSummary('http://localhost:8088/', { from: '2029-09-08', to: '2030-01-05' }, { fetchImpl: async (url, init) => { seen = { url, init }; return json(200, BODY); } });
  assert.equal(seen.url, 'http://localhost:8088/food/log/summary?from=2029-09-08&to=2030-01-05');
  assert.equal(seen.init.headers['x-hc-food'], '1');
  assert.equal(seen.init.headers.authorization, undefined);
  assert.deepEqual(out, BODY);
});

test('fetchSummary keeps the HTTP status on the error (404 old image, 503 food unavailable, 421 host)', async () => {
  for (const status of [404, 421, 503]) {
    await assert.rejects(fetchSummary('http://x', { from: 'a', to: 'b' }, { fetchImpl: async () => json(status, { error: 'x' }) }), (err) => err.status === status);
  }
});

// ---- disk ------------------------------------------------------------------------------

test('syncFoodlog writes the CSV + meta; a same-day rerun with the same content touches nothing', () => {
  const dir = tmpDir('write');
  const r1 = syncFoodlog(dir, BODY, { now: NOW });
  assert.equal(r1.written, true);
  assert.equal(readCsv(dir), toCsv([DAY1, DAY2]));
  assert.deepEqual(readMeta(dir), { from: BODY.from, to: BODY.to, days: 2, fetchedAt: NOW.toISOString() });
  assert.deepEqual(fs.readdirSync(dir).sort(), [CSV_FILE, META_FILE].sort(), 'no temp leftovers');
  const mtime = fs.statSync(path.join(dir, CSV_FILE)).mtimeMs;
  const r2 = syncFoodlog(dir, BODY, { now: new Date('2030-01-05T20:00:00.000Z') });
  assert.equal(r2.written, false);
  assert.equal(fs.statSync(path.join(dir, CSV_FILE)).mtimeMs, mtime);
  assert.equal(readMeta(dir).fetchedAt, NOW.toISOString());
  fs.rmSync(dir, { recursive: true });
});

test('syncFoodlog rewrites on a content change, and refreshes fetchedAt once per day when unchanged', () => {
  const dir = tmpDir('change');
  syncFoodlog(dir, BODY, { now: NOW });
  const changed = { ...BODY, days: [DAY1] };
  assert.equal(syncFoodlog(dir, changed, { now: NOW }).written, true);
  assert.equal(readCsv(dir), toCsv([DAY1]), 'a day deleted inside the window disappears');
  const nextDay = new Date('2030-01-06T06:00:00.000Z');
  assert.equal(syncFoodlog(dir, changed, { now: nextDay }).written, true);
  assert.equal(readMeta(dir).fetchedAt, nextDay.toISOString());
  fs.rmSync(dir, { recursive: true });
});

test('syncFoodlog keeps rows older than the window from the previous CSV (history beyond the server max)', () => {
  const dir = tmpDir('history');
  const old = { ...DAY1, date: '2029-06-01' };
  const inWindowStale = { ...DAY2, date: '2029-12-01' };
  fs.writeFileSync(path.join(dir, CSV_FILE), toCsv([old, inWindowStale]));
  syncFoodlog(dir, BODY, { now: NOW });
  assert.equal(readCsv(dir), toCsv([old, DAY1, DAY2]), 'old row kept, an in-window row the server no longer has dropped');
  fs.rmSync(dir, { recursive: true });
});

test('syncFoodlog with no logged day writes a header-only CSV', () => {
  const dir = tmpDir('empty');
  syncFoodlog(dir, { ...BODY, days: [] }, { now: NOW });
  assert.equal(readCsv(dir), HEADER.join(',') + '\n');
  fs.rmSync(dir, { recursive: true });
});

// ---- main(): a missing / old / unavailable service is a warning, never a failed sync -------

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function run(env, args = []) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env } }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

test('main(): 200 -> writes the CSV, exit 0', async () => {
  let req;
  const server = await serve((r, res) => {
    req = { url: r.url, headers: r.headers };
    const u = new URL(r.url, 'http://x');
    const body = { from: u.searchParams.get('from'), to: u.searchParams.get('to'), days: [{ ...DAY1, date: u.searchParams.get('to') }] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  const dir = tmpDir('main-ok');
  const r = await run({ INGEST_URL: `http://localhost:${server.address().port}`, SYNC_FOODLOG_OUT_DIR: dir });
  server.close();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(req.headers['x-hc-food'], '1');
  assert.match(req.url, /^\/food\/log\/summary\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
  assert.match(readCsv(dir), /^date,kcal,/);
  assert.match(r.stdout, /Food log: 1 logged day .*; written/);
  fs.rmSync(dir, { recursive: true });
});

test('main(): 503 / 404 / 421 / malformed / unreachable -> WARNING, the previous file kept byte for byte, exit 0', async () => {
  const dir = tmpDir('main-warn');
  const prev = toCsv([DAY1]);
  fs.writeFileSync(path.join(dir, CSV_FILE), prev);
  for (const [status, body] of [[503, '{"error":"x"}'], [404, '{"error":"x"}'], [421, '{"error":"x"}'], [200, '{"days":"nope"}']]) {
    const server = await serve((req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body); });
    const r = await run({ INGEST_URL: `http://localhost:${server.address().port}`, SYNC_FOODLOG_OUT_DIR: dir });
    server.close();
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /^WARNING: /m);
  }
  const r = await run({ INGEST_URL: 'http://127.0.0.1:9', SYNC_FOODLOG_OUT_DIR: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /WARNING: could not read the food log/);
  assert.equal(readCsv(dir), prev);
  fs.rmSync(dir, { recursive: true });
});

test('the export files are gitignored (personal data)', () => {
  for (const f of [CSV_FILE, META_FILE]) {
    const out = execFileSync('git', ['check-ignore', path.join('data', 'nutrition', f)], { cwd: path.join(__dirname, '..', '..') }).toString().trim();
    assert.equal(out, path.join('data', 'nutrition', f));
  }
});

// ---- main() returns its exit code (runCli sets it): called in-process, the runner is never killed ----

function mainHarness (prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const out = [], err = [];
  const env = { INGEST_ENV_FILE: path.join(dir, 'no-such.env'), INGEST_URL: 'http://127.0.0.1:9' };
  const refused = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  const answer = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
  const blocked = path.join(dir, 'a-file');
  fs.writeFileSync(blocked, 'x');
  return {
    dir, env, refused, answer, out, err,
    io: { log: (s) => out.push(s), error: (s) => err.push(s) },
    unwritable: path.join(blocked, 'sub'), // a path under a regular file: every write fails
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('main() in-process: unreachable -> warning, returns 0; failed write -> returns 1', async () => {
  const h = mainHarness('sync-foodlog-main-');
  try {
    assert.equal(await sf.main({ env: h.env, ...h.io, fetchImpl: h.refused, outDir: path.join(h.dir, 'f') }), 0);
    assert.match(h.err.pop(), /^WARNING: could not read the food log .*ECONNREFUSED/);
    const ok = async (url) => {
      const u = new URL(url);
      return { ok: true, status: 200, json: async () => ({ from: u.searchParams.get('from'), to: u.searchParams.get('to'), days: [] }) };
    };
    assert.equal(await sf.main({ env: h.env, ...h.io, fetchImpl: ok, outDir: h.unwritable }), 1);
    assert.match(h.err.pop(), /^ERROR: food log sync failed/);
  } finally { h.cleanup(); }
});

test('main(): a malformed body warns "unexpected response", never "could not read" (the service was reached)', async () => {
  const h = mainHarness('sync-foodlog-bad-');
  try {
    const outDir = path.join(h.dir, 'f');
    assert.equal(await sf.main({ env: h.env, ...h.io, fetchImpl: h.answer(200, { days: 'nope' }), outDir }), 0);
    const w = h.err.pop();
    assert.match(w, /^WARNING: unexpected response from the food log at http:\/\/127\.0\.0\.1:9 \(unexpected response shape .*\)\. foodlog-daily\.csv kept\.$/);
    const notJson = async () => ({ ok: true, status: 200, json: async () => JSON.parse('<html>') });
    assert.equal(await sf.main({ env: h.env, ...h.io, fetchImpl: notJson, outDir }), 0);
    assert.match(h.err.pop(), /^WARNING: unexpected response from the food log/);
    assert.ok(!fs.existsSync(outDir));
  } finally { h.cleanup(); }
});

test('main(): the window and fetchedAt come from the injected `now` (no clock read inside)', async () => {
  const h = mainHarness('sync-foodlog-now-');
  try {
    const urls = [];
    const ok = async (url) => {
      urls.push(url);
      const u = new URL(url);
      return { ok: true, status: 200, json: async () => ({ from: u.searchParams.get('from'), to: u.searchParams.get('to'), days: [] }) };
    };
    const now = new Date(2030, 0, 15, 12, 0, 0); // local 2030-01-15
    const outDir = path.join(h.dir, 'f');
    assert.equal(await sf.main({ env: h.env, ...h.io, fetchImpl: ok, outDir, now }), 0);
    const u = new URL(urls[0]);
    assert.equal(u.searchParams.get('to'), '2030-01-15');
    assert.deepEqual(sf.windowFor(now), { from: u.searchParams.get('from'), to: '2030-01-15' });
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, sf.META_FILE), 'utf8'));
    assert.equal(meta.fetchedAt, now.toISOString());
  } finally { h.cleanup(); }
});
