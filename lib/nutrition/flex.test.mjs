/* lib/nutrition/flex.mjs — which dayPlan parts the portion scaling may grow or shrink: explicit
 * `flex: "carb"` marks plus every carb / fruit food (and sweet carb staples) by its category;
 * `flex: null` opts a part out. Synthetic fixtures only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNutrition } from './macros.mjs';
import { autoFlexIng, isFlexPart, isCarbStaple, AUTO_FLEX_CATS, CARB_STAPLE_SHARE } from './flex.mjs';

const ING = {
  arroz: { per: 100, k: 360, p: 7, c: 79, g: 1, unit: 'g', cat: 'carb' },
  pansemillas: { per: 100, k: 291, p: 11, c: 38, g: 9, unit: 'g', cat: 'carb' },
  platano: { per: 100, k: 88, p: 1, c: 22.5, g: 0.3, unit: 'g', cat: 'fruit' },
  miel: { per: 100, k: 304, p: 0.3, c: 82, g: 0, unit: 'g', cat: 'sweet' },
  chocolate: { per: 100, k: 597, p: 10, c: 20, g: 50, unit: 'g', cat: 'sweet' },
  pollo: { per: 100, k: 109, p: 23, c: 0, g: 2, unit: 'g', cat: 'protein' },
  zumo: { per: 100, k: 37, p: 0.5, c: 8.6, g: 0, unit: 'ml', cat: 'drink' },
  nocat: { per: 100, k: 360, p: 7, c: 79, g: 1, unit: 'g' },
};
const plan = (parts) => ({
  data: {
    carbo: [{ n: 'Rice', q: '100 g', recipe: [{ ing: 'arroz', amt: 100 }] }],
    toast: [{ n: 'Toast + honey', recipe: [{ ing: 'arroz', amt: 50 }, { ing: 'miel', amt: 10 }] }],
    mixed: [{ n: 'Rice + chicken', recipe: [{ ing: 'arroz', amt: 80 }, { ing: 'pollo', amt: 100 }] }],
    legume: [{ n: 'Lentils', q: '1 bowl', manual: { k: 300, p: 20, c: 50, g: 2 } }],
  },
  extras: {},
  dayPlan: { train: { meals: [{ name: 'Lunch', parts }] }, rest: { meals: [{ name: 'Lunch', parts }] } },
});
const nutOf = (parts) => buildNutrition(ING, plan(parts));

test('auto-flex categories: carb and fruit always; a sweet only when it is a carb staple', () => {
  assert.deepEqual([...AUTO_FLEX_CATS], ['carb', 'fruit']);
  assert.equal(CARB_STAPLE_SHARE, 0.6);
  assert.equal(autoFlexIng(ING, 'arroz'), true);
  assert.equal(autoFlexIng(ING, 'pansemillas'), true, 'a seeded bread is still a carb food');
  assert.equal(autoFlexIng(ING, 'platano'), true);
  assert.equal(autoFlexIng(ING, 'miel'), true, 'honey: a carb staple');
  assert.equal(autoFlexIng(ING, 'chocolate'), false, 'chocolate never grows to fill carbs');
  assert.equal(autoFlexIng(ING, 'pollo'), false);
  assert.equal(autoFlexIng(ING, 'zumo'), false, 'a drink is not a portion to grow');
  assert.equal(autoFlexIng(ING, 'nocat'), false, 'no category, no automatic flex (explicit marks still work)');
  assert.equal(autoFlexIng(ING, 'missing'), false);
});

test('isFlexPart: explicit marks, then the category of an {ing} part; flex: null opts out', () => {
  const nut = nutOf([]);
  assert.equal(isFlexPart(nut, { ing: 'arroz', amt: 100 }), true, 'a carb food scales without a mark');
  assert.equal(isFlexPart(nut, { ing: 'platano', amt: 120 }), true);
  assert.equal(isFlexPart(nut, { ing: 'arroz', amt: 100, flex: null }), false, 'flex: null opts out');
  assert.equal(isFlexPart(nut, { ing: 'pollo', amt: 100 }), false);
  assert.equal(isFlexPart(nut, { ing: 'pollo', amt: 100, flex: 'carb' }), true, 'an explicit mark wins');
  assert.equal(isFlexPart(nut, { ing: 'nocat', amt: 100 }), false);
});

test('isFlexPart: a {use} item scales automatically only when EVERY recipe line is an auto-flex food; manual only when marked', () => {
  const nut = nutOf([]);
  assert.equal(isFlexPart(nut, { use: 'carbo', match: 'Rice' }), true);
  assert.equal(isFlexPart(nut, { use: 'toast', match: 'Toast' }), true, 'rice + honey: all carb staples');
  assert.equal(isFlexPart(nut, { use: 'mixed', match: 'Rice + chicken' }), false, 'a mixed composite stays fixed');
  assert.equal(isFlexPart(nut, { use: 'legume', match: 'Lentils' }), false, 'a manual block is never automatic');
  assert.equal(isFlexPart(nut, { use: 'legume', match: 'Lentils', flex: 'carb' }), true);
  assert.equal(isFlexPart(nut, { use: 'carbo', match: 'Rice', flex: null }), false);
});

test('isCarbStaple: the share rule alone (a seeded bread is carb by category, not by share)', () => {
  assert.equal(isCarbStaple(ING, { recipe: [{ ing: 'arroz', amt: 100 }] }), true);
  assert.equal(isCarbStaple(ING, { recipe: [{ ing: 'pansemillas', amt: 100 }] }), false, 'the share rule alone excludes it');
});
