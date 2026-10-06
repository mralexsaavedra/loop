/* lib/nutrition/basics.mjs — the compact, localized list of public basics (data/nutrition/ingredients.json)
 * the food log's add sheet searches, and the tracked basics added for logging. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBasics, normName, BASIC_UNITS } from './basics.mjs';
import { basicEntry, basicModes } from './foodlog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ING = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/ingredients.json'), 'utf8')).ingredients;

const SYN = {
  huevo: { per: 100, unit: 'ud', cat: 'protein', verified: false, name: { es: 'Huevo', en: 'Egg' }, k: 72, p: 6.3, c: 0.4, g: 5, piece: { name: { es: 'huevo', en: 'egg' }, plural: { es: 'huevos', en: 'eggs' }, amt: 100, g: 50, typical: true } },
  platano: { per: 100, unit: 'g', cat: 'fruit', verified: false, name: { es: 'Plátano', en: 'Banana' }, k: 88, p: 0.8, c: 22.5, g: 0.3, piece: { name: { es: 'plátano mediano', en: 'medium banana' }, amt: 120, typical: true } },
  leche: { per: 100, unit: 'ml', cat: 'dairy', verified: false, name: { es: 'Leche', en: 'Milk' }, k: 46, p: 3.4, c: 4.8, g: 1.7 },
  label: { per: 100, unit: 'g', cat: 'sauce', verified: true, name: 'Allioli (brand)', k: 712, p: 1.1, c: 9.5, g: 78 },
  half: { per: 50, unit: 'g', cat: 'other', name: { es: 'Medio', en: 'Half' }, k: 10, p: 1, c: 1, g: 0.5 },
  broken: { per: 100, unit: 'g', cat: 'other', name: { es: 'Roto', en: 'Broken' }, k: 10, p: null, c: 1, g: 0 },
  odd: { per: 100, unit: 'cup', cat: 'other', name: { es: 'Raro', en: 'Odd' }, k: 10, p: 1, c: 1, g: 0 },
};

test('normName: case- and accent-insensitive ("platano" finds "Plátano")', () => {
  assert.equal(normName('Plátano'), 'platano');
  assert.equal(normName('  JAMÓN Cocido '), '  jamon cocido ');
  assert.equal(normName(null), '');
});

test('buildBasics: one compact entry per usable food, localized, sorted by name (accent-insensitive), per 100 of its unit', () => {
  const es = buildBasics(SYN, 'es');
  assert.deepEqual(es.map((b) => b.k), ['label', 'huevo', 'leche', 'half', 'platano'], 'Allioli, Huevo, Leche, Medio, Plátano');
  assert.deepEqual(es.find((b) => b.k === 'huevo'), { k: 'huevo', n: 'Huevo', u: 'ud', m: [72, 6.3, 0.4, 5], c: 'protein', pc: { a: 100, r: 50, o: 'huevo', m: 'huevos' } });
  assert.deepEqual(es.find((b) => b.k === 'platano').pc, { a: 120, r: null, o: 'plátano mediano', m: 'plátano mediano' }, 'no plural: the singular');
  assert.deepEqual(es.find((b) => b.k === 'half').m, [20, 2, 2, 1], 'normalized to per 100');
  assert.equal(es.find((b) => b.k === 'label').v, 1, 'a verified label is flagged; average values are not');
  assert.equal(es.find((b) => b.k === 'leche').v, undefined);
  assert.equal(es.find((b) => b.k === 'leche').pc, undefined);
  assert.ok(!es.some((b) => b.k === 'broken' || b.k === 'odd'), 'a food missing a macro or with an unknown unit is left out');
  assert.equal(buildBasics(SYN, 'en').find((b) => b.k === 'huevo').n, 'Egg');
  assert.deepEqual(buildBasics(null), []);
  assert.deepEqual(BASIC_UNITS, ['g', 'ml', 'ud']);
});

test('buildBasics: each entry carries its food category (c) and its portion cap (x, the maxAmt in its amount scale) for the portion guide', () => {
  const capped = { ...SYN, platano: { ...SYN.platano, maxAmt: 240 }, nocat: { per: 100, unit: 'g', name: 'No cat', k: 10, p: 1, c: 1, g: 0 } };
  const es = buildBasics(capped, 'es');
  assert.equal(es.find((b) => b.k === 'platano').c, 'fruit');
  assert.equal(es.find((b) => b.k === 'platano').x, 240);
  assert.equal(es.find((b) => b.k === 'leche').x, undefined, 'no cap: no x');
  assert.equal(es.find((b) => b.k === 'nocat').c, undefined, 'no category: no c');
  const real = buildBasics(ING, 'es');
  assert.equal(real.find((b) => b.k === 'arroz').x, 150);
  assert.equal(real.find((b) => b.k === 'cafe').c, 'drink');
});

test('the baked list feeds the shared formula: an egg logs as 2 pieces, a banana in grams', () => {
  const [egg] = buildBasics({ huevo: SYN.huevo }, 'es');
  assert.deepEqual(basicModes(egg), ['piece', 'g']);
  assert.deepEqual(basicEntry(egg, 2, 'piece'), { kcal: 144, protein: 12.6, carbs: 0.8, fat: 10 });
});

test('the tracked food DB bakes every food, deterministically', () => {
  const es = buildBasics(ING, 'es');
  assert.equal(es.length, Object.keys(ING).length, 'every tracked food is usable as a basic');
  assert.deepEqual(buildBasics(ING, 'es'), es);
  const names = es.map((b) => normName(b.n));
  assert.deepEqual(names, [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
});

/* ---- the basics added for logging generic foods (average values, never a label) ---- */
const ADDED = {
  yogurnatural: 'dairy', quesobatido: 'dairy', quesofresco: 'cheese', panbarra: 'carb', panmolde: 'carb',
  jamoncocido: 'protein', tomate: 'veg', lechuga: 'veg', pepino: 'veg', aguacate: 'fat', nueces: 'fat',
  almendras: 'fat', cacahuetes: 'fat', aceitunas: 'fat', mantequilla: 'fat', azucar: 'sweet', cafe: 'drink',
  bebidaavena: 'dairy', atunaceite: 'protein', sardinas: 'protein', pavopechuga: 'protein',
  tortillatrigo: 'carb', cereales: 'carb', galletasmaria: 'sweet', chocolate70: 'sweet',
};

test('the added basics: category, average values with their source named, es + en names', () => {
  for (const [k, cat] of Object.entries(ADDED)) {
    const ing = ING[k];
    assert.ok(ing, `${k} exists`);
    assert.equal(ing.cat, cat, k);
    assert.equal(ing.verified, false, `${k}: average table values, not a label`);
    assert.match(ing.note, /BEDCA|USDA|label/, `${k}: the note names the source`);
    assert.ok(ing.name.es && ing.name.en, k);
    const kc = 4 * ing.p + 4 * ing.c + 9 * ing.g;
    assert.ok(Math.abs(kc - ing.k) <= Math.max(0.25 * ing.k, 10), `${k}: kcal agree with the macros (Atwater)`);
  }
});

test('the added basics: countable ones carry a typical piece; carb, fruit and sweet ones a portion cap', () => {
  for (const k of ['yogurnatural', 'panbarra', 'panmolde', 'jamoncocido', 'tomate', 'aguacate', 'atunaceite', 'sardinas', 'tortillatrigo', 'galletasmaria', 'chocolate70', 'azucar']) {
    assert.ok(ING[k].piece, `${k} has a piece`);
    assert.equal(ING[k].piece.typical, true, `${k}: a typical weight`);
  }
  for (const k of Object.keys(ADDED)) {
    if (['carb', 'fruit', 'sweet'].includes(ING[k].cat)) assert.ok(ING[k].maxAmt > 0, `${k} has a maxAmt`);
  }
  assert.equal(ING.pavopechuga.weighed, 'raw');
  assert.equal(ING.cafe.unit, 'ml');
  assert.equal(ING.bebidaavena.unit, 'ml');
  assert.equal(ING.yogurnatural.name.es, 'Yogur natural');
  assert.equal(ING.jamoncocido.name.es, 'Jamón cocido');
});

test('olive oil is logged in ml by default, never in tablespoons', () => {
  const oil = buildBasics(ING, 'es').find((b) => b.k === 'aceiteoliva');
  assert.ok(oil, 'aceiteoliva is a basic');
  assert.equal(ING.aceiteoliva.piece, undefined, 'no tablespoon piece: the owner measures oil in ml');
  assert.equal(ING.aceiteoliva.unit, 'ml');
  assert.deepEqual(basicModes(oil), ['ml']);
  assert.deepEqual([ING.aceiteoliva.k, ING.aceiteoliva.g], [824, 91.6], 'per 100 ml = per 100 g x 0.916 g/ml');
});

test('black coffee is logged in ml by default, never in cups', () => {
  const cafe = buildBasics(ING, 'es').find((b) => b.k === 'cafe');
  assert.ok(cafe, 'cafe is a basic');
  assert.equal(ING.cafe.piece, undefined, 'no cup piece: a cup size varies too much');
  assert.deepEqual(basicModes(cafe), ['ml']);
});
