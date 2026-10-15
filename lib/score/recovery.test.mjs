import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dailyRobust, winsorize, robustBaseline, composite, trend7, recoveryBand, recoveryFromInputs, recoveryFrom, measureSigma, trendDir, dayBand, completeDay,
  percentileRank, pctBand, PCT_WINDOW_DAYS, MIN_PCT_DAYS, PCT_GOOD, PCT_LOW, MAX_TODAY_FALLBACK_DAYS,
  DAY_BAND_CUTOFF, TREND_DIR_CUTOFF, MEASURED_SIGMA, Z_CLAMP,
  WEIGHTS, BAND_CUTOFF,
} from './recovery.mjs';
import { readSeries } from '../health/read.mjs';
import { readExtract } from '../extract/read.mjs';
import { addDays } from '../date.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const AS_OF = '2026-09-29';
// dates ending at AS_OF (ascending), `n` of them
const dates = (n, asOf = AS_OF) => Array.from({ length: n }, (_, i) => addDays(asOf, i - (n - 1)));

// deterministic wiggle so MAD is non-degenerate
const wig = (i) => ((i * 7) % 5) - 2; // -2..2

// Build a full synthetic input set. `shift` moves the LAST 7 days in the good direction.
function inputs({ n = 49, shift = 0, sleepUntil = n, noSleep = false, asOf = AS_OF } = {}) {
  const ds = dates(n, asOf);
  const hrv = ds.map((date, i) => ({ date, value: (60 + wig(i)) * (i >= n - 7 ? Math.exp(0.1 * shift) : 1) }));
  const rhr = ds.map((date, i) => ({ date, value: 50 + wig(i) * 0.5 - (i >= n - 7 ? shift : 0) }));
  const sleep = noSleep ? [] : ds.slice(0, sleepUntil).map((date, i) => ({
    date, value: 7.5 + wig(i) * 0.2 + (i >= n - 7 ? 0.5 * shift : 0), bedtime: 23 + wig(i) * 0.1, waketime: 7 + wig(i) * 0.1,
  }));
  return { hrv, rhr, sleep };
}

test('dailyRobust: median of per-sample-clamped values, one value per day, sorted', () => {
  const rows = [
    { date: '2026-09-02', value: 50 }, { date: '2026-09-01', value: 50 }, { date: '2026-09-01', value: 51 },
    { date: '2026-09-01', value: 52 }, { date: '2026-09-01', value: 53 }, { date: '2026-09-01', value: 230 },
  ];
  const out = dailyRobust(rows, { lo: 5, hi: 200 });
  assert.deepEqual(out.map((r) => r.date), ['2026-09-01', '2026-09-02']);
  assert.equal(out[0].value, 52, 'a 230 ms outlier does not move the day median');
});

test('dailyRobust clamps a lone 230 ms sample to 200 and a 1 ms sample to 5', () => {
  assert.equal(dailyRobust([{ date: '2026-09-01', value: 230 }], { lo: 5, hi: 200 })[0].value, 200);
  assert.equal(dailyRobust([{ date: '2026-09-01', value: 1 }], { lo: 5, hi: 200 })[0].value, 5);
});

test('dailyRobust ignores non-finite values and returns [] for null input', () => {
  assert.deepEqual(dailyRobust(null, { lo: 0, hi: 1 }), []);
  assert.deepEqual(dailyRobust([{ date: '2026-09-01', value: NaN }], { lo: 0, hi: 1 }), []);
});

test('winsorize clamps to median +/- k*MAD', () => {
  assert.deepEqual(winsorize([0, 10, 20], 10, 2, 3), [4, 10, 16]);
});

test('robustBaseline: median, 1.4826*MAD, and the MAD floor prevents an inflated z', () => {
  const b = robustBaseline([1, 2, 3, 4, 5, 6, 7, 8, 9], 0.1);
  assert.equal(b.median, 5);
  near(b.mad, 1.4826 * 2);
  assert.equal(b.n, 9);
  assert.equal(robustBaseline([60, 60, 60, 60], 1.0).mad, 1.0, 'constant series falls back to the floor');
});

test('composite: weighted mean over the available components, renormalised, in MAD units', () => {
  near(composite({ hrv: 1, rhr: -1 }, WEIGHTS), (0.4 * 1 + 0.25 * -1) / 0.65);
  near(composite({ hrv: 2 }, WEIGHTS), 2);
  assert.equal(composite({}, WEIGHTS), null);
  assert.equal(composite({ hrv: null, rhr: undefined }, WEIGHTS), null);
});

test('weights are hrv .40, rhr .25, sleepDur .25, sleepCons .10', () => {
  assert.deepEqual(WEIGHTS, { hrv: 0.4, rhr: 0.25, sleepDur: 0.25, sleepCons: 0.1 });
});

test('trend7: mean of the composite over the 7 days ending asOf; anchored to the given asOf', () => {
  const series = dates(14).map((date, i) => ({ date, value: i < 7 ? 0 : 1 }));
  near(trend7(series, AS_OF).value, 1);
  near(trend7(series, addDays(AS_OF, -7)).value, 0);
  assert.equal(trend7(series, AS_OF).n, 7);
  // fewer than 3 days in the window -> no trend
  assert.equal(trend7(series.slice(-2), AS_OF).value, null);
});

test('recoveryBand edges: +0.5 above, -0.5 below, 0.2 at baseline', () => {
  assert.equal(BAND_CUTOFF, 0.5);
  assert.equal(recoveryBand(0.5), 'above');
  assert.equal(recoveryBand(-0.5), 'below');
  assert.equal(recoveryBand(0.2), 'at');
  assert.equal(recoveryBand(-0.49), 'at');
  assert.equal(recoveryBand(0.6), 'above');
});

test('scored: a good final week is banded above, with per-component trends and 14 raw dailies in native units', () => {
  const r = recoveryFromInputs(inputs({ shift: 2 }));
  assert.equal(r.gated, false);
  assert.equal(r.reason, null);
  assert.equal(r.asOf, AS_OF);
  assert.equal(r.band, 'above');
  assert.ok(r.trend7 >= 0.5 && r.trend7 <= 3);
  assert.deepEqual(r.components.map((c) => c.key), ['hrv', 'rhr', 'sleepDur', 'sleepCons']);
  for (const c of r.components) {
    assert.equal(c.daily.length, 14, `${c.key} last 14 dailies`);
    assert.equal(c.daily[13].date, AS_OF);
    assert.ok(c.n >= 14 && c.baseline != null && c.mad > 0);
    assert.ok(['above', 'at', 'below'].includes(c.band));
  }
  const hrv = r.components[0];
  assert.equal(hrv.unit, 'ms');
  assert.ok(hrv.daily[13].value > 60 && hrv.daily[13].value < 100, 'hrv dailies are raw ms, not ln');
  assert.ok(hrv.baseline > 50 && hrv.baseline < 70, 'baseline is native ms');
  assert.equal(r.components[1].unit, 'bpm');
  assert.equal(r.components[2].unit, 'h');
  assert.equal(r.components[3].unit, 'min');
  assert.equal(r.spark.v.length, 14);
  assert.equal(r.spark.to, AS_OF);
  assert.ok(r.delta7 > 0, 'improving vs a week earlier');
  assert.deepEqual(r.confidence.level, 'high');
  assert.equal(r.missing.length, 0);
});

test('a flat final week is at baseline; a poor final week is below with a driver', () => {
  const flat = recoveryFromInputs(inputs({ shift: 0 }));
  assert.equal(flat.band, 'at');
  const poor = recoveryFromInputs(inputs({ shift: -2 }));
  assert.equal(poor.band, 'below');
  assert.ok(['hrv', 'rhr', 'sleepDur', 'sleepCons'].includes(poor.driver));
  assert.equal(flat.driver === null || typeof flat.driver === 'string', true);
  const worst = poor.components.find((c) => c.key === poor.driver);
  assert.ok(worst.trend7 <= -BAND_CUTOFF, 'the driver is itself below baseline');
});

test('driver: a component only slightly under baseline (within the band) is never named', () => {
  const r = recoveryFromInputs(inputs({ shift: -0.15 }));
  assert.ok(r.components.some((c) => c.trend7 < 0), 'something is a little negative');
  assert.ok(r.components.every((c) => c.trend7 > -BAND_CUTOFF), 'but nothing is below the band');
  assert.equal(r.driver, null);
});

test('gate: 10 baseline days for every component -> gated, reason insufficient, no numbers', () => {
  const r = recoveryFromInputs(inputs({ n: 10, shift: 2 }));
  assert.equal(r.gated, true);
  assert.equal(r.reason, 'insufficient');
  assert.equal(r.trend7, null);
  assert.equal(r.band, null);
  assert.deepEqual(r.components, []);
});

test('gate: components below 14 baseline days are dropped and listed missing', () => {
  const { hrv, rhr, sleep } = inputs();
  const r = recoveryFromInputs({ hrv, rhr, sleep: sleep.slice(-10) });
  assert.equal(r.gated, false);
  assert.deepEqual(r.components.map((c) => c.key), ['hrv', 'rhr']);
  assert.deepEqual([...r.missing].sort(), ['sleepCons', 'sleepDur']);
  assert.ok(r.confidence.weight < 1);
});

test('gate: available weight below 0.60 -> insufficient (hrv alone = 0.40)', () => {
  const { hrv } = inputs();
  const r = recoveryFromInputs({ hrv, rhr: [], sleep: [] });
  assert.equal(r.gated, true);
  assert.equal(r.reason, 'insufficient');
});

test('gate: rhr + sleepDur + sleepCons = 0.60 exactly is enough', () => {
  const { rhr, sleep } = inputs();
  const r = recoveryFromInputs({ hrv: [], rhr, sleep });
  assert.equal(r.gated, false);
  assert.equal(r.confidence.weight, 0.6);
});

test('gate: needs an hrv or rhr component even with enough weight', () => {
  const { sleep } = inputs();
  const r = recoveryFromInputs({ hrv: [], rhr: [], sleep });
  assert.equal(r.gated, true);
});

test('gate: fewer than 7 composite days in the trailing 14 -> insufficient', () => {
  const ds = dates(49);
  const keep = new Set([...ds.slice(0, 25).slice(-20), ...ds.slice(-5)]); // 20 old baseline days + 5 recent
  const pick = (rows) => rows.filter((r) => keep.has(r.date));
  const { hrv, rhr, sleep } = inputs();
  const r = recoveryFromInputs({ hrv: pick(hrv), rhr: pick(rhr), sleep: pick(sleep) });
  assert.equal(r.gated, true);
  assert.equal(r.reason, 'insufficient');
});

test('no sleep today: the newest day is not complete (the headline is the previous night), the trend is still computed', () => {
  const full = recoveryFromInputs(inputs({ shift: 2 }));
  const noToday = recoveryFromInputs(inputs({ shift: 2, sleepUntil: 48 }));
  assert.equal(noToday.gated, false);
  assert.equal(noToday.today.date, addDays(AS_OF, -1));
  assert.deepEqual(noToday.missing, [], 'the headline night has every component');
  assert.equal(noToday.confidence.weight, full.confidence.weight);
  assert.equal(typeof noToday.trend7, 'number');
});

test('sleep consistency wraps bedtimes past midnight (wrapNight): 00:30 vs a 23:00 habit is 90 min, not ~22 h', () => {
  const base = inputs();
  const sleep = base.sleep.map((s, i, a) => (i === a.length - 1 ? { ...s, bedtime: 0.5, waketime: 7 } : { ...s, bedtime: 23, waketime: 7 }));
  const r = recoveryFromInputs({ ...base, sleep });
  const cons = r.components.find((c) => c.key === 'sleepCons');
  assert.equal(cons.daily[13].value, 45, '(|90| + |0|) / 2 minutes');
});

test('the only 0-100 value is today.pct (a rank): no score-ish key, trend7 stays in MAD units', () => {
  const r = recoveryFromInputs(inputs({ shift: 2 }));
  const keys = [];
  (function walk(o) { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); } })(r);
  assert.equal(keys.some((k) => /score|grade|pct100/i.test(k)), false);
  assert.ok(Number.isInteger(r.today.pct) && r.today.pct >= 0 && r.today.pct <= 100);
  assert.ok(Math.abs(r.trend7) <= 3);
  JSON.stringify(r);
});

test('asOf is the newest date across the inputs and every window hangs off it, not the clock', () => {
  const inp = inputs({ asOf: '2026-03-15', shift: 2 });
  const at = (iso) => {
    mock.timers.enable({ apis: ['Date'], now: new Date(iso) });
    try { return JSON.stringify(recoveryFromInputs(inp)); } finally { mock.timers.reset(); }
  };
  const a = at('2026-03-16T08:00:00Z');
  assert.equal(a, at('2031-12-31T23:00:00Z'));
  assert.equal(JSON.parse(a).asOf, '2026-03-15');
});

test('recoveryFromInputs with nothing returns the gated shape, never throws', () => {
  for (const x of [{}, { hrv: null, rhr: null, sleep: null }]) {
    const r = recoveryFromInputs(x);
    assert.equal(r.gated, true);
    assert.equal(r.asOf, null);
  }
});

test('recoveryFrom scores the readExtract hrv, rhr and sleep rows; null when all three are absent', () => {
  assert.equal(recoveryFrom(readExtract(null)), null);
  const inp = inputs({ shift: 2 });
  const src = (rows) => rows.map((r) => ({ ...r, source: 'Watch' }));
  const r = recoveryFrom({ series: { hrv: src(inp.hrv), rhr: src(inp.rhr) }, sleep: inp.sleep });
  assert.equal(r.gated, false);
  assert.equal(r.band, 'above');
  assert.equal(recoveryFrom({ series: { hrv: null, rhr: null }, sleep: inp.sleep }).asOf, AS_OF, 'sleep alone still scores (absent series read as [])');
});

test('the optional debug argument exposes the daily composite series without changing the output', () => {
  const inp = inputs({ shift: 2 });
  const dbg = {};
  assert.deepEqual(recoveryFromInputs(inp, { debug: dbg }), recoveryFromInputs(inp));
  assert.ok(Array.isArray(dbg.composite) && dbg.composite.length >= 14);
  assert.equal(dbg.composite.length, 49, 'default history reaches back over the percentile window (all 49 input days here)');
  assert.equal(dbg.composite[dbg.composite.length - 1].date, AS_OF);
  assert.ok(dbg.composite.every((r) => Number.isFinite(r.value)));
});

test('historyDays exposes the full composite series (parameterised window) without changing the output', () => {
  const inp = inputs({ n: 120, shift: 0 });
  const dbg = {};
  const withHistory = recoveryFromInputs(inp, { debug: dbg, historyDays: 110 });
  assert.deepEqual(withHistory, recoveryFromInputs(inp));
  assert.equal(dbg.composite.length, 110);
  assert.equal(dbg.composite[0].date, addDays(AS_OF, -109));
});

test('measureSigma re-derives sigma_d and sigma_7 from raw inputs (rolling, baseline ends the day before each day)', () => {
  const inp = inputs({ n: 160, shift: 0 });
  const a = measureSigma(inp, { days: 60 });
  const b = measureSigma(inp, { days: 60 });
  assert.deepEqual(a, b, 'deterministic');
  assert.equal(a.days, 60);
  assert.ok(a.sigmaD > 0 && a.sigmaD < 3);
  assert.ok(a.sigma7 > 0 && a.sigma7 < a.sigmaD, 'smoothing over 7 days shrinks the spread');
  assert.equal(a.band, 0.5);
});

test('baseline overlap is deliberate: the 42-day baseline contains the trailing week, which damps z (never inflates it)', () => {
  // The baseline window (asOf-42..asOf-1) includes the days being scored. A genuinely shifted final
  // week pulls the median/MAD a little toward itself, so the reported trend is SMALLER than against
  // a baseline that excluded the week. Trade-off accepted: false alarms are worse than a slightly late one.
  const shifted = recoveryFromInputs(inputs({ shift: 2 }));
  const hrv = shifted.components.find((c) => c.key === 'hrv');
  const cleanBaseline = recoveryFromInputs(inputs({ shift: 0 })).components.find((c) => c.key === 'hrv').baseline;
  assert.ok(hrv.baseline >= cleanBaseline, 'baseline is pulled toward the shifted week, never away from it');
  // an independent z against the clean baseline is at least as large as the reported one
  const rawLast7 = hrv.daily.slice(-7).map((d) => Math.log(d.value));
  const meanLn = rawLast7.reduce((s, x) => s + x, 0) / 7;
  const cleanZ = Math.min(3, (meanLn - Math.log(cleanBaseline)) / 0.05);
  assert.ok(hrv.trend7 <= cleanZ + 1e-9);
});

/* ---- today-first: last night's composite + a 7-day direction word ---- */
test('today: the composite of the asOf day, in MAD units vs the same baseline and bands', () => {
  const debug = {};
  const r = recoveryFromInputs(inputs({ shift: 2 }), { debug });
  const last = debug.composite[debug.composite.length - 1];
  assert.equal(last.date, AS_OF);
  const { pct, pctBand: pb, pctDays, ...sd } = r.today;
  assert.deepEqual(sd, { date: AS_OF, value: Math.round(last.value * 100) / 100, band: dayBand(last.value), sleep: true });
  assert.equal(pctDays, 48, 'every earlier day of the 49 is a prior');
  assert.ok(Number.isInteger(pct) && pb === pctBand(pct));
  assert.equal(r.today.band, 'above', 'a good final week makes last night above baseline too');
  assert.ok(Math.abs(r.today.value) <= 3);
});

test('today: a night with no HRV and no resting HR is not a composite (sleep alone is too thin) -> the previous complete day, by its date', () => {
  const inp = inputs({ shift: 2 });
  const r = recoveryFromInputs({ ...inp, hrv: inp.hrv.slice(0, -1), rhr: inp.rhr.slice(0, -1) });
  assert.equal(r.gated, false);
  assert.equal(r.today.date, addDays(AS_OF, -1), 'falls back to the latest complete day, labelled by its date');
  assert.equal(typeof r.trend7, 'number', 'the trend still shows');
});

test('today: null when no day of the last week is complete', () => {
  const inp = inputs({ shift: 2 });
  const cut = addDays(AS_OF, -7);
  const r = recoveryFromInputs({ ...inp, hrv: inp.hrv.filter((x) => x.date <= cut), rhr: inp.rhr.filter((x) => x.date <= cut) });
  assert.equal(r.today, null);
});

test('today: HRV alone is not that day; HRV + resting HR without sleep is not either (sleep is required)', () => {
  const inp = inputs({ shift: 2 });
  const hrvOnly = recoveryFromInputs({ ...inp, rhr: inp.rhr.slice(0, -1), sleep: inp.sleep.slice(0, -1) });
  assert.equal(hrvOnly.today.date, addDays(AS_OF, -1));
  const noSleep = recoveryFromInputs({ ...inp, sleep: inp.sleep.slice(0, -1) });
  assert.equal(noSleep.today.date, addDays(AS_OF, -1));
  assert.equal(noSleep.today.sleep, true, 'the headline night always has a sleep-duration reading');
});

test('DAY_BAND_CUTOFF keeps the trend false-flip rate for a single day: BAND_CUTOFF x sigma_daily / sigma_7 ~ 1.2', () => {
  assert.deepEqual(MEASURED_SIGMA, { daily: 0.782, trend7: 0.328 });
  assert.equal(DAY_BAND_CUTOFF, Math.round(10 * BAND_CUTOFF * MEASURED_SIGMA.daily / MEASURED_SIGMA.trend7) / 10);
  assert.equal(DAY_BAND_CUTOFF, 1.2);
  assert.equal(dayBand(1.2), 'above');
  assert.equal(dayBand(1.1), 'at', 'a +1.1 night is inside the daily noise band');
  assert.equal(dayBand(-1.2), 'below');
  assert.equal(Z_CLAMP, 3);
});

test('trendDir: two non-overlapping 7-day means differ with noise sqrt(2) x sigma_7, so the cut is BAND_CUTOFF x sqrt(2) ~ 0.7', () => {
  assert.equal(TREND_DIR_CUTOFF, Math.round(10 * BAND_CUTOFF * Math.SQRT2) / 10);
  assert.equal(TREND_DIR_CUTOFF, 0.7);
  assert.equal(trendDir(0.7), 'up');
  assert.equal(trendDir(-0.7), 'down');
  assert.equal(trendDir(0.6), 'steady', 'a 0.6 week-over-week move is noise');
  assert.equal(trendDir(null), null);
  const r = recoveryFromInputs(inputs({ shift: 2 }));
  assert.equal(r.trendDir, trendDir(r.delta7));
  assert.equal(recoveryFromInputs({}).today, null, 'gated shape carries today: null');
  assert.equal(recoveryFromInputs({}).trendDir, null);
});

// HRV `perDay` samples every day; the asOf day gets `lastCount` samples of `lastValue`
function multiSample({ perDay = 6, lastCount = 2, lastValue = 95, rhrToday = false } = {}) {
  const inp = inputs({ shift: 0 });
  const hrv = [];
  for (const r of inp.hrv) {
    const k = r.date === AS_OF ? lastCount : perDay;
    // distinct values, centred so the day median stays put
    for (let j = 0; j < k; j++) hrv.push({ date: r.date, value: (r.date === AS_OF ? lastValue : r.value) + (j - (k - 1) / 2) * 0.1 });
  }
  const rhr = rhrToday ? inp.rhr : inp.rhr.filter((x) => x.date !== AS_OF);
  return { ...inp, hrv, rhr };
}

test('completeness: a partial newest day (few HRV samples vs the usual count) is not scored as last night', () => {
  const r = recoveryFromInputs(multiSample({ perDay: 6, lastCount: 2 }));
  assert.equal(r.today.date, addDays(AS_OF, -1), 'the latest COMPLETE day, labelled by its date');
  assert.notEqual(r.today.band, 'above', 'the partial high reading does not become the headline');
});

test('completeness: HRV needs >= max(3, half the usual daily count), plus resting HR', () => {
  assert.equal(recoveryFromInputs(multiSample({ perDay: 6, lastCount: 3, rhrToday: true })).today.date, AS_OF, '3 of a usual 6 is enough');
  assert.equal(recoveryFromInputs(multiSample({ perDay: 8, lastCount: 3, rhrToday: true })).today.date, addDays(AS_OF, -1), '3 of a usual 8 is not');
  const withRhr = recoveryFromInputs(multiSample({ perDay: 6, lastCount: 1, rhrToday: true }));
  assert.equal(withRhr.today.date, addDays(AS_OF, -1), 'resting HR without a complete HRV day is not last night');
});

test('completeness: when the usual count is 1-2 samples a day, a day at the usual count is complete', () => {
  assert.equal(recoveryFromInputs(multiSample({ perDay: 1, lastCount: 1, rhrToday: true })).today.date, AS_OF);
  assert.equal(recoveryFromInputs(multiSample({ perDay: 2, lastCount: 2, rhrToday: true })).today.date, AS_OF);
});

test('completeness: a day with a complete HRV day but NO resting HR falls back to the latest complete day', () => {
  const r = recoveryFromInputs(multiSample({ perDay: 6, lastCount: 6, lastValue: 60, rhrToday: false }));
  assert.equal(r.today.date, addDays(AS_OF, -1), 'labelled by its date');
  const both = recoveryFromInputs(multiSample({ perDay: 6, lastCount: 6, lastValue: 60, rhrToday: true }));
  assert.equal(both.today.date, AS_OF, 'HRV (enough samples) + resting HR: complete');
  // the partial day is not dropped from the trend: the asOf composite still exists
  const debug = {};
  recoveryFromInputs(multiSample({ perDay: 6, lastCount: 6, lastValue: 60, rhrToday: false }), { debug });
  assert.equal(debug.composite.at(-1).date, AS_OF);
});

/* ---- complete day: sleep + resting HR (+ HRV when the user has an HRV baseline), <= 2 days back ---- */
test('complete day needs a sleep-duration reading: HRV + resting HR without sleep falls back to the previous day', () => {
  const inp = inputs({ shift: 2 });
  const r = recoveryFromInputs({ ...inp, sleep: inp.sleep.slice(0, -1) });
  assert.equal(r.today.date, addDays(AS_OF, -1));
  assert.equal(r.today.sleep, true);
});

test('a user with no HRV series at all still gets a headline from sleep + resting HR', () => {
  const inp = inputs({ shift: 2 });
  const r = recoveryFromInputs({ ...inp, hrv: [] });
  assert.equal(r.gated, false);
  assert.equal(r.today.date, AS_OF);
  assert.ok(r.missing.includes('hrv'));
});

test('HRV too short for a baseline (not a scored component) does not block the headline', () => {
  const inp = inputs({ shift: 2 });
  const r = recoveryFromInputs({ ...inp, hrv: inp.hrv.slice(-5) });
  assert.equal(r.today.date, AS_OF);
});

test('the headline falls back at most 2 days; older complete days give today = null (trend shown)', () => {
  const inp = inputs({ shift: 2 });
  const upTo = (n) => (x) => x.date <= addDays(AS_OF, -n);
  const two = recoveryFromInputs({ ...inp, rhr: inp.rhr.filter(upTo(2)) });
  assert.equal(two.today.date, addDays(AS_OF, -2));
  const three = recoveryFromInputs({ ...inp, rhr: inp.rhr.filter(upTo(3)) });
  assert.equal(three.today, null);
  assert.equal(three.gated, false);
  assert.equal(typeof three.trend7, 'number');
});

test('completeDay counts only plausible samples (inside the clamp range)', () => {
  const rows = [];
  for (let i = 1; i <= 20; i++) for (let j = 0; j < 4; j++) rows.push({ date: addDays(AS_OF, -i), value: 50 + j });
  const day = (samples) => completeDay([...rows, ...samples.map((value) => ({ date: AS_OF, value }))], AS_OF)(AS_OF);
  assert.equal(day([50, 51, 52]), true, '3 plausible samples of a usual 4');
  assert.equal(day([50, 51, 230]), false, 'a 230 ms artefact is not a sample');
  assert.equal(day([50, 51, 1]), false, 'a 1 ms dropout is not a sample');
  assert.equal(day([50, 51, 51]), true, 'without a timestamp, equal values are distinct samples');
});

test('completeDay dedupes only rows that carry a timestamp (same date, t and value)', () => {
  const rows = [];
  for (let i = 1; i <= 20; i++) for (let j = 0; j < 4; j++) rows.push({ date: addDays(AS_OF, -i), t: `${j}`, value: 50 + j });
  const day = (samples) => completeDay([...rows, ...samples.map(([t, value]) => ({ date: AS_OF, t, value }))], AS_OF)(AS_OF);
  assert.equal(day([['a', 50], ['b', 51], ['b', 51]]), false, 'the same timestamped sample twice counts once');
  assert.equal(day([['a', 50], ['b', 51], ['c', 51]]), true, 'equal values at different times are distinct');
});

test('completeDay counts equal-valued samples from readSeries (which sets no timestamp)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrv-'));
  try {
    const lines = ['date,value,source'];
    for (let i = 1; i <= 20; i++) for (let j = 0; j < 4; j++) lines.push(`${addDays(AS_OF, -i)},${50 + j},Apple Watch`);
    for (const v of [48, 48, 48]) lines.push(`${AS_OF},${v},Apple Watch`);
    fs.writeFileSync(path.join(dir, 'hrv.csv'), lines.join('\n') + '\n');
    const rows = readSeries(dir, 'hrv.csv');
    assert.equal(rows[0].t, undefined, 'readSeries rows carry no timestamp');
    assert.equal(completeDay(rows, AS_OF)(AS_OF), true, '3 equal readings of a usual 4 are 3 samples');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('percentileRank: share of prior days with a lower composite, ties counted half, rounded to an integer', () => {
  const priors = Array.from({ length: 40 }, (_, i) => i / 10); // 0.0 .. 3.9
  assert.equal(percentileRank(10, priors), 100, 'above every prior day');
  assert.equal(percentileRank(-1, priors), 0, 'below every prior day');
  assert.equal(percentileRank(1.95, priors), 50, '20 of 40 lower');
  // 1.0 ties one day: (10 lower + 0.5) / 40 = 26.25 -> 26
  assert.equal(percentileRank(1.0, priors), 26);
  assert.equal(percentileRank(0.5, Array(30).fill(0.5)), 50, 'all ties = the middle');
  assert.equal(percentileRank(0, priors.concat([NaN, null])), 1, 'non-finite priors are ignored (0.5 / 40 -> 1)');
});

test('percentileRank: fewer than MIN_PCT_DAYS (21) prior days -> null (the SD fallback)', () => {
  assert.equal(MIN_PCT_DAYS, 21);
  assert.equal(percentileRank(1, Array.from({ length: 20 }, (_, i) => i)), null);
  assert.equal(percentileRank(1, Array.from({ length: 21 }, (_, i) => i)), 7, '1 lower + half a tie of 21 -> 7');
  assert.equal(percentileRank(null, Array(30).fill(0)), null);
});

test('pctBand: green >= 67, yellow 34-66, red <= 33', () => {
  assert.equal(PCT_GOOD, 67);
  assert.equal(PCT_LOW, 33);
  assert.deepEqual([100, 67, 66, 34, 33, 0].map(pctBand), ['good', 'good', 'mid', 'mid', 'low', 'low']);
  assert.equal(pctBand(null), null);
});

test('today.pct ranks the headline night within the previous 90 days of composites (same baseline)', () => {
  assert.equal(PCT_WINDOW_DAYS, 90);
  const inp = inputs({ n: 140, shift: 2 });
  const dbg = {};
  const r = recoveryFromInputs(inp, { debug: dbg });
  const t = r.today;
  const lo = addDays(t.date, -PCT_WINDOW_DAYS);
  const priors = dbg.composite.filter((c) => c.date >= lo && c.date < t.date).map((c) => c.value);
  assert.equal(priors.length, 90, 'exactly the 90 days before the night, none older');
  assert.equal(t.pctDays, 90);
  assert.equal(t.pct, percentileRank(dbg.composite.find((c) => c.date === t.date).value, priors));
  assert.equal(t.pctBand, pctBand(t.pct));
  assert.ok(t.pct >= PCT_GOOD, 'a clearly good final week ranks high');
  assert.ok(MAX_TODAY_FALLBACK_DAYS >= 0);
  const poor = recoveryFromInputs(inputs({ n: 140, shift: -2 })).today;
  assert.equal(poor.pctBand, 'low');
});

test('today.pct is null under 21 prior days: the SD value and day band stay the headline', () => {
  const r = recoveryFromInputs(inputs({ n: 21, shift: 0 }));
  assert.equal(r.gated, false);
  assert.equal(r.today.pct, null);
  assert.equal(r.today.pctBand, null);
  assert.equal(r.today.pctDays, 20);
  assert.ok(Number.isFinite(r.today.value) && ['above', 'at', 'below'].includes(r.today.band));
});

test('clientSource is a classic script whose HC_BAND.pctBand matches the module (same thresholds)', async () => {
  const { clientSource } = await import('./recovery.mjs');
  const vm = await import('node:vm');
  const src = clientSource();
  assert.doesNotMatch(src, /\bexport\b|\bimport\b/);
  const ctx = vm.createContext({ Number });
  vm.runInContext(src, ctx);
  const B = ctx.HC_BAND;
  assert.equal(B.PCT_GOOD, PCT_GOOD);
  assert.equal(B.PCT_LOW, PCT_LOW);
  for (const v of [100, 67, 66.9, 34, 33.5, 33, 0, null, NaN]) assert.equal(B.pctBand(v), pctBand(v), String(v));
});
