/* lib/profile/goal.mjs — the profile sheet's "Goal" setting: one option per goal with its kcal/day
 * change vs maintain, derived from the resolved targets (never typed). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalOptions } from './goal.mjs';
import { resolveTargets } from '../nutrition/targets.mjs';

test('default targets: maintain 0, cut ~-350 on rest and the short days with bike days untouched, bulk ~+300 on every day', () => {
  assert.deepEqual(goalOptions(resolveTargets({})), [
    { goal: 'maintain', kcal: 0, bikeKept: false },
    { goal: 'cut', kcal: -350, bikeKept: true },
    { goal: 'bulk', kcal: 300, bikeKept: false },
  ]);
});

test('the change is the mean over rest and the short day types (gym, hybrid, indoor, run), rounded to 10 kcal; bike days count only for bikeKept', () => {
  const c = (/** @type {number} */ kcal) => ({ kcal, p: 160, f: 55 });
  const plan = { targets: { byGoal: {
    // vs the default maintain: rest -300, gym / hybrid / indoor / run -340 each -> mean -332
    cut: { rest: c(2000), gym: c(2360), hybrid: c(2610), indoor: c(2660), run: c(2660), bike: c(3050) },
  } } };
  const cut = goalOptions(resolveTargets(plan)).find((o) => o.goal === 'cut');
  assert.deepEqual(cut, { goal: 'cut', kcal: -330, bikeKept: false });
});

test('an old plan (rest / gym / bike / bikeLong only, in every goal): the new day types copy its gym cells, so they weigh like its gym day', () => {
  const c = (/** @type {number} */ kcal) => ({ kcal, p: 160, f: 55 });
  const plan = { targets: { byGoal: {
    maintain: { rest: c(2300), gym: c(2700), bike: c(3100), bikeLong: c(3600) },
    cut: { rest: c(2000), gym: c(2360), bike: c(3100), bikeLong: c(3600) },
  } } };
  // rest -300, gym and its three copies -340: (-300 - 4 x 340) / 5 = -332 -> -330
  assert.deepEqual(goalOptions(resolveTargets(plan)).find((o) => o.goal === 'cut'), { goal: 'cut', kcal: -330, bikeKept: true });
});

test('missing or broken targets give no options (the sheet then hides the setting)', () => {
  assert.deepEqual(goalOptions(null), []);
  assert.deepEqual(goalOptions({ cut: {} }), []);
});

test('goalOptions(targets, allowed): only the goals the onboarding safety screen allowed (default: all three)', () => {
  const t = resolveTargets({});
  assert.deepEqual(goalOptions(t, ['maintain']).map((o) => o.goal), ['maintain']);
  assert.deepEqual(goalOptions(t, ['maintain', 'bulk']).map((o) => o.goal), ['maintain', 'bulk']);
  assert.deepEqual(goalOptions(t).map((o) => o.goal), ['maintain', 'cut', 'bulk']);
});
