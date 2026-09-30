/* lib/profile/profile.mjs — the profile sheet's data: manual profile.json + the Strava snapshot +
 * the latest weigh-in + the avatar. SYNTHETIC values only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildProfile, loadProfile, validateManual, latestWeight, initialsOf, avatarDataUri, checkManualProfile, deviceType,
  SHOE_REPLACE_KM, MAX_AVATAR_BYTES, DEVICE_TYPES,
} from './profile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(path.dirname(here));

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

const STRAVA = {
  fetchedAt: '2030-01-06T08:00:00.000Z',
  firstname: 'Alex',
  lastname: 'Example',
  city: 'Sampletown',
  state: 'Region',
  country: 'Nowhere',
  profileMedium: 'https://img.example.test/m.jpg',
  measurementPreference: 'meters',
  athleteType: 'cyclist',
  bikes: [
    { id: 'b1', name: 'Road bike', brand: 'Brand', model: 'Model', frameType: 'road', weightKg: 8.2, distanceM: 1234567.8, retired: false, primary: true },
    { id: 'b2', name: 'Old bike', brand: null, model: null, frameType: null, weightKg: null, distanceM: 5000, retired: true, primary: false },
  ],
  shoes: [
    { id: 'g1', name: 'Trainers', brand: 'Shoe Co', model: 'Daily', distanceM: 745000, retired: false, primary: true },
    { id: 'g2', name: 'Racers', brand: null, model: null, distanceM: 120049, retired: false, primary: false },
    { id: 'g3', name: 'Worn out', brand: null, model: null, distanceM: 910000, retired: true, primary: false },
  ],
  gearScopeMissing: false,
  devices: [{ name: 'Demo Watch 2', count: 40, lastUsed: '2030-01-05' }, { name: 'Demo Phone App', count: 3, lastUsed: '2029-12-01' }],
};

const MANUAL = {
  birthdate: '1990-05-17',
  heightCm: 178,
  devices: [
    { name: 'Demo Watch 2', type: 'watch', since: '2028-03' },
    { name: 'Demo EMS suit', type: 'ems' },
  ],
};

// ---- merge rules -----------------------------------------------------------------------

test('everything absent -> hasData false, no name, no initials, empty lists (generic avatar + onboarding hint)', () => {
  const p = buildProfile({});
  assert.equal(p.hasData, false);
  assert.equal(p.name, null);
  assert.equal(p.initials, null);
  assert.deepEqual(p.bikes, []);
  assert.deepEqual(p.shoes, []);
  assert.deepEqual(p.devices, []);
  assert.equal(p.photo, null);
});

test('Strava fills name / city / focus; manual fields win for the same field', () => {
  const p = buildProfile({ strava: STRAVA });
  assert.equal(p.name, 'Alex Example');
  assert.equal(p.initials, 'AE');
  assert.equal(p.location, 'Sampletown, Nowhere');
  assert.equal(p.focus, 'cyclist');
  assert.equal(p.stravaAsOf, '2030-01-06');
  const o = buildProfile({ strava: STRAVA, manual: { name: 'Sam Override', city: 'Othertown' } });
  assert.equal(o.name, 'Sam Override');
  assert.equal(o.initials, 'SO');
  assert.equal(o.location, 'Othertown');
});

test('body: height from the manual file, weight = the latest weigh-in with its date (never Strava)', () => {
  const p = buildProfile({ manual: MANUAL, strava: { ...STRAVA, weight: 99 }, weight: { kg: 71.4, date: '2030-01-04' } });
  assert.equal(p.heightCm, 178);
  assert.deepEqual(p.weight, { kg: 71.4, date: '2030-01-04' });
  assert.equal(p.birthdate, '1990-05-17', 'the age is computed client-side from this, never baked');
  assert.equal('age' in p, false);
});

test('gear: km with 1 decimal, detail line, retired flag, shoes past the replace threshold flagged', () => {
  const p = buildProfile({ strava: STRAVA });
  assert.deepEqual(p.bikes[0], { name: 'Road bike', detail: 'Brand Model', frame: 'road', weightKg: 8.2, km: 1234.6, retired: false, primary: true });
  assert.equal(p.bikes[1].retired, true);
  assert.equal(p.bikes[1].detail, null);
  assert.equal(p.shoes[0].km, 745);
  assert.equal(p.shoes[0].replace, true, `${SHOE_REPLACE_KM}+ km`);
  assert.equal(p.shoes[1].km, 120);
  assert.equal(p.shoes[1].replace, false);
  assert.equal(p.shoes[2].replace, false, 'a retired shoe needs no hint');
});

test('gear order: active first (primary first), retired last', () => {
  const p = buildProfile({ strava: { ...STRAVA, shoes: [STRAVA.shoes[2], STRAVA.shoes[1], STRAVA.shoes[0]] } });
  assert.deepEqual(p.shoes.map((s) => s.name), ['Trainers', 'Racers', 'Worn out']);
});

test('gearScopeMissing passes through (coarse flag)', () => {
  assert.equal(buildProfile({ strava: { ...STRAVA, bikes: [], shoes: [], gearScopeMissing: true } }).gearScopeMissing, true);
  assert.equal(buildProfile({}).gearScopeMissing, false);
});

test('devices: manual first, Strava-derived ones deduped by name (case-insensitive), usage merged', () => {
  const p = buildProfile({ manual: MANUAL, strava: STRAVA });
  assert.deepEqual(p.devices.map((d) => [d.name, d.source]), [
    ['Demo Watch 2', 'manual'], ['Demo EMS suit', 'manual'], ['Demo Phone App', 'strava'],
  ]);
  assert.equal(p.devices[0].count, 40, 'Strava usage merged into the manual entry');
  assert.equal(p.devices[0].lastUsed, '2030-01-05');
  assert.equal(p.devices[0].since, '2028-03');
  assert.equal(p.devices[2].type, 'other');
  const lower = buildProfile({ manual: { devices: [{ name: 'demo watch 2', type: 'watch' }] }, strava: STRAVA });
  assert.equal(lower.devices.filter((d) => /watch/i.test(d.name)).length, 1);
});

test('the photo becomes a data URI only for a small real JPEG', () => {
  assert.match(buildProfile({ avatar: JPEG }).photo, /^data:image\/jpeg;base64,/);
  assert.equal(avatarDataUri(Buffer.from('not an image')), null);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
  assert.match(avatarDataUri(png), /^data:image\/png;base64,/);
  assert.equal(avatarDataUri(Buffer.concat([JPEG, Buffer.alloc(MAX_AVATAR_BYTES)])), null);
  assert.equal(avatarDataUri(null), null);
});

test('initialsOf: first letters of the first two words, unicode-safe', () => {
  assert.equal(initialsOf('Álex Éxample Third'), 'ÁÉ');
  assert.equal(initialsOf('Mono'), 'M');
  assert.equal(initialsOf('  '), null);
  assert.equal(initialsOf(null), null);
});

// ---- validation ------------------------------------------------------------------------

test('validateManual accepts the tracked example and flags malformed fields', () => {
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'profile', 'profile.example.json'), 'utf8'));
  assert.deepEqual(validateManual(example), []);
  const errs = validateManual({ birthdate: '1990-02-31', heightCm: 'tall', devices: [{ name: '', type: 'toaster', since: '2020' }] });
  assert.equal(errs.length, 5, errs.join('\n'));
  assert.deepEqual(validateManual(null), ['profile.json must be a JSON object']);
  assert.deepEqual(DEVICE_TYPES, ['watch', 'bike-computer', 'ems', 'other']);
});

test('supplements: validated (name required, meal one of the six slots, dose optional text)', () => {
  assert.deepEqual(validateManual({ supplements: [{ name: 'Creatine', dose: '3 g', meal: 'lunch' }, { name: 'Magnesium', meal: 'dinner' }] }), []);
  const errs = validateManual({ supplements: [{ name: '', meal: 'lunch' }, { name: 'X', meal: 'brunch' }, { name: 'Y', dose: 3, meal: 'snack' }, 'z'] });
  assert.equal(errs.length, 4, errs.join('\n'));
  assert.match(errs.join('\n'), /supplements\[1\]\.meal must be one of breakfast, lunch, preworkout, postworkout, dinner, snack/);
  assert.deepEqual(validateManual({ supplements: {} }), ['supplements must be a list']);
});

test('supplements pass through to the profile (trimmed, dose null when absent); none -> empty list', () => {
  const p = buildProfile({ manual: { supplements: [{ name: ' Creatine ', dose: '3 g', meal: 'lunch' }, { name: 'Magnesium', meal: 'dinner' }] } });
  assert.deepEqual(p.supplements, [{ name: 'Creatine', dose: '3 g', meal: 'lunch' }, { name: 'Magnesium', dose: null, meal: 'dinner' }]);
  assert.equal(p.hasData, true);
  assert.deepEqual(buildProfile({}).supplements, []);
});

// ---- disk ------------------------------------------------------------------------------

test('latestWeight: the newest weigh-in (1 decimal) with its date; null without data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-weight-'));
  fs.writeFileSync(path.join(dir, 'weight.csv'), 'date,value,source\n2030-01-01,72.04,Demo Scale\n2030-01-03,71.36,Demo Scale\n2030-01-02,71.9,Demo Scale\n');
  assert.deepEqual(latestWeight(dir), { kg: 71.4, date: '2030-01-03' });
  assert.equal(latestWeight(null), null);
  fs.rmSync(dir, { recursive: true });
});

function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-repo-'));
  fs.mkdirSync(path.join(root, 'profile'));
  fs.mkdirSync(path.join(root, 'data', 'profile'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data', 'demo'), { recursive: true });
  return root;
}

test('loadProfile personal: reads profile.json + strava-profile.json + avatar.jpg; all absent -> empty profile', () => {
  const root = tmpRepo();
  assert.equal(loadProfile({ repoRoot: root, dataMode: 'personal', extractDir: null }).hasData, false);
  fs.writeFileSync(path.join(root, 'profile', 'profile.json'), JSON.stringify(MANUAL));
  fs.writeFileSync(path.join(root, 'data', 'profile', 'strava-profile.json'), JSON.stringify(STRAVA));
  fs.writeFileSync(path.join(root, 'data', 'profile', 'avatar.jpg'), JPEG);
  const p = loadProfile({ repoRoot: root, dataMode: 'personal', extractDir: null });
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
  assert.equal(loadProfile({ repoRoot: root, dataMode: 'personal', extractDir: null, warn }).hasData, false);
  assert.equal(warnings.length, 0, 'a broken machine-written snapshot is silently ignored');

  fs.writeFileSync(path.join(root, 'data', 'profile', 'strava-profile.json'), JSON.stringify(STRAVA));
  fs.writeFileSync(path.join(root, 'profile', 'profile.json'), JSON.stringify({ heightCm: -3, name: 'Manual Name' }));
  const p = loadProfile({ repoRoot: root, dataMode: 'personal', extractDir: null, warn });
  assert.equal(p.name, 'Alex Example', 'the whole manual file is ignored, Strava fills in');
  assert.equal(p.heightCm, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^WARNING: .*profile\.json.*heightCm.*ignored/s);
  assert.match(warnings[0], /npm run check/);

  fs.writeFileSync(path.join(root, 'profile', 'profile.json'), '{oops');
  assert.equal(loadProfile({ repoRoot: root, dataMode: 'personal', extractDir: null, warn }).name, 'Alex Example');
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

test('deviceType: tight brand + model rules; unknown -> other', () => {
  const cases = {
    'Apple Watch Series 9': 'watch',
    'Apple Watch Ultra 2': 'watch',
    'Garmin Forerunner 265': 'watch',
    'Garmin fenix 7': 'watch',
    'Garmin fēnix 8': 'watch',
    'Garmin Venu 3': 'watch',
    'Garmin Instinct 2': 'watch',
    'Garmin vivoactive 5': 'watch',
    'Garmin Epix Pro': 'watch',
    'Garmin Edge 540': 'bike-computer',
    'Wahoo ELEMNT BOLT': 'bike-computer',
    'Wahoo ELEMNT ROAM': 'bike-computer',
    'Hammerhead Karoo 2': 'bike-computer',
    'COROS DURA': 'bike-computer',
    'Polar H10': 'other',
    'Polar Verity Sense': 'other',
    'Strava iPhone App': 'other',
    'Zwift': 'other',
    'Bolt Scooter': 'other',
    'Garmin Connect': 'other',
    'Watchful Demo Device': 'other',
  };
  for (const [name, type] of Object.entries(cases)) assert.equal(deviceType(name), type, name);
});

test('loadProfile example: the tracked synthetic seeds, never the personal files, and no photo (initials)', () => {
  const p = loadProfile({ repoRoot: ROOT, dataMode: 'example', extractDir: path.join(ROOT, 'data', 'demo', 'extract') });
  assert.equal(p.hasData, true);
  assert.equal(p.photo, null);
  assert.ok(p.initials);
  assert.ok(p.bikes.length && p.shoes.length, 'the demo snapshot shows the Material section');
  assert.ok(p.weight && p.weight.date, 'latest demo weigh-in');
});
