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
import { MACRO_TOLERANCE_G, planFor } from './scale.mjs';

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

test('the page gets {base, t} per plan plus one scaling model per base day, and re-solves with planFor', () => {
  const b = buildNutriToday(buildNutrition(ING, PLAN), PLAN, { dec: ',' });
  assert.deepEqual(Object.keys(b.plans.maintain.bike).sort(), ['base', 't']);
  for (const day of ['train', 'rest']) {
    assert.ok(Array.isArray(b.base[day].fixed) && b.base[day].fixed.length === b.base[day].meals.length, day);
    assert.ok(b.base[day].flex.length > 0, `${day} has carb-flex parts`);
  }
  assert.equal(b.fmt.dec, ',');
  const baked = JSON.parse(JSON.stringify(b));
  const x = planFor(baked, 'maintain', 'bike', 240);
  assert.equal(x.minutes, 240);
  assert.equal(x.rem, x.t.kcal - x.fuelK - x.tot.k);
});

test('the example plan: a remainder beyond the tolerance only when nothing can grow (every flex portion at its cap or the factor at its maximum)', () => {
  const b = buildNutriToday(buildNutrition(ING, PLAN), PLAN, {});
  for (const g of b.goals) for (const d of b.dayTypes) {
    const x = planFor(b, g, d);
    if (Math.abs(x.rem) <= b.tolerance) continue;
    assert.ok(x.rem > 0 && (x.allCapped || x.clamp === 'max'), `${g}/${d}: remainder ${x.rem} kcal (factor ${x.factor}, clamp ${x.clamp}, allCapped ${x.allCapped})`);
  }
});

// ~10.5 KB before every {ing} part became choosable; the food catalogue (one compact table of the
// categories in use, referenced by key from each block) brought it to ~17.9 KB
test('the bake is small: under 20 KB of JSON for the example plan; the food catalogue is baked once', () => {
  const b = buildNutriToday(buildNutrition(ING, PLAN), PLAN, {});
  const size = JSON.stringify(b).length;
  assert.ok(size < 20 * 1024, `NUTRI is ${size} bytes`);
  assert.ok(JSON.stringify(b.foods).length < 6 * 1024, 'foods');
  for (const day of Object.keys(b.base)) for (const blk of Object.values(b.base[day].blocks)) assert.ok(!('o' in blk) && !('ings' in blk), 'a block references foods by key only');
});
