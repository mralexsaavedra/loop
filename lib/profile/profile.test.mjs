/* lib/profile/profile.mjs — the profile sheet's data: the pure merge of manual profile.json + the
 * Strava snapshot + the latest weigh-in + the avatar, and the manual profile's validation. The disk
 * readers (loadProfile, checkManualProfile, latestWeight) are tested in read.test.mjs. SYNTHETIC
 * values only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildProfile, validateManual, newestWeight, initialsOf, avatarDataUri, deviceType, isManualFile,
  SHOE_REPLACE_KM, MAX_AVATAR_BYTES, DEVICE_TYPES, EVENT_TYPES,
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

test('hiddenDevices: names hidden from the device list (case-insensitive), manual and Strava-derived alike', () => {
  const p = buildProfile({ manual: { ...MANUAL, hiddenDevices: ['demo phone app', ' DEMO EMS SUIT '] }, strava: STRAVA });
  assert.deepEqual(p.devices.map((d) => d.name), ['Demo Watch 2']);
  const all = buildProfile({ manual: { hiddenDevices: ['Demo Watch 2', 'Demo Phone App'] }, strava: STRAVA });
  assert.deepEqual(all.devices, []);
  assert.equal('hiddenDevices' in all, false, 'the hidden names are never baked');
});

test('device manual: a manual entry keeps its manual file, also when merged by name with a Strava-derived one', () => {
  const p = buildProfile({
    manual: { devices: [{ name: 'demo watch 2', type: 'watch', manual: 'demo-watch-manual.pdf' }, { name: 'Demo EMS suit', type: 'ems' }] },
    strava: STRAVA,
  });
  assert.equal(p.devices[0].manual, 'demo-watch-manual.pdf');
  assert.equal(p.devices[0].count, 40, 'Strava usage merged into it');
  assert.equal(p.devices[1].manual, null);
  assert.equal(p.devices[2].manual, null, 'a Strava-only device has no manual');
});

test('isManualFile: a bare .pdf file name only (no slashes, no dot-segments, no leading dot)', () => {
  for (const ok of ['garmin-edge-540-manual-es.pdf', 'A.pdf', 'v1.2_manual.pdf', `${'a'.repeat(121)}.pdf`]) assert.equal(isManualFile(ok), true, ok);
  for (const bad of ['', 'x.PDF', 'x.pdf.exe', '../x.pdf', 'a/b.pdf', 'a\\b.pdf', '.hidden.pdf', 'a..b.pdf', '-x.pdf', 'x y.pdf', '.pdf',
    `${'a'.repeat(122)}.pdf`, null, 42, 'x.pdf\n']) {
    assert.equal(isManualFile(bad), false, String(bad));
  }
});

test('validateManual: hiddenDevices is a list of names; a device manual is a bare PDF file name', () => {
  assert.deepEqual(validateManual({ hiddenDevices: ['Garmin Edge 1030'], devices: [{ name: 'X', manual: 'x-manual.pdf' }] }), []);
  assert.deepEqual(validateManual({ hiddenDevices: 'Garmin Edge 1030' }), ['hiddenDevices must be a list of device names']);
  assert.deepEqual(validateManual({ hiddenDevices: ['ok', ''] }), ['hiddenDevices[1] must be a device name']);
  const errs = validateManual({ devices: [{ name: 'A', manual: '../etc/passwd.pdf' }, { name: 'B', manual: 'b.txt' }, { name: 'C', manual: 3 }] });
  assert.equal(errs.length, 3, errs.join('\n'));
  assert.match(errs[0], /devices\[0\]\.manual must be a PDF file name in data\/gear/);
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

test('maxHr: optional, a number of bpm in 100-230 (the HR zones max HR)', () => {
  assert.deepEqual(validateManual({ maxHr: 188 }), []);
  assert.deepEqual(validateManual({ maxHr: 300 }), ['maxHr must be a number of bpm (100–230)']);
  assert.deepEqual(validateManual({ maxHr: '190' }), ['maxHr must be a number of bpm (100–230)']);
});

test('sex: optional "male" | "female" (the fitness-age reference curve), baked into the profile', () => {
  assert.deepEqual(validateManual({ sex: 'male' }), []);
  assert.deepEqual(validateManual({ sex: 'female' }), []);
  assert.deepEqual(validateManual({ sex: 'M' }), ['sex must be "male" or "female"']);
  assert.deepEqual(validateManual({ sex: 1 }), ['sex must be "male" or "female"']);
  assert.equal(buildProfile({ manual: { sex: 'female' } }).sex, 'female');
  assert.equal(buildProfile({ manual: { sex: 'other' } }).sex, null);
  assert.equal(buildProfile({}).sex, null);
  // a sex alone is not enough to show the profile sheet's content
  assert.equal(buildProfile({ manual: { sex: 'male' } }).hasData, false);
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

test('events: validated (name required, a real YYYY-MM-DD date, type one of the event types, location text)', () => {
  assert.deepEqual(EVENT_TYPES, ['hyrox', 'race', 'sportive', 'other']);
  assert.deepEqual(validateManual({ events: [{ name: 'Demo Hyrox', date: '2030-03-14', type: 'hyrox', location: 'Sampletown' }, { name: 'Demo 10K', date: '2030-05-01' }] }), []);
  const errs = validateManual({ events: [{ name: '', date: '2030-03-14' }, { name: 'X', date: '2030-02-31' }, { name: 'Y', date: '2030-03-14', type: 'triathlon' }, { name: 'Z', date: '2030-03-14', location: 7 }, 'w'] });
  assert.equal(errs.length, 5, errs.join('\n'));
  assert.match(errs.join('\n'), /events\[1\]\.date must be a real date "YYYY-MM-DD"/);
  assert.match(errs.join('\n'), /events\[2\]\.type must be one of hyrox, race, sportive, other/);
  assert.deepEqual(validateManual({ events: {} }), ['events must be a list']);
});

test('events pass through sorted by date (trimmed, type other / location null when absent); none -> empty list', () => {
  const p = buildProfile({ manual: { events: [
    { name: ' Demo Sportive ', date: '2030-06-01', type: 'sportive', location: ' Hilltown ' },
    { name: 'Demo Hyrox', date: '2030-03-14', type: 'hyrox' },
    { name: 'Demo Fun Run', date: '2029-11-02' },
  ] } });
  assert.deepEqual(p.events, [
    { name: 'Demo Fun Run', date: '2029-11-02', type: 'other', location: null },
    { name: 'Demo Hyrox', date: '2030-03-14', type: 'hyrox', location: null },
    { name: 'Demo Sportive', date: '2030-06-01', type: 'sportive', location: 'Hilltown' },
  ]);
  assert.equal(p.hasData, true);
  assert.deepEqual(buildProfile({}).events, []);
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
    'Garmin Edge 999': 'bike-computer',
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

test('newestWeight: the newest weigh-in (1 decimal) with its date; null without rows', () => {
  assert.deepEqual(newestWeight([{ date: '2030-01-01', value: 72.04 }, { date: '2030-01-03', value: 71.36 }]), { kg: 71.4, date: '2030-01-03' });
  assert.equal(newestWeight(null), null);
  assert.equal(newestWeight([]), null);
});
