/* The shared parity cases of the food log formula (lib/nutrition/foodlog.mjs): FOODLOG_CASES, SUMMARY_CASES
 * and BASIC_CASES with their runners. One list, run against the lib (lib/nutrition/foodlog.test.mjs), the
 * service's generated src/food-calc.js (the same test) and the page's HC_FOODLOG (web/src/client/food.test.mjs,
 * web/test/client-globals-build.test.mjs). Test-time only: nothing at build or run time imports it. */
import {
  productEntry, recipeEntry, entryFromBasis, recipeBasis, dayTotals, atwaterOk, roundMacros,
  basicModes, basicEntry, basicLabel, basicConvert, basicIngredient,
} from './foodlog.mjs';

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

/** Runs one case against an implementation (lib/nutrition/foodlog.mjs by default); recipeBasis is compared rounded. */
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

/** Runs one basics case against an implementation (lib/nutrition/foodlog.mjs by default). */
export function runBasicCase(c, impl) {
  var I = impl || { basicModes: basicModes, basicEntry: basicEntry, basicLabel: basicLabel, basicConvert: basicConvert, basicIngredient: basicIngredient };
  return I[c.fn].apply(null, JSON.parse(JSON.stringify(c.args)));
}
