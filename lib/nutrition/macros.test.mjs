/* Unit tests for lib/nutrition/macros.mjs — pure nutrition macro computation
 * extracted from data/nutrition/generate.js. These use small synthetic
 * fixtures (not the real ingredients.json/plan-data.json) so the suite stays
 * deterministic and independent of the owner's personal plan. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNutrition, validateNutrition } from './macros.mjs';

function fixtureIngredients() {
  return {
    lentejas: { per: 100, k: 115, p: 9, c: 20, g: 0.4, unit: 'g', name: 'Lentejas' },
    pollo: { per: 100, k: 165, p: 31, c: 0, g: 3.6, unit: 'g' },
    huevo: { per: 100, k: 155, p: 13, c: 1.1, g: 11, unit: 'ud' },
    queso: { per: 100, k: 300, p: 25, c: 2, g: 22, unit: 'g' },
    lechuga: { per: 100, k: 15, p: 1.4, c: 2.9, g: 0.2, unit: 'g' },
  };
}

function fixturePlan() {
  return {
    data: {
      proteina: [
        { n: 'Pollo', l: 'pollo', recipe: [{ ing: 'pollo', amt: 150 }], t: 'lean' },
        { n: 'Ninguno', l: 'ninguno', none: true },
      ],
      desayuno: [
        {
          n: 'Huevos', tier: '🟢', cap: 'caption', recipe: [
            { ing: 'huevo', amt: 100, label: 'Huevo' },
          ],
        },
      ],
    },
    extras: {
      queso: { l: 'Queso', recipe: [{ ing: 'queso', amt: 30 }] },
      lechuga: { l: 'Lechuga', recipe: [{ ing: 'lechuga', amt: 100 }] },
    },
    quesoKeys: ['queso'],
    vegKeys: ['lechuga'],
    legumeKeys: ['lentejas'],
    legumePlate: 300,
    dayPlan: {
      train: {
        kcalNote: 'deficit note',
        meals: [
          { name: 'Comida', parts: [{ ing: 'pollo', amt: 150 }, { use: 'proteina', match: 'Pollo' }] },
        ],
      },
      rest: {
        kcalNote: 'deficit note',
        meals: [
          { name: 'Comida', parts: [{ ing: 'pollo', amt: 100 }] },
        ],
      },
    },
    targets: { train: { p: 180 } },
  };
}

test('buildNutrition resolves a recipe item into rounded per-serving macros', () => {
  const nut = buildNutrition(fixtureIngredients(), fixturePlan());
  const pollo = nut.D.proteina.find((o) => o.n === 'Pollo');
  // 150g pollo: k=165*1.5=247.5->248, p=31*1.5=46.5->46.5(rm keeps 1 decimal), c=0, g=5.4
  assert.equal(pollo.k, 248);
  assert.equal(pollo.p, 46.5);
  assert.equal(pollo.g, 5.4);
});

test('buildNutrition resolves a "none" placeholder item to zero macros', () => {
  const nut = buildNutrition(fixtureIngredients(), fixturePlan());
  const ninguno = nut.D.proteina.find((o) => o.n === 'Ninguno');
  assert.deepEqual([ninguno.k, ninguno.p, ninguno.c, ninguno.g], [0, 0, 0, 0]);
});

test('macro() throws on an unknown ingredient reference (integrity guard)', () => {
  const nut = buildNutrition(fixtureIngredients(), fixturePlan());
  assert.throws(() => nut.macro([{ ing: '__nope__', amt: 1 }], 'k'), /unknown ingredient/);
});

test('mealMacros sums a meal\'s parts — raw {ing,amt} parts stay UNROUNDED, matched-item parts use the rounded resolve()', () => {
  const nut = buildNutrition(fixtureIngredients(), fixturePlan());
  const meal = nut.DAYPLAN.train.meals[0];
  const m = nut.mealMacros(meal);
  // part 1: raw ing, 150g pollo, computed directly from ing.k*f = 165*1.5 = 247.5 (no rounding)
  // part 2: matched "Pollo" item -> resolve() rounds via rk() first = rk(247.5) = 248
  assert.equal(m.k, 247.5 + 248);
});

test('dayTotalK derives the day total from mealMacros — the same total targetFor uses for k', () => {
  const nut = buildNutrition(fixtureIngredients(), fixturePlan());
  const total = nut.dayTotalK('train');
  assert.equal(total, Math.round(247.5 + 248));
  const target = nut.targetFor('train');
  assert.equal(target.k, total, 'TARGET.k must never drift from the generated day total');
  assert.equal(target.p, 180, 'owner-set target from plan.targets.train.p');
  assert.equal(target.fatMax, 75, 'falls back to the TARGET_DEFAULTS when unset');
});

test('targetFor falls back to defaults entirely when plan.targets is absent', () => {
  const plan = fixturePlan();
  delete plan.targets;
  const nut = buildNutrition(fixtureIngredients(), plan);
  const rest = nut.targetFor('rest');
  assert.equal(rest.p, 170);
  assert.equal(rest.fatMax, 70);
});

// fixturePlan()'s single tiny meal is deliberately far outside the legacy sane-band
// check (train 2000-2800 kcal, rest 1700-2400) so validateNutrition needs its own
// band-compliant fixture — same ingredients/extras/legume config, larger day meals.
function fixturePlanForValidation() {
  const plan = fixturePlan();
  plan.dayPlan = {
    train: { kcalNote: 'note', meals: [{ name: 'Comida', parts: [{ ing: 'pollo', amt: 1330 }] }] }, // 2194.5 kcal
    rest: { kcalNote: 'note', meals: [{ name: 'Comida', parts: [{ ing: 'pollo', amt: 1200 }] }] }, // 1980 kcal
  };
  return plan;
}

test('validateNutrition passes on a well-formed fixture plan and reports unused-ingredient warnings', () => {
  const res = validateNutrition(fixtureIngredients(), fixturePlanForValidation());
  assert.equal(res.ok, true);
  assert.ok(Array.isArray(res.warnings));
});

test('validateNutrition catches a broken legumeKeys reference', () => {
  // Every {ing,...} reference inside RAW/RAWEX/DAYPLAN is ALSO eagerly resolved elsewhere
  // (D/EX construction via resolve(), or the band-check loop's mealMacros()/resolvePart()),
  // so those throw earlier with their own, more specific message. legumeKeys is the one
  // reference list validate() checks that nothing else eagerly resolves — a genuinely
  // reachable exercise of validate()'s own error collection.
  const plan = fixturePlanForValidation();
  plan.legumeKeys = ['__missing__'];
  assert.throws(
    () => validateNutrition(fixtureIngredients(), plan),
    /legumeKeys references unknown ingredient: __missing__/,
  );
});
