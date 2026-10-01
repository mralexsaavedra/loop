/* The NUTRI bake (web/src/tabs/Dia.astro) behind Nutrición's Resumen de hoy, Plan de hoy (the portion
 * guide) and Avituallamiento, and Inicio's "today you eat" card: the 12 (goal × day type) targets and
 * one scaling model per base day (lib/nutrition/scale.mjs; the page re-solves with its planFor port and
 * turns the main meals into budgets, lib/nutrition/guide.mjs), the guide's default example food per
 * main meal and role, the Extras hint's examples, plus the constants the page needs to pick TODAY on the
 * viewer's clock (detection thresholds, fuelling rates, the ride-duration choices) and the latest
 * weigh-in for the g/kg fuelling amounts. The guide's food table is the food log's FOOD_BASICS (one
 * table, baked next to it). Nothing time-based is baked, so builds stay byte-identical. Pure: no I/O. */
import { buildDayPlans, MACRO_TOLERANCE_G } from './scale.mjs';
import { FUEL, RIDE_DEFAULT_MIN, RIDE_DURATIONS } from './fuel.mjs';
import { DETECT } from './daytype.mjs';
import { MAIN_SLOTS } from './slots.mjs';
import { GUIDE_ROLES, ROLE_KEYS, GUIDE_FALLBACK, DONE_SHARE, COVERED_SHARE, mealDefaults, extrasExamples } from './guide.mjs';

/** nut = buildNutrition() result; weight = {kg, date} | null (lib/profile latestWeight). */
export function buildNutriToday(nut, plan, { supplements = [], weight = null, units, dec, lang } = {}) {
  const w = weight && Number.isFinite(weight.kg) && weight.kg > 0 && typeof weight.date === 'string' ? { kg: weight.kg, date: weight.date } : null;
  const days = buildDayPlans(nut, plan, { supplements, units, dec, lang });
  // the page re-solves every plan (planFor over base[day]'s model) for the viewer's ride minutes, so
  // only the target and the base day travel per (goal, day type)
  const plans = {};
  for (const g of days.goals) {
    plans[g] = {};
    for (const d of days.dayTypes) plans[g][d] = { base: days.plans[g][d].base, t: days.plans[g][d].t };
  }
  const defaults = {};
  for (const day of Object.keys(days.base)) defaults[day] = mealDefaults(nut, day);
  const roles = {};
  for (const r of ROLE_KEYS) roles[r] = { at: GUIDE_ROLES[r].at, cats: GUIDE_ROLES[r].cats };
  return {
    ...days,
    plans,
    macroTol: MACRO_TOLERANCE_G,
    detect: DETECT,
    fuel: { rates: FUEL, defaults: RIDE_DEFAULT_MIN, durations: RIDE_DURATIONS },
    weight: w,
    // Plan de hoy: breakfast / lunch / dinner get a budget each, every other meal goes to Extras
    mainSlots: MAIN_SLOTS,
    guide: { roles, defaults, fallback: GUIDE_FALLBACK, extras: extrasExamples(nut.ING), done: DONE_SHARE, covered: COVERED_SHARE },
  };
}
