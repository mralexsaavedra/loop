/* web/src/client/food-core.js on its own (the food log's behaviour is tested through all four food
 * scripts in food.test.mjs): what it reuses from the libs instead of copying. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadUtil, FOOD_SOURCES, FOOD_SCRIPTS } from '../../test/client-util.mjs';
import { StubDocument } from '../../test/dom-stub.mjs';
import { es as I18N_FOOD } from '../i18n/food-templates.mjs';
import { foldName } from '../../../lib/nutrition/names.mjs';

function loadCore() {
  // the least food-core needs to get past its "no food log on this page" early return; nothing is fetched at load
  const ctx = {
    window: {}, document: new StubDocument(), fetch: async () => { throw new TypeError('offline'); }, I18N_FOOD, FOOD_CONST: { limits: {} },
    FOOD_BASICS: [], LOCALE: 'es', Math, JSON, Number, String, Object, Array, Promise, isFinite,
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(FOOD_SOURCES[FOOD_SCRIPTS.indexOf('food-core.js')], ctx);
  return ctx;
}

test('norm is lib/nutrition/names.mjs foldName, shipped in HC_GUIDE (no copy)', () => {
  const ctx = loadCore();
  const { norm } = ctx.window.HCFoodInternal;
  assert.equal(norm, vm.runInContext('HC_GUIDE.foldName', ctx));
  for (const s of ['Plátano', 'YOGUR Griego Ñandú', 'Café con leche', '', null, undefined]) assert.equal(norm(s), foldName(s), String(s));
  assert.equal(norm('Plátano MADURO'), 'platano maduro');
});

test('norm pins the search normalisation as literals (a foldName change that alters food search fails here)', () => {
  const { norm } = loadCore().window.HCFoodInternal;
  const cases = [
    ['Plátano', 'platano'], // accents are folded
    ['YOGUR Griego Ñandú', 'yogur griego nandu'], // upper case and ñ
    ['ÀÉÎÕÜ ç', 'aeiou c'],
    ['Crème brûlée', 'creme brulee'],
    // whitespace is kept as typed (no trim, no collapse): the search matches substrings of the folded name
    ['  Café   con\tleche  ', '  cafe   con\tleche  '],
    [' Açaí ', ' acai '],
    ['', ''], [null, ''], [undefined, ''],
  ];
  for (const [input, expected] of cases) assert.equal(norm(input), expected, JSON.stringify(input));
});
