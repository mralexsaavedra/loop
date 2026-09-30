/* Unit tests for lib/health/aggregate.mjs — pure per-section aggregators +
 * buildHealth(extractDir), extracted from data/training/generate-health.js
 * (astro-plan-web slice 2). Ported from generate-health.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  aggBody, aggEnergy, aggActivity, aggRunning, aggCycling, aggRecovery, aggLoadRecovery,
  buildHealth,
} from './aggregate.mjs';
import { monitorFromInputs } from '../score/monitor.mjs';

function series(end, n, fn, source = 's') {
  const out = [];
  const base = new Date(end + 'T00:00:00Z');
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base); d.setUTCDate(d.getUTCDate() - i);
    out.push({ date: d.toISOString().slice(0, 10), value: fn(n - 1 - i), source });
  }
  return out;
}

test('aggBody trends weight and compares body fat WITHIN one scale only', () => {
  const w = series('2026-06-30', 40, (i) => 80 - i * 0.1, 'scale-a');
  const bf = [
    { date: '2024-01-01', value: 24, source: 'scale-b' },
    { date: '2026-05-01', value: 18, source: 'scale-a' },
    { date: '2026-06-01', value: 16, source: 'scale-a' },
  ];
  const out = aggBody(w, bf);
  assert.equal(out.hasData, true);
  assert.equal(out.bodyfat.source, 'scale-a');
  assert.equal(out.bodyfat.points, 2, 'scale-b reading excluded — never mix scales');
  assert.equal(out.bodyfat.delta, -2, '16 - 18, within scale-a only');
  assert.equal(out.weight.latest, 76.1);
});

test('aggBody returns empty state when neither series exists', () => {
  assert.deepEqual(aggBody(null, null), { hasData: false });
  assert.deepEqual(aggBody(null, null, null, null), { hasData: false });
});

test('aggBody shows waist as a sparse trend: latest + its date, change since the first reading', () => {
  const waist = [
    { date: '2026-03-01', value: 88, source: 'Shortcut' },
    { date: '2026-04-15', value: 86.5, source: 'Shortcut' },
    { date: '2026-06-01', value: 85.2, source: 'Health' },
  ];
  const out = aggBody(null, null, null, waist);
  assert.equal(out.hasData, true, 'waist alone is enough to render the body section');
  assert.deepEqual(
    { latest: out.waist.latest, latestDate: out.waist.latestDate, firstDate: out.waist.firstDate, points: out.waist.points, delta: out.waist.delta },
    { latest: 85.2, latestDate: '2026-06-01', firstDate: '2026-03-01', points: 3, delta: -2.8 },
  );
  assert.equal(out.waist.spark.v.length, 3, 'every measurement is a point (no daily smoothing on a sparse series)');
});

test('aggBody: a single waist reading has no delta, and no waist series means no waist block', () => {
  const one = aggBody(null, null, null, [{ date: '2026-06-01', value: 85, source: 'Shortcut' }]);
  assert.equal(one.waist.delta, null);
  assert.equal(one.waist.points, 1);
  const w = series('2026-06-30', 10, () => 80, 'scale-a');
  assert.equal(aggBody(w, null, null, null).waist, undefined);
});

test('aggEnergy computes the historical balance once enough intake days exist', () => {
  const act = series('2026-06-30', 60, () => 500);
  const basal = series('2026-06-30', 60, () => 1700);
  const diet = series('2026-06-30', 20, () => 1800);
  const out = aggEnergy(act, basal, diet);
  assert.ok(out.balance, 'balance should be present');
  assert.equal(out.balance.intakeAvg, 1800);
  assert.equal(out.balance.net, -400, 'negative = deficit');
});

test('aggEnergy returns empty state without expenditure series', () => {
  assert.deepEqual(aggEnergy(null, null, null), { hasData: false });
});

test('aggActivity trends steps and drops no-wear days from the NEAT average', () => {
  const steps = series('2026-06-30', 40, () => 10000);
  steps[steps.length - 1].value = 0;
  const out = aggActivity(steps, null, null, null);
  assert.equal(out.hasData, true);
  assert.equal(out.steps.avg30, 10000);
});

test('aggActivity returns empty state when no series exist', () => {
  assert.deepEqual(aggActivity(null, null, null, null), { hasData: false });
});

const run = (date, dur, dist, extra = {}) => ({ date, dur, dist, hrAvg: null, re: null, kj: null, elev: null, ...extra });

test('aggRunning lists runs from workouts.csv (Watch + Strava) newest-first: distance, time, pace = time / distance, HR, RE, elevation', () => {
  const out = aggRunning([
    run('2026-06-20', 44, 8, { hrAvg: 150.4, re: 57, elev: 35.4 }),
    run('2026-06-22', 30, 5), // Strava-only run, no running dynamics that day
  ], null);
  assert.equal(out.hasData, true);
  assert.equal(out.count, 2);
  assert.deepEqual(out.sessions[0], { date: '2026-06-22', dist: 5, time: '0:30', pace: '6:00', hrAvg: null, re: null, elev: null, power: null, gct: null, vosc: null, stride: null });
  assert.deepEqual(out.sessions[1], { date: '2026-06-20', dist: 8, time: '0:44', pace: '5:30', hrAvg: 150, re: 57, elev: 35, power: null, gct: null, vosc: null, stride: null });
});

test('aggRunning LEFT-joins the watch running dynamics by date (dash otherwise); dynamics-only days never add a run', () => {
  const dyn = [
    { date: '2026-06-20', speed: 10.9, power: 240.4, gct: 250.2, vosc: 10.04, stride: 1.104 },
    { date: '2026-06-21', speed: 11, power: 250, gct: 240, vosc: 9, stride: 1.2 }, // no workout row: ignored
    { date: '2026-06-22', speed: 3.0, power: 100, gct: 400, vosc: 5, stride: 0.6 }, // walk-speed garbage: not joined
  ];
  const out = aggRunning([run('2026-06-20', 44, 8), run('2026-06-22', 30, 5)], dyn);
  assert.equal(out.count, 2);
  assert.deepEqual(out.sessions.map((s) => s.date), ['2026-06-22', '2026-06-20']);
  assert.deepEqual([out.sessions[1].power, out.sessions[1].gct, out.sessions[1].vosc, out.sessions[1].stride], [240, 250, 10, 1.1]);
  assert.deepEqual([out.sessions[0].power, out.sessions[0].gct], [null, null], 'sub-5 km/h dynamics are not joined');
});

test('aggRunning merges same-day fragments (Watch) into one run, sums time/distance, weights HR by duration; row budget = cycling', () => {
  const out = aggRunning([
    run('2026-06-01', 20, 4, { hrAvg: 140 }),
    run('2026-06-01', 10, 1, { hrAvg: 170, re: 20 }),
    ...Array.from({ length: 9 }, (_, i) => run(`2026-06-${String(i + 2).padStart(2, '0')}`, 30, 5)),
  ], null);
  assert.equal(out.count, 10, 'distinct run days');
  assert.equal(out.sessions.length, 8, 'same row budget as the cycling table');
  const merged = aggRunning([run('2026-06-01', 20, 4, { hrAvg: 140 }), run('2026-06-01', 10, 1, { hrAvg: 170, re: 20 })], null).sessions[0];
  assert.deepEqual([merged.dist, merged.time, merged.pace, merged.hrAvg, merged.re], [5, '0:30', '6:00', 150, 20]);
});

test('aggRunning/aggCycling follow the ONE same-day rule (lib/training/sessions.mjs): junk stubs dropped, a Watch+Strava pair keeps only the Strava row', () => {
  const runs = aggRunning([
    run('2026-06-01', 2, 0.1, { source: 'Apple Watch' }), // 2-min stub, no RE: junk
    run('2026-06-02', 41, 8, { source: 'Apple Watch', hrAvg: 150 }),
    run('2026-06-02', 40, 7.9, { source: 'Strava API', hrAvg: 148, re: 70, elev: 50 }),
  ], null);
  assert.equal(runs.count, 1, 'the stub-only day is not a run day');
  assert.deepEqual([runs.sessions[0].dist, runs.sessions[0].time, runs.sessions[0].re, runs.sessions[0].elev], [7.9, '0:40', 70, 50], 'never summed with the Watch copy');
  const rides = aggCycling([
    { date: '2026-06-03', dur: 62, dist: 30, hrAvg: 140, re: null, kj: null, elev: null, source: 'Apple Watch' },
    { date: '2026-06-03', dur: 60, dist: 29.5, hrAvg: 139, re: 55, kj: 700, elev: 400, source: 'Strava API' },
  ]);
  assert.deepEqual(rides.sessions[0], { date: '2026-06-03', dist: 29.5, time: '1:00', elev: 400, hrAvg: 139, re: 55, kj: 700 });
});

test('aggRunning/aggCycling use the display rule: a 10-min no-HR Strava ride and a 9-min Watch run are listed; a 2-min stub is not', () => {
  const rides = aggCycling([
    { date: '2026-06-04', dur: 10, dist: 3, hrAvg: null, re: null, kj: null, elev: null, source: 'Strava API' },
    { date: '2026-06-05', dur: 2, dist: 0.5, hrAvg: null, re: null, kj: null, elev: null, source: 'Apple Watch' },
  ]);
  assert.equal(rides.count, 1);
  assert.equal(rides.sessions[0].date, '2026-06-04');
  const runs = aggRunning([run('2026-06-04', 9, 1.5, { source: 'Apple Watch' })], null);
  assert.equal(runs.count, 1);
});

test('aggRunning: no distance (treadmill without GPS) -> no pace, never a made-up one', () => {
  const s = aggRunning([run('2026-06-01', 30, null)], null).sessions[0];
  assert.deepEqual([s.dist, s.pace], [null, null]);
});

test('aggRunning returns empty state with no runs', () => {
  assert.deepEqual(aggRunning(null, null), { hasData: false });
  assert.deepEqual(aggRunning([], [{ date: '2026-06-01', speed: 10 }]), { hasData: false }, 'dynamics alone are not a run');
});

test('aggRecovery averages HRV per day and exposes vo2max first/latest', () => {
  const hrv = series('2026-06-30', 60, () => 60).concat([{ date: '2026-06-30', value: 100, source: 'Watch' }]);
  const vo2 = series('2026-06-30', 10, (i) => 40 + i, 'Watch');
  const out = aggRecovery({ hrv, vo2 });
  assert.equal(out.hasData, true);
  assert.equal(out.vo2max.first, 40);
  assert.equal(out.vo2max.latest, 49);
});

test('aggRecovery returns empty state when no recovery series exist', () => {
  assert.deepEqual(aggRecovery({}), { hasData: false });
});

test('aggLoadRecovery builds weekly HR-weighted load aligned to recovery', () => {
  const workouts = [
    { date: '2026-06-22', type: 'Running', dur: 30, hrAvg: 140 },
    { date: '2026-06-25', type: 'Running', dur: 20, hrAvg: 150 },
    { date: '2026-06-29', type: 'Running', dur: 20, hrAvg: 150 }, // closes the week of 06-22
  ];
  const hrv = series('2026-06-28', 14, () => 60);
  const out = aggLoadRecovery(workouts, hrv, null);
  assert.equal(out.hasData, true);
  const wk = out.series.find((s) => s.w === '2026-06-22');
  assert.equal(wk.load, 72, 'Σ(min × avgHR)/100');
});

test('aggLoadRecovery needs HR-tagged workouts AND at least one recovery marker', () => {
  assert.deepEqual(aggLoadRecovery(null, series('2026-06-28', 14, () => 60), null), { hasData: false });
});

/* ---------- buildHealth(extractDir) — the single lib-level entry point ---------- */

test('buildHealth(null) returns the same empty shape as buildHealth(emptyExtractDir)', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-empty-'));
  try {
    const fromNull = buildHealth(null);
    const fromEmptyDir = buildHealth(emptyDir);
    assert.deepEqual(fromNull, fromEmptyDir);
    assert.deepEqual(fromNull, {
      body: { hasData: false }, activity: { hasData: false }, energy: { hasData: false },
      running: { hasData: false }, cycling: { hasData: false }, recovery: { hasData: false }, loadRecovery: { hasData: false },
    });
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('buildHealth(extractDir) with real CSVs surfaces data for the sections that have files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-real-'));
  try {
    const rows = series('2026-06-30', 40, (i) => 80 - i * 0.05);
    const csv = 'date,value,source\n' + rows.map((r) => `${r.date},${r.value},${r.source}`).join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'weight.csv'), csv);
    const h = buildHealth(dir);
    assert.equal(h.body.hasData, true);
    assert.equal(h.activity.hasData, false, 'no steps CSV present');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('aggLoadRecovery ignores the extra row fields (type, re, kj): output is unchanged', () => {
  const plain = [{ date: '2026-06-22', type: 'Running', dur: 30, hrAvg: 140 }, { date: '2026-06-29', type: 'Running', dur: 20, hrAvg: 150 }];
  const rich = plain.map((w) => ({ ...w, re: 55, kj: 300 }));
  const hrv = series('2026-06-28', 14, () => 60);
  assert.deepEqual(aggLoadRecovery(rich, hrv, null), aggLoadRecovery(plain, hrv, null));
});

test('aggCycling lists recent rides newest-first (max 8) with a total count', () => {
  const rides = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, '0')}`, dur: 60 + i, dist: 20 + i * 0.123, hrAvg: 130.4, re: i === 0 ? null : 40 + i, kj: null, elev: i * 10.26,
  }));
  const out = aggCycling(rides);
  assert.equal(out.hasData, true);
  assert.equal(out.count, 10);
  assert.equal(out.sessions.length, 8, 'same row budget as the running table');
  assert.deepEqual(out.sessions[0], { date: '2026-06-10', dist: 21.11, time: '1:09', elev: 92, hrAvg: 130, re: 49, kj: null });
  assert.equal(out.sessions[7].date, '2026-06-03');
});

test('aggCycling merges same-day fragments into one ride and counts distinct ride days', () => {
  const out = aggCycling([
    { date: '2026-06-01', dur: 30, dist: 10, hrAvg: 120, re: null, kj: null, elev: null },
    { date: '2026-06-01', dur: 15, dist: 2, hrAvg: 160, re: null, kj: null, elev: null },
    { date: '2026-06-01', dur: 15, dist: null, hrAvg: null, re: 0, kj: null, elev: 0 },
    { date: '2026-06-02', dur: 60, dist: 25, hrAvg: 140, re: 50, kj: 600, elev: 300 },
  ]);
  assert.equal(out.count, 2, 'distinct ride days, not raw rows');
  assert.equal(out.sessions.length, 2);
  // HR weighted by duration over rows that carry HR: (120*30 + 160*15) / 45 = 133.3.
  assert.deepEqual(out.sessions[1], { date: '2026-06-01', dist: 12, time: '1:00', elev: 0, hrAvg: 133, re: 0, kj: null });
  assert.deepEqual(out.sessions[0], { date: '2026-06-02', dist: 25, time: '1:00', elev: 300, hrAvg: 140, re: 50, kj: 600 });
});

test('aggCycling keeps a field null only when every same-day fragment lacks it', () => {
  const out = aggCycling([
    { date: '2026-06-01', dur: 30, dist: null, hrAvg: null, re: null, kj: null, elev: null },
    { date: '2026-06-01', dur: 30, dist: null, hrAvg: null, re: 12, kj: 0, elev: null },
  ]);
  assert.deepEqual(out.sessions[0], { date: '2026-06-01', dist: null, time: '1:00', elev: null, hrAvg: null, re: 12, kj: 0 });
});

test('aggCycling orders newest-first even from out-of-order input', () => {
  const out = aggCycling([
    { date: '2026-06-03', dur: 30, dist: 10, hrAvg: null, re: null, kj: null, elev: null },
    { date: '2026-06-01', dur: 30, dist: 10, hrAvg: null, re: null, kj: null, elev: null },
    { date: '2026-06-02', dur: 30, dist: 10, hrAvg: null, re: null, kj: null, elev: null },
  ]);
  assert.deepEqual(out.sessions.map((s) => s.date), ['2026-06-03', '2026-06-02', '2026-06-01']);
});

test('aggCycling returns the empty state with no rides (or only zero-duration ones)', () => {
  assert.deepEqual(aggCycling(null), { hasData: false });
  assert.deepEqual(aggCycling([]), { hasData: false });
  assert.deepEqual(aggCycling([{ date: '2026-06-01', dur: 0, dist: null, hrAvg: null, re: null, kj: null, elev: null }]), { hasData: false });
});

/* ---- today first: headline = latest value with its date, 30-day mean + delta as context ---- */
test('aggRecovery: HRV headline is the newest DAY (daily median), not the 7-day rolling value; avg30 is context', () => {
  const hrv = series('2026-06-30', 40, () => 60).concat([{ date: '2026-06-30', value: 100, source: 'Watch' }]);
  const out = aggRecovery({ hrv });
  assert.equal(out.hrv.latest, 80, 'median of the two readings of the newest day');
  assert.equal(out.hrv.latestDate, '2026-06-30');
  assert.equal(out.hrv.avg30, Math.round((60 * 29 + 80) / 30), 'the last 30 calendar days, latest included');
});

test('aggRecovery: resting HR carries avg30; sleep headline = last night, avg = the 30-night mean', () => {
  const rhr = series('2026-06-30', 40, (i) => (i === 39 ? 58 : 50));
  const sleep = series('2026-06-30', 40, (i) => (i === 39 ? 5.5 : 7.5)).map((r) => ({ ...r, bedtime: 23, waketime: 7 }));
  const out = aggRecovery({ rhr, sleep });
  assert.equal(out.rhr.latest, 58);
  assert.equal(out.rhr.avg30, Math.round(((50 * 29 + 58) / 30) * 10) / 10);
  assert.equal(out.sleep.latest, 5.5);
  assert.equal(out.sleep.latestDate, '2026-06-30');
  assert.equal(out.sleep.avg, Math.round(((7.5 * 29 + 5.5) / 30) * 10) / 10);
  assert.equal(out.sleep.nights, 30);
});

test('aggEnergy: expenditure headline = the newest day TDEE with its date; the 30-day mean stays', () => {
  const act = series('2026-06-30', 60, (i) => (i === 59 ? 900 : 500));
  const basal = series('2026-06-30', 60, () => 1700);
  const out = aggEnergy(act, basal, null);
  assert.equal(out.tdeeLatest, 2600);
  assert.equal(out.tdeeLatestDate, '2026-06-30');
  assert.equal(typeof out.tdeeAvg, 'number');
});

test('aggActivity: every daily total carries latest + latestDate for the headline', () => {
  const steps = series('2026-06-30', 40, (i) => 9000 + i);
  const out = aggActivity(steps, null, null, null);
  assert.equal(out.steps.latest, 9039);
  assert.equal(out.steps.latestDate, '2026-06-30');
});

test('aggLoadRecovery: same-day rule (load), "other" excluded, only complete weeks', () => {
  // 2026-09-30 is a Wednesday -> its week (from 09-28) is partial and dropped
  const w = (date, type, dur, hrAvg, source = 'Apple Watch', re = null) => ({ date, type, dur, hrAvg, re, source });
  const workouts = [
    w('2026-06-01', 'Running', 30, 150), // Monday: the history starts on a full week
    w('2026-09-21', 'HighIntensityIntervalTraining', 52, 130), // Watch copy of the Strava session
    w('2026-09-21', 'TraditionalStrengthTraining', 50, 120, 'Strava API', 60),
    w('2026-09-22', 'Walking', 60, 100), // other: not training load
    w('2026-09-23', 'Running', 5, 110), // junk fragment: short and effortless
    w('2026-09-30', 'Running', 40, 150), // current (partial) week
  ];
  const hrv = series('2026-09-30', 150, () => 60);
  const out = aggLoadRecovery(workouts, hrv, null);
  assert.equal(out.series.length, 12);
  assert.equal(out.weeks, 12);
  assert.equal(out.series[out.series.length - 1].w, '2026-09-21', 'the last complete week, not the current one');
  assert.equal(out.series[out.series.length - 1].load, 60, 'only the Strava row: 50 min x 120 / 100');
});

test('aggLoadRecovery: a week ending on the asOf Sunday is complete; a leading partial week is dropped', () => {
  const w = (date, dur) => ({ date, type: 'Running', dur, hrAvg: 100, re: null, source: 'Apple Watch' });
  // data starts on Thursday 2026-08-06; asOf Sunday 2026-09-27
  const workouts = [w('2026-08-06', 60), w('2026-08-12', 60), w('2026-09-27', 60)];
  const hrv = series('2026-09-27', 60, () => 60);
  const out = aggLoadRecovery(workouts, hrv, null);
  assert.equal(out.series[out.series.length - 1].w, '2026-09-21', 'the asOf Sunday closes its week');
  assert.equal(out.series[0].w, '2026-08-10', 'the week of 08-03 starts before the data (partial) and is dropped');
  assert.equal(out.weeks, out.series.length);
});

test('aggRecovery: bedtime / wake regularity is a ROBUST spread, so a couple of odd nights do not dominate it', () => {
  const sleep = series('2026-06-30', 30, () => 7).map((r, i) => ({ ...r, bedtime: i % 2 ? 23.5 : 23.25, waketime: i % 2 ? 7 : 6.75 }));
  sleep[10] = { ...sleep[10], bedtime: 18.3, waketime: 18.3 };
  sleep[20] = { ...sleep[20], bedtime: 3.2, waketime: 18.4 };
  const out = aggRecovery({ sleep });
  assert.ok(out.sleep.bedtimeSd <= 15, `bedtime spread ${out.sleep.bedtimeSd} min`);
  assert.ok(out.sleep.wakeSd <= 15, `wake spread ${out.sleep.wakeSd} min`);
});

test('Salud and the Inicio monitor show the SAME HRV and resting HR for the same input (clamped daily median)', () => {
  const hrv = series('2026-06-30', 30, (i) => 40 + (i % 5)).flatMap((r) => [r, { ...r, value: r.value + 20 }]);
  // newest day: a sensor spike (clamped to 200) and an extra high sample pull a mean, not a median
  hrv.push({ date: '2026-07-01', value: 30, source: 's' }, { date: '2026-07-01', value: 50, source: 's' }, { date: '2026-07-01', value: 250, source: 's' });
  // resting HR with a duplicate row on the newest day: the raw last row is not the day's value
  const rhr = series('2026-07-01', 30, () => 50).concat([{ date: '2026-07-01', value: 60, source: 's' }]);
  const salud = aggRecovery({ hrv, rhr });
  const mon = Object.fromEntries(monitorFromInputs({ hrv, rhr }).cards.map((c) => [c.key, c]));
  assert.equal(salud.hrv.latest, 50);
  assert.equal(salud.hrv.latest, mon.hrv.value);
  assert.equal(salud.rhr.latest, 55, 'median of the two rows of the newest day');
  assert.equal(salud.rhr.latest, mon.rhr.value);
  assert.equal(salud.rhr.latestDate, '2026-07-01');
  // a partial newest day (1 sample vs the usual 2-3) is skipped by both
  const partial = hrv.concat([{ date: '2026-07-02', value: 150, source: 's' }]);
  const s2 = aggRecovery({ hrv: partial });
  const m2 = monitorFromInputs({ hrv: partial }).cards.find((c) => c.key === 'hrv');
  assert.equal(s2.hrv.latestDate, '2026-07-01');
  assert.equal(m2.date, '2026-07-01');
  assert.equal(s2.hrv.latest, m2.value);
});

test('aggEnergy: the balance window ends at the newest expenditure day; intake abandoned > 14 days ago is not scored', () => {
  const act = series('2026-06-30', 200, () => 500);
  const basal = series('2026-06-30', 200, () => 1700);
  // 30 logged days that ended on 2026-06-01 (29 days before the newest TDEE day)
  const old = series('2026-06-01', 30, () => 1800);
  const out = aggEnergy(act, basal, old);
  assert.equal(out.balance, null, 'stale intake cannot be scored against current expenditure');
  assert.equal(out.macros, undefined);
  assert.equal(out.lastIntake, '2026-06-01', 'the page still says when intake was last logged');
  // logged until 10 days before the newest TDEE day: scored, over the window ending at that day
  const recent = series('2026-06-20', 30, () => 1800);
  const ok = aggEnergy(act, basal, recent);
  assert.ok(ok.balance);
  assert.equal(ok.balance.to, '2026-06-20');
});

test('aggBody: body fat carries how many readings fall in its comparison window', () => {
  const bf = [
    { date: '2025-01-01', value: 22, source: 'S' },
    { date: '2026-03-01', value: 20, source: 'S' },
    { date: '2026-05-01', value: 19.5, source: 'S' },
    { date: '2026-06-01', value: 19, source: 'S' },
  ];
  const out = aggBody(null, bf, null, null);
  assert.equal(out.bodyfat.windowPoints, 3);
  assert.equal(out.bodyfat.windowDays, 150);
  assert.equal(out.bodyfat.points, 4);
});
