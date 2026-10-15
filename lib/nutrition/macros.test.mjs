/* Unit tests for lib/nutrition/macros.mjs — pure nutrition macro computation
 * extracted from data/nutrition/generate.mjs. These use small synthetic
 * fixtures (not the real ingredients.json/plan-data.json) so the suite stays
 * deterministic and independent of the user's personal plan. */
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

test('dayTotalK derives the day total from mealMacros', () => {
  const nut = buildNutrition(fixtureIngredients(), fixturePlan());
  assert.equal(nut.dayTotalK('train'), Math.round(247.5 + 248));
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

test('validateNutrition collapses unused ingredients into ONE warning with the count (a shared food DB is not a problem)', () => {
  const ing = fixtureIngredients();
  ing.unusedA = { ...ing.pollo };
  ing.unusedB = { ...ing.pollo };
  const res = validateNutrition(ing, fixturePlanForValidation());
  const unused = res.warnings.filter((w) => /not used by this plan/.test(w));
  const n = Object.keys(ing).filter((k) => !['pollo'].includes(k)).length;
  assert.equal(unused.length, 1, res.warnings.join('\n'));
  assert.match(unused[0], /^\d+ ingredients in ingredients\.json are not used by this plan/);
  assert.ok(Number(unused[0].match(/^\d+/)[0]) >= 2 && Number(unused[0].match(/^\d+/)[0]) <= n);
});

test('validateNutrition (generate.mjs --check) reports malformed ingredient unit metadata (piece / weighed)', () => {
  const ing = fixtureIngredients();
  ing.pollo.weighed = 'boiled';
  ing.huevo.piece = { name: { es: 'huevo', en: 'egg' }, amt: 60 };
  assert.throws(() => validateNutrition(ing, fixturePlanForValidation()), (e) => /ingredient pollo: weighed/.test(e.message) && /ingredient huevo: piece\.amt/.test(e.message));
});

test('validateNutrition (generate.mjs --check) fails on a malformed portion cap (maxAmt)', () => {
  const ing = fixtureIngredients();
  ing.pollo.maxAmt = -5;
  assert.throws(() => validateNutrition(ing, fixturePlanForValidation()), /ingredient pollo: maxAmt must be a positive number/);
  ing.pollo.maxAmt = 300;
  assert.doesNotThrow(() => validateNutrition(ing, fixturePlanForValidation()));
});

test('validateNutrition (generate.mjs --check) warns, never fails, on an ingredient without a name; a malformed name fails', () => {
  const ing = fixtureIngredients();
  delete ing.pollo.name;
  const res = validateNutrition(ing, fixturePlanForValidation());
  assert.ok(res.warnings.includes('ingredient pollo has no name (the page shows its key); add name: {es, en}'));
  ing.pollo.name = { es: 'Pollo' };
  assert.throws(() => validateNutrition(ing, fixturePlanForValidation()), /ingredient pollo: name must be/);
});

test('validateNutrition (generate.mjs --check) warns on an ingredient without a food category; an unknown one fails', () => {
  const ing = fixtureIngredients();
  delete ing.pollo.cat;
  const res = validateNutrition(ing, fixturePlanForValidation());
  assert.ok(res.warnings.some((w) => w.startsWith('ingredient pollo has no cat')), res.warnings.join('\n'));
  ing.pollo.cat = 'meat';
  assert.throws(() => validateNutrition(ing, fixturePlanForValidation()), /ingredient pollo: cat must be one of protein, carb/);
});

// ---- legacy day-builder fields (the removed Constructor de día / `registro`): an existing personal
// plan may still carry them. They are ignored: never an error, one non-fatal warning naming each.
test('validateNutrition accepts a plan carrying the removed day builder\'s legacy fields (ignored, warned)', () => {
  const plan = fixturePlanForValidation();
  plan.extrasDisplay = [{ header: 'x', items: [{ key: '__gone__', name: 'Gone' }] }];
  plan.indulgeKeys = ['__missing__'];
  plan.alcoholKeys = ['__not_indulge__'];
  plan.mealReplaceKeys = ['__not_indulge__'];
  plan.page = { title: 'T', offPlanPlaceholder: 'x', notes: { 'registro.intro': 'x' } };
  const res = validateNutrition(fixtureIngredients(), plan);
  assert.equal(res.ok, true);
  for (const k of ['extrasDisplay', 'indulgeKeys', 'alcoholKeys', 'mealReplaceKeys', 'page.offPlanPlaceholder']) {
    assert.ok(res.warnings.some((w) => w.includes(k) && /ignored/.test(w)), 'warns about ' + k);
  }
  const nut = buildNutrition(fixtureIngredients(), plan);
  for (const k of ['extraKeys', 'extraNames', 'indulge', 'alcoholKeys', 'mealReplaceKeys', 'targetFor']) {
    assert.equal(nut[k], undefined, k + ' is no longer computed');
  }
});

test('validateNutrition rejects a malformed page block', () => {
  const plan = fixturePlanForValidation();
  plan.page = { title: '', h1: 'Panel', sub: 'x', notes: {} };
  assert.throws(
    () => validateNutrition(fixtureIngredients(), plan),
    /page.title must be a non-empty string/,
  );
});

test('validateNutrition passes with a well-formed page block', () => {
  const plan = fixturePlanForValidation();
  plan.page = { title: 'My Plan', kicker: 'Cut', h1: 'Panel', sub: 'x', footerHtml: 'f', notes: { 'dia.footnote': 'n' } };
  assert.equal(validateNutrition(fixtureIngredients(), plan).ok, true);
});

test('validateNutrition: page.h1 and page.sub are optional (no visible header), but must be well-formed when present', () => {
  const plan = fixturePlanForValidation();
  plan.page = { title: 'My Plan', notes: {} };
  assert.equal(validateNutrition(fixtureIngredients(), plan).ok, true, 'no h1, no sub');
  plan.page = { title: 'My Plan', h1: '', notes: {} };
  assert.throws(() => validateNutrition(fixtureIngredients(), plan), /page.h1 must be a non-empty string when present/);
  plan.page = { title: 'My Plan', sub: 3, notes: {} };
  assert.throws(() => validateNutrition(fixtureIngredients(), plan), /page.sub must be a string when present/);
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

// ---- the Tablas tab's view-model fields: `breakfast` (per breakfast item a caption and its recipe rows)
// and `fruitSummary` (min/max kcal + carbs over D.postre's fruit items, the two macros that vary
// meaningfully, and a rounded mean of protein / fat, near constant across fruit).
function fixturePlanWithBreakfastAndFruit() {
  const plan = fixturePlan();
  plan.data.desayuno = [
    {
      n: 'Huevos', tier: '🟢', cap: 'caption A', recipe: [
        { ing: 'queso', amt: 30, label: 'Queso base' },
        { ing: 'huevo', amt: 50, label: 'Huevo', group: 'g1' },
        { ing: 'huevo', amt: 50, group: 'g1' }, // merges into the row opened above (same group)
        { ing: 'queso', amt: 20, label: 'Anclaje', link: 'acc-anclaje' },
      ],
    },
    { n: 'Ninguno', l: 'ninguno', none: true }, // filtered out of breakfast — the "— none —" row
  ];
  plan.data.postre = [
    { l: 'none', none: 1 },
    { n: 'Banana', cat: 'fruit', q: '1 (120 g)', recipe: [{ ing: 'huevo', amt: 10 }] },
    { n: 'Apple', cat: 'fruit', q: '1 (150 g)', recipe: [{ ing: 'lechuga', amt: 200 }] },
    { n: 'Yogurt', cat: 'yogurt', q: '125 g', recipe: [{ ing: 'queso', amt: 40 }] },
  ];
  return plan;
}

test('buildNutrition.breakfast: one entry per non-"none" desayuno item, cap matches brkTable()\'s format, rows merge same-group lines and carry link/qty', () => {
  const nut = buildNutrition(fixtureIngredients(), fixturePlanWithBreakfastAndFruit());
  assert.equal(nut.breakfast.length, 1, 'the "none" desayuno row is excluded');
  const [huevos] = nut.breakfast;
  // queso 30g (k=90,p=7.5,c=0.6,g=6.6) + huevo merged 50+50=100g (k=155,p=13,c=1.1,g=11)
  // + queso 20g (k=60,p=5,c=0.4,g=4.4) -> totals k=305, p=25.5->26, c=2.1->2, g=22->22
  assert.equal(huevos.cap, '🟢 caption A · ~305 kcal · 26 P · 2 C · 22 G');
  assert.equal(huevos.rows.length, 3, 'group g1\'s two lines merge into one row');
  const merged = huevos.rows.find((r) => r.name === 'Huevo');
  assert.ok(merged, 'merged group row uses the label of the line that opened the group');
  assert.equal(merged.qty, '1', 'amt 100g, huevo unit is "ud" -> qty is amt/100');
  assert.equal(merged.k, 155, 'merged row sums both 50g lines\' kcal (huevo k=155/100g -> 50g+50g=100g=155kcal)');
  const anchorRow = huevos.rows.find((r) => r.link === 'acc-anclaje');
  assert.ok(anchorRow, 'a recipe line with `link` carries it through to the row for the jump() button');
  assert.equal(anchorRow.name, 'Anclaje');
  assert.equal(anchorRow.qty, '20 g', 'queso unit is "g" -> qty is "<amt> <unit>"');
});

test('buildNutrition.fruitSummary: kcal/carb are min–max over fruit-cat postre items, protein/fat are the rounded average', () => {
  const nut = buildNutrition(fixtureIngredients(), fixturePlanWithBreakfastAndFruit());
  // Banana: 10g huevo -> k=15.5->16(rk), p=1.3->1.3(rm), c=0.11->0.1, g=1.1->1.1
  // Apple: 200g lechuga -> k=30, p=2.8, c=5.8, g=0.4
  assert.equal(nut.fruitSummary.kMin, 16);
  assert.equal(nut.fruitSummary.kMax, 30);
  assert.equal(nut.fruitSummary.cMin, 0.1);
  assert.equal(nut.fruitSummary.cMax, 5.8);
  assert.equal(nut.fruitSummary.p, Math.round((1.3 + 2.8) / 2), 'rounded average protein across the 2 fruit items');
  assert.equal(nut.fruitSummary.g, Math.round((1.1 + 0.4) / 2), 'rounded average fat across the 2 fruit items');
});

test('buildNutrition.fruitSummary is null when the plan has no fruit-cat postre items (degrades gracefully, matches empty-data conventions elsewhere)', () => {
  const plan = fixturePlan(); // base fixture has no `postre` key at all
  const nut = buildNutrition(fixtureIngredients(), plan);
  assert.equal(nut.fruitSummary, null);
  assert.deepEqual(nut.breakfast.length, 1, 'base fixture\'s single desayuno item still resolves');
});

// ---- configurable day kcal sanity band (plan.validation.kcalBand)
test('validateNutrition applies the default kcal band when the plan sets none', () => {
  const plan = fixturePlanForValidation();
  plan.dayPlan.train.meals[0].parts[0].amt = 1800; // ~2970 kcal > default 2800
  assert.throws(
    () => validateNutrition(fixtureIngredients(), plan),
    /train-day total \d+ kcal outside sane band 2000-2800/,
  );
});

test('validateNutrition accepts a plan-level kcalBand override', () => {
  const plan = fixturePlanForValidation();
  plan.dayPlan.train.meals[0].parts[0].amt = 1800; // ~2970 kcal
  plan.validation = { kcalBand: { train: [2000, 3200], rest: [1700, 2700] } };
  assert.equal(validateNutrition(fixtureIngredients(), plan).ok, true);
});

test('validateNutrition enforces the overridden kcalBand bounds', () => {
  const plan = fixturePlanForValidation(); // rest ~1980 kcal
  plan.validation = { kcalBand: { train: [2000, 3200], rest: [2100, 2700] } };
  assert.throws(
    () => validateNutrition(fixtureIngredients(), plan),
    /rest-day total \d+ kcal outside sane band 2100-2700/,
  );
});

test('validateNutrition rejects a malformed kcalBand override', () => {
  const bad = [
    { train: [3200, 2000], rest: [1700, 2700] }, // min >= max
    { train: [2000, '3200'], rest: [1700, 2700] }, // non-numeric
    { train: [2000], rest: [1700, 2700] }, // wrong arity
    { train: [2000, 3200] }, // missing day
  ];
  for (const kcalBand of bad) {
    const plan = fixturePlanForValidation();
    plan.validation = { kcalBand };
    assert.throws(
      () => validateNutrition(fixtureIngredients(), plan),
      /validation\.kcalBand\.(train|rest) must be \[min, max\]/,
    );
  }
});

test('validateNutrition passes with nutrition v2 fields: targets.byGoal, page.goal, flex markers and meal slots', () => {
  const plan = fixturePlanForValidation();
  plan.page = { title: 'T', goal: 'cut' };
  plan.targets = { ...plan.targets, byGoal: { cut: { rest: { kcal: 2100, p: 160, f: 55 } } } };
  plan.dayPlan.train.meals[0].slot = 'lunch';
  plan.dayPlan.train.meals[0].parts[0].flex = 'carb';
  assert.equal(validateNutrition(fixtureIngredients(), plan).ok, true);
});

test('validateNutrition rejects a bad page.goal, a bad byGoal cell, an unknown flex kind and an unknown meal slot', () => {
  const plan = fixturePlanForValidation();
  plan.page = { title: 'T', goal: 'shred' };
  plan.targets = { byGoal: { cut: { tempo: { kcal: 1 } } } };
  plan.dayPlan.train.meals[0].slot = 'brunch';
  plan.dayPlan.train.meals[0].parts[0].flex = 'protein';
  assert.throws(() => validateNutrition(fixtureIngredients(), plan), (err) => {
    assert.match(err.message, /page\.goal/);
    assert.match(err.message, /byGoal\.cut\.tempo: unknown day type/);
    assert.match(err.message, /dayPlan train meal 0 part 0: flex must be "carb"/);
    assert.match(err.message, /dayPlan train meal 0: slot must be one of/);
    return true;
  });
});

test('validateNutrition reports a malformed fuel.items list by field', async () => {
  const fs = await import('node:fs');
  const ing = JSON.parse(fs.readFileSync(new URL('../../data/nutrition/ingredients.json', import.meta.url), 'utf8')).ingredients;
  const plan = JSON.parse(fs.readFileSync(new URL('../../data/nutrition/plan-data.example.json', import.meta.url), 'utf8'));
  assert.equal(validateNutrition(ing, { ...plan, fuel: { items: [{ name: 'Gel', carbs: 25, kind: 'fast' }] } }).ok, true);
  assert.throws(() => validateNutrition(ing, { ...plan, fuel: { items: [{ name: 'Gel', carbs: 0 }] } }), /fuel\.items\[0\]\.carbs/);
});

test('validateNutrition lists EVERY unknown ingredient (recipes, extras, day plan), not just the first', () => {
  const plan = fixturePlanForValidation();
  plan.data.proteina[0].recipe = [{ ing: '__a__', amt: 150 }];
  plan.extras.queso.recipe = [{ ing: '__b__', amt: 30 }];
  plan.dayPlan.rest.meals[0].parts = [{ ing: '__c__', amt: 100 }];
  assert.throws(() => validateNutrition(fixtureIngredients(), plan), (err) => {
    for (const k of ['__a__', '__b__', '__c__']) assert.match(err.message, new RegExp(`unknown ingredient: ${k}`), k);
    assert.match(err.message, /^plan-data\.json validation failed/);
    return true;
  });
});

test('validateNutrition reports a missing dayPlan day instead of crashing', () => {
  const plan = fixturePlanForValidation();
  delete plan.dayPlan.rest;
  assert.throws(() => validateNutrition(fixtureIngredients(), plan), /plan-data\.json validation failed[\s\S]*dayPlan\.rest must be an object with a "meals" array/);
  const none = fixturePlanForValidation();
  delete none.dayPlan;
  assert.throws(() => validateNutrition(fixtureIngredients(), none), /dayPlan\.train must be an object with a "meals" array[\s\S]*dayPlan\.rest/);
});

test('manual block Atwater sanity: within ±MANUAL_ATWATER_TOL of the kcal or MANUAL_ATWATER_ABS_KCAL, whichever is larger', async () => {
  const M = await import('./macros.mjs');
  assert.equal(M.MANUAL_ATWATER_TOL, 0.15);
  assert.equal(M.MANUAL_ATWATER_ABS_KCAL, 25);
  assert.equal(M.atwaterKcal({ p: 10, c: 20, g: 5 }), 165);
  // 1000 kcal: the 15 % band (150 kcal) is the larger one
  assert.equal(M.manualAtwaterOk({ k: 1000, p: 0, c: 0, g: 1150 / 9 }), true);
  assert.equal(M.manualAtwaterOk({ k: 1000, p: 0, c: 0, g: 1151 / 9 }), false);
  // 100 kcal: the 25 kcal floor is the larger one
  assert.equal(M.manualAtwaterOk({ k: 100, p: 31.25, c: 0, g: 0 }), true);
  assert.equal(M.manualAtwaterOk({ k: 100, p: 31.5, c: 0, g: 0 }), false);
});

test('validateNutrition: a plan without `extras` or with a manual breakfast gets validation messages, never a raw TypeError', () => {
  const noExtras = fixturePlanForValidation();
  delete noExtras.extras;
  assert.throws(() => validateNutrition(fixtureIngredients(), noExtras), (err) => {
    assert.ok(!(err instanceof TypeError), String(err));
    assert.match(err.message, /^plan-data\.json validation failed:\n {2}- extras must be an object/);
    return true;
  });
  const manualBreakfast = fixturePlanForValidation();
  manualBreakfast.data.desayuno = [{ n: 'Toast', tier: 'x', cap: 'c', manual: { k: 300, p: 10, c: 50, g: 6 } }];
  assert.throws(() => validateNutrition(fixtureIngredients(), manualBreakfast), (err) => {
    assert.ok(!(err instanceof TypeError), String(err));
    assert.match(err.message, /data\.desayuno "Toast" needs a recipe/);
    return true;
  });
});

// A plan error must be a clear validation message, never NaN in the tables or a raw TypeError.
const failsWith = (plan, re) => assert.throws(() => validateNutrition(fixtureIngredients(), plan), (err) => {
  assert.ok(!(err instanceof TypeError), String(err));
  assert.match(err.message, /^plan-data\.json validation failed/);
  assert.match(err.message, re);
  return true;
});

test('validateNutrition rejects an {ing} part without an amt (would write NaN into plan-tables.md)', () => {
  const plan = fixturePlanForValidation();
  plan.dayPlan.train.meals[0].parts.push({ ing: 'lechuga' });
  failsWith(plan, /dayPlan\.train\.meals\[0\]\.parts\[1\] \{ing: "lechuga"\} needs a numeric amt > 0/);
});

test('validateNutrition rejects an {ing} part whose amt is a string (would concatenate)', () => {
  const plan = fixturePlanForValidation();
  plan.dayPlan.rest.meals[0].parts[0].amt = '1200';
  failsWith(plan, /dayPlan\.rest\.meals\[0\]\.parts\[0\] \{ing: "pollo"\} needs a numeric amt > 0/);
});

test('validateNutrition rejects a recipe line with a non-finite or non-positive amt', () => {
  const plan = fixturePlanForValidation();
  plan.extras.queso.recipe[0].amt = 0;
  plan.data.desayuno[0].recipe[0].amt = null;
  failsWith(plan, /data\.desayuno\[0\]\.recipe\[0\] \{ing: "huevo"\} needs a numeric amt > 0 \(got null\)[\s\S]*extras\.queso\.recipe\[0\] \{ing: "queso"\} needs a numeric amt > 0 \(got 0\)/);
});

test('validateNutrition rejects a null meal and a meal without parts with a clear message', () => {
  const plan = fixturePlanForValidation();
  plan.dayPlan.train.meals.push(null);
  plan.dayPlan.rest.meals.push({ name: 'Cena' });
  failsWith(plan, /dayPlan\.train\.meals\[1\] must be an object with a "parts" array[\s\S]*dayPlan\.rest\.meals\[1\] must be an object with a "parts" array/);
});

test('validateNutrition: a NaN day total is outside the kcal band, never inside it', () => {
  // a manual block without k passes the Atwater check (NaN compares false) and makes the day total NaN: the band
  // check reads !(total >= lo && total <= hi), so NaN fails it instead of slipping through
  const plan = fixturePlanForValidation();
  plan.data.proteina.push({ n: 'Tofu', l: 'tofu', manual: { p: 10, c: 2, g: 5 } });
  plan.dayPlan.train.meals[0].parts.push({ use: 'proteina', match: 'Tofu' });
  failsWith(plan, /train-day total NaN kcal outside sane band 2000-2800/);
});
