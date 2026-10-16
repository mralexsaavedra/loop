/* Client mode of `npm run sync` (scripts/sync-client.mjs, wired in scripts/sync-all.mjs): a clone of a LOOP server
 * in container mode mirrors the server's data root over HTTP. Every test runs a fake server on 127.0.0.1 that speaks
 * the real routes: POST /sync, GET /export/files, GET /export/file (services/loop-ingest/src/files-export.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { detectServer, waitForSeq, mirrorFiles, syncWaitSeconds } from './sync-client.mjs';
import { main as syncAll, SCRIPTS } from './sync-all.mjs';

const TOKEN = 'k'.repeat(40);
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** The fake server. `files`: path -> Buffer. `state.processedSeq` advances by `advance` per manifest poll once a sync
 * was requested. `lie`: paths whose manifest sha256 is wrong. `status`: force one answer on the manifest route. */
async function fakeServer({ files = {}, processedSeq = 0, advance = 1, lie = [], status = null, error = null } = {}) {
  const state = { files: new Map(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)])), processedSeq, seq: processedSeq, posts: 0, polls: 0, downloads: [], auth: [], error };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'POST' && url.pathname === '/sync') {
      state.posts += 1;
      state.seq += 1;
      return json(202, { ok: true, seq: state.seq, coalesced: false });
    }
    if (url.pathname === '/export/files' || url.pathname === '/export/file') {
      state.auth.push(req.headers.authorization ?? null);
      if (status) return json(status, { error: 'x' });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: 'unauthorized' });
      if (url.pathname === '/export/files') {
        state.polls += 1;
        if (state.posts && state.processedSeq < state.seq) state.processedSeq = Math.min(state.seq, state.processedSeq + advance);
        const list = [...state.files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([p, b]) => ({ path: p, size: b.length, sha256: lie.includes(p) ? sha(Buffer.from('other')) : sha(b), mtimeMs: 1 }));
        return json(200, { files: list, site: { processedSeq: state.processedSeq, error: state.error?.code ?? null, errorSeq: state.error?.seq ?? null } });
      }
      const p = url.searchParams.get('path');
      state.downloads.push(p);
      const b = state.files.get(p);
      if (!b) return json(404, { error: 'not_found' });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': b.length });
      return res.end(b);
    }
    json(404, { error: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { state, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

function clone() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-client-'));
  const root = path.join(dir, 'loop-data');
  return {
    dir,
    root,
    put(rel, content) { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); return f; },
    read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); },
    exists(rel) { return fs.existsSync(path.join(root, rel)); },
    env(base, extra = {}) { return { SYNC_CLIENT_ROOT: dir, HC_DATA_DIR: root, INGEST_URL: base, INGEST_TOKEN: TOKEN, INGEST_ENV_FILE: path.join(dir, 'none.env'), ...extra }; },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const SERVER_FILES = {
  'extract/weight.csv': 'date,value,source\n2026-10-01,80,Scale\n',
  'extract/_meta.json': '{"exportLastDate":"2026-10-01"}\n',
  'profile/settings.json': '{"goal":"cut"}\n',
  'foodlog/foodlog-daily.csv': 'date,kcal\n',
  'files/documents/clinical/blood.pdf': '%PDF blood',
  'files/manuals/edge.pdf': '%PDF manual',
};

const quiet = () => { const out = { logs: [], warns: [] }; out.log = (m) => out.logs.push(m); out.warn = (m) => out.warns.push(m); return out; };
const noSleep = async () => {};

test('detectServer: 200 manifest = client, 404 = host, 401 = unauthorized, no server = host', async () => {
  const s = await fakeServer({ files: SERVER_FILES });
  const host = await fakeServer({ status: 404 });
  const denied = await fakeServer({ status: 401 });
  try {
    const client = await detectServer({ base: s.base, token: TOKEN });
    assert.equal(client.mode, 'client');
    assert.equal(client.manifest.files.length, 6);
    assert.equal(s.state.auth[0], `Bearer ${TOKEN}`);
    assert.equal((await detectServer({ base: host.base, token: TOKEN })).mode, 'host');
    assert.equal((await detectServer({ base: denied.base, token: TOKEN })).mode, 'unauthorized');
    assert.equal((await detectServer({ base: s.base, token: 'wrong'.repeat(8) })).mode, 'unauthorized');
    const gone = await detectServer({ base: 'http://127.0.0.1:1', token: TOKEN });
    assert.equal(gone.mode, 'host');
    assert.match(gone.reason, /./);
  } finally {
    await Promise.all([s.close(), host.close(), denied.close()]);
  }
});

test('waitForSeq: POST /sync, then poll the manifest until the server processed that seq', async () => {
  const s = await fakeServer({ files: SERVER_FILES, processedSeq: 3, advance: 1 });
  const out = quiet();
  try {
    // POST -> seq 4; the first poll moves processedSeq 3 -> 4
    const r = await waitForSeq({ base: s.base, token: TOKEN, waitSeconds: 120, sleep: noSleep, ...out });
    assert.equal(s.state.posts, 1);
    assert.equal(r.waited, true);
    assert.equal(r.seq, 4);
    assert.equal(r.manifest.site.processedSeq, 4);
    assert.deepEqual(out.warns, []);
  } finally {
    await s.close();
  }
});

test('waitForSeq: bounded by HC_SYNC_WAIT, then pulls anyway with a WARNING', async () => {
  const s = await fakeServer({ files: SERVER_FILES, processedSeq: 3, advance: 0 });
  const out = quiet();
  let t = 0;
  try {
    const r = await waitForSeq({ base: s.base, token: TOKEN, waitSeconds: 10, sleep: async (ms) => { t += ms; }, now: () => t, ...out });
    assert.equal(r.waited, false);
    assert.ok(r.manifest.files.length === 6);
    assert.equal(out.warns.length, 1);
    assert.match(out.warns[0], /^WARNING: .*sync 4.* 10 s \(HC_SYNC_WAIT\).*anyway/);
    assert.ok(t >= 10_000 && t <= 12_000, String(t));
  } finally {
    await s.close();
  }
});

test('waitForSeq: a failed server build for that seq stops the wait with a WARNING', async () => {
  const s = await fakeServer({ files: SERVER_FILES, processedSeq: 3, advance: 0, error: { code: 'build', seq: 4 } });
  const out = quiet();
  try {
    const r = await waitForSeq({ base: s.base, token: TOKEN, waitSeconds: 120, sleep: noSleep, ...out });
    assert.equal(r.waited, false);
    assert.equal(s.state.polls, 1);
    assert.match(out.warns[0], /^WARNING: .*build failed \(build\).*sync 4/);
  } finally {
    await s.close();
  }
});

test('waitForSeq: an older failure (errorSeq below the requested seq) does not stop the wait', async () => {
  const s = await fakeServer({ files: SERVER_FILES, processedSeq: 3, advance: 1, error: { code: 'build', seq: 2 } });
  const out = quiet();
  try {
    const r = await waitForSeq({ base: s.base, token: TOKEN, waitSeconds: 120, sleep: noSleep, ...out });
    assert.equal(r.waited, true);
  } finally {
    await s.close();
  }
});

test('syncWaitSeconds: HC_SYNC_WAIT whole seconds 1-3600, default 120; anything else throws', () => {
  assert.equal(syncWaitSeconds({}), 120);
  assert.equal(syncWaitSeconds({ HC_SYNC_WAIT: ' ' }), 120);
  assert.equal(syncWaitSeconds({ HC_SYNC_WAIT: '30' }), 30);
  for (const v of ['0', '3601', '2m', '-1', '1.5']) assert.throws(() => syncWaitSeconds({ HC_SYNC_WAIT: v }), /HC_SYNC_WAIT/, v);
});

test('mirrorFiles: downloads every file, then nothing on a second run (sha256 compare)', async () => {
  const s = await fakeServer({ files: SERVER_FILES });
  const c = clone();
  const out = quiet();
  try {
    const manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    const code = await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, ...out });
    assert.equal(code, 0);
    for (const [p, content] of Object.entries(SERVER_FILES)) assert.equal(c.read(p), content, p);
    assert.match(out.logs.at(-1), /^Mirror: 6 files on the server: 6 downloaded, 0 unchanged, 0 removed$/);
    s.state.downloads.length = 0;
    const again = quiet();
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, ...again }), 0);
    assert.deepEqual(s.state.downloads, []);
    assert.match(again.logs.at(-1), /: 0 downloaded, 6 unchanged, 0 removed$/);
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('mirrorFiles: replaces a changed file, removes what the server no longer lists, never touches cache/, hidden files or other folders', async () => {
  const s = await fakeServer({ files: SERVER_FILES });
  const c = clone();
  const out = quiet();
  try {
    c.put('extract/weight.csv', 'stale');
    c.put('extract/old.csv', 'gone on the server');
    c.put('files/manuals/old-manual.pdf', 'removed manual');
    c.put('cache/plan.json', '{"local":"edit"}');
    c.put('cache/.sync-state.json', '{}');
    c.put('extract/.shortcut-cache.json', '{}');
    c.put('files/import/export.zip', 'zip');
    c.put('analysis.txt', 'x');
    const outside = path.join(c.dir, 'outside.csv');
    fs.writeFileSync(outside, 'keep');
    fs.symlinkSync(outside, path.join(c.root, 'extract', 'link.csv'));
    const manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, ...out }), 0);
    assert.equal(c.read('extract/weight.csv'), SERVER_FILES['extract/weight.csv']);
    assert.ok(!c.exists('extract/old.csv'));
    assert.ok(!c.exists('files/manuals/old-manual.pdf'));
    for (const p of ['cache/plan.json', 'cache/.sync-state.json', 'extract/.shortcut-cache.json', 'files/import/export.zip', 'analysis.txt']) assert.ok(c.exists(p), p);
    assert.ok(fs.lstatSync(path.join(c.root, 'extract', 'link.csv')).isSymbolicLink());
    assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');
    assert.match(out.logs.at(-1), /6 downloaded, 0 unchanged, 2 removed$/);
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('mirrorFiles: a download whose sha256 does not match is refused (local file kept, no temp file left), exit 1', async () => {
  const s = await fakeServer({ files: SERVER_FILES, lie: ['extract/weight.csv'] });
  const c = clone();
  const out = quiet();
  try {
    c.put('extract/weight.csv', 'mine');
    const manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, ...out }), 1);
    assert.equal(c.read('extract/weight.csv'), 'mine');
    assert.deepEqual(fs.readdirSync(path.join(c.root, 'extract')).sort(), ['_meta.json', 'weight.csv']);
    assert.match(out.warns.join('\n'), /extract\/weight\.csv.*sha256/);
    assert.match(out.logs.at(-1), /5 downloaded, 0 unchanged, 0 removed, 1 failed$/);
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('mirrorFiles: a manifest with a path outside the allowlist or a traversal is refused as a whole (nothing written or removed)', async () => {
  const c = clone();
  try {
    c.put('extract/old.csv', 'x');
    for (const bad of ['../evil.csv', 'cache/plan.json', 'extract/../../evil', '/abs/x', 'extract\\x', 'files/import/x.zip']) {
      const out = quiet();
      const manifest = { files: [{ path: bad, size: 1, sha256: sha(Buffer.from('x')), mtimeMs: 1 }], site: { processedSeq: 0 } };
      const code = await mirrorFiles({ base: 'http://127.0.0.1:1', token: TOKEN, manifest, root: c.root, ...out });
      assert.equal(code, 1, bad);
      assert.match(out.warns.join('\n'), /^ERROR: .*manifest/, bad);
      assert.ok(c.exists('extract/old.csv'), bad);
    }
    assert.ok(!fs.existsSync(path.join(c.dir, 'evil.csv')));
  } finally {
    c.cleanup();
  }
});

test('mirrorFiles: files/* follow HC_FILES_DIR when the clone sets it', async () => {
  const s = await fakeServer({ files: SERVER_FILES });
  const c = clone();
  try {
    const filesDir = path.join(c.dir, 'my-files');
    const manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, filesDir, ...quiet() }), 0);
    assert.equal(fs.readFileSync(path.join(filesDir, 'manuals', 'edge.pdf'), 'utf8'), '%PDF manual');
    assert.ok(!c.exists('files/manuals/edge.pdf'));
  } finally {
    await s.close();
    c.cleanup();
  }
});

/* ---------- npm run sync (scripts/sync-all.mjs main) ---------- */

function recordSpawn() {
  const calls = [];
  return { calls, spawn: (cmd, args) => { calls.push(path.relative(path.dirname(path.dirname(new URL(import.meta.url).pathname)), args[0])); return { status: 0 }; } };
}

test('npm run sync against a container-mode server: POST /sync + wait, sync-documents only, then the mirror', async () => {
  const s = await fakeServer({ files: SERVER_FILES, processedSeq: 1 });
  const c = clone();
  const out = quiet();
  const sp = recordSpawn();
  try {
    const code = await syncAll({}, { env: c.env(s.base), spawn: sp.spawn, sleep: noSleep, ...out });
    assert.equal(code, 0);
    assert.equal(s.state.posts, 1);
    assert.deepEqual(sp.calls, ['scripts/sync-documents.mjs']);
    assert.match(out.logs.join('\n'), /client mode/i);
    assert.equal(c.read('extract/weight.csv'), SERVER_FILES['extract/weight.csv']);
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('npm run sync -- --no-refresh skips the POST /sync wait but still mirrors', async () => {
  const s = await fakeServer({ files: SERVER_FILES });
  const c = clone();
  const sp = recordSpawn();
  try {
    assert.equal(await syncAll({ 'no-refresh': true }, { env: c.env(s.base), spawn: sp.spawn, sleep: noSleep, ...quiet() }), 0);
    assert.equal(s.state.posts, 0);
    assert.ok(c.exists('files/documents/clinical/blood.pdf'));
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('npm run sync against a host-mode server (404) runs every sync script as today and mirrors nothing', async () => {
  const s = await fakeServer({ status: 404 });
  const c = clone();
  const sp = recordSpawn();
  try {
    assert.equal(await syncAll({ full: true }, { env: c.env(s.base), spawn: sp.spawn, sleep: noSleep, ...quiet() }), 0);
    assert.equal(sp.calls.length, SCRIPTS.length);
    assert.equal(s.state.posts, 0);
    assert.ok(!c.exists('extract'));
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('npm run sync with a refused token (401) fails with an error naming INGEST_TOKEN, nothing else runs', async () => {
  const s = await fakeServer({ status: 401 });
  const c = clone();
  const out = quiet();
  const sp = recordSpawn();
  try {
    assert.equal(await syncAll({}, { env: c.env(s.base), spawn: sp.spawn, sleep: noSleep, ...out }), 1);
    assert.deepEqual(sp.calls, []);
    assert.match(out.warns.join('\n'), /^ERROR: .*401.*INGEST_TOKEN/m);
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('npm run sync inside the server (HC_BUILD=container) never asks the manifest: the host syncs run', async () => {
  const s = await fakeServer({ files: SERVER_FILES });
  const c = clone();
  const sp = recordSpawn();
  try {
    assert.equal(await syncAll({}, { env: c.env(s.base, { HC_BUILD: 'container' }), spawn: sp.spawn, sleep: noSleep, ...quiet() }), 0);
    assert.equal(sp.calls.length, SCRIPTS.length);
    assert.deepEqual(s.state.auth, []);
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('npm run sync with no token runs the host syncs (they warn as today)', async () => {
  const s = await fakeServer({ files: SERVER_FILES });
  const c = clone();
  const sp = recordSpawn();
  try {
    const env = c.env(s.base);
    delete env.INGEST_TOKEN;
    assert.equal(await syncAll({}, { env, spawn: sp.spawn, sleep: noSleep, ...quiet() }), 0);
    assert.equal(sp.calls.length, SCRIPTS.length);
    assert.deepEqual(s.state.auth, []);
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('npm run sync in client mode exits 1 when sync-documents failed, after still mirroring', async () => {
  const s = await fakeServer({ files: SERVER_FILES });
  const c = clone();
  try {
    const code = await syncAll({ 'no-refresh': true }, { env: c.env(s.base), spawn: () => ({ status: 1 }), sleep: noSleep, ...quiet() });
    assert.equal(code, 1);
    assert.ok(c.exists('extract/weight.csv'));
  } finally {
    await s.close();
    c.cleanup();
  }
});
