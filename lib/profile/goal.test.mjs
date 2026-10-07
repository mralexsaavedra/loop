/* lib/profile/goal.mjs — the profile sheet's "Goal" setting: one option per goal with its kcal/day
 * change vs maintain, derived from the resolved targets (never typed). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalOptions } from './goal.mjs';
import { resolveTargets } from '../nutrition/targets.mjs';

test('default targets: maintain 0, cut ~-350 on rest/gym with bike days untouched, bulk ~+300 on every day', () => {
  assert.deepEqual(goalOptions(resolveTargets({})), [
    { goal: 'maintain', kcal: 0, bikeKept: false },
    { goal: 'cut', kcal: -350, bikeKept: true },
    { goal: 'bulk', kcal: 300, bikeKept: false },
  ]);
});

test('the change is the mean over rest and gym days, rounded to 10 kcal; bike days count only for bikeKept', () => {
  const plan = { targets: { byGoal: {
    cut: { rest: { kcal: 2000, p: 160, f: 55 }, gym: { kcal: 2360, p: 160, f: 55 }, bike: { kcal: 3050, p: 160, f: 55 } },
  } } };
  const cut = goalOptions(resolveTargets(plan)).find((o) => o.goal === 'cut');
  assert.deepEqual(cut, { goal: 'cut', kcal: -320, bikeKept: false });
});

test('missing or broken targets give no options (the sheet then hides the setting)', () => {
  assert.deepEqual(goalOptions(null), []);
  assert.deepEqual(goalOptions({ cut: {} }), []);
});
