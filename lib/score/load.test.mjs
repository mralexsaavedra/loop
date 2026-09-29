import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ewma, percentile, trendBand, loadTrend, p90Window, relScore, loadFromSeries, buildLoad, typicalDay, TYPICAL_WINDOW_DAYS, MIN_TYPICAL_DAYS, LAMBDA_ACUTE, LAMBDA_CHRONIC, RAMPING_PCT, ABOVE_PCT, EASING_PCT, DETRAINING_PCT } from './load.mjs';
import { modalitySeries } from './series.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
// build a daily series from a list of loads, starting 2026-05-01
const days = (loads, from = '2026-05-01') => loads.map((load, i) => ({ date: addDays(from, i), load }));

test('lambdas are 2/(N+1) for 7 and 42 days', () => {
  near(LAMBDA_ACUTE, 0.25);
  near(LAMBDA_CHRONIC, 2 / 43);
});

test('ewma: seeded with the mean of the first min(7, n) values, then E = l*L + (1-l)*E', () => {
  // seed = mean of first 7 zeros = 0; one 70 on day 8 -> 0.25 * 70
  const e = ewma([0, 0, 0, 0, 0, 0, 0, 70], 0.25);
  near(e[e.length - 1], 17.5);
  // short series: seed = mean([4, 8]) = 6; lambda .5
  const s = ewma([4, 8], 0.5);
  near(s[0], 5);
  near(s[1], 6.5);
  assert.deepEqual(ewma([], 0.25), []);
});

test('ewma: an explicit seed wins over the default', () => {
  near(ewma([10], 0.5, 0)[0], 5);
});

test('percentile: linear interpolation on the sorted values', () => {
  near(percentile([1, 2, 3, 4, 5, 6, 7, 8], 0.9), 7.3);
  near(percentile([5], 0.9), 5);
  near(percentile([3, 1, 2], 0.5), 2);
  assert.equal(percentile([], 0.9), null);
});

test('trendBand edges: +30 ramping, +10 above, -9..+9 steady, -10 below, -30 below, -31 detraining', () => {
  const t = { 30: 'ramping', 100: 'ramping', 29: 'above', 10: 'above', 9: 'steady', 0: 'steady', '-9': 'steady', '-10': 'below', '-30': 'below', '-31': 'detraining' };
  for (const [pct, band] of Object.entries(t)) assert.equal(trendBand(Number(pct)), band, pct);
});

test('loadTrend: constant load is steady at trendPct 0', () => {
  const t = loadTrend(days(Array(60).fill(10)));
  assert.equal(t.ok, true);
  assert.equal(t.trendPct, 0);
  assert.equal(t.band, 'steady');
  assert.equal(t.reason, null);
});

test('loadTrend: 42 quiet days then a 7-day block matches the closed-form EWMAs', () => {
  const t = loadTrend(days([...Array(42).fill(10), ...Array(7).fill(40)]));
  const acute = 40 - 30 * Math.pow(1 - LAMBDA_ACUTE, 7);
  const chronic = 40 - 30 * Math.pow(1 - LAMBDA_CHRONIC, 7);
  assert.equal(t.ok, true);
  assert.equal(t.trendPct, Math.round(100 * (acute / chronic - 1)));
  assert.equal(t.band, 'ramping');
  assert.ok(Math.abs(t.acute - acute) < 0.01 && Math.abs(t.chronic - chronic) < 0.01);
});

test('loadTrend gate 1: fewer than 28 days since the epoch -> baselineBuilding, no direction', () => {
  const g = loadTrend(days(Array(28).fill(20))); // 28 entries = 27 days since epoch
  assert.equal(g.ok, false);
  assert.equal(g.reason, 'baselineBuilding');
  assert.equal(g.trendPct, null);
  assert.equal(g.band, null);
  assert.equal(loadTrend(days(Array(29).fill(20))).ok, true, '28 days since epoch passes');
});

test('loadTrend gate 2: fewer than 8 non-zero days -> baselineBuilding', () => {
  const mk = (n) => days([...Array(60 - n).fill(0), ...Array(n).fill(50)]);
  assert.equal(loadTrend(mk(7)).ok, false);
  assert.equal(loadTrend(mk(7)).reason, 'baselineBuilding');
  assert.equal(loadTrend(mk(8)).ok, true);
});

test('loadTrend gate 3: chronic < 1 -> baselineBuilding', () => {
  const t = loadTrend(days([...Array(50).fill(0), ...Array(8).fill(0.5)].reverse()));
  assert.equal(t.ok, false);
  assert.equal(t.reason, 'baselineBuilding');
});

test('loadTrend on an empty series is gated, not a throw', () => {
  assert.equal(loadTrend([]).ok, false);
});

test('p90Window: needs >= 8 non-zero days, ignores zero days and anything older than 90 days', () => {
  assert.deepEqual(p90Window(days([1, 2, 3, 4, 5, 6, 7])), { p90: null, n: 7 });
  const w = p90Window(days([1, 0, 2, 3, 0, 4, 5, 6, 7, 8]));
  assert.equal(w.n, 8);
  near(w.p90, 7.3);
  // a huge load 95 days before asOf must not move the percentile
  const old = days([1000, ...Array(94).fill(0), ...[1, 2, 3, 4, 5, 6, 7, 8]]);
  const o = p90Window(old);
  assert.equal(o.n, 8);
  near(o.p90, 7.3);
});

test('relScore: 100 * load / p90, clamped to 0..100, null without a usable p90', () => {
  assert.equal(relScore(50, 100), 50);
  assert.equal(relScore(150, 100), 100);
  assert.equal(relScore(0, 100), 0);
  assert.equal(relScore(5, null), null);
  assert.equal(relScore(5, 0), null);
});

const row = (date, type, dur, re) => ({ date, type, dur, re, hrAvg: null, kj: null });

test('loadFromSeries: one entry per scored modality, no cross-modality total, junk-only days do not count', () => {
  const rows = [];
  for (let i = 0; i < 60; i += 2) rows.push(row(addDays('2026-06-01', i), 'Running', 40, 50));
  rows.push(row('2026-07-30', 'HighIntensityIntervalTraining', 7, 1)); // junk-only gym day
  const out = loadFromSeries(modalitySeries(rows));
  assert.deepEqual(out.modalities.map((m) => m.key), ['gym', 'run', 'bike']);
  assert.equal('total' in out, false);
  const run = out.modalities.find((m) => m.key === 'run');
  const gym = out.modalities.find((m) => m.key === 'gym');
  assert.equal(run.trend.ok, true);
  assert.equal(run.n, 30);
  assert.equal(run.load, 0, 'the last run was the day before asOf');
  assert.equal(run.relScore, 0);
  assert.equal(gym.n, 0);
  assert.equal(gym.relScore, null);
  assert.equal(gym.trend.ok, false);
  assert.equal(out.coverage.droppedJunk, 1);
  assert.equal(out.asOf, '2026-07-30');
  assert.equal(out.reEpoch, '2026-06-01');
  assert.ok(Array.isArray(run.spark.v) && run.spark.to === out.asOf);
  assert.ok(run.spark.from <= run.spark.to);
  JSON.stringify(out); // JSON-safe
});

test('loadFromSeries with no epoch returns a gated, empty-load shape', () => {
  const out = loadFromSeries(modalitySeries([row('2026-06-01', 'Running', 40, null)]));
  assert.equal(out.reEpoch, null);
  assert.equal(out.modalities.every((m) => m.trend.ok === false && m.load === 0), true);
});

test('buildLoad windows are anchored to asOf, never the build clock', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-load-'));
  try {
    const lines = ['date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules'];
    for (let i = 0; i < 60; i += 2) lines.push(`${addDays('2026-06-01', i)},Running,40,,140,,165,Strava API,5,${50 + (i % 7)},`);
    fs.writeFileSync(path.join(dir, 'workouts.csv'), lines.join('\n') + '\n');
    const at = (iso) => {
      mock.timers.enable({ apis: ['Date'], now: new Date(iso) });
      try { return JSON.stringify(buildLoad(dir)); } finally { mock.timers.reset(); }
    };
    const a = at('2026-07-30T10:00:00Z');
    const b = at('2031-01-01T00:00:00Z');
    assert.equal(a, b);
    assert.equal(buildLoad(null), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('one source of truth for the trend thresholds: band edges and the advice rules use the same numbers', () => {
  assert.deepEqual([RAMPING_PCT, ABOVE_PCT, EASING_PCT, DETRAINING_PCT], [30, 10, -10, -30]);
  for (let pct = -80; pct <= 80; pct++) {
    const band = trendBand(pct);
    assert.equal(band === 'ramping', pct >= RAMPING_PCT, `ramping at ${pct}`);
    assert.equal(band === 'below' || band === 'detraining', pct <= EASING_PCT, `easing at ${pct}`);
    assert.equal(band === 'detraining', pct < DETRAINING_PCT, `detraining at ${pct}`);
    assert.equal(band === 'ramping' || band === 'above', pct >= ABOVE_PCT, `above at ${pct}`);
  }
});

/* ---- today-first: the asOf day's RE vs a typical training day of the same modality ---- */
test('typicalDay: median of NON-ZERO days in the 42 days before asOf (asOf itself excluded)', () => {
  assert.equal(TYPICAL_WINDOW_DAYS, 42);
  // 50 days: old 999s fall outside the window; zeros never count; the last (asOf) day is excluded
  const loads = [999, 999, 999, 999, 999, 999, 999, ...Array.from({ length: 42 }, (_, i) => (i % 3 === 0 ? 100 + i : 0)), 500];
  const t = typicalDay(days(loads));
  const inWin = loads.slice(-43, -1).filter((v) => v > 0).sort((a, b) => a - b);
  assert.equal(t.n, inWin.length);
  assert.equal(t.value, percentile(inWin, 0.5));
});

test('typicalDay: fewer than MIN_TYPICAL_DAYS non-zero days in the window -> value null (no "normal" to compare with)', () => {
  const few = Array.from({ length: 43 }, (_, i) => (i < MIN_TYPICAL_DAYS - 1 ? 80 : 0));
  assert.deepEqual(typicalDay(days(few)), { value: null, n: MIN_TYPICAL_DAYS - 1 });
  assert.deepEqual(typicalDay([]), { value: null, n: 0 });
});

test('loadFromSeries: each modality carries the asOf day load and its typical training day', () => {
  const rows = [];
  for (let i = 0; i < 60; i += 2) rows.push(row(addDays('2026-06-01', i), 'Running', 40, 50));
  rows.push(row('2026-07-31', 'Running', 30, 60), row('2026-07-31', 'Running', 20, 30), row('2026-07-31', 'Running', 5, 1));
  const out = loadFromSeries(modalitySeries(rows));
  const run = out.modalities.find((m) => m.key === 'run');
  assert.equal(out.asOf, '2026-07-31');
  assert.equal(run.load, 90, 'load = the asOf day: junk dropped, the rest summed');
  assert.deepEqual(run.typical, { value: 50, n: 21 });
  const gym = out.modalities.find((m) => m.key === 'gym');
  assert.equal(gym.load, 0);
  assert.equal(gym.typical.value, null);
});
