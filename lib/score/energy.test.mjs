/* Energy bank (lib/score/energy.mjs): an intraday 0-100 level from the morning's recovery %, drained
 * per awake hour by a baseline, the stress estimate and the heart-rate load, recharged in calm hours.
 * SYNTHETIC values only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ENERGY, loadDrain, stepHour, simulateDay, actWindows, hourLoads, energyFromInputs, readActivities, buildEnergy,
} from './energy.mjs';
import { buildScores } from './index.mjs';

const K = 100;
const MAX = 190;
const D = '2030-01-10';
const pad = (n) => String(n).padStart(2, '0');
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('ENERGY: the documented constants in one object', () => {
  assert.deepEqual({ ...ENERGY }, { MAX: 100, BASE_DRAIN: 1.5, STRESS_DRAIN: 1.5, LOAD_DRAIN: 30, CALM_STRESS: 0.5, RECHARGE: 1 });
  assert.ok(Object.isFrozen(ENERGY));
});

test('loadDrain: 30 x (1 - e^(-TRIMP / K)); none without load or K', () => {
  assert.equal(loadDrain(0, K), 0);
  assert.equal(loadDrain(50, null), 0);
  close(loadDrain(K, K), 30 * (1 - Math.exp(-1)));
  assert.ok(loadDrain(10000, K) <= 30);
});

test('stepHour: baseline, stress and load drain; +1 in a calm hour without a workout; clamped 0-100', () => {
  // baseline only (stress unscored, no load)
  let s = stepHour(50, { st: null, trimp: 0, wo: false }, K);
  close(s.lv, 48.5);
  assert.deepEqual([s.base, s.stress, s.load, s.charge], [1.5, 0, 0, 0]);
  // stress 2 -> -3 more
  s = stepHour(50, { st: 2, trimp: 0, wo: false }, K);
  close(s.lv, 45.5);
  // calm hour (stress < 0.5, no workout) -> -1.5 + 1
  s = stepHour(50, { st: 0.2, trimp: 0, wo: false }, K);
  close(s.lv, 50 - 1.5 - 0.3 + 1);
  assert.equal(s.charge, 1);
  // a calm-HR hour inside a workout does not recharge
  s = stepHour(50, { st: 0.2, trimp: K, wo: true }, K);
  assert.equal(s.charge, 0);
  close(s.lv, 50 - 1.5 - 0.3 - 30 * (1 - Math.exp(-1)));
  // clamps
  assert.equal(stepHour(1, { st: 3, trimp: 500, wo: true }, K).lv, 0);
  assert.equal(stepHour(100, { st: 0, trimp: 0, wo: false }, K).lv, 99.5);
});

test('simulateDay: starts at the recovery %, steps each awake data hour, carries a missing hour forward', () => {
  const hours = new Map([
    [7, { st: 0.2, trimp: 0, wo: false }],
    [8, { st: 1, trimp: 0, wo: false }],
    // 9: no data -> carried
    [10, { st: null, trimp: K, wo: true }],
  ]);
  const d = simulateDay({ start: 60, wakeH: 7, lastH: 10, hours, K });
  assert.deepEqual(d.hours.map((h) => h.h), [7, 8, 9, 10]);
  close(d.hours[0].lv, 60 - 1.5 - 0.3 + 1);
  close(d.hours[1].lv, d.hours[0].lv - 1.5 - 1.5);
  assert.equal(d.hours[2].gap, true);
  assert.equal(d.hours[2].lv, d.hours[1].lv);
  close(d.hours[3].lv, d.hours[2].lv - 1.5 - 30 * (1 - Math.exp(-1)));
  close(d.sum.base, 4.5);
  close(d.sum.stress, 0.3 + 1.5);
  close(d.sum.charge, 1);
  close(d.sum.load, 30 * (1 - Math.exp(-1)));
  assert.equal(d.min.h, 10);
});

test('actWindows + hourLoads: a workout spreads its TRIMP evenly over the clock hours it covers', () => {
  // 18:30 for 60 min, 60 min in Z3 -> TRIMP 180: 90 in hour 18, 90 in hour 19
  const acts = actWindows([{ date: D, start: `${D}T18:30:00+01:00`, elapsed: 3600, z: [0, 0, 0, 3600, 0, 0] }]);
  assert.equal(acts.length, 1);
  close(acts[0].load, 180);
  const rows = [18, 19, 20].map((h) => ({ date: D, start: `${D}T${pad(h)}:00:00+01:00`, avg: 100, cov: 60, act: h < 20 ? 30 : 0, hist: new Map() }));
  const L = hourLoads(rows, acts, MAX);
  close(L.get(`${D}T18`).trimp, 90);
  assert.equal(L.get(`${D}T18`).wo, true);
  close(L.get(`${D}T19`).trimp, 90);
  assert.equal(L.get(`${D}T20`).wo, false);
  assert.equal(L.get(`${D}T20`).trimp, 0);
});

// a whole day of inputs: woke 07:00 at 70 %, hours 07-21 calm (stress 0.2), a run 18:00-19:00
function inputs({ pct = 70, stressOk = true, strainOk = true } = {}) {
  const hours = [];
  for (let h = 0; h < 24; h++) hours.push({ date: D, start: `${D}T${pad(h)}:00:00+01:00`, avg: 60, cov: 60, act: h === 18 ? 60 : 0, hist: new Map() });
  const sleep = [{ date: D, value: 8, bedtime: 23, waketime: 7 }, { date: '2030-01-11', value: 8, bedtime: 22, waketime: 6 }];
  const stressHours = [];
  for (let h = 7; h < 22; h++) if (h !== 18) stressHours.push({ t: pad(h), v: 0.2, hr: 60 });
  return {
    hours,
    acts: [{ date: D, start: `${D}T18:00:00+01:00`, elapsed: 3600, z: [0, 0, 0, 0, 3600, 0] }],
    sleep,
    stress: stressOk ? { ok: true, days: [{ date: D, hours: stressHours }] } : null,
    days: { days: [{ date: D, rec: { value: 0.5, band: 'good', pct } }] },
    strain: strainOk ? { ok: true, K, maxHr: MAX } : { ok: false, reason: 'fewDays' },
  };
}

test('energyFromInputs: one day from wake to the last awake hour, the run as the big drop', () => {
  const E = energyFromInputs(inputs());
  assert.equal(E.ok, true);
  assert.equal(E.asOf, D);
  const d = E.days[0];
  assert.equal(d.date, D);
  assert.equal(d.start, 70);
  assert.equal(d.wake, '07:00');
  // 22:00 on is inside the next night (bed 22:00) -> the last awake hour is 21
  assert.equal(d.now.h, 21);
  assert.equal(d.hours[0].h, 7);
  const run = d.hours.find((h) => h.h === 18);
  assert.equal(run.wo, true);
  assert.ok(run.ld > 25, 'TRIMP 240 at K 100 drains ~27');
  // 14 calm hours: -1.5 - 0.3 + 1 each; the run hour -1.5 - load
  const want = 70 - 14 * 0.8 - 1.5 - 30 * (1 - Math.exp(-2.4));
  assert.ok(Math.abs(d.now.lv - Math.round(want)) <= 1, `${d.now.lv} vs ${want}`);
  assert.ok(d.min.lv <= d.now.lv);
  assert.deepEqual(Object.keys(d.sum), ['base', 'stress', 'load', 'charge']);
  assert.equal(d.sum.charge, 14);
  assert.deepEqual(E.metric, { kind: 'bank', dir: 0, dec: 0, start: D, v: [d.now.lv] });
  assert.deepEqual(E.C, { ...ENERGY });
  JSON.stringify(E);
});

test('energyFromInputs: no recovery % -> no value that day; no strain scale -> not ok; no hours -> null', () => {
  const noPct = energyFromInputs({ ...inputs(), days: { days: [{ date: D, rec: 'gated' }] } });
  assert.equal(noPct.ok, true);
  assert.equal(noPct.days[0].now, null);
  assert.equal(noPct.days[0].reason, 'noRecovery');
  assert.equal(noPct.metric, null);
  assert.deepEqual(energyFromInputs(inputs({ strainOk: false })), { ok: false, reason: 'noLoadScale', asOf: D });
  assert.equal(energyFromInputs({ ...inputs(), hours: null }), null);
  // no wake time -> no value
  const noWake = energyFromInputs({ ...inputs(), sleep: [] });
  assert.equal(noWake.days[0].reason, 'noWake');
});

test('energyFromInputs: without a stress bake the hours drain by baseline + load only and never recharge', () => {
  const d = energyFromInputs(inputs({ stressOk: false })).days[0];
  assert.equal(d.sum.stress, 0);
  assert.equal(d.sum.charge, 0);
  assert.ok(d.hours.every((h) => h.st == null));
});

test('readActivities: workout-zones.csv start + elapsed_s; rows without them are skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-'));
  try {
    assert.equal(readActivities(dir), null);
    fs.writeFileSync(path.join(dir, 'workout-zones.csv'),
      'date,activity_id,type,max_hr,max_hr_source,hr_avg,hr_max,z0_s,z1_s,z2_s,z3_s,z4_s,z5_s,source,start,elapsed_s\n' +
      `${D},1,Running,190,profile,150,170,0,0,600,1200,600,0,S,${D}T18:00:00+01:00,2400\n` +
      `${D},2,Running,190,profile,150,170,0,0,600,1200,600,0,S,,\n`);
    const a = readActivities(dir);
    assert.equal(a.length, 1);
    assert.equal(a[0].elapsed, 2400);
    assert.deepEqual(a[0].z, [0, 0, 600, 1200, 600, 0]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the demo extract bakes plausible days: levels in 0-100, the run days drain more', () => {
  const demo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../data/demo/extract');
  const S = buildScores(demo);
  const E = S.energy;
  assert.ok(E && E.ok, 'the demo has hourly HR, recovery and a strain scale');
  const valued = E.days.filter((d) => d.now);
  assert.ok(valued.length >= 7, `${valued.length} valued demo days`);
  for (const d of valued) {
    for (const h of d.hours) assert.ok(h.lv >= 0 && h.lv <= 100);
    assert.ok(d.now.lv <= d.start + d.sum.charge + 1e-9);
  }
  // not every day ends empty (the constants are not absurd on realistic days)
  assert.ok(valued.some((d) => d.now.lv >= 10), valued.map((d) => d.now.lv).join(','));
  assert.equal(buildEnergy(null), null);
});
