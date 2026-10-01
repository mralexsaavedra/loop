/* The NUTRI bake (web/src/tabs/Dia.astro) behind Nutrición's Resumen de hoy, Plan de hoy and
 * Avituallamiento, and Inicio's "today you eat" card: the 12 (goal × day type) targets and one scaling
 * model per base day (lib/nutrition/scale.mjs; the page re-solves with its planFor port), the option
 * lists of the choosable blocks (lib/nutrition/blocks.mjs) plus the
 * constants the page needs to pick TODAY on the viewer's clock (detection thresholds, fuelling rates,
 * the ride-duration choices) and the latest weigh-in for the g/kg fuelling amounts. Nothing time-based is baked, so builds stay byte-identical. Pure: no I/O. */
import { buildDayPlans, MACRO_TOLERANCE_G } from './scale.mjs';
import { PROTEIN_SCALE_MIN, PROTEIN_SCALE_MAX } from './blocks.mjs';
import { FUEL, RIDE_DEFAULT_MIN, RIDE_DURATIONS } from './fuel.mjs';
import { DETECT } from './daytype.mjs';
import { MAIN_SLOTS } from './slots.mjs';

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
  return {
    ...days,
    plans,
    macroTol: MACRO_TOLERANCE_G,
    blocks: { pMin: PROTEIN_SCALE_MIN, pMax: PROTEIN_SCALE_MAX },
    detect: DETECT,
    fuel: { rates: FUEL, defaults: RIDE_DEFAULT_MIN, durations: RIDE_DURATIONS },
    weight: w,
    // Plan de hoy: breakfast / lunch / dinner are the day's cards, every other meal a row of ONE add-ons card
    mainSlots: MAIN_SLOTS,
  };
}
