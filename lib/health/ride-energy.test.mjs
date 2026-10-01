/* Unit tests for lib/health/ride-energy.mjs — the power-meter correction of the Watch's active
 * energy on days with a ride the Watch did not record. SYNTHETIC values only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { correctActiveEnergy, readActiveEnergy, KJ_TO_KCAL, parseStamp, RIDES_HEADER, HOURLY_HEADER } from './ride-energy.mjs';

// hourly watch buckets on one local day: { 'HH': kcal } -> [{start, kcal}]
const hours = (date, byHour, off = '+02:00') =>
  Object.entries(byHour).map(([h, kcal]) => ({ start: `${date}T${h}:00:00${off}`, kcal }));
// the owner's case: a 5 h 47 min ride from 09:02 measured by a power meter, Watch on the wrist
const DAY = '2026-09-26';
const RIDE = { start: `${DAY}T09:02:00+02:00`, elapsedS: 20811, kj: 2310.7, deviceWatts: true, source: 'Strava API' };
// 09..14 h sum to 1821 kcal (the Watch's under-count during the ride hours)
const HOURLY = hours(DAY, { '08': 40, '09': 300, 10: 330, 11: 330, 12: 330, 13: 330, 14: 201, 15: 60 });

test('KJ_TO_KCAL is 1.0 (1 kJ mechanical ≈ 1 kcal metabolic at ~24 % gross efficiency)', () => {
  assert.equal(KJ_TO_KCAL, 1.0);
});

test('parseStamp reads an ISO stamp with offset into local date + instant', () => {
  const s = parseStamp('2026-09-26T09:02:00+02:00');
  assert.equal(s.date, '2026-09-26');
  assert.equal(s.ms, Date.parse('2026-09-26T07:02:00Z'));
  assert.equal(s.off, 120);
  assert.equal(parseStamp('2026-09-26T09:02:00Z').off, 0);
  assert.equal(parseStamp('2026-09-26 09:02'), null, 'no offset -> unusable');
  assert.equal(parseStamp(''), null);
});

test('the owner\'s case: Watch day 2207, ride 2310.7 kJ -> the ride hours are replaced by the power estimate', () => {
  const out = correctActiveEnergy([{ date: DAY, value: 2207 }], HOURLY, [RIDE]);
  assert.equal(out.length, 1);
  const r = out[0];
  // watch during the ride = buckets 09..14 prorated by overlap: 09 h keeps 58/60, 14 h keeps 48.85/60
  const during = 300 * 58 / 60 + 4 * 330 + 201 * (48 * 60 + 51) / 3600;
  assert.equal(r.watch, 2207);
  assert.equal(r.value, Math.round(2207 - during + 2310.7));
  assert.equal(r.rideKcal, 2311);
  assert.equal(r.watchDuring, Math.round(during));
  // the rough full-hour figure (2207 - 1821 + 2311 = 2697) is within ~2 % of the prorated one
  assert.ok(Math.abs(r.value - 2697) < 60);
});

test('a full-hour ride window subtracts exactly the hourly buckets', () => {
  const ride = { ...RIDE, start: `${DAY}T09:00:00+02:00`, elapsedS: 6 * 3600 };
  const [r] = correctActiveEnergy([{ date: DAY, value: 2207 }], HOURLY, [ride]);
  assert.equal(r.value, 2697); // 2207 - 1821 + 2310.7 = 2696.7
});

test('a Watch-recorded ride (watch during >= kJ) leaves the day unchanged', () => {
  const big = hours(DAY, { '09': 500, 10: 500, 11: 500, 12: 500, 13: 500, 14: 500 });
  const out = correctActiveEnergy([{ date: DAY, value: 3400 }], big, [RIDE]);
  assert.deepEqual(out, [{ date: DAY, value: 3400 }]);
});

test('no hourly data -> unchanged', () => {
  assert.deepEqual(correctActiveEnergy([{ date: DAY, value: 2207 }], [], [RIDE]), [{ date: DAY, value: 2207 }]);
  assert.deepEqual(correctActiveEnergy([{ date: DAY, value: 2207 }], null, [RIDE]), [{ date: DAY, value: 2207 }]);
});

test('an hour missing inside the ride window -> unchanged (hourly data must cover the ride)', () => {
  const gap = HOURLY.filter((h) => !h.start.includes('T12:'));
  assert.deepEqual(correctActiveEnergy([{ date: DAY, value: 2207 }], gap, [RIDE]), [{ date: DAY, value: 2207 }]);
});

test('a ride without real power (device_watts false / unknown) or without kJ -> unchanged', () => {
  for (const ride of [{ ...RIDE, deviceWatts: false }, { ...RIDE, deviceWatts: null }, { ...RIDE, kj: null }, { ...RIDE, kj: 0 }]) {
    assert.deepEqual(correctActiveEnergy([{ date: DAY, value: 2207 }], HOURLY, [ride]), [{ date: DAY, value: 2207 }]);
  }
});

test('a ride without a usable start (no offset) or elapsed time -> unchanged', () => {
  for (const ride of [{ ...RIDE, start: '' }, { ...RIDE, start: `${DAY}T09:02:00` }, { ...RIDE, elapsedS: 0 }]) {
    assert.deepEqual(correctActiveEnergy([{ date: DAY, value: 2207 }], HOURLY, [ride]), [{ date: DAY, value: 2207 }]);
  }
});

test('days without a ride pass through untouched; no rides at all -> the input values', () => {
  const daily = [{ date: '2026-09-25', value: 900 }, { date: DAY, value: 2207 }, { date: '2026-09-27', value: 700 }];
  const out = correctActiveEnergy(daily, HOURLY, [RIDE]);
  assert.deepEqual(out[0], { date: '2026-09-25', value: 900 });
  assert.deepEqual(out[2], { date: '2026-09-27', value: 700 });
  assert.ok(out[1].value > 2207);
  assert.deepEqual(correctActiveEnergy(daily, HOURLY, []), daily);
  assert.equal(correctActiveEnergy(null, HOURLY, [RIDE]), null);
});

test('a ride crossing midnight splits the power energy by time on each local day', () => {
  // 22:00 -> 02:00 local, 4 h, 1000 kJ: 2 h (500 kcal) on each day
  const ride = { start: '2026-09-26T22:00:00+02:00', elapsedS: 4 * 3600, kj: 1000, deviceWatts: true };
  const hourly = [...hours('2026-09-26', { 22: 100, 23: 100 }), ...hours('2026-09-27', { '00': 100, '01': 100 })];
  const out = correctActiveEnergy([{ date: '2026-09-26', value: 800 }, { date: '2026-09-27', value: 400 }], hourly, [ride]);
  assert.equal(out[0].value, 800 - 200 + 500);
  assert.equal(out[0].rideKcal, 500);
  assert.equal(out[1].value, 400 - 200 + 500);
  assert.equal(out[1].watchDuring, 200);
});

test('DST: buckets and rides are compared as instants (a fall-back night keeps both 02:00 hours apart)', () => {
  // Europe: 2026-10-25 03:00 CEST -> 02:00 CET. A ride 01:30 CEST .. 03:30 CET = 3 h real time.
  const ride = { start: '2026-10-25T01:30:00+02:00', elapsedS: 3 * 3600, kj: 900, deviceWatts: true };
  const hourly = [
    { start: '2026-10-25T01:00:00+02:00', kcal: 60 },
    { start: '2026-10-25T02:00:00+02:00', kcal: 60 },
    { start: '2026-10-25T02:00:00+01:00', kcal: 60 },
    { start: '2026-10-25T03:00:00+01:00', kcal: 60 },
  ];
  const [r] = correctActiveEnergy([{ date: '2026-10-25', value: 500 }], hourly, [ride]);
  // overlap: 01h half (30), both 02h full (120), 03h half (30) = 180
  assert.equal(r.watchDuring, 180);
  assert.equal(r.value, 500 - 180 + 900);
});

test('a ride on a non-DST-change winter day uses its own +01:00 offset (host timezone independent)', () => {
  const ride = { start: '2026-12-05T10:00:00+01:00', elapsedS: 3600, kj: 700, deviceWatts: true };
  const hourly = [{ start: '2026-12-05T10:00:00+01:00', kcal: 250 }];
  const [r] = correctActiveEnergy([{ date: '2026-12-05', value: 1000 }], hourly, [ride]);
  assert.equal(r.value, 1000 - 250 + 700);
});

test('two overlapping power rides (a duplicate upload) count once: the larger kJ wins', () => {
  const dup = { ...RIDE, start: `${DAY}T09:05:00+02:00`, kj: 2000 };
  const one = correctActiveEnergy([{ date: DAY, value: 2207 }], HOURLY, [RIDE]);
  assert.deepEqual(correctActiveEnergy([{ date: DAY, value: 2207 }], HOURLY, [dup, RIDE]), one);
});

test('readActiveEnergy reads the three CSVs; missing hourly / rides files -> the watch values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ride-energy-'));
  try {
    assert.equal(readActiveEnergy(null), null);
    assert.equal(readActiveEnergy(dir), null);
    fs.writeFileSync(path.join(dir, 'active-energy-daily.csv'), `date,kcal\n${DAY},2207\n`);
    assert.deepEqual(readActiveEnergy(dir), [{ date: DAY, value: 2207, source: '' }]);
    fs.writeFileSync(path.join(dir, 'active-energy-hourly.csv'),
      [HOURLY_HEADER, ...HOURLY.map((h) => `${h.start.slice(0, 10)},${h.start},${h.kcal},Shortcut`), ''].join('\n'));
    fs.writeFileSync(path.join(dir, 'rides.csv'),
      [RIDES_HEADER, `${DAY},${RIDE.start},${RIDE.elapsedS},${RIDE.kj},true,Strava API`, ''].join('\n'));
    const [r] = readActiveEnergy(dir);
    assert.equal(r.watch, 2207);
    assert.equal(r.value, correctActiveEnergy([{ date: DAY, value: 2207 }], HOURLY, [RIDE])[0].value);
    // device_watts blank (an old ingest image) -> no correction
    fs.writeFileSync(path.join(dir, 'rides.csv'), [RIDES_HEADER, `${DAY},${RIDE.start},${RIDE.elapsedS},${RIDE.kj},,Strava API`, ''].join('\n'));
    assert.equal(readActiveEnergy(dir)[0].value, 2207);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
