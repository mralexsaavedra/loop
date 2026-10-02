/* lib/nutrition/progress.mjs — weight progress vs the goal (the reference web/src/client/progress.js
 * ports; the client parity test runs both over PROGRESS_CASES). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROGRESS, PROGRESS_CASES, rollPoints, weeklyRate, weightProgress, etaMonths } from './progress.mjs';

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

test('constants: the safe-rate band and the 1 %/week ceiling come from analysis/methodology.md', () => {
  assert.equal(PROGRESS.paceMin, 0.25);
  assert.equal(PROGRESS.paceMax, 0.5);
  assert.equal(PROGRESS.maxPctWeek, 1);
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
  assert.deepEqual(p.etaWeeks, [6, 12]);
  assert.equal(p.mismatch, false);
});

test('weightProgress: slower, too fast (over 0.5 kg/week or 1 % of bodyweight), wrong way', () => {
  const at = (perWeek, goal, start = 80) => weightProgress(metric('2030-01-01', 41, (i) => start + (perWeek / 7) * i), { goal, target: null });
  assert.equal(at(-0.15, 'cut').status, 'slow');
  assert.equal(at(-0.05, 'cut').status, 'slow', 'flat counts as slower, not as the wrong way');
  assert.equal(at(-0.7, 'cut').status, 'fast');
  assert.equal(at(0.3, 'cut').status, 'wrong');
  assert.equal(at(0.3, 'bulk').status, 'onPace');
  assert.equal(at(-0.3, 'bulk').status, 'wrong');
  // 1 % of 45 kg = 0.45 kg/week: 0.48 is inside the band but over 1 % of this bodyweight
  assert.equal(at(-0.48, 'cut', 46).status, 'fast');
  const fast = at(-0.7, 'cut');
  assert.equal(fast.etaWeeks, null, 'no ETA unless on pace');
});

test('weightProgress: maintain = steady within ±0.25 kg/week, else drifting, else too fast', () => {
  const at = (perWeek) => weightProgress(metric('2030-01-01', 41, (i) => 80 + (perWeek / 7) * i), { goal: 'maintain', target: null });
  assert.equal(at(0.1).status, 'steady');
  assert.equal(at(-0.3).status, 'drift');
  assert.equal(at(0.9).status, 'fast');
  assert.equal(at(0.1).etaWeeks, null);
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

test('PROGRESS_CASES (shared with the client parity test) agree with weightProgress', () => {
  assert.ok(PROGRESS_CASES.length >= 6);
  for (const c of PROGRESS_CASES) assert.deepEqual(weightProgress(c.metric, c.opts), c.expect, c.name);
});
