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

test('aggRunning shows recent sessions newest-first with pace from speed, excludes sub-5km/h', () => {
  const rows = [
    { date: '2026-06-22', speed: 10.0, power: 240, gct: 250, vosc: 10.0, stride: 1.10 },
    { date: '2026-06-25', speed: 3.0, power: null, gct: null, vosc: null, stride: null },
  ];
  const out = aggRunning(rows);
  assert.equal(out.hasData, true);
  assert.equal(out.count, 1, 'sub-5 km/h walk excluded');
  assert.equal(out.sessions[0].pace, '6:00', '10 km/h -> 6:00 /km');
});

test('aggRunning returns empty state with no runs', () => {
  assert.deepEqual(aggRunning(null), { hasData: false });
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
    { date: '2026-06-24', dur: 30, hrAvg: 140 },
    { date: '2026-06-25', dur: 20, hrAvg: 150 },
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
  const plain = [{ date: '2026-06-24', dur: 30, hrAvg: 140 }, { date: '2026-06-25', dur: 20, hrAvg: 150 }];
  const rich = plain.map((w) => ({ ...w, type: 'Running', re: 55, kj: 300 }));
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

test('aggCycling returns the empty state with no rides (or only zero-duration ones)', () => {
  assert.deepEqual(aggCycling(null), { hasData: false });
  assert.deepEqual(aggCycling([]), { hasData: false });
  assert.deepEqual(aggCycling([{ date: '2026-06-01', dur: 0, dist: null, hrAvg: null, re: null, kj: null, elev: null }]), { hasData: false });
});
