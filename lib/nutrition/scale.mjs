/* Portion scaling: the plan's base day (dayPlan.train / dayPlan.rest) scaled to a (goal × day type)
 * target. Declarative: a dayPlan part marked `flex: "carb"` (rice, pasta, bread, fruit, honey…) is
 * scalable; every other part (protein, fat, veg) stays as written. The base day's macros come from
 * the existing engine (lib/nutrition/macros.mjs, ingredients.json — never hand-typed); ONE factor is
 * applied to every carb-flex part so the day lands on the target kcal, clamped to
 * [SCALE_MIN, SCALE_MAX] so a portion never becomes absurd. Amounts round to practical steps (5 g /
 * 5 ml; units stay whole units) and the totals are recomputed from the ROUNDED amounts, so what the
 * page shows adds up. Whatever the clamp or the rounding leaves over is reported as `rem` (target −
 * ride fuel − meals, kcal), never hidden.
 *
 * Bike day types: the on-bike carbs count inside the day total, so the meals aim at target − ride
 * fuel (lib/nutrition/fuel.mjs, default ride duration).
 *
 * buildDayPlans() precomputes all 12 (goal × day type) plans at build time; the page only switches
 * between them, so builds stay byte-identical. Pure: no I/O. */
import { DAY_TYPES, GOALS, BASE_DAY, resolveTargets, resolveGoal } from './targets.mjs';
import { fuelPlan, RIDE_DEFAULT_MIN, isBikeDay } from './fuel.mjs';
import { mealSlot } from './slots.mjs';

export const SCALE_MIN = 0.6;
export const SCALE_MAX = 2.0;
export const AMOUNT_STEP = 5; // g / ml
// rounding every flex part to 5 g moves the day by a few dozen kcal at most; beyond this the page
// says how much is missing (or left over) and what to do with it
export const REMAINDER_TOLERANCE_K = 75;
// protein and fat are not scaled: a plan more than this far from the target says so
export const MACRO_TOLERANCE_G = 15;
import { FLEX_KINDS } from './macros.mjs';
export { FLEX_KINDS };

const DEFAULT_UNITS = Object.freeze({ g: 'g', ml: 'ml', ud: 'ud' });
const MAC = ['k', 'p', 'c', 'g'];
const zero = () => ({ k: 0, p: 0, c: 0, g: 0 });
const add = (a, b) => { for (const f of MAC) a[f] += b[f]; return a; };
const r0 = (v) => Math.round(v);
const round2 = (v) => Math.round(v * 100) / 100;

/** A scaled amount rounded to a practical step: 5 g / 5 ml (never below one step); `ud` (100 = one
 * unit) to whole units, at least one. */
export function stepAmount(amt, unit) {
  if (unit === 'ud') return Math.max(100, Math.round(amt / 100) * 100);
  return Math.max(AMOUNT_STEP, Math.round(amt / AMOUNT_STEP) * AMOUNT_STEP);
}

function lineMacros(ING, line) {
  const ing = ING[line.ing];
  if (!ing) throw new Error('unknown ingredient: ' + line.ing);
  const f = line.amt / ing.per;
  return { k: ing.k * f, p: ing.p * f, c: ing.c * f, g: ing.g * f };
}

// an item's own `q` is shown only when it states an amount ("130 g", "1 (120 g)"), not a placeholder like "—"
const hasAmount = (q) => typeof q === 'string' && /\d/.test(q);

function fmtLines(ING, lines, units) {
  return lines.map((l) => {
    const unit = ING[l.ing].unit;
    return unit === 'ud' ? `${round2(l.amt / 100)} ${units.ud}` : `${round2(l.amt)} ${units[unit] || unit}`;
  }).join(' + ');
}

/** A dayPlan part -> { label, flex, lines ([{ing, amt}]) | manual ({k,p,c,g}), q (display text) }. */
function describePart(nut, part, units) {
  const flex = FLEX_KINDS.includes(part.flex);
  if (part.ing) {
    const ing = nut.ING[part.ing];
    if (!ing) throw new Error('dayPlan part: unknown ingredient: ' + part.ing);
    const lines = [{ ing: part.ing, amt: part.amt }];
    return { label: part.label || ing.name || part.ing, flex, lines, q: fmtLines(nut.ING, lines, units) };
  }
  const item = nut.findItem(part);
  const label = part.label || item.n || item.l;
  if (item.recipe) return { label, flex, lines: item.recipe.map((l) => ({ ing: l.ing, amt: l.amt })), q: hasAmount(item.q) ? item.q : fmtLines(nut.ING, item.recipe, units) };
  const r = nut.resolve(item); // manual / none: a fixed macro block, scaled as a whole
  return { label, flex, manual: { k: r.k, p: r.p, c: r.c, g: r.g }, q: item.q || '' };
}

function partMacros(nut, d, factor, units, dec) {
  const s = d.flex ? factor : 1;
  if (d.manual) {
    const m = {};
    for (const f of MAC) m[f] = d.manual[f] * s;
    const q = d.flex && s !== 1 ? `${d.q} ×${String(Math.round(s * 10) / 10).replace('.', dec)}`.trim() : d.q;
    return { m, q };
  }
  if (!d.flex || s === 1) return { m: d.lines.reduce((acc, l) => add(acc, lineMacros(nut.ING, l)), zero()), q: d.q };
  const lines = d.lines.map((l) => ({ ing: l.ing, amt: stepAmount(l.amt * s, nut.ING[l.ing].unit) }));
  return { m: lines.reduce((acc, l) => add(acc, lineMacros(nut.ING, l)), zero()), q: fmtLines(nut.ING, lines, units) };
}

/** The base day `day` ('train' | 'rest') scaled so its meals total `mealsTargetK` kcal. */
export function scaleDay(nut, day, mealsTargetK, { units = DEFAULT_UNITS, dec = '.' } = {}) {
  const meals = nut.DAYPLAN[day].meals.map((meal) => ({ meal, parts: (meal.parts || []).map((p) => describePart(nut, p, units)) }));
  let fixedK = 0;
  let flexK = 0;
  for (const { parts } of meals) for (const d of parts) {
    const k = partMacros(nut, d, 1, units, dec).m.k;
    if (d.flex) flexK += k; else fixedK += k;
  }
  let factor = flexK > 0 ? (mealsTargetK - fixedK) / flexK : 1;
  let clamp = null;
  if (factor < SCALE_MIN) { factor = SCALE_MIN; clamp = 'min'; }
  else if (factor > SCALE_MAX) { factor = SCALE_MAX; clamp = 'max'; }
  factor = round2(factor);
  const totals = zero();
  const out = meals.map(({ meal, parts }) => {
    const m = zero();
    const shown = parts.map((d) => {
      const r = partMacros(nut, d, factor, units, dec);
      add(m, r.m);
      return { label: d.label, flex: d.flex, q: r.q, k: r.m.k };
    });
    add(totals, m);
    return { name: meal.name, slot: mealSlot(meal), ...m, parts: shown };
  });
  return { factor, clamp, meals: out, totals, rem: r0(mealsTargetK) - r0(totals.k) };
}

const macroRow = (m) => MAC.map((f) => r0(m[f]));

/** All 12 (goal × day type) plans, compact: the meal structure once per base day (`base`), and per
 * plan only what changes (target, meal macros, flex amounts in part order, totals, factor, clamp,
 * ride fuel, remainder). `supplements` (profile.json) ride along for Plan de hoy. */
export function buildDayPlans(nut, plan, { supplements = [], units = DEFAULT_UNITS, dec = '.' } = {}) {
  const targets = resolveTargets(plan);
  const base = {};
  for (const day of new Set(Object.values(BASE_DAY))) {
    const s = scaleDay(nut, day, 0, { units, dec }); // structure only: labels, slots, fixed amounts
    base[day] = {
      note: nut.DAYPLAN[day].kcalNote || null,
      meals: s.meals.map((m, i) => {
        const meal = nut.DAYPLAN[day].meals[i];
        return {
          n: m.name,
          s: m.slot,
          pcf: meal.pcf !== false,
          parts: m.parts.map((x) => (x.flex ? { l: x.label, x: 1 } : { l: x.label, q: x.q })),
        };
      }),
    };
  }
  const plans = {};
  for (const g of GOALS) {
    plans[g] = {};
    for (const d of DAY_TYPES) {
      const t = targets[g][d];
      const fuelK = isBikeDay(d) ? fuelPlan({ dayType: d, minutes: RIDE_DEFAULT_MIN[d] }).kcal : 0;
      const s = scaleDay(nut, BASE_DAY[d], t.kcal - fuelK, { units, dec });
      const flex = [];
      for (const m of s.meals) for (const x of m.parts) if (x.flex) flex.push(x.q);
      const tot = { k: r0(s.totals.k), p: r0(s.totals.p), c: r0(s.totals.c), g: r0(s.totals.g) };
      plans[g][d] = { base: BASE_DAY[d], t, meals: s.meals.map(macroRow), flex, tot, factor: s.factor, clamp: s.clamp, fuelK, rem: t.kcal - fuelK - tot.k };
    }
  }
  return {
    goal: resolveGoal(plan),
    goals: GOALS,
    dayTypes: DAY_TYPES,
    base,
    plans,
    tolerance: REMAINDER_TOLERANCE_K,
    scale: { min: SCALE_MIN, max: SCALE_MAX },
    supplements: Array.isArray(supplements) ? supplements : [],
  };
}
