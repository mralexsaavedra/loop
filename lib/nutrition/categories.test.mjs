/* lib/nutrition/categories.mjs — the closed set of food categories, the swap rule of each, and the
 * category of every ingredient of the tracked public food DB (data/nutrition/ingredients.json). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOOD_CATS, CAT_RULES, SWAP_BY, NONE_KEY, catOf, validateIngredientCats } from './categories.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ING = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/ingredients.json'), 'utf8')).ingredients;
const LIST = 'protein, carb, legume, fruit, veg, dairy, fat, sweet, drink, sauce, other';

test('the category set is small and closed; every category has an explicit swap rule', () => {
  assert.deepEqual([...FOOD_CATS], LIST.split(', '));
  assert.deepEqual(Object.keys(CAT_RULES), [...FOOD_CATS]);
  assert.deepEqual({ ...SWAP_BY }, { protein: 'protein', carbs: 'carbs', fat: 'fat', kcal: 'kcal', weight: 'weight' });
});

test('swap rule table: protein -> protein grams; carb / legume / fruit / sweet -> carb grams; fat -> fat grams; veg / other -> same grams; dairy / drink / sauce -> same kcal', () => {
  const by = Object.fromEntries(FOOD_CATS.map((c) => [c, CAT_RULES[c].by]));
  assert.deepEqual(by, {
    protein: 'protein', carb: 'carbs', legume: 'carbs', fruit: 'carbs', veg: 'weight', dairy: 'kcal',
    fat: 'fat', sweet: 'carbs', drink: 'kcal', sauce: 'kcal', other: 'weight',
  });
});

test('a "none" option only where skipping is sensible: fruit, veg, dairy, sweet, drink, sauce', () => {
  assert.deepEqual(FOOD_CATS.filter((c) => CAT_RULES[c].skip === true), ['fruit', 'veg', 'dairy', 'sweet', 'drink', 'sauce']);
  for (const c of FOOD_CATS) assert.equal(typeof CAT_RULES[c].skip, 'boolean', c);
});

test('catOf: a valid category, else null (no prototype keys)', () => {
  assert.equal(catOf({ a: { cat: 'veg' } }, 'a'), 'veg');
  assert.equal(catOf({ a: { cat: 'nope' } }, 'a'), null);
  assert.equal(catOf({ a: {} }, 'a'), null);
  assert.equal(catOf({}, 'constructor'), null);
  assert.equal(catOf({ a: { cat: 'constructor' } }, 'a'), null);
});

test('validateIngredientCats: a missing cat warns (the food stays a fixed part), an unknown one is an error', () => {
  const r = validateIngredientCats({ ok: { cat: 'fruit' }, nocat: {}, bad: { cat: 'snack' }, num: { cat: 3 } });
  assert.deepEqual(r.errors, [
    `ingredient bad: cat must be one of ${LIST} (got "snack")`,
    `ingredient num: cat must be one of ${LIST} (got 3)`,
  ]);
  assert.deepEqual(r.warnings, [`ingredient nocat has no cat (Plan de hoy cannot offer swaps for it); add one of ${LIST}`]);
});

test('the "none" option key is reserved: no ingredient may use it', () => {
  assert.equal(NONE_KEY, 'none');
  assert.deepEqual(validateIngredientCats({ none: { cat: 'veg' } }).errors, ['ingredient key "none" is reserved (the "none" option of a food block)']);
});

test('every ingredient of the tracked food DB has a valid category', () => {
  assert.deepEqual(validateIngredientCats(ING), { errors: [], warnings: [] });
  for (const [k, ing] of Object.entries(ING)) assert.ok(FOOD_CATS.includes(ing.cat), k);
});

test('tracked categories match the plan hints: veg / legume keys, protein foods, fruit, dairy, fat, sweet', () => {
  for (const k of ['calabacin', 'pimiento', 'cebolla', 'zanahoria']) assert.equal(ING[k].cat, 'veg', k);
  for (const k of ['lentejas', 'alubias', 'garbanzos']) assert.equal(ING[k].cat, 'legume', k);
  for (const k of ['pollo', 'atun', 'merluza', 'salmon', 'huevo', 'claras', 'wheyup', 'pavo']) assert.equal(ING[k].cat, 'protein', k);
  for (const k of ['arroz', 'pasta', 'patata', 'avena', 'panecillo']) assert.equal(ING[k].cat, 'carb', k);
  for (const k of ['platano', 'manzana', 'pera', 'kiwi']) assert.equal(ING[k].cat, 'fruit', k);
  for (const k of ['leche', 'yogurgriego', 'tranchete']) assert.equal(ING[k].cat, 'dairy', k);
  for (const k of ['aceiteoliva', 'avellanas']) assert.equal(ING[k].cat, 'fat', k);
  for (const k of ['miel', 'chocolate']) assert.equal(ING[k].cat, 'sweet', k);
  for (const k of ['cerveza', 'zumonaranja']) assert.equal(ING[k].cat, 'drink', k);
});
