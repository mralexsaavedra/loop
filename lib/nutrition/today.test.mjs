/* lib/nutrition/today.mjs — the NUTRI bake behind Resumen de hoy / Plan de hoy / Avituallamiento. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNutrition } from './macros.mjs';
import { buildNutriToday } from './today.mjs';
import { FUEL, RIDE_DEFAULT_MIN, RIDE_DURATIONS } from './fuel.mjs';
import { DETECT } from './daytype.mjs';
import { MACRO_TOLERANCE_G } from './scale.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ING = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/ingredients.json'), 'utf8')).ingredients;
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/plan-data.example.json'), 'utf8'));

test('bakes the 12 plans plus everything the client needs: fuel rates, detection thresholds, weight', () => {
  const b = buildNutriToday(buildNutrition(ING, PLAN), PLAN, { weight: { kg: 72.3, date: '2030-01-02' }, supplements: [] });
  assert.equal(Object.keys(b.plans).length, 3);
  assert.deepEqual(b.fuel.rates, FUEL);
  assert.deepEqual(b.fuel.defaults, RIDE_DEFAULT_MIN);
  assert.deepEqual(b.fuel.durations, RIDE_DURATIONS);
  assert.deepEqual(b.detect, DETECT);
  assert.deepEqual(b.weight, { kg: 72.3, date: '2030-01-02' });
  assert.equal(b.macroTol, MACRO_TOLERANCE_G);
  assert.equal(buildNutriToday(buildNutrition(ING, PLAN), PLAN, {}).weight, null);
});

test('the example plan hits every goal x day type target within the stated tolerance (the demo shows no remainder)', () => {
  const b = buildNutriToday(buildNutrition(ING, PLAN), PLAN, {});
  for (const g of b.goals) for (const d of b.dayTypes) {
    const x = b.plans[g][d];
    assert.ok(Math.abs(x.rem) <= b.tolerance, `${g}/${d}: remainder ${x.rem} kcal (factor ${x.factor}, clamp ${x.clamp})`);
  }
});

test('the bake is small: under 12 KB of JSON for the example plan', () => {
  const size = JSON.stringify(buildNutriToday(buildNutrition(ING, PLAN), PLAN, {})).length;
  assert.ok(size < 12 * 1024, `NUTRI is ${size} bytes`);
});
