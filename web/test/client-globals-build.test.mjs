/* The classic-script globals emitted by the libs' clientSource() (HC_FMT, HC_BAND, HC_ADH, HC_PROG,
 * HC_NSCORE, HC_FOODLOG, HC_DAYTYPE, HC_FUEL, HC_SCALE, HC_GUIDE) as
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
import * as EN from '../../lib/nutrition/energy.mjs';
import * as DT from '../../lib/nutrition/daytype.mjs';
import * as FU from '../../lib/nutrition/fuel.mjs';
import * as SC from '../../lib/nutrition/scale.mjs';
import * as AM from '../../lib/nutrition/amounts.mjs';
import { fmtPieces } from '../../lib/nutrition/units.mjs';
import { waterFill, FILL_CASES } from '../../lib/nutrition/fill.mjs';
import * as GU from '../../lib/nutrition/guide.mjs';

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
  HC_DAYTYPE: ['DETECT', 'RANK', 'rideType', 'lengthType', 'itemType', 'dayTypeOfWorkouts', 'dayTypeOfProgram', 'detectDayType', 'hasValue', 'dayInputFor'],
  HC_FUEL: ['FUEL', 'RIDE_DEFAULT_MIN', 'OWN_START_MIN', 'isBikeDay', 'step', 'range', 'pickItem', 'ownDuring', 'ownBefore', 'fuelPlan'],
  HC_SCALE: [
    'LINE', 'GRID_EPS', 'FUEL', 'RIDE_DEFAULT_MIN', 'OWN_START_MIN', 'stepAmount', 'lineUnit', 'lineAmt', 'lineStep', 'lineKey', 'lineCap',
    'capFactor', 'floorToStep', 'capAmount', 'pieceOf', 'isDiscrete', 'fmtAmt', 'round2', 'fmtHalf', 'fmtPieces', 'bound', 'waterFill',
    'isBikeDay', 'step', 'range', 'pickItem', 'ownDuring', 'ownBefore', 'fuelPlan', 'zero', 'r0', 'macroRow', 'fmtFactor', 'solveScale', 'planFor',
  ],
  HC_ENERGY: [
    'NEAT', 'EXERCISE', 'SPORTS', 'round50', 'ageOn', 'bmi', 'bmrMifflin', 'dayTypeOfMinutes', 'isInt', 'validSports', 'exerciseFor',
    'usedDayTypes', 'maintenance', 'inRange', 'validatePerson', 'computeTargets', 'screenPerson',
    'checkTargetWeight', 'checkTargets', 'carbsOf',
  ],
  HC_GUIDE: [
    'GUIDE_ROLES', 'ROLE_KEYS', 'MACS', 'DONE_SHARE', 'COVERED_SHARE', 'OIL_SLOTS', 'fin', 'floorToStep', 'foldName', 'zero', 'cmp', 'guideBudgets',
    'exampleAmount', 'remaining', 'mealState', 'isCovered', 'dayRemaining', 'capByDay', 'roleOptions',
  ],
};

function globalsOf(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => /\bvar HC_FMT\s*=/.test(s));
  assert.ok(script, `${htmlPath}: the HC_FMT script`);
  const ctx = vm.createContext({});
  vm.runInContext(script, ctx);
  return ctx;
}
// the page's own NUTRI bake (Dia.astro: the models planFor re-solves) and its other baked globals (FOOD_BASICS)
function bakeOf(htmlPath, name) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => new RegExp('(^|[;\\n])var ' + name + '\\s*=').test(s));
  assert.ok(script, `${htmlPath}: the ${name} bake`);
  const ctx = vm.createContext({});
  vm.runInContext(script, ctx);
  return js(ctx[name]);
}
const nutriOf = (htmlPath) => bakeOf(htmlPath, 'NUTRI');

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

  test(`${rel}: HC_ENERGY computes the onboarding targets, screen and bounds like lib/nutrition/energy.mjs`, () => {
    const { HC_ENERGY } = globalsOf(page);
    assert.deepEqual(js(HC_ENERGY.NEAT), js(EN.NEAT));
    const people = [
      { sex: 'male', age: 30, heightCm: 175, weightKg: 70, activity: 'light' },
      { sex: 'female', age: 50, heightCm: 150, weightKg: 45, activity: 'sedentary' },
      { sex: 'female', age: 29, heightCm: 165, weightKg: 60, activity: 'active' },
      { sex: 'female', age: 29, heightCm: 165, weightKg: 60, activity: 'sedentary', sports: [{ sport: 'yoga', minutes: 60, perWeek: 3 }, { sport: 'running', minutes: 90, perWeek: 2 }] },
    ];
    for (const p of people) {
      const own = EN.computeTargets(p);
      assert.deepEqual(js(HC_ENERGY.computeTargets(p)), js(own));
      const edited = JSON.parse(JSON.stringify(own.targets));
      edited.cut.rest.kcal = 1100;
      edited.maintain.gym.p = 200;
      assert.deepEqual(js(HC_ENERGY.checkTargets(edited, p)), js(EN.checkTargets(edited, p)));
      assert.deepEqual(js(HC_ENERGY.screenPerson({ ...p, medical: true })), js(EN.screenPerson({ ...p, medical: true })));
      assert.deepEqual(js(HC_ENERGY.usedDayTypes(p.sports)), js(EN.usedDayTypes(p.sports)));
      assert.deepEqual(js(HC_ENERGY.validatePerson(p)), []);
    }
    assert.equal(HC_ENERGY.ageOn('1997-05-20', '2026-10-14'), EN.ageOn('1997-05-20', '2026-10-14'));
    assert.deepEqual(js(HC_ENERGY.checkTargetWeight({ heightCm: 175, weightKg: 70, goal: 'cut', targetWeightKg: 55 })), ['targetBmiLow']);
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

  test(`${rel}: HC_SCALE solves the page's own NUTRI bake like lib/nutrition/scale.mjs`, () => {
    const { HC_SCALE } = globalsOf(page);
    const nutri = nutriOf(page);
    assert.deepEqual(js(HC_SCALE.LINE), js(AM.LINE));
    assert.equal(HC_SCALE.GRID_EPS, AM.GRID_EPS);
    for (const g of nutri.goals) for (const d of nutri.dayTypes) for (const min of [null, 60, 120, 185, 360]) {
      assert.deepEqual(js(HC_SCALE.planFor(nutri, g, d, min)), js(SC.planFor(nutri, g, d, min)), `${g}/${d}/${min}`);
    }
    for (const day of Object.keys(nutri.base)) for (let t = 300; t < 5000; t += 397) {
      assert.deepEqual(js(HC_SCALE.solveScale(nutri.base[day], t, nutri.fmt)), js(SC.solveScale(nutri.base[day], t, nutri.fmt)), `${day}/${t}`);
    }
    for (const c of FILL_CASES) assert.deepEqual(js(HC_SCALE.waterFill(c.items, c.need, c.opts)), js(waterFill(c.items, c.need, c.opts)), JSON.stringify(c));
    const pc = { a: 120, r: null, o: 'banana', m: 'bananas' };
    for (const [amt, unit] of [[180, 'g'], [150, 'g'], [60, 'g']]) assert.equal(HC_SCALE.fmtPieces(amt, unit, pc), fmtPieces(amt, unit, pc));
    assert.equal(HC_SCALE.fmtAmt(250, 'ud', { ud: 'pc' }, null), AM.fmtAmt(250, 'ud', { ud: 'pc' }, null));
    assert.equal(HC_SCALE.fmtFactor(1.25, ','), SC.fmtFactor(1.25, ','));
    assert.equal(HC_SCALE.floorToStep(0.9, 0.3), AM.floorToStep(0.9, 0.3));
  });

  test(`${rel}: HC_GUIDE budgets the portion guide like lib/nutrition/guide.mjs`, () => {
    const { HC_GUIDE, HC_SCALE } = globalsOf(page);
    const nutri = nutriOf(page);
    const basics = bakeOf(page, 'FOOD_BASICS');
    for (const k of ['GUIDE_ROLES', 'ROLE_KEYS', 'DONE_SHARE', 'COVERED_SHARE', 'OIL_SLOTS']) assert.deepEqual(js(HC_GUIDE[k]), js(GU[k]), k);
    assert.deepEqual(js(HC_GUIDE.MACS), ['k', 'p', 'c', 'f']);
    for (const g of nutri.goals) for (const d of nutri.dayTypes) {
      const x = HC_SCALE.planFor(nutri, g, d, 120), b = nutri.base[x.base];
      assert.deepEqual(js(HC_GUIDE.guideBudgets(x, b.sl, nutri.mainSlots, nutri.guide.oil[x.base])), js(GU.guideBudgets(x, b.sl, nutri.mainSlots, nutri.guide.oil[x.base])), `${g}/${d}`);
    }
    for (const c of GU.GUIDE_CASES) assert.deepEqual(js(HC_GUIDE.exampleAmount(c.food, c.role, c.g, GU.GUIDE_GRID)), js(c.expect), JSON.stringify(c));
    for (const food of basics) for (const role of ['p', 'c', 'f']) for (const g of [0, 7.5, 45, 161]) {
      assert.deepEqual(js(HC_GUIDE.exampleAmount(food, role, g, nutri.scale)), js(GU.exampleAmount(food, role, g, nutri.scale)), `${food.k}/${role}/${g}`);
    }
    for (const c of GU.DAYCAP_CASES) assert.deepEqual(js(HC_GUIDE.capByDay(c.meal, c.day, c.total)), c.expect, JSON.stringify(c));
    const budget = { k: 600, p: 40, c: 70, f: 20 }, logged = { k: 550, p: 38, c: null, f: 30 };
    assert.deepEqual(js(HC_GUIDE.remaining(budget, logged)), js(GU.remaining(budget, logged)));
    assert.equal(HC_GUIDE.mealState(budget, logged), GU.mealState(budget, logged));
    assert.equal(HC_GUIDE.isCovered(4, 40), GU.isCovered(4, 40));
    const groups = { meals: { breakfast: logged, lunch: null }, addon: { k: 100, p: 5 } };
    assert.deepEqual(js(HC_GUIDE.dayRemaining({ k: 2400, p: 150, c: 260, f: 70 }, groups, nutri.mainSlots)), js(GU.dayRemaining({ k: 2400, p: 150, c: 260, f: 70 }, groups, nutri.mainSlots)));
    const products = [{ id: 7, name: 'Ávena', unit: 'g', per100: { kcal: 370, protein: 13, carbs: 60, fat: 7 } }, { id: 3, name: 'avena', unit: 'ml', per100: { kcal: 40, protein: null, carbs: 5, fat: 1 } }];
    for (const role of ['p', 'c', 'f']) assert.deepEqual(js(HC_GUIDE.roleOptions(basics, products, role)), js(GU.roleOptions(basics, products, role)), role);
  });
}
