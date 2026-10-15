/* The food log's macro formula — the ONE reference for what a logged product, recipe or quick entry
 * contributes to the day. The ingest service runs a GENERATED copy, services/loop-ingest/src/food-calc.js
 * (it is built from its own directory, so it cannot import this file): scripts/gen-food-calc.mjs writes it
 * from the SERVER descriptor below (`npm run gen:food-calc`). The page runs THESE functions: lib/nutrition/client.mjs emits them as HC_FOODLOG, which
 * web/src/client/food-core.js reads (window.HCFood, the live preview of the add sheet and the recipe
 * editor; no copy). lib/nutrition/foodlog.test.mjs, web/src/client/food.test.mjs and the built-page test
 * run them over FOODLOG_CASES. A change is made HERE, then `npm run gen:food-calc` (a root test fails while
 * the committed food-calc.js differs).
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

// epsilon-safe (num.mjs roundEps: x.x5 never rounds down on floating-point noise, 0.1 + 0.2 …)
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
/** true when the label's kcal agree with its macros (see ATWATER_TOL / ATWATER_ABS_KCAL). */
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
 * basicModes / basicAmount / basicEntry / basicLabel / basicConvert from HC_FOODLOG; food.test.mjs runs BASIC_CASES. */
export const BASIC_MODES = Object.freeze(['piece', 'g', 'ml']);
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

/* ---------- shared cases (parity with the service and the page) ---------- */
const P_YOG = { id: 1, unit: 'g', per100: { kcal: 60, protein: 10, carbs: 4, fat: 0.2 }, servingSize: 125 };
const P_MILK = { id: 2, unit: 'ml', per100: { kcal: 46, protein: 3.4, carbs: 4.8, fat: 1.6 }, servingSize: null };
const P_OATS = { id: 3, unit: 'g', per100: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 }, servingSize: 40 };
const P_LENT = { id: 4, unit: 'g', per100: { kcal: 314, protein: 23.8, carbs: 48.8, fat: 1.9 }, servingSize: null };
const P_EGG = { id: 5, unit: 'g', per100: { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.9 }, servingSize: 60 };
const BY_ID = { 1: P_YOG, 2: P_MILK, 3: P_OATS, 4: P_LENT, 5: P_EGG };
const R_CREPES = { kind: 'serving', servings: 4, ingredients: [{ productId: 3, amount: 120 }, { productId: 5, amount: 180 }, { productId: 2, amount: 400 }] };
const R_SHAKE = { kind: 'serving', servings: 1, ingredients: [{ productId: 2, amount: 330 }, { productId: 3, amount: 40 }, { productId: 1, amount: 125 }] };
const R_LENTILS = { kind: 'batch', cookedWeightG: 1450, ingredients: [{ productId: 4, amount: 400 }, { productId: 1, amount: 50 }] };
const R_BROKEN = { kind: 'serving', servings: 2, ingredients: [{ productId: 3, amount: 50 }, { productId: 42, amount: 20 }] };
// a recipe that mixes a product with basics: one in grams (banana) and one counted in units (eggs)
const I_BANANA = { basic: 'platano', name: 'Plátano', unit: 'g', amount: 240, per100: { kcal: 88, protein: 0.8, carbs: 22.5, fat: 0.3 } };
const I_EGGS = { basic: 'huevo', name: 'Huevo', unit: 'ud', amount: 2, per100: { kcal: 72, protein: 6.3, carbs: 0.4, fat: 5 } };
const R_MIXED = { kind: 'serving', servings: 2, ingredients: [{ productId: 3, amount: 80 }, I_BANANA, I_EGGS] };
const R_MIXED_BATCH = { kind: 'batch', cookedWeightG: 500, ingredients: [{ productId: 3, amount: 80 }, I_BANANA, I_EGGS] };

export const FOODLOG_CASES = Object.freeze([
  { name: 'yogurt 125 g', fn: 'productEntry', args: [P_YOG, 125, 'g'], expect: { kcal: 75, protein: 12.5, carbs: 5, fat: 0.3 } },
  { name: 'yogurt 1.5 servings', fn: 'productEntry', args: [P_YOG, 1.5, 'serving'], expect: { kcal: 113, protein: 18.8, carbs: 7.5, fat: 0.4 } },
  { name: 'milk 330 ml', fn: 'productEntry', args: [P_MILK, 330, 'ml'], expect: { kcal: 152, protein: 11.2, carbs: 15.8, fat: 5.3 } },
  { name: 'milk has no serving size', fn: 'productEntry', args: [P_MILK, 1, 'serving'], expect: null },
  { name: 'milk in grams is refused', fn: 'productEntry', args: [P_MILK, 100, 'g'], expect: null },
  { name: 'oats 2 servings of 40 g', fn: 'productEntry', args: [P_OATS, 2, 'serving'], expect: { kcal: 298, protein: 10.8, carbs: 47, fat: 5.6 } },
  { name: 'egg 0 g is refused', fn: 'productEntry', args: [P_EGG, 0, 'g'], expect: null },
  { name: 'crepes: 1 of 4 servings', fn: 'recipeEntry', args: [R_CREPES, BY_ID, 1, 'serving'], expect: { kcal: 222, protein: 13.1, carbs: 22.7, fat: 8.2 } },
  { name: 'crepes: 2.5 servings', fn: 'recipeEntry', args: [R_CREPES, BY_ID, 2.5, 'serving'], expect: { kcal: 555, protein: 32.8, carbs: 56.8, fat: 20.4 } },
  { name: 'crepes in grams is refused', fn: 'recipeEntry', args: [R_CREPES, BY_ID, 100, 'g'], expect: null },
  { name: 'shake: 1 serving', fn: 'recipeEntry', args: [R_SHAKE, BY_ID, 1, 'serving'], expect: { kcal: 376, protein: 29.1, carbs: 44.3, fat: 8.3 } },
  { name: 'lentils: 300 g cooked', fn: 'recipeEntry', args: [R_LENTILS, BY_ID, 300, 'g'], expect: { kcal: 266, protein: 20.7, carbs: 40.8, fat: 1.6 } },
  { name: 'lentils in servings is refused', fn: 'recipeEntry', args: [R_LENTILS, BY_ID, 1, 'serving'], expect: null },
  { name: 'a recipe with a missing product cannot be logged', fn: 'recipeEntry', args: [R_BROKEN, BY_ID, 1, 'serving'], expect: null },
  { name: 'crepes basis', fn: 'recipeBasis', args: [R_CREPES, BY_ID], expect: { complete: true, missing: [], rawWeight: 700, totals: { kcal: 888, protein: 52.5, carbs: 90.9, fat: 32.6 }, perServing: { kcal: 222, protein: 13.1, carbs: 22.7, fat: 8.2 }, per100: null } },
  { name: 'lentils basis', fn: 'recipeBasis', args: [R_LENTILS, BY_ID], expect: { complete: true, missing: [], rawWeight: 450, totals: { kcal: 1286, protein: 100.2, carbs: 197.2, fat: 7.7 }, perServing: null, per100: { kcal: 89, protein: 6.9, carbs: 13.6, fat: 0.5 } } },
  { name: 'broken basis', fn: 'recipeBasis', args: [R_BROKEN, BY_ID], expect: { complete: false, missing: [42], rawWeight: 50, totals: { kcal: 186, protein: 6.8, carbs: 29.4, fat: 3.5 }, perServing: null, per100: null } },
  { name: 'mixed recipe (product + basic in g + basic in units): 1 of 2 servings', fn: 'recipeEntry', args: [R_MIXED, BY_ID, 1, 'serving'], expect: { kcal: 326, protein: 12.7, carbs: 50.9, fat: 8.2 } },
  { name: 'mixed recipe: 1.5 servings', fn: 'recipeEntry', args: [R_MIXED, BY_ID, 1.5, 'serving'], expect: { kcal: 490, protein: 19, carbs: 76.3, fat: 12.2 } },
  { name: 'mixed batch: 250 g cooked', fn: 'recipeEntry', args: [R_MIXED_BATCH, BY_ID, 250, 'g'], expect: { kcal: 326, protein: 12.7, carbs: 50.9, fat: 8.2 } },
  { name: 'mixed basis', fn: 'recipeBasis', args: [R_MIXED, BY_ID], expect: { complete: true, missing: [], rawWeight: 320, totals: { kcal: 653, protein: 25.3, carbs: 101.8, fat: 16.3 }, perServing: { kcal: 326, protein: 12.7, carbs: 50.9, fat: 8.2 }, per100: null } },
  { name: 'mixed batch basis', fn: 'recipeBasis', args: [R_MIXED_BATCH, BY_ID], expect: { complete: true, missing: [], rawWeight: 320, totals: { kcal: 653, protein: 25.3, carbs: 101.8, fat: 16.3 }, perServing: null, per100: { kcal: 131, protein: 5.1, carbs: 20.4, fat: 3.3 } } },
  { name: 'basics only, no product lookup', fn: 'recipeBasis', args: [{ kind: 'serving', servings: 1, ingredients: [I_EGGS] }, {}], expect: { complete: true, missing: [], rawWeight: 0, totals: { kcal: 144, protein: 12.6, carbs: 0.8, fat: 10 }, perServing: { kcal: 144, protein: 12.6, carbs: 0.8, fat: 10 }, per100: null } },
  { name: 'a basic with an unknown macro is missing', fn: 'recipeBasis', args: [{ kind: 'serving', servings: 1, ingredients: [{ ...I_EGGS, per100: { kcal: 72, protein: null, carbs: 0.4, fat: 5 } }] }, {}], expect: { complete: false, missing: ['huevo'], rawWeight: 0, totals: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, perServing: null, per100: null } },
  { name: 'basis: 3 servings', fn: 'entryFromBasis', args: [{ perServing: { kcal: 218, protein: 10.5, carbs: 30.7, fat: 5.2 }, per100: null }, 'serving', 3, 'serving'], expect: { kcal: 654, protein: 31.5, carbs: 92.1, fat: 15.6 } },
  { name: 'basis: 250 g cooked', fn: 'entryFromBasis', args: [{ perServing: null, per100: { kcal: 89, protein: 6.9, carbs: 13.6, fat: 0.5 } }, 'batch', 250, 'g'], expect: { kcal: 223, protein: 17.3, carbs: 34, fat: 1.3 } },
  { name: 'basis: wrong unit', fn: 'entryFromBasis', args: [{ perServing: { kcal: 1, protein: 1, carbs: 1, fat: 1 }, per100: null }, 'serving', 100, 'g'], expect: null },
  { name: 'basis: none', fn: 'entryFromBasis', args: [null, 'batch', 100, 'g'], expect: null },
  { name: 'day totals', fn: 'dayTotals', args: [[{ kcal: 222, protein: 13.1, carbs: 22.9, fat: 8.2 }, { kcal: 450, protein: null, carbs: 60, fat: null }, { kcal: 75, protein: 12.5, carbs: 5, fat: 0.3 }]], expect: { kcal: 747, protein: 25.6, carbs: 87.9, fat: 8.5, count: 3, missing: { protein: true, carbs: false, fat: true } } },
  { name: 'atwater ok', fn: 'atwaterOk', args: [{ kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.9 }], expect: true },
  { name: 'atwater off', fn: 'atwaterOk', args: [{ kcal: 100, protein: 30, carbs: 30, fat: 10 }], expect: false },
  { name: 'atwater near zero', fn: 'atwaterOk', args: [{ kcal: 3, protein: 0.1, carbs: 0.2, fat: 0 }], expect: true },
]);

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

/** Runs one case against an implementation (this module by default); recipeBasis is compared rounded. */
export function runCase(c, impl) {
  var I = impl || { productEntry: productEntry, recipeEntry: recipeEntry, entryFromBasis: entryFromBasis, recipeBasis: recipeBasis, dayTotals: dayTotals, atwaterOk: atwaterOk, roundMacros: roundMacros };
  var args = JSON.parse(JSON.stringify(c.args));
  var out = I[c.fn].apply(null, args);
  if (c.fn !== 'recipeBasis') return out;
  return {
    complete: out.complete, missing: out.missing, rawWeight: out.rawWeight,
    totals: I.roundMacros(out.totals), perServing: I.roundMacros(out.perServing), per100: I.roundMacros(out.per100),
  };
}

/* ---------- summary cases (parity with the service's GET /food/log/summary; the page reads its answer) ---------- */
const SUM_E = (date, meal, kcal, protein, carbs, fat) => ({ date: date, meal: meal, kcal: kcal, protein: protein, carbs: carbs, fat: fat });
export const SUMMARY_CASES = Object.freeze([
  { name: 'no entries', entries: [], expect: [] },
  {
    name: 'a complete day and a breakfast-only day, out of order',
    entries: [SUM_E('2030-01-09', 'dinner', 650, 45.2, 60, 22.1), SUM_E('2030-01-08', 'breakfast', 320, 18, 41.5, 9), SUM_E('2030-01-09', 'breakfast', 410, 24, 52, 11.3), SUM_E('2030-01-09', 'lunch', 820, 51, 90.4, 25)],
    expect: [
      { date: '2030-01-08', k: 320, p: 18, c: 41.5, f: 9, n: 1, missing: { p: false, c: false, f: false }, groups: { breakfast: 1, lunch: 0, dinner: 0, addon: 0 } },
      { date: '2030-01-09', k: 1880, p: 120.2, c: 202.4, f: 58.4, n: 3, missing: { p: false, c: false, f: false }, groups: { breakfast: 1, lunch: 1, dinner: 1, addon: 0 } },
    ],
  },
  {
    name: 'add-ons from three slots and a quick entry without macros',
    entries: [SUM_E('2030-01-10', 'snack', 150, null, null, null), SUM_E('2030-01-10', 'postworkout', 210, 30, 12.5, 4), SUM_E('2030-01-10', 'preworkout', 95, 1, 23, 0.3)],
    expect: [{ date: '2030-01-10', k: 455, p: 31, c: 35.5, f: 4.3, n: 3, missing: { p: true, c: true, f: true }, groups: { breakfast: 0, lunch: 0, dinner: 0, addon: 3 } }],
  },
  {
    name: 'only entries without macros: the macros are unknown, not zero',
    entries: [SUM_E('2030-01-11', 'lunch', 700, null, null, null)],
    expect: [{ date: '2030-01-11', k: 700, p: null, c: null, f: null, n: 1, missing: { p: true, c: true, f: true }, groups: { breakfast: 0, lunch: 1, dinner: 0, addon: 0 } }],
  },
]);

/* ---------- basics cases (parity with the page; the service never computes a quick entry) ---------- */
const B_EGG = { k: 'huevo', n: 'Huevo', u: 'ud', m: [72, 6.3, 0.4, 5], pc: { a: 100, r: 50, o: 'huevo', m: 'huevos' } };
const B_BANANA = { k: 'platano', n: 'Plátano', u: 'g', m: [88, 0.8, 22.5, 0.3], pc: { a: 120, r: null, o: 'plátano mediano', m: 'plátanos medianos' } };
const B_MILK = { k: 'leche', n: 'Leche', u: 'ml', m: [46, 3.4, 4.8, 1.7] };
const B_BEER = { k: 'cerveza', n: 'Cerveza', u: 'ml', m: [47, 0, 3.6, 0], pc: { a: 250, r: null, o: 'botellín', m: 'botellines' } };
const B_UNIT = { k: 'x', n: 'X', u: 'ud', m: [50, 1, 2, 3] };
const W_ES = { dec: ',', g: 'g', ml: 'ml', ud: 'ud' };
const W_EN = { dec: '.', g: 'g', ml: 'ml', ud: 'pc' };

export const BASIC_CASES = Object.freeze([
  { name: 'egg: modes', fn: 'basicModes', args: [B_EGG], expect: ['piece', 'g'] },
  { name: 'beer: modes', fn: 'basicModes', args: [B_BEER], expect: ['piece', 'ml'] },
  { name: 'milk: modes', fn: 'basicModes', args: [B_MILK], expect: ['ml'] },
  { name: 'unit food without piece: modes', fn: 'basicModes', args: [B_UNIT], expect: ['piece'] },
  { name: 'egg: 2 pieces', fn: 'basicEntry', args: [B_EGG, 2, 'piece'], expect: { kcal: 144, protein: 12.6, carbs: 0.8, fat: 10 } },
  { name: 'egg: 60 g', fn: 'basicEntry', args: [B_EGG, 60, 'g'], expect: { kcal: 86, protein: 7.6, carbs: 0.5, fat: 6 } },
  { name: 'egg in ml is refused', fn: 'basicEntry', args: [B_EGG, 100, 'ml'], expect: null },
  { name: 'banana: 1 piece', fn: 'basicEntry', args: [B_BANANA, 1, 'piece'], expect: { kcal: 106, protein: 1, carbs: 27, fat: 0.4 } },
  { name: 'banana: 150 g', fn: 'basicEntry', args: [B_BANANA, 150, 'g'], expect: { kcal: 132, protein: 1.2, carbs: 33.8, fat: 0.5 } },
  { name: 'milk: 250 ml', fn: 'basicEntry', args: [B_MILK, 250, 'ml'], expect: { kcal: 115, protein: 8.5, carbs: 12, fat: 4.3 } },
  { name: 'milk in grams is refused', fn: 'basicEntry', args: [B_MILK, 100, 'g'], expect: null },
  { name: 'beer: 2 bottles', fn: 'basicEntry', args: [B_BEER, 2, 'piece'], expect: { kcal: 235, protein: 0, carbs: 18, fat: 0 } },
  { name: 'unit food: 3 units', fn: 'basicEntry', args: [B_UNIT, 3, 'piece'], expect: { kcal: 150, protein: 3, carbs: 6, fat: 9 } },
  { name: 'unit food in grams is refused', fn: 'basicEntry', args: [B_UNIT, 100, 'g'], expect: null },
  { name: 'zero amount is refused', fn: 'basicEntry', args: [B_BANANA, 0, 'piece'], expect: null },
  { name: 'label: 2 eggs', fn: 'basicLabel', args: [B_EGG, 2, 'piece', W_ES], expect: 'Huevo · 2 ud (~100 g)' },
  { name: 'label: 1.5 eggs (es comma)', fn: 'basicLabel', args: [B_EGG, 1.5, 'piece', W_ES], expect: 'Huevo · 1,5 ud (~75 g)' },
  { name: 'label: egg in grams', fn: 'basicLabel', args: [B_EGG, 60, 'g', W_ES], expect: 'Huevo · 60 g' },
  { name: 'label: a bottle', fn: 'basicLabel', args: [B_BEER, 1, 'piece', W_ES], expect: 'Cerveza · 1 ud (~250 ml)' },
  { name: 'label: unit food', fn: 'basicLabel', args: [B_UNIT, 2, 'piece', W_ES], expect: 'X · 2 ud' },
  { name: 'label: en, decimal point', fn: 'basicLabel', args: [{ ...B_BANANA, n: 'Banana' }, 1.25, 'piece', W_EN], expect: 'Banana · 1.25 pc (~150 g)' },
  { name: 'label: wrong unit', fn: 'basicLabel', args: [B_MILK, 1, 'g', W_ES], expect: null },
  { name: 'convert: banana 150 g -> pieces', fn: 'basicConvert', args: [B_BANANA, 150, 'g', 'piece'], expect: 1.25 },
  { name: 'convert: 2 eggs -> grams', fn: 'basicConvert', args: [B_EGG, 2, 'piece', 'g'], expect: 100 },
  { name: 'convert: 1.3 bottles -> ml', fn: 'basicConvert', args: [B_BEER, 1.3, 'piece', 'ml'], expect: 325 },
  { name: 'convert: no such mode', fn: 'basicConvert', args: [B_MILK, 250, 'ml', 'piece'], expect: null },
  { name: 'ingredient: 2 eggs', fn: 'basicIngredient', args: [B_EGG, 2, 'piece'], expect: { basic: 'huevo', name: 'Huevo', unit: 'ud', amount: 2, per100: { kcal: 72, protein: 6.3, carbs: 0.4, fat: 5 } } },
  { name: 'ingredient: 60 g of egg = 1.2 units', fn: 'basicIngredient', args: [B_EGG, 60, 'g'], expect: { basic: 'huevo', name: 'Huevo', unit: 'ud', amount: 1.2, per100: { kcal: 72, protein: 6.3, carbs: 0.4, fat: 5 } } },
  { name: 'ingredient: 2 bananas = 240 g', fn: 'basicIngredient', args: [B_BANANA, 2, 'piece'], expect: { basic: 'platano', name: 'Plátano', unit: 'g', amount: 240, per100: { kcal: 88, protein: 0.8, carbs: 22.5, fat: 0.3 } } },
  { name: 'ingredient: 1.3 bottles = 325 ml', fn: 'basicIngredient', args: [B_BEER, 1.3, 'piece'], expect: { basic: 'cerveza', name: 'Cerveza', unit: 'ml', amount: 325, per100: { kcal: 47, protein: 0, carbs: 3.6, fat: 0 } } },
  { name: 'ingredient: milk 250.04 ml rounds like the store', fn: 'basicIngredient', args: [B_MILK, 250.04, 'ml'], expect: { basic: 'leche', name: 'Leche', unit: 'ml', amount: 250, per100: { kcal: 46, protein: 3.4, carbs: 4.8, fat: 1.7 } } },
  { name: 'ingredient: milk in grams is refused', fn: 'basicIngredient', args: [B_MILK, 100, 'g'], expect: null },
  { name: 'ingredient: rounds to nothing', fn: 'basicIngredient', args: [B_UNIT, 0.04, 'piece'], expect: null },
]);

/** Runs one basics case against an implementation (this module by default). */
export function runBasicCase(c, impl) {
  var I = impl || { basicModes: basicModes, basicEntry: basicEntry, basicLabel: basicLabel, basicConvert: basicConvert, basicIngredient: basicIngredient };
  return I[c.fn].apply(null, JSON.parse(JSON.stringify(c.args)));
}
