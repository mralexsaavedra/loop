/* The classic-script globals emitted by the libs' clientSource() (HC_FMT, HC_BAND, HC_ADH, HC_PROG,
 * HC_NSCORE, HC_FOODLOG, HC_DAYTYPE, HC_FUEL) as
 * they ship in the BUILT page, not as the unbundled modules emit them: Vite / Rollup bundles the libs
 * together and renames clashing top-level names (fin -> fin$3, ISO_RE -> ISO_RE$2), so a global whose
 * keys or constants came from those names breaks only on the real page. Extracts the inline script
 * from each built fixture (`npm run pretest`), runs it in a vm and checks the public keys and results
 * against the lib modules on the shared cases. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as F from '../../lib/format/numbers.mjs';
import { pctBand, PCT_GOOD, PCT_LOW } from '../../lib/score/recovery.mjs';
import { ADHERENCE, ADHERENCE_CASES, isComplete, dayState } from '../../lib/nutrition/adherence.mjs';
import { PROGRESS, PROGRESS_CASES, rollPoints, weeklyRate, etaMonths } from '../../lib/nutrition/progress.mjs';
import * as NS from '../../lib/nutrition/score.mjs';
import * as FL from '../../lib/nutrition/foodlog.mjs';
import * as DT from '../../lib/nutrition/daytype.mjs';
import * as FU from '../../lib/nutrition/fuel.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
// only the fixtures pretest rebuilds from the current sources (web/dist/<mode> may be a stale earlier build);
// en-example always exists, es-personal only when the personal files do
const PAGES = [
  path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html'),
  path.join(WEB_ROOT, '.test-dist', 'es-personal', 'index.html'),
].filter((p, i) => i === 0 || fs.existsSync(p));
const js = (v) => JSON.parse(JSON.stringify(v));

const KEYS = {
  HC_FMT: ['DASH', 'toNum', 'groupDigits', 'localise', 'fmtNumber', 'fmtInt', 'fmtRaw', 'fmtPercent', 'fmtMinutes', 'fmtHours', 'fmtPlain'],
  HC_BAND: ['PCT_GOOD', 'PCT_LOW', 'pctBand'],
  HC_ADH: ['ADHERENCE', 'fin', 'isComplete', 'dayState', 'adherence'],
  HC_PROG: ['PROGRESS', 'fin', 'round', 'dayNum', 'isoOf', 'rollPoints', 'weeklyRate', 'weightProgress', 'etaMonths'],
  HC_NSCORE: ['NSCORE', 'fin', 'clamp100', 'ratio', 'pts1', 'kcalPoints', 'proteinPoints', 'fatPoints', 'scoreBand', 'hasMeals', 'nutritionScore', 'scoreSeries'],
  HC_FOODLOG: [
    'ATWATER_TOL', 'ATWATER_ABS_KCAL', 'BASIC_UD_AMT', 'MACROS', 'fin', 'roundEps', 'round1', 'roundKcal', 'round2', 'roundMacros', 'scaleMacros',
    'times', 'productAmount', 'productEntry', 'knownMacros', 'ingredientBasis', 'recipeBasis', 'entryFromBasis', 'recipeEntry', 'dayTotals',
    'atwaterOk', 'pieceWeight', 'basicModes', 'basicAmount', 'basicEntry', 'basicLabel', 'basicConvert', 'basicIngredient',
  ],
  HC_DAYTYPE: ['DETECT', 'RANK', 'rideType', 'itemType', 'dayTypeOfWorkouts', 'dayTypeOfProgram', 'detectDayType', 'hasValue', 'dayInputFor'],
  HC_FUEL: ['FUEL', 'RIDE_DEFAULT_MIN', 'OWN_START_MIN', 'isBikeDay', 'step', 'range', 'pickItem', 'ownDuring', 'ownBefore', 'fuelPlan'],
};

function globalsOf(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => /\bvar HC_FMT\s*=/.test(s));
  assert.ok(script, `${htmlPath}: the HC_FMT script`);
  const ctx = vm.createContext({});
  vm.runInContext(script, ctx);
  return ctx;
}

test('at least the example build is present (npm run pretest)', () => {
  assert.ok(PAGES.length > 0, 'no built page: run npm run pretest');
});

for (const page of PAGES) {
  const rel = path.relative(WEB_ROOT, page);

  test(`${rel}: the clientSource globals expose exactly their public keys, every function defined`, () => {
    const g = globalsOf(page);
    for (const [name, keys] of Object.entries(KEYS)) {
      assert.ok(g[name], `${name} defined`);
      assert.deepEqual(Object.keys(g[name]), keys, name);
      for (const k of keys) assert.notEqual(g[name][k], undefined, `${name}.${k}`);
    }
  });

  test(`${rel}: the shipped globals compute what the lib modules compute`, () => {
    const { HC_FMT, HC_BAND, HC_ADH, HC_PROG } = globalsOf(page);
    for (const [x, dec, loc, signed] of [[1234.5, 1, 'es', false], [-0.04, 1, 'en', true], [12345678, 0, 'es', false], [null, 0, 'en', false]]) {
      assert.equal(HC_FMT.fmtNumber(x, dec, loc, signed), F.fmtNumber(x, dec, loc, signed));
    }
    assert.equal(HC_FMT.fmtMinutes(421), F.fmtMinutes(421));
    assert.equal(HC_FMT.fmtPercent(97.4, 'es'), F.fmtPercent(97.4, 'es'));
    assert.equal(HC_FMT.fmtPlain(7.5, 1, 'es'), F.fmtPlain(7.5, 1, 'es'));
    assert.equal(HC_BAND.PCT_GOOD, PCT_GOOD);
    assert.equal(HC_BAND.PCT_LOW, PCT_LOW);
    for (const v of [100, 67, 66.9, 34, 33.5, 33, 0, null, NaN]) assert.equal(HC_BAND.pctBand(v), pctBand(v), String(v));

    assert.deepEqual(js(HC_ADH.ADHERENCE), js(ADHERENCE));
    for (const c of ADHERENCE_CASES) assert.deepEqual(js(HC_ADH.adherence(c.dates, c.days, c.targets)), c.expect, c.name);
    const d = { date: '2030-01-01', k: 2000, p: 100, n: 3, groups: { breakfast: 1, lunch: 1, dinner: 1 } };
    assert.equal(HC_ADH.isComplete(d), isComplete(d));
    assert.equal(HC_ADH.dayState(d, { k: 2500, p: 150 }), dayState(d, { k: 2500, p: 150 }));
    assert.equal(HC_ADH.fin(3), true);
    assert.equal(HC_ADH.fin('3'), false);

    assert.deepEqual(js(HC_PROG.PROGRESS), js(PROGRESS));
    for (const c of PROGRESS_CASES) {
      assert.deepEqual(js(HC_PROG.weightProgress(c.metric, c.opts)), c.expect, c.name);
      assert.deepEqual(js(HC_PROG.rollPoints(c.metric)), rollPoints(c.metric), 'rollPoints ' + c.name);
      assert.deepEqual(js(HC_PROG.weeklyRate(rollPoints(c.metric))), weeklyRate(rollPoints(c.metric)), 'weeklyRate ' + c.name);
    }
    assert.deepEqual(js(HC_PROG.etaMonths('2030-02-10', [6, 12])), etaMonths('2030-02-10', [6, 12]));
    assert.equal(HC_PROG.round(1.25, 1), 1.3);
  });

  test(`${rel}: HC_NSCORE scores what lib/nutrition/score.mjs scores`, () => {
    const { HC_NSCORE } = globalsOf(page);
    assert.deepEqual(js(HC_NSCORE.NSCORE), js(NS.NSCORE));
    for (const c of NS.NSCORE_CASES) {
      assert.deepEqual(js(HC_NSCORE.nutritionScore(c.day, c.target, { today: c.today })), js(c.expect), c.name);
    }
    const dates = NS.NSCORE_CASES.map((c, i) => '2030-01-' + String(i + 1).padStart(2, '0'));
    const days = NS.NSCORE_CASES.map((c, i) => ({ ...c.day, date: dates[i] }));
    const targets = Object.fromEntries(dates.map((d, i) => [d, NS.NSCORE_CASES[i].target]));
    assert.deepEqual(js(HC_NSCORE.scoreSeries(dates, days, targets, dates[2])), js(NS.scoreSeries(dates, days, targets, dates[2])));
    for (const s of [100, 85, 84.9, 60, 59, null]) assert.equal(HC_NSCORE.scoreBand(s), NS.scoreBand(s), String(s));
    for (const k of [1300, 1799.9, 2200, 2200.1, 2699]) assert.equal(HC_NSCORE.kcalPoints(k, 2000), NS.kcalPoints(k, 2000), String(k));
    assert.equal(HC_NSCORE.hasMeals({ groups: { breakfast: 1, lunch: 1, dinner: 0 } }), false);
    assert.equal(HC_NSCORE.hasMeals({ groups: { breakfast: 1, lunch: 2, dinner: 1 } }), true);
  });

  test(`${rel}: HC_FOODLOG computes what lib/nutrition/foodlog.mjs computes`, () => {
    const { HC_FOODLOG } = globalsOf(page);
    assert.equal(HC_FOODLOG.ATWATER_TOL, FL.ATWATER_TOL);
    assert.equal(HC_FOODLOG.ATWATER_ABS_KCAL, FL.ATWATER_ABS_KCAL);
    assert.equal(HC_FOODLOG.BASIC_UD_AMT, FL.BASIC_UD_AMT);
    assert.deepEqual(js(HC_FOODLOG.MACROS), ['protein', 'carbs', 'fat']);
    for (const c of FL.FOODLOG_CASES) assert.deepEqual(js(FL.runCase(c, HC_FOODLOG)), js(c.expect), c.name);
    for (const c of FL.BASIC_CASES) assert.deepEqual(js(FL.runBasicCase(c, HC_FOODLOG)), js(c.expect), c.name);
    for (const v of [1.005, 0.1 + 0.2, 2.45, 7]) {
      assert.equal(HC_FOODLOG.round1(v), FL.round1(v));
      assert.equal(HC_FOODLOG.roundKcal(v), FL.roundKcal(v));
    }
    const long = { k: 'x', n: 'N'.repeat(200), u: 'g', m: [100, 1, 1, 1] };
    assert.equal(HC_FOODLOG.basicLabel(long, 10, 'g', { dec: '.', g: 'g' }), FL.basicLabel(long, 10, 'g', { dec: '.', g: 'g' }), 'FOOD_LIMITS.nameMax cap');
  });

  test(`${rel}: HC_DAYTYPE / HC_FUEL detect and fuel like lib/nutrition/daytype.mjs / fuel.mjs`, () => {
    const { HC_DAYTYPE, HC_FUEL } = globalsOf(page);
    assert.deepEqual(js(HC_DAYTYPE.DETECT), js(DT.DETECT));
    assert.deepEqual(js(HC_DAYTYPE.RANK), { rest: 0, gym: 1, bike: 2, bikeLong: 3 });
    for (const c of DT.DAYTYPE_CASES) assert.deepEqual(js(HC_DAYTYPE.detectDayType(c.input)), js(c.expect), JSON.stringify(c.input));
    for (const c of DT.DAYINPUT_CASES) assert.deepEqual(js(HC_DAYTYPE.dayInputFor(c.date, c.data)), js(c.expect), c.date);
    assert.deepEqual(js(HC_FUEL.FUEL), js(FU.FUEL));
    assert.deepEqual(js(HC_FUEL.RIDE_DEFAULT_MIN), js(FU.RIDE_DEFAULT_MIN));
    assert.equal(HC_FUEL.OWN_START_MIN, FU.OWN_START_MIN);
    for (const c of FU.FUEL_CASES) assert.deepEqual(js(HC_FUEL.fuelPlan(c)), js(FU.fuelPlan(c)));
    for (const d of ['rest', 'gym', 'bike', 'bikeLong']) {
      for (const o of [{ dayType: d }, { dayType: d, minutes: 185, weightKg: 72 }]) assert.deepEqual(js(HC_FUEL.fuelPlan(o)), js(FU.fuelPlan(o)), JSON.stringify(o));
    }
    assert.equal(HC_FUEL.isBikeDay('bikeLong'), true);
    assert.equal(HC_FUEL.isBikeDay('gym'), false);
  });
}
