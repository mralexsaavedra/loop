/* Nutrition targets by GOAL × DAY TYPE (Nutrición "Resumen de hoy" / "Plan de hoy").
 *
 * Day types (7), in order of demand: rest; gym (a strength session, ~1 h — the id is kept, stored data uses it);
 * hybrid (HYROX / CrossFit-style circuit); indoor (a trainer ride, or a short outdoor one); run; bike (a ride of
 * ~2 h); bikeLong (> 2.5 h). Goals (3): maintain, cut, bulk. The plan sets kcal, protein and fat per cell in
 * `targets.byGoal[goal][dayType] = { kcal, p, f }`; carbs are the REMAINDER ((kcal - 4p - 9f) / 4),
 * never typed. Every cell is optional: a missing one falls back to DEFAULT_BY_GOAL, so a plan written
 * before this block existed keeps working unchanged; a missing hybrid / indoor / run cell (FILL_FROM_GYM) first
 * takes the plan's OWN gym cell of that goal, so a plan written before those day types keeps its numbers.
 * The default goal is `page.goal` (else maintain).
 *
 * Plans keep their two BASE day plans (`dayPlan.train` / `dayPlan.rest`); BASE_DAY says which one a
 * day type scales from (lib/nutrition/scale.mjs). Pure: no I/O. */

export const DAY_TYPES = Object.freeze(['rest', 'gym', 'hybrid', 'indoor', 'run', 'bike', 'bikeLong']);
export const GOALS = Object.freeze(['maintain', 'cut', 'bulk']);
const DEFAULT_GOAL = 'maintain';
/** @type {Readonly<Record<string, string>>} */
export const BASE_DAY = Object.freeze({ rest: 'rest', gym: 'train', hybrid: 'train', indoor: 'train', run: 'train', bike: 'train', bikeLong: 'train' });
// the day types added after the first four: a plan or a stored onboarding profile without them uses its own gym
// cell (resolveTargets here, lib/profile/onboarding.mjs and the ingest service through PROFILE_FILL_FROM_GYM)
export const FILL_FROM_GYM = Object.freeze(['hybrid', 'indoor', 'run']);
// the example seed's new day types, over each goal's gym value (kcal; same protein and fat)
const OVER_GYM = Object.freeze({ hybrid: 250, indoor: 300, run: 300 });

/** A target cell as the plan writes it: kcal, protein and fat (g); carbs are the remainder.
 * @typedef {{kcal: number, p: number, f: number}} TargetCell */
/** A resolved cell: the plan's three numbers + the carbs remainder (g).
 * @typedef {{kcal: number, p: number, f: number, c: number}} Target */

/** @type {(kcal: number, p: number, f: number) => Readonly<TargetCell>} */
const cell = (kcal, p, f) => Object.freeze({ kcal, p, f });
/** @type {(p: number, f: number, kcal: number[]) => Readonly<Record<string, Readonly<TargetCell>>>} */
const row = (p, f, [rest, gym, bike, bikeLong]) => Object.freeze({
  rest: cell(rest, p, f), gym: cell(gym, p, f),
  hybrid: cell(gym + OVER_GYM.hybrid, p, f), indoor: cell(gym + OVER_GYM.indoor, p, f), run: cell(gym + OVER_GYM.run, p, f),
  bike: cell(bike, p, f), bikeLong: cell(bikeLong, p, f),
});

// Generic EXAMPLE seed for new users, not anyone's real plan: your plan-data.json `targets.byGoal`
// overrides it cell by cell. Built for a 70 kg reference adult with analysis/methodology.md §2:
// protein 1.8 g/kg (2.0 in a cut), fat ~0.9 g/kg (0.8 cut, 1.0 bulk), carbs the remainder;
// maintain ≈ TDEE per day type (rest / gym ~1 h / ride ~2 h / ride > 2.5 h, round values; hybrid +250, indoor and
// run +300 over the gym day); cut ≈ -15 % on rest and the short days with ride days kept at maintenance (fuel the long sessions);
// bulk = +300 kcal every day (+8-13 %). Replace it with your own numbers once you have a TDEE.
/** @type {Readonly<Record<string, Readonly<Record<string, Readonly<TargetCell>>>>>} */
export const DEFAULT_BY_GOAL = Object.freeze({
  maintain: row(125, 65, [2300, 2700, 3100, 3600]),
  cut: row(140, 55, [1950, 2350, 3100, 3600]),
  bulk: row(125, 70, [2600, 3000, 3400, 3900]),
});

/** Carbs (g) left once protein (4 kcal/g) and fat (9 kcal/g) are paid for.
 * @param {{kcal: number, p: number, f: number}} cell */
export function carbsOf({ kcal, p, f }) {
  return Math.round((kcal - 4 * p - 9 * f) / 4);
}

/** @type {(v: unknown) => boolean} */
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
/** @type {(v: unknown) => v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The plan document's parts these functions read (raw JSON: every part optional, validated here).
 * @typedef {{targets?: {byGoal?: Record<string, any> | null} | null, page?: {goal?: string | null} | null} | null | undefined} TargetsPlan */

/** @param {TargetsPlan} plan @returns {Record<string, any>} */
function byGoalOf(plan) {
  const b = plan && plan.targets && plan.targets.byGoal;
  return isObj(b) ? /** @type {Record<string, any>} */ (b) : {};
}

/** Every cell, `{ [goal]: { [dayType]: { kcal, p, f, c } } }`: the plan's cell when present; for a FILL_FROM_GYM day
 * type the plan's own gym cell of that goal next; else the default.
 * @param {TargetsPlan} plan
 * @returns {Record<string, Record<string, Target>>} */
export function resolveTargets(plan) {
  const b = byGoalOf(plan);
  /** @type {Record<string, Record<string, Target>>} */
  const out = {};
  for (const g of GOALS) {
    out[g] = {};
    const mine = isObj(b[g]) ? b[g] : {};
    for (const d of DAY_TYPES) {
      const own = isObj(mine[d]) ? mine[d] : FILL_FROM_GYM.includes(d) && isObj(mine.gym) ? mine.gym : null;
      const src = own || DEFAULT_BY_GOAL[g][d];
      const t = { kcal: src.kcal, p: src.p, f: src.f };
      out[g][d] = { ...t, c: carbsOf(t) };
    }
  }
  return out;
}

/** The goal the page opens on: page.goal when it is a known goal, else maintain.
 * @param {TargetsPlan} plan
 * @returns {string} */
export function resolveGoal(plan) {
  const g = /** @type {string} */ (plan && plan.page && plan.page.goal);
  return GOALS.includes(g) ? g : DEFAULT_GOAL;
}

/** Problems in targets.byGoal / page.goal (empty list = valid; absent = valid).
 * @param {TargetsPlan} plan
 * @returns {string[]} */
export function validateTargets(plan) {
  /** @type {string[]} */
  const errs = [];
  const goal = plan && plan.page && plan.page.goal;
  if (goal != null && !GOALS.includes(goal)) errs.push(`page.goal must be one of ${GOALS.join(', ')} (got ${JSON.stringify(goal)})`);
  const raw = plan && plan.targets && plan.targets.byGoal;
  if (raw == null) return errs;
  if (!isObj(raw)) { errs.push('targets.byGoal must be an object { goal: { dayType: { kcal, p, f } } }'); return errs; }
  for (const [g, cells] of Object.entries(raw)) {
    if (g.startsWith('_')) continue; // _doc comments
    if (!GOALS.includes(g)) { errs.push(`targets.byGoal.${g}: unknown goal (expected ${GOALS.join(', ')})`); continue; }
    if (!isObj(cells)) { errs.push(`targets.byGoal.${g} must be an object`); continue; }
    for (const [d, t] of Object.entries(cells)) {
      if (d.startsWith('_')) continue;
      const at = `targets.byGoal.${g}.${d}`;
      if (!DAY_TYPES.includes(d)) { errs.push(`${at}: unknown day type (expected ${DAY_TYPES.join(', ')})`); continue; }
      if (!isObj(t)) { errs.push(`${at} must be { kcal, p, f }`); continue; }
      let ok = true;
      if (!(isNum(t.kcal) && t.kcal > 0)) { errs.push(`${at}.kcal must be a positive number`); ok = false; }
      for (const k of ['p', 'f']) if (!(isNum(t[k]) && t[k] >= 0)) { errs.push(`${at}.${k} must be a number of grams >= 0`); ok = false; }
      if (ok && carbsOf(t) < 0) errs.push(`${at}: protein and fat alone exceed kcal (carbs would be ${carbsOf(t)} g)`);
    }
  }
  return errs;
}
