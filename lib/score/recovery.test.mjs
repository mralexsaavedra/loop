import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dailyRobust, winsorize, robustBaseline, composite, trend7, recoveryBand, recoveryFromInputs, buildRecovery2, measureSigma, trendDir, dayBand,
  DAY_BAND_CUTOFF, TREND_DIR_CUTOFF, MEASURED_SIGMA, Z_CLAMP,
  WEIGHTS, BAND_CUTOFF,
} from './recovery.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
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

test('no sleep today: sleep is listed missing, confidence is lower, the trend is still computed', () => {
  const full = recoveryFromInputs(inputs({ shift: 2 }));
  const noToday = recoveryFromInputs(inputs({ shift: 2, sleepUntil: 48 }));
  assert.equal(noToday.gated, false);
  assert.ok(noToday.missing.includes('sleepDur') && noToday.missing.includes('sleepCons'));
  assert.ok(noToday.confidence.weight < full.confidence.weight);
  assert.notEqual(noToday.confidence.level, 'high');
  assert.equal(typeof noToday.trend7, 'number');
});

test('sleep consistency wraps bedtimes past midnight (wrapNight): 00:30 vs a 23:00 habit is 90 min, not ~22 h', () => {
  const base = inputs();
  const sleep = base.sleep.map((s, i, a) => (i === a.length - 1 ? { ...s, bedtime: 0.5, waketime: 7 } : { ...s, bedtime: 23, waketime: 7 }));
  const r = recoveryFromInputs({ ...base, sleep });
  const cons = r.components.find((c) => c.key === 'sleepCons');
  assert.equal(cons.daily[13].value, 45, '(|90| + |0|) / 2 minutes');
});

test('no 0-100 score anywhere in the output: no score-ish key, trend7 stays in MAD units', () => {
  const r = recoveryFromInputs(inputs({ shift: 2 }));
  const keys = [];
  (function walk(o) { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); } })(r);
  assert.equal(keys.some((k) => /score|grade|pct100/i.test(k)), false);
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

test('buildRecovery2 reads hrv.csv, rhr.csv and sleep-daily.csv; null when nothing exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-rec-'));
  try {
    assert.equal(buildRecovery2(dir), null);
    assert.equal(buildRecovery2(null), null);
    const inp = inputs({ shift: 2 });
    fs.writeFileSync(path.join(dir, 'hrv.csv'), 'date,value,source\n' + inp.hrv.map((r) => `${r.date},${r.value},Watch`).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'rhr.csv'), 'date,value,source\n' + inp.rhr.map((r) => `${r.date},${r.value},Watch`).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'sleep-daily.csv'), 'date,asleep_hours,source,bedtime,waketime\n' + inp.sleep.map((r) => `${r.date},${r.value},Watch,${r.bedtime},${r.waketime}`).join('\n') + '\n');
    const r = buildRecovery2(dir);
    assert.equal(r.gated, false);
    assert.equal(r.band, 'above');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the optional debug argument exposes the daily composite series without changing the output', () => {
  const inp = inputs({ shift: 2 });
  const dbg = {};
  assert.deepEqual(recoveryFromInputs(inp, { debug: dbg }), recoveryFromInputs(inp));
  assert.ok(Array.isArray(dbg.composite) && dbg.composite.length >= 14);
  assert.equal(dbg.composite.length, 20, 'default history = 14 sparkline days + 6 for the first 7-day window');
  assert.equal(dbg.composite[dbg.composite.length - 1].date, AS_OF);
  assert.ok(dbg.composite.every((r) => Number.isFinite(r.value)));
});

test('historyDays exposes the full composite series (parameterised window) without changing the output', () => {
  const inp = inputs({ n: 120, shift: 0 });
  const dbg = {};
  const withHistory = recoveryFromInputs(inp, { debug: dbg, historyDays: 90 });
  assert.deepEqual(withHistory, recoveryFromInputs(inp));
  assert.equal(dbg.composite.length, 90);
  assert.equal(dbg.composite[0].date, addDays(AS_OF, -89));
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
  assert.deepEqual(r.today, { date: AS_OF, value: Math.round(last.value * 100) / 100, band: dayBand(last.value), sleep: true });
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

test('today: HRV alone (0.40 of the weight) is below MIN_WEIGHT -> not that day; HRV + resting HR (0.65) is enough', () => {
  const inp = inputs({ shift: 2 });
  const hrvOnly = recoveryFromInputs({ ...inp, rhr: inp.rhr.slice(0, -1), sleep: inp.sleep.slice(0, -1) });
  assert.equal(hrvOnly.today.date, addDays(AS_OF, -1));
  const noSleep = recoveryFromInputs({ ...inp, sleep: inp.sleep.slice(0, -1) });
  assert.equal(noSleep.today.date, AS_OF);
  assert.equal(noSleep.today.sleep, false, 'flags that the night has no sleep-duration reading');
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
    for (let j = 0; j < k; j++) hrv.push({ date: r.date, value: r.date === AS_OF ? lastValue : r.value + (j % 3) - 1 });
  }
  const rhr = rhrToday ? inp.rhr : inp.rhr.filter((x) => x.date !== AS_OF);
  return { ...inp, hrv, rhr };
}

test('completeness: a partial newest day (few HRV samples vs the usual count) is not scored as last night', () => {
  const r = recoveryFromInputs(multiSample({ perDay: 6, lastCount: 2 }));
  assert.equal(r.today.date, addDays(AS_OF, -1), 'the latest COMPLETE day, labelled by its date');
  assert.notEqual(r.today.band, 'above', 'the partial high reading does not become the headline');
});

test('completeness: HRV needs >= max(3, half the usual daily count); resting HR still makes a day scorable', () => {
  assert.equal(recoveryFromInputs(multiSample({ perDay: 6, lastCount: 3 })).today.date, AS_OF, '3 of a usual 6 is enough');
  assert.equal(recoveryFromInputs(multiSample({ perDay: 8, lastCount: 3 })).today.date, addDays(AS_OF, -1), '3 of a usual 8 is not');
  const withRhr = recoveryFromInputs(multiSample({ perDay: 6, lastCount: 1, rhrToday: true }));
  assert.equal(withRhr.today.date, AS_OF, 'resting HR + sleep carry the day; the partial HRV is left out of it');
  assert.ok(withRhr.missing.includes('hrv'), 'and HRV is listed missing for that day');
});

test('completeness: when the usual count is 1-2 samples a day, a day at the usual count is complete', () => {
  assert.equal(recoveryFromInputs(multiSample({ perDay: 1, lastCount: 1 })).today.date, AS_OF);
  assert.equal(recoveryFromInputs(multiSample({ perDay: 2, lastCount: 2 })).today.date, AS_OF);
});
