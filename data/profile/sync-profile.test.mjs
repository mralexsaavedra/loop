/* Tests for the profile sync (ingest service /export/athlete -> data/profile/strava-profile.json
 * + avatar.jpg). SYNTHETIC fixtures only (no real personal values), no network: the avatar
 * download goes through an injected fetch, and main() talks to a throwaway local server. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, execFile } from 'node:child_process';
import * as sp from './sync-profile.mjs';
import { fileURLToPath } from 'node:url';
import { dataPaths } from '../../lib/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { normalizeExport, planAvatar, checkAvatar, downloadAvatar, isAllowedAvatarUrl, syncProfile, errorMessage, MAX_AVATAR_BYTES, PROFILE_JSON, AVATAR_FILE } = sp;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

// Strava serves profile photos from its CloudFront distribution; the athlete id here is synthetic (0)
const PHOTO = 'https://dgalywyr863hv.cloudfront.net/pictures/athletes/0/0/1/medium.jpg';
const PHOTO_NEW = 'https://dgalywyr863hv.cloudfront.net/pictures/athletes/0/0/2/medium.jpg';

const BODY = {
  fetchedAt: '2030-01-06T08:00:00.000Z',
  firstname: 'Alex',
  lastname: 'Example',
  city: 'Sampletown',
  state: null,
  country: 'Nowhere',
  profile: 'https://dgalywyr863hv.cloudfront.net/pictures/athletes/0/0/1/large.jpg',
  profileMedium: PHOTO,
  measurementPreference: 'meters',
  athleteType: 'cyclist',
  bikes: [{ id: 'b1', name: 'Road bike', brand: 'Brand', model: 'Model', frameType: 'road', weightKg: 8.2, distanceM: 1234567.8, retired: false, primary: true }],
  shoes: [],
  gearScopeMissing: false,
  devices: [{ name: 'Demo Watch', count: 3, lastUsed: '2030-01-05' }],
};

const tmpDir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sync-profile-${tag}-`));
const imgRes = (buf, type = 'image/jpeg') => new Response(buf, { status: 200, headers: { 'content-type': type } });
const readJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, PROFILE_JSON), 'utf8'));

// ---- shape -----------------------------------------------------------------------------

test('normalizeExport keeps the known fields and rejects a non-object body', () => {
  const out = normalizeExport({ ...BODY, extra: 'x' });
  assert.equal(out.firstname, 'Alex');
  assert.equal(out.extra, undefined, 'unknown keys are not persisted');
  assert.deepEqual(out.bikes, BODY.bikes);
  assert.throws(() => normalizeExport([]), /unexpected response shape/);
  assert.throws(() => normalizeExport(null), /unexpected response shape/);
});

test('normalizeExport coerces absent lists to [] and a missing flag to false', () => {
  const out = normalizeExport({ firstname: 'A' });
  assert.deepEqual(out.bikes, []);
  assert.deepEqual(out.shoes, []);
  assert.deepEqual(out.devices, []);
  assert.equal(out.gearScopeMissing, false);
});

// ---- avatar decision -------------------------------------------------------------------

test('planAvatar: download a new URL, keep the photo already saved from this URL, remove when Strava has no photo', () => {
  const saved = { ...BODY, avatarSourceUrl: PHOTO };
  assert.equal(planAvatar({ next: BODY, prev: null, avatarExists: false }), 'download');
  assert.equal(planAvatar({ next: BODY, prev: saved, avatarExists: true }), 'keep', 'same source URL + file present');
  assert.equal(planAvatar({ next: BODY, prev: saved, avatarExists: false }), 'download', 'file lost');
  assert.equal(planAvatar({ next: { ...BODY, profileMedium: PHOTO_NEW }, prev: saved, avatarExists: true }), 'download');
  assert.equal(planAvatar({ next: { ...BODY, profileMedium: null }, prev: saved, avatarExists: true }), 'remove');
});

test('planAvatar retries when the previous download failed (profileMedium recorded, avatarSourceUrl not)', () => {
  assert.equal(planAvatar({ next: BODY, prev: { ...BODY, avatarSourceUrl: null }, avatarExists: false }), 'download');
  assert.equal(planAvatar({ next: { ...BODY, profileMedium: PHOTO_NEW }, prev: { ...BODY, profileMedium: PHOTO_NEW, avatarSourceUrl: PHOTO }, avatarExists: true }), 'download',
    'the old photo is on disk but the new URL never downloaded');
});

test('planAvatar keeps the previous avatar when the service has no snapshot yet', () => {
  assert.equal(planAvatar({ next: { ...BODY, fetchedAt: null, profileMedium: null }, prev: BODY, avatarExists: true }), 'keep');
});

test('checkAvatar accepts a small JPEG or PNG only', () => {
  assert.equal(checkAvatar(JPEG), null);
  assert.equal(checkAvatar(PNG), null);
  assert.match(checkAvatar(Buffer.from('GIF89a-not-allowed')), /not a JPEG or PNG/);
  assert.match(checkAvatar(Buffer.alloc(0)), /empty/);
  const big = Buffer.concat([JPEG, Buffer.alloc(MAX_AVATAR_BYTES)]);
  assert.match(checkAvatar(big), /too large/);
});

// ---- avatar download hardening ---------------------------------------------------------

test('isAllowedAvatarUrl: only https on Strava photo hosts (narrow list), no credentials / odd ports', () => {
  for (const ok of [PHOTO, 'https://www.strava.com/a/medium.jpg', 'https://photos.strava.com/x.jpg']) assert.equal(isAllowedAvatarUrl(ok), true, ok);
  for (const bad of [
    'http://dgalywyr863hv.cloudfront.net/a.jpg',
    'https://evil.cloudfront.net/a.jpg',
    'https://dgalywyr863hv.cloudfront.net.evil.test/a.jpg',
    'https://strava.com.evil.test/a.jpg',
    'https://notstrava.com/a.jpg',
    'https://user:pw@dgalywyr863hv.cloudfront.net/a.jpg',
    'https://dgalywyr863hv.cloudfront.net:8443/a.jpg',
    'https://img.example.test/a.jpg',
    'not a url',
    null,
  ]) assert.equal(isAllowedAvatarUrl(bad), false, String(bad));
});

test('downloadAvatar refuses a non-https or non-Strava URL without fetching', async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return imgRes(JPEG); };
  await assert.rejects(downloadAvatar('http://dgalywyr863hv.cloudfront.net/a.jpg', { fetchImpl }), /not an allowed Strava photo URL/);
  await assert.rejects(downloadAvatar('https://evil.cloudfront.net/a.jpg', { fetchImpl }), /not an allowed Strava photo URL/);
  assert.equal(called, 0);
});

test('downloadAvatar refuses redirects (redirect: error)', async () => {
  let opts;
  const buf = await downloadAvatar(PHOTO, { fetchImpl: async (url, o) => { opts = o; return imgRes(JPEG); } });
  assert.ok(buf.equals(JPEG));
  assert.equal(opts.redirect, 'error');
  assert.ok(opts.signal, 'the timeout signal is passed');
});

test('downloadAvatar requires an image Content-Type and JPEG/PNG magic bytes', async () => {
  await assert.rejects(downloadAvatar(PHOTO, { fetchImpl: async () => imgRes(JPEG, 'text/html') }), /content-type/i);
  await assert.rejects(downloadAvatar(PHOTO, { fetchImpl: async () => imgRes(Buffer.from('<html>'), 'image/jpeg') }), /not a JPEG or PNG/);
  // Strava really serves some photos as PNG bytes labelled image/jpeg under a .jpg URL
  const png = await downloadAvatar(PHOTO, { fetchImpl: async () => imgRes(PNG, 'image/jpeg') });
  assert.ok(png.equals(PNG));
  const ok = await downloadAvatar(PHOTO, { fetchImpl: async () => imgRes(JPEG, 'Image/JPEG; charset=binary') });
  assert.ok(ok.equals(JPEG));
});

test('downloadAvatar refuses an announced oversize body before reading it', async () => {
  let pulled = 0;
  const body = new ReadableStream({ pull (c) { pulled++; c.enqueue(new Uint8Array(1024)); } });
  const res = new Response(body, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(MAX_AVATAR_BYTES + 1) } });
  await assert.rejects(downloadAvatar(PHOTO, { fetchImpl: async () => res }), /too large/);
  assert.ok(pulled <= 1, `body not read (pulled ${pulled})`);
});

test('downloadAvatar streams with a hard cap: an endless body is aborted just past 60 KB', async () => {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull (c) { pulled++; c.enqueue(Uint8Array.from([0xff, 0xd8, 0xff, ...new Array(4093).fill(1)])); },
    cancel () { cancelled = true; },
  });
  await assert.rejects(downloadAvatar(PHOTO, { fetchImpl: async () => new Response(body, { status: 200, headers: { 'content-type': 'image/jpeg' } }) }), /too large/);
  assert.ok(pulled <= Math.ceil(MAX_AVATAR_BYTES / 4096) + 2, `stopped early (pulled ${pulled} chunks)`);
  assert.equal(cancelled, true, 'the stream is cancelled, not drained');
});

// ---- disk ------------------------------------------------------------------------------

test('syncProfile writes the snapshot + avatar (with avatarSourceUrl), then a rerun with the same data touches nothing', async () => {
  const dir = tmpDir('write');
  let downloads = 0;
  const fetchImpl = async () => { downloads++; return imgRes(JPEG); };
  const r1 = await syncProfile(dir, BODY, { fetchImpl });
  assert.equal(r1.profileWritten, true);
  assert.equal(r1.avatar, 'downloaded');
  assert.deepEqual(fs.readdirSync(dir).sort(), [AVATAR_FILE, PROFILE_JSON].sort(), 'no temp leftovers');
  assert.equal(readJson(dir).firstname, 'Alex');
  assert.equal(readJson(dir).avatarSourceUrl, PHOTO);
  assert.ok(fs.readFileSync(path.join(dir, AVATAR_FILE)).equals(JPEG));

  const mtime = fs.statSync(path.join(dir, PROFILE_JSON)).mtimeMs;
  const r2 = await syncProfile(dir, BODY, { fetchImpl });
  assert.equal(r2.profileWritten, false);
  assert.equal(r2.avatar, 'kept');
  assert.equal(downloads, 1, 'unchanged URL: no second download');
  assert.equal(fs.statSync(path.join(dir, PROFILE_JSON)).mtimeMs, mtime);
  fs.rmSync(dir, { recursive: true });
});

test('syncProfile tolerates a failed avatar download: the snapshot is written, the old avatar and its source kept, and the next run retries', async () => {
  const dir = tmpDir('avatar-fail');
  await syncProfile(dir, BODY, { fetchImpl: async () => imgRes(JPEG) });
  const next = { ...BODY, profileMedium: PHOTO_NEW };
  const r = await syncProfile(dir, next, { fetchImpl: async () => imgRes(Buffer.from('<html>not an image</html>'), 'image/jpeg') });
  assert.equal(r.profileWritten, true);
  assert.match(r.avatar, /^failed: /);
  assert.ok(fs.readFileSync(path.join(dir, AVATAR_FILE)).equals(JPEG), 'previous avatar untouched');
  assert.equal(readJson(dir).profileMedium, PHOTO_NEW);
  assert.equal(readJson(dir).avatarSourceUrl, PHOTO, 'the JSON still names the photo that is actually on disk');

  let downloads = 0;
  const retry = await syncProfile(dir, next, { fetchImpl: async () => { downloads++; return imgRes(JPEG); } });
  assert.equal(downloads, 1, 'retried on the next run');
  assert.equal(retry.avatar, 'downloaded');
  assert.equal(readJson(dir).avatarSourceUrl, PHOTO_NEW);
  fs.rmSync(dir, { recursive: true });
});

test('syncProfile: a first download that fails leaves avatarSourceUrl null and no photo', async () => {
  const dir = tmpDir('avatar-first-fail');
  const r = await syncProfile(dir, BODY, { fetchImpl: async () => { throw new Error('offline'); } });
  assert.match(r.avatar, /^failed: offline/);
  assert.equal(readJson(dir).avatarSourceUrl, null);
  assert.equal(fs.existsSync(path.join(dir, AVATAR_FILE)), false);
  fs.rmSync(dir, { recursive: true });
});

test('syncProfile writes the photo BEFORE the JSON that names it', async () => {
  const dir = tmpDir('order');
  const order = [];
  const writeAtomic = (file, data) => { order.push(path.basename(file)); fs.writeFileSync(file, data); };
  await syncProfile(dir, BODY, { fetchImpl: async () => imgRes(JPEG), writeAtomic });
  assert.deepEqual(order, [AVATAR_FILE, PROFILE_JSON]);
  fs.rmSync(dir, { recursive: true });
});

test('syncProfile removes the avatar when the athlete no longer has a photo', async () => {
  const dir = tmpDir('avatar-remove');
  fs.writeFileSync(path.join(dir, AVATAR_FILE), JPEG);
  const r = await syncProfile(dir, { ...BODY, profileMedium: null, profile: null }, { fetchImpl: async () => { throw new Error('no fetch'); } });
  assert.equal(r.avatar, 'removed');
  assert.equal(fs.existsSync(path.join(dir, AVATAR_FILE)), false);
  assert.equal(readJson(dir).avatarSourceUrl, null);
  fs.rmSync(dir, { recursive: true });
});

test('errorMessage explains a 404 (stale ingest image) and surfaces a network cause', () => {
  assert.match(errorMessage({ status: 404, message: 'x' }, 'http://h'), /rebuild/);
  assert.match(errorMessage({ message: 'fetch failed', cause: { code: 'ECONNREFUSED' } }, 'http://h'), /ECONNREFUSED/);
});

// ---- main(): error paths keep previous files and exit non-zero --------------------------

const SCRIPT = path.join(__dirname, 'sync-profile.mjs');

function runMain(env, seed) {
  const dir = tmpDir('main');
  const outDir = path.join(dir, 'profile');
  if (seed) { fs.mkdirSync(outDir); fs.writeFileSync(path.join(outDir, PROFILE_JSON), seed); }
  try {
    execFileSync(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH, SYNC_PROFILE_OUT_DIR: outDir, INGEST_ENV_FILE: path.join(dir, 'no.env'), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, outDir, dir };
  } catch (err) {
    return { status: err.status, stderr: err.stderr.toString(), outDir, dir };
  }
}

test('main(): missing token -> exit 1, nothing written', () => {
  const r = runMain({});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no ingest token/);
  assert.equal(fs.existsSync(r.outDir), false);
  fs.rmSync(r.dir, { recursive: true });
});

test('main(): unreachable service -> exit 1, the previous snapshot is kept byte for byte', () => {
  const seed = '{"firstname":"Prev"}\n';
  const r = runMain({ INGEST_TOKEN: 'a'.repeat(64), INGEST_URL: 'http://127.0.0.1:48232' }, seed);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No files touched/);
  assert.equal(fs.readFileSync(path.join(r.outDir, PROFILE_JSON), 'utf8'), seed);
  fs.rmSync(r.dir, { recursive: true });
});

test('main(): an unexpected failure while writing -> one tidy ERROR line, exit 1, no stack trace', async () => {
  const server = http.createServer((req, res) => {
    const body = JSON.stringify({ ...BODY, profileMedium: null, profile: null });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = tmpDir('main-crash');
  const blocker = path.join(dir, 'not-a-dir');
  fs.writeFileSync(blocker, 'x');
  try {
    const { code, stderr } = await new Promise((resolve) => {
      execFile(process.execPath, [SCRIPT], {
        env: { PATH: process.env.PATH, SYNC_PROFILE_OUT_DIR: path.join(blocker, 'profile'), INGEST_ENV_FILE: path.join(dir, 'no.env'), INGEST_TOKEN: 'a'.repeat(64), INGEST_URL: `http://127.0.0.1:${server.address().port}` },
      }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stderr }));
    });
    assert.equal(code, 1);
    assert.match(stderr, /^ERROR: profile sync failed \(/m);
    assert.doesNotMatch(stderr, /\n\s+at /, 'no stack trace');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true });
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

test('main() in-process: missing token / unreachable / failed write -> returns 1', async () => {
  const h = mainHarness('sync-profile-main-');
  try {
    assert.equal(await sp.main({ env: h.env, ...h.io, fetchImpl: h.refused, outDir: path.join(h.dir, 'p') }), 1);
    assert.match(h.err.pop(), /no ingest token/);
    const env = { ...h.env, INGEST_TOKEN: 't' };
    assert.equal(await sp.main({ env, ...h.io, fetchImpl: h.refused, outDir: path.join(h.dir, 'p') }), 1);
    assert.ok(!fs.existsSync(path.join(h.dir, 'p')));
    assert.equal(await sp.main({ env, ...h.io, fetchImpl: h.answer(200, {}), outDir: h.unwritable }), 1);
    assert.match(h.err.pop(), /^ERROR: profile sync failed/);
  } finally { h.cleanup(); }
});

// ---- the default output: lib/paths.mjs (HC_DATA_DIR), SYNC_PROFILE_OUT_DIR still wins -------------------------

test('main() in-process: HC_DATA_DIR redirects the snapshot + avatar to <data root>/profile; SYNC_PROFILE_OUT_DIR wins over it', async () => {
  const root = tmpDir('data-root');
  const fetchImpl = async (url) => (String(url).endsWith('/export/athlete')
    ? { ok: true, status: 200, json: async () => BODY }
    : imgRes(JPEG));
  const io = { log: () => {}, error: () => {} };
  const env = (extra) => ({ INGEST_URL: 'http://127.0.0.1:9', INGEST_TOKEN: 't', INGEST_ENV_FILE: path.join(root, 'no.env'), ...extra });
  try {
    assert.equal(await sp.main({ env: env({ HC_DATA_DIR: root }), ...io, fetchImpl }), 0);
    const paths = dataPaths({ repoRoot: '/repo', env: { HC_DATA_DIR: root } });
    assert.equal(JSON.parse(fs.readFileSync(paths.stravaProfile, 'utf8')).firstname, 'Alex', 'where the build reads it');
    assert.ok(fs.existsSync(paths.avatar));
    const own = tmpDir('override');
    assert.equal(await sp.main({ env: env({ HC_DATA_DIR: path.join(root, 'other'), SYNC_PROFILE_OUT_DIR: own }), ...io, fetchImpl }), 0);
    assert.equal(readJson(own).firstname, 'Alex');
    assert.equal(fs.existsSync(path.join(root, 'other')), false);
    fs.rmSync(own, { recursive: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
