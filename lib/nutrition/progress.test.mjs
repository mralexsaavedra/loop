/* lib/nutrition/progress.mjs — weight progress vs the goal (the page runs these functions as HC_PROG,
 * clientSource; a test runs HC_PROG over PROGRESS_CASES against the module). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { PROGRESS, PROGRESS_CASES, DAYS_PER_WEEK, rollPoints, weeklyRate, weightProgress, etaMonths, clientSource } from './progress.mjs';

// a dense weight metric like DETAIL.metrics.weight: start + one slot per day, roll only on reading days
function metric(start, days, kgAt, every = 1) {
  const v = [], roll = [];
  for (let i = 0; i < days; i++) {
    const on = i % every === 0 || i === days - 1;
    v.push(on ? kgAt(i) : null);
    roll.push(on ? kgAt(i) : null);
  }
  return { kind: 'sparse', dec: 1, start, v, roll };
}

test('constants: per-goal bands and the 1 %/week ceiling come from analysis/methodology.md', () => {
  assert.deepEqual(PROGRESS.bands, { cut: { min: 0.25, max: 0.5 }, bulk: { min: 0.1, max: 0.25 } }, 'fat loss 0.25–0.5, muscle gain 0.1–0.25 kg/week');
  assert.equal(PROGRESS.stableKg, 0.1, 'maintain: within ±0.1 kg/week');
  assert.equal(PROGRESS.maxPctWeek, 1);
  assert.equal(PROGRESS.etaSpread, 0.2);
  assert.equal(DAYS_PER_WEEK, 7);
  assert.equal(PROGRESS.daysPerWeek, DAYS_PER_WEEK);
  assert.equal(PROGRESS.windowDays, 28);
  assert.ok(PROGRESS.minReadings >= 6);
  assert.ok(PROGRESS.minSpanDays >= 14 && PROGRESS.minSpanDays < PROGRESS.windowDays);
});

test('rollPoints: only days with a 7-day average, in date order', () => {
  const pts = rollPoints({ start: '2030-01-01', v: [80, null, 79.6], roll: [80, null, 79.8] });
  assert.deepEqual(pts, [{ date: '2030-01-01', kg: 80 }, { date: '2030-01-03', kg: 79.8 }]);
  assert.deepEqual(rollPoints(null), []);
  assert.deepEqual(rollPoints({ start: 'x', roll: [1] }), []);
});

test('weeklyRate: least-squares slope of the 7-day average over the last 28 days, in kg/week', () => {
  const m = metric('2030-01-01', 40, (i) => 80 - (0.35 / 7) * i);
  const r = weeklyRate(rollPoints(m));
  assert.equal(r.n, 28);
  assert.equal(r.span, 27);
  assert.equal(r.from, '2030-01-13');
  assert.ok(Math.abs(r.rate + 0.35) < 1e-9, String(r.rate));
});

test('weeklyRate, hand-computed: 8 weigh-ins 3 days apart, 80.0 -> 79.0 kg = -59/180 kg/week', () => {
  // x = 0, 3, …, 21 (mean 10.5); y = 80, 79.9, 79.7, 79.6, 79.5, 79.3, 79.2, 79.0
  // Sxy = -17.7, Sxx = 378 -> slope -0.046825… kg/day x 7 = -0.32777… kg/week
  const ys = [80, 79.9, 79.7, 79.6, 79.5, 79.3, 79.2, 79.0];
  const roll = new Array(22).fill(null);
  ys.forEach((y, i) => { roll[i * 3] = y; });
  const m = { start: '2030-01-01', v: roll.slice(), roll };
  const r = weeklyRate(rollPoints(m));
  assert.equal(r.n, 8);
  assert.equal(r.span, 21);
  assert.ok(Math.abs(r.rate - -59 / 180) < 1e-12, String(r.rate));
  // ETA, hand-computed: 3 kg to go at the shown rate 0.33 kg/week = 9.09 weeks, ±20 % -> 7.3 … 10.9 weeks
  const p = weightProgress(m, { goal: 'cut', target: 76 });
  assert.equal(p.rate, -0.33);
  assert.equal(p.status, 'onPace');
  assert.deepEqual(p.etaWeeks, [7.3, 10.9]);
  // from 2030-01-22: +52 days = 2030-03-15, +77 days = 2030-04-09
  assert.deepEqual(etaMonths('2030-01-22', p.etaWeeks), ['2030-03-01', '2030-04-01']);
});

test('weeklyRate: too few readings or too short a span -> rate null ("few data")', () => {
  const sparse = metric('2030-01-01', 28, (i) => 80 - i * 0.05, 5); // 7 readings
  assert.equal(weeklyRate(rollPoints(sparse)).rate, null);
  const short = metric('2030-01-01', 12, (i) => 80 - i * 0.05); // 12 readings over 11 days
  assert.equal(weeklyRate(rollPoints(short)).rate, null);
  assert.equal(weeklyRate([]).rate, null);
});

test('weightProgress: cut at -0.35 kg/week with a target below = on pace, remaining and ETA weeks', () => {
  const m = metric('2030-01-01', 41, (i) => 80 - (0.35 / 7) * i);
  const p = weightProgress(m, { goal: 'cut', target: 75 });
  assert.equal(p.status, 'onPace');
  assert.deepEqual(p.current, { date: '2030-02-10', kg: 78 });
  assert.equal(p.rate, -0.35);
  assert.equal(p.remaining, -3);
  assert.deepEqual(p.etaWeeks, [6.9, 10.3], '3 kg ÷ 0.35 kg/week = 8.57 weeks, ±20 %');
  assert.equal(p.mismatch, false);
});

test('weightProgress: slower, too fast (over 0.5 kg/week or 1 % of bodyweight), wrong way', () => {
  const at = (perWeek, goal, start = 80) => weightProgress(metric('2030-01-01', 41, (i) => start + (perWeek / 7) * i), { goal, target: null });
  assert.equal(at(-0.15, 'cut').status, 'slow');
  assert.equal(at(-0.05, 'cut').status, 'slow', 'flat counts as slower, not as the wrong way');
  assert.equal(at(-0.7, 'cut').status, 'fast');
  assert.equal(at(0.3, 'cut').status, 'wrong');
  assert.equal(at(0.3, 'bulk').status, 'fast', 'muscle gain above 0.25 kg/week is mostly fat');
  assert.equal(at(0.2, 'bulk').status, 'onPace');
  assert.equal(at(0.05, 'bulk').status, 'slow');
  assert.equal(at(-0.3, 'bulk').status, 'wrong');
  // 1 % of 45 kg = 0.45 kg/week: 0.48 is inside the band but over 1 % of this bodyweight
  assert.equal(at(-0.48, 'cut', 46).status, 'fast');
  const fast = at(-0.7, 'cut');
  assert.equal(fast.etaWeeks, null, 'no ETA unless on pace');
});

test('weightProgress: maintain = steady within ±0.1 kg/week, else drifting (the sign of the rate says up / down)', () => {
  const at = (perWeek) => weightProgress(metric('2030-01-01', 41, (i) => 80 + (perWeek / 7) * i), { goal: 'maintain', target: null });
  assert.equal(at(0.07).status, 'steady');
  assert.equal(at(-0.07).status, 'steady');
  assert.equal(at(-0.3).status, 'drift');
  assert.ok(at(-0.3).rate < 0);
  assert.equal(at(0.9).status, 'drift');
  assert.equal(at(0.07).etaWeeks, null);
});

test('weightProgress: a target already reached, or on the other side of the goal', () => {
  const m = metric('2030-01-01', 41, (i) => 80 - (0.35 / 7) * i); // ends at 78 on 2030-02-10
  assert.equal(weightProgress(m, { goal: 'cut', target: 78.3 }).status, 'reached');
  const other = weightProgress(m, { goal: 'cut', target: 82 });
  assert.equal(other.mismatch, true);
  assert.equal(other.status, 'onPace');
  assert.equal(other.etaWeeks, null, 'no ETA towards a target the goal moves away from');
});

test('weightProgress: no readings -> null; few readings -> fewData with the current average', () => {
  assert.equal(weightProgress(null, { goal: 'cut' }), null);
  assert.equal(weightProgress({ start: '2030-01-01', v: [null], roll: [null] }, { goal: 'cut' }), null);
  const p = weightProgress(metric('2030-01-01', 10, () => 80), { goal: 'cut', target: 75 });
  assert.equal(p.status, 'fewData');
  assert.equal(p.rate, null);
  assert.equal(p.remaining, -5);
  assert.equal(p.etaWeeks, null);
});

test('etaMonths: the ETA weeks from the viewer\'s today as the first day of each month', () => {
  assert.deepEqual(etaMonths('2030-02-09', [6, 12]), ['2030-03-01', '2030-05-01']);
  assert.deepEqual(etaMonths('2030-02-09', [0.5, 1]), ['2030-02-01', '2030-02-01']);
  assert.equal(etaMonths('2030-02-09', null), null);
  assert.equal(etaMonths('bad', [1, 2]), null);
});

test('PROGRESS_CASES (shared with the page\'s HC_PROG test) agree with weightProgress', () => {
  assert.ok(PROGRESS_CASES.length >= 6);
  for (const c of PROGRESS_CASES) assert.deepEqual(weightProgress(c.metric, c.opts), c.expect, c.name);
});

test('clientSource is a classic script whose HC_PROG computes exactly what the module computes', () => {
  const src = clientSource();
  assert.doesNotMatch(src, /\bexport\b|\bimport\b/);
  assert.match(src, /^var HC_PROG = /);
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  const P = ctx.HC_PROG;
  const js = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(js(P.PROGRESS), js(PROGRESS));
  for (const c of PROGRESS_CASES) {
    assert.deepEqual(js(P.weightProgress(c.metric, c.opts)), c.expect, c.name);
    assert.deepEqual(js(P.rollPoints(c.metric)), rollPoints(c.metric), 'rollPoints ' + c.name);
    assert.deepEqual(js(P.weeklyRate(rollPoints(c.metric))), weeklyRate(rollPoints(c.metric)), 'weeklyRate ' + c.name);
  }
  for (const [d, w] of [['2030-02-10', [6, 12]], ['2030-12-20', [1.5, 3]], ['2030-02-10', null], ['x', [1, 2]]]) {
    assert.deepEqual(js(P.etaMonths(d, w)), etaMonths(d, w), d);
  }
  assert.deepEqual(js(P.rollPoints({ start: 'bad', roll: [1] })), []);
});
