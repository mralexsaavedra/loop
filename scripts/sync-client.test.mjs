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

/** Records `rels` (already in the clone) in its mirror ledger, as a previous mirror run would have. */
function mirrored(c, rels) {
  const file = path.join(c.root, '.mirror-state.json');
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, files: {}, warned: [] };
  for (const rel of rels) prev.files[rel] = sha(fs.readFileSync(path.join(c.root, rel)));
  fs.writeFileSync(file, JSON.stringify(prev));
}

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
    mirrored(c, ['extract/weight.csv', 'extract/old.csv', 'files/manuals/old-manual.pdf']);
    const manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, ...out }), 0);
    assert.equal(c.read('extract/weight.csv'), SERVER_FILES['extract/weight.csv']);
    assert.ok(!c.exists('extract/old.csv'));
    assert.ok(!c.exists('files/manuals/old-manual.pdf'));
    assert.equal(fs.readFileSync(path.join(c.dir, 'backups', 'files', 'manuals', 'old-manual.pdf.mirror.bak'), 'utf8'), 'removed manual');
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

/* ---------- mirror safety: the server's listing rules, mass removals, symlinked folders, what was removed ---------- */

test('mirrorFiles: a manifest naming a hidden, temp, lock or backup file (at any depth) is refused as a whole (nothing written or removed)', async () => {
  const c = clone();
  try {
    c.put('extract/old.csv', 'x');
    for (const bad of ['extract/.shortcut-cache.json', 'extract/weight.csv.4242.tmp', 'extract/_meta.json.lock', 'profile/settings.json.bak', 'files/documents/.hidden/a.pdf', 'files/documents/old.bak/a.pdf']) {
      const out = quiet();
      const manifest = { files: [{ path: 'extract/weight.csv', size: 1, sha256: sha(Buffer.from('x')), mtimeMs: 1 }, { path: bad, size: 1, sha256: sha(Buffer.from('x')), mtimeMs: 1 }], site: { processedSeq: 0 } };
      assert.equal(await mirrorFiles({ base: 'http://127.0.0.1:1', token: TOKEN, manifest, root: c.root, ...out }), 1, bad);
      assert.match(out.warns.join('\n'), /^ERROR: .*manifest was refused/, bad);
      assert.ok(c.exists('extract/old.csv'), bad);
      assert.ok(!c.exists('extract/weight.csv'), bad);
    }
  } finally {
    c.cleanup();
  }
});

const MANY = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`extract/f${i}.csv`, `v${i}\n`]));

test('mirrorFiles: an empty manifest while the clone has mirrored files is refused (exit 1, nothing removed) unless allowEmpty', async () => {
  const s = await fakeServer({ files: {} });
  const c = clone();
  try {
    c.put('extract/weight.csv', 'mine');
    c.put('files/manuals/edge.pdf', 'pdf');
    mirrored(c, ['extract/weight.csv', 'files/manuals/edge.pdf']);
    const manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    const out = quiet();
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, ...out }), 1);
    assert.match(out.warns.join('\n'), /^ERROR: the server lists no files.*--allow-empty/m);
    assert.ok(c.exists('extract/weight.csv') && c.exists('files/manuals/edge.pdf'));
    const ok = quiet();
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, allowEmpty: true, ...ok }), 0);
    assert.ok(!c.exists('extract/weight.csv') && !c.exists('files/manuals/edge.pdf'));
    assert.match(ok.logs.at(-1), /0 downloaded, 0 unchanged, 2 removed$/);
    // a fresh clone (nothing mirrored yet) and an empty server: nothing to protect, exit 0
    const fresh = clone();
    try {
      assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: fresh.root, ...quiet() }), 0);
    } finally {
      fresh.cleanup();
    }
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('mirrorFiles: removing more than half of the mirrored files (and more than 5) is refused unless allowRemovals; 5 or fewer go ahead', async () => {
  const s = await fakeServer({ files: { 'extract/f0.csv': MANY['extract/f0.csv'], 'extract/f1.csv': MANY['extract/f1.csv'] } });
  const c = clone();
  try {
    for (const [p, v] of Object.entries(MANY)) c.put(p, v);
    mirrored(c, Object.keys(MANY));
    const manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    const out = quiet();
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, ...out }), 1);
    assert.match(out.warns.join('\n'), /^ERROR: .*would remove 6 of the 8 mirrored files.*--allow-removals/m);
    for (const p of Object.keys(MANY)) assert.ok(c.exists(p), p);
    assert.deepEqual(s.state.downloads, []);
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, allowRemovals: true, ...quiet() }), 0);
    assert.deepEqual(fs.readdirSync(path.join(c.root, 'extract')).sort(), ['f0.csv', 'f1.csv']);
  } finally {
    await s.close();
    c.cleanup();
  }
  // 5 of 6 removed: more than half, but not more than 5 -> a normal run
  const s2 = await fakeServer({ files: { 'extract/f0.csv': MANY['extract/f0.csv'] } });
  const c2 = clone();
  try {
    for (const p of Object.keys(MANY).slice(0, 6)) c2.put(p, MANY[p]);
    mirrored(c2, Object.keys(MANY).slice(0, 6));
    const manifest = (await detectServer({ base: s2.base, token: TOKEN })).manifest;
    assert.equal(await mirrorFiles({ base: s2.base, token: TOKEN, manifest, root: c2.root, ...quiet() }), 0);
    assert.deepEqual(fs.readdirSync(path.join(c2.root, 'extract')), ['f0.csv']);
  } finally {
    await s2.close();
    c2.cleanup();
  }
});

test('mirrorFiles: an allowlisted folder (or a parent below the data root) that is a symlink in the clone is an ERROR, nothing mirrored', async () => {
  for (const linked of ['extract', 'files', 'files/documents']) {
    const s = await fakeServer({ files: SERVER_FILES });
    const c = clone();
    try {
      const outside = path.join(c.dir, 'outside');
      fs.mkdirSync(outside, { recursive: true });
      fs.mkdirSync(path.dirname(path.join(c.root, linked)), { recursive: true });
      fs.symlinkSync(outside, path.join(c.root, linked));
      c.put('profile/settings.json', 'mine');
      const manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
      const out = quiet();
      assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, ...out }), 1, linked);
      assert.match(out.warns.join('\n'), new RegExp(`^ERROR: .*${linked.replace('/', '\\/')}.* is a symlink`, 'm'), linked);
      assert.deepEqual(fs.readdirSync(outside), [], linked);
      assert.equal(c.read('profile/settings.json'), 'mine', linked);
      assert.deepEqual(s.state.downloads, [], linked);
    } finally {
      await s.close();
      c.cleanup();
    }
  }
});

test('mirrorFiles: a symlinked subfolder inside an allowlisted folder is never written through (that file fails, the rest mirrors)', async () => {
  const s = await fakeServer({ files: { ...SERVER_FILES, 'files/documents/sub/deep.pdf': 'deep' } });
  const c = clone();
  try {
    const outside = path.join(c.dir, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(path.join(c.root, 'files', 'documents'), { recursive: true });
    fs.symlinkSync(outside, path.join(c.root, 'files', 'documents', 'sub'));
    const manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    const out = quiet();
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, ...out }), 1);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.match(out.warns.join('\n'), /files\/documents\/sub\/deep\.pdf.*symlink/);
    assert.equal(c.read('extract/weight.csv'), SERVER_FILES['extract/weight.csv']);
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('mirrorFiles: prints each removed path, each downloaded path only with verbose, never any content; the summary line stays last', async () => {
  const s = await fakeServer({ files: SERVER_FILES });
  const c = clone();
  try {
    c.put('extract/old.csv', 'SECRET-OLD');
    mirrored(c, ['extract/old.csv']);
    const manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    const out = quiet();
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, ...out }), 0);
    assert.ok(out.logs.includes('Removed extract/old.csv'), out.logs.join('\n'));
    assert.ok(!out.logs.some((l) => l.startsWith('Downloaded ')), out.logs.join('\n'));
    assert.match(out.logs.at(-1), /^Mirror: /);
    c.put('extract/old2.csv', 'SECRET-OLD');
    mirrored(c, ['extract/old2.csv']);
    c.put('extract/weight.csv', 'stale');
    const verbose = quiet();
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, verbose: true, ...verbose }), 0);
    assert.deepEqual(verbose.logs.slice(0, -1), ['Downloaded extract/weight.csv', 'Removed extract/old2.csv']);
    assert.match(verbose.logs.at(-1), /^Mirror: .*1 downloaded, 5 unchanged, 1 removed$/);
    assert.ok(!/SECRET|date,value/.test([...out.logs, ...verbose.logs].join('\n')));
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('npm run sync passes --allow-empty, --allow-removals and --verbose to the mirror', async () => {
  const s = await fakeServer({ files: {} });
  const c = clone();
  const sp = recordSpawn();
  try {
    c.put('extract/weight.csv', 'mine');
    mirrored(c, ['extract/weight.csv']);
    assert.equal(await syncAll({ 'no-refresh': true }, { env: c.env(s.base), spawn: sp.spawn, sleep: noSleep, ...quiet() }), 1);
    assert.ok(c.exists('extract/weight.csv'));
    const out = quiet();
    assert.equal(await syncAll({ 'no-refresh': true, 'allow-empty': true, 'allow-removals': true, verbose: true }, { env: c.env(s.base), spawn: sp.spawn, sleep: noSleep, ...out }), 0);
    assert.ok(!c.exists('extract/weight.csv'));
    assert.ok(out.logs.includes('Removed extract/weight.csv'), out.logs.join('\n'));
  } finally {
    await s.close();
    c.cleanup();
  }
});

/* ---------- the mirror ledger (<data root>/.mirror-state.json) ---------- */

const EXTRACT6 = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`extract/s${i}.csv`, `date,v\n2026-10-0${i + 1},${i}\n`]));

test('mirror ledger: a clone-only PDF next to 6 mirrored extract files survives (one WARNING naming it, once); the ledger holds what was mirrored', async () => {
  const s = await fakeServer({ files: EXTRACT6 });
  const c = clone();
  try {
    for (const [p, v] of Object.entries(EXTRACT6)) c.put(p, v);
    c.put('files/documents/mine.pdf', '%PDF clone only');
    const manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    for (let run = 0; run < 2; run += 1) {
      const out = quiet();
      assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, ...out }), 0);
      assert.equal(c.read('files/documents/mine.pdf'), '%PDF clone only', `run ${run}`);
      const named = out.warns.filter((w) => w.includes('files/documents/mine.pdf'));
      assert.equal(named.length, run === 0 ? 1 : 0, out.warns.join('\n'));
      if (run === 0) assert.match(named[0], /^WARNING: files\/documents\/mine\.pdf is not on the server and was never mirrored from it: kept/);
      assert.match(out.logs.at(-1), /0 downloaded, 6 unchanged, 0 removed$/);
    }
    const ledger = JSON.parse(c.read('.mirror-state.json'));
    assert.deepEqual(Object.keys(ledger.files).sort(), Object.keys(EXTRACT6).sort());
    assert.equal(ledger.files['extract/s0.csv'], sha(Buffer.from(EXTRACT6['extract/s0.csv'])));
    assert.equal(fs.statSync(path.join(c.root, '.mirror-state.json')).mode & 0o777, 0o600);
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('mirror ledger: only a file this client mirrored is removed once the server drops it; under files/ it is MOVED to backups/<path>.mirror.bak (newest only)', async () => {
  const s = await fakeServer({ files: SERVER_FILES });
  const c = clone();
  const backups = path.join(c.dir, 'backups');
  try {
    let manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, backupsDir: backups, ...quiet() }), 0);
    c.put('extract/mine.csv', 'clone only');
    s.state.files.delete('extract/weight.csv');
    s.state.files.delete('files/manuals/edge.pdf');
    manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    const out = quiet();
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, backupsDir: backups, ...out }), 0);
    assert.ok(!c.exists('extract/weight.csv'));
    assert.ok(!c.exists('files/manuals/edge.pdf'));
    assert.equal(fs.readFileSync(path.join(backups, 'files', 'manuals', 'edge.pdf.mirror.bak'), 'utf8'), '%PDF manual');
    assert.ok(!fs.existsSync(path.join(backups, 'extract')), 'outside files/ a removal is an unlink');
    assert.equal(c.read('extract/mine.csv'), 'clone only');
    assert.ok(out.logs.includes('Removed extract/weight.csv'), out.logs.join('\n'));
    assert.ok(out.logs.includes(`Moved files/manuals/edge.pdf to ${path.join(backups, 'files', 'manuals', 'edge.pdf.mirror.bak')}`), out.logs.join('\n'));
    assert.match(out.logs.at(-1), /0 downloaded, 4 unchanged, 2 removed$/);
    assert.deepEqual(Object.keys(JSON.parse(c.read('.mirror-state.json')).files).sort(), Object.keys(SERVER_FILES).filter((p) => p !== 'extract/weight.csv' && p !== 'files/manuals/edge.pdf').sort());
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('mirror ledger: the first run (no ledger) removes nothing and seeds the ledger from the files matching the manifest by sha256', async () => {
  const s = await fakeServer({ files: SERVER_FILES });
  const c = clone();
  try {
    c.put('extract/weight.csv', SERVER_FILES['extract/weight.csv']);
    c.put('extract/old.csv', 'mirrored before the ledger existed');
    const manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    const out = quiet();
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, ...out }), 0);
    assert.ok(c.exists('extract/old.csv'));
    assert.match(out.logs.at(-1), /5 downloaded, 1 unchanged, 0 removed$/);
    assert.deepEqual(Object.keys(JSON.parse(c.read('.mirror-state.json')).files).sort(), Object.keys(SERVER_FILES).sort());
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('mirror ledger: a local file under files/ the client never mirrored is backed up before the server\'s copy replaces it', async () => {
  const s = await fakeServer({ files: SERVER_FILES });
  const c = clone();
  const backups = path.join(c.dir, 'backups');
  try {
    c.put('files/manuals/edge.pdf', '%PDF my own edition');
    const manifest = (await detectServer({ base: s.base, token: TOKEN })).manifest;
    assert.equal(await mirrorFiles({ base: s.base, token: TOKEN, manifest, root: c.root, backupsDir: backups, ...quiet() }), 0);
    assert.equal(c.read('files/manuals/edge.pdf'), '%PDF manual');
    assert.equal(fs.readFileSync(path.join(backups, 'files', 'manuals', 'edge.pdf.mirror.bak'), 'utf8'), '%PDF my own edition');
  } finally {
    await s.close();
    c.cleanup();
  }
});

test('npm run sync says why it fell back to the local syncs: the answer of <url>/export/files (a 404, a 5xx, no answer)', async () => {
  for (const [status, re] of [[404, /answered HTTP 404 \(no \/export\/files: a host-mode server\)/], [500, /answered HTTP 500/]]) {
    const s = await fakeServer({ status });
    const c = clone();
    const out = quiet();
    try {
      assert.equal(await syncAll({}, { env: c.env(s.base), spawn: recordSpawn().spawn, sleep: noSleep, ...out }), 0);
      const note = out.logs.find((l) => l.startsWith('Note: '));
      assert.ok(note, out.logs.join('\n'));
      assert.ok(note.startsWith(`Note: ${s.base}/export/files `), note);
      assert.match(note, re);
      assert.match(note, /; running the local syncs$/);
    } finally {
      await s.close();
      c.cleanup();
    }
  }
  const c = clone();
  const out = quiet();
  const gone = await fakeServer();
  await gone.close();
  try {
    assert.equal(await syncAll({}, { env: c.env(gone.base), spawn: recordSpawn().spawn, sleep: noSleep, ...out }), 0);
    assert.ok(out.logs.includes(`Note: ${gone.base}/export/files did not answer (ECONNREFUSED); running the local syncs`), out.logs.join('\n'));
  } finally {
    c.cleanup();
  }
});
