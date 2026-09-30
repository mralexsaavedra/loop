/* The NUTRI bake (web/src/tabs/Dia.astro) behind Nutrición's Resumen de hoy, Plan de hoy and
 * Avituallamiento, and Inicio's "today you eat" card: the 12 precomputed (goal × day type) plans
 * (lib/nutrition/scale.mjs) plus the constants the page needs to pick TODAY on the viewer's clock
 * (detection thresholds, fuelling rates, the ride-duration choices) and the latest weigh-in for the
 * g/kg fuelling amounts. Nothing time-based is baked, so builds stay byte-identical. Pure: no I/O. */
import { buildDayPlans, MACRO_TOLERANCE_G } from './scale.mjs';
import { FUEL, RIDE_DEFAULT_MIN, RIDE_DURATIONS } from './fuel.mjs';
import { DETECT } from './daytype.mjs';

/** nut = buildNutrition() result; weight = {kg, date} | null (lib/profile latestWeight). */
export function buildNutriToday(nut, plan, { supplements = [], weight = null, units, dec } = {}) {
  const w = weight && Number.isFinite(weight.kg) && weight.kg > 0 && typeof weight.date === 'string' ? { kg: weight.kg, date: weight.date } : null;
  return {
    ...buildDayPlans(nut, plan, { supplements, units, dec }),
    macroTol: MACRO_TOLERANCE_G,
    detect: DETECT,
    fuel: { rates: FUEL, defaults: RIDE_DEFAULT_MIN, durations: RIDE_DURATIONS },
    weight: w,
  };
}
