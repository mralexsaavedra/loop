/* web/src/client/lib-globals.ts: the page's HC_* lib globals, run as the page runs them (its esbuild bundle in an
 * empty vm), checked against the lib modules: each global exposes its CLIENT descriptor's consts then fns, and
 * computes what the module computes. web/test/client-globals-build.test.mjs repeats the parity checks on the
 * built page. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { clientScriptSource } from '../client-bundle.mjs';
import * as F from '../../../lib/format/numbers.mjs';
import * as R from '../../../lib/score/recovery.mjs';
import * as ADH from '../../../lib/nutrition/adherence.mjs';
import { ADHERENCE_CASES } from '../../../lib/nutrition/adherence.cases.mjs';
import * as PROG from '../../../lib/nutrition/progress.mjs';
import { PROGRESS_CASES } from '../../../lib/nutrition/progress.cases.mjs';
import * as NS from '../../../lib/nutrition/nutri-score.mjs';
import * as FL from '../../../lib/nutrition/foodlog.mjs';
import * as DT from '../../../lib/nutrition/daytype.mjs';
import * as FU from '../../../lib/nutrition/fuel.mjs';
import * as EN from '../../../lib/nutrition/energy.mjs';

/** @param {unknown} v @returns {any} JSON round-trip of a value the vm script built */
const js = (v) => JSON.parse(JSON.stringify(v));
const SOURCE = clientScriptSource('lib-globals.ts');
function globals() {
  const ctx = vm.createContext({});
  vm.runInContext(SOURCE, ctx);
  return ctx;
}
/** @param {...{consts?: object, fns?: object}} parts */
const keysOf = (...parts) => [...new Set([...parts.flatMap((p) => Object.keys(p.consts || {})), ...parts.flatMap((p) => Object.keys(p.fns || {}))])];

test('a classic IIFE: no import / export left, every global published on globalThis', () => {
  assert.doesNotMatch(SOURCE, /^\s*(import|export)\b/m);
  const g = globals();
  for (const name of ['HC_FMT', 'HC_BAND', 'HC_ADH', 'HC_PROG', 'HC_NSCORE', 'HC_FOODLOG', 'HC_DAYTYPE', 'HC_FUEL', 'HC_SCALE', 'HC_GUIDE', 'HC_ENERGY']) {
    assert.equal(typeof g[name], 'object', name);
  }
});

test('each single-module global exposes its CLIENT descriptor: consts, then fns, in order', () => {
  const g = globals();
  const one = { HC_FMT: F.CLIENT, HC_BAND: R.CLIENT, HC_ADH: ADH.CLIENT, HC_PROG: PROG.CLIENT, HC_NSCORE: NS.CLIENT, HC_FOODLOG: FL.CLIENT, HC_DAYTYPE: DT.CLIENT, HC_FUEL: FU.CLIENT, HC_ENERGY: EN.CLIENT };
  for (const [name, c] of Object.entries(one)) {
    assert.deepEqual(Object.keys(g[name]), keysOf(c), name);
    for (const k of Object.keys(c.fns)) assert.equal(typeof g[name][k], 'function', `${name}.${k}`);
  }
});

test('HC_FMT formats exactly like lib/format/numbers.mjs', () => {
  const C = globals().HC_FMT;
  const cases = [
    ['fmtInt', [13463, 'es']], ['fmtInt', [2500, 'en']], ['fmtNumber', [-0.04, 1, 'es', true]],
    ['fmtNumber', [1234.56, 1, 'es']], ['fmtPercent', [97, 'es']], ['fmtMinutes', [421]],
    ['fmtHours', [7.999]], ['fmtRaw', [1.25, 'es']], ['fmtPlain', [2500.25, 1, 'es']], ['fmtInt', [null, 'es']],
  ];
  const FNS = /** @type {Record<string, (...a: unknown[]) => unknown>} */ (/** @type {unknown} */ (F));
  for (const [fn, args] of /** @type {[string, unknown[]][]} */ (cases)) assert.equal(C[fn](...args), FNS[fn](...args), `${fn}(${args})`);
  assert.equal(C.DASH, '—');
});

test('HC_BAND cuts the 0-100 bands where lib/score/recovery.mjs does', () => {
  const B = globals().HC_BAND;
  assert.equal(B.PCT_GOOD, R.PCT_GOOD);
  assert.equal(B.PCT_LOW, R.PCT_LOW);
  for (const v of [100, 67, 66.9, 34, 33.5, 33, 0, null, NaN]) assert.equal(B.pctBand(v), R.pctBand(v), String(v));
});

test('HC_ADH counts adherence exactly like lib/nutrition/adherence.mjs', () => {
  const A = globals().HC_ADH;
  const day = (/** @type {object} */ o) => ({ date: '2030-01-10', k: 2000, p: 140, c: 200, f: 60, n: 3, missing: { p: false, c: false, f: false }, groups: { breakfast: 1, lunch: 1, dinner: 1, addon: 0 }, ...o });
  assert.deepEqual(js(A.ADHERENCE), js(ADH.ADHERENCE));
  for (const c of ADHERENCE_CASES) assert.deepEqual(js(A.adherence(c.dates, c.days, c.targets)), c.expect, c.name);
  for (const d of [null, day({}), day({ groups: { breakfast: 1, lunch: 0, dinner: 1, addon: 0 } }), day({ n: 0 }), day({ k: null })]) {
    assert.equal(A.isComplete(d), ADH.isComplete(d));
    for (const t of [null, { k: 2500, p: 150 }, { k: 1900, p: 150 }, { k: 2000, p: 150, inferred: true }]) assert.equal(A.dayState(d, t), ADH.dayState(d, t));
  }
});

test('HC_PROG computes the weight progress exactly like lib/nutrition/progress.mjs', () => {
  const P = globals().HC_PROG;
  assert.deepEqual(js(P.PROGRESS), js(PROG.PROGRESS));
  for (const c of PROGRESS_CASES) {
    assert.deepEqual(js(P.weightProgress(c.metric, c.opts)), c.expect, c.name);
    assert.deepEqual(js(P.rollPoints(c.metric)), PROG.rollPoints(c.metric), 'rollPoints ' + c.name);
    assert.deepEqual(js(P.weeklyRate(PROG.rollPoints(c.metric))), PROG.weeklyRate(PROG.rollPoints(c.metric)), 'weeklyRate ' + c.name);
  }
  for (const [d, w] of /** @type {[string, number[] | null][]} */ ([['2030-02-10', [6, 12]], ['2030-12-20', [1.5, 3]], ['2030-02-10', null], ['x', [1, 2]]])) {
    assert.deepEqual(js(P.etaMonths(d, w)), PROG.etaMonths(d, w), d);
  }
  assert.deepEqual(js(P.rollPoints({ start: 'bad', roll: [1] })), []);
});

test('HC_ENERGY (the in-page onboarding) computes exactly what lib/nutrition/energy.mjs computes', () => {
  const H = globals().HC_ENERGY;
  const people = [
    { sex: 'male', age: 30, heightCm: 175, weightKg: 70, activity: 'light' },
    { sex: 'female', age: 52, heightCm: 160, weightKg: 82, activity: 'sedentary', sports: [{ sport: 'cycling', minutes: 160, perWeek: 2 }] },
    { sex: 'female', age: 19, heightCm: 150, weightKg: 45, activity: 'active', sports: [{ sport: 'strength', minutes: 60, perWeek: 3 }] },
  ];
  for (const p of people) {
    assert.deepEqual(js(H.computeTargets(p)), js(EN.computeTargets(p)), JSON.stringify(p));
    assert.deepEqual(js(H.screenPerson(p)), js(EN.screenPerson(p)), JSON.stringify(p));
    assert.deepEqual(js(H.validatePerson(p)), js(EN.validatePerson(p)), JSON.stringify(p));
  }
  for (const m of [10, 74, 75, 149, 150, 600]) assert.equal(H.dayTypeOfMinutes(m), EN.dayTypeOfMinutes(m), String(m));
  assert.deepEqual(js(H.SPORTS), js(EN.SPORTS));
});

test('the page ships the lib constants frozen, as the modules define them (a write throws in a module script)', () => {
  const g = globals();
  assert.ok(Object.isFrozen(g.HC_ADH.ADHERENCE));
  assert.ok(Object.isFrozen(g.HC_PROG.PROGRESS));
});
