/* Tests for the profile sync (ingest service /export/athlete -> data/profile/strava-profile.json
 * + avatar.jpg). SYNTHETIC fixtures only (no real personal values), no network: the avatar
 * download goes through an injected fetch. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sp = require('./sync-profile.js');

const { normalizeExport, planAvatar, checkAvatar, downloadAvatar, syncProfile, errorMessage, MAX_AVATAR_BYTES, PROFILE_JSON, AVATAR_FILE } = sp;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

const BODY = {
  fetchedAt: '2030-01-06T08:00:00.000Z',
  firstname: 'Alex',
  lastname: 'Example',
  city: 'Sampletown',
  state: null,
  country: 'Nowhere',
  profile: 'https://img.example.test/large.jpg',
  profileMedium: 'https://img.example.test/medium.jpg',
  measurementPreference: 'meters',
  athleteType: 'cyclist',
  bikes: [{ id: 'b1', name: 'Road bike', brand: 'Brand', model: 'Model', frameType: 'road', weightKg: 8.2, distanceM: 1234567.8, retired: false, primary: true }],
  shoes: [],
  gearScopeMissing: false,
  devices: [{ name: 'Demo Watch', count: 3, lastUsed: '2030-01-05' }],
};

const tmpDir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sync-profile-${tag}-`));
const imgRes = (buf, type = 'image/jpeg') => ({
  ok: true,
  status: 200,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : k.toLowerCase() === 'content-length' ? String(buf.length) : null) },
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
});

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

test('planAvatar: download a new URL, keep an unchanged one, remove when Strava has no photo', () => {
  assert.equal(planAvatar({ next: BODY, prev: null, avatarExists: false }), 'download');
  assert.equal(planAvatar({ next: BODY, prev: BODY, avatarExists: true }), 'keep', 'same URL + file present');
  assert.equal(planAvatar({ next: BODY, prev: BODY, avatarExists: false }), 'download', 'file lost');
  assert.equal(planAvatar({ next: { ...BODY, profileMedium: 'https://img.example.test/new.jpg' }, prev: BODY, avatarExists: true }), 'download');
  assert.equal(planAvatar({ next: { ...BODY, profileMedium: null }, prev: BODY, avatarExists: true }), 'remove');
});

test('planAvatar keeps the previous avatar when the service has no snapshot yet', () => {
  assert.equal(planAvatar({ next: { ...BODY, fetchedAt: null, profileMedium: null }, prev: BODY, avatarExists: true }), 'keep');
});

test('checkAvatar accepts a small JPEG only', () => {
  assert.equal(checkAvatar(JPEG), null);
  assert.match(checkAvatar(PNG), /not a JPEG/);
  assert.match(checkAvatar(Buffer.alloc(0)), /empty/);
  const big = Buffer.concat([JPEG, Buffer.alloc(MAX_AVATAR_BYTES)]);
  assert.match(checkAvatar(big), /too large/);
});

test('downloadAvatar refuses a non-https URL without fetching', async () => {
  let called = 0;
  await assert.rejects(downloadAvatar('http://img.example.test/a.jpg', { fetchImpl: async () => { called++; } }), /https/);
  assert.equal(called, 0);
});

test('downloadAvatar refuses an announced oversize body before reading it', async () => {
  const res = imgRes(JPEG);
  res.headers = { get: (k) => (k === 'content-length' ? String(MAX_AVATAR_BYTES + 1) : 'image/jpeg') };
  res.arrayBuffer = async () => { throw new Error('must not read'); };
  await assert.rejects(downloadAvatar('https://img.example.test/a.jpg', { fetchImpl: async () => res }), /too large/);
});

// ---- disk ------------------------------------------------------------------------------

test('syncProfile writes the snapshot + avatar, then a rerun with the same data touches nothing', async () => {
  const dir = tmpDir('write');
  let downloads = 0;
  const fetchImpl = async () => { downloads++; return imgRes(JPEG); };
  const r1 = await syncProfile(dir, BODY, { fetchImpl });
  assert.equal(r1.profileWritten, true);
  assert.equal(r1.avatar, 'downloaded');
  assert.deepEqual(fs.readdirSync(dir).sort(), [AVATAR_FILE, PROFILE_JSON].sort(), 'no temp leftovers');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, PROFILE_JSON), 'utf8')).firstname, 'Alex');
  assert.ok(fs.readFileSync(path.join(dir, AVATAR_FILE)).equals(JPEG));

  const mtime = fs.statSync(path.join(dir, PROFILE_JSON)).mtimeMs;
  const r2 = await syncProfile(dir, BODY, { fetchImpl });
  assert.equal(r2.profileWritten, false);
  assert.equal(r2.avatar, 'kept');
  assert.equal(downloads, 1, 'unchanged URL: no second download');
  assert.equal(fs.statSync(path.join(dir, PROFILE_JSON)).mtimeMs, mtime);
  fs.rmSync(dir, { recursive: true });
});

test('syncProfile tolerates a failed avatar download: the snapshot is written, the old avatar kept', async () => {
  const dir = tmpDir('avatar-fail');
  fs.writeFileSync(path.join(dir, AVATAR_FILE), JPEG);
  const r = await syncProfile(dir, BODY, { fetchImpl: async () => imgRes(PNG, 'image/png') });
  assert.equal(r.profileWritten, true);
  assert.match(r.avatar, /^failed: .*not a JPEG/);
  assert.ok(fs.readFileSync(path.join(dir, AVATAR_FILE)).equals(JPEG), 'previous avatar untouched');
  fs.rmSync(dir, { recursive: true });
});

test('syncProfile removes the avatar when the athlete no longer has a photo', async () => {
  const dir = tmpDir('avatar-remove');
  fs.writeFileSync(path.join(dir, AVATAR_FILE), JPEG);
  const r = await syncProfile(dir, { ...BODY, profileMedium: null, profile: null }, { fetchImpl: async () => { throw new Error('no fetch'); } });
  assert.equal(r.avatar, 'removed');
  assert.equal(fs.existsSync(path.join(dir, AVATAR_FILE)), false);
  fs.rmSync(dir, { recursive: true });
});

test('errorMessage explains a 404 (stale ingest image) and surfaces a network cause', () => {
  assert.match(errorMessage({ status: 404, message: 'x' }, 'http://h'), /rebuild/);
  assert.match(errorMessage({ message: 'fetch failed', cause: { code: 'ECONNREFUSED' } }, 'http://h'), /ECONNREFUSED/);
});

// ---- main(): error paths keep previous files and exit non-zero --------------------------

const SCRIPT = path.join(__dirname, 'sync-profile.js');

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
