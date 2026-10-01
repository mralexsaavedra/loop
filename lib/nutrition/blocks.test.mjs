/* lib/nutrition/blocks.mjs — choosable blocks of Plan de hoy (picks, swap rules, re-solve). Synthetic
 * fixtures only (never the owner's plan). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNutrition } from './macros.mjs';
import { buildDayPlans, planFor, solveScale, REMAINDER_TOLERANCE_K } from './scale.mjs';
import { applyPicks, partIds, optionKeys, isCarbStaple, swapFactor, BLOCK_ROLES, SWAP_SCALE_MAX, roleOf, ROLE, swapOption, swapIng, ingAmount, NONE_KEY, catKeys } from './blocks.mjs';
import { CAT_RULES } from './categories.mjs';
import { buildNutriToday } from './today.mjs';
import { lineCap, lineAmt } from './amounts.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ING = {
  arroz: { per: 100, k: 360, p: 7, c: 79, g: 1, unit: 'g', name: 'Rice' },
  pasta: { per: 100, k: 357, p: 12, c: 74, g: 1.5, unit: 'g', name: 'Pasta' },
  pollo: { per: 100, k: 110, p: 23, c: 0, g: 2, unit: 'g', name: 'Chicken' },
  atun: { per: 100, k: 110, p: 25, c: 0, g: 1, unit: 'g', name: 'Tuna' },
  pavo: { per: 100, k: 90, p: 20, c: 1, g: 1, unit: 'g', name: 'Turkey ham' },
  pan: { per: 100, k: 260, p: 8, c: 51, g: 1, unit: 'g', name: 'Bread' },
  yogur: { per: 100, k: 60, p: 6, c: 5, g: 2, unit: 'g', name: 'Yogurt' },
  platano: { per: 100, k: 88, p: 1, c: 22.5, g: 0.3, unit: 'g', name: 'Banana', piece: { name: { es: 'plátano', en: 'banana' }, plural: { es: 'plátanos', en: 'bananas' }, amt: 120 } },
  manzana: { per: 100, k: 52, p: 0.3, c: 14, g: 0.2, unit: 'g', name: 'Apple' },
  aceite: { per: 100, k: 900, p: 0, c: 0, g: 100, unit: 'g' },
  huevo: { per: 100, k: 72, p: 6, c: 0.4, g: 5, unit: 'ud', name: 'Egg' },
};

function plan() {
  const lunch = (tier) => ({
    name: 'Lunch',
    slot: 'lunch',
    parts: [
      { use: 'proteina', match: 'Chicken' },
      { use: 'carbo', tier, match: 'Rice', flex: 'carb' },
      { use: 'postre', match: 'Apple', flex: 'carb' },
    ],
  });
  return {
    data: {
      proteina: [
        { l: '— none —', none: 1 },
        { n: 'Chicken', t: 'lean', q: '150 g', recipe: [{ ing: 'pollo', amt: 150 }] },
        { n: 'Tuna', t: 'lean', q: '160 g', recipe: [{ ing: 'atun', amt: 160 }] },
        { n: 'Eggs', t: 'mod', q: '3', recipe: [{ ing: 'huevo', amt: 300 }] },
        { n: 'Ham + bread', t: 'mod', q: '—', recipe: [{ ing: 'pavo', amt: 100, label: 'Ham' }, { ing: 'pan', amt: 40, label: 'Toast' }] },
        { n: 'Bowl', t: 'fat', q: '1 bowl', manual: { k: 400, p: 20, c: 40, g: 15 } },
      ],
      carbo: {
        train: [{ l: '— none —', none: 1 }, { n: 'Rice', q: '120 g', recipe: [{ ing: 'arroz', amt: 120 }] }, { n: 'Pasta', q: '120 g', recipe: [{ ing: 'pasta', amt: 120 }] }, { n: 'Legumes', q: '~300 g', manual: { k: 380, p: 25, c: 63, g: 4 } }],
        rest: [{ l: '— none —', none: 1 }, { n: 'Rice', q: '90 g', recipe: [{ ing: 'arroz', amt: 90 }] }, { n: 'Pasta', q: '90 g', recipe: [{ ing: 'pasta', amt: 90 }] }],
      },
      postre: [
        { n: 'Apple', cat: 'fruit', q: '1 (150 g)', recipe: [{ ing: 'manzana', amt: 150 }] },
        { n: 'Banana', cat: 'fruit', q: '1 (120 g)', recipe: [{ ing: 'platano', amt: 120 }] },
        { n: 'Yogurt', cat: 'yogurt', q: '125 g', recipe: [{ ing: 'yogur', amt: 125 }] },
      ],
      solo: [{ n: 'Only one', recipe: [{ ing: 'arroz', amt: 50 }] }],
    },
    extras: {},
    targets: { byGoal: { maintain: { rest: { kcal: 900, p: 50, f: 20 }, gym: { kcal: 1100, p: 50, f: 20 } } } },
    dayPlan: {
      train: { meals: [{ name: 'Breakfast', parts: [{ ing: 'huevo', amt: 200, label: 'Eggs' }, { use: 'solo', match: 'Only one' }] }, lunch('train'), { name: 'Cooking oil', parts: [{ ing: 'aceite', amt: 10 }] }] },
      rest: { meals: [lunch('rest'), { name: 'Cooking oil', parts: [{ ing: 'aceite', amt: 10 }] }] },
    },
  };
}
const bakeOf = (p = plan()) => JSON.parse(JSON.stringify(buildDayPlans(buildNutrition(ING, p), p, { units: { g: 'g', ml: 'ml', ud: 'pc' } })));

test('roles are explicit in lib: protein lists scale to the same protein, every other list keeps its own amounts', () => {
  assert.deepEqual({ ...ROLE }, { protein: 'protein', own: 'own' });
  assert.deepEqual({ ...BLOCK_ROLES }, { proteina: ROLE.protein, anclaje: ROLE.protein, postentreno: ROLE.protein });
  assert.equal(roleOf('desayuno'), ROLE.own);
  assert.equal(roleOf('constructor'), ROLE.own, 'no prototype key is a role');
});

test('block ids are stable: <meal slot or name>/<list without tier>, #n for a repeat; only lists with a choice (no food category -> an {ing} part stays fixed)', () => {
  const meals = [
    { name: 'Comida', parts: [{ use: 'postre', match: 'A' }, { use: 'postre', match: 'B' }, { ing: 'x', amt: 1 }] },
    { name: 'Merienda', slot: 'snack', parts: [{ use: 'anclaje', tier: 'rest', match: 'C' }] },
    { name: 'Cooking oil', parts: [{ use: 'aceites', match: 'D' }] },
  ];
  assert.deepEqual(partIds(meals), [['lunch/postre', 'lunch/postre#2', 'lunch/x'], ['snack/anclaje'], ['Cooking oil/aceites']]);
  const b = bakeOf();
  assert.deepEqual(Object.keys(b.base.train.blocks).sort(), ['lunch/carbo', 'lunch/postre', 'lunch/proteina']);
  assert.deepEqual(Object.keys(b.base.rest.blocks).sort(), ['lunch/carbo', 'lunch/postre', 'lunch/proteina'], 'the same ids on both base days (tier not in the id)');
  assert.equal(b.base.train.meals[0].parts[1].id, undefined, 'a one-option list is not a block');
  assert.deepEqual(b.base.train.blocks['lunch/carbo'], { L: 'carbo.train', r: 'own', d: 'Rice', fx: true });
  assert.deepEqual(b.base.train.blocks['lunch/proteina'], { L: 'proteina', r: 'protein', d: 'Chicken', fx: false });
});

test('option keys come from the name (not the position); none rows are not options; repeats get a suffix', () => {
  assert.deepEqual(optionKeys([{ none: 1 }, { n: 'A' }, { l: 'B' }, { n: 'A' }]), [null, 'A', 'B', 'A (2)']);
  assert.deepEqual(optionKeys([{ cap: 'Oat pancake', l: '🥞 A' }, { n: 'N', cap: 'C' }]), ['Oat pancake', 'N'], 'the same name rule as the baked option (n, else cap, else l)');
  const b = bakeOf();
  assert.deepEqual(b.lists.proteina.map((o) => o.k), ['Chicken', 'Tuna', 'Eggs', 'Ham + bread', 'Bowl']);
  assert.deepEqual(b.lists.proteina.map((o) => o.gr), ['lean', 'lean', 'mod', 'mod', 'fat']);
  assert.deepEqual(b.lists['proteina'][3].c, ['Ham', 'Toast'], 'a composite option names its components');
  assert.equal(b.lists.proteina[0].pr, 34.5);
});

test('carb staples: every ingredient mostly carbs; a manual block or a mixed recipe is not', () => {
  assert.equal(isCarbStaple(ING, { recipe: [{ ing: 'arroz', amt: 100 }] }), true);
  assert.equal(isCarbStaple(ING, { recipe: [{ ing: 'platano', amt: 100 }, { ing: 'pan', amt: 10 }] }), true);
  assert.equal(isCarbStaple(ING, { recipe: [{ ing: 'yogur', amt: 100 }] }), false);
  assert.equal(isCarbStaple(ING, { recipe: [{ ing: 'arroz', amt: 100 }, { ing: 'pollo', amt: 100 }] }), false);
  assert.equal(isCarbStaple(ING, { manual: { k: 380, p: 25, c: 63, g: 4 } }), false);
  const b = bakeOf();
  assert.deepEqual(b.lists['carbo.train'].map((o) => o.fx === true), [true, true, false], 'fx is a boolean (absent = false)');
});

test('no picks (or only defaults / unknown keys): the base model untouched, the plan exactly as before', () => {
  const b = bakeOf();
  const none = planFor(b, 'maintain', 'gym', null);
  for (const picks of [undefined, {}, { 'lunch/carbo': 'Rice' }, { 'lunch/carbo': 'Quinoa' }, { 'nope/x': 'Pasta' }, { 'lunch/carbo': 7 }]) {
    const x = planFor(b, 'maintain', 'gym', null, picks);
    assert.deepEqual(x, none, JSON.stringify(picks));
    assert.deepEqual(x.picks, {});
  }
  const base = b.base.train;
  const m = applyPicks(base, b.lists, { 'lunch/carbo': 'Rice' }, b.fmt);
  assert.equal(m.fixed, base.fixed);
  assert.equal(m.flex, base.flex);
  assert.equal(m.meals, base.meals);
});

test('protein swap: the picked option gives the SAME protein as the default (rounded to 5 g), the day is re-solved', () => {
  const b = bakeOf();
  const x = planFor(b, 'maintain', 'gym', null, { 'lunch/proteina': 'Tuna' });
  assert.deepEqual(x.picks, { 'lunch/proteina': 'Tuna' });
  const part = x.view[1].parts[0];
  // chicken 150 g = 34.5 g P; tuna 25 g P / 100 g -> 138 g -> 140 g
  assert.equal(part.l, 'Tuna');
  assert.equal(part.q, '140 g');
  assert.equal(part.id, 'lunch/proteina');
  assert.ok(Math.abs(part.m[1] - 34.5) < 1, `protein ${part.m[1]}`);
  assert.ok(Math.abs(x.rem) <= REMAINDER_TOLERANCE_K, `rem ${x.rem}`);
  // a composite protein option scales every component and lists them
  const h = planFor(b, 'maintain', 'gym', null, { 'lunch/proteina': 'Ham + bread' }).view[1].parts[0];
  assert.deepEqual(h.c, ['Ham', 'Toast']);
  assert.equal(h.a.length, 2);
  assert.equal(h.q, h.a.join(' + '));
  // a manual protein block scales as a whole, with its factor
  const bowl = planFor(b, 'maintain', 'gym', null, { 'lunch/proteina': 'Bowl' }).view[1].parts[0];
  assert.equal(bowl.q, '1 bowl ×1.73');
  // whole units: eggs 18 g P / 3 -> 34.5 g P = 5.75 eggs -> clamped factor x1.92 -> 6 eggs
  const eggs = planFor(b, 'maintain', 'gym', null, { 'lunch/proteina': 'Eggs' }).view[1].parts[0];
  assert.equal(eggs.q, '6 pc');
});

test('protein swap factor is clamped (a low-protein option is not multiplied without limit)', () => {
  const block = { r: 'protein', d: 'A' };
  const list = [{ k: 'A', pr: 40 }, { k: 'B', pr: 5 }, { k: 'C', pr: 0 }];
  assert.equal(swapFactor(block, list, list[1]), SWAP_SCALE_MAX);
  assert.equal(swapFactor(block, list, list[2]), 1, 'no protein: own amounts');
  assert.equal(swapFactor({ r: 'own', d: 'A' }, list, list[1]), 1);
});

test('own-amount swaps: a staple pick in a flex part stays flex; a non-staple becomes fixed at its own amounts', () => {
  const b = bakeOf();
  const pasta = planFor(b, 'maintain', 'gym', null, { 'lunch/carbo': 'Pasta' });
  assert.equal(pasta.view[1].parts[1].x, 1, 'pasta is a carb staple: still scaled by the day factor');
  assert.equal(pasta.view[1].parts[1].l, 'Pasta');
  assert.ok(Math.abs(pasta.rem) <= REMAINDER_TOLERANCE_K, `rem ${pasta.rem}`);
  const legumes = planFor(b, 'maintain', 'gym', null, { 'lunch/carbo': 'Legumes' });
  assert.equal(legumes.view[1].parts[1].x, undefined, 'a manual block in a flex part is fixed');
  assert.equal(legumes.view[1].parts[1].q, '~300 g');
  assert.deepEqual(legumes.view[1].parts[1].m, [380, 25, 63, 4]);
  const yog = planFor(b, 'maintain', 'gym', null, { 'lunch/postre': 'Yogurt' });
  assert.equal(yog.view[1].parts[2].q, '125 g', 'its own amount');
  assert.equal(yog.view[1].parts[2].x, undefined);
  // the whole day still lands on the target (rice absorbs the difference)
  assert.ok(Math.abs(yog.rem) <= REMAINDER_TOLERANCE_K, `rem ${yog.rem}`);
  // a countable staple pick keeps its piece rounding inside the flex engine
  const ban = planFor(b, 'maintain', 'gym', null, { 'lunch/postre': 'Banana' });
  assert.equal(ban.view[1].parts[2].x, 1);
  assert.match(ban.flex[1], /banana/);
});

test('a pick follows the day across base days by key (Pasta on train and rest)', () => {
  const b = bakeOf();
  const picks = { 'lunch/carbo': 'Pasta' };
  assert.equal(planFor(b, 'maintain', 'rest', null, picks).view[0].parts[1].l, 'Pasta');
  assert.equal(planFor(b, 'maintain', 'gym', null, picks).view[1].parts[1].l, 'Pasta');
  // a key the other day's list lacks is simply ignored there
  const leg = planFor(b, 'maintain', 'rest', null, { 'lunch/carbo': 'Legumes' });
  assert.deepEqual(leg.picks, {});
});

test('applyPicks keeps untouched meals byte-identical and the flex order aligned with the display', () => {
  const b = bakeOf();
  const m = applyPicks(b.base.train, b.lists, { 'lunch/postre': 'Yogurt' }, b.fmt);
  assert.deepEqual(m.fixed[0], b.base.train.fixed[0]);
  assert.deepEqual(m.fixed[2], b.base.train.fixed[2]);
  const flexParts = m.meals.flatMap((meal) => meal.parts.filter((p) => p.x));
  assert.equal(flexParts.length, m.flex.length);
  const s = solveScale(m, 3000, b.fmt);
  assert.equal(s.q.length, flexParts.length);
});

test('an option\'s component names are localized by the build locale', () => {
  const p = plan();
  const loc = { ...ING, pavo: { ...ING.pavo, name: { es: 'Pavo', en: 'Turkey ham' } }, pan: { ...ING.pan, name: { es: 'Pan', en: 'Bread' } } };
  p.data.proteina[4].recipe = [{ ing: 'pavo', amt: 100 }, { ing: 'pan', amt: 40 }];
  const opt = (lang) => buildDayPlans(buildNutrition(loc, p), p, { lang }).lists.proteina.find((o) => o.k === 'Ham + bread');
  assert.deepEqual(opt('es').c, ['Pavo', 'Pan']);
  assert.deepEqual(opt('en').c, ['Turkey ham', 'Bread']);
});

test('swapOption is pure: the picked option as the part that replaces the default, plus its flex entry or fixed macros', () => {
  const b = bakeOf();
  const blocks = b.base.train.blocks;
  const tuna = swapOption(blocks['lunch/proteina'], b.lists.proteina, 'Tuna', b.fmt);
  assert.equal(tuna.flex, undefined);
  assert.deepEqual(tuna.part, { l: 'Tuna', q: '140 g', m: tuna.mac });
  assert.ok(Math.abs(tuna.mac[1] - 34.5) < 1);
  const pasta = swapOption(blocks['lunch/carbo'], b.lists['carbo.train'], 'Pasta', b.fmt);
  assert.equal(pasta.mac, undefined, 'a staple in a flex part stays flex');
  assert.deepEqual(pasta.part, { l: 'Pasta', x: 1 });
  assert.deepEqual(Object.keys(pasta.flex), ['ln']);
  const legumes = swapOption(blocks['lunch/carbo'], b.lists['carbo.train'], 'Legumes', b.fmt);
  assert.deepEqual(legumes.part, { l: 'Legumes', q: '~300 g', m: [380, 25, 63, 4] });
  const before = JSON.stringify(b);
  swapOption(blocks['lunch/proteina'], b.lists.proteina, 'Eggs', b.fmt);
  assert.equal(JSON.stringify(b), before, 'nothing baked is mutated');
});

/* ---------- every fixed {ing} part is choosable among the foods of its category ---------- */
const CING = {
  arroz: { per: 100, k: 360, p: 7, c: 79, g: 1, unit: 'g', cat: 'carb', name: { es: 'Arroz', en: 'Rice' } },
  pan: { per: 100, k: 260, p: 8, c: 51, g: 1, unit: 'g', cat: 'carb', name: 'Bread', piece: { name: { es: 'panecillo', en: 'roll' }, plural: { es: 'panecillos', en: 'rolls' }, amt: 40 } },
  galleta: { per: 100, k: 450, p: 6, c: 60, g: 20, unit: 'g', cat: 'carb', name: 'Biscuit' },
  pollo: { per: 100, k: 110, p: 23, c: 0, g: 2, unit: 'g', cat: 'protein', name: 'Chicken' },
  atun: { per: 100, k: 110, p: 25, c: 0, g: 1, unit: 'g', cat: 'protein', name: 'Tuna' },
  huevo: { per: 100, k: 72, p: 6, c: 0.4, g: 5, unit: 'ud', cat: 'protein', name: 'Egg', piece: { name: { es: 'huevo', en: 'egg' }, plural: { es: 'huevos', en: 'eggs' }, amt: 100, g: 50 } },
  claras: { per: 100, k: 52, p: 10.8, c: 0.7, g: 0.2, unit: 'ml', cat: 'protein', name: 'Egg whites' },
  calabacin: { per: 100, k: 17, p: 1.2, c: 3, g: 0.3, unit: 'g', cat: 'veg', name: { es: 'Calabacín', en: 'Zucchini' } },
  pimiento: { per: 100, k: 26, p: 1, c: 6, g: 0.3, unit: 'g', cat: 'veg', name: 'Pepper' },
  leche: { per: 100, k: 46, p: 3.4, c: 4.8, g: 1.7, unit: 'ml', cat: 'dairy', name: 'Milk' },
  yogur: { per: 100, k: 60, p: 6, c: 5, g: 2, unit: 'g', cat: 'dairy', name: 'Yogurt' },
  manzana: { per: 100, k: 52, p: 0.3, c: 14, g: 0.2, unit: 'g', cat: 'fruit', name: 'Apple' },
  platano: { per: 100, k: 88, p: 1, c: 22.5, g: 0.3, unit: 'g', cat: 'fruit', name: 'Banana', piece: { name: { es: 'plátano', en: 'banana' }, plural: { es: 'plátanos', en: 'bananas' }, amt: 120 } },
  aceite: { per: 100, k: 900, p: 0, c: 0, g: 100, unit: 'g', cat: 'fat', name: 'Olive oil' },
  mantequilla: { per: 100, k: 384, p: 1.8, c: 1.9, g: 41, unit: 'g', cat: 'fat', name: 'Butter' },
  levadura: { per: 100, k: 85, p: 0, c: 14, g: 0, unit: 'g', cat: 'other', name: 'Baking powder' },
  nocat: { per: 100, k: 100, p: 1, c: 20, g: 1, unit: 'g', name: 'No category' },
};
function cplan() {
  const day = (tier) => ({
    meals: [
      { name: 'Breakfast', slot: 'breakfast', parts: [{ ing: 'pan', amt: 80, flex: 'carb' }, { ing: 'huevo', amt: 200, label: 'Eggs' }, { ing: 'leche', amt: 200, label: 'Coffee with milk' }, { ing: 'levadura', amt: 5 }, { ing: 'nocat', amt: 20 }] },
      { name: 'Lunch', slot: 'lunch', parts: [{ use: 'carbo', tier, match: 'Rice', flex: 'carb' }, { ing: 'pollo', amt: 150 }, { ing: 'calabacin', amt: 150 }, { ing: 'calabacin', amt: 100 }, { ing: 'manzana', amt: 150, flex: 'carb' }] },
      { name: 'Cooking oil', parts: [{ ing: 'aceite', amt: 10 }] },
    ],
  });
  return {
    data: { carbo: { train: [{ n: 'Rice', q: '120 g', recipe: [{ ing: 'arroz', amt: 120 }] }, { n: 'Pasta', q: '120 g', recipe: [{ ing: 'galleta', amt: 120 }] }], rest: [{ n: 'Rice', q: '90 g', recipe: [{ ing: 'arroz', amt: 90 }] }, { n: 'Pasta', q: '90 g', recipe: [{ ing: 'galleta', amt: 90 }] }] } },
    extras: {},
    targets: { byGoal: { maintain: { rest: { kcal: 1500, p: 80, f: 30 }, gym: { kcal: 1800, p: 80, f: 30 } } } },
    dayPlan: { train: day('train'), rest: day('rest') },
  };
}
const cbake = (lang = 'en') => { const p = cplan(); return JSON.parse(JSON.stringify(buildDayPlans(buildNutrition(CING, p), p, { units: { g: 'g', ml: 'ml', ud: 'pc' }, lang }))); };

test('{ing} block ids: <meal key>/<default ingredient key>, #n on a repeat (the counter is shared with list ids)', () => {
  const b = cbake();
  assert.deepEqual(Object.keys(b.base.rest.blocks), ['breakfast/pan', 'breakfast/huevo', 'breakfast/leche', 'lunch/carbo', 'lunch/pollo', 'lunch/calabacin', 'lunch/calabacin#2', 'lunch/manzana', 'Cooking oil/aceite']);
  assert.deepEqual(Object.keys(b.base.train.blocks), Object.keys(b.base.rest.blocks), 'same ids on both base days');
  const parts = b.base.rest.meals[0].parts;
  assert.deepEqual(parts.map((p) => p.id), ['breakfast/pan', 'breakfast/huevo', 'breakfast/leche', undefined, undefined], 'a lone food of a non-skippable category and a food without category stay fixed');
  assert.deepEqual(partIds([{ name: 'X', parts: [{ use: 'calabacin', match: 'a' }, { ing: 'calabacin', amt: 1 }] }]), [['X/calabacin', 'X/calabacin#2']]);
});

test('{ing} blocks bake {I: category, d: default key, a: default amount, fx, n?: the part label}', () => {
  const b = cbake();
  const bl = b.base.rest.blocks;
  assert.deepEqual(bl['breakfast/pan'], { I: 'carb', d: 'pan', a: 80, fx: true });
  assert.deepEqual(bl['breakfast/huevo'], { I: 'protein', d: 'huevo', a: 200, fx: false, n: 'Eggs' });
  assert.deepEqual(bl['lunch/calabacin'], { I: 'veg', d: 'calabacin', a: 150, fx: false });
  assert.deepEqual(bl['lunch/calabacin#2'], { I: 'veg', d: 'calabacin', a: 100, fx: false });
});

test('the food catalogue is baked ONCE (keys per category + a compact table), only for categories a block uses', () => {
  const b = cbake();
  assert.deepEqual(Object.keys(b.foods.cats).sort(), ['carb', 'dairy', 'fat', 'fruit', 'protein', 'veg']);
  assert.deepEqual(b.foods.cats.protein, ['pollo', 'huevo', 'claras', 'atun'], 'sorted by display name (Chicken, Egg, Egg whites, Tuna)');
  assert.deepEqual(b.foods.cats.carb, ['galleta', 'pan', 'arroz']);
  assert.deepEqual(b.foods.rules, { carb: CAT_RULES.carb, protein: CAT_RULES.protein, dairy: CAT_RULES.dairy, veg: CAT_RULES.veg, fruit: CAT_RULES.fruit, fat: CAT_RULES.fat });
  assert.deepEqual(b.foods.ings.pollo, { n: 'Chicken', l: ['g', 100, 110, 23, 0, 2] });
  assert.deepEqual(b.foods.ings.arroz, { n: 'Rice', l: ['g', 100, 360, 7, 79, 1], fx: true });
  assert.deepEqual(b.foods.ings.huevo, { n: 'Egg', l: ['ud', 100, 72, 6, 0.4, 5, 100, 'huevo'], gf: 0.5 }, 'a unit food carries its grams per amount unit');
  assert.equal(b.foods.ings.levadura, undefined);
  assert.ok(b.fmt.pieces.pan && b.fmt.pieces.platano && b.fmt.pieces.huevo, 'every countable option can be formatted');
  assert.equal(cbake('es').foods.ings.calabacin.n, 'Calabacín', 'names in the build locale');
});

test('a log-only basic (`swap: false`) is never offered as a swap, and a part of it stays fixed', () => {
  const ING2 = { ...CING, atun: { ...CING.atun, swap: false }, calabacin: { ...CING.calabacin, swap: false } };
  const p = cplan();
  const b = JSON.parse(JSON.stringify(buildDayPlans(buildNutrition(ING2, p), p, { units: { g: 'g', ml: 'ml', ud: 'pc' }, lang: 'en' })));
  assert.deepEqual(b.foods.cats.protein, ['pollo', 'huevo', 'claras'], 'tuna is not an option');
  assert.equal(b.foods.ings.atun, undefined);
  assert.equal(b.base.rest.blocks['lunch/calabacin'], undefined, 'a part of a log-only food is not choosable');
  assert.ok(b.base.rest.blocks['lunch/pollo'], 'the other blocks are unchanged');
  assert.deepEqual(catKeys(ING2, 'veg', 'en'), ['pimiento']);
});

test('ingAmount: the swap rule of each category, clamped 0.5–2× against the default weight, rounded like every scaled amount', () => {
  const f = cbake().foods;
  const I = f.ings;
  // protein: chicken 150 g = 34.5 g P; tuna 25 g P / 100 g -> 138 g -> 140 g
  assert.equal(ingAmount(f.rules.protein, I.pollo, 150, I.atun), 140);
  // protein, unit food: 150 g of chicken = 3 eggs (50 g each) by weight; 34.5 g P / 18 g P -> x1.92 -> 5.76 -> 6 eggs
  assert.equal(ingAmount(f.rules.protein, I.pollo, 150, I.huevo), 600);
  // egg whites 10.8 g P / 100 ml vs 2 eggs (12 g P, 100 g) -> x1.11 -> 111 ml -> 110 ml
  assert.equal(ingAmount(f.rules.protein, I.huevo, 200, I.claras), 110);
  assert.equal(ingAmount(f.rules.protein, I.claras, 150, I.pollo), 75, 'x0.47 clamped to x0.5 of 150 g');
  // carbs (fruit): apple 150 g = 21 g C; banana 150 g = 33.75 g C -> x0.62 -> 93 g -> half pieces of 120 g -> 120 g
  assert.equal(ingAmount(f.rules.fruit, I.manzana, 150, I.platano), 120);
  // fat: oil 10 g = 10 g F; butter 41 g F / 100 g -> x2.44 clamped to x2 -> 20 g
  assert.equal(ingAmount(f.rules.fat, I.aceite, 10, I.mantequilla), 20);
  // kcal (dairy): milk 200 ml = 92 kcal; yogurt 200 g = 120 kcal -> x0.77 -> 154 -> 155 g
  assert.equal(ingAmount(f.rules.dairy, I.leche, 200, I.yogur), 155);
  // weight (veg): the same grams
  assert.equal(ingAmount(f.rules.veg, I.calabacin, 150, I.pimiento), 150);
  // carbs: 80 g bread = 40.8 g C; rice 80 g = 63.2 g C -> x0.65 -> 52 g -> 50 g
  assert.equal(ingAmount(f.rules.carb, I.pan, 80, I.arroz), 50);
  assert.equal(ingAmount(f.rules.carb, I.arroz, 50, I.pan), 80, 'bread rounds to half rolls (20 g)');
});

test('swapIng: the picked food as the part that replaces the default; "none" zeroes it; a staple stays flex', () => {
  const b = cbake();
  const bl = b.base.rest.blocks;
  const tuna = swapIng(bl['lunch/pollo'], b.foods, 'atun', b.fmt);
  assert.deepEqual(tuna.part, { l: 'Tuna', q: '140 g', m: tuna.mac });
  assert.ok(Math.abs(tuna.mac[1] - 35) < 0.01);
  const eggs = swapIng(bl['lunch/pollo'], b.foods, 'huevo', b.fmt);
  assert.equal(eggs.part.q, '6 eggs (~300 g)', 'countable foods show pieces with the grams reference');
  const none = swapIng(bl['lunch/calabacin'], b.foods, NONE_KEY, b.fmt);
  assert.deepEqual(none, { part: { l: '', z: 1, m: [0, 0, 0, 0] }, mac: [0, 0, 0, 0] });
  const rice = swapIng(bl['breakfast/pan'], b.foods, 'arroz', b.fmt);
  assert.deepEqual(rice.part, { l: 'Rice', x: 1 });
  assert.deepEqual(rice.flex, { ln: [['g', 50, 180, 3.5, 39.5, 0.5]] });
  const biscuit = swapIng(bl['breakfast/pan'], b.foods, 'galleta', b.fmt);
  assert.deepEqual(biscuit.part, { l: 'Biscuit', x: 1 }, 'a carb-category food stays flex even below the carb-share rule (lib/nutrition/flex.mjs)');
  assert.equal(biscuit.flex.ln[0][1], 70);
  const yogurt = swapIng({ ...bl['breakfast/leche'], fx: true }, b.foods, 'yogur', b.fmt);
  assert.equal(yogurt.flex, undefined, 'a dairy food is never flex-able: a fixed part');
  const banana = swapIng(bl['lunch/manzana'], b.foods, 'platano', b.fmt);
  assert.equal(banana.part.x, 1, 'fruit is a staple: still scaled by the day factor');
  const before = JSON.stringify(b);
  swapIng(bl['lunch/pollo'], b.foods, 'claras', b.fmt);
  assert.equal(JSON.stringify(b), before, 'nothing baked is mutated');
});

test('{ing} picks: the WHOLE day is re-solved by the carb-flex engine; untouched parts keep their numbers', () => {
  const b = cbake();
  const base = planFor(b, 'maintain', 'rest', null);
  const x = planFor(b, 'maintain', 'rest', null, { 'lunch/calabacin': 'pimiento', 'lunch/pollo': 'atun', 'Cooking oil/aceite': 'mantequilla' });
  assert.deepEqual(x.picks, { 'lunch/pollo': 'atun', 'lunch/calabacin': 'pimiento', 'Cooking oil/aceite': 'mantequilla' });
  assert.equal(x.view[1].parts[2].l, 'Pepper');
  assert.equal(x.view[1].parts[2].q, '150 g');
  assert.equal(x.view[1].parts[2].id, 'lunch/calabacin');
  assert.deepEqual(x.view[1].parts[3], b.base.rest.meals[1].parts[3], 'the repeat #2 is untouched');
  assert.equal(x.view[2].parts[0].q, '20 g');
  assert.ok(Math.abs(x.rem) <= REMAINDER_TOLERANCE_K, `rem ${x.rem}`);
  assert.notDeepEqual(x.flex, base.flex, 'the carb portions moved to absorb the swaps');
});

test('{ing} "none": only for skippable categories; a flex default\'s entry is dropped and the day re-solved', () => {
  const b = cbake();
  const veg = planFor(b, 'maintain', 'rest', null, { 'lunch/calabacin': NONE_KEY });
  assert.deepEqual(veg.picks, { 'lunch/calabacin': NONE_KEY });
  assert.deepEqual(veg.view[1].parts[2], { l: '', z: 1, m: [0, 0, 0, 0], id: 'lunch/calabacin' });
  const fruit = planFor(b, 'maintain', 'rest', null, { 'lunch/manzana': NONE_KEY });
  const flexParts = fruit.view.flatMap((m) => m.parts.filter((p) => p.x));
  assert.equal(flexParts.length, fruit.flex.length, 'flex entries stay aligned with the display');
  assert.equal(fruit.flex.length, planFor(b, 'maintain', 'rest', null).flex.length - 1);
  assert.ok(Math.abs(fruit.rem) <= REMAINDER_TOLERANCE_K, `rem ${fruit.rem}`);
  // protein, carb and fat are never skipped: "none" is ignored there
  assert.deepEqual(planFor(b, 'maintain', 'rest', null, { 'lunch/pollo': NONE_KEY, 'Cooking oil/aceite': NONE_KEY, 'breakfast/pan': NONE_KEY }).picks, {});
});

test('{ing} picks that are not an option are ignored: another category, the default, an unknown or prototype key', () => {
  const b = cbake();
  const none = planFor(b, 'maintain', 'gym', null);
  for (const picks of [{ 'lunch/pollo': 'arroz' }, { 'lunch/pollo': 'pollo' }, { 'lunch/calabacin': 'levadura' }, { 'lunch/calabacin': 'nocat' }, { 'lunch/calabacin': 'constructor' }, { 'lunch/calabacin': 7 }]) {
    assert.deepEqual(planFor(b, 'maintain', 'gym', null, picks), none, JSON.stringify(picks));
  }
  const m = applyPicks(b.base.train, b.lists, { 'lunch/pollo': 'pollo' }, b.fmt, b.foods);
  assert.equal(m.meals, b.base.train.meals, 'the base model itself');
});

/* ---------- portion caps on every swap (the tracked example plan + the public food DB) ---------- */
const EX_ING = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/ingredients.json'), 'utf8')).ingredients;
const EX_PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/plan-data.example.json'), 'utf8'));
const exBake = () => JSON.parse(JSON.stringify(buildNutriToday(buildNutrition(EX_ING, EX_PLAN), EX_PLAN, {})));
const exOptKeys = (b, blk) => (blk.I ? b.foods.cats[blk.I].concat(b.foods.rules[blk.I].skip ? [NONE_KEY] : []) : b.lists[blk.L].map((o) => o.k));
const overCap = (l) => lineCap(l) != null && lineAmt(l) > lineCap(l) + 1e-9;
// the lines a swap shows: its flex lines, or its fixed lines (`ln`); a manual block / "none" has none
const shownLines = (sw) => (sw.flex ? sw.flex.ln || [] : sw.ln || []);

test('no swap shows an amount past its portion cap: every block x option (list and category swaps) of the example plan', () => {
  const b = exBake();
  let n = 0;
  let capped = 0;
  const bad = [];
  for (const day of ['train', 'rest']) for (const [id, blk] of Object.entries(b.base[day].blocks)) {
    for (const key of exOptKeys(b, blk)) {
      const sw = blk.I ? swapIng(blk, b.foods, key, b.fmt) : swapOption(blk, b.lists[blk.L], key, b.fmt);
      const opt = blk.I ? b.foods.ings[key] : b.lists[blk.L].find((o) => o.k === key);
      if (key !== NONE_KEY && !(opt && opt.mb)) assert.ok(shownLines(sw).length > 0, `${day} ${id} -> ${key}: the shown lines`);
      for (const l of shownLines(sw)) {
        if (overCap(l)) bad.push(`${day} ${id} -> ${key}: ${lineAmt(l)} > cap ${lineCap(l)}`);
        if (lineCap(l) != null && lineAmt(l) === lineCap(l)) capped++;
      }
      n++;
    }
  }
  assert.ok(n > 100, `${n} swaps`);
  assert.ok(capped > 0, 'some swaps land on their cap');
  assert.deepEqual(bad, []);
});

test('no single pick ends past a cap once the day is re-solved (every goal x day type)', () => {
  const b = exBake();
  const bad = [];
  for (const day of ['train', 'rest']) for (const [id, blk] of Object.entries(b.base[day].blocks)) {
    for (const key of exOptKeys(b, blk)) {
      const picks = { [id]: key };
      const mdl = applyPicks(b.base[day], b.lists, picks, b.fmt, b.foods);
      for (const g of b.goals) for (const d of b.dayTypes) {
        const x = planFor(b, g, d, null, picks);
        if (x.base !== day) continue;
        mdl.flex.forEach((fx, i) => (fx.ln || []).forEach((l, j) => {
          if (lineCap(l) != null && x.flexN[i][j] > lineCap(l) + 1e-9) bad.push(`${g}/${d} ${id} -> ${key}: ${x.flexN[i][j]} > cap ${lineCap(l)}`);
        }));
      }
    }
  }
  assert.deepEqual(bad, []);
});
