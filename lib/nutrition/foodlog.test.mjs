/* lib/nutrition/foodlog.mjs — the ONE macro formula of the food log (products, recipes, log entries,
 * day totals, the Atwater sanity check). The ingest service (services/health-ingest/src/food-calc.js)
 * and the page (web/src/client/food.js) carry line-by-line ports; the parity tests below and in
 * web/src/client/food.test.mjs run all of them over FOODLOG_CASES. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from './foodlog.mjs';
import * as S from '../../services/health-ingest/src/food-calc.js';

const YOGURT = { id: 1, unit: 'g', per100: { kcal: 60, protein: 10, carbs: 4, fat: 0.2 }, servingSize: 125 };
const MILK = { id: 2, unit: 'ml', per100: { kcal: 46, protein: 3.4, carbs: 4.8, fat: 1.6 }, servingSize: null };
const OATS = { id: 3, unit: 'g', per100: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 }, servingSize: null };
const LENTILS = { id: 4, unit: 'g', per100: { kcal: 314, protein: 23.8, carbs: 48.8, fat: 1.9 }, servingSize: null };
const byId = { 1: YOGURT, 2: MILK, 3: OATS, 4: LENTILS };

test('constants: stores, units, sources, kinds, ref types and meal slots are the documented enums', () => {
  assert.deepEqual(F.FOOD_STORES, ['mercadona', 'dia', 'eroski', 'other']);
  assert.deepEqual(F.FOOD_UNITS, ['g', 'ml']);
  assert.deepEqual(F.ENTRY_UNITS, ['g', 'ml', 'serving']);
  assert.deepEqual(F.FOOD_SOURCES, ['off', 'label', 'manual']);
  assert.deepEqual(F.RECIPE_KINDS, ['serving', 'batch']);
  assert.deepEqual(F.REF_TYPES, ['product', 'recipe', 'quick']);
  assert.deepEqual(F.FOOD_MEALS, ['breakfast', 'lunch', 'preworkout', 'postworkout', 'dinner', 'snack']);
});

test('productEntry: grams in the product unit, or servings of its serving size; kcal whole, macros 1 decimal', () => {
  assert.deepEqual(F.productEntry(YOGURT, 125, 'g'), { kcal: 75, protein: 12.5, carbs: 5, fat: 0.3 });
  assert.deepEqual(F.productEntry(YOGURT, 2, 'serving'), { kcal: 150, protein: 25, carbs: 10, fat: 0.5 });
  assert.deepEqual(F.productEntry(MILK, 250, 'ml'), { kcal: 115, protein: 8.5, carbs: 12, fat: 4 });
});

test('productEntry: a unit the product cannot take is null (never a guessed conversion)', () => {
  assert.equal(F.productEntry(MILK, 1, 'serving'), null, 'no serving size');
  assert.equal(F.productEntry(MILK, 100, 'g'), null, 'ml product in grams');
  assert.equal(F.productEntry(YOGURT, 100, 'ml'), null);
  assert.equal(F.productEntry(YOGURT, 0, 'g'), null, 'amount must be > 0');
  assert.equal(F.productEntry(YOGURT, NaN, 'g'), null);
  assert.equal(F.productEntry(null, 100, 'g'), null);
});

test('recipeBasis: a per-serving recipe divides the ingredient sum by its servings', () => {
  const r = { kind: 'serving', servings: 2, ingredients: [{ productId: 3, amount: 80 }, { productId: 2, amount: 300 }] };
  const b = F.recipeBasis(r, byId);
  assert.equal(b.complete, true);
  assert.equal(b.rawWeight, 380);
  assert.deepEqual(F.roundMacros(b.totals), { kcal: 436, protein: 21, carbs: 61.4, fat: 10.4 });
  assert.deepEqual(F.roundMacros(b.perServing), { kcal: 218, protein: 10.5, carbs: 30.7, fat: 5.2 });
  assert.equal(b.per100, null);
  assert.deepEqual(F.recipeEntry(r, byId, 1, 'serving'), { kcal: 218, protein: 10.5, carbs: 30.7, fat: 5.2 });
  assert.deepEqual(F.recipeEntry(r, byId, 3, 'serving'), { kcal: 653, protein: 31.5, carbs: 92, fat: 15.6 });
  assert.equal(F.recipeEntry(r, byId, 100, 'g'), null, 'a per-serving recipe is logged in servings');
});

test('recipeBasis: a batch recipe is per 100 g of COOKED food (cooked weight, not raw)', () => {
  const r = { kind: 'batch', cookedWeightG: 1000, ingredients: [{ productId: 4, amount: 300 }] };
  const b = F.recipeBasis(r, byId);
  assert.deepEqual(F.roundMacros(b.per100), { kcal: 94, protein: 7.1, carbs: 14.6, fat: 0.6 });
  assert.equal(b.perServing, null);
  assert.deepEqual(F.recipeEntry(r, byId, 250, 'g'), { kcal: 236, protein: 17.9, carbs: 36.6, fat: 1.4 });
  assert.equal(F.recipeEntry(r, byId, 1, 'serving'), null);
});

test('recipeBasis: a missing product makes the recipe incomplete, and it cannot be logged', () => {
  const r = { kind: 'serving', servings: 1, ingredients: [{ productId: 3, amount: 50 }, { productId: 99, amount: 10 }] };
  const b = F.recipeBasis(r, byId);
  assert.equal(b.complete, false);
  assert.deepEqual(b.missing, [99]);
  assert.equal(F.recipeEntry(r, byId, 1, 'serving'), null);
});

test('dayTotals sums the entry snapshots; a macro missing on any entry is flagged, never invented', () => {
  const t = F.dayTotals([
    { kcal: 218, protein: 10.5, carbs: 30.7, fat: 5.2 },
    { kcal: 300, protein: null, carbs: null, fat: null },
    { kcal: 75, protein: 12.5, carbs: 5, fat: 0.3 },
  ]);
  assert.deepEqual(t, { kcal: 593, protein: 23, carbs: 35.7, fat: 5.5, count: 3, missing: { protein: true, carbs: true, fat: true } });
  assert.deepEqual(F.dayTotals([]), { kcal: 0, protein: 0, carbs: 0, fat: 0, count: 0, missing: { protein: false, carbs: false, fat: false } });
});

test('atwaterOk: 4p + 4c + 9f within ±25 % of kcal (or 10 kcal, for near-zero foods)', () => {
  assert.equal(F.atwaterOk({ kcal: 60, protein: 10, carbs: 4, fat: 0.2 }), true);
  assert.equal(F.atwaterOk({ kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 }), true);
  assert.equal(F.atwaterOk({ kcal: 100, protein: 30, carbs: 30, fat: 10 }), false, '330 vs 100');
  assert.equal(F.atwaterOk({ kcal: 4, protein: 0, carbs: 0, fat: 0 }), true, 'a diet soda');
  assert.equal(F.atwaterOk({ kcal: 0, protein: 0, carbs: 0, fat: 0 }), true);
  assert.equal(F.atwaterOk({ kcal: 200, protein: 0, carbs: 0, fat: 0 }), false);
});

test('FOODLOG_CASES: every case has the documented expectation in the reference', () => {
  assert.ok(F.FOODLOG_CASES.length >= 10);
  for (const c of F.FOODLOG_CASES) assert.deepEqual(F.runCase(c), c.expect, c.name);
});

test('parity: the ingest service computes exactly what the reference computes', () => {
  for (const c of F.FOODLOG_CASES) assert.deepEqual(F.runCase(c, S), c.expect, c.name);
  for (const k of ['FOOD_STORES', 'FOOD_UNITS', 'ENTRY_UNITS', 'FOOD_SOURCES', 'RECIPE_KINDS', 'REF_TYPES', 'FOOD_MEALS', 'ATWATER_TOL', 'ATWATER_ABS_KCAL', 'FOOD_LIMITS']) {
    assert.deepEqual(S[k], F[k], k);
  }
});

test('FOOD_MEALS are the meal slots of lib/nutrition/slots.mjs', async () => {
  const { MEAL_SLOTS } = await import('./slots.mjs');
  assert.deepEqual(F.FOOD_MEALS, MEAL_SLOTS);
});

/* ---------- basics: generic foods of the public food DB (ingredients.json), logged as quick entries ---------- */
const EGG = { k: 'huevo', n: 'Huevo', u: 'ud', m: [72, 6.3, 0.4, 5], pc: { a: 100, r: 50, o: 'huevo', m: 'huevos' } };
const BANANA = { k: 'platano', n: 'Plátano', u: 'g', m: [88, 0.8, 22.5, 0.3], pc: { a: 120, r: null, o: 'plátano mediano', m: 'plátanos medianos' } };
const MILK_B = { k: 'leche', n: 'Leche', u: 'ml', m: [46, 3.4, 4.8, 1.7] };
const ES_WORDS = { dec: ',', g: 'g', ml: 'ml', ud: 'ud' };

test('basicModes: pieces first for a countable food, then its own unit (a "ud" food in grams only with a grams reference)', () => {
  assert.deepEqual(F.basicModes(EGG), ['piece', 'g']);
  assert.deepEqual(F.basicModes(BANANA), ['piece', 'g']);
  assert.deepEqual(F.basicModes(MILK_B), ['ml']);
  assert.deepEqual(F.basicModes({ ...EGG, pc: { ...EGG.pc, r: null } }), ['piece'], 'no grams reference: pieces only');
  assert.deepEqual(F.basicModes({ ...EGG, pc: undefined }), ['piece'], 'a "ud" food is counted in units');
  assert.deepEqual(F.basicModes(null), []);
});

test('basicEntry: per-100 (or per unit) × the amount in the chosen mode, rounded like every entry; never g <-> ml', () => {
  assert.deepEqual(F.basicEntry(EGG, 2, 'piece'), { kcal: 144, protein: 12.6, carbs: 0.8, fat: 10 });
  assert.deepEqual(F.basicEntry(EGG, 60, 'g'), { kcal: 86, protein: 7.6, carbs: 0.5, fat: 6 }, '60 g = 1.2 eggs of ~50 g');
  assert.deepEqual(F.basicEntry(BANANA, 1, 'piece'), { kcal: 106, protein: 1, carbs: 27, fat: 0.4 }, 'one medium banana ~120 g');
  assert.deepEqual(F.basicEntry(MILK_B, 250, 'ml'), { kcal: 115, protein: 8.5, carbs: 12, fat: 4.3 });
  assert.equal(F.basicEntry(MILK_B, 100, 'g'), null, 'a liquid is never weighed in grams');
  assert.equal(F.basicEntry(MILK_B, 1, 'piece'), null, 'no piece');
  assert.equal(F.basicEntry(BANANA, 0, 'g'), null);
  assert.equal(F.basicEntry(BANANA, NaN, 'g'), null);
  assert.equal(F.basicEntry(null, 1, 'piece'), null);
});

test('basicLabel: the localized name + the amount in its unit, pieces with their weight reference', () => {
  assert.equal(F.basicLabel(EGG, 2, 'piece', ES_WORDS), 'Huevo · 2 ud (~100 g)');
  assert.equal(F.basicLabel(EGG, 1.5, 'piece', ES_WORDS), 'Huevo · 1,5 ud (~75 g)');
  assert.equal(F.basicLabel(EGG, 60, 'g', ES_WORDS), 'Huevo · 60 g');
  assert.equal(F.basicLabel(BANANA, 1, 'piece', ES_WORDS), 'Plátano · 1 ud (~120 g)');
  assert.equal(F.basicLabel(MILK_B, 250, 'ml', ES_WORDS), 'Leche · 250 ml');
  assert.equal(F.basicLabel(MILK_B, 250, 'g', ES_WORDS), null);
  const long = { ...MILK_B, n: 'x'.repeat(200) };
  assert.equal(F.basicLabel(long, 1, 'ml', ES_WORDS).length, F.FOOD_LIMITS.nameMax, 'capped like every label');
});

test('basicConvert: switching pieces <-> grams keeps the same food amount', () => {
  assert.equal(F.basicConvert(BANANA, 1, 'piece', 'g'), 120);
  assert.equal(F.basicConvert(BANANA, 150, 'g', 'piece'), 1.25);
  assert.equal(F.basicConvert(EGG, 2, 'piece', 'g'), 100);
  assert.equal(F.basicConvert(EGG, 75, 'g', 'piece'), 1.5);
  assert.equal(F.basicConvert(MILK_B, 250, 'ml', 'ml'), 250);
  assert.equal(F.basicConvert(MILK_B, 250, 'ml', 'g'), null);
  assert.equal(F.basicConvert(BANANA, 0, 'piece', 'g'), null);
});

test('BASIC_CASES: every case has the documented expectation in the reference', () => {
  assert.ok(F.BASIC_CASES.length >= 15);
  for (const c of F.BASIC_CASES) assert.deepEqual(F.runBasicCase(c), c.expect, c.name);
});
