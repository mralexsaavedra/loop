/* lib/nutrition/adherence.mjs — food log adherence (the page runs these functions as HC_ADH, clientSource). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ADHERENCE, ADHERENCE_CASES, isComplete, dayState, adherence, clientSource } from './adherence.mjs';
import { MAIN_SLOTS } from './slots.mjs';

const day = (o) => ({ date: '2030-01-10', k: 2000, p: 140, c: 200, f: 60, n: 3, missing: { p: false, c: false, f: false }, groups: { breakfast: 1, lunch: 1, dinner: 1, addon: 0 }, ...o });

test('constants: the 7 / 14 / 28-day windows, a 28-day strip, the three main meals required', () => {
  assert.deepEqual(ADHERENCE.windows, [7, 14, 28]);
  assert.equal(ADHERENCE.stripDays, 28);
  assert.deepEqual(ADHERENCE.required, MAIN_SLOTS);
  assert.equal(ADHERENCE.onBand, 0.1);
  assert.equal(ADHERENCE.proteinShare, 0.9);
});

test('isComplete: at least one entry in each of breakfast, lunch and dinner (add-ons do not count)', () => {
  assert.equal(isComplete(day()), true);
  assert.equal(isComplete(day({ groups: { breakfast: 2, lunch: 1, dinner: 0, addon: 4 } })), false);
  assert.equal(isComplete(day({ groups: null })), false);
  assert.equal(isComplete(null), false);
});

test('dayState: none / partial / unknown / under / on / over (±10 % of the kcal target)', () => {
  const t = { k: 2500, p: 150 };
  assert.equal(dayState(null, t), 'none');
  assert.equal(dayState(day({ n: 0 }), t), 'none');
  assert.equal(dayState(day({ groups: { breakfast: 1, lunch: 0, dinner: 0, addon: 0 } }), t), 'partial');
  assert.equal(dayState(day(), null), 'unknown', 'complete, but the day type is unknown');
  assert.equal(dayState(day({ k: 2249 }), t), 'under');
  assert.equal(dayState(day({ k: 2250 }), t), 'on');
  assert.equal(dayState(day({ k: 2750 }), t), 'on');
  assert.equal(dayState(day({ k: 2751 }), t), 'over');
});

test('adherence: means and protein hits over complete days with a target only; minimums flagged, unknown protein never a hit', () => {
  const dates = ['2030-01-08', '2030-01-09', '2030-01-10'];
  const r = adherence(dates, [
    day({ date: '2030-01-08', k: 2400, p: 136 }),
    day({ date: '2030-01-09', k: 3000, p: null, missing: { p: true, c: false, f: false } }),
    day({ date: '2030-01-10', k: 600, groups: { breakfast: 1, lunch: 0, dinner: 0, addon: 0 } }),
  ], { '2030-01-08': { k: 2500, p: 150 }, '2030-01-09': { k: 2600, p: 150 }, '2030-01-10': { k: 2500, p: 150 } });
  assert.equal(r.logged, 3);
  assert.equal(r.complete, 2);
  assert.equal(r.compared, 2);
  assert.equal(r.meanK, 2700);
  assert.equal(r.meanTarget, 2550);
  assert.equal(r.proteinHit, 1, '136 >= 90 % of 150');
  assert.equal(r.proteinUnknown, 1);
  assert.deepEqual(r.states.map((s) => s.state), ['on', 'over', 'partial']);
});

test('adherence: no compared day -> null means (never 0)', () => {
  const r = adherence(['2030-01-10'], [day()], { '2030-01-10': null });
  assert.equal(r.unknown, 1);
  assert.equal(r.meanK, null);
  assert.equal(r.meanTarget, null);
});

test('ADHERENCE_CASES (shared with the page\'s HC_ADH test) agree with adherence', () => {
  assert.ok(ADHERENCE_CASES.length >= 2);
  for (const c of ADHERENCE_CASES) assert.deepEqual(adherence(c.dates, c.days, c.targets), c.expect, c.name);
});

test('clientSource is a classic script whose HC_ADH computes exactly what the module computes', () => {
  const src = clientSource();
  assert.doesNotMatch(src, /\bexport\b|\bimport\b/);
  assert.match(src, /^var HC_ADH = /);
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  const A = ctx.HC_ADH;
  assert.deepEqual(JSON.parse(JSON.stringify(A.ADHERENCE)), JSON.parse(JSON.stringify(ADHERENCE)));
  for (const c of ADHERENCE_CASES) assert.deepEqual(JSON.parse(JSON.stringify(A.adherence(c.dates, c.days, c.targets))), c.expect, c.name);
  const samples = [null, day({}), day({ groups: { breakfast: 1, lunch: 0, dinner: 1, addon: 0 } }), day({ n: 0 }), day({ k: null })];
  for (const d of samples) {
    assert.equal(A.isComplete(d), isComplete(d));
    for (const t of [null, { k: 2500, p: 150 }, { k: 1900, p: 150 }, { k: 2000, p: 150, inferred: true }]) assert.equal(A.dayState(d, t), dayState(d, t));
  }
});
