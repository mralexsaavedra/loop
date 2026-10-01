/* lib/nutrition/reference.mjs — Tablas as fixed reference values per natural unit (no portions). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNutrition } from './macros.mjs';
import { refUnit, foodRow, itemRows, listRows, buildReference } from './reference.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ING = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/ingredients.json'), 'utf8')).ingredients;
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/plan-data.example.json'), 'utf8'));
const ES = { lang: 'es', words: { raw: 'crudo', dry: 'seco', cooked: 'cocido', serving: 'ración', unit: 'ud' } };

test('natural units: a piece with its grams reference, oil per tablespoon, else 100 g with how it is weighed', () => {
  assert.deepEqual(refUnit(ING, 'platano', ES), { amt: 120, label: '1 plátano mediano (~120 g)', typical: true });
  assert.deepEqual(refUnit(ING, 'aceiteoliva', ES), { amt: 10, label: '1 cucharada (~10 g)', typical: true });
  assert.deepEqual(refUnit(ING, 'huevo', ES), { amt: 100, label: '1 huevo (~50 g)', typical: true });
  assert.deepEqual(refUnit(ING, 'arroz', ES), { amt: 100, label: '100 g seco', typical: false });
  assert.deepEqual(refUnit(ING, 'pollo', ES), { amt: 100, label: '100 g crudo', typical: false });
  assert.deepEqual(refUnit(ING, 'leche'), { amt: 100, label: '100 ml', typical: false });
  assert.deepEqual(refUnit(ING, 'panecillo'), { amt: 45, label: '1 bread roll (~45 g)', typical: false }, 'a label weight is not "typical"');
});

test('a food row: macros at the natural unit (kcal whole, macros 1 decimal) — the same whatever the day', () => {
  assert.deepEqual(foodRow(ING, 'platano', 'Banana', ES), { kind: 'food', name: 'Banana', unit: '1 plátano mediano (~120 g)', typical: true, verified: false, k: 106, p: 1, c: 27, g: 0.4 });
  assert.deepEqual(foodRow(ING, 'arroz', 'Rice'), { kind: 'food', name: 'Rice', unit: '100 g dry', typical: false, verified: false, k: 360, p: 7, c: 79, g: 1 });
});

test('a composite option is a group row plus one row per component; a manual option is one serving', () => {
  const nut = buildNutrition(ING, PLAN);
  const yog = PLAN.data.postre.find((o) => o.recipe && o.recipe.length === 3);
  const rows = itemRows(nut, yog);
  assert.equal(rows[0].kind, 'group');
  assert.deepEqual(rows.slice(1).map((r) => [r.name, r.unit, r.sub]), [['Light greek yogurt', '1 yogurt (~125 g)', true], ['Hazelnuts', '100 g', true], ['Honey', '100 g', true]]);
  const leg = itemRows(nut, PLAN.data.carboComida.train.find((o) => o.manual));
  assert.deepEqual(leg, [{ kind: 'serving', name: 'Legumes (bowl)', unit: '1 serving (~300 g)', typical: false, verified: false, k: 380, p: 25, c: 63, g: 4 }]);
});

test('no portions anywhere: the train and rest tiers of a carb list collapse to one row per food', () => {
  const nut = buildNutrition(ING, PLAN);
  const ref = buildReference(nut);
  assert.deepEqual(ref.carboComida.map((r) => r.name), ['Rice', 'Pasta', 'Legumes (bowl)']);
  assert.deepEqual(ref.carboComida[0], { kind: 'food', name: 'Rice', unit: '100 g dry', typical: false, verified: false, k: 360, p: 7, c: 79, g: 1 });
  assert.deepEqual(ref.proteina.lean.map((r) => r.unit), ['100 g raw', '100 g raw', '100 g', '100 ml']);
  assert.deepEqual(ref.fruta.map((r) => r.name), ['Banana', 'Apple', 'Orange']);
  assert.ok(ref.fruta.every((r) => r.typical && /^1 medium /.test(r.unit)));
  assert.ok(ref.postre.every((r) => r.kind !== 'food' || !/fruit/i.test(r.name)));
  assert.deepEqual(ref.legumes.map((r) => r.unit), ['100 g cooked', '100 g cooked']);
  assert.deepEqual(ref.quesos[0].unit, '1 slice (~18.5 g)');
  assert.equal(ref.desayunos[0].kind, 'group');
  assert.equal(ref.desayunos[0].name, 'A · Oat pancake');
  // nothing depends on the plan's amounts: doubling every recipe changes no reference value
  const big = JSON.parse(JSON.stringify(PLAN));
  for (const v of Object.values(big.data)) for (const o of [].concat(...(Array.isArray(v) ? [v] : Object.values(v)))) if (o.recipe) o.recipe.forEach((l) => { l.amt *= 2; });
  const ref2 = buildReference(buildNutrition(ING, big));
  assert.deepEqual(ref2.proteina, ref.proteina);
  assert.deepEqual(ref2.fruta, ref.fruta);
});

test('listRows drops "none" rows and repeats', () => {
  const nut = buildNutrition(ING, PLAN);
  assert.deepEqual(listRows(nut, [{ none: 1 }, { n: 'Rice', recipe: [{ ing: 'arroz', amt: 1 }] }, { n: 'Rice', recipe: [{ ing: 'arroz', amt: 9 }] }]).length, 1);
});
