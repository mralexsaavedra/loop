/* Pure nutrition macro computation over ingredients.json + plan-data.json: the resolved items (D, EX), the
 * breakfast tables, the fruit summary and the macro helpers data/nutrition/generate.mjs and the page build
 * use. No I/O: the same (ingredients, plan) input always gives the same output. */

import { validateTargets } from './targets.mjs';
import { validateFuelItems } from './fuel.mjs';
import { MEAL_SLOTS } from './slots.mjs';
import { validateIngredientMeta } from './units.mjs';
import { validateIngredientNames } from './names.mjs';
import { validateIngredientCats } from './categories.mjs';
import { validateIngredientCaps } from './amounts.mjs';

// the part markers lib/nutrition/scale.mjs knows how to scale
export const FLEX_KINDS = Object.freeze(['carb']);

const rk = (n) => Math.round(n); // kcal -> integer
const rm = (n) => Math.round(n * 10) / 10; // macros -> 1 decimal (.0 dropped)
const nd = (n) => { const r = Math.round(n * 10) / 10; return String(r).replace('.', ','); }; // 1 decimal, comma sep
const dotThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const MACRO_KEYS = ['k', 'p', 'c', 'g'];
// tier / cap are breakfast-table-only; recipe / manual are replaced by the resolved macros
const RESOLVE_SKIP = { recipe: 1, manual: 1, tier: 1, cap: 1 };

/** One macro (`key` of k / p / c / g) of a recipe [{ing, amt}], unrounded; an unknown ingredient throws. */
function recipeMacro(ING, recipe, key) {
  return recipe.reduce((s, r) => {
    const ing = ING[r.ing];
    if (!ing) throw new Error('unknown ingredient: ' + r.ing);
    return s + ing[key] * (r.amt / ing.per);
  }, 0);
}

/** A plan item with its macros resolved: from its recipe (kcal whole, macros 1 decimal), its manual block or
 * zero (`none`); its other fields copied. */
function resolveItem(ING, o) {
  const out = {};
  for (const k of Object.keys(o)) {
    if (!RESOLVE_SKIP[k]) out[k] = o[k];
  }
  if (o.recipe) {
    out.k = rk(recipeMacro(ING, o.recipe, 'k'));
    MACRO_KEYS.slice(1).forEach((f) => { out[f] = rm(recipeMacro(ING, o.recipe, f)); });
  } else if (o.manual) {
    MACRO_KEYS.forEach((f) => { out[f] = o.manual[f]; });
  } else if (o.none) {
    MACRO_KEYS.forEach((f) => { out[f] = 0; });
  } else {
    throw new Error('item has neither recipe, manual nor none: ' + (o.n || o.l));
  }
  return out;
}

/** plan.data resolved category by category (an array, or {sub: array}). */
function resolveData(RAW, resolve) {
  const D = {};
  for (const [cat, v] of Object.entries(RAW)) {
    if (Array.isArray(v)) D[cat] = v.map(resolve);
    else {
      D[cat] = {};
      for (const [sub, arr] of Object.entries(v)) D[cat][sub] = arr.map(resolve);
    }
  }
  return D;
}

/** One macro of one recipe line, unrounded; an unknown ingredient throws. */
function lineMacroOf(ING, line, key) {
  const ing = ING[line.ing];
  if (!ing) throw new Error('unknown ingredient: ' + line.ing);
  return ing[key] * (line.amt / ing.per);
}

/** A breakfast recipe's table rows: one per line, lines sharing a `group` merged into the row that opened it. */
function breakfastRows(ING, recipe) {
  const rows = [];
  const byGroup = {};
  for (const line of recipe) {
    const ing = ING[line.ing];
    const m = { k: lineMacroOf(ING, line, 'k'), p: lineMacroOf(ING, line, 'p'), c: lineMacroOf(ING, line, 'c'), g: lineMacroOf(ING, line, 'g') };
    if (line.group && byGroup[line.group] != null) { // merge into the row that opened this group
      const row = rows[byGroup[line.group]];
      row.amt += line.amt;
      MACRO_KEYS.forEach((f) => { row[f] += m[f]; });
      continue;
    }
    if (line.group) byGroup[line.group] = rows.length;
    rows.push({
      name: line.glabel || line.label || line.ing, q: line.q || null, link: line.link || null,
      amt: line.amt, unit: ing.unit, k: m.k, p: m.p, c: m.c, g: m.g,
    });
  }
  return rows;
}
const brkQty = (row) => (row.q ? row.q : (row.unit === 'ud' ? String(row.amt / 100) : row.amt + ' ' + row.unit));

/** The raw data item a `{use, tier?, match}` dayPlan part points at (exact name/label first, then
 * the first substring hit); throws when nothing matches. */
function findPlanItem(RAW, part) {
  const bucket = part.tier ? (RAW[part.use] && RAW[part.use][part.tier]) : RAW[part.use];
  if (!Array.isArray(bucket)) throw new Error('dayPlan part: no items at data.' + part.use + (part.tier ? '.' + part.tier : ''));
  const m = part.match;
  const find = (pred) => bucket.find(pred);
  const item =
    find((o) => o.n === m) ||
    find((o) => o.l === m) ||
    find((o) => o.n && o.n.includes(m)) ||
    find((o) => o.l && o.l.includes(m));
  if (!item) throw new Error('dayPlan part: no match for "' + m + '" in data.' + part.use + (part.tier ? '.' + part.tier : ''));
  return item;
}

/** A dayPlan part's macros, unrounded: an `{ing, amt}` part from the ingredient, a `{use, match}` part from
 * the resolved item it points at. */
function partMacros(ING, RAW, part) {
  if (part.ing) {
    const ing = ING[part.ing];
    if (!ing) throw new Error('dayPlan part: unknown ingredient: ' + part.ing);
    const f = part.amt / ing.per;
    return { k: ing.k * f, p: ing.p * f, c: ing.c * f, g: ing.g * f };
  }
  const r = resolveItem(ING, findPlanItem(RAW, part));
  return { k: r.k, p: r.p, c: r.c, g: r.g };
}

/** Tablas' breakfast tables: per breakfast item a caption and its recipe rows, ready to render. */
function breakfastTables(ING, RAW) {
  return (RAW.desayuno || []).filter((o) => !o.none).map((item) => {
    const r = resolveItem(ING, item);
    return {
      cap: `${item.tier} ${item.cap} · ~${r.k} kcal · ${Math.round(r.p)} P · ${Math.round(r.c)} C · ${Math.round(r.g)} G`,
      rows: breakfastRows(ING, item.recipe).map((row) => ({
        name: row.name,
        link: row.link || null,
        qty: brkQty(row),
        k: rk(row.k),
        p: nd(row.p),
        c: nd(row.c),
        g: nd(row.g),
      })),
    };
  });
}

/** The fruit line of the dessert table, from the plan's fruit items (D.postre, `cat === 'fruit'`, already
 * rounded): kcal and carbs (which vary across fruit) as a min-max range, protein and fat (near constant) as
 * one rounded mean; null when the plan has no fruit. */
function fruitSummaryOf(D) {
  const fruitItems = (D.postre || []).filter((o) => o.cat === 'fruit');
  return fruitItems.length ? {
    kMin: Math.min(...fruitItems.map((o) => o.k)),
    kMax: Math.max(...fruitItems.map((o) => o.k)),
    cMin: Math.min(...fruitItems.map((o) => o.c)),
    cMax: Math.max(...fruitItems.map((o) => o.c)),
    p: Math.round(fruitItems.reduce((s, o) => s + o.p, 0) / fruitItems.length),
    g: Math.round(fruitItems.reduce((s, o) => s + o.g, 0) / fruitItems.length),
  } : null;
}

export function buildNutrition(ingredients, plan) {
  const ING = ingredients;
  const {
    data: RAW,
    extras: RAWEX,
    quesoKeys: QUESO,
    vegKeys: VEG,
    dayPlan: DAYPLAN,
    legumeKeys: LEGUMES,
    legumePlate: LEGUME_PLATE,
  } = plan;

  const MACRO = MACRO_KEYS.slice();
  const macro = (recipe, key) => recipeMacro(ING, recipe, key);
  const resolve = (o) => resolveItem(ING, o);
  const lineMacro = (line, key) => lineMacroOf(ING, line, key);
  const brkRows = (recipe) => breakfastRows(ING, recipe);
  const resolvePart = (part) => partMacros(ING, RAW, part);
  const findItem = (part) => findPlanItem(RAW, part);
  const mealMacros = (meal) => meal.parts.reduce((s, part) => {
    const m = resolvePart(part);
    return { k: s.k + m.k, p: s.p + m.p, c: s.c + m.c, g: s.g + m.g };
  }, { k: 0, p: 0, c: 0, g: 0 });
  // a base day's kcal, from the same mealMacros the tables use
  const dayTotalK = (day) => rk(DAYPLAN[day].meals.reduce((s, m) => s + mealMacros(m).k, 0));

  // resolved copies: the page's tables and plan-tables.md
  const D = resolveData(RAW, resolve);
  const EX = {};
  for (const [k, o] of Object.entries(RAWEX)) EX[k] = resolve(o);

  return {
    ING, RAW, RAWEX, QUESO, VEG, DAYPLAN, LEGUMES, LEGUME_PLATE,
    D, EX, MACRO, rk, rm, nd, dotThousands,
    resolve, macro, lineMacro, brkRows, brkQty, resolvePart, findItem, mealMacros,
    dayTotalK,
    breakfast: breakfastTables(ING, RAW), fruitSummary: fruitSummaryOf(D),
  };
}

/* ---------- integrity validation: the failure modes that would silently corrupt the plan numbers ---------- */
// Default day-total kcal sanity band — a gross-bad-edit guard, not a target.
const DEFAULT_KCAL_BAND = Object.freeze({ train: [2000, 2800], rest: [1700, 2400] });

/** Top-level plan keys of the removed day builder: accepted, ignored, warned about by validateNutrition. */
export const LEGACY_PLAN_KEYS = Object.freeze(['extrasDisplay', 'indulgeKeys', 'alcoholKeys', 'mealReplaceKeys']);

/** The checks buildNutrition needs to even run: every {ing} reference resolves and both day plans exist. All
 * of them are collected first, so one run reports every problem instead of the first one buildNutrition hits. */
function structuralErrors(ingredients, plan) {
  const errors = [];
  const seen = new Set();
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (typeof o.ing === 'string' && !ingredients[o.ing] && !seen.has(o.ing)) {
      seen.add(o.ing);
      errors.push('references unknown ingredient: ' + o.ing);
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(plan.data); walk(plan.extras); walk(plan.dayPlan);
  for (const day of ['train', 'rest']) {
    const d = plan.dayPlan && plan.dayPlan[day];
    if (!d || typeof d !== 'object' || !Array.isArray(d.meals)) errors.push(`dayPlan.${day} must be an object with a "meals" array`);
  }
  return errors;
}

// A hand-typed manual block's {k, p, c, g} must agree with Atwater (4 kcal/g protein and carbs, 9 kcal/g fat)
// within MANUAL_ATWATER_TOL of its kcal or MANUAL_ATWATER_ABS_KCAL, whichever is larger. (A food LABEL has its
// own, looser tolerance: lib/nutrition/foodlog.mjs ATWATER_TOL / ATWATER_ABS_KCAL.)
export const MANUAL_ATWATER_TOL = 0.15;
export const MANUAL_ATWATER_ABS_KCAL = 25;

/** kcal from the macros (Atwater): 4 p + 4 c + 9 g. */
export function atwaterKcal(m) {
  return 4 * m.p + 4 * m.c + 9 * m.g;
}

/** false only when a manual block's kcal disagree with its macros beyond the tolerance (see MANUAL_ATWATER_TOL);
 * a non-numeric field is the structural check's job, not this one's. */
export function manualAtwaterOk(m) {
  return !(Math.abs(atwaterKcal(m) - m.k) > Math.max(MANUAL_ATWATER_ABS_KCAL, m.k * MANUAL_ATWATER_TOL));
}

// Every {ing} reference anywhere (recipe lines, dayPlan parts, breakfast lines) and the legume keys: an
// unknown one is an error, a hand-typed manual block must pass the Atwater sanity check. Returns the used keys.
function referenceErrors(nut, errors) {
  const { ING, RAW, RAWEX, DAYPLAN, LEGUMES } = nut;
  const used = new Set();
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      if (typeof o.ing === 'string') {
        used.add(o.ing);
        if (!ING[o.ing]) errors.push('references unknown ingredient: ' + o.ing);
      }
      // hand-typed manual blocks are computed by nobody -> sanity-check kcal vs Atwater
      if (o.manual && !manualAtwaterOk(o.manual)) {
        errors.push(`manual block fails Atwater sanity (k=${o.manual.k} vs ~${Math.round(atwaterKcal(o.manual))}): ${o.n || o.l || '?'}`);
      }
      for (const k of Object.keys(o)) if (k !== 'ingredients') walk(o[k]);
    }
  };
  walk(RAW); walk(RAWEX); walk(DAYPLAN);
  (LEGUMES || []).forEach((k) => { used.add(k); if (!ING[k]) errors.push('legumeKeys references unknown ingredient: ' + k); });
  return used;
}

// Legacy fields of the removed day builder (Constructor de día / `registro`): an existing plan may still carry
// them. Nothing reads them any more, so they are accepted and ignored: a warning, never an error.
function legacyWarnings(plan, warnings) {
  for (const k of LEGACY_PLAN_KEYS) if (plan[k] != null) warnings.push(`${k} is a legacy day-builder field and is ignored (safe to delete)`);
  if (plan.page && plan.page.offPlanPlaceholder != null) warnings.push('page.offPlanPlaceholder is a legacy day-builder field and is ignored (safe to delete)');
}

function pageErrors(page, errors) {
  if (!page) return;
  if (typeof page.title !== 'string' || !page.title) errors.push('page.title must be a non-empty string');
  // h1 / sub are optional: without them the page opens straight onto the dials (the layout keeps a
  // visually hidden h1 from the title, so the document still has one)
  if (page.h1 != null && (typeof page.h1 !== 'string' || !page.h1)) errors.push('page.h1 must be a non-empty string when present');
  if (page.sub != null && typeof page.sub !== 'string') errors.push('page.sub must be a string when present');
  if (page.notes != null && typeof page.notes !== 'object') errors.push('page.notes must be an object when present');
}

// dayPlan `match` must resolve unambiguously (exact name/label, or exactly one substring hit)
function matchErrors(RAW, DAYPLAN, errors) {
  for (const day of ['train', 'rest']) {
    for (const meal of DAYPLAN[day].meals) {
      for (const part of (meal.parts || [])) {
        if (!part.match) continue;
        const bucket = part.tier ? (RAW[part.use] && RAW[part.use][part.tier]) : RAW[part.use];
        if (!Array.isArray(bucket)) { errors.push(`dayPlan ${day} part: no bucket data.${part.use}${part.tier ? '.' + part.tier : ''}`); continue; }
        if (!bucket.some((o) => o.n === part.match || o.l === part.match)) {
          const hits = bucket.filter((o) => (o.n && o.n.includes(part.match)) || (o.l && o.l.includes(part.match))).length;
          if (hits !== 1) errors.push(`dayPlan ${day} part "${part.match}" resolves ambiguously (${hits} substring hits, no exact) in ${part.use}`);
        }
      }
    }
  }
}

// The food DB's optional metadata: natural units (units.mjs), realistic portion caps the scaling never exceeds
// (amounts.mjs), display names {es, en} (names.mjs; a missing one only warns, the page shows the key) and food
// categories (categories.mjs; a missing one only warns, that food is not swappable).
function ingredientErrors(ING, errors, warnings) {
  errors.push(...validateIngredientMeta(ING));
  errors.push(...validateIngredientCaps(ING));
  const names = validateIngredientNames(ING);
  errors.push(...names.errors);
  warnings.push(...names.warnings);
  const cats = validateIngredientCats(ING);
  errors.push(...cats.errors);
  warnings.push(...cats.warnings);
}

// meal slots and carb-flex markers of the day plans (optional)
function slotFlexErrors(DAYPLAN, errors) {
  for (const day of ['train', 'rest']) {
    DAYPLAN[day].meals.forEach((meal, mi) => {
      if (meal.slot != null && !MEAL_SLOTS.includes(meal.slot)) errors.push(`dayPlan ${day} meal ${mi}: slot must be one of ${MEAL_SLOTS.join(', ')} (got ${JSON.stringify(meal.slot)})`);
      (meal.parts || []).forEach((part, pi) => {
        if (part.flex != null && !FLEX_KINDS.includes(part.flex)) errors.push(`dayPlan ${day} meal ${mi} part ${pi}: flex must be "carb" when present (got ${JSON.stringify(part.flex)})`);
      });
    });
  }
}

// Day totals within a sane band: catches a gross bad edit, not a tight target (DEFAULT_KCAL_BAND; a plan
// overrides it via plan.validation.kcalBand = { train: [min, max], rest: [min, max] }).
function kcalBandErrors(plan, DAYPLAN, mealMacros, errors) {
  const band = { ...DEFAULT_KCAL_BAND };
  const override = plan.validation && plan.validation.kcalBand;
  if (override != null) {
    for (const day of ['train', 'rest']) {
      const b = override[day];
      const ok = Array.isArray(b) && b.length === 2 && b.every((v) => typeof v === 'number' && Number.isFinite(v)) && b[0] < b[1];
      if (ok) band[day] = b;
      else { errors.push(`validation.kcalBand.${day} must be [min, max] with numeric min < max (got ${JSON.stringify(b)})`); band[day] = null; }
    }
  }
  for (const day of ['train', 'rest']) {
    if (!band[day]) continue;
    const total = DAYPLAN[day].meals.reduce((s, m) => s + mealMacros(m).k, 0);
    const [lo, hi] = band[day];
    if (total < lo || total > hi) errors.push(`${day}-day total ${Math.round(total)} kcal outside sane band ${lo}-${hi}`);
  }
}

/** Throws one error listing every problem of the plan; else {ok: true, warnings}. Runs before every generate
 * and standalone (`node data/nutrition/generate.mjs --check`). */
export function validateNutrition(ingredients, plan) {
  const early = structuralErrors(ingredients, plan);
  if (early.length) throw new Error('plan-data.json validation failed:\n  - ' + early.join('\n  - '));
  const nut = buildNutrition(ingredients, plan);
  const { ING, RAW, DAYPLAN, EX, QUESO, VEG, mealMacros } = nut;

  const errors = [];
  const warnings = [];
  const used = referenceErrors(nut, errors);
  // Unused ingredients are a WARNING, not an error: ingredients.json is a shared public food DB that may
  // legitimately hold more foods than a given plan uses. One line with the count: listing every unused food
  // (100+ on a fresh clone) reads like a failure.
  const unused = Object.keys(ING).filter((k) => !used.has(k));
  if (unused.length) warnings.push(`${unused.length} ingredients in ingredients.json are not used by this plan (normal: it is a shared food database)`);
  // key lists must resolve to real resolved-extras entries
  [...(QUESO || []), ...(VEG || [])].forEach((k) => { if (!EX[k]) errors.push('queso/veg key has no extras entry: ' + k); });
  legacyWarnings(plan, warnings);
  pageErrors(plan.page, errors);
  matchErrors(RAW, DAYPLAN, errors);
  ingredientErrors(ING, errors, warnings);
  // nutrition v2: goal x day type targets (targets.mjs) and the user's own fuel items (fuel.mjs), both optional
  errors.push(...validateTargets(plan));
  errors.push(...validateFuelItems(plan));
  slotFlexErrors(DAYPLAN, errors);
  kcalBandErrors(plan, DAYPLAN, mealMacros, errors);
  if (errors.length) throw new Error('plan-data.json validation failed:\n  - ' + errors.join('\n  - '));
  return { ok: true, warnings };
}
