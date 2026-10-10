/* lib/nutrition/guide.mjs — Plan de hoy as a PORTION GUIDE: per-meal budgets from today's plan solve,
 * the example amount of one food for a macro, what is left after the food log, the defaults. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNutrition } from './macros.mjs';
import { buildDayPlans, planFor } from './scale.mjs';
import { buildBasics } from './basics.mjs';
import { MAIN_SLOTS } from './slots.mjs';
import { UD_AMT, PIECE_GRID } from './units.mjs';
import { AMOUNT_STEP } from './amounts.mjs';
import { foldName } from './names.mjs';
import {
  GUIDE_ROLES, ROLE_KEYS, GUIDE_FALLBACK, DONE_SHARE, COVERED_SHARE, EXTRAS_EXAMPLES,
  guideBudgets, oilMeals, OIL_SLOTS, exampleAmount, remaining, mealState, isCovered, dayRemaining, capByDay, DAYCAP_CASES, mealDefaults, extrasExamples, roleOptions, GUIDE_CASES,
} from './guide.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ING = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/ingredients.json'), 'utf8')).ingredients;
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/plan-data.example.json'), 'utf8'));
const GRID = { ud: UD_AMT, grid: PIECE_GRID, step: AMOUNT_STEP };

test('roles: protein / carbs (carb, legume, fruit) / fat, each reading its macro slot; fallbacks exist in the DB', () => {
  assert.deepEqual(ROLE_KEYS, ['p', 'c', 'f']);
  assert.deepEqual(GUIDE_ROLES.p.cats, ['protein']);
  assert.deepEqual(GUIDE_ROLES.c.cats, ['carb', 'legume', 'fruit']);
  assert.deepEqual(GUIDE_ROLES.f.cats, ['fat']);
  assert.deepEqual([GUIDE_ROLES.p.at, GUIDE_ROLES.c.at, GUIDE_ROLES.f.at], [1, 2, 3]);
  for (const r of ROLE_KEYS) assert.ok(GUIDE_ROLES[r].cats.includes(ING[GUIDE_FALLBACK[r]].cat), `${r} fallback ${GUIDE_FALLBACK[r]}`);
  assert.equal(DONE_SHARE, 0.9);
  assert.equal(COVERED_SHARE, 0.1);
});

test('guideBudgets: each main meal = the solved plan meals of its slot; Extras = meals target - the three, never negative', () => {
  const x = { meals: [[500, 30, 60, 12], [800, 50, 90, 20], [300, 25, 30, 5], [700, 45, 80, 18], [100, 0, 0, 11]], mt: { k: 2500, p: 150, c: 280, f: 60 } };
  const slots = ['breakfast', 'lunch', 'postworkout', 'dinner', null];
  const b = guideBudgets(x, slots, MAIN_SLOTS);
  assert.deepEqual(b.meals.breakfast, { k: 500, p: 30, c: 60, f: 12 });
  assert.deepEqual(b.meals.lunch, { k: 800, p: 50, c: 90, f: 20 });
  assert.deepEqual(b.meals.dinner, { k: 700, p: 45, c: 80, f: 18 });
  assert.deepEqual(b.extras, { k: 500, p: 25, c: 50, f: 10 });
  assert.deepEqual(b.total, { k: 2500, p: 150, c: 280, f: 60 });
  assert.equal(b.clamped, false);
  // two meals of one slot add up; a slot with no meal is a zero budget
  const two = guideBudgets({ meals: [[400, 20, 50, 10], [200, 10, 20, 5]], mt: { k: 900, p: 40, c: 100, f: 20 } }, ['lunch', 'lunch'], MAIN_SLOTS);
  assert.deepEqual(two.meals.lunch, { k: 600, p: 30, c: 70, f: 15 });
  assert.deepEqual(two.meals.breakfast, { k: 0, p: 0, c: 0, f: 0 });
  // the main meals already past the target in a macro: that Extras macro clamps at 0 and says so
  const over = guideBudgets({ meals: [[1500, 100, 100, 50], [1200, 60, 150, 20]], mt: { k: 2500, p: 150, c: 280, f: 60 } }, ['lunch', 'dinner'], MAIN_SLOTS);
  assert.deepEqual(over.extras, { k: 0, p: 0, c: 30, f: 0 });
  assert.equal(over.clamped, true);
});

test('guideBudgets: a cooking-oil meal (slotless, all fat) is split evenly between lunch and dinner', () => {
  assert.deepEqual(OIL_SLOTS, ['lunch', 'dinner']);
  const mt = { k: 2500, p: 150, c: 280, f: 65 };
  const rows = [[500, 30, 60, 12], [800, 50, 90, 20], [700, 45, 80, 18], [91, 0, 0, 11], [20, 1, 2, 1]];
  const slots = ['breakfast', 'lunch', 'dinner', null, null]; // 3 = cooking oil, 4 = an after-lunch coffee
  const b = guideBudgets({ meals: rows, mt }, slots, MAIN_SLOTS, [3]);
  assert.deepEqual(b.meals.lunch, { k: 846, p: 50, c: 90, f: 26 }, 'half the oil (odd numbers: lunch takes the rounded half)');
  assert.deepEqual(b.meals.dinner, { k: 745, p: 45, c: 80, f: 23 });
  assert.deepEqual(b.meals.breakfast, { k: 500, p: 30, c: 60, f: 12 });
  assert.deepEqual(b.extras, { k: 409, p: 25, c: 50, f: 4 }, 'the coffee stays in Extras, the oil does not');
  // only one of lunch / dinner in the plan: the whole oil goes there
  const one = guideBudgets({ meals: [[800, 50, 90, 20], [90, 0, 0, 10]], mt }, ['lunch', null], MAIN_SLOTS, [1]);
  assert.deepEqual(one.meals.lunch, { k: 890, p: 50, c: 90, f: 30 });
  assert.deepEqual(one.meals.dinner, { k: 0, p: 0, c: 0, f: 0 });
  // neither: Extras keeps it
  const none = guideBudgets({ meals: [[500, 30, 60, 12], [90, 0, 0, 10]], mt }, ['breakfast', null], MAIN_SLOTS, [1]);
  assert.deepEqual(none.extras, { k: 2000, p: 120, c: 220, f: 53 });
  // no oil list: as before (the oil meal is an add-on)
  assert.deepEqual(guideBudgets({ meals: rows, mt }, slots, MAIN_SLOTS).extras, guideBudgets({ meals: rows, mt }, slots, MAIN_SLOTS, []).extras);
});

test('oilMeals: the slotless meals whose parts are all fat-category foods (the example plan\'s "Cooking oil")', () => {
  const nut = buildNutrition(ING, PLAN);
  assert.deepEqual(oilMeals(nut, 'train'), [4]);
  assert.deepEqual(oilMeals(nut, 'rest'), [4]);
  const plan = (meals) => ({ ...PLAN, dayPlan: { ...PLAN.dayPlan, rest: { meals } } });
  const check = (meals) => oilMeals(buildNutrition(ING, plan(meals)), 'rest');
  assert.deepEqual(check([{ name: 'Oil', parts: [{ ing: 'aceiteoliva', amt: 10 }] }]), [0]);
  assert.deepEqual(check([{ name: 'Lunch', parts: [{ ing: 'aceiteoliva', amt: 10 }] }]), [], 'a slotted meal is its own budget');
  assert.deepEqual(check([{ name: 'Coffee', parts: [{ ing: 'cafe', amt: 100 }] }]), [], 'not fat: an add-on');
  assert.deepEqual(check([{ name: 'Mixed', parts: [{ ing: 'aceiteoliva', amt: 10 }, { ing: 'pollo', amt: 100 }] }]), [], 'every part must be fat');
  assert.deepEqual(check([{ name: 'Empty', parts: [] }]), []);
});

test('guideBudgets on the example plan: the guide adds up to the MEALS target for every goal x day type', () => {
  const days = buildDayPlans(buildNutrition(ING, PLAN), PLAN, {});
  const bake = JSON.parse(JSON.stringify(days));
  for (const g of days.goals) for (const d of days.dayTypes) {
    const x = planFor(bake, g, d);
    const b = guideBudgets(x, bake.base[x.base].sl, MAIN_SLOTS, oilMeals(buildNutrition(ING, PLAN), x.base));
    const sum = (m) => MAIN_SLOTS.reduce((s, sl) => s + b.meals[sl][m], 0) + b.extras[m];
    if (!b.clamped) for (const m of ['k', 'p', 'c', 'f']) assert.equal(sum(m), b.total[m], `${g}/${d} ${m}`);
    for (const sl of MAIN_SLOTS) assert.ok(b.meals[sl].k > 0, `${g}/${d}: ${sl} has a budget`);
    assert.equal(b.total.k, x.mt.k);
  }
});

test('exampleAmount: grams of a macro -> the food amount on its grid (5 g, half pieces, whole units), capped at maxAmt', () => {
  const pollo = { u: 'g', m: [109, 22.9, 0, 2.3] };
  assert.deepEqual(exampleAmount(pollo, 'p', 45, GRID), { amt: 195, capped: false }); // 45 / 0.229 = 196.5 -> 195
  const arroz = { u: 'g', m: [360, 7, 79, 1], x: 150 };
  assert.deepEqual(exampleAmount(arroz, 'c', 80, GRID), { amt: 100, capped: false });
  assert.deepEqual(exampleAmount(arroz, 'c', 200, GRID), { amt: 150, capped: true }); // 253 g -> its 150 g maximum
  const huevo = { u: 'ud', m: [72, 6.3, 0.4, 5], pc: { a: 100, r: 50, o: 'egg', m: 'eggs' } };
  assert.deepEqual(exampleAmount(huevo, 'p', 20, GRID), { amt: 300, capped: false }); // 3.2 eggs -> 3
  const platano = { u: 'g', m: [88, 0.8, 22.5, 0.3], pc: { a: 120, r: null, o: 'banana', m: 'bananas' }, x: 240 };
  assert.deepEqual(exampleAmount(platano, 'c', 40, GRID), { amt: 180, capped: false }); // 178 g -> 1½ bananas
  assert.deepEqual(exampleAmount(platano, 'c', 90, GRID), { amt: 240, capped: true });
  const aceite = { u: 'g', m: [900, 0, 0, 100], pc: { a: 10, r: null, o: 'tbsp', m: 'tbsp' } };
  assert.deepEqual(exampleAmount(aceite, 'f', 12, GRID), { amt: 10, capped: false }); // 12 g -> 1 tablespoon
  assert.deepEqual(exampleAmount(aceite, 'f', 2, GRID), { amt: 5, capped: false }); // never below half a piece
  const leche = { u: 'ml', m: [46, 3.4, 4.8, 1.7] };
  assert.deepEqual(exampleAmount(leche, 'c', 10, GRID), { amt: 210, capped: false });
});

test('exampleAmount: nothing to supply or a food without that macro -> null', () => {
  const pollo = { u: 'g', m: [109, 22.9, 0, 2.3] };
  assert.equal(exampleAmount(pollo, 'c', 50, GRID), null);
  assert.equal(exampleAmount(pollo, 'p', 0, GRID), null);
  assert.equal(exampleAmount(pollo, 'p', -3, GRID), null);
  assert.equal(exampleAmount(null, 'p', 10, GRID), null);
  assert.equal(exampleAmount({ u: 'g', m: [100, null, 1, 1] }, 'p', 10, GRID), null);
});

test('remaining / mealState / isCovered: what is left after the log (floor 0), done at >= 90 %, covered at <= 10 % left', () => {
  const b = { k: 800, p: 50, c: 90, f: 20 };
  assert.deepEqual(remaining(b, { k: 300, p: 20, c: null, f: 25 }), { k: 500, p: 30, c: 90, f: 0 });
  assert.deepEqual(remaining(b, null), b);
  assert.equal(mealState(b, null), null);
  assert.equal(mealState(b, { k: 0, p: 0, c: 0, f: 0 }), null);
  assert.equal(mealState(b, { k: 300, p: 0, c: 0, f: 0 }), 'partial');
  assert.equal(mealState(b, { k: 720, p: 0, c: 0, f: 0 }), 'done');
  assert.equal(mealState({ k: 0, p: 0, c: 0, f: 0 }, { k: 50, p: 0, c: 0, f: 0 }), 'done');
  assert.equal(isCovered(5, 50), true);
  assert.equal(isCovered(6, 50), false);
  assert.equal(isCovered(0, 0), true);
});

test('dayRemaining: the meals target - everything logged today (main meals + add-ons), floor 0 — the "Left today" line', () => {
  const total = { k: 2500, p: 150, c: 280, f: 65 };
  const groups = { meals: { breakfast: { k: 600, p: 30, c: 70, f: 20.6 }, lunch: { k: 900, p: 50, c: 100, f: 40 }, dinner: { k: 0, p: 0, c: 0, f: 0 } }, addon: { k: 150, p: 5, c: 20, f: 12 } };
  assert.deepEqual(dayRemaining(total, groups, MAIN_SLOTS), { k: 850, p: 65, c: 90, f: 0 });
  assert.deepEqual(dayRemaining(total, { meals: {}, addon: null }, MAIN_SLOTS), total, 'nothing logged: the whole target');
  assert.equal(dayRemaining(total, null, MAIN_SLOTS), null, 'no food log: no day remainder');
});

test('capByDay: a row shows min(meal left, day left); covered by the day at <= 10 % of the day target left', () => {
  // 2026-10-06: 72.6 g fat logged vs a 65 g day target -> nothing left today, the dinner fat row is covered by the day
  assert.deepEqual(capByDay(23, 0, 65), { left: 0, byDay: true });
  // the day has 30 g carbs left, the lunch row 109 g -> capped to 30 (30 > 10 % of 280: still open)
  assert.deepEqual(capByDay(109, 30, 280), { left: 30, byDay: false });
  // the day allows more than the meal: the meal's own left is unchanged
  assert.deepEqual(capByDay(25, 90, 150), { left: 25, byDay: false });
  assert.deepEqual(capByDay(25, 15, 150), { left: 15, byDay: true });
  // no day remainder (no food log): unchanged
  assert.deepEqual(capByDay(40, null, 150), { left: 40, byDay: false });
  for (const c of DAYCAP_CASES) assert.deepEqual(capByDay(c.meal, c.day, c.total), c.expect, JSON.stringify(c));
});

test('mealDefaults: per main meal and role, the role food that supplies most of that macro in the base plan, else the fallback', () => {
  const nut = buildNutrition(ING, PLAN);
  const train = mealDefaults(nut, 'train');
  assert.deepEqual(Object.keys(train), MAIN_SLOTS);
  assert.deepEqual(train.lunch, { p: 'pollo', c: 'arroz', f: GUIDE_FALLBACK.f }, 'lunch has no fat-category food: the fallback');
  assert.equal(train.breakfast.c, 'avena');
  assert.equal(train.breakfast.p, 'claras');
  assert.equal(train.dinner.c, 'patata');
  for (const sl of MAIN_SLOTS) for (const r of ROLE_KEYS) assert.ok(GUIDE_ROLES[r].cats.includes(ING[train[sl][r]].cat), `${sl}.${r}`);
  const rest = mealDefaults(nut, 'rest');
  assert.deepEqual(Object.keys(rest), MAIN_SLOTS);
});

test('extrasExamples: a few everyday add-ons with their kcal from the food DB (a fruit, a yogurt, a protein shake)', () => {
  const ex = extrasExamples(ING);
  assert.deepEqual(ex.map((e) => e.id), EXTRAS_EXAMPLES.map((e) => e.id));
  assert.deepEqual(ex.find((e) => e.id === 'fruit'), { id: 'fruit', k: Math.round(88 * 1.2) });
  assert.ok(ex.every((e) => Number.isInteger(e.k) && e.k > 0));
  assert.deepEqual(extrasExamples({}), [], 'a DB without those foods: no examples, no throw');
});

test('roleOptions: the basics of the role categories (log-only basics included) + the user products that state the macro, each group by name', () => {
  const basics = buildBasics(ING, 'es');
  const prods = [
    { id: 7, name: 'Tofu firme', brand: 'Demo', unit: 'g', per100: { kcal: 120, protein: 13, carbs: 2, fat: 7 } },
    { id: 8, name: 'Agua', unit: 'ml', per100: { kcal: 0, protein: 0, carbs: 0, fat: 0 } },
    { id: 9, name: 'Batido', unit: 'ml', per100: { kcal: 60, protein: null, carbs: 5, fat: 1 } },
  ];
  const p = roleOptions(basics, prods, 'p');
  const keys = p.basics.map((o) => o.id);
  assert.ok(keys.includes('b:pollo') && keys.includes('b:jamoncocido'), 'swap:false basics are fine as examples');
  assert.ok(!keys.includes('b:arroz'));
  const folded = p.basics.map((o) => foldName(o.n));
  for (let i = 1; i < folded.length; i++) assert.ok(folded[i - 1] <= folded[i], `sorted by name: ${folded[i - 1]} / ${folded[i]}`);
  assert.deepEqual(p.products.map((o) => o.id), ['p:7']);
  assert.deepEqual(p.products[0].food, { u: 'g', m: [120, 13, 2, 7] });
  const c = roleOptions(basics, null, 'c');
  assert.ok(c.basics.some((o) => o.id === 'b:lentejas') && c.basics.some((o) => o.id === 'b:platano'));
  assert.deepEqual(c.products, []);
});

test('GUIDE_CASES are well-formed (the page port is pinned against them)', () => {
  assert.ok(GUIDE_CASES.length >= 10);
  for (const c of GUIDE_CASES) assert.deepEqual(exampleAmount(c.food, c.role, c.g, GRID), c.expect, JSON.stringify(c));
});
