/* lib/nutrition/today.mjs — the NUTRI bake behind Resumen de hoy / Plan de hoy / Avituallamiento. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNutrition } from './macros.mjs';
import { buildNutriToday } from './today.mjs';
import { FUEL, RIDE_DEFAULT_MIN, RIDE_DURATIONS } from './fuel.mjs';
import { MAIN_SLOTS } from './slots.mjs';
import { GUIDE_FALLBACK, DONE_SHARE, COVERED_SHARE, extrasExamples } from './guide.mjs';
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

test('the page gets {base, t} per plan plus one scaling model per base day (with each meal\'s slot), and re-solves with planFor', () => {
  const b = buildNutriToday(buildNutrition(ING, PLAN), PLAN, { dec: ',' });
  assert.deepEqual(Object.keys(b.plans.maintain.bike).sort(), ['base', 't']);
  for (const day of ['train', 'rest']) {
    assert.deepEqual(Object.keys(b.base[day]).sort(), ['fixed', 'flex', 'sl'], day);
    assert.equal(b.base[day].fixed.length, b.base[day].sl.length, day);
    assert.ok(b.base[day].flex.length > 0, `${day} has carb-flex parts`);
  }
  assert.deepEqual(b.base.train.sl, ['breakfast', 'lunch', 'postworkout', 'dinner', null]);
  assert.equal(b.fmt.dec, ',');
  const baked = JSON.parse(JSON.stringify(b));
  const x = planFor(baked, 'maintain', 'bike', 240);
  assert.equal(x.minutes, 240);
  assert.equal(x.rem, x.t.kcal - x.fuelK - x.tot.k);
  for (const gone of ['lists', 'foods', 'snack', 'blocks']) assert.ok(!(gone in b), `${gone} is no longer baked`);
});

test('the portion guide bake: roles, the default example per base day x main meal x role, the Extras examples, the thresholds', () => {
  const b = buildNutriToday(buildNutrition(ING, PLAN), PLAN, {});
  assert.deepEqual(b.mainSlots, MAIN_SLOTS);
  assert.deepEqual(b.guide.roles, { p: { at: 1, cats: ['protein'] }, c: { at: 2, cats: ['carb', 'legume', 'fruit'] }, f: { at: 3, cats: ['fat'] } });
  assert.deepEqual(b.guide.fallback, GUIDE_FALLBACK);
  assert.deepEqual(Object.keys(b.guide.defaults).sort(), ['rest', 'train']);
  assert.deepEqual(b.guide.defaults.train.lunch, { p: 'pollo', c: 'arroz', f: 'aceiteoliva' });
  assert.deepEqual(b.guide.extras, extrasExamples(ING));
  assert.equal(b.guide.done, DONE_SHARE);
  assert.equal(b.guide.covered, COVERED_SHARE);
});

// ~19.7 KB with the choosable blocks' option lists, the food catalogue and the snack options; the
// portion guide needs only the two scaling models, the defaults and a few constants (its food table
// is FOOD_BASICS, baked once for the food log)
test('the bake is small: under 8 KB of JSON for the example plan', () => {
  const b = buildNutriToday(buildNutrition(ING, PLAN), PLAN, {});
  const size = JSON.stringify(b).length;
  assert.ok(size < 8 * 1024, `NUTRI is ${size} bytes`);
});
