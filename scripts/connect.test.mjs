/* `npm run connect -- <url>` (scripts/connect.mjs): saves a LOOP server's URL + token for this clone in
 * <data root>/server.json (mode 600) after checking it answers GET /export/files with the token. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { main } from './connect.mjs';
import { readIngestToken, readBaseUrl } from '../data/apple-health/sync-common.mjs';

const TOKEN = 't'.repeat(40);

async function server(status) {
  const seen = [];
  const s = http.createServer((req, res) => {
    seen.push({ path: req.url, auth: req.headers.authorization ?? null });
    if (req.url === '/export/files' && status === 200 && req.headers.authorization === `Bearer ${TOKEN}`) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ files: [], site: { processedSeq: 0, error: null, errorSeq: null } }));
    }
    res.writeHead(status === 200 ? 401 : status, { 'content-type': 'application/json' });
    res.end('{"error":"x"}');
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { seen, url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => s.close(r)) };
}

function clone() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-connect-'));
  const data = path.join(dir, 'loop-data');
  return { dir, data, file: path.join(data, 'server.json'), env: (extra = {}) => ({ SYNC_CLIENT_ROOT: dir, HC_DATA_DIR: data, INGEST_ENV_FILE: path.join(dir, 'none.env'), ...extra }), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const run = async (argv, env, extra = {}) => {
  const out = { logs: [], warns: [] };
  const code = await main({ argv, env, log: (m) => out.logs.push(m), warn: (m) => out.warns.push(m), isTTY: false, ...extra });
  return { code, ...out };
};

test('connect: a container-mode server (200) is saved to <data root>/server.json {url, token} with mode 600; npm run sync then reads it', async (t) => {
  const s = await server(200);
  const c = clone();
  t.after(async () => { await s.close(); c.cleanup(); });
  const r = await run([`${s.url}/`], c.env({ INGEST_TOKEN: TOKEN }));
  assert.equal(r.code, 0, r.warns.join('\n'));
  assert.deepEqual(JSON.parse(fs.readFileSync(c.file, 'utf8')), { url: s.url, token: TOKEN });
  assert.equal(fs.statSync(c.file).mode & 0o777, 0o600);
  assert.deepEqual(s.seen, [{ path: '/export/files', auth: `Bearer ${TOKEN}` }]);
  assert.match(r.logs.join('\n'), /^Connected: .* is a LOOP server; saved to .*server\.json \(mode 600\)/m);
  assert.ok(!r.logs.join('\n').includes(TOKEN), 'the token is never printed');
  const env = { HC_DATA_DIR: c.data, INGEST_ENV_FILE: path.join(c.dir, 'none.env') };
  assert.equal(readIngestToken(env), TOKEN);
  assert.equal(readBaseUrl(env), s.url);
});

test('connect: the token comes from a TTY prompt without echo when INGEST_TOKEN is unset', async (t) => {
  const s = await server(200);
  const c = clone();
  t.after(async () => { await s.close(); c.cleanup(); });
  const asked = [];
  const r = await run([s.url], c.env(), { isTTY: true, prompt: async (q) => { asked.push(q); return TOKEN; } });
  assert.equal(r.code, 0, r.warns.join('\n'));
  assert.match(asked[0], /token/i);
  assert.equal(JSON.parse(fs.readFileSync(c.file, 'utf8')).token, TOKEN);
});

test('connect: a refused token (401) and a host-mode server (404) save nothing, exit 1, each with its reason', async (t) => {
  const c = clone();
  t.after(() => c.cleanup());
  const s401 = await server(200);
  const bad = await run([s401.url], c.env({ INGEST_TOKEN: 'wrong' }));
  await s401.close();
  assert.equal(bad.code, 1);
  assert.match(bad.warns.join('\n'), /^ERROR: .* refused the token \(HTTP 401\).*nothing saved/m);
  const s404 = await server(404);
  const host = await run([s404.url], c.env({ INGEST_TOKEN: TOKEN }));
  await s404.close();
  assert.equal(host.code, 1);
  assert.match(host.warns.join('\n'), /^ERROR: .* has no \/export\/files \(HTTP 404\): a host-mode LOOP server.*nothing saved/m);
  const none = await run(['http://127.0.0.1:9'], c.env({ INGEST_TOKEN: TOKEN }));
  assert.equal(none.code, 1);
  assert.match(none.warns.join('\n'), /^ERROR: could not reach http:\/\/127\.0\.0\.1:9 .*nothing saved/m);
  assert.equal(fs.existsSync(c.file), false);
});

test('connect: no token and no terminal, a bad URL or no URL are refused (exit 1 / 2), nothing saved', async (t) => {
  const c = clone();
  t.after(() => c.cleanup());
  const noToken = await run(['http://127.0.0.1:9'], c.env());
  assert.equal(noToken.code, 1);
  assert.match(noToken.warns.join('\n'), /INGEST_TOKEN/);
  for (const url of ['ftp://x', 'not a url', 'http://user:pw@h:1', 'http://h:1/path?q=1']) {
    const r = await run([url], c.env({ INGEST_TOKEN: TOKEN }));
    assert.equal(r.code, 1, url);
    assert.match(r.warns.join('\n'), /^ERROR: .*URL/m, url);
  }
  assert.equal((await run([], c.env({ INGEST_TOKEN: TOKEN }))).code, 2);
  assert.equal(fs.existsSync(c.file), false);
});

test('connect -- --forget removes the saved server (and says so when there is none)', async (t) => {
  const c = clone();
  t.after(() => c.cleanup());
  fs.mkdirSync(c.data);
  fs.writeFileSync(c.file, JSON.stringify({ url: 'http://h:1', token: TOKEN }));
  const r = await run(['--forget'], c.env());
  assert.equal(r.code, 0);
  assert.equal(fs.existsSync(c.file), false);
  assert.match(r.logs.join('\n'), /^Forgot the saved server/m);
  const again = await run(['--forget'], c.env());
  assert.equal(again.code, 0);
  assert.match(again.logs.join('\n'), /^No saved server/m);
});
