/* Unit tests for lib/nutrition/calc.mjs's calcDay() — the pure extraction of
 * the legacy Registro day-builder's recalc()/verdict logic (see design's
 * Testing Strategy "... or the calcDay fallback"). Ported from the real
 * `data/nutrition/plan-web.html` recalc(), generalized to be data-driven
 * (indulgeKeys/alcoholKeys/mealReplaceKeys instead of hardcoded
 * cerveza/pintxo/chocolate literals) — see lib/nutrition/macros.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcDay } from './calc.mjs';

function dict() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); return `${name}(${args.join(',')})`; };
  return {
    calls,
    proteinOk: rec('proteinOk'),
    proteinShort: rec('proteinShort'),
    proteinVeryShort: rec('proteinVeryShort'),
    overBudget: (diff, cuts) => { calls.push(['overBudget', diff, cuts]); return `overBudget(${diff},${cuts.join('|')})`; },
    underBudget: rec('underBudget'),
    onTarget: rec('onTarget'),
    fatHigh: rec('fatHigh'),
    cutExtras: rec('cutExtras'),
    cutDessert: rec('cutDessert'),
    cutDinnerCarb: rec('cutDinnerCarb'),
    alcohol: rec('alcohol'),
    sweetTreats: rec('sweetTreats'),
    mealReplace: rec('mealReplace'),
  };
}

const target = { k: 2000, p: 170, fatMax: 75 };
const extraMacros = {
  cafe: { k: 67, p: 4.9, c: 7, g: 2.5 },
  cerveza: { k: 118, p: 0, c: 9, g: 0 },
  pintxo: { k: 200, p: 8, c: 14, g: 12 },
  chocolate: { k: 48, p: 1, c: 1.6, g: 3.9 },
  palomitas: { k: 410, p: 8.8, c: 49.5, g: 18 },
};

test('calcDay sums meal totals + extras and rounds to the legacy shape', () => {
  const d = dict();
  const res = calcDay({
    mealTotals: { k: 1500, p: 160, c: 150, g: 40 },
    postreK: 0,
    extraCounts: { cafe: 2 },
    extraMacros,
    target,
    dict: d,
  });
  assert.equal(res.totals.k, Math.round(1500 + 2 * 67));
  assert.equal(res.totals.p, Math.round(160 + 2 * 4.9));
});

test('protein verdict: ok when within 10g of target, warn within 40g, bad below', () => {
  const d = dict();
  calcDay({ mealTotals: { k: 1000, p: 165, c: 0, g: 0 }, postreK: 0, extraCounts: {}, extraMacros, target, dict: d });
  assert.equal(d.calls[0][0], 'proteinOk');

  const d2 = dict();
  calcDay({ mealTotals: { k: 1000, p: 140, c: 0, g: 0 }, postreK: 0, extraCounts: {}, extraMacros, target, dict: d2 });
  assert.equal(d2.calls[0][0], 'proteinShort');

  const d3 = dict();
  calcDay({ mealTotals: { k: 1000, p: 100, c: 0, g: 0 }, postreK: 0, extraCounts: {}, extraMacros, target, dict: d3 });
  assert.equal(d3.calls[0][0], 'proteinVeryShort');
});

test('calorie verdict: over-budget (+200) lists cuts in order — extras, dessert (if >120 kcal), dinner carb always last', () => {
  const d = dict();
  calcDay({
    mealTotals: { k: 2300, p: 170, c: 0, g: 0 },
    postreK: 150,
    extraCounts: { cafe: 1 },
    extraMacros,
    target,
    dict: d,
  });
  const over = d.calls.find((c) => c[0] === 'overBudget');
  assert.ok(over, 'overBudget triggered');
  assert.deepEqual(over[2].length, 2, 'no indulge extras in this fixture -> only dessert + dinner-carb cuts');
});

test('calorie verdict: under-budget (< -300) and on-target (within [-300,200])', () => {
  const dUnder = dict();
  calcDay({ mealTotals: { k: 1600, p: 170, c: 0, g: 0 }, postreK: 0, extraCounts: {}, extraMacros, target, dict: dUnder });
  assert.ok(dUnder.calls.some((c) => c[0] === 'underBudget'));

  const dOn = dict();
  calcDay({ mealTotals: { k: 1950, p: 170, c: 0, g: 0 }, postreK: 0, extraCounts: {}, extraMacros, target, dict: dOn });
  assert.ok(dOn.calls.some((c) => c[0] === 'onTarget'));
});

test('fat verdict fires only when rg exceeds target.fatMax', () => {
  const d = dict();
  calcDay({ mealTotals: { k: 1900, p: 170, c: 0, g: 90 }, postreK: 0, extraCounts: {}, extraMacros, target, dict: d });
  assert.ok(d.calls.some((c) => c[0] === 'fatHigh' && c[1] === 90));
});

test('alcoholKeys: fires the alcohol warning only for keys in alcoholKeys with count>0, using extraNames for display', () => {
  const d = dict();
  calcDay({
    mealTotals: { k: 1900, p: 170, c: 0, g: 0 },
    postreK: 0,
    extraCounts: { cerveza: 2 },
    extraMacros,
    target,
    indulgeKeys: ['cerveza', 'pintxo', 'chocolate', 'palomitas'],
    alcoholKeys: ['cerveza'],
    extraNames: { cerveza: 'cerveza' },
    dict: d,
  });
  const alcohol = d.calls.find((c) => c[0] === 'alcohol');
  assert.deepEqual(alcohol, ['alcohol', 'cerveza', 2, 236]);
});

test('sweetTreats fires for ANY indulge key outside alcohol+mealReplace with count>0 — including keys the legacy hardcoded list omitted (e.g. palomitas)', () => {
  const d = dict();
  calcDay({
    mealTotals: { k: 1900, p: 170, c: 0, g: 0 },
    postreK: 0,
    extraCounts: { palomitas: 1 },
    extraMacros,
    target,
    indulgeKeys: ['cerveza', 'pintxo', 'chocolate', 'palomitas'],
    alcoholKeys: ['cerveza'],
    mealReplaceKeys: ['pintxo'],
    dict: d,
  });
  assert.ok(d.calls.some((c) => c[0] === 'sweetTreats'), 'palomitas is neither alcohol nor meal-replace -> generic treats warning');
});

test('mealReplaceKeys fires its own warning, distinct from sweetTreats, for keys with count>0', () => {
  const d = dict();
  calcDay({
    mealTotals: { k: 1900, p: 170, c: 0, g: 0 },
    postreK: 0,
    extraCounts: { pintxo: 1 },
    extraMacros,
    target,
    indulgeKeys: ['cerveza', 'pintxo', 'chocolate'],
    alcoholKeys: ['cerveza'],
    mealReplaceKeys: ['pintxo'],
    extraNames: { pintxo: 'pintxo' },
    dict: d,
  });
  assert.ok(d.calls.some((c) => c[0] === 'mealReplace' && c[1] === 'pintxo'));
  assert.ok(!d.calls.some((c) => c[0] === 'sweetTreats'), 'pintxo is meal-replace, not a generic treat');
});

test('no indulgeKeys configured (e.g. a plan with no treats section) never throws and never fires indulge warnings', () => {
  const d = dict();
  assert.doesNotThrow(() => calcDay({ mealTotals: { k: 1900, p: 170, c: 0, g: 0 }, postreK: 0, extraCounts: {}, extraMacros, target, dict: d }));
  assert.ok(!d.calls.some((c) => ['alcohol', 'sweetTreats', 'mealReplace'].includes(c[0])));
});
