/* lib/nutrition/units.mjs — natural-unit metadata of ingredients.json (pieces, weighed state). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIngredientMeta, pieceFmt, fmtHalf, fmtPieces, WEIGHED } from './units.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ING = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/ingredients.json'), 'utf8')).ingredients;

const banana = { per: 100, unit: 'g', k: 88, p: 0.8, c: 22.5, g: 0.3, piece: { name: { es: 'plátano mediano', en: 'medium banana' }, plural: { es: 'plátanos medianos', en: 'medium bananas' }, amt: 120, typical: true } };
const egg = { per: 100, unit: 'ud', k: 72, p: 6.3, c: 0.4, g: 5, piece: { name: { es: 'huevo', en: 'egg' }, plural: { es: 'huevos', en: 'eggs' }, amt: 100, g: 55, typical: true } };

test('the tracked ingredients.json passes the metadata validation', () => {
  assert.deepEqual(validateIngredientMeta(ING), []);
});

test('the tracked DB carries pieces for the countable foods and the oil, and a weighed state for staples', () => {
  for (const k of ['platano', 'manzana', 'naranja', 'panecillo', 'yogurgriego', 'huevo', 'aceiteoliva', 'tranchete']) assert.ok(ING[k].piece, k);
  assert.equal(ING.aceiteoliva.piece.amt, 10, 'oil per tablespoon (~10 g)');
  for (const k of ['platano', 'manzana', 'naranja']) assert.equal(ING[k].piece.typical, true, `${k}: a typical weight, not a label`);
  assert.equal(ING.arroz.weighed, 'dry');
  assert.equal(ING.pasta.weighed, 'dry');
  assert.equal(ING.pollo.weighed, 'raw');
});

test('validation: malformed pieces and states are reported with the ingredient key', () => {
  const bad = {
    a: { ...banana, piece: { name: 'banana', amt: 120 } },
    b: { ...banana, piece: { name: { es: 'x', en: 'x' }, amt: 0 } },
    c: { ...egg, piece: { ...egg.piece, amt: 120 } },
    d: { ...banana, weighed: 'boiled' },
    e: { ...banana, piece: { ...banana.piece, typical: 'yes' } },
    f: { ...banana, piece: { ...banana.piece, g: 50 } },
    g: { ...banana, piece: { ...banana.piece, plural: 'bananas' } },
  };
  const errs = validateIngredientMeta(bad);
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) assert.ok(errs.some((e) => e.startsWith(`ingredient ${k}:`)), `${k}: ${errs.join(' | ')}`);
  assert.deepEqual(validateIngredientMeta({ banana, egg }), []);
  assert.deepEqual([...WEIGHED], ['raw', 'dry', 'cooked']);
});

test('pieceFmt: one compact entry per ingredient with a piece, localized, with the half step', () => {
  assert.deepEqual(pieceFmt({ banana, egg, rice: { per: 100, unit: 'g' } }, 'es'), {
    banana: { a: 120, r: null, o: 'plátano mediano', m: 'plátanos medianos' },
    egg: { a: 100, r: 55, o: 'huevo', m: 'huevos' },
  });
  assert.equal(pieceFmt({ banana }, 'en').banana.o, 'medium banana');
});

test('fmtHalf: whole and half units', () => {
  assert.equal(fmtHalf(1), '1');
  assert.equal(fmtHalf(1.5), '1½');
  assert.equal(fmtHalf(0.5), '½');
  assert.equal(fmtHalf(3), '3');
});

test('fmtPieces: pieces with the grams reference; "~" marks the estimated side', () => {
  const pb = pieceFmt({ banana }, 'en').banana;
  const pe = pieceFmt({ egg }, 'en').egg;
  assert.equal(fmtPieces(120, 'g', pb), '1 medium banana (~120 g)');
  assert.equal(fmtPieces(180, 'g', pb), '1½ medium bananas (~180 g)');
  assert.equal(fmtPieces(150, 'g', pb), '~1½ medium bananas (150 g)', 'off the half-piece grid: the grams are the plan amount, the pieces approximate');
  assert.equal(fmtPieces(20, 'g', pb), '~½ medium banana (20 g)', 'never below half a piece');
  assert.equal(fmtPieces(200, 'ud', pe), '2 eggs (~110 g)');
  assert.equal(fmtPieces(100, 'ud', { ...pe, r: null }), '1 egg');
});
