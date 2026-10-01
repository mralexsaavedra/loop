/* The food log's macro formula and shared input limits, server side: a LITERAL, line-by-line port of
 * lib/nutrition/foodlog.mjs, which is AUTHORITATIVE. This service is built from its own directory (see
 * the Dockerfile), so it cannot import lib/. That is also why the code keeps the reference's style
 * (`var`, semicolons) instead of this service's: a diff against the reference stays empty. The repo's
 * lib/nutrition/foodlog.test.mjs runs this file and the reference over the same FOODLOG_CASES and checks
 * that every constant (FOOD_LIMITS included) is equal, so a change is made there first, then copied here
 * (and into the page's port, web/src/client/food.js).
 *
 * Nothing is converted between g and ml, a serving exists only when the product states its size, a
 * recipe with a missing product has no macros, and a log entry stores its rounded SNAPSHOT (kcal
 * whole, macros 1 decimal) so a later product edit never rewrites history. Pure: no I/O. */

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
// Shared input limits: the ingest validation (services/health-ingest/src/food-calc.js carries a copy,
// pinned equal by a test) and the page (baked as FOOD_CONST.limits) read the same numbers.
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
});
// A recipe ingredient is a product ({productId, amount}) or a BASIC of the public food DB, stored as a
// SNAPSHOT so the recipe never changes when ingredients.json does: {basic: key, name, unit, amount,
// per100: {kcal, protein, carbs, fat}}, per100 = per 100 g / ml, or per ONE unit for a 'ud' food (the
// basics table's model, lib/nutrition/basics.mjs), its amount a count of units on the UD_AMT scale.
export const RECIPE_BASIC_UNITS = Object.freeze(['g', 'ml', 'ud']);
export const BASIC_UD_AMT = 100; // one unit of a 'ud' basic on the per-100 scale (lib/nutrition/units.mjs UD_AMT)
const MACROS = ['protein', 'carbs', 'fat'];

function fin(v) {
  return typeof v === 'number' && isFinite(v);
}
// the tiny epsilon keeps x.x5 from rounding down on floating-point noise (0.1 + 0.2 …)
export function round1(v) {
  return Math.round(v * 10 + 1e-9) / 10;
}
export function roundKcal(v) {
  return Math.round(v + 1e-9);
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
/** true when the label's kcal agree with its macros (see ATWATER_TOL / ATWATER_ABS_KCAL). */
export function atwaterOk(m) {
  var est = 4 * m.protein + 4 * m.carbs + 9 * m.fat;
  return Math.abs(est - m.kcal) <= Math.max(ATWATER_TOL * m.kcal, ATWATER_ABS_KCAL);
}
