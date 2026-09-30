/* lib/nutrition/targets.mjs — day types, goals and the (goal × day type) targets. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_TYPES, GOALS, BASE_DAY, DEFAULT_BY_GOAL, carbsOf, resolveTargets, validateTargets, resolveGoal,
} from './targets.mjs';

test('four day types, three goals, each day type maps to a base day plan', () => {
  assert.deepEqual(DAY_TYPES, ['rest', 'gym', 'bike', 'bikeLong']);
  assert.deepEqual(GOALS, ['maintain', 'cut', 'bulk']);
  assert.deepEqual(BASE_DAY, { rest: 'rest', gym: 'train', bike: 'train', bikeLong: 'train' });
});

test('the default targets are the owner-approved seed numbers', () => {
  assert.deepEqual(DEFAULT_BY_GOAL.maintain, {
    rest: { kcal: 2500, p: 150, f: 60 }, gym: { kcal: 3050, p: 150, f: 60 },
    bike: { kcal: 3550, p: 150, f: 60 }, bikeLong: { kcal: 4200, p: 150, f: 60 },
  });
  assert.deepEqual(DEFAULT_BY_GOAL.cut, {
    rest: { kcal: 2150, p: 160, f: 55 }, gym: { kcal: 2700, p: 160, f: 55 },
    bike: { kcal: 3550, p: 160, f: 55 }, bikeLong: { kcal: 4200, p: 160, f: 55 },
  });
  assert.deepEqual(DEFAULT_BY_GOAL.bulk, {
    rest: { kcal: 2800, p: 150, f: 70 }, gym: { kcal: 3350, p: 150, f: 70 },
    bike: { kcal: 3850, p: 150, f: 70 }, bikeLong: { kcal: 4500, p: 150, f: 70 },
  });
});

test('carbs are the remainder: (kcal - 4p - 9f) / 4, rounded', () => {
  assert.equal(carbsOf({ kcal: 2500, p: 150, f: 60 }), 340);
  assert.equal(carbsOf({ kcal: 2150, p: 160, f: 55 }), 254); // 1015 / 4 = 253.75
});

test('resolveTargets: a plan without targets.byGoal gets every default cell, carbs computed', () => {
  const t = resolveTargets({});
  for (const g of GOALS) for (const d of DAY_TYPES) {
    const cell = t[g][d];
    assert.deepEqual({ kcal: cell.kcal, p: cell.p, f: cell.f }, DEFAULT_BY_GOAL[g][d]);
    assert.equal(cell.c, carbsOf(cell));
  }
});

test('resolveTargets: a partial byGoal overrides only its cells', () => {
  const t = resolveTargets({ targets: { byGoal: { cut: { rest: { kcal: 2000, p: 170, f: 50 } } } } });
  assert.deepEqual(t.cut.rest, { kcal: 2000, p: 170, f: 50, c: 218 });
  assert.equal(t.cut.gym.kcal, 2700);
  assert.equal(t.maintain.rest.kcal, 2500);
});

test('validateTargets: a valid or absent block has no errors', () => {
  assert.deepEqual(validateTargets({}), []);
  assert.deepEqual(validateTargets({ targets: { train: { p: 150 } } }), []);
  assert.deepEqual(validateTargets({ targets: { byGoal: DEFAULT_BY_GOAL }, page: { goal: 'cut' } }), []);
});

test('validateTargets: unknown goal / day type, bad numbers, negative carbs, bad page.goal are errors', () => {
  const errs = validateTargets({
    targets: { byGoal: { recomp: {}, cut: { tempo: {}, rest: { kcal: -1, p: 150, f: 60 }, gym: { kcal: 1000, p: 200, f: 60 } } } },
    page: { goal: 'shred' },
  });
  const all = errs.join('\n');
  assert.match(all, /byGoal\.recomp: unknown goal/);
  assert.match(all, /byGoal\.cut\.tempo: unknown day type/);
  assert.match(all, /byGoal\.cut\.rest\.kcal/);
  assert.match(all, /byGoal\.cut\.gym: .*carbs/);
  assert.match(all, /page\.goal/);
  assert.equal(validateTargets({ targets: { byGoal: [] } }).length, 1);
});

test('resolveGoal: page.goal when valid, else maintain', () => {
  assert.equal(resolveGoal({}), 'maintain');
  assert.equal(resolveGoal({ page: { goal: 'bulk' } }), 'bulk');
  assert.equal(resolveGoal({ page: { goal: 'nope' } }), 'maintain');
});
