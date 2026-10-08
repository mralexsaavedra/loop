/* Stress estimate (lib/score/stress.mjs): heart rate vs resting HR per waking hour outside workouts
 * and sleep. SYNTHETIC values only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  STRESS_MAX, MIN_HOURS, stressOf, bandOf, hourHr, sleepWindows, scoreHours, stressFromInputs,
  readHrHours, buildStress,
} from './stress.mjs';

const MAX = 190;
const RHR = 50;
// 0.3 x (190 - 50) = 42 bpm above resting = 3.0
const hr = (v) => RHR + (v / 3) * 42;
const pad = (n) => String(n).padStart(2, '0');
// one waking hour: avg bpm, covered minutes, minutes inside a Strava window, hist outside it
const hour = (date, h, avg, o = {}) => ({
  date, start: `${date}T${pad(h)}:00:00+02:00`, avg, cov: o.cov ?? 60, act: o.act ?? 0, hist: o.hist ?? null,
});
const zones = [{ date: '2030-01-01', type: 'Running', maxHr: MAX, maxSrc: 'profile', z: [0, 0, 0, 0, 0, 0] }];
// slept 23:00 the day before -> 07:00
const sleep = (date) => ({ date, value: 8, bedtime: 23, waketime: 7 });
function day(date, avgs, from = 8) {
  return avgs.map((a, i) => hour(date, from + i, a));
}

test('stressOf: 3 x (HR - RHR) / (0.3 x (HRmax - RHR)), clamped to 0..3', () => {
  assert.equal(stressOf(RHR, RHR, MAX), 0);
  assert.equal(stressOf(RHR + 42, RHR, MAX), STRESS_MAX);
  assert.ok(Math.abs(stressOf(RHR + 21, RHR, MAX) - 1.5) < 1e-9);
  assert.equal(stressOf(40, RHR, MAX), 0);
  assert.equal(stressOf(200, RHR, MAX), STRESS_MAX);
  assert.equal(stressOf(80, null, MAX), null);
  assert.equal(stressOf(80, RHR, null), null);
  assert.equal(stressOf(80, 60, 55), null);
});

test('bandOf: low < 1, medium 1-2, high >= 2', () => {
  assert.equal(bandOf(0.99), 'low');
  assert.equal(bandOf(1), 'medium');
  assert.equal(bandOf(1.99), 'medium');
  assert.equal(bandOf(2), 'high');
});

test('hourHr: the sample mean without a workout; the time-weighted hist (outside the window) with one', () => {
  assert.equal(hourHr(hour('2030-01-02', 10, 70)), 70);
  // 20 min in a ride: the 40 min outside it (hist) only
  assert.equal(hourHr(hour('2030-01-02', 10, 120, { act: 20, hist: new Map([[80, 1200], [90, 1200]]) })), 85);
  // a workout hour with too little time outside it: not scored
  assert.equal(hourHr(hour('2030-01-02', 10, 120, { act: 40, hist: new Map([[80, 1200]]) })), null);
  // under 30 covered minutes outside workouts: not scored
  assert.equal(hourHr(hour('2030-01-02', 10, 70, { cov: 20 })), null);
});

test('sleepWindows: bedtime after noon belongs to the evening before the wake-up date', () => {
  const [w] = sleepWindows([sleep('2030-01-02'), { date: '2030-01-03', value: 7, bedtime: 0.5, waketime: 7.5 }]);
  assert.equal(w.to - w.from, 8 * 60);
  const w2 = sleepWindows([{ date: '2030-01-03', value: 7, bedtime: 0.5, waketime: 7.5 }])[0];
  assert.equal(w2.to - w2.from, 7 * 60);
});

test('scoreHours: hours mostly asleep (>= 30 min) are left out, the waking hour after 07:00 counts', () => {
  const hours = [hour('2030-01-02', 5, 48), hour('2030-01-02', 6, 52), hour('2030-01-02', 7, hr(1.5)), hour('2030-01-02', 23, 49)];
  const s = scoreHours(hours, sleepWindows([sleep('2030-01-02'), sleep('2030-01-03')]));
  assert.deepEqual(s.map((x) => x.t), ['07']);
});

test('stressFromInputs: per day now (latest hour) + average + minutes per band; < MIN_HOURS hours = no value', () => {
  const d1 = day('2030-01-02', [hr(0.5), hr(0.5), hr(1.5), hr(1.5), hr(2.5), hr(2.5), hr(1.2)]);
  const d2 = day('2030-01-03', [hr(0.5), hr(0.5)]);
  const r = stressFromInputs({
    hours: [...d1, ...d2], zones,
    rhr: [{ date: '2030-01-02', value: RHR }, { date: '2030-01-03', value: RHR }],
    sleep: [sleep('2030-01-02'), sleep('2030-01-03')],
  });
  assert.equal(r.ok, true);
  assert.equal(r.asOf, '2030-01-03');
  assert.equal(r.maxHr, MAX);
  assert.equal(r.minHours, MIN_HOURS);
  const a = r.days.find((x) => x.date === '2030-01-02');
  assert.equal(a.n, 7);
  assert.deepEqual(a.now, { t: '14', v: 1.2, band: 'medium' });
  assert.equal(a.avg, 1.5);
  assert.equal(a.band, 'medium');
  assert.deepEqual(a.mins, { low: 120, medium: 180, high: 120 });
  assert.equal(a.hours.length, 7);
  assert.deepEqual(a.hours[0], { t: '08', v: 0.5, hr: hr(0.5) });
  const b = r.days.find((x) => x.date === '2030-01-03');
  assert.equal(b.n, 2);
  assert.equal(b.avg, null);
  assert.equal(b.now, null);
  // the trend series: the day averages, dense from the first scored day
  assert.deepEqual(r.metric, { kind: 'stress', dir: 0, dec: 1, start: '2030-01-02', v: [1.5, null] });
});

test('stressFromInputs: resting HR = the day\'s value, else the newest of the 3 days before; none -> no value', () => {
  const r = stressFromInputs({
    hours: [...day('2030-01-05', Array(6).fill(hr(1))), ...day('2030-01-12', Array(6).fill(hr(1)))], zones,
    rhr: [{ date: '2030-01-03', value: RHR }],
    sleep: [],
  });
  assert.equal(r.days.find((x) => x.date === '2030-01-05').avg, 1);
  const late = r.days.find((x) => x.date === '2030-01-12');
  assert.equal(late.avg, null);
  assert.equal(late.rhr, null);
});

test('stressFromInputs: no hours -> null; no max HR -> {ok: false, reason: noMaxHr}', () => {
  assert.equal(stressFromInputs({ hours: null }), null);
  const r = stressFromInputs({ hours: day('2030-01-02', [70]), zones: null, rhr: [], sleep: [] });
  assert.deepEqual(r, { ok: false, reason: 'noMaxHr', asOf: '2030-01-02' });
});

test('readHrHours + buildStress: hr-hourly.csv rows -> hours; no file -> null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stress-'));
  assert.equal(buildStress(dir), null);
  fs.writeFileSync(path.join(dir, 'hr-hourly.csv'), 'date,hour_start,avg,max,min,n,covered_min,act_min,hist,source\n' +
    '2030-01-02,2030-01-02T10:00:00+01:00,70.5,80,60,12,60.0,10.0,70:3000,W\nbad\n');
  const rows = readHrHours(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].start, '2030-01-02T10:00:00+01:00');
  assert.equal(rows[0].avg, 70.5);
  assert.equal(rows[0].act, 10);
  assert.equal(rows[0].hist.get(70), 3000);
  assert.deepEqual(buildStress(dir), { ok: false, reason: 'noMaxHr', asOf: '2030-01-02' });
});
