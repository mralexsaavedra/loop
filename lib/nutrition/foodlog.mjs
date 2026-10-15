/* The food log's macro formula — the ONE reference for what a logged product, recipe or quick entry
 * contributes to the day. The ingest service runs a GENERATED copy, services/loop-ingest/src/food-calc.js
 * (it is built from its own directory, so it cannot import this file): scripts/gen-food-calc.mjs writes it
 * from the SERVER descriptor below (`npm run gen:food-calc`). The page runs THESE functions: lib/nutrition/client.mjs emits them as HC_FOODLOG, which
 * web/src/client/food-core.js reads (window.HCFood, the live preview of the add sheet and the recipe
 * editor; no copy). lib/nutrition/foodlog.test.mjs, web/src/client/food.test.mjs and the built-page test
 * run them over FOODLOG_CASES (lib/nutrition/foodlog.cases.mjs, the test-only parity cases). A change is made
 * HERE, then `npm run gen:food-calc` (a root test fails while the committed food-calc.js differs).
 *
 * Data honesty: a product carries per-100 (g or ml) kcal / protein / carbs / fat taken from its label
 * or Open Food Facts and confirmed by the user; nothing is converted between g and ml, a serving is
 * only a serving when the product states its size, and a recipe with a missing product has no macros.
 * Log entries keep a SNAPSHOT of their macros, so editing a product later never rewrites history.
 * Rounding: kcal to whole kcal, macros to 1 decimal, applied once to the entry (day totals are sums
 * of the rounded snapshots). Pure: no I/O. */
import { fin, roundEps, ROUND_EPS } from './num.mjs';

export const FOOD_STORES = Object.freeze(['mercadona', 'dia', 'eroski', 'other']);
export const FOOD_UNITS = Object.freeze(['g', 'ml']);
export const ENTRY_UNITS = Object.freeze(['g', 'ml', 'serving']);
export const FOOD_SOURCES = Object.freeze(['off', 'label', 'manual']);
export const RECIPE_KINDS = Object.freeze(['serving', 'batch']);
export const REF_TYPES = Object.freeze(['product', 'recipe', 'quick']);
// the meal slots of lib/nutrition/slots.mjs MEAL_SLOTS (a test pins that they agree)
export const FOOD_MEALS = Object.freeze(['breakfast', 'lunch', 'preworkout', 'postworkout', 'dinner', 'snack']);
// Atwater sanity check of a label: 4 p + 4 c + 9 f within ±25 % of the stated kcal, or within
// 10 kcal for near-zero foods (fibre, polyols and alcohol make real labels deviate: "save anyway")
export const ATWATER_TOL = 0.25;
export const ATWATER_ABS_KCAL = 10;
// Shared input limits: the ingest validation (services/loop-ingest/src/food-calc.js, generated from
// this file) and the page (baked as FOOD_CONST.limits) read the same numbers.
export const FOOD_LIMITS = Object.freeze({
  nameMax: 120, // product / recipe name, quick-entry label
  brandMax: 80,
  queryMin: 2, // Open Food Facts text search
  queryMax: 80,
  barcodePattern: '^[0-9]{8,14}$', // EAN-8 … GTIN-14
  kcal100Max: 900, // per 100 g / ml (pure fat is ~900)
  macro100Max: 100, // g per 100 g / ml
  servingMax: 5000, // g / ml
  amountMax: 5000, // one log entry: g, ml or servings
  ingredientAmountMax: 10000, // g / ml of one recipe ingredient
  ingredientsMax: 40,
  cookedMax: 20000, // g, a batch recipe's cooked weight
  servingsMax: 100,
  quickKcalMax: 5000,
  quickMacroMax: 500,
  basicKeyPattern: '^[a-z0-9][a-z0-9_-]{0,63}$', // a recipe basic's key in the public food DB (ingredients.json)
  targetWeightMin: 35, // kg, the settings' target weight (GET / PUT /food/settings)
  targetWeightMax: 250,
  summaryDaysMax: 120, // days one GET /food/log/summary may span
});
// the plan goals (lib/nutrition/targets.mjs GOALS, a test pins them equal): the settings' goal
export const SETTINGS_GOALS = Object.freeze(['maintain', 'cut', 'bulk']);
// the Registrar group of every stored slot (lib/nutrition/slots.mjs mealGroup, pinned by a test): the
// main meals are their own group, every other slot is an add-on
export const FOOD_GROUP_OF = Object.freeze({ breakfast: 'breakfast', lunch: 'lunch', preworkout: 'addon', postworkout: 'addon', dinner: 'dinner', snack: 'addon' });
export const SUMMARY_GROUPS = Object.freeze(['breakfast', 'lunch', 'dinner', 'addon']);
// A recipe ingredient is a product ({productId, amount}) or a BASIC of the public food DB, stored as a
// SNAPSHOT so the recipe never changes when ingredients.json does: {basic: key, name, unit, amount,
// per100: {kcal, protein, carbs, fat}}, per100 = per 100 g / ml, or per ONE unit for a 'ud' food (the
// basics table's model, lib/nutrition/basics.mjs), its amount a count of units on the UD_AMT scale.
export const RECIPE_BASIC_UNITS = Object.freeze(['g', 'ml', 'ud']);
export const BASIC_UD_AMT = 100; // one unit of a 'ud' basic on the per-100 scale (lib/nutrition/units.mjs UD_AMT)
const MACROS = ['protein', 'carbs', 'fat'];

// epsilon-safe (num.mjs roundEps: x.x5 never rounds down on floating-point noise, 0.1 + 0.2 …). NOT num.mjs
// round1, which is plain (2.3 + 0.05 -> 2.3 there, 2.4 here): the name is kept because the generated
// services/loop-ingest/src/food-calc.js exports it.
export function round1(v) {
  return roundEps(v, 1);
}
export function roundKcal(v) {
  return roundEps(v, 0);
}
/** kcal whole, macros 1 decimal; a null (unknown) value stays null. */
export function roundMacros(m) {
  if (!m) return null;
  return {
    kcal: fin(m.kcal) ? roundKcal(m.kcal) : null,
    protein: fin(m.protein) ? round1(m.protein) : null,
    carbs: fin(m.carbs) ? round1(m.carbs) : null,
    fat: fin(m.fat) ? round1(m.fat) : null,
  };
}
/** per100 × amount / 100, unrounded. */
export function scaleMacros(per100, amount) {
  var f = amount / 100;
  return { kcal: per100.kcal * f, protein: per100.protein * f, carbs: per100.carbs * f, fat: per100.fat * f };
}
function times(m, f) {
  return { kcal: m.kcal * f, protein: m.protein * f, carbs: m.carbs * f, fat: m.fat * f };
}
/** The amount in the product's own unit (g or ml), or null when the product cannot take that unit. */
export function productAmount(product, amount, unit) {
  if (!product || !product.per100 || !fin(amount) || amount <= 0) return null;
  if (unit === 'serving') return fin(product.servingSize) && product.servingSize > 0 ? amount * product.servingSize : null;
  return unit === product.unit ? amount : null;
}
/** A product entry's macros (rounded), or null. */
export function productEntry(product, amount, unit) {
  var a = productAmount(product, amount, unit);
  return a == null ? null : roundMacros(scaleMacros(product.per100, a));
}
function knownMacros(m) {
  return !!m && fin(m.kcal) && fin(m.protein) && fin(m.carbs) && fin(m.fat);
}
/** One recipe ingredient as {per100, amount on that per-100 scale, weight (g / ml, 0 for a 'ud' basic)}:
 * a product's label from byId, or a basic's own snapshot; null when it is unknown. */
export function ingredientBasis(ing, byId) {
  if (!ing || !fin(ing.amount) || ing.amount <= 0) return null;
  if (ing.basic != null) {
    if (!knownMacros(ing.per100)) return null;
    var ud = ing.unit === 'ud';
    return { per100: ing.per100, amount: ud ? ing.amount * BASIC_UD_AMT : ing.amount, weight: ud ? 0 : ing.amount };
  }
  var p = byId ? byId[ing.productId] : null;
  if (!p || !p.per100) return null;
  return { per100: p.per100, amount: ing.amount, weight: ing.amount };
}
/** A recipe's ingredient sum and its basis: per serving (kind serving) or per 100 g cooked (kind
 * batch), all unrounded; complete = every ingredient known (missing = the product ids / basic keys
 * that were not); rawWeight = the g / ml amounts. */
export function recipeBasis(recipe, byId) {
  var totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  var missing = [];
  var raw = 0;
  var n = 0;
  (recipe && recipe.ingredients ? recipe.ingredients : []).forEach(function (ing) {
    var x = ingredientBasis(ing, byId);
    if (!x) { missing.push(ing && ing.basic != null ? ing.basic : ing && ing.productId); return; }
    var m = scaleMacros(x.per100, x.amount);
    totals = { kcal: totals.kcal + m.kcal, protein: totals.protein + m.protein, carbs: totals.carbs + m.carbs, fat: totals.fat + m.fat };
    raw += x.weight;
    n++;
  });
  var complete = missing.length === 0 && n > 0;
  var perServing = null, per100 = null;
  if (complete && recipe.kind === 'serving' && fin(recipe.servings) && recipe.servings >= 1) perServing = times(totals, 1 / recipe.servings);
  if (complete && recipe.kind === 'batch' && fin(recipe.cookedWeightG) && recipe.cookedWeightG > 0) per100 = times(totals, 100 / recipe.cookedWeightG);
  return { complete: complete && (perServing != null || per100 != null), missing: missing, rawWeight: raw, totals: totals, perServing: perServing, per100: per100 };
}
/** An entry from a recipe basis ({perServing} or {per100}): servings of a per-serving recipe,
 * grams of a batch one (rounded); else null. */
export function entryFromBasis(basis, kind, amount, unit) {
  if (!basis || !fin(amount) || amount <= 0) return null;
  if (kind === 'serving' && unit === 'serving' && basis.perServing) return roundMacros(times(basis.perServing, amount));
  if (kind === 'batch' && unit === 'g' && basis.per100) return roundMacros(times(basis.per100, amount / 100));
  return null;
}
/** A recipe entry's macros (rounded): servings of a per-serving recipe, grams of a batch one; else null. */
export function recipeEntry(recipe, byId, amount, unit) {
  if (!fin(amount) || amount <= 0) return null;
  var b = recipeBasis(recipe, byId);
  if (!b.complete) return null;
  return entryFromBasis(b, recipe.kind, amount, unit);
}
/** The day from its entries' snapshots: sums of the known values; a macro unknown on any entry is
 * flagged in `missing` (the sum is then a lower bound, and the page says so). */
export function dayTotals(entries) {
  var t = { kcal: 0, protein: 0, carbs: 0, fat: 0, count: 0, missing: { protein: false, carbs: false, fat: false } };
  (entries || []).forEach(function (e) {
    t.count++;
    if (fin(e.kcal)) t.kcal += e.kcal;
    MACROS.forEach(function (k) {
      if (fin(e[k])) t[k] += e[k];
      else t.missing[k] = true;
    });
  });
  t.kcal = roundKcal(t.kcal);
  MACROS.forEach(function (k) { t[k] = round1(t[k]); });
  return t;
}
/** Per-day summaries of log entries (any order, any dates), sorted by date: {date, k, p, c, f, n,
 * missing: {p, c, f}, groups: {breakfast, lunch, dinner, addon} = entries per Registrar group}, the sums
 * from dayTotals. A macro NO entry of the day states is null (never 0); one that some entry lacks is
 * flagged in missing, so its value is a minimum. Feeds the food log's adherence view. */
export function daySummaries(entries) {
  var byDate = {};
  (entries || []).forEach(function (e) {
    if (!e || typeof e.date !== 'string') return;
    (byDate[e.date] = byDate[e.date] || []).push(e);
  });
  return Object.keys(byDate).sort().map(function (date) {
    var list = byDate[date], t = dayTotals(list);
    var groups = {};
    SUMMARY_GROUPS.forEach(function (g) { groups[g] = 0; });
    list.forEach(function (e) { var g = FOOD_GROUP_OF[e.meal]; if (g) groups[g]++; });
    var known = function (k) { return list.some(function (e) { return fin(e[k]); }) ? t[k] : null; };
    return {
      date: date, k: t.kcal, p: known('protein'), c: known('carbs'), f: known('fat'), n: t.count,
      missing: { p: t.missing.protein, c: t.missing.carbs, f: t.missing.fat }, groups: groups,
    };
  });
}
/* true when the label's kcal agree with its macros (see ATWATER_TOL / ATWATER_ABS_KCAL). */
export function atwaterOk(m) {
  var est = 4 * m.protein + 4 * m.carbs + 9 * m.fat;
  return Math.abs(est - m.kcal) <= Math.max(ATWATER_TOL * m.kcal, ATWATER_ABS_KCAL);
}

/* ---------- basics: the generic foods of the public food DB, logged without a product ----------
 * A basic is one food of data/nutrition/ingredients.json as the page bakes it (lib/nutrition/basics.mjs
 * buildBasics): {k, n (localized name), u: 'g' | 'ml' | 'ud', m: [kcal, protein, carbs, fat] per 100 of u
 * (a 'ud' food: per 100 = ONE unit, the DB's UD_AMT scale), pc?: {a: one piece in u, r: grams of one
 * 'ud' piece | null, o, m}}. Average table values, not a label: the add sheet logs them as a QUICK
 * entry with these four macros and a label naming the amount (the server never computes a quick entry,
 * so food-calc.js has no copy). Modes: 'piece' (a countable food, or a 'ud' food), or the food's own
 * unit — a 'ud' food also in grams when its piece states them. Never g <-> ml. The page (food-*.js) runs
 * basicModes / basicAmount / basicEntry / basicLabel / basicConvert from HC_FOODLOG; food.test.mjs runs BASIC_CASES (foodlog.cases.mjs). */

function round2(v) {
  return roundEps(v, 2);
}
// grams (or ml) of one piece in `mode`, or null: a g / ml food's piece in its own unit, a 'ud' piece in grams
function pieceWeight(b, mode) {
  var pc = b && b.pc;
  if (!pc) return null;
  if (b.u === 'ud') return mode === 'g' && fin(pc.r) && pc.r > 0 ? pc.r : null;
  return mode === b.u && fin(pc.a) && pc.a > 0 ? pc.a : null;
}
/** The modes a basic can be logged in: pieces first when it has them, then its own unit. */
export function basicModes(b) {
  if (!b) return [];
  if (b.u === 'ud') return pieceWeight(b, 'g') ? ['piece', 'g'] : ['piece'];
  return b.pc ? ['piece', b.u] : [b.u];
}
/** The amount in the basic's own scale (g / ml, or UD_AMT per unit), or null when the mode does not fit. */
export function basicAmount(b, amount, mode) {
  if (!b || !b.m || !fin(amount) || amount <= 0) return null;
  if (mode === 'piece') {
    if (b.u === 'ud') return amount * (b.pc && fin(b.pc.a) ? b.pc.a : 100);
    return b.pc && fin(b.pc.a) ? amount * b.pc.a : null;
  }
  if (mode === b.u) return amount;
  var w = b.u === 'ud' ? pieceWeight(b, mode) : null;
  return w ? (amount / w) * 100 : null;
}
/** A basic entry's macros (rounded like every entry), or null. */
export function basicEntry(b, amount, mode) {
  var a = basicAmount(b, amount, mode);
  return a == null ? null : roundMacros(scaleMacros({ kcal: b.m[0], protein: b.m[1], carbs: b.m[2], fat: b.m[3] }, a));
}
/** The quick entry's label: "Huevo · 2 ud (~100 g)", "Leche · 250 ml" (w = {dec, g, ml, ud}: the
 * decimal mark and the unit words), capped at FOOD_LIMITS.nameMax; null when the mode does not fit. */
export function basicLabel(b, amount, mode, w) {
  if (basicAmount(b, amount, mode) == null) return null;
  var num = function (x) { return String(round2(x)).replace('.', w.dec); };
  var s;
  if (mode === 'piece') {
    var unit = b.u === 'ud' ? 'g' : b.u;
    var pw = pieceWeight(b, unit);
    s = num(amount) + ' ' + w.ud + (pw ? ' (~' + roundEps(amount * pw, 0) + ' ' + w[unit] + ')' : '');
  } else {
    s = num(amount) + ' ' + w[mode];
  }
  return (b.n + ' · ' + s).slice(0, FOOD_LIMITS.nameMax);
}
/** The same food amount in another mode (pieces <-> grams): whole g / ml, pieces to 2 decimals; null
 * when either mode does not fit. */
export function basicConvert(b, amount, from, to) {
  var a = basicAmount(b, amount, from);
  if (a == null || basicModes(b).indexOf(to) < 0) return null;
  if (from === to) return amount;
  var per = basicAmount(b, 1, to); // one unit of `to` in the basic's own scale
  var v = a / per;
  return to === 'piece' ? round2(v) : roundEps(v, 0);
}
/** A basic as a recipe ingredient: the SNAPSHOT the recipe keeps ({basic, name, unit, amount, per100},
 * see RECIPE_BASIC_UNITS), the amount in the basic's own unit — g / ml, or a count of units for a 'ud'
 * food — rounded to 1 decimal like the stored amount; null when the mode does not fit or the amount
 * rounds to nothing. Built by the page only (the service validates what it is sent). */
export function basicIngredient(b, amount, mode) {
  var a = basicAmount(b, amount, mode);
  if (a == null) return null;
  var v = round1(b.u === 'ud' ? a / BASIC_UD_AMT : a);
  if (!(v > 0)) return null;
  return { basic: b.k, name: String(b.n).slice(0, FOOD_LIMITS.nameMax), unit: b.u, amount: v, per100: { kcal: b.m[0], protein: b.m[1], carbs: b.m[2], fat: b.m[3] } };
}

/** What lib/nutrition/client.mjs emits as the page's `var HC_FOODLOG` (classicGlobal): THESE functions' own
 * source (+ num.mjs fin / roundEps), so the page's live preview computes exactly like the lib. Only the pure
 * formula: no daySummaries (the server answers those). A plain descriptor: lib/nutrition never imports lib/format. */
export const CLIENT = {
  consts: { ATWATER_TOL, ATWATER_ABS_KCAL, BASIC_UD_AMT, MACROS },
  hidden: { FOOD_LIMITS, ROUND_EPS },
  fns: {
    fin, roundEps, round1, roundKcal, round2, roundMacros, scaleMacros, times, productAmount, productEntry, knownMacros,
    ingredientBasis, recipeBasis, entryFromBasis, recipeEntry, dayTotals, atwaterOk, pieceWeight, basicModes, basicAmount,
    basicEntry, basicLabel, basicConvert, basicIngredient,
  },
};

/** What scripts/gen-food-calc.mjs writes as the ingest service's services/loop-ingest/src/food-calc.js
 * (lib/build/esm-module.mjs esmModule): the enums, the input limits and THESE functions' own source (+
 * num.mjs fin / roundEps), so the server stores exactly the snapshots the lib computes. The service's
 * share only: no basics (the server never computes a quick entry). The exported names are what the
 * service imports (src/food.js, src/off.js). A plain descriptor: lib/nutrition never imports lib/build. */
export const SERVER = {
  consts: {
    FOOD_STORES, FOOD_UNITS, ENTRY_UNITS, FOOD_SOURCES, RECIPE_KINDS, REF_TYPES, FOOD_MEALS, ATWATER_TOL, ATWATER_ABS_KCAL,
    FOOD_LIMITS, SETTINGS_GOALS, FOOD_GROUP_OF, SUMMARY_GROUPS, RECIPE_BASIC_UNITS, BASIC_UD_AMT,
  },
  hidden: { MACROS, ROUND_EPS },
  local: { fin, roundEps, times, knownMacros },
  fns: {
    round1, roundKcal, roundMacros, scaleMacros, productAmount, productEntry, ingredientBasis, recipeBasis, entryFromBasis,
    recipeEntry, dayTotals, daySummaries, atwaterOk,
  },
};
