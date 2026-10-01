/* The food log's macro formula — the ONE reference for what a logged product, recipe or quick entry
 * contributes to the day. Used by the tests; the ingest service carries a line-by-line port in
 * services/health-ingest/src/food-calc.js (it is built from its own directory, so it cannot import
 * this file) and the page one in web/src/client/food.js (window.HCFood, the live preview of the add
 * sheet and the recipe editor). lib/nutrition/foodlog.test.mjs and web/src/client/food.test.mjs run
 * all three over FOODLOG_CASES, so a change here must be ported to both.
 *
 * Data honesty: a product carries per-100 (g or ml) kcal / protein / carbs / fat taken from its label
 * or Open Food Facts and confirmed by the owner; nothing is converted between g and ml, a serving is
 * only a serving when the product states its size, and a recipe with a missing product has no macros.
 * Log entries keep a SNAPSHOT of their macros, so editing a product later never rewrites history.
 * Rounding: kcal to whole kcal, macros to 1 decimal, applied once to the entry (day totals are sums
 * of the rounded snapshots). Pure: no I/O. */

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
});
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
/** A recipe's ingredient sum and its basis: per serving (kind serving) or per 100 g cooked (kind
 * batch), all unrounded; complete = every product found (missing = the ids that were not). */
export function recipeBasis(recipe, byId) {
  var totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  var missing = [];
  var raw = 0;
  (recipe && recipe.ingredients ? recipe.ingredients : []).forEach(function (ing) {
    var p = byId ? byId[ing.productId] : null;
    if (!p || !p.per100 || !fin(ing.amount) || ing.amount <= 0) { missing.push(ing.productId); return; }
    var m = scaleMacros(p.per100, ing.amount);
    totals = { kcal: totals.kcal + m.kcal, protein: totals.protein + m.protein, carbs: totals.carbs + m.carbs, fat: totals.fat + m.fat };
    raw += ing.amount;
  });
  var complete = missing.length === 0 && raw > 0;
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
  { name: 'basis: 3 servings', fn: 'entryFromBasis', args: [{ perServing: { kcal: 218, protein: 10.5, carbs: 30.7, fat: 5.2 }, per100: null }, 'serving', 3, 'serving'], expect: { kcal: 654, protein: 31.5, carbs: 92.1, fat: 15.6 } },
  { name: 'basis: 250 g cooked', fn: 'entryFromBasis', args: [{ perServing: null, per100: { kcal: 89, protein: 6.9, carbs: 13.6, fat: 0.5 } }, 'batch', 250, 'g'], expect: { kcal: 223, protein: 17.3, carbs: 34, fat: 1.3 } },
  { name: 'basis: wrong unit', fn: 'entryFromBasis', args: [{ perServing: { kcal: 1, protein: 1, carbs: 1, fat: 1 }, per100: null }, 'serving', 100, 'g'], expect: null },
  { name: 'basis: none', fn: 'entryFromBasis', args: [null, 'batch', 100, 'g'], expect: null },
  { name: 'day totals', fn: 'dayTotals', args: [[{ kcal: 222, protein: 13.1, carbs: 22.9, fat: 8.2 }, { kcal: 450, protein: null, carbs: 60, fat: null }, { kcal: 75, protein: 12.5, carbs: 5, fat: 0.3 }]], expect: { kcal: 747, protein: 25.6, carbs: 87.9, fat: 8.5, count: 3, missing: { protein: true, carbs: false, fat: true } } },
  { name: 'atwater ok', fn: 'atwaterOk', args: [{ kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.9 }], expect: true },
  { name: 'atwater off', fn: 'atwaterOk', args: [{ kcal: 100, protein: 30, carbs: 30, fat: 10 }], expect: false },
  { name: 'atwater near zero', fn: 'atwaterOk', args: [{ kcal: 3, protein: 0.1, carbs: 0.2, fat: 0 }], expect: true },
]);

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
