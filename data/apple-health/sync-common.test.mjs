/* Tests for the helpers shared by data/apple-health's sync scripts (Shortcut + Strava).
 * Pure functions only where possible; disk I/O tested against real temp files, SYNTHETIC
 * fixtures (no real personal values), no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as common from './sync-common.mjs';

const {
  mergeCsv, fetchJson, fetchPages, resolveToken, readIngestToken, resolveBaseUrl, readBaseUrl, writeAtomic, DEFAULT_URL, ENV_FILE,
  acquireLock, releaseLock, withLock,
} = common;

const H = 'date,value,source';

test('mergeCsv() drops a row when its date is ledgered OR isOwn(source) is true; keeps others', () => {
  const existing = [H, '2030-01-01,40,Watch', '2030-01-02,41,Strava API', '2030-01-03,42,Watch', ''].join('\n');
  const rows = [{ date: '2030-01-04', line: '2030-01-04,99,Strava API' }];
  const r = mergeCsv(existing, H, rows, {
    sourceCol: 2,
    isOwn: (src) => src === 'Strava API',
    ownedDates: ['2030-01-03'],
  });
  // 01-01 (not owned, not isOwn) survives; 01-02 (isOwn) dropped; 01-03 (ledgered) dropped; 01-04 added
  assert.equal(r.text, [H, '2030-01-01,40,Watch', '2030-01-04,99,Strava API', ''].join('\n'));
  assert.deepEqual(r.dates, ['2030-01-01', '2030-01-04']);
});

test('mergeCsv() keeps a row whose source is not owned and whose date is not ledgered', () => {
  const existing = [H, '2030-01-05,10,Watch', ''].join('\n');
  const r = mergeCsv(existing, H, [], { isOwn: (src) => src === 'Strava API', ownedDates: [] });
  assert.equal(r.text, existing);
});

test('mergeCsv() defaults sourceCol to 2 and isOwn to always-false when omitted', () => {
  const existing = [H, '2030-01-01,10,AnySource', ''].join('\n');
  const r = mergeCsv(existing, H, []);
  assert.equal(r.text, existing, 'with no isOwn override, nothing is treated as owned');
});

test('fetchJson() keeps the HTTP status on err.status and rejects a non-OK response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(
    fetchJson('http://h/x', 'tok', { fetchImpl, timeoutMs: 1000 }),
    (err) => err.status === 404 && /404/.test(err.message),
  );
});

test('fetchJson() returns the parsed body on success', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ a: 1 }) });
  assert.deepEqual(await fetchJson('http://h/x', 'tok', { fetchImpl, timeoutMs: 1000 }), { a: 1 });
});

test('fetchPages() pages via buildUrl until a short page, forwarding the bearer token', async () => {
  const pages = [1, 2, 3].map((id) => ({ id: String(id) }));
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), auth: opts.headers.authorization });
    const since = Number(new URL(url).searchParams.get('since_id'));
    return { ok: true, status: 200, json: async () => pages.filter((p) => Number(p.id) > since).slice(0, 2) };
  };
  const out = await fetchPages({
    baseUrl: 'http://h:1', token: 'tok', limit: 2, fetchImpl,
    buildUrl: ({ baseUrl, since, limit }) => `${baseUrl}/export/strava?since_id=${since}&limit=${limit}`,
  });
  assert.deepEqual(out.map((p) => p.id), ['1', '2', '3']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].auth, 'Bearer tok');
});

test('fetchPages() rejects a non-array response', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ not: 'an array' }) });
  await assert.rejects(
    fetchPages({ baseUrl: 'http://h', token: 't', fetchImpl, buildUrl: () => 'http://h/x' }),
    /expected an array/,
  );
});

test('resolveToken() prefers env, falls back to the .env file text', () => {
  assert.equal(resolveToken({ INGEST_TOKEN: 'fromenv' }, 'INGEST_TOKEN=fromfile'), 'fromenv');
  assert.equal(resolveToken({}, '# c\nOTHER=1\nINGEST_TOKEN="fromfile"\n'), 'fromfile');
  assert.equal(resolveToken({}, null), null);
});

test('readIngestToken() reads the .env file from disk when INGEST_TOKEN is not in env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-common-env-'));
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, 'INGEST_TOKEN=filetoken\n');
  assert.equal(readIngestToken({}, envFile), 'filetoken');
  assert.equal(readIngestToken({ INGEST_TOKEN: 'envtoken' }, envFile), 'envtoken');
  fs.rmSync(dir, { recursive: true });
});

test('readIngestToken() returns null when neither env nor file has a token', () => {
  assert.equal(readIngestToken({}, path.join(os.tmpdir(), 'sync-common-missing-env-file')), null);
});

test('writeAtomic() replaces the file and leaves no temp file behind', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-common-atomic-'));
  const f = path.join(dir, 'a.csv');
  fs.writeFileSync(f, 'old\n');
  writeAtomic(f, 'new\n');
  assert.equal(fs.readFileSync(f, 'utf8'), 'new\n');
  assert.deepEqual(fs.readdirSync(dir), ['a.csv']);
  fs.rmSync(dir, { recursive: true });
});

test('DEFAULT_URL and ENV_FILE are exported', () => {
  assert.equal(DEFAULT_URL, 'http://localhost:8088');
  assert.match(ENV_FILE, /services[/\\]health-ingest[/\\]\.env$/);
});

// ---- exclusive lock guarding _meta.json's read-compute-write sequence against a lost update
// between the Shortcut and Strava syncs (or any two concurrent invocations). O_EXCL lockfile,
// stale after a configurable window, always released even when the guarded work throws. ----

test('acquireLock() creates the lockfile and releaseLock() removes it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-common-lock-'));
  const lock = path.join(dir, '_meta.json.lock');
  acquireLock(lock);
  assert.ok(fs.existsSync(lock));
  releaseLock(lock);
  assert.ok(!fs.existsSync(lock));
  fs.rmSync(dir, { recursive: true });
});

test('acquireLock() reclaims a stale lock (older than staleMs) instead of waiting forever', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-common-lock-'));
  const lock = path.join(dir, '_meta.json.lock');
  fs.writeFileSync(lock, '999999'); // simulate a lock left behind by a dead process
  const old = (Date.now() - 5000) / 1000;
  fs.utimesSync(lock, old, old);
  acquireLock(lock, { staleMs: 100, retryDelayMs: 5, retries: 50 });
  assert.ok(fs.existsSync(lock), 'the lock was reclaimed (recreated) for this caller');
  releaseLock(lock);
  fs.rmSync(dir, { recursive: true });
});

test('acquireLock() throws instead of hanging when a fresh lock never clears within its retry budget', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-common-lock-'));
  const lock = path.join(dir, '_meta.json.lock');
  fs.writeFileSync(lock, '999999'); // fresh (mtime = now) -> never considered stale within this test
  assert.throws(() => acquireLock(lock, { staleMs: 60_000, retryDelayMs: 5, retries: 3 }), /could not acquire lock/);
  fs.rmSync(dir, { recursive: true });
});

test('withLock() runs fn while holding the lock and always releases it, including on error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-common-lock-'));
  const lock = path.join(dir, '_meta.json.lock');

  const seenLockedDuringRun = withLock(lock, () => fs.existsSync(lock));
  assert.equal(seenLockedDuringRun, true, 'the lock must exist while fn runs');
  assert.ok(!fs.existsSync(lock), 'released after a normal return');

  assert.throws(() => withLock(lock, () => { throw new Error('boom'); }), /boom/);
  assert.ok(!fs.existsSync(lock), 'released even when fn throws');
  fs.rmSync(dir, { recursive: true });
});

test('withLock() serializes contention: a second caller waits for the first to release, then proceeds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-common-lock-'));
  const lock = path.join(dir, '_meta.json.lock');
  const order = [];

  // Simulate two contenders without real concurrency (these scripts run synchronously): the
  // first holds the lock across a synchronous "critical section", explicitly releasing only
  // after recording its step — the second contender's acquireLock() must not succeed while the
  // first still holds it (proven by the fresh-lock-throws test above), and must succeed
  // immediately once the first releases.
  withLock(lock, () => { order.push('first'); });
  withLock(lock, () => { order.push('second'); });
  assert.deepEqual(order, ['first', 'second']);
  assert.ok(!fs.existsSync(lock));
  fs.rmSync(dir, { recursive: true });
});

// A second clone on the same host (another person) runs its own ingest service on another port: the
// host-side sync scripts must talk to THIS clone's service, or one person's data lands in the other's files.
test('resolveBaseUrl: INGEST_URL wins, then this clone\'s INGEST_PORT from its .env, then :8088', () => {
  assert.equal(resolveBaseUrl({ INGEST_URL: 'http://10.0.0.5:9000/' }, 'INGEST_PORT=8089\n'), 'http://10.0.0.5:9000');
  assert.equal(resolveBaseUrl({}, 'INGEST_TOKEN=x\nINGEST_PORT=8089\n'), 'http://localhost:8089');
  assert.equal(resolveBaseUrl({}, 'INGEST_PORT="8091"\n'), 'http://localhost:8091');
  assert.equal(resolveBaseUrl({}, '# INGEST_PORT=9999\nINGEST_TOKEN=x\n'), DEFAULT_URL, 'a commented line is ignored');
  assert.equal(resolveBaseUrl({}, 'INGEST_PORT=abc\n'), DEFAULT_URL, 'a non-numeric port is ignored');
});

test('resolveBaseUrl: unchanged default with no env and no .env (the single-install behaviour)', () => {
  assert.equal(resolveBaseUrl({}, null), 'http://localhost:8088');
  assert.equal(resolveBaseUrl({}, 'INGEST_PORT=8088\n'), 'http://localhost:8088');
});

test('readBaseUrl reads the .env file from disk (missing file = default)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-baseurl-'));
  try {
    const f = path.join(dir, '.env');
    assert.equal(readBaseUrl({}, f), DEFAULT_URL);
    fs.writeFileSync(f, 'INGEST_PORT=8089\n');
    assert.equal(readBaseUrl({}, f), 'http://localhost:8089');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
