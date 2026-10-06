/* lib/nutrition/categories.mjs — the closed set of food categories and the category of every ingredient
 * of the tracked public food DB (data/nutrition/ingredients.json). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOOD_CATS, catOf, validateIngredientCats } from './categories.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ING = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/ingredients.json'), 'utf8')).ingredients;
const LIST = 'protein, carb, legume, fruit, veg, dairy, cheese, fat, sweet, drink, sauce, other';

test('the category set is small and closed', () => {
  assert.deepEqual([...FOOD_CATS], LIST.split(', '));
  assert.ok(Object.isFrozen(FOOD_CATS));
});

test('catOf: a valid category, else null (no prototype keys)', () => {
  assert.equal(catOf({ a: { cat: 'veg' } }, 'a'), 'veg');
  assert.equal(catOf({ a: { cat: 'nope' } }, 'a'), null);
  assert.equal(catOf({ a: {} }, 'a'), null);
  assert.equal(catOf({}, 'constructor'), null);
  assert.equal(catOf({ a: { cat: 'constructor' } }, 'a'), null);
});

test('validateIngredientCats: a missing cat warns, an unknown one is an error', () => {
  const r = validateIngredientCats({ ok: { cat: 'fruit' }, nocat: {}, bad: { cat: 'snack' }, num: { cat: 3 } });
  assert.deepEqual(r.errors, [
    `ingredient bad: cat must be one of ${LIST} (got "snack")`,
    `ingredient num: cat must be one of ${LIST} (got 3)`,
  ]);
  assert.deepEqual(r.warnings, [`ingredient nocat has no cat (it never scales by category nor shows as a guide example); add one of ${LIST}`]);
});

test('validateIngredientCats: `swap` (false = a log-only basic) must be a boolean', () => {
  assert.deepEqual(validateIngredientCats({ a: { cat: 'veg', swap: false }, b: { cat: 'veg', swap: true } }).errors, []);
  assert.deepEqual(validateIngredientCats({ c: { cat: 'veg', swap: 'no' } }).errors, ['ingredient c: swap must be true or false when present (got "no")']);
});

test('the basics added for logging are marked log-only (swap: false) and carry average values', () => {
  for (const [k, ing] of Object.entries(ING)) if (ing.swap === false) assert.equal(ing.verified, false, `${k}: an average-value basic`);
  for (const k of ['pollo', 'atun', 'arroz', 'leche', 'platano', 'aceiteoliva', 'huevo']) assert.notEqual(ING[k].swap, false, k);
  for (const k of ['yogurnatural', 'panbarra', 'tomate', 'cafe', 'chocolate70']) assert.equal(ING[k].swap, false, k);
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
  for (const k of ['leche', 'yogurgriego']) assert.equal(ING[k].cat, 'dairy', k);
  for (const k of ['tranchete', 'mozzarella']) assert.equal(ING[k].cat, 'cheese', k);
  for (const k of ['aceiteoliva', 'avellanas']) assert.equal(ING[k].cat, 'fat', k);
  for (const k of ['miel', 'chocolate']) assert.equal(ING[k].cat, 'sweet', k);
  for (const k of ['cerveza', 'zumonaranja']) assert.equal(ING[k].cat, 'drink', k);
});

test('cheese is its own category: never read as milk or yogurt', () => {
  const dairy = Object.keys(ING).filter((k) => ING[k].cat === 'dairy');
  for (const k of ['tranchete', 'mozzarella']) assert.ok(!dairy.includes(k), k);
});
