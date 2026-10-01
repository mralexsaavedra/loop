/* lib/nutrition/scale.mjs — carb-flex portion scaling to a (goal × day type) target. Synthetic
 * fixtures only (never the owner's plan). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNutrition } from './macros.mjs';
import { scaleDay, buildDayPlans, planModel, solveScale, planFor, fmtFactor, SCALE_MIN, SCALE_MAX, REMAINDER_TOLERANCE_K, stepAmount } from './scale.mjs';
import { GOALS, DAY_TYPES, resolveTargets } from './targets.mjs';
import { fuelPlan, RIDE_DEFAULT_MIN } from './fuel.mjs';

const ING = {
  arroz: { per: 100, k: 360, p: 7, c: 79, g: 1, unit: 'g' },
  pollo: { per: 100, k: 100, p: 20, c: 0, g: 2, unit: 'g' },
  aceite: { per: 100, k: 900, p: 0, c: 0, g: 100, unit: 'g' },
  huevo: { per: 100, k: 70, p: 6, c: 0.5, g: 5, unit: 'ud' },
  miel: { per: 100, k: 300, p: 0, c: 80, g: 0, unit: 'g', name: 'Honey' },
  wrap: { per: 100, k: 100, p: 3, c: 20, g: 1, unit: 'ud', name: 'Wrap' },
  bollo: { per: 100, k: 200, p: 6, c: 40, g: 2, unit: 'ud', name: 'Bun' },
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

test('an item q without an amount (a placeholder like "—") is replaced by the recipe amounts', () => {
  const p = plan();
  p.data.dessert = [{ n: 'Honey + rice', q: '—', recipe: [{ ing: 'miel', amt: 10 }, { ing: 'arroz', amt: 20 }] }];
  p.dayPlan.rest.meals[0].parts.push({ use: 'dessert', match: 'Honey' });
  const r = scaleDay(nutOf(p), 'rest', 650);
  assert.equal(r.meals[0].parts[2].q, '10 g + 20 g');
  assert.equal(r.meals[0].parts[2].label, 'Honey + rice');
});

/* ---- whole units ('ud') in the flex set: rounded first, then the g / ml parts absorb the rest ---- */
// rest base + a flex unit part in front: fixed = chicken 200 + oil 90 = 290; rice 100 g = 360 flex
function withUnits(ing, amt, riceFlex = true) {
  const p = plan();
  if (!riceFlex) p.dayPlan.rest.meals[0].parts[0] = { use: 'carbo', match: 'Rice' };
  p.dayPlan.rest.meals.unshift({ name: 'Breakfast', parts: [{ ing, amt, flex: 'carb' }] });
  return p;
}

test('ud at factor 1.45: the unit rounds, the re-solved gram factor keeps the day within tolerance', () => {
  // flex = 1 bun (200) + rice (360) = 560; target 290 + 1.45 x 560 = 1102 -> 1.45 x 1 bun rounds to 1
  const r = scaleDay(nutOf(withUnits('bollo', 100)), 'rest', 1102);
  assert.equal(r.meals[0].parts[0].q, '1 ud');
  assert.equal(r.factor, 1.7, '(1102 - 290 - 200) / 360 = 1.70 on the gram parts');
  assert.equal(r.meals[1].parts[0].q, '170 g');
  assert.ok(Math.abs(r.rem) <= REMAINDER_TOLERANCE_K, `rem ${r.rem}`);
  assert.equal(r.rem, 0);
  assert.equal(r.udOnly, false);
});

test('ud at factor 0.6: the unit rounds down, the gram factor is re-solved (and clamps honestly)', () => {
  // flex = 2 wraps (200) + rice (360) = 560; target 290 + 0.6 x 560 = 626 -> 1.2 wraps rounds to 1
  const r = scaleDay(nutOf(withUnits('wrap', 200)), 'rest', 626);
  assert.equal(r.meals[0].parts[0].q, '1 ud');
  assert.equal(r.factor, 0.66, '(626 - 290 - 100) / 360 = 0.66');
  assert.equal(r.meals[1].parts[0].q, '65 g');
  assert.ok(Math.abs(r.rem) <= 5, `rem ${r.rem}`);
  const low = scaleDay(nutOf(withUnits('wrap', 200)), 'rest', 500);
  assert.equal(low.clamp, 'min');
  assert.equal(low.factor, SCALE_MIN);
  assert.equal(low.rem, 500 - (290 + 100 + 216), 'what the clamp leaves over is reported');
});

test('only ud parts are flex: they round to whole units and the remainder is reported honestly', () => {
  // fixed 650 (rice not flex) + 1 bun flex: target 950 -> x1.5 -> 2 buns (400) -> 1050
  const r = scaleDay(nutOf(withUnits('bollo', 100, false)), 'rest', 950);
  assert.equal(r.udOnly, true);
  assert.equal(r.meals[0].parts[0].q, '2 ud');
  assert.equal(r.factor, 1.5);
  assert.equal(r.rem, -100);
});

test('the factor label has 2 decimals (the maths rounds to 2)', () => {
  assert.equal(fmtFactor(1.7, '.'), '1.70');
  assert.equal(fmtFactor(0.66, ','), '0,66');
  const p = plan();
  p.data.legume = [{ n: 'Lentils', q: '1 bowl', manual: { k: 300, p: 20, c: 50, g: 2 } }];
  p.dayPlan.rest.meals[0].parts[0] = { use: 'legume', match: 'Lentils', flex: 'carb' };
  const r = scaleDay(nutOf(p), 'rest', 290 + 390, { dec: ',' });
  assert.equal(r.meals[0].parts[0].q, '1 bowl ×1,30');
});

test('solveScale works on the compact model alone (what the page bakes) and matches scaleDay', () => {
  const p = withUnits('bollo', 100);
  const nut = nutOf(p);
  const model = JSON.parse(JSON.stringify(planModel(nut, 'rest')));
  assert.equal(model.fixed.length, 3);
  assert.deepEqual(model.flex.map((x) => x.m), [0, 1]);
  assert.deepEqual(model.flex[0].ln[0].slice(0, 3), ['ud', 100, 200]);
  for (const target of [500, 626, 900, 1102, 1500, 3000]) {
    const s = solveScale(model, target);
    const d = scaleDay(nut, 'rest', target);
    assert.equal(s.factor, d.factor);
    assert.equal(s.rem, d.rem);
    assert.deepEqual(s.q, [d.meals[0].parts[0].q, d.meals[1].parts[0].q]);
  }
});

test('planFor: meals aim at target - ride fuel for the given minutes; a longer ride shrinks the meals', () => {
  const p = plan();
  const bake = buildDayPlans(nutOf(p), p);
  const two = planFor(bake, 'maintain', 'bike', 120);
  const four = planFor(bake, 'maintain', 'bike', 240);
  assert.equal(two.fuelK, fuelPlan({ dayType: 'bike', minutes: 120 }).kcal);
  assert.equal(four.fuelK, fuelPlan({ dayType: 'bike', minutes: 240 }).kcal);
  assert.equal(four.minutes, 240);
  assert.ok(four.tot.k < two.tot.k || four.clamp, 'more ride fuel, smaller meals');
  assert.equal(four.rem, four.t.kcal - four.fuelK - four.tot.k);
  assert.deepEqual(four.mt, { k: four.t.kcal - four.fuelK, p: four.t.p, c: four.t.c - four.fuelC, f: four.t.f });
  assert.equal(four.fuelC, fuelPlan({ dayType: 'bike', minutes: 240 }).during.planG);
  const rest = planFor(bake, 'maintain', 'rest', 240);
  assert.equal(rest.fuelK, 0);
  assert.equal(rest.minutes, null);
  assert.deepEqual(rest.mt, { k: rest.t.kcal, p: rest.t.p, c: rest.t.c, f: rest.t.f });
  // the precomputed plans are planFor at the default ride minutes
  assert.deepEqual(bake.plans.maintain.bike.tot, planFor(bake, 'maintain', 'bike', RIDE_DEFAULT_MIN.bike).tot);
});

/* ---- display helpers for Plan de hoy: per-line amounts, scale direction, composite components ---- */
test('solveScale: qa = each flex part\'s line amounts, dir = which way the part moved (+1 / 0 / -1)', () => {
  const nut = nutOf();
  const model = planModel(nut, 'rest');
  const same = solveScale(model, 650);
  assert.deepEqual(same.qa, [['100 g']]);
  assert.deepEqual(same.dir, [0]);
  const up = solveScale(model, 1000);
  assert.deepEqual(up.qa, [[up.q[0]]]);
  assert.deepEqual(up.dir, [1]);
  assert.deepEqual(solveScale(model, 500).dir, [-1]);
  // a manual block: its display text, direction from the factor
  const mb = solveScale({ fixed: [[100, 0, 0, 0]], flex: [{ m: 0, mb: [200, 2, 40, 1], q: '1 bowl' }] }, 500);
  assert.deepEqual(mb.qa, [[mb.q[0]]]);
  assert.deepEqual(mb.dir, [1]);
});

test('buildDayPlans: a composite part (several recipe lines, no amount of its own) bakes its component names (and fixed amounts)', () => {
  const p = plan();
  p.data.dessert = [{ n: 'Honey + rice', q: '—', recipe: [{ ing: 'miel', amt: 10 }, { ing: 'arroz', amt: 20 }] }];
  p.dayPlan.rest.meals[0].parts.push({ use: 'dessert', match: 'Honey' });
  p.dayPlan.rest.meals[0].parts.push({ use: 'dessert', match: 'Honey', flex: 'carb', label: 'Flex dessert' });
  const nut = nutOf(p);
  const days = buildDayPlans(nut, p, { units: { g: 'g', ml: 'ml', ud: 'pc' } });
  const parts = days.base.rest.meals[0].parts;
  const macOf = (lines) => ['k', 'p', 'c', 'g'].map((k) => lines.reduce((a, [ing, amt]) => a + nut.ING[ing][k] * (amt / nut.ING[ing].per), 0));
  assert.deepEqual(parts[2], { l: 'Honey + rice', q: '10 g + 20 g', c: ['Honey', 'arroz'], a: ['10 g', '20 g'], m: macOf([['miel', 10], ['arroz', 20]]) });
  assert.deepEqual(parts[3], { l: 'Flex dessert', x: 1, c: ['Honey', 'arroz'] }, 'a flex part\'s macros come from solveScale (qm)');
  assert.deepEqual(parts[1], { l: 'Chicken', q: '200 g', m: macOf([['pollo', 200]]) }, 'a single-line part carries no components; a fixed part carries its macros');
});

test('a composite names its components by the recipe line label first, then the ingredient name', () => {
  const p = plan();
  p.data.dessert = [{ n: 'Honey + rice', q: '—', recipe: [{ ing: 'miel', amt: 10, label: 'Raw honey' }, { ing: 'arroz', amt: 20 }] }];
  p.dayPlan.rest.meals[0].parts.push({ use: 'dessert', match: 'Honey' });
  const parts = buildDayPlans(nutOf(p), p).base.rest.meals[0].parts;
  assert.deepEqual(parts[2].c, ['Raw honey', 'arroz']);
});

/* ---- countable foods (ingredients.json `piece`, lib/nutrition/units.mjs): half pieces + grams ---- */
const BANANA = { per: 100, k: 88, p: 1, c: 22.5, g: 0.3, unit: 'g', name: 'Banana', piece: { name: { es: 'plátano', en: 'banana' }, plural: { es: 'plátanos', en: 'bananas' }, amt: 120 } };
const EGG_PC = { ...ING.huevo, piece: { name: { es: 'huevo', en: 'egg' }, plural: { es: 'huevos', en: 'eggs' }, amt: 100, g: 50 } };

test('stepAmount: a countable g / ml food rounds to half pieces (never below one half)', () => {
  assert.equal(stepAmount(130, 'g', 60), 120);
  assert.equal(stepAmount(160, 'g', 60), 180);
  assert.equal(stepAmount(10, 'g', 60), 60);
  assert.equal(stepAmount(260, 'ud', 100), 300, 'ud stays whole units');
});

test('a countable flex part rounds to half pieces like a unit and shows pieces with the grams reference', () => {
  const p = plan();
  p.dayPlan.rest.meals.unshift({ name: 'Snack', parts: [{ ing: 'platano', amt: 120, flex: 'carb' }] });
  const nut = buildNutrition({ ...ING, platano: BANANA }, p);
  const model = planModel(nut, 'rest');
  assert.deepEqual(model.flex[0].ln[0].slice(6), [60, 'platano'], 'the model line carries the half-piece step and the key');
  assert.equal(scaleDay(nut, 'rest', 650 + 106).meals[0].parts[0].q, '1 banana (~120 g)');
  const r = scaleDay(nut, 'rest', 1100);
  assert.match(r.meals[0].parts[0].q, /^\d*½? bananas? \(~\d+ g\)$/);
  assert.ok(Math.abs(r.rem) <= REMAINDER_TOLERANCE_K, `the gram parts absorb the half-piece rounding (rem ${r.rem})`);
  assert.ok(scaleDay(nut, 'rest', 1100, { lang: 'es' }).meals[0].parts[0].q.includes('plátano'));
});

test('a fixed countable part (and a ud food with a grams reference) shows pieces too', () => {
  const p = plan();
  p.dayPlan.rest.meals.unshift({ name: 'Breakfast', parts: [{ ing: 'huevo', amt: 200, label: 'Eggs' }, { ing: 'platano', amt: 150, label: 'Banana' }] });
  const days = buildDayPlans(buildNutrition({ ...ING, huevo: EGG_PC, platano: BANANA }, p), p);
  const [eggs, banana] = days.base.rest.meals[0].parts;
  assert.equal(eggs.q, '2 eggs (~100 g)');
  assert.equal(banana.q, '~1½ bananas (150 g)');
  assert.deepEqual(days.fmt.pieces, {}, 'only pieces a baked LINE formats are baked (fixed parts are pre-formatted)');
});
