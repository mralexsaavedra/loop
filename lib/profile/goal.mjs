/* The profile sheet's "Goal" setting (web/src/client/profile.js): one option per goal with its kcal/day
 * change vs maintain, so each radio can say what it does ("gentle deficit, ~-320 kcal/day, bike days
 * untouched"). Derived from the resolved targets (lib/nutrition/targets.mjs resolveTargets), never typed:
 *   kcal     = mean (goal - maintain) over rest and the short day types (gym, hybrid, indoor, run), rounded to 10 kcal;
 *   bikeKept = the bike and bikeLong targets equal maintain's (a cut that spares ride days).
 * The chosen goal itself lives in the viewer's localStorage (client/nutri-day.ts, hc.nutri.goal, falling
 * back to page.goal); nothing here is time-based. Pure: no I/O. */
import { GOALS } from '../nutrition/targets.mjs';

const EVERYDAY = ['rest', 'gym', 'hybrid', 'indoor', 'run'];
const RIDE = ['bike', 'bikeLong'];
/** Resolved targets by goal and day type (lib/nutrition/targets.mjs resolveTargets); only `kcal` is read here.
 * @typedef {Record<string, Record<string, {kcal?: unknown} | undefined> | undefined>} GoalTargets */
/** @typedef {{goal: string, kcal: number, bikeKept: boolean}} GoalOption */

/** `targets` is `object`: resolveTargets is still typed `{}`, which an index-signature type does not accept.
 * @param {object | null | undefined} targets @param {string} g @param {string} d @returns {number | null} */
const kcalOf = (targets, g, d) => {
  const t = /** @type {GoalTargets | null | undefined} */ (targets);
  const v = t && t[g] && t[g][d] && t[g][d].kcal;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** [{goal, kcal, bikeKept}] in GOALS order; [] when any needed target is missing.
 * @param {object | null | undefined} targets resolved targets by goal and day type (GoalTargets)
 * @param {readonly string[]} [allowed]
 * @returns {GoalOption[]} */
export function goalOptions(targets, allowed = GOALS) {
  const all = [...EVERYDAY, ...RIDE];
  if (GOALS.some((g) => all.some((d) => kcalOf(targets, g, d) == null))) return [];
  return GOALS.filter((g) => allowed.includes(g)).map((g) => {
    // every kcalOf is a number here: the guard above returned [] on any missing one
    const diffs = (/** @type {string[]} */ days) => days.map((d) => /** @type {number} */ (kcalOf(targets, g, d)) - /** @type {number} */ (kcalOf(targets, 'maintain', d)));
    const every = diffs(EVERYDAY);
    const kcal = Math.round(every.reduce((a, b) => a + b, 0) / every.length / 10) * 10 || 0;
    const bikeKept = g !== 'maintain' && diffs(RIDE).every((x) => x === 0);
    return { goal: g, kcal, bikeKept };
  });
}
