/* lib/profile/read.mjs — the profile's build-time I/O: profile.json, the Strava snapshot, the avatar
 * and the caller's weigh-in, read from a temp repo or the tracked synthetic seeds. SYNTHETIC values only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfile, checkManualProfile, readManualProfile } from './read.mjs';
import { newestWeight } from './profile.mjs';
import { readExtract } from '../extract/read.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(path.dirname(here));

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const STRAVA = { fetchedAt: '2030-01-06T08:00:00.000Z', firstname: 'Alex', lastname: 'Example', city: 'Sampletown', country: 'Nowhere' };
const MANUAL = { birthdate: '1990-05-17', heightCm: 178, devices: [{ name: 'Demo Watch 2', type: 'watch', since: '2028-03' }] };

function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-repo-'));
  fs.mkdirSync(path.join(root, 'profile'));
  fs.mkdirSync(path.join(root, 'data', 'profile'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data', 'demo'), { recursive: true });
  return root;
}

test('loadProfile personal: reads profile.json + strava-profile.json + avatar.jpg; all absent -> empty profile', () => {
  const root = tmpRepo();
  assert.equal(loadProfile({ repoRoot: root, dataMode: 'personal' }).hasData, false);
  fs.writeFileSync(path.join(root, 'profile', 'profile.json'), JSON.stringify(MANUAL));
  fs.writeFileSync(path.join(root, 'data', 'profile', 'strava-profile.json'), JSON.stringify(STRAVA));
  fs.writeFileSync(path.join(root, 'data', 'profile', 'avatar.jpg'), JPEG);
  const p = loadProfile({ repoRoot: root, dataMode: 'personal' });
  assert.equal(p.name, 'Alex Example');
  assert.equal(p.heightCm, 178);
  assert.match(p.photo, /^data:image\/jpeg/);
  fs.rmSync(root, { recursive: true });
});

test('loadProfile personal: a malformed profile.json warns and is ignored (Strava + derived data still used); a malformed Strava snapshot is ignored', () => {
  const root = tmpRepo();
  const warnings = [];
  const warn = (m) => warnings.push(m);
  fs.writeFileSync(path.join(root, 'data', 'profile', 'strava-profile.json'), '{not json');
  assert.equal(loadProfile({ repoRoot: root, dataMode: 'personal', warn }).hasData, false);
  assert.equal(warnings.length, 0, 'a broken machine-written snapshot is silently ignored');

  fs.writeFileSync(path.join(root, 'data', 'profile', 'strava-profile.json'), JSON.stringify(STRAVA));
  fs.writeFileSync(path.join(root, 'profile', 'profile.json'), JSON.stringify({ heightCm: -3, name: 'Manual Name' }));
  const p = loadProfile({ repoRoot: root, dataMode: 'personal', warn });
  assert.equal(p.name, 'Alex Example', 'the whole manual file is ignored, Strava fills in');
  assert.equal(p.heightCm, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^WARNING: .*profile\.json.*heightCm.*ignored/s);
  assert.match(warnings[0], /npm run check/);

  fs.writeFileSync(path.join(root, 'profile', 'profile.json'), '{oops');
  assert.equal(loadProfile({ repoRoot: root, dataMode: 'personal', warn }).name, 'Alex Example');
  assert.match(warnings[1], /not valid JSON/);
  fs.rmSync(root, { recursive: true });
});

test('checkManualProfile: strict — ok / skipped when absent / the reason when malformed', () => {
  const root = tmpRepo();
  assert.deepEqual(checkManualProfile({ repoRoot: root, mode: 'personal' }), { ok: true, skipped: true, error: null });
  fs.writeFileSync(path.join(root, 'profile', 'profile.json'), JSON.stringify(MANUAL));
  assert.deepEqual(checkManualProfile({ repoRoot: root, mode: 'personal' }), { ok: true, skipped: false, error: null });
  fs.writeFileSync(path.join(root, 'profile', 'profile.json'), JSON.stringify({ birthdate: '1990-02-31' }));
  const bad = checkManualProfile({ repoRoot: root, mode: 'personal' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /profile\.json is invalid.*birthdate/s);
  fs.writeFileSync(path.join(root, 'profile', 'profile.json'), '{oops');
  assert.match(checkManualProfile({ repoRoot: root, mode: 'personal' }).error, /not valid JSON/);
  assert.equal(checkManualProfile({ repoRoot: ROOT, mode: 'example' }).ok, true, 'the tracked example validates');
  fs.rmSync(root, { recursive: true });
});

test('readManualProfile: {data, error, exists} for an absent, valid, invalid and unparsable file', () => {
  const root = tmpRepo();
  const file = path.join(root, 'profile', 'profile.json');
  assert.deepEqual(readManualProfile(file), { data: null, error: null, exists: false });
  fs.writeFileSync(file, JSON.stringify(MANUAL));
  assert.deepEqual(readManualProfile(file), { data: MANUAL, error: null, exists: true });
  fs.writeFileSync(file, JSON.stringify({ heightCm: 'tall' }));
  assert.match(readManualProfile(file).error, /profile\.json is invalid.*heightCm/s);
  fs.writeFileSync(file, '{oops');
  assert.match(readManualProfile(file).error, /not valid JSON/);
  fs.rmSync(root, { recursive: true });
});

test('loadProfile example: the tracked synthetic seeds, never the personal files, and no photo (initials)', () => {
  // the weigh-in as computeBakes passes it: newestWeight over the demo extract's readExtract series.weight
  const weight = newestWeight(readExtract(path.join(ROOT, 'data', 'demo', 'extract')).series.weight);
  const p = loadProfile({ repoRoot: ROOT, dataMode: 'example', weight });
  assert.equal(p.hasData, true);
  assert.equal(p.photo, null);
  assert.ok(p.initials);
  assert.ok(p.bikes.length && p.shoes.length, 'the demo snapshot shows the Material section');
  assert.ok(p.weight && p.weight.date, 'latest demo weigh-in');
  assert.ok(!p.devices.some((d) => d.name === 'Demo Phone App'), 'hiddenDevices hides a Strava-derived device');
  assert.equal(p.devices.find((d) => d.name === 'Sample Bike Computer').manual, 'sample-bike-computer-manual.pdf', 'only the file name is baked');
});

test('loadProfile: the weigh-in is the caller\'s; null or omitted = no weigh-in (the extract is never read here)', () => {
  const given = { kg: 70.1, date: '2030-02-01' };
  const opts = { repoRoot: ROOT, dataMode: 'example', warn: () => {} };
  assert.deepEqual(loadProfile({ ...opts, weight: given }).weight, given);
  assert.equal(loadProfile({ ...opts, weight: null }).weight ?? null, null);
  assert.equal(loadProfile(opts).weight ?? null, null, 'omitted: no weigh-in, no fallback read');
});
