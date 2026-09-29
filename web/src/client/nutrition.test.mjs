/* Drift guard for web/src/client/nutrition.js's inline `calcDay()` — a
 * DELIBERATE, DOCUMENTED DUPLICATE of lib/nutrition/calc.mjs's calcDay()
 * (see this file's own header comment: "kept in sync by hand"). Nothing
 * before this test ever proved the two algorithms actually agree — this
 * runs the REAL client script through node:vm against the dom-stub harness
 * (same pattern as web/src/client/core.test.mjs), drives it through several
 * scenarios exercising every verdict branch, and cross-checks its rendered
 * totals + verdict-type sequence against lib/nutrition/calc.mjs's calcDay()
 * fed the equivalent structured input. A hand-sync mistake in either copy
 * that changes behavior (not just text) fails this test.
 *
 * Synthetic dataset (not the real plan) — kept intentionally small: exactly
 * one option per meal category (so selectedIndex 0 is unambiguous), plus a
 * "none" protein option for scenario C's protein-very-short case.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { calcDay as libCalcDay } from '../../../lib/nutrition/calc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'nutrition.js'), 'utf8');

/* ---------- select stub: the one bit of DOM StubElement doesn't model ---------- */
function makeSelect(doc, id) {
  const options = [];
  let selectedIndex = 0;
  const node = {
    tag: 'select',
    classes: new Set(),
    attrs: { id },
    get options() { return options; },
    get selectedIndex() { return selectedIndex; },
    set selectedIndex(v) { selectedIndex = v; },
    set innerHTML(_v) { options.length = 0; },
    get innerHTML() { return ''; },
    appendChild(opt) { options.push(opt); },
    addEventListener() {},
  };
  return doc.registerCustom(id, node);
}

/* ---------- verdict-recording dict for lib calcDay — types/args only, no i18n text needed ---------- */
function recordingDict() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); return name; };
  return {
    calls,
    proteinOk: rec('proteinOk'), proteinShort: rec('proteinShort'), proteinVeryShort: rec('proteinVeryShort'),
    overBudget: (diff, cuts) => { calls.push(['overBudget', diff, cuts]); return 'overBudget'; },
    underBudget: rec('underBudget'), onTarget: rec('onTarget'), fatHigh: rec('fatHigh'),
    cutExtras: rec('cutExtras'), cutDessert: rec('cutDessert'), cutDinnerCarb: rec('cutDinnerCarb'),
    alcohol: rec('alcohol'), sweetTreats: rec('sweetTreats'), mealReplace: rec('mealReplace'),
  };
}

const MEAL_IDS = ['bld-desayuno', 'bld-prot-comida', 'bld-carbo-comida', 'bld-postre-comida', 'bld-postentreno', 'bld-prot-cena', 'bld-carbo-cena', 'bld-postre-cena'];

/** Builds a fresh vm context, DOM and globals for one scenario, runs the
 * REAL nutrition.js source in it, and returns { doc, window } for the test
 * to drive further (change selects / bump extras) before reading output. */
function run({ globals, restDay }) {
  const doc = new StubDocument();
  doc.el('b-rest', { attrs: { 'aria-pressed': restDay ? 'true' : 'false' } });
  MEAL_IDS.forEach((id) => makeSelect(doc, id));
  doc.el('r-kcal');
  doc.el('r-macros');
  doc.el('r-verdict');
  globals.EXTRA_KEYS.forEach((k) => doc.el('x-' + k, { textContent: '0' }));

  const window = {};
  const ctx = { document: doc, window, setTimeout, console, Math, Number, String, navigator: {} };
  Object.assign(ctx, globals);
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { doc, window };
}

function readTotals(doc) {
  const kcalHtml = doc.getElementById('r-kcal').innerHTML;
  const k = Number(kcalHtml.match(/^(\d+)/)[1]);
  const macrosHtml = doc.getElementById('r-macros').innerHTML;
  const [p, c, g] = [...macrosHtml.matchAll(/<b>(\d+) g<\/b>/g)].map((m) => Number(m[1]));
  return { k, p, c, g };
}

function readVerdictTypes(doc) {
  const html = doc.getElementById('r-verdict').innerHTML;
  return [...html.matchAll(/class="v-(\w+)"/g)].map((m) => m[1]);
}

/* ---------- shared synthetic dataset ---------- */
const desayuno = [{ l: 'Breakfast', k: 400, p: 20, c: 50, g: 10 }];
const postre = [{ l: 'Yogurt', k: 120, p: 8, c: 15, g: 3, cat: 'yogurt' }];
const carboComida = { train: [{ l: 'Rice', k: 350, p: 7, c: 70, g: 2 }], rest: [{ l: 'Rice small', k: 220, p: 4, c: 45, g: 1 }] };
const carboCena = { train: [{ l: 'Potato', k: 300, p: 6, c: 60, g: 1 }], rest: [{ l: 'Potato small', k: 180, p: 3, c: 35, g: 0 }] };
const postentreno = [{ l: 'Shake', k: 200, p: 35, c: 12, g: 3 }];
const anclaje = [{ l: 'Cottage cheese', k: 160, p: 28, c: 5, g: 4 }];
const EXTRAS = { cafe: { k: 67, p: 5, c: 7, g: 3 }, cerveza: { k: 118, p: 0, c: 9, g: 0 }, chocolate: { k: 48, p: 1, c: 2, g: 4 } };
const EXTRA_NAMES = { cafe: 'Coffee', cerveza: 'Beer', chocolate: 'Chocolate' };
const commonGlobals = {
  EXTRA_KEYS: ['cafe', 'cerveza', 'chocolate'],
  EXTRAS,
  EXTRA_NAMES,
  INDULGE: ['cerveza', 'chocolate'],
  ALCOHOL_KEYS: ['cerveza'],
  MEAL_REPLACE_KEYS: [],
  VEG_KEYS: [],
  QUESO_KEYS: [],
  FRUIT_SUMMARY: null,
  PE_LABEL: { train: 'Post-entreno', rest: 'Ancla' },
  I18N_VERDICT: {
    proteinOk: 'proteinOk {p}', proteinShort: 'proteinShort {p}/{t}', proteinVeryShort: 'proteinVeryShort {p}/{t}',
    cutExtras: 'cutExtras {kcal}', cutDessert: 'cutDessert', cutDinnerCarb: 'cutDinnerCarb',
    overBudget: 'overBudget {diff} {cuts}', underBudget: 'underBudget {under}', onTarget: 'onTarget {signedDiff}',
    fatHigh: 'fatHigh {g}', alcohol: 'alcohol {name} x{n} = {kcal}', sweetTreats: 'sweetTreats', mealReplace: 'mealReplace {name}',
  },
  I18N_LOG: { kcalSuffix: '/ {t}', dayLabelTrain: 'train', dayLabelRest: 'rest', header: '{date} {dayLabel}', breakfast: 'B:{v}', lunch: 'L:{v}', dinner: 'D:{v}', extras: 'X:{v}', offPlan: 'N:{v}', total: 'T' },
  I18N_TABLAS: { fruitPortionLabel: 'fruit', fruitPortionQty: 'qty' },
};

function nutData({ proteina, day }) {
  return {
    ...commonGlobals,
    DATA: { desayuno, proteina, postre, carboComida, carboCena, postentreno, anclaje },
    TARGET: { train: { k: 2000, p: 170, fatMax: 75 }, rest: { k: 1800, p: 170, fatMax: 75 } },
    ...day,
  };
}

test('nutrition.js calcDay matches lib/nutrition/calc.mjs calcDay — scenario A: on target, protein ok, no extras (train day)', () => {
  const globals = nutData({ proteina: [{ l: 'Chicken', k: 250, p: 45, c: 0, g: 8 }] });
  const { doc } = run({ globals, restDay: false });

  const actualTotals = readTotals(doc);
  const actualVerdict = readVerdictTypes(doc);

  const mealTotals = { k: 1990, p: 174, c: 222, g: 38 }; // hand-summed from the fixture above, see file header
  const expected = libCalcDay({
    mealTotals, postreK: 240, extraCounts: {}, extraMacros: EXTRAS, target: globals.TARGET.train,
    indulgeKeys: globals.INDULGE, alcoholKeys: globals.ALCOHOL_KEYS, mealReplaceKeys: globals.MEAL_REPLACE_KEYS,
    extraNames: EXTRA_NAMES, dict: recordingDict(),
  });

  assert.deepEqual(actualTotals, expected.totals, 'inline calcDay totals must match lib calcDay totals');
  assert.deepEqual(actualVerdict, expected.verdict.map((v) => v[0]), 'inline calcDay verdict-type sequence must match lib calcDay');
  assert.deepEqual(actualVerdict, ['ok', 'ok'], 'sanity: expected proteinOk + onTarget, nothing else');
});

test('nutrition.js calcDay matches lib/nutrition/calc.mjs calcDay — scenario B: over budget (cuts: extras+dessert+dinner-carb), alcohol warning (train day)', () => {
  const globals = nutData({ proteina: [{ l: 'Chicken', k: 250, p: 45, c: 0, g: 8 }] });
  const { doc, window } = run({ globals, restDay: false });

  window.bump('cerveza', 1);
  window.bump('cerveza', 1);
  window.bump('cafe', 1);

  const actualTotals = readTotals(doc);
  const actualVerdict = readVerdictTypes(doc);

  const mealTotals = { k: 1990, p: 174, c: 222, g: 38 };
  const extraCounts = { cerveza: 2, cafe: 1 };
  const expected = libCalcDay({
    mealTotals, postreK: 240, extraCounts, extraMacros: EXTRAS, target: globals.TARGET.train,
    indulgeKeys: globals.INDULGE, alcoholKeys: globals.ALCOHOL_KEYS, mealReplaceKeys: globals.MEAL_REPLACE_KEYS,
    extraNames: EXTRA_NAMES, dict: recordingDict(),
  });

  assert.deepEqual(actualTotals, expected.totals);
  assert.deepEqual(actualVerdict, expected.verdict.map((v) => v[0]));
  assert.deepEqual(actualVerdict, ['ok', 'bad', 'warn'], 'sanity: proteinOk + overBudget + alcohol');
});

test('nutrition.js calcDay matches lib/nutrition/calc.mjs calcDay — scenario C: protein very short, under budget, fat high, sweet treats, "none" protein slot (rest day)', () => {
  const globals = nutData({
    proteina: [{ l: 'Turkey', k: 150, p: 20, c: 0, g: 25 }, { l: '— none —', none: true, k: 0, p: 0, c: 0, g: 0 }],
  });
  // Override with rest-day-flavored postre/target to reach the intended verdict mix
  // (target.k raised well above the day's total so diff < -300 -> underBudget).
  globals.DATA.postre = [{ l: 'Ice cream', k: 250, p: 2, c: 20, g: 15, cat: 'yogurt' }];
  globals.TARGET.rest = { k: 2200, p: 170, fatMax: 75 };

  const { doc, window } = run({ globals, restDay: true });
  // bld-prot-cena -> the "none" option (index 1); repopDay() (re-triggered by
  // bump below) never touches this select, so the override survives.
  doc.getElementById('bld-prot-cena').selectedIndex = 1;
  window.bump('chocolate', 1);
  window.bump('chocolate', 1);
  window.bump('chocolate', 1);

  const actualTotals = readTotals(doc);
  const actualVerdict = readVerdictTypes(doc);

  const mealTotals = { k: 1610, p: 79, c: 175, g: 70 }; // hand-summed, prot-cena = none (0/0/0/0)
  const extraCounts = { chocolate: 3 };
  const expected = libCalcDay({
    mealTotals, postreK: 500, extraCounts, extraMacros: EXTRAS, target: globals.TARGET.rest,
    indulgeKeys: globals.INDULGE, alcoholKeys: globals.ALCOHOL_KEYS, mealReplaceKeys: globals.MEAL_REPLACE_KEYS,
    extraNames: EXTRA_NAMES, dict: recordingDict(),
  });

  assert.deepEqual(actualTotals, expected.totals);
  assert.deepEqual(actualVerdict, expected.verdict.map((v) => v[0]));
  assert.deepEqual(actualVerdict, ['bad', 'warn', 'warn', 'warn'], 'sanity: proteinVeryShort + underBudget + fatHigh + sweetTreats');
});
