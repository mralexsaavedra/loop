/* Day strain (lib/score/strain.mjs): load per day, K calibration, the 0-21 mapping. SYNTHETIC values only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STRAIN_MAX, TARGET_P95, MIN_CALIB_DAYS, FULL_DAY_MIN, parseHist, hourlyLoad, activityLoad, strainOf,
  dayLoads, calibrate, strainFromInputs,
} from './strain.mjs';
import { addDays } from '../date.mjs';

const MAX = 200;
const hour = (date, hist, cov = 60) => ({ date, cov, hist: typeof hist === 'string' ? parseHist(hist) : hist });
const zone = (date, z, type = 'Running', maxHr = MAX) => ({ date, type, maxHr, maxSrc: 'observed', z });

test('parseHist: "bpm:s" pairs -> Map; junk pairs are skipped', () => {
  assert.deepEqual([...parseHist('60:300 120:60 x:5 90:-1 100:')], [[60, 300], [120, 60]]);
  assert.equal(parseHist('').size, 0);
});

test('hourlyLoad: Edwards weights by zone (% of max HR) x covered minutes; under 50 % weighs 0', () => {
  // max 200: 99 bpm = Z0 (0), 100 = Z1 (1), 130 = Z2 (2), 150 = Z3, 170 = Z4, 190 = Z5
  assert.equal(hourlyLoad(parseHist('99:600 100:600 130:60 150:60 170:60 190:60'), MAX), 10 + 2 + 3 + 4 + 5);
  assert.equal(hourlyLoad(new Map(), MAX), 0);
});

test('activityLoad: zone seconds of the Strava histogram -> minutes x zone weight', () => {
  assert.equal(activityLoad([600, 60, 120, 180, 240, 300]), 1 + 4 + 9 + 16 + 25);
});

test('strainOf: 21 x (1 - e^(-load/K)); 0 load = 0, never above 21', () => {
  assert.equal(strainOf(0, 50), 0);
  assert.ok(Math.abs(strainOf(50 * Math.log(7), 50) - TARGET_P95) < 1e-9);
  assert.ok(strainOf(1e6, 50) <= STRAIN_MAX);
});

test('dayLoads: activity load from the zones + all-day load from the hours; days without hourly data are left out', () => {
  const r = dayLoads({
    hourly: [hour('2030-01-01', '100:600', 60), hour('2030-01-01', '130:300', 50), hour('2030-01-02', '', 30)],
    zones: [zone('2030-01-01', [0, 0, 0, 600, 0, 0], 'Running'), zone('2030-01-01', [0, 600, 0, 0, 0, 0], 'Cycling'), zone('2029-12-31', [0, 0, 0, 0, 0, 600])],
  });
  assert.equal(r.maxHr, MAX);
  assert.deepEqual(r.days.map((d) => d.date), ['2030-01-01', '2030-01-02']);
  const d = r.days[0];
  assert.equal(d.all, 10 + 10);
  assert.equal(d.cov, 110);
  assert.deepEqual(d.acts.map((a) => [a.t, a.m, a.load]), [['Running', 'run', 30], ['Cycling', 'bike', 10]]);
  assert.equal(d.load, 60);
  assert.equal(r.days[1].load, 0);
});

test('dayLoads: no max HR (no workout-zones rows) -> maxHr null', () => {
  assert.equal(dayLoads({ hourly: [hour('2030-01-01', '100:60')], zones: null }).maxHr, null);
});

// n full days with loads 1..n ending the day before asOf, plus asOf itself (partial)
function series(n, asOf = '2030-06-30') {
  const days = [];
  for (let i = n; i >= 1; i--) days.push({ date: addDays(asOf, -i), load: n - i + 1, cov: FULL_DAY_MIN, all: 0, acts: [] });
  days.push({ date: asOf, load: 5, cov: 120, all: 5, acts: [] });
  return days;
}

test('calibrate: K so the 95th-percentile full day of the 90 before asOf maps to 18; partial days and asOf never count', () => {
  const days = series(20);
  days.splice(3, 0, { date: '2030-06-01', load: 1000, cov: FULL_DAY_MIN - 1, all: 0, acts: [] }); // not a full day
  const c = calibrate(days, '2030-06-30');
  assert.equal(c.n, 20);
  // p95 of 1..20 (linear interpolation) = 19.05
  assert.ok(Math.abs(c.p95 - 19.05) < 1e-9);
  assert.ok(Math.abs(c.K - 19.05 / Math.log(7)) < 1e-9);
  assert.ok(Math.abs(strainOf(c.p95, c.K) - 18) < 1e-9);
});

test('calibrate: fewer than 14 full days (or an all-zero window) -> no K', () => {
  const c = calibrate(series(MIN_CALIB_DAYS - 1), '2030-06-30');
  assert.equal(c.K, null);
  assert.equal(c.n, MIN_CALIB_DAYS - 1);
  const zero = series(20).map((d) => ({ ...d, load: 0 }));
  assert.equal(calibrate(zero, '2030-06-30').K, null);
});

test('strainFromInputs: ok -> K, the recent days with strain and each contributor\'s share of it', () => {
  const asOf = '2030-06-30';
  const hourly = [], zones = [];
  for (let i = 30; i >= 0; i--) {
    const date = addDays(asOf, -i);
    for (let h = 0; h < 12; h++) hourly.push(hour(date, `100:${(i % 5) * 60 + 60}`, 60)); // 12 h covered
    if (i % 3 === 0) zones.push(zone(date, [0, 0, 0, 1200, 0, 0]));
  }
  const r = strainFromInputs({ hourly, zones });
  assert.equal(r.ok, true);
  assert.equal(r.asOf, asOf);
  assert.ok(r.K > 0 && r.n >= MIN_CALIB_DAYS);
  assert.equal(r.days.length, 14);
  const today = r.days[r.days.length - 1];
  assert.equal(today.date, asOf);
  assert.ok(today.s > 0 && today.s < 21);
  const parts = today.acts.reduce((a, x) => a + x.s, 0) + today.alls;
  assert.ok(Math.abs(parts - today.s) < 0.15, 'the contributions add up to the day');
  assert.equal(today.acts[0].m, 'run');
});

test('strainFromInputs: the fallback reasons — no hourly data, no max HR, too few full days', () => {
  assert.equal(strainFromInputs({ hourly: null, zones: [zone('2030-01-01', [0, 60, 0, 0, 0, 0])] }), null);
  assert.deepEqual(strainFromInputs({ hourly: [hour('2030-01-01', '100:60')], zones: null }), { ok: false, reason: 'noMaxHr', asOf: '2030-01-01', n: 0 });
  const r = strainFromInputs({ hourly: [hour('2030-01-01', '100:60', 700)], zones: [zone('2030-01-01', [0, 60, 0, 0, 0, 0])] });
  assert.deepEqual([r.ok, r.reason, r.n], [false, 'fewDays', 0]);
});
