/* lib/nutrition/scale.mjs — carb-flex portion scaling to a (goal × day type) target. Synthetic
 * fixtures only (never the owner's plan). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNutrition } from './macros.mjs';
import { buildDayPlans, planModel, solveScale, planFor, fmtFactor, SCALE_MIN, SCALE_MAX, REMAINDER_TOLERANCE_K } from './scale.mjs';
import { pieceFmt } from './units.mjs';
import { stepAmount, AMOUNT_STEP } from './amounts.mjs';
import { UD_AMT, PIECE_GRID } from './units.mjs';
import { round1, round2 } from './num.mjs';
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

/** The base day `day` solved for `target` (planModel + solveScale), each part named with its display
 * amount: a flex part shows its scaled amount, a fixed one its written amount. */
function scaled(nut, day, target, { units, dec, lang = 'en' } = {}) {
  const pieces = pieceFmt(nut.ING, lang);
  const model = planModel(nut, day, { units, pieces, lang });
  const s = solveScale(model, target, { units, dec, pieces });
  let fi = 0;
  const meals = model.meals.map(({ parts }) => ({ parts: parts.map((d) => ({ label: d.label, flex: d.flex, q: d.flex ? s.q[fi++] : d.q })) }));
  return { ...s, meals };
}

// rest base: rice 100 g (360) flex + chicken 200 g (200) + oil 10 g (90) fixed = 650 kcal
test('a target the base already hits keeps factor 1 and no remainder', () => {
  const r = scaled(nutOf(), 'rest', 650);
  assert.equal(r.factor, 1);
  assert.equal(r.clamp, null);
  assert.equal(Math.round(r.totals.k), 650);
  assert.equal(r.rem, 0);
});

test('only carb-flex parts scale; protein / fat parts stay fixed', () => {
  const r = scaled(nutOf(), 'rest', 1010); // (1010 - 290) / 360 = 2.0
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
  const r = scaled(nutOf(), 'rest', 700); // 1.139 x 100 g = 113.9 -> 115 g
  assert.equal(r.meals[0].parts[0].q, '115 g');
  assert.equal(Math.round(r.totals.k), 704);
  assert.equal(r.rem, -4);
});

test('clamped high: the shortfall is reported honestly, never hidden', () => {
  const r = scaled(nutOf(), 'rest', 2000);
  assert.equal(r.factor, SCALE_MAX);
  assert.equal(r.clamp, 'max');
  assert.equal(r.rem, 2000 - 1010);
  assert.ok(r.rem > REMAINDER_TOLERANCE_K);
});

test('clamped low: the excess is reported (negative remainder)', () => {
  const r = scaled(nutOf(), 'rest', 400);
  assert.equal(r.factor, SCALE_MIN);
  assert.equal(r.clamp, 'min');
  assert.equal(r.meals[0].parts[0].q, '60 g');
  assert.equal(r.rem, 400 - 506);
});

test('a day with no flex part keeps factor 1 and reports the whole gap', () => {
  const p = plan();
  p.dayPlan.rest.meals[0].parts[0] = { use: 'carbo', match: 'Rice' };
  const r = scaled(nutOf(p), 'rest', 900);
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
  const r = scaled(nutOf(p), 'rest', 5000, { units: { g: 'g', ml: 'ml', ud: 'pc' } });
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
  // the scaling model is baked once per base day with each meal's slot (the portion guide's budgets)
  assert.deepEqual(bake.base.train.sl, ['breakfast', 'lunch', null]);
  assert.deepEqual(bake.base.rest.sl, ['lunch', null]);
  assert.deepEqual(Object.keys(bake.base.rest).sort(), ['fixed', 'flex', 'sl']);
  assert.equal(bake.base.rest.flex.length, 1);
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
  const r = scaled(nutOf(p), 'rest', 650);
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
  const r = scaled(nutOf(withUnits('bollo', 100)), 'rest', 1102);
  assert.equal(r.meals[0].parts[0].q, '1 ud');
  assert.equal(r.factor, 1.7, '(1102 - 290 - 200) / 360 = 1.70 on the gram parts');
  assert.equal(r.meals[1].parts[0].q, '170 g');
  assert.ok(Math.abs(r.rem) <= REMAINDER_TOLERANCE_K, `rem ${r.rem}`);
  assert.equal(r.rem, 0);
  assert.equal(r.udOnly, false);
});

test('ud at factor 0.6: the unit rounds down, the gram factor is re-solved (and clamps honestly)', () => {
  // flex = 2 wraps (200) + rice (360) = 560; target 290 + 0.6 x 560 = 626 -> 1.2 wraps rounds to 1
  const r = scaled(nutOf(withUnits('wrap', 200)), 'rest', 626);
  assert.equal(r.meals[0].parts[0].q, '1 ud');
  assert.equal(r.factor, 0.66, '(626 - 290 - 100) / 360 = 0.66');
  assert.equal(r.meals[1].parts[0].q, '65 g');
  assert.ok(Math.abs(r.rem) <= 5, `rem ${r.rem}`);
  const low = scaled(nutOf(withUnits('wrap', 200)), 'rest', 500);
  assert.equal(low.clamp, 'min');
  assert.equal(low.factor, SCALE_MIN);
  assert.equal(low.rem, 500 - (290 + 100 + 216), 'what the clamp leaves over is reported');
});

test('only ud parts are flex: they round to whole units and the remainder is reported honestly', () => {
  // fixed 650 (rice not flex) + 1 bun flex: target 950 -> x1.5 -> 2 buns (400) -> 1050
  const r = scaled(nutOf(withUnits('bollo', 100, false)), 'rest', 950);
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
  const r = scaled(nutOf(p), 'rest', 290 + 390, { dec: ',' });
  assert.equal(r.meals[0].parts[0].q, '1 bowl ×1,30');
});

test('solveScale works on the compact model alone (what the page bakes) and matches the described model', () => {
  const p = withUnits('bollo', 100);
  const nut = nutOf(p);
  const model = JSON.parse(JSON.stringify(planModel(nut, 'rest')));
  assert.equal(model.fixed.length, 3);
  assert.deepEqual(model.flex.map((x) => x.m), [0, 1]);
  assert.deepEqual(model.flex[0].ln[0].slice(0, 3), ['ud', 100, 200]);
  for (const target of [500, 626, 900, 1102, 1500, 3000]) {
    const s = solveScale(model, target);
    const d = scaled(nut, 'rest', target);
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
  assert.deepEqual(Object.keys(same).sort(), ['allCapped', 'capped', 'clamp', 'dir', 'factor', 'meals', 'q', 'qa', 'rem', 'totals', 'udOnly'], 'no per-line macro bookkeeping (qm / qn) left');
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
  assert.equal(scaled(nut, 'rest', 650 + 106).meals[0].parts[0].q, '1 banana (~120 g)');
  const r = scaled(nut, 'rest', 1100);
  assert.match(r.meals[0].parts[0].q, /^\d*½? bananas? \(~\d+ g\)$/);
  assert.ok(Math.abs(r.rem) <= REMAINDER_TOLERANCE_K, `the gram parts absorb the half-piece rounding (rem ${r.rem})`);
  assert.ok(scaled(nut, 'rest', 1100, { lang: 'es' }).meals[0].parts[0].q.includes('plátano'));
});

test('a fixed countable part (and a ud food with a grams reference) shows pieces too', () => {
  const p = plan();
  p.dayPlan.rest.meals.unshift({ name: 'Breakfast', parts: [{ ing: 'huevo', amt: 200, label: 'Eggs' }, { ing: 'platano', amt: 150, label: 'Banana' }] });
  const nut = buildNutrition({ ...ING, huevo: EGG_PC, platano: BANANA }, p);
  const [eggs, banana] = scaled(nut, 'rest', 1000).meals[0].parts;
  assert.equal(eggs.q, '2 eggs (~100 g)');
  assert.equal(banana.q, '~1½ bananas (150 g)');
  assert.deepEqual(buildDayPlans(nut, p).fmt.pieces, {}, 'only pieces a baked flex LINE formats are baked');
});

test('ingredient names are localized by the build locale', () => {
  const p = plan();
  p.dayPlan.rest.meals[0].parts.push({ ing: 'arroz', amt: 50 });
  const nut = buildNutrition({ ...ING, arroz: { ...ING.arroz, name: { es: 'Arroz', en: 'Rice' } } }, p);
  assert.equal(scaled(nut, 'rest', 700, { lang: 'es' }).meals[0].parts[2].label, 'Arroz');
  assert.equal(scaled(nut, 'rest', 700, { lang: 'en' }).meals[0].parts[2].label, 'Rice');
});

test('named constants: one unit = UD_AMT (100) in a ud food, the piece grid is half a piece; both baked for the page', () => {
  assert.equal(UD_AMT, 100);
  assert.equal(PIECE_GRID, 0.5);
  assert.deepEqual(buildDayPlans(nutOf(), plan()).scale, { min: SCALE_MIN, max: SCALE_MAX, step: AMOUNT_STEP, ud: UD_AMT, grid: PIECE_GRID });
});

test('num.mjs: the shared rounding helpers', () => {
  assert.equal(round1(1.25), 1.3);
  assert.equal(round2(2.346), 2.35);
  assert.equal(round2(7), 7);
});

/* ---- realistic portion caps (`maxAmt`) + water-filling: no plate absorbs a whole day's carbs ---- */
// rest base + a potato flex part at dinner: fixed = chicken 200 + oil 90 = 290; flex = rice 100 g (360)
// + potato 300 g (258) [+ honey 20 g (60)]
const POTATO = { per: 100, k: 86, p: 2, c: 19, g: 0.1, unit: 'g', name: 'Potato' };
function capped({ riceCap = 150, potatoCap = null, honey = false, riceAmt = 100 } = {}) {
  const p = plan();
  p.data.carbo[0].recipe[0].amt = riceAmt;
  p.dayPlan.rest.meals.push({ name: 'Dinner', parts: [{ ing: 'patata', amt: 300, flex: 'carb' }] });
  if (honey) p.dayPlan.rest.meals.push({ name: 'Snack', parts: [{ ing: 'miel', amt: 20, flex: 'carb' }] });
  const ing = { ...ING, arroz: { ...ING.arroz, ...(riceCap ? { maxAmt: riceCap } : {}) }, patata: { ...POTATO, ...(potatoCap ? { maxAmt: potatoCap } : {}) } };
  return buildNutrition(ing, p);
}
const qOf = (r) => r.meals.flatMap((m) => m.parts.filter((x) => x.flex).map((x) => x.q));

test('water-filling: a part that would pass its cap is held there; the other flex parts absorb the rest', () => {
  // one factor: (1300 - 290) / 618 = 1.63 -> rice 163 g > 150 g cap; held at 150 g (540), potato: 470 / 258 = 1.82
  const r = scaled(capped(), 'rest', 1300);
  assert.deepEqual(qOf(r), ['150 g', '545 g']);
  assert.equal(r.factor, 1.82, 'the common factor of the parts still free');
  assert.equal(r.capped, true);
  assert.equal(r.allCapped, false);
  assert.equal(r.clamp, null);
  assert.ok(Math.abs(r.rem) <= 5, `rem ${r.rem}`);
  // under the cap nothing changes: one factor for every part
  const low = scaled(capped(), 'rest', 1100);
  assert.equal(low.capped, false);
  assert.equal(low.factor, 1.31);
  assert.deepEqual(qOf(low), ['130 g', '395 g']);
});

test('water-filling iterates until stable: capping one part can push the factor over another cap', () => {
  // pass 1: 1000 / 678 = 1.47 > potato cap 1.33 (400 g) -> pass 2: 656 / 420 = 1.56 > rice cap 1.5 -> pass 3: honey 116 / 60 = 1.93
  const r = scaled(capped({ potatoCap: 400, honey: true }), 'rest', 1290);
  assert.deepEqual(qOf(r), ['150 g', '400 g', '40 g']);
  assert.equal(r.factor, 1.93);
  assert.equal(r.capped, true);
  assert.equal(r.allCapped, false);
  assert.ok(Math.abs(r.rem) <= 10, `rem ${r.rem}`);
});

test('every flex part at its cap: the day stays short and says so (allCapped), never a bigger plate', () => {
  const r = scaled(capped({ potatoCap: 400 }), 'rest', 2000);
  assert.deepEqual(qOf(r), ['150 g', '400 g']);
  assert.equal(r.allCapped, true);
  assert.equal(r.capped, true);
  assert.equal(r.rem, 2000 - (290 + 540 + 344));
});

test('a written amount above its cap shrinks to the cap (the cap wins over the base plan and SCALE_MIN)', () => {
  const r = scaled(capped({ riceAmt: 200 }), 'rest', 1200);
  assert.equal(qOf(r)[0], '150 g');
  assert.equal(r.capped, true);
  const tiny = scaled(capped({ riceAmt: 300 }), 'rest', 500);
  assert.equal(qOf(tiny)[0], '150 g', 'even when the floor factor (0.6 x 300 g = 180 g) is above the cap');
});

test('a countable food never rounds past its cap (half pieces step down)', () => {
  const p = plan();
  p.dayPlan.rest.meals.unshift({ name: 'Snack', parts: [{ ing: 'platano', amt: 120, flex: 'carb' }] });
  const nut = buildNutrition({ ...ING, platano: { ...BANANA, maxAmt: 230 } }, p); // 230 g would round to 2 pieces (240 g): steps down
  const r = scaled(nut, 'rest', 1400);
  assert.equal(r.meals[0].parts[0].q, '1½ bananas (~180 g)');
  assert.equal(r.capped, true);
});

test('carb and fruit foods are flex by category (no mark needed); flex: null opts a part out', () => {
  const p = plan();
  p.dayPlan.rest.meals.push({ name: 'Snack', parts: [{ ing: 'platano', amt: 120 }, { ing: 'arroz', amt: 50, flex: null, label: 'Rice cake' }] });
  const ing = { ...ING, platano: { ...BANANA, cat: 'fruit' }, arroz: { ...ING.arroz, cat: 'carb' } };
  const nut = buildNutrition(ing, p);
  const r = scaled(nut, 'rest', 1300);
  const snack = r.meals[2].parts;
  assert.equal(snack[0].flex, true, 'a fruit scales without a flex mark');
  assert.notEqual(snack[0].q, '1 banana (~120 g)');
  assert.equal(snack[1].flex, false);
  assert.equal(snack[1].q, '50 g', 'flex: null keeps the written amount');
  assert.equal(planModel(nut, 'rest').flex.length, 2, 'the rice item (all carb lines) + the banana');
});

test('planFor carries capped / allCapped; a capped plate leaves the rest as the remainder (the guide\'s Extras)', () => {
  const pl = plan();
  const ing = { ...ING, arroz: { ...ING.arroz, maxAmt: 150 } };
  const bake = buildDayPlans(buildNutrition(ing, pl), pl);
  const x = planFor(bake, 'bulk', 'rest', null);
  assert.equal(x.capped, true);
  assert.equal(x.allCapped, true, 'the only flex part (rice) is at its cap');
  assert.equal(x.meals[0][0], Math.round(360 * 1.5 + 200), 'rice at its 150 g cap + chicken');
  assert.ok(x.rem > 0);
  assert.deepEqual(Object.keys(x).sort(), ['allCapped', 'base', 'capped', 'clamp', 'factor', 'fuelC', 'fuelK', 'meals', 'minutes', 'mt', 'rem', 't', 'tot', 'udOnly']);
});
