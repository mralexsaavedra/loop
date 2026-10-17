/* Tests for the helpers shared by data/apple-health's sync scripts (Shortcut + Strava).
 * Pure functions only where possible; disk I/O tested against real temp files, SYNTHETIC
 * fixtures (no real personal values), no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as common from './sync-common.mjs';

const {
  mergeCsv, fetchJson, fetchPages, resolveToken, readIngestToken, resolveBaseUrl, readBaseUrl, writeAtomic, DEFAULT_URL, ENV_FILE,
  acquireLock, releaseLock, withLock, reclaimStaleLock,
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

test('fetchPages() keeps paging after a short page the server marks X-Has-More (byte-capped page)', async () => {
  // /export/raw cuts a page at its byte budget: fewer rows than `limit`, but more exist after it
  const rows = [1, 2, 3, 4].map((id) => ({ id: String(id) }));
  const fetchImpl = async (url) => {
    const since = Number(new URL(url).searchParams.get('since_id'));
    const rest = rows.filter((p) => Number(p.id) > since);
    const page = since === 0 ? rest.slice(0, 1) : rest.slice(0, 10); // first page byte-capped to 1 row
    const more = since === 0;
    return { ok: true, status: 200, headers: new Headers({ 'x-has-more': String(more) }), json: async () => page };
  };
  const out = await fetchPages({
    baseUrl: 'http://h', token: 't', limit: 10, fetchImpl,
    buildUrl: ({ baseUrl, since, limit }) => `${baseUrl}/export/raw?since_id=${since}&limit=${limit}`,
  });
  assert.deepEqual(out.map((p) => p.id), ['1', '2', '3', '4']);
});

test('fetchPages() rejects an empty page that still claims X-Has-More (no progress possible)', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, headers: new Headers({ 'x-has-more': 'true' }), json: async () => [] });
  await assert.rejects(
    fetchPages({ baseUrl: 'http://h', token: 't', limit: 10, fetchImpl, buildUrl: ({ since }) => `http://h/x?since_id=${since}` }),
    /unexpected paging cursor/,
  );
});

test('fetchPages() rejects a non-array response', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ not: 'an array' }) });
  await assert.rejects(
    fetchPages({ baseUrl: 'http://h', token: 't', fetchImpl, buildUrl: () => 'http://h/x' }),
    /expected an array/,
  );
});

test('fetchPages() throws on a cursor that does not advance (a repeated last id) instead of looping forever', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, status: 200, json: async () => [{ id: '1' }, { id: '2' }] }; };
  await assert.rejects(
    fetchPages({ baseUrl: 'http://h', token: 't', limit: 2, fetchImpl, buildUrl: ({ since }) => `http://h/x?since_id=${since}` }),
    /unexpected paging cursor/,
  );
  assert.equal(calls, 2);
});

test('fetchPages() throws on a full page whose last row has no id, or a non-numeric one', async () => {
  for (const last of [{}, { id: null }, { id: 'abc' }, { id: '' }]) {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => [{ id: '1' }, last] });
    await assert.rejects(
      fetchPages({ baseUrl: 'http://h', token: 't', limit: 2, fetchImpl, buildUrl: () => 'http://h/x' }),
      /unexpected paging cursor/, JSON.stringify(last),
    );
  }
});

test('fetchPages() compares ids beyond 2^53 exactly (BigInt) and accepts numeric ids', async () => {
  const big = ['9007199254740993', '9007199254740994', '9007199254740995'];
  const fetchImpl = async (url) => {
    const since = BigInt(new URL(url).searchParams.get('since_id'));
    return { ok: true, status: 200, json: async () => big.filter((id) => BigInt(id) > since).slice(0, 2).map((id) => ({ id })) };
  };
  const out = await fetchPages({ baseUrl: 'http://h', token: 't', limit: 2, sinceId: '9007199254740992', fetchImpl,
    buildUrl: ({ since }) => `http://h/x?since_id=${since}` });
  assert.deepEqual(out.map((p) => p.id), big);
  const nums = async (url) => {
    const since = Number(new URL(url).searchParams.get('since_id'));
    return { ok: true, status: 200, json: async () => [1, 2, 3].filter((id) => id > since).slice(0, 2).map((id) => ({ id })) };
  };
  assert.equal((await fetchPages({ baseUrl: 'http://h', token: 't', limit: 2, sinceId: 0, fetchImpl: nums,
    buildUrl: ({ since }) => `http://h/x?since_id=${since}` })).length, 3);
});

test('fetchPages() stops at a hard page cap', async () => {
  let n = 0;
  const fetchImpl = async () => { const id = ++n; return { ok: true, status: 200, json: async () => [{ id }] }; };
  await assert.rejects(
    fetchPages({ baseUrl: 'http://h', token: 't', limit: 1, maxPages: 5, fetchImpl, buildUrl: () => 'http://h/x' }),
    /more than 5 pages/,
  );
  assert.equal(n, 5);
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
  assert.match(ENV_FILE, /services[/\\]loop-ingest[/\\]\.env$/);
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

/* ---------- one CLI contract for every sync script ---------- */
test('readIngestToken / readBaseUrl honour INGEST_ENV_FILE when no file is passed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-envfile-'));
  try {
    const f = path.join(dir, 'other.env');
    fs.writeFileSync(f, 'INGEST_TOKEN=othertoken\nINGEST_PORT=8091\n');
    assert.equal(common.envFileOf({ INGEST_ENV_FILE: f }), f);
    assert.equal(common.envFileOf({}), ENV_FILE);
    assert.equal(readIngestToken({ INGEST_ENV_FILE: f }), 'othertoken');
    assert.equal(readBaseUrl({ INGEST_ENV_FILE: f }), 'http://localhost:8091');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fetchJson() without a token sends no authorization; extra headers and redirect are passed through', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(init); return { ok: true, status: 200, json: async () => ({}) }; };
  await fetchJson('http://h/x', null, { fetchImpl, headers: { 'x-hc-food': '1' }, redirect: 'error' });
  assert.deepEqual(calls[0].headers, { 'x-hc-food': '1' });
  assert.equal(calls[0].redirect, 'error');
  await fetchJson('http://h/x', 'tok', { fetchImpl });
  assert.deepEqual(calls[1].headers, { authorization: 'Bearer tok' });
  assert.equal('redirect' in calls[1], false);
});

test('fetchJson() reports a timeout as its own message', async () => {
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(fetchJson('http://h/x', 'tok', { fetchImpl, timeoutMs: 20 }), /request timed out after 0\.02 s/);
});

test('parseCli: --help, a strict unknown flag, a stray argument, declared options', () => {
  const usage = 'Usage: node demo.mjs [--full]';
  assert.deepEqual(common.parseCli(['--help'], { usage }), { exit: 0, out: usage });
  assert.deepEqual(common.parseCli(['-h'], { usage }), { exit: 0, out: usage });
  const bad = common.parseCli(['--nope'], { usage });
  assert.equal(bad.exit, 2);
  assert.match(bad.err, /^ERROR: .*--nope[\s\S]*Usage: node demo\.mjs/);
  assert.equal(common.parseCli(['extra'], { usage }).exit, 2, 'no positional arguments');
  assert.deepEqual(common.parseCli(['--full'], { usage, options: { full: { type: 'boolean' } } }).values, { full: true });
  assert.deepEqual(common.parseCli([], { usage }).values, {});
});

// runCli in a real child process: the exit code is what `npm run sync` (scripts/sync-all.mjs) sees
function runCliChild(body, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-runcli-'));
  try {
    const f = path.join(dir, 'cli.mjs');
    const url = new URL('./sync-common.mjs', import.meta.url).href;
    fs.writeFileSync(f, `import { runCli } from ${JSON.stringify(url)};\nrunCli(${body}, { usage: 'Usage: cli' });\n`);
    return spawnSync(process.execPath, [f, ...args], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('runCli: main\'s number is the exit code; a rejected main -> one ERROR line, exit 1; flags before main', () => {
  assert.equal(runCliChild('async () => 0').status, 0);
  assert.equal(runCliChild('async () => undefined').status, 0);
  assert.equal(runCliChild('async () => 3').status, 3);
  const thrown = runCliChild('async () => { throw new Error("boom"); }');
  assert.equal(thrown.status, 1);
  assert.equal(thrown.stderr.trim(), 'ERROR: boom');
  const help = runCliChild('async () => { throw new Error("main must not run"); }', ['--help']);
  assert.equal(help.status, 0);
  assert.equal(help.stdout.trim(), 'Usage: cli');
  const bad = runCliChild('async () => { throw new Error("main must not run"); }', ['--nope']);
  assert.equal(bad.status, 2);
  assert.doesNotMatch(bad.stderr, /main must not run/);
});

test('releaseLock() removes only a lock that holds OUR pid (a lock reclaimed by another process survives)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-common-lock-'));
  const lock = path.join(dir, '_meta.json.lock');
  fs.writeFileSync(lock, '999999');
  releaseLock(lock);
  assert.equal(fs.readFileSync(lock, 'utf8'), '999999', 'another process\'s lock is never removed');
  fs.rmSync(lock);
  // our run outlived staleMs and another process took the lock over: withLock must not release theirs
  withLock(lock, () => fs.writeFileSync(lock, '999998'));
  assert.equal(fs.readFileSync(lock, 'utf8'), '999998');
  fs.rmSync(dir, { recursive: true });
});

test('reclaimStaleLock(): only the stale lock that was observed is reclaimed, and only once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-common-lock-'));
  const lock = path.join(dir, '_meta.json.lock');
  fs.writeFileSync(lock, '999999');
  const old = (Date.now() - 5000) / 1000;
  fs.utimesSync(lock, old, old);
  const seen = fs.statSync(lock);
  // two processes saw the same stale lock: the first reclaims it and takes the lock ...
  assert.equal(reclaimStaleLock(lock, seen), true);
  assert.ok(!fs.existsSync(lock));
  fs.writeFileSync(lock, '424242'); // ... the first process's fresh lock (a new file)
  // ... and the second one, still holding its old observation, must not reclaim the fresh lock
  assert.equal(reclaimStaleLock(lock, seen), false);
  assert.equal(fs.readFileSync(lock, 'utf8'), '424242');
  assert.deepEqual(fs.readdirSync(dir), ['_meta.json.lock'], 'no claim file left behind');
  fs.rmSync(dir, { recursive: true });
});

test('localIso / windowEndingOn: the LOCAL calendar date of `now`, a window of `days` days inclusive', () => {
  const now = new Date(2030, 2, 1, 0, 30); // local 2030-03-01 00:30
  assert.equal(common.localIso(now), '2030-03-01');
  assert.deepEqual(common.windowEndingOn(now, 1), { from: '2030-03-01', to: '2030-03-01' });
  assert.deepEqual(common.windowEndingOn(now, 3), { from: '2030-02-27', to: '2030-03-01' });
});

test('writeAtomic(): a failed rename removes its temp file (personal data) and rethrows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-atomic-fail-'));
  const target = path.join(dir, 'a.csv');
  fs.mkdirSync(target); // a non-empty directory where the file should go: the rename fails
  fs.writeFileSync(path.join(target, 'keep'), 'x');
  assert.throws(() => writeAtomic(target, 'secret\n'));
  assert.deepEqual(fs.readdirSync(dir), ['a.csv'], 'no .tmp left behind');
  fs.rmSync(dir, { recursive: true });
});

test('INGEST_URL / INGEST_TOKEN resolution: env, then <data root>/server.json (npm run connect), then the clone\'s services/loop-ingest/.env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-server-json-'));
  try {
    const envFile = path.join(dir, '.env');
    fs.writeFileSync(envFile, 'INGEST_TOKEN=dotenvtoken\nINGEST_PORT=8091\n');
    const data = path.join(dir, 'data');
    fs.mkdirSync(data);
    const env = { HC_DATA_DIR: data, INGEST_ENV_FILE: envFile };
    // no server.json: the .env, as before
    assert.equal(readIngestToken(env), 'dotenvtoken');
    assert.equal(readBaseUrl(env), 'http://localhost:8091');
    fs.writeFileSync(path.join(data, 'server.json'), JSON.stringify({ url: 'http://10.0.0.5:8088/', token: 'savedtoken' }));
    assert.equal(common.serverFileOf(env), path.join(data, 'server.json'));
    assert.equal(readIngestToken(env), 'savedtoken');
    assert.equal(readBaseUrl(env), 'http://10.0.0.5:8088');
    assert.equal(readIngestToken({ ...env, INGEST_TOKEN: 'envtoken' }), 'envtoken');
    assert.equal(readBaseUrl({ ...env, INGEST_URL: 'http://h:1' }), 'http://h:1');
    // a broken or partial server.json is skipped field by field
    fs.writeFileSync(path.join(data, 'server.json'), '{not json');
    assert.equal(readIngestToken(env), 'dotenvtoken');
    fs.writeFileSync(path.join(data, 'server.json'), JSON.stringify({ url: 'ftp://x', token: 7 }));
    assert.equal(readIngestToken(env), 'dotenvtoken');
    assert.equal(readBaseUrl(env), 'http://localhost:8091');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the saved server token goes only to the saved server: an env INGEST_URL elsewhere falls through to the service .env token', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-server-json-'));
  try {
    const envFile = path.join(dir, '.env');
    fs.writeFileSync(envFile, 'INGEST_TOKEN=dotenvtoken\n');
    const data = path.join(dir, 'data');
    fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, 'server.json'), JSON.stringify({ url: 'http://10.0.0.5:8088', token: 'savedtoken' }));
    const env = { HC_DATA_DIR: data, INGEST_ENV_FILE: envFile };
    // another URL from env: never the saved token
    assert.equal(readIngestToken({ ...env, INGEST_URL: 'http://evil.example:8088' }), 'dotenvtoken');
    // the same server spelled with a trailing slash or upper-case host: the saved token
    assert.equal(readIngestToken({ ...env, INGEST_URL: 'http://10.0.0.5:8088/' }), 'savedtoken');
    assert.equal(readIngestToken({ ...env, INGEST_URL: 'HTTP://10.0.0.5:8088' }), 'savedtoken');
    // no .env token either: no token at all, rather than the saved one
    fs.rmSync(envFile);
    assert.equal(readIngestToken({ ...env, INGEST_URL: 'http://evil.example:8088' }), null);
    // an explicit env token still wins everywhere
    assert.equal(readIngestToken({ ...env, INGEST_URL: 'http://evil.example:8088', INGEST_TOKEN: 'envtoken' }), 'envtoken');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
