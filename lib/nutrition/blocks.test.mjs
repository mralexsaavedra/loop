/* lib/nutrition/blocks.mjs — choosable blocks of Plan de hoy (picks, swap rules, re-solve). Synthetic
 * fixtures only (never the owner's plan). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNutrition } from './macros.mjs';
import { buildDayPlans, planFor, solveScale, REMAINDER_TOLERANCE_K } from './scale.mjs';
import { applyPicks, partIds, optionKeys, isCarbStaple, swapFactor, BLOCK_ROLES, PROTEIN_SCALE_MAX, roleOf } from './blocks.mjs';

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
  assert.deepEqual({ ...BLOCK_ROLES }, { proteina: 'protein', anclaje: 'protein', postentreno: 'protein' });
  assert.equal(roleOf('desayuno'), 'own');
  assert.equal(roleOf('constructor'), 'own', 'no prototype key is a role');
});

test('block ids are stable: <meal slot or name>/<list without tier>, #n for a repeat; only lists with a choice', () => {
  const meals = [
    { name: 'Comida', parts: [{ use: 'postre', match: 'A' }, { use: 'postre', match: 'B' }, { ing: 'x', amt: 1 }] },
    { name: 'Merienda', slot: 'snack', parts: [{ use: 'anclaje', tier: 'rest', match: 'C' }] },
    { name: 'Cooking oil', parts: [{ use: 'aceites', match: 'D' }] },
  ];
  assert.deepEqual(partIds(meals), [['lunch/postre', 'lunch/postre#2', null], ['snack/anclaje'], ['Cooking oil/aceites']]);
  const b = bakeOf();
  assert.deepEqual(Object.keys(b.base.train.blocks).sort(), ['lunch/carbo', 'lunch/postre', 'lunch/proteina']);
  assert.deepEqual(Object.keys(b.base.rest.blocks).sort(), ['lunch/carbo', 'lunch/postre', 'lunch/proteina'], 'the same ids on both base days (tier not in the id)');
  assert.equal(b.base.train.meals[0].parts[1].id, undefined, 'a one-option list is not a block');
  assert.deepEqual(b.base.train.blocks['lunch/carbo'], { L: 'carbo.train', r: 'own', d: 'Rice', fx: 1 });
  assert.deepEqual(b.base.train.blocks['lunch/proteina'], { L: 'proteina', r: 'protein', d: 'Chicken', fx: 0 });
});

test('option keys come from the name (not the position); none rows are not options; repeats get a suffix', () => {
  assert.deepEqual(optionKeys([{ none: 1 }, { n: 'A' }, { l: 'B' }, { n: 'A' }]), [null, 'A', 'B', 'A (2)']);
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
  assert.deepEqual(b.lists['carbo.train'].map((o) => o.fx || 0), [1, 1, 0]);
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
  assert.equal(swapFactor(block, list, list[1]), PROTEIN_SCALE_MAX);
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
