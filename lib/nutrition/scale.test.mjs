/* lib/nutrition/scale.mjs — carb-flex portion scaling to a (goal × day type) target. Synthetic
 * fixtures only (never the owner's plan). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNutrition } from './macros.mjs';
import { scaleDay, buildDayPlans, SCALE_MIN, SCALE_MAX, REMAINDER_TOLERANCE_K, stepAmount } from './scale.mjs';
import { GOALS, DAY_TYPES, resolveTargets } from './targets.mjs';
import { fuelPlan, RIDE_DEFAULT_MIN } from './fuel.mjs';

const ING = {
  arroz: { per: 100, k: 360, p: 7, c: 79, g: 1, unit: 'g' },
  pollo: { per: 100, k: 100, p: 20, c: 0, g: 2, unit: 'g' },
  aceite: { per: 100, k: 900, p: 0, c: 0, g: 100, unit: 'g' },
  huevo: { per: 100, k: 70, p: 6, c: 0.5, g: 5, unit: 'ud' },
  miel: { per: 100, k: 300, p: 0, c: 80, g: 0, unit: 'g', name: 'Honey' },
};

function plan(overrides = {}) {
  const lunch = (flex) => ({
    name: 'Lunch',
    parts: [
      { use: 'carbo', match: 'Rice', ...(flex ? { flex: 'carb' } : {}) },
      { ing: 'pollo', amt: 200, label: 'Chicken' },
    ],
  });
  return {
    data: {
      carbo: [{ n: 'Rice', q: '100 g', recipe: [{ ing: 'arroz', amt: 100 }] }],
    },
    extras: {},
    dayPlan: {
      train: { meals: [{ name: 'Breakfast', slot: 'breakfast', parts: [{ ing: 'huevo', amt: 200, label: 'Eggs' }] }, lunch(true), { name: 'Cooking oil', parts: [{ ing: 'aceite', amt: 10 }] }] },
      rest: { meals: [lunch(true), { name: 'Cooking oil', parts: [{ ing: 'aceite', amt: 10 }] }] },
    },
    ...overrides,
  };
}
const nutOf = (p = plan()) => buildNutrition(ING, p);

// rest base: rice 100 g (360) flex + chicken 200 g (200) + oil 10 g (90) fixed = 650 kcal
test('a target the base already hits keeps factor 1 and no remainder', () => {
  const r = scaleDay(nutOf(), 'rest', 650);
  assert.equal(r.factor, 1);
  assert.equal(r.clamp, null);
  assert.equal(Math.round(r.totals.k), 650);
  assert.equal(r.rem, 0);
});

test('only carb-flex parts scale; protein / fat parts stay fixed', () => {
  const r = scaleDay(nutOf(), 'rest', 1010); // (1010 - 290) / 360 = 2.0
  assert.equal(r.factor, 2);
  const [rice, chicken] = r.meals[0].parts;
  assert.equal(rice.flex, true);
  assert.equal(rice.q, '200 g');
  assert.equal(chicken.flex, false);
  assert.equal(chicken.q, '200 g');
  assert.equal(chicken.label, 'Chicken');
  assert.equal(Math.round(r.totals.k), 1010);
});

test('grams round to 5 g steps and the totals are recomputed from the rounded grams', () => {
  const r = scaleDay(nutOf(), 'rest', 700); // 1.139 x 100 g = 113.9 -> 115 g
  assert.equal(r.meals[0].parts[0].q, '115 g');
  assert.equal(Math.round(r.totals.k), 704);
  assert.equal(r.rem, -4);
});

test('clamped high: the shortfall is reported honestly, never hidden', () => {
  const r = scaleDay(nutOf(), 'rest', 2000);
  assert.equal(r.factor, SCALE_MAX);
  assert.equal(r.clamp, 'max');
  assert.equal(r.rem, 2000 - 1010);
  assert.ok(r.rem > REMAINDER_TOLERANCE_K);
});

test('clamped low: the excess is reported (negative remainder)', () => {
  const r = scaleDay(nutOf(), 'rest', 400);
  assert.equal(r.factor, SCALE_MIN);
  assert.equal(r.clamp, 'min');
  assert.equal(r.meals[0].parts[0].q, '60 g');
  assert.equal(r.rem, 400 - 506);
});

test('a day with no flex part keeps factor 1 and reports the whole gap', () => {
  const p = plan();
  p.dayPlan.rest.meals[0].parts[0] = { use: 'carbo', match: 'Rice' };
  const r = scaleDay(nutOf(p), 'rest', 900);
  assert.equal(r.factor, 1);
  assert.equal(r.rem, 250);
});

test('units stay whole units; ml / g round to 5', () => {
  assert.equal(stepAmount(263, 'g'), 265);
  assert.equal(stepAmount(1, 'g'), 5, 'never rounds a portion away');
  assert.equal(stepAmount(260, 'ud'), 300);
  assert.equal(stepAmount(40, 'ud'), 100, 'at least one unit');
  const p = plan();
  p.dayPlan.rest.meals.unshift({ name: 'Breakfast', parts: [{ ing: 'huevo', amt: 200, flex: 'carb', label: 'Eggs' }] });
  const r = scaleDay(nutOf(p), 'rest', 5000, { units: { g: 'g', ml: 'ml', ud: 'pc' } });
  assert.equal(r.meals[0].parts[0].q, '4 pc');
});

test('buildDayPlans bakes all 12 goal × day type plans; bike days leave room for the ride fuel', () => {
  const p = plan();
  const bake = buildDayPlans(nutOf(p), p);
  assert.deepEqual(bake.goals, GOALS);
  assert.deepEqual(bake.dayTypes, DAY_TYPES);
  assert.equal(bake.goal, 'maintain');
  const T = resolveTargets(p);
  for (const g of GOALS) for (const d of DAY_TYPES) {
    const x = bake.plans[g][d];
    assert.deepEqual(x.t, T[g][d]);
    assert.equal(x.base, d === 'rest' ? 'rest' : 'train');
    const fuelK = d === 'bike' || d === 'bikeLong' ? fuelPlan({ dayType: d, minutes: RIDE_DEFAULT_MIN[d] }).kcal : 0;
    assert.equal(x.fuelK, fuelK);
    assert.equal(x.rem, x.t.kcal - fuelK - x.tot.k, 'remainder = target - ride fuel - meals');
  }
  // the base meal structure is baked once per base day; each plan only carries the flex amounts
  assert.equal(bake.base.train.meals.length, 3);
  assert.equal(bake.base.train.meals[0].s, 'breakfast');
  assert.equal(bake.base.train.meals[1].s, 'lunch');
  assert.equal(bake.base.train.meals[2].s, null);
  assert.deepEqual(bake.base.rest.meals[0].parts.map((x) => !!x.x), [true, false]);
  assert.equal(bake.plans.maintain.rest.flex.length, 1);
  assert.equal(bake.plans.maintain.rest.meals.length, 2);
});

test('buildDayPlans: page.goal picks the default goal; supplements are passed through by slot', () => {
  const p = plan({ page: { title: 'x', goal: 'cut' } });
  const bake = buildDayPlans(nutOf(p), p, { supplements: [{ name: 'Creatine', dose: '3 g', meal: 'lunch' }] });
  assert.equal(bake.goal, 'cut');
  assert.deepEqual(bake.supplements, [{ name: 'Creatine', dose: '3 g', meal: 'lunch' }]);
});

test('buildDayPlans is deterministic (byte-identical JSON on repeat)', () => {
  const p = plan();
  assert.equal(JSON.stringify(buildDayPlans(nutOf(p), p)), JSON.stringify(buildDayPlans(nutOf(p), p)));
});
