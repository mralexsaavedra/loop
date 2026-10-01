/* lib/nutrition/names.mjs — localized ingredient names and the shared display-name helpers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingName, lineName, itemName, hasAmount, validateIngredientNames } from './names.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ING = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/ingredients.json'), 'utf8')).ingredients;

const DB = {
  calabacin: { per: 100, unit: 'g', k: 17, p: 1.2, c: 3.1, g: 0.3, name: { es: 'Calabacín', en: 'Courgette' } },
  lentejas: { per: 100, unit: 'g', k: 116, p: 9, c: 20, g: 0.4, name: 'Lentils' },
  nameless: { per: 100, unit: 'g', k: 10, p: 0, c: 2, g: 0 },
};

test('ingName: {es, en} resolved by the locale, a plain string as is, no name -> the key', () => {
  assert.equal(ingName(DB, 'calabacin', 'es'), 'Calabacín');
  assert.equal(ingName(DB, 'calabacin', 'en'), 'Courgette');
  assert.equal(ingName(DB, 'calabacin'), 'Courgette', 'default locale en');
  assert.equal(ingName(DB, 'lentejas', 'es'), 'Lentils', 'a plain string stays valid (backward compat)');
  assert.equal(ingName(DB, 'nameless', 'es'), 'nameless');
  assert.equal(ingName(DB, 'missing', 'es'), 'missing');
  assert.equal(ingName({ x: { name: { es: 'Equis' } } }, 'x', 'en'), 'Equis', 'a missing locale falls back to the other one');
});

test('lineName: the recipe line label first, then the localized ingredient name, then the key', () => {
  assert.equal(lineName(DB, { ing: 'calabacin', amt: 100, label: 'Zucchini' }, 'es'), 'Zucchini');
  assert.equal(lineName(DB, { ing: 'calabacin', amt: 100 }, 'es'), 'Calabacín');
  assert.equal(lineName(DB, { ing: 'nameless', amt: 100 }, 'en'), 'nameless');
});

test('itemName: an option is named by n, else cap, else l (one rule for keys, the bake and Tablas)', () => {
  assert.equal(itemName({ n: 'Rice', cap: 'Cap', l: '🍚 Rice (130 g)' }), 'Rice');
  assert.equal(itemName({ cap: 'Cap', l: 'L' }), 'Cap');
  assert.equal(itemName({ l: 'L' }), 'L');
  assert.equal(itemName({}), '');
});

test('hasAmount: a q states an amount only when it has a digit', () => {
  assert.equal(hasAmount('130 g'), true);
  assert.equal(hasAmount('—'), false);
  assert.equal(hasAmount(undefined), false);
});

test('validateIngredientNames: a missing name warns, a malformed one is an error', () => {
  const r = validateIngredientNames({ ...DB, bad: { ...DB.nameless, name: { es: 'Malo' } }, empty: { ...DB.nameless, name: '  ' } });
  assert.deepEqual(r.warnings, ['ingredient nameless has no name (the page shows its key); add name: {es, en}']);
  assert.deepEqual(r.errors, [
    'ingredient bad: name must be a non-empty string or {es, en} non-empty strings',
    'ingredient empty: name must be a non-empty string or {es, en} non-empty strings',
  ]);
});

test('the tracked ingredients.json names EVERY ingredient in es and en', () => {
  const missing = Object.entries(ING).filter(([, v]) => !(v.name && typeof v.name === 'object' && v.name.es && v.name.en)).map(([k]) => k);
  assert.deepEqual(missing, []);
  assert.deepEqual(validateIngredientNames(ING), { errors: [], warnings: [] });
  assert.equal(ING.calabacin.name.es, 'Calabacín');
  assert.equal(ING.aceiteoliva.name.es, 'Aceite de oliva');
  assert.equal(ING.platano.name.es, 'Plátano');
});
