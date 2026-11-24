/* Tests for the Salud "Healthspan habits" bake (lib/score/healthspan.mjs): the last 28 full days of each
 * habit against its published reference (or the user's own baseline), never folded into an age. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthspanFrom, HABIT_REF, HABIT_DAYS } from './healthspan.mjs';
import { addDays } from '../date.mjs';

/** @typedef {NonNullable<ReturnType<typeof healthspanFrom>>} Healthspan */
/** @typedef {{[K in keyof Healthspan]: NonNullable<Healthspan[K]>}} Full */

const AS_OF = '2030-03-31'; // a partial day: the window is the 28 days before it
/** @template R @param {number} n @param {(date: string, i: number) => R} f @param {string} [end] @returns {R[]} */
const days = (n, f, end = addDays(AS_OF, -1)) => Array.from({ length: n }, (_, i) => f(addDays(end, -(n - 1 - i)), i));

test('the references are the cited ones: AASM/SRS ≥ 7 h, WHO 150–300 min moderate (vigorous counts double), WHO ≥ 2 strength days, Paluch steps by age', () => {
  assert.equal(HABIT_DAYS, 28);
  assert.deepEqual(HABIT_REF, {
    sleepH: 7, actMin: 150, actMax: 300, vigFactor: 2, strengthDays: 2,
    steps: { under60: [8000, 10000], from60: [6000, 8000] }, ageSplit: 60,
  });
});

test('sleep, steps: the mean of the 28 full days before asOf (asOf itself, still filling up, never counts); 14+ days needed', () => {
  const sleep = days(28, (date, i) => ({ date, value: i % 2 ? 8 : 6.5 })).concat([{ date: AS_OF, value: 1 }]);
  const steps = days(40, (date, i) => ({ date, value: i >= 12 ? 9000 : 1000 })).concat([{ date: AS_OF, value: 50 }]);
  const H = /** @type {Full} */ (healthspanFrom({ sleep, steps, asOf: AS_OF }));
  assert.deepEqual(H.sleep, { mean: 7.25, n: 28 });
  assert.deepEqual(H.steps, { mean: 9000, n: 28 }, 'only the 28-day window');
  assert.equal(H.from, addDays(AS_OF, -28));
  assert.equal(H.to, addDays(AS_OF, -1));
  assert.equal(healthspanFrom({ sleep: days(13, (date) => ({ date, value: 7 })), asOf: AS_OF }), null, 'under 14 nights: nothing');
});

test('activity: minutes per week in zones 2–3 (moderate) and 4–5 (vigorous) from the days with all-day heart rate, moderate-equivalent = moderate + 2 × vigorous', () => {
  // 20 days with data: zone 2 = 10 min, zone 4 = 3 min a day (zone 1 never counts)
  const zoneDays = days(20, (date) => ({ date, z: [300, 40, 10, 0, 3, 0] }));
  const A = /** @type {Full} */ (healthspanFrom({ zoneDays, asOf: AS_OF })).activity;
  assert.deepEqual(A, { mod: 70, vig: 21, eq: 112, n: 20 }, '10 × 7 = 70, 3 × 7 = 21, 70 + 42 = 112 per week');
});

test('strength: gym days in the window per week (several sessions on one day count once); no gym session in the 90 days before: no row', () => {
  /** @param {string} date @param {string} type */
  const w = (date, type) => ({ date, type, dur: 40 });
  const workouts = [w(addDays(AS_OF, -2), 'TraditionalStrengthTraining'), w(addDays(AS_OF, -2), 'HighIntensityIntervalTraining'),
    w(addDays(AS_OF, -9), 'FunctionalStrengthTraining'), w(addDays(AS_OF, -16), 'Other'), w(addDays(AS_OF, -20), 'Running'),
    w(addDays(AS_OF, -40), 'TraditionalStrengthTraining'), w(AS_OF, 'TraditionalStrengthTraining')];
  assert.deepEqual(/** @type {Full} */ (healthspanFrom({ workouts, asOf: AS_OF })).strength, { days: 3, perWeek: 0.75 });
  assert.deepEqual(/** @type {Full} */ (healthspanFrom({ workouts: [w(addDays(AS_OF, -60), 'TraditionalStrengthTraining'), w(addDays(AS_OF, -3), 'Running')], asOf: AS_OF })).strength, { days: 0, perWeek: 0 }, 'a gym user who skipped the month: 0');
  assert.equal(/** @type {Full} */ (healthspanFrom({ workouts: [w(addDays(AS_OF, -3), 'Running')], sleep: days(28, (date) => ({ date, value: 7 })), asOf: AS_OF })).strength, null);
});

test('resting HR and sleep regularity: the 28-day mean vs the mean of the 84 days before it (28+ days); lower is better for both', () => {
  const rhr = days(112, (date, i) => ({ date, value: i >= 84 ? 50 : 54 }));
  const cons = days(112, (date, i) => ({ date, value: i >= 84 ? 20 : 30 }));
  const H = /** @type {Full} */ (healthspanFrom({ rhr, cons, asOf: AS_OF }));
  assert.deepEqual(H.rhr, { now: 50, base: 54, n: 28 });
  assert.deepEqual(H.cons, { now: 20, base: 30, n: 28 });
  assert.equal(/** @type {Full} */ (healthspanFrom({ rhr: days(40, (date) => ({ date, value: 50 })), asOf: AS_OF })).rhr.base, null, 'under 28 baseline days: no baseline');
});

test('no input at all, or no asOf: null', () => {
  assert.equal(healthspanFrom({ asOf: AS_OF }), null);
  assert.equal(healthspanFrom({ sleep: days(28, (date) => ({ date, value: 7 })) }), null);
});
