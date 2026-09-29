/* Tests for the helpers shared by data/apple-health's sync scripts (Shortcut + Strava).
 * Pure functions only where possible; disk I/O tested against real temp files, SYNTHETIC
 * fixtures (no real personal values), no network. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const common = require('./sync-common.js');

const { mergeCsv, fetchJson, fetchPages, resolveToken, readIngestToken, writeAtomic, DEFAULT_URL, ENV_FILE } = common;

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
