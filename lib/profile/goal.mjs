/* The profile sheet's "Goal" setting (web/src/client/profile.js): one option per goal with its kcal/day
 * change vs maintain, so each radio can say what it does ("gentle deficit, ~-320 kcal/day, bike days
 * untouched"). Derived from the resolved targets (lib/nutrition/targets.mjs resolveTargets), never typed:
 *   kcal     = mean (goal - maintain) over the rest and gym day types, rounded to 10 kcal;
 *   bikeKept = the bike and bikeLong targets equal maintain's (a cut that spares ride days).
 * The chosen goal itself lives in the viewer's localStorage (client/nutri-day.js, hc.nutri.goal, falling
 * back to page.goal); nothing here is time-based. Pure: no I/O. */
import { GOALS } from '../nutrition/targets.mjs';

const EVERYDAY = ['rest', 'gym'];
const RIDE = ['bike', 'bikeLong'];
const kcalOf = (targets, g, d) => {
  const v = targets && targets[g] && targets[g][d] && targets[g][d].kcal;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** [{goal, kcal, bikeKept}] in GOALS order; [] when any needed target is missing. */
export function goalOptions(targets, allowed = GOALS) {
  const all = [...EVERYDAY, ...RIDE];
  if (GOALS.some((g) => all.some((d) => kcalOf(targets, g, d) == null))) return [];
  return GOALS.filter((g) => allowed.includes(g)).map((g) => {
    const diffs = (days) => days.map((d) => kcalOf(targets, g, d) - kcalOf(targets, 'maintain', d));
    const every = diffs(EVERYDAY);
    const kcal = Math.round(every.reduce((a, b) => a + b, 0) / every.length / 10) * 10 || 0;
    const bikeKept = g !== 'maintain' && diffs(RIDE).every((x) => x === 0);
    return { goal: g, kcal, bikeKept };
  });
}
