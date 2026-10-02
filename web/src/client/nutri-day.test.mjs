/* web/src/client/nutri-day.js — Nutrición Resumen de hoy / Plan de hoy / Avituallamiento + Inicio's
 * "today you eat" card. Runs the real classic script in node:vm against web/test/dom-stub.mjs with a
 * fixed clock and a NUTRI baked from the tracked example plan (lib/nutrition/today.mjs). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { loadUtil } from '../../test/client-util.mjs';
import { es as esN, en as enN } from '../i18n/nutri-templates.mjs';
import { es as esDate, en as enDate } from '../i18n/date-templates.mjs';
import { buildNutrition } from '../../../lib/nutrition/macros.mjs';
import { buildNutriToday } from '../../../lib/nutrition/today.mjs';
import { DAYTYPE_CASES, DAYINPUT_CASES } from '../../../lib/nutrition/daytype.mjs';
import { fuelPlan } from '../../../lib/nutrition/fuel.mjs';
import { planFor, solveScale } from '../../../lib/nutrition/scale.mjs';
import { lineCap } from '../../../lib/nutrition/amounts.mjs';
import { waterFill, FILL_CASES } from '../../../lib/nutrition/fill.mjs';
import { LINE, floorToStep, GRID_EPS } from '../../../lib/nutrition/amounts.mjs';
import { MAIN_SLOTS } from '../../../lib/nutrition/slots.mjs';
import { buildBasics } from '../../../lib/nutrition/basics.mjs';
import { guideBudgets, exampleAmount, remaining, mealState, isCovered, roleOptions, GUIDE_CASES, GUIDE_GRID } from '../../../lib/nutrition/guide.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..');
const source = fs.readFileSync(path.join(here, 'nutri-day.js'), 'utf8');
const ING = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/ingredients.json'), 'utf8')).ingredients;
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/plan-data.example.json'), 'utf8'));
const SUPPS = [
  { name: 'Demo Creatine', dose: '3 g', meal: 'lunch' },
  { name: 'Demo Electrolytes', dose: null, meal: 'preworkout' },
];
const bake = (opts = {}) => JSON.parse(JSON.stringify(buildNutriToday(buildNutrition(ING, PLAN), PLAN, { supplements: SUPPS, weight: { kg: 70, date: '2030-01-08' }, ...opts })));
const TODAY = '2030-01-10';

function fixedDate(iso) {
  const RealDate = Date;
  return class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(iso + 'T12:00:00'); }
    static now() { return new RealDate(iso + 'T12:00:00').getTime(); }
  };
}
function memStorage(init = {}) {
  const m = { ...init };
  return { data: m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
}

const ARC = 'M24.64 95.36A50 50 0 1 1 95.36 95.36';
const BASICS = { en: buildBasics(ING, 'en'), es: buildBasics(ING, 'es') };
function run({ nutri = bake(), items = [], programmed = null, locale = 'en', storage = memStorage(), today = TODAY, hooks = true, extra = {}, intake, query, basics } = {}) {
  const doc = new StubDocument();
  if (query) doc.querySelector = query;
  const els = {};
  for (const id of ['nutri-daytype', 'nutri-daytype-src', 'nutri-why', 'nutri-target', 'nutri-plan', 'nutri-fuel-block', 'nutri-ride-wrap', 'nutri-fuel-body', 'eat-body', 'intake']) els[id] = doc.el(id);
  els['nutri-auto'] = doc.el('nutri-auto', { tag: 'button', hidden: true });
  els['nutri-plan-fold'] = doc.el('nutri-plan-fold', { tag: 'details' });
  els['nutri-plan-kcal'] = doc.el('nutri-plan-kcal');
  els['nutri-note'] = doc.el('nutri-note', { hidden: true });
  els['nutri-fuel-block'].hidden = true;
  const radios = {};
  const labels = {};
  for (const d of ['rest', 'gym', 'bike', 'bikeLong']) {
    labels[d] = doc.el(null, { tag: 'label', classes: ['seg-opt'] });
    radios['d-' + d] = doc.el(null, { tag: 'input', attrs: { name: 'nutri-day', value: d }, parent: labels[d] });
  }
  const calls = [];
  const window = { localStorage: storage };
  // the intake rings read window.nutriTarget() when refreshed
  if (hooks === true) {
    window.intakeRefresh = () => calls.push(['intake', window.nutriTarget().k]);
  } else if (hooks) Object.assign(window, hooks);
  const ctx = {
    document: doc, window, NUTRI: nutri, I18N_NUTRI: locale === 'es' ? esN : enN, I18N_DATE: locale === 'es' ? esDate : enDate, LOCALE: locale,
    SCORES: { timeline: { asOf: today, days: [{ date: today, sleep: 7.5, items }] } },
    TRAINING: programmed ? { [today]: programmed } : {},
    NUTRI_ARC: ARC,
    FOOD_BASICS: basics !== undefined ? basics : BASICS[locale === 'es' ? 'es' : 'en'],
    ...(intake !== undefined ? { INTAKE: intake } : {}),
    Math, String, Number, JSON, Array, Object, isFinite, Date: fixedDate(today), ...extra,
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  const fire = (id, evt, target) => els[id]._listeners[evt].forEach((fn) => fn({ target }));
  return { els, radios, labels, window, calls, storage, fire, api: window.HCNutri };
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const checkedOf = (radios, prefix) => Object.entries(radios).filter(([k, r]) => k.startsWith(prefix) && r.checked).map(([k]) => k.slice(prefix.length));

test('detectDayType port agrees with lib/nutrition/daytype.mjs on every shared case', () => {
  const { api } = run();
  for (const c of DAYTYPE_CASES) assert.deepEqual(JSON.parse(JSON.stringify(api.detectDayType(c.input))), c.expect, JSON.stringify(c.input));
});

test('fuelPlan port agrees with lib/nutrition/fuel.mjs', () => {
  const { api } = run();
  for (const dayType of ['bike', 'bikeLong', 'gym']) for (const minutes of [45, 60, 120, 135, 210, 330]) for (const weightKg of [null, 58.4, 70, 91.2]) {
    assert.deepEqual(JSON.parse(JSON.stringify(api.fuelPlan({ dayType, minutes, weightKg }))), JSON.parse(JSON.stringify(fuelPlan({ dayType, minutes, weightKg }))), `${dayType} ${minutes} ${weightKg}`);
  }
});

// a synthetic plan with whole-unit (ud) and manual flex parts, so the parity covers every branch
const SYN_ING = {
  arroz: { per: 100, k: 360, p: 7, c: 79, g: 1, unit: 'g' },
  pollo: { per: 100, k: 100, p: 20, c: 0, g: 2, unit: 'g' },
  bollo: { per: 100, k: 200, p: 6, c: 40, g: 2, unit: 'ud' },
  zumo: { per: 100, k: 45, p: 0.5, c: 10, g: 0, unit: 'ml' },
};
const SYN_PLAN = {
  data: { legume: [{ n: 'Lentils', q: '1 bowl', manual: { k: 300, p: 20, c: 50, g: 2 } }] },
  extras: {},
  dayPlan: {
    train: { meals: [{ name: 'Breakfast', parts: [{ ing: 'bollo', amt: 200, flex: 'carb' }, { ing: 'zumo', amt: 250, flex: 'carb' }] }, { name: 'Lunch', parts: [{ ing: 'pollo', amt: 300 }, { use: 'legume', match: 'Lentils', flex: 'carb' }, { ing: 'arroz', amt: 120, flex: 'carb' }] }] },
    rest: { meals: [{ name: 'Lunch', parts: [{ ing: 'pollo', amt: 300 }, { ing: 'bollo', amt: 100, flex: 'carb' }] }] },
  },
};

// the same plan with portion caps (a capped unit food, a capped ml line, a written amount above its cap)
// and a category-flex part, so the parity covers water-filling, held lines and the ud re-solve with caps
const CAP_ING = {
  ...SYN_ING,
  arroz: { ...SYN_ING.arroz, maxAmt: 150, cat: 'carb' },
  bollo: { ...SYN_ING.bollo, maxAmt: 300 },
  zumo: { ...SYN_ING.zumo, maxAmt: 300 },
  patata: { per: 100, k: 86, p: 2, c: 19, g: 0.1, unit: 'g', cat: 'carb', maxAmt: 400 },
};
const CAP_PLAN = JSON.parse(JSON.stringify(SYN_PLAN));
CAP_PLAN.dayPlan.rest.meals.push({ name: 'Dinner', parts: [{ ing: 'patata', amt: 450 }, { ing: 'arroz', amt: 60, flex: null }] });
CAP_PLAN.dayPlan.train.meals.push({ name: 'Dinner', parts: [{ ing: 'patata', amt: 250 }] });

test('planFor / solveScale ports agree with lib/nutrition/scale.mjs (example plan + units, manual and ml parts, portion caps)', () => {
  const syn = plain(buildNutriToday(buildNutrition(SYN_ING, SYN_PLAN), SYN_PLAN, { units: { g: 'g', ml: 'ml', ud: 'pc' }, dec: ',' }));
  const cap = plain(buildNutriToday(buildNutrition(CAP_ING, CAP_PLAN), CAP_PLAN, { units: { g: 'g', ml: 'ml', ud: 'pc' }, dec: ',' }));
  assert.ok(cap.base.rest.flex.some((x) => x.ln && x.ln.some((l) => lineCap(l))), 'the capped fixture bakes caps on its lines');
  let held = 0;
  for (const nutri of [bake(), syn, cap]) {
    const { api } = run({ nutri });
    for (const g of ['maintain', 'cut', 'bulk']) for (const d of ['rest', 'gym', 'bike', 'bikeLong']) for (const min of [null, 60, 120, 185, 240, 360]) {
      assert.deepEqual(plain(api.planFor(nutri, g, d, min)), plain(planFor(nutri, g, d, min)), `${g}/${d}/${min}`);
    }
    for (const day of ['train', 'rest']) for (let target = 300; target < 5000; target += 173) {
      const lib = solveScale(nutri.base[day], target, nutri.fmt);
      if (lib.capped) held++;
      assert.deepEqual(plain(api.solveScale(nutri.base[day], target, nutri.fmt)), plain(lib), `${day}/${target}`);
    }
  }
  assert.ok(held > 20, `the parity sweep exercises held (capped) lines (${held} cases)`);
});

test('no workout, nothing programmed: rest (auto), the default goal, rest target and plan; no fuelling block', () => {
  const { els, radios, calls } = run();
  assert.equal(checkedOf(radios, 'g-').length, 0, 'no goal radios in Nutrición (the goal lives in the profile sheet)');
  assert.deepEqual(checkedOf(radios, 'd-'), ['rest']);
  assert.equal(els['nutri-daytype-src'].textContent, '(auto)');
  assert.equal(els['nutri-auto'].hidden, true);
  assert.match(els['nutri-why'].textContent, /No workout recorded or programmed today/);
  assert.match(els['nutri-target'].innerHTML, /<b class="nt-kcal">2,500<\/b><span class="nt-unit">kcal<\/span>/);
  assert.match(els['nutri-target'].innerHTML, /<span class="nt-bar-lbl">Protein<\/span><span class="nt-bar-val"><b>150<\/b> g<\/span>/);
  assert.match(els['nutri-target'].innerHTML, /<span class="nt-bar-lbl">Carbs<\/span><span class="nt-bar-val"><b>340<\/b> g<\/span>/);
  assert.match(els['nutri-plan'].innerHTML, /class="meal-name">Breakfast</);
  assert.match(els['nutri-plan'].innerHTML, /<select class="gd-pick" data-guide="lunch\.p" aria-label="Protein example for Lunch">/);
  assert.doesNotMatch(els['nutri-plan'].innerHTML, /mp-pick|data-block|meal-addons/, 'no menu: no block selects, no add-ons card');
  assert.equal(els['nutri-fuel-block'].hidden, true);
  assert.deepEqual(calls, [['intake', 2500]], 'the rings are refreshed with today\'s target');
});

test('a long ride recorded today: bikeLong (auto) with its real minutes, the ride fuel block, the plan counts the fuel', () => {
  const { els, radios, api, calls } = run({ items: [{ modality: 'gym', dur: 50 }, { modality: 'bike', dur: 185 }] });
  assert.deepEqual(checkedOf(radios, 'd-'), ['bikeLong']);
  assert.match(els['nutri-why'].textContent, /Ride recorded today: 3 h 5 min/);
  assert.equal(els['nutri-fuel-block'].hidden, false);
  assert.match(els['nutri-ride-wrap'].innerHTML, /Ride duration: 3 h 5 min \(recorded\)/);
  assert.doesNotMatch(els['nutri-ride-wrap'].innerHTML, /<select/, 'a recorded ride is not re-picked');
  assert.match(els['nutri-fuel-body'].innerHTML, /60–90 g\/h/);
  assert.match(els['nutri-fuel-body'].innerHTML, /Not medical advice/);
  assert.match(els['nutri-fuel-body'].innerHTML, /70\.0 kg/);
  assert.match(els['nutri-fuel-body'].innerHTML, /185–280 g \(~230 g\) in total/);
  assert.match(els['nutri-target'].innerHTML, /Meals [\d,]+ kcal \+ ride fuel [\d,]+ kcal = [\d,]+ kcal/);
  assert.equal(api.state().rideMin, 185);
  const x = planFor(bake(), 'maintain', 'bikeLong', 185);
  assert.deepEqual(calls, [['intake', x.mt.k]], 'the rings get the meals target');
});

test('a programmed bike session: bike (auto), picker defaults to 2 h; picking 3 h re-scales the meals, fuel, rings', () => {
  const { els, fire, api, calls, storage } = run({ programmed: { kind: 'bike', focus: 'Ride', blocks: [] } });
  assert.equal(api.state().dayType, 'bike');
  assert.match(els['nutri-ride-wrap'].innerHTML, /<option value="120" selected>2 h<\/option>/);
  assert.match(els['nutri-fuel-body'].innerHTML, /120 g in total/);
  const two = planFor(bake(), 'maintain', 'bike', 120);
  const three = planFor(bake(), 'maintain', 'bike', 180);
  assert.match(els['nutri-target'].innerHTML, new RegExp('Meals ' + two.mt.k.toLocaleString('en') + ' kcal'));
  const targetBefore = els['nutri-target'].innerHTML;
  calls.length = 0;
  fire('nutri-ride-wrap', 'change', { id: 'nutri-ride', value: '180' });
  assert.equal(api.state().rideMin, 180);
  assert.match(els['nutri-fuel-body'].innerHTML, /180 g in total/);
  assert.match(els['nutri-target'].innerHTML, /ride fuel 720 kcal/);
  assert.match(els['nutri-target'].innerHTML, new RegExp('Meals ' + three.mt.k.toLocaleString('en') + ' kcal'));
  assert.ok(three.mt.k < two.mt.k, 'a longer ride leaves less for the meals');
  assert.ok(three.tot.k <= two.tot.k, 'the meals never grow (here every carb portion is already at its cap)');
  assert.notEqual(els['nutri-target'].innerHTML, targetBefore, 'the summary re-rendered for the new duration');
  assert.deepEqual(calls, [['intake', three.mt.k]]);
  assert.deepEqual(JSON.parse(storage.data['hc.nutri.rideMin']), { date: TODAY, type: 'bike', min: 180 });
});

test('the picked ride duration is kept for the day (and that day type) only; a recorded ride wins over it', () => {
  const programmed = { kind: 'bike' };
  const kept = run({ programmed, storage: memStorage({ 'hc.nutri.rideMin': JSON.stringify({ date: TODAY, type: 'bike', min: 240 }) }) });
  assert.equal(kept.api.state().rideMin, 240);
  assert.match(kept.els['nutri-ride-wrap'].innerHTML, /<option value="240" selected>4 h<\/option>/);
  const expired = run({ programmed, storage: memStorage({ 'hc.nutri.rideMin': JSON.stringify({ date: '2030-01-09', type: 'bike', min: 240 }) }) });
  assert.equal(expired.api.state().rideMin, 120, 'yesterday\'s pick expired at midnight');
  const otherType = run({ programmed, storage: memStorage({ 'hc.nutri.rideMin': JSON.stringify({ date: TODAY, type: 'bikeLong', min: 300 }) }) });
  assert.equal(otherType.api.state().rideMin, 120);
  const rec = run({ items: [{ modality: 'bike', dur: 100 }], storage: memStorage({ 'hc.nutri.rideMin': JSON.stringify({ date: TODAY, type: 'bike', min: 240 }) }) });
  assert.equal(rec.api.state().rideMin, 100, 'the recorded ride\'s real minutes');
  assert.equal(run({ programmed, storage: memStorage({ 'hc.nutri.rideMin': '{broken' }) }).api.state().rideMin, 120);
});

test('manual override: stored with its date, "(chosen)", back-to-auto button; picking the detected type clears it', () => {
  const s = run();
  s.fire('nutri-daytype', 'change', { name: 'nutri-day', value: 'gym' });
  assert.equal(s.api.state().dayType, 'gym');
  assert.equal(s.els['nutri-daytype-src'].textContent, '(chosen)');
  assert.equal(s.els['nutri-auto'].hidden, false);
  assert.match(s.els['nutri-auto'].textContent, /Use the detected one: Rest/);
  assert.deepEqual(JSON.parse(s.storage.data['hc.nutri.dayType']), { date: TODAY, type: 'gym', auto: 'rest' });
  assert.match(s.els['nutri-target'].innerHTML, /<b class="nt-kcal">3,050<\/b>/);
  assert.deepEqual(s.calls.map((c) => c[1]), [2500, 3050], 'the rings follow every day type change');
  s.els['nutri-auto']._listeners.click[0]();
  assert.equal(s.api.state().dayType, 'rest');
  assert.equal(s.storage.data['hc.nutri.dayType'], undefined);
  s.fire('nutri-daytype', 'change', { value: 'rest' });
  assert.equal(s.api.state().override, null);
});

test('a stored override from another day has expired; today\'s is honoured', () => {
  const old = run({ storage: memStorage({ 'hc.nutri.dayType': JSON.stringify({ date: '2030-01-09', type: 'bike' }) }) });
  assert.equal(old.api.state().dayType, 'rest');
  const fresh = run({ storage: memStorage({ 'hc.nutri.dayType': JSON.stringify({ date: TODAY, type: 'bike', auto: 'rest' }) }) });
  assert.equal(fresh.api.state().dayType, 'bike');
  assert.equal(fresh.els['nutri-daytype-src'].textContent, '(chosen)');
  assert.equal(fresh.els['nutri-note'].hidden, true);
});

test('override vs detection: a LESS demanding override is dropped when a harder day is detected later, with a note', () => {
  const storage = memStorage({ 'hc.nutri.dayType': JSON.stringify({ date: TODAY, type: 'gym', auto: 'rest' }) });
  const s = run({ items: [{ modality: 'bike', dur: 190 }], storage });
  assert.equal(s.api.state().dayType, 'bikeLong');
  assert.equal(s.api.state().override, null);
  assert.equal(s.storage.data['hc.nutri.dayType'], undefined, 'the stale override is cleared');
  assert.equal(s.els['nutri-note'].hidden, false);
  assert.equal(s.els['nutri-note'].textContent, 'Long ride detected: switched to Long ride.');
  assert.equal(s.els['nutri-daytype-src'].textContent, '(auto)');
  const es = run({ locale: 'es', items: [{ modality: 'bike', dur: 190 }], storage: memStorage({ 'hc.nutri.dayType': JSON.stringify({ date: TODAY, type: 'gym' }) }) });
  assert.equal(es.els['nutri-note'].textContent, 'Detectada salida larga: cambiado a Bici larga.', 'an override stored without the detected type is treated the same');
  // picking a type again hides the note
  s.fire('nutri-daytype', 'change', { value: 'bike' });
  assert.equal(s.els['nutri-note'].hidden, true);
});

test('override vs detection: a MORE demanding override (planning a ride) stays; so does a deliberate downgrade', () => {
  const plan = run({ items: [{ modality: 'gym', dur: 60 }], storage: memStorage({ 'hc.nutri.dayType': JSON.stringify({ date: TODAY, type: 'bikeLong', auto: 'rest' }) }) });
  assert.equal(plan.api.state().dayType, 'bikeLong');
  assert.equal(plan.els['nutri-note'].hidden, true);
  // picked rest although gym was already detected at the time: nothing new detected since, keep it
  const down = run({ items: [{ modality: 'gym', dur: 60 }], storage: memStorage({ 'hc.nutri.dayType': JSON.stringify({ date: TODAY, type: 'rest', auto: 'gym' }) }) });
  assert.equal(down.api.state().dayType, 'rest');
  assert.equal(down.els['nutri-note'].hidden, true);
});

test('override vs detection: yesterday\'s override has expired at midnight (no note)', () => {
  const s = run({ items: [{ modality: 'bike', dur: 190 }], storage: memStorage({ 'hc.nutri.dayType': JSON.stringify({ date: '2030-01-09', type: 'gym', auto: 'rest' }) }) });
  assert.equal(s.api.state().dayType, 'bikeLong');
  assert.equal(s.els['nutri-note'].hidden, true);
});

test('goal choice (HCNutri.setGoal, from the profile sheet) persists; an unknown stored goal or broken storage falls back to the plan default', () => {
  const s = run();
  assert.equal(s.api.setGoal('cut'), true);
  assert.equal(s.api.setGoal('shred'), false, 'an unknown goal is refused');
  assert.equal(s.storage.data['hc.nutri.goal'], 'cut');
  assert.match(s.els['nutri-target'].innerHTML, /<b class="nt-kcal">2,150<\/b>/);
  assert.equal(run({ storage: memStorage({ 'hc.nutri.goal': 'bulk' }) }).api.state().goal, 'bulk');
  assert.equal(run({ storage: memStorage({ 'hc.nutri.goal': 'shred', 'hc.nutri.dayType': '{broken' }) }).api.state().goal, 'maintain');
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const t = run({ storage: throwing });
  t.api.setGoal('bulk');
  assert.equal(t.api.state().goal, 'bulk', 'works without storage');
});

test('the orphaned hc.nutri.picks key (the removed choosable blocks) is cleared once on load; other keys stay', () => {
  const storage = memStorage({ 'hc.nutri.picks': '{"lunch":"x"}', 'hc.nutri.goal': 'cut', 'hc.nutri.guide': '{"picks":{}}' });
  const s = run({ storage });
  assert.equal('hc.nutri.picks' in storage.data, false);
  assert.equal(storage.data['hc.nutri.goal'], 'cut');
  assert.equal(storage.data['hc.nutri.guide'], '{"picks":{}}');
  assert.equal(s.api.state().goal, 'cut');
  // a storage whose removeItem throws: the page still renders
  const denied = { ...memStorage(), removeItem() { throw new Error('denied'); } };
  assert.match(run({ storage: denied }).els['nutri-plan'].innerHTML, /gd-meal/);
});

test('every goal x day type renders a target and a plan (all 12)', () => {
  const s = run();
  for (const g of ['maintain', 'cut', 'bulk']) for (const d of ['rest', 'gym', 'bike', 'bikeLong']) {
    s.api.setGoal(g);
    s.fire('nutri-daytype', 'change', { value: d });
    const t = s.els['nutri-target'].innerHTML + s.els['nutri-plan'].innerHTML;
    assert.doesNotMatch(t, /NaN|undefined|null|could not be shown/, `${g}/${d}`);
    assert.equal((s.els['nutri-plan'].innerHTML.match(/class="meal gd-meal"/g) || []).length, 3, `${g}/${d}: three main meals`);
    assert.match(s.els['nutri-plan'].innerHTML, /class="meal gd-extras"/);
  }
});

test('Inicio card: day type + goal and today\'s target kcal / macros', () => {
  const { els } = run({ items: [{ modality: 'run', dur: 45 }] });
  const h = els['eat-body'].innerHTML;
  assert.match(h, /Gym or run \(auto\) · Maintain/);
  assert.match(h, /~3,050<span>kcal/);
  assert.match(h, /<b>150 g<\/b><span>Protein/);
});

test('window.nutriTarget: today\'s target (goal x day type) for the rings; on bike days the MEALS target', () => {
  const { window } = run();
  const t = window.nutriTarget();
  assert.deepEqual([t.k, t.p, t.c, t.g, t.fatMax, t.fuelK, t.day, t.dayType], [2500, 150, 340, 60, 75, 0, 'rest', 'rest']);
  assert.match(t.label, /Today's target · Rest · Maintain/);
  const bike = run({ programmed: { kind: 'bike' } }).window.nutriTarget();
  const x = planFor(bake(), 'maintain', 'bike', 120);
  assert.deepEqual([bike.k, bike.c, bike.fuelK, bike.day], [x.t.kcal - x.fuelK, x.t.c - x.fuelC, x.fuelK, 'train']);
  assert.equal(bike.fuelK, 480);
  assert.match(bike.label, /Today's meals · Ride ~2 h · Maintain/);
});

// a past day for HCNutri.targetFor: the timeline bakes the last 3 data days
const YDAY = '2030-01-09';
const pastCtx = (days, training = {}) => ({ SCORES: { timeline: { asOf: TODAY, days } }, TRAINING: training });

test('HCNutri.targetFor(past day): THAT day\'s detected day type (its recorded ride minutes) with the current goal, not today\'s', () => {
  const s = run({ extra: pastCtx([{ date: YDAY, sleep: 7, items: [{ modality: 'bike', dur: 160 }] }, { date: TODAY, sleep: 7.5, items: [] }]) });
  assert.equal(s.window.nutriTarget().dayType, 'rest', 'today is a rest day');
  const t = s.api.targetFor(YDAY);
  const x = planFor(bake(), 'maintain', 'bikeLong', 160);
  assert.deepEqual([t.k, t.p, t.c, t.g, t.fatMax, t.fuelK, t.day, t.dayType], [x.t.kcal - x.fuelK, x.t.p, x.t.c - x.fuelC, x.t.f, x.t.f + 15, x.fuelK, 'train', 'bikeLong']);
  assert.match(t.label, /That day's meals · Long ride · Maintain/);
  s.api.setGoal('cut');
  assert.equal(s.api.targetFor(YDAY).k, planFor(bake(), 'cut', 'bikeLong', 160).mt.k, 'the goal is the current one');
  const es = run({ locale: 'es', extra: pastCtx([{ date: YDAY, sleep: 7, items: [{ modality: 'gym', dur: 50 }] }]) }).api.targetFor(YDAY);
  assert.equal(es.dayType, 'gym');
  assert.match(es.label, /^Objetivo de ese día · /);
});

test('HCNutri.targetFor: a day with only sleep is rest, a programmed-only day uses the program, today = nutriTarget()', () => {
  const s = run({ extra: pastCtx([{ date: YDAY, sleep: 7, items: [] }], { '2030-01-08': { kind: 'gym' } }) });
  assert.equal(s.api.targetFor(YDAY).dayType, 'rest');
  assert.equal(s.api.targetFor(YDAY).k, 2500);
  assert.equal(s.api.targetFor('2030-01-08').dayType, 'gym', 'no timeline row, but a programmed session');
  assert.deepEqual(plain(s.api.targetFor(TODAY)), plain(s.window.nutriTarget()));
});

test('dayInputFor port agrees with lib/nutrition/daytype.mjs on every shared case', () => {
  const { api } = run();
  for (const c of DAYINPUT_CASES) assert.deepEqual(plain(api.dayInputFor(c.date, c.data)), c.expect, c.date);
});

test('HCNutri.targetFor beyond the 3 timeline days: DETAIL.sessions give the day type, a sleep reading makes it a known rest day', () => {
  const DETAIL = {
    asOf: TODAY,
    metrics: { sleep: { kind: 'sleep', start: '2030-01-01', v: [7, 7, 7, null, 7, 7, 7, 7, 7, 7] } },
    sessions: [{ d: '2030-01-02', m: 'bike', min: 170, km: 62 }, { d: '2030-01-03', m: 'gym', min: 55 }, { d: '2030-01-04', m: 'other', min: 25 }],
  };
  const s = run({ extra: { ...pastCtx([{ date: TODAY, sleep: 7.5, items: [] }]), DETAIL } });
  const ride = s.api.targetFor('2030-01-02');
  assert.equal(ride.dayType, 'bikeLong');
  assert.equal(ride.k, planFor(bake(), 'maintain', 'bikeLong', 170).mt.k, 'its recorded minutes');
  assert.equal(s.api.targetFor('2030-01-03').dayType, 'gym');
  assert.equal(s.api.targetFor('2030-01-04').dayType, 'rest', 'no sleep reading, but a short walk was recorded: the Watch was worn, a rest day');
  assert.equal(run({ extra: { ...pastCtx([]), DETAIL: { ...DETAIL, sessions: [] } } }).api.targetFor('2030-01-04'), null, 'nothing recorded that day: unknown');
  assert.equal(s.api.targetFor('2030-01-05').dayType, 'rest', 'slept with the Watch, no session');
  assert.equal(s.api.targetFor('2030-01-05').inferred, true, 'an ASSUMED rest day');
  assert.equal(s.api.targetFor('2030-01-02').inferred, false);
  assert.equal(s.api.targetFor('2029-12-20'), null, 'before every series');
});

test('applyGoal (the server goal) is applied and cached without calling the settings API; setGoal also saves it there when the API answered', () => {
  const saved = [];
  const settings = { ready: () => true, saveGoal: (g) => { saved.push(g); return Promise.resolve(); } };
  const s = run({ hooks: { HCSettings: settings, intakeRefresh: () => {} } });
  assert.equal(s.api.applyGoal('cut'), true);
  assert.equal(s.api.state().goal, 'cut');
  assert.equal(s.storage.data['hc.nutri.goal'], 'cut', 'the local copy is the offline cache');
  assert.deepEqual(saved, [], 'a server goal is never sent back');
  assert.equal(s.api.applyGoal('shred'), false);
  s.api.setGoal('bulk');
  assert.deepEqual(saved, ['bulk']);
  // the API not ready (artifact, example build): local only, exactly as before
  const off = run({ hooks: { HCSettings: { ready: () => false, saveGoal: () => saved.push('x') }, intakeRefresh: () => {} } });
  off.api.setGoal('cut');
  assert.deepEqual(saved, ['bulk']);
  assert.equal(off.storage.data['hc.nutri.goal'], 'cut');
  // a throwing settings client never breaks the local goal
  const bad = run({ hooks: { HCSettings: { ready: () => true, saveGoal: () => { throw new Error('x'); } }, intakeRefresh: () => {} } });
  assert.equal(bad.api.setGoal('cut'), true);
  assert.equal(bad.api.state().goal, 'cut');
});

test('setGoal marks the goal pending until the server confirms it; a rejected save is caught (no unhandled rejection)', async () => {
  let unhandled = 0;
  const onUnhandled = () => { unhandled++; };
  process.on('unhandledRejection', onUnhandled);
  try {
    const s = run({ hooks: { HCSettings: { ready: () => true, saveGoal: () => Promise.reject({ code: 'offline' }) }, intakeRefresh: () => {} } });
    s.api.setGoal('cut');
    await new Promise((r) => setImmediate(r));
    assert.equal(unhandled, 0);
    assert.equal(s.storage.data['hc.nutri.goalPending'], 'cut');
    assert.equal(s.api.pendingGoal(), 'cut');
    s.api.clearPending('bulk');
    assert.equal(s.api.pendingGoal(), 'cut', 'only the confirmed goal clears it');
    s.api.clearPending('cut');
    assert.equal(s.api.pendingGoal(), null);
    assert.equal('hc.nutri.goalPending' in s.storage.data, false);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('storedGoal: the goal this viewer stored, else null (the plan default is not "stored")', () => {
  assert.equal(run().api.storedGoal(), null);
  assert.equal(run({ storage: memStorage({ 'hc.nutri.goal': 'bulk' }) }).api.storedGoal(), 'bulk');
  assert.equal(run({ storage: memStorage({ 'hc.nutri.goal': 'shred' }) }).api.storedGoal(), null);
});

test('a refresh (goal / day type change) re-renders Progreso and Constancia when they are loaded', () => {
  const renders = [];
  const s = run({ hooks: { intakeRefresh: () => {}, HCProgress: { render: () => renders.push('p') }, HCAdherence: { render: () => { renders.push('a'); throw new Error('boom'); } } } });
  renders.length = 0;
  s.api.setGoal('cut');
  assert.deepEqual(renders, ['p', 'a']);
  assert.equal(s.api.state().goal, 'cut', 'a throwing block never stops the refresh');
});

test('HCNutri.targetFor: unknown day type -> null (no timeline row, no programme), never a guess; a future or bad date -> null', () => {
  const s = run({ extra: pastCtx([{ date: TODAY, sleep: 7.5, items: [] }]) });
  assert.equal(s.api.targetFor(YDAY), null);
  assert.equal(s.api.targetFor('2030-01-11'), null, 'future');
  assert.equal(s.api.targetFor('2030-02-31'), null);
  assert.equal(s.api.targetFor(null), null);
});

test('HCNutri.targetFor: today\'s manual override and picked ride minutes never leak into a past day', () => {
  const storage = memStorage({
    'hc.nutri.dayType': JSON.stringify({ date: TODAY, type: 'bike', auto: 'rest' }),
    'hc.nutri.rideMin': JSON.stringify({ date: TODAY, type: 'bike', min: 300 }),
  });
  const s = run({ storage, extra: pastCtx([{ date: YDAY, sleep: 7, items: [] }, { date: TODAY, sleep: 7.5, items: [] }]) });
  assert.equal(s.window.nutriTarget().dayType, 'bike');
  assert.equal(s.api.targetFor(YDAY).dayType, 'rest');
  const r = run({ storage, extra: pastCtx([{ date: YDAY, sleep: 7, items: [{ modality: 'bike', dur: 90 }] }, { date: TODAY, sleep: 7.5, items: [] }]) });
  assert.equal(r.api.targetFor(YDAY).fuelK, planFor(bake(), 'maintain', 'bike', 90).fuelK, 'the recorded 90 min, not today\'s picked 300');
});

test('the removed day builder\'s hook is never called (a stale window.bldRefresh is ignored); a failing ring refresh says so', () => {
  const calls = [];
  const s = run({ hooks: { bldRefresh: () => calls.push('bld'), intakeRefresh: () => calls.push('intake') } });
  s.api.setGoal('cut');
  assert.deepEqual(calls, ['intake', 'intake']);
  assert.doesNotMatch(source, /bldRefresh|r-verdict/);
  const t = run({ hooks: { intakeRefresh: () => { throw new Error('x'); } } });
  assert.match(t.els.intake.innerHTML, /could not be shown/);
});

test('Spanish: labels, thousands with a dot, the guide localized', () => {
  const { els, api } = run({ locale: 'es', nutri: bake({ units: { g: 'g', ml: 'ml', ud: 'ud' }, dec: ',' }) });
  assert.match(els['nutri-target'].innerHTML, /<b class="nt-kcal">2\.500<\/b>/);
  assert.match(els['nutri-target'].innerHTML, /Proteína/);
  assert.match(els['nutri-plan'].innerHTML, /class="meal-name">Desayuno</);
  assert.match(els['nutri-plan'].innerHTML, /<span class="gd-l">Verdura<\/span><span class="gd-free">libre<\/span>/);
  assert.match(els['nutri-plan'].innerHTML, /aria-label="Ejemplo de Proteína para Comida"/);
  assert.match(els['nutri-plan'].innerHTML, /para extras hoy/);
  assert.match(els['nutri-plan'].innerHTML, /Incluye café, tentempiés y pre\/post-entreno\./);
  assert.equal(els['nutri-daytype-src'].textContent, '(auto)');
});

test('per-block isolation: a broken plan shows a one-line message there, the summary still renders', () => {
  const nutri = bake();
  nutri.base.rest = null;
  const { els } = run({ nutri });
  assert.match(els['nutri-plan'].innerHTML, /could not be shown|no meals/);
  assert.match(els['nutri-target'].innerHTML, /2,500/);
});

test('no rings script and no NUTRI: nothing throws', () => {
  assert.doesNotThrow(() => run({ hooks: false }));
  assert.doesNotThrow(() => run({ nutri: null }));
});

test('setGoal refreshes everything that reads the target at once: summary, chip, plan, Inicio card and rings (nutriTarget)', () => {
  const s = run();
  const plan0 = s.els['nutri-plan'].innerHTML;
  s.calls.length = 0;
  s.api.setGoal('cut');
  assert.equal(s.window.nutriTarget().k, 2150);
  assert.deepEqual(s.calls, [['intake', 2150]]);
  assert.match(s.els['nutri-target'].innerHTML, /<b class="nt-kcal">2,150<\/b>/);
  assert.match(s.els['nutri-target'].innerHTML, /id="nutri-goal-chip"[^>]*>Lose<\/button>/);
  assert.notEqual(s.els['nutri-plan'].innerHTML, plan0);
  assert.match(s.els['eat-body'].innerHTML, /· Lose/);
});

test('goal chip: low-emphasis button next to today\'s kcal, labelled for screen readers; the day line no longer repeats the goal', () => {
  const h = run().els['nutri-target'].innerHTML;
  assert.match(h, /<\/figure><button type="button" class="nt-goal" id="nutri-goal-chip" aria-haspopup="dialog" aria-label="Goal: Maintain. Change it in your profile">Maintain<\/button>/, 'the chip sits right under the kcal dial');
  assert.doesNotMatch(h, /nt-day|😴/, 'the day type is the segmented control, not repeated with an emoji');
  const es = run({ locale: 'es', nutri: bake({ units: { g: 'g', ml: 'ml', ud: 'ud' }, dec: ',' }) }).els['nutri-target'].innerHTML;
  assert.match(es, /<b class="nt-kcal">2\.500<\/b>[\s\S]*<button[^>]*aria-label="Objetivo: Mantener\. Cámbialo en tu perfil">Mantener<\/button>/);
});

test('goal chip: a tap opens the profile sheet focused on the goal setting; without the sheet it does nothing', () => {
  const opened = [];
  const s = run({ hooks: { HCDetail: { open: (...a) => opened.push(a) } } });
  const chip = { id: 'nutri-goal-chip', closest: (sel) => (sel === '#nutri-goal-chip' ? chip : null) };
  s.fire('nutri-target', 'click', chip);
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [['profile', null, { focus: '#pf-goal input:checked' }]]);
  s.fire('nutri-target', 'click', { closest: () => null });
  assert.equal(opened.length, 1, 'a tap elsewhere in the summary opens nothing');
  assert.doesNotThrow(() => run().fire('nutri-target', 'click', chip));
});

/* ---- visual summary: kcal dial + macro bars, fill only from intake logged TODAY ---- */
test('kcal dial: 270° track with the target centred; no intake today = empty track (no fill), bars show the target only', () => {
  const h = run().els['nutri-target'].innerHTML;
  assert.match(h, /<figure class="nt-dial" role="img" aria-label="Today's target: 2,500 kcal">/);
  assert.match(h, new RegExp('<path class="nt-dial-track" d="' + ARC + '"/>'));
  assert.doesNotMatch(h, /nt-dial-fill|nt-bar-fill/, 'nothing fills from the target');
  const bars = [...h.matchAll(/<span class="nt-bar-lbl">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(bars, ['Protein', 'Carbs', 'Fat'], 'order: protein, carbs, fat');
  // yesterday's log does not fill today's dial
  const y = run({ intake: { latest: { date: '2030-01-09', k: 1800, p: 100, c: 200, g: 50 }, freshDays: 3 } }).els['nutri-target'].innerHTML;
  assert.doesNotMatch(y, /nt-dial-fill|nt-bar-fill/);
});

test('kcal dial + bars fill from intake logged today (logged / target), a missing macro stays empty, > 110 % is flagged', () => {
  const h = run({ intake: { latest: { date: TODAY, k: 1250, p: 75, c: 400, g: null }, freshDays: 3 } }).els['nutri-target'].innerHTML;
  assert.match(h, /aria-label="Logged today: 1,250 of 2,500 kcal"/);
  assert.match(h, new RegExp('<path class="nt-dial-fill" pathLength="100" stroke-dasharray="50 100" d="' + ARC + '"/>'));
  assert.match(h, /<span class="nt-logged"><b>1,250<\/b> logged<\/span>/);
  assert.match(h, /<span class="nt-bar-lbl">Protein<\/span><span class="nt-bar-val"><b>75<\/b> \/ 150 g<\/span><\/div><div class="nt-bar-track"><span class="nt-bar-fill" style="width:50%"><\/span>/);
  assert.match(h, /<div class="nt-bar nt-bar-over">[\s\S]*?Carbs[\s\S]*?style="width:100%"/, 'carbs 400 / 340 is over 110 %: capped bar, flagged');
  assert.match(h, /<span class="nt-bar-lbl">Fat<\/span><span class="nt-bar-val"><b>—<\/b> \/ 60 g<\/span><\/div><div class="nt-bar-track"><\/div>/, 'no fat logged: an empty bar with a dash');
  assert.match(h, /Logged today so far/);
});

test('the page food log (window.foodTotals) fills the dial + bars first, labelled as logged here; an Apple Health day is the fallback', () => {
  const food = { date: TODAY, k: 1000, p: 60, c: 120, g: 30, n: 3, missing: { protein: false, carbs: false, fat: false }, src: 'log' };
  const intake = { latest: { date: TODAY, k: 1800, p: 100, c: 200, g: 50 }, freshDays: 3 };
  const h = run({ intake, hooks: { foodTotals: () => food } }).els['nutri-target'].innerHTML;
  assert.match(h, /aria-label="Logged today: 1,000 of 2,500 kcal"/);
  assert.match(h, /stroke-dasharray="40 100"/);
  assert.ok(h.includes(enN.target.loggedFoodNote));
  assert.doesNotMatch(h, /what your food app wrote/);
  const miss = run({ hooks: { foodTotals: () => ({ ...food, missing: { protein: true, carbs: false, fat: true } }) } }).els['nutri-target'].innerHTML;
  assert.ok(miss.includes(enN.target.loggedFoodMissing));
  // no entries today (null) or a throwing hook: the Apple Health intake as before (foodTotals already
  // returns null for any day but today, so nutri-day.js does not re-check the date)
  for (const foodTotals of [() => null, () => { throw new Error('x'); }]) {
    const f = run({ intake, hooks: { foodTotals } }).els['nutri-target'].innerHTML;
    assert.match(f, /aria-label="Logged today: 1,800 of 2,500 kcal"/);
    assert.match(f, /what your food app wrote/);
  }
});

test('food log macros: none stated -> a dash, never "0 / 150 g"; some entries lack one -> the logged sum marked as a minimum', () => {
  const base = { date: TODAY, k: 350, n: 2, src: 'log' };
  const none = run({ hooks: { foodTotals: () => ({ ...base, p: null, c: null, g: null, missing: { protein: true, carbs: true, fat: true } }) } }).els['nutri-target'].innerHTML;
  assert.match(none, /<span class="nt-bar-lbl">Protein<\/span><span class="nt-bar-val"><b>—<\/b> \/ 150 g<\/span><\/div><div class="nt-bar-track"><\/div>/);
  assert.doesNotMatch(none, /<b>0<\/b> \/ 150/);
  const some = run({ hooks: { foodTotals: () => ({ ...base, p: 40, c: 30, g: 10, missing: { protein: true, carbs: false, fat: false } }) } }).els['nutri-target'].innerHTML;
  assert.match(some, /<span class="nt-bar-lbl">Protein<\/span><span class="nt-bar-val"><b>≥ 40<\/b> \/ 150 g<\/span>/);
  assert.match(some, /<span class="nt-bar-lbl">Carbs<\/span><span class="nt-bar-val"><b>30<\/b>/, 'a complete macro has no marker');
});

test('HCNutri.refresh re-renders Resumen de hoy (the food log calls it after every add / delete)', () => {
  let food = null;
  const calls = [];
  const s = run({ hooks: { foodTotals: () => food, intakeRefresh: () => calls.push('intake') } });
  assert.doesNotMatch(s.els['nutri-target'].innerHTML, /nt-dial-fill/);
  food = { date: TODAY, k: 500, p: 10, c: 10, g: 10, n: 1, missing: { protein: false, carbs: false, fat: false }, src: 'log' };
  calls.length = 0;
  s.api.refresh();
  assert.match(s.els['nutri-target'].innerHTML, /nt-dial-fill/);
  assert.deepEqual(calls, ['intake'], 'the rings follow');
});

test('day type segments: the detected type carries the subtle "auto" mark', () => {
  const s = run({ items: [{ modality: 'gym', dur: 60 }] });
  assert.equal(s.labels.gym.classes.has('seg-auto'), true);
  assert.equal(s.labels.rest.classes.has('seg-auto'), false);
  s.fire('nutri-daytype', 'change', { value: 'bike' });
  assert.equal(s.labels.gym.classes.has('seg-auto'), true, 'the mark stays on the DETECTED type after an override');
});

test('Plan de hoy: meal header = caps name + big kcal, P / C / F mini line with localised letters', () => {
  const h = run().els['nutri-plan'].innerHTML;
  assert.match(h, /<div class="meal-top"><div class="meal-name">Breakfast<\/div><div class="meal-kcal"><b>[\d,]+<\/b> kcal<\/div><\/div>/);
  assert.match(h, /<div class="meal-pcf"><span><b>\d+<\/b> P<\/span><span><b>\d+<\/b> C<\/span><span><b>\d+<\/b> F<\/span><\/div>/);
  const es = run({ locale: 'es', nutri: bake({ units: { g: 'g', ml: 'ml', ud: 'ud' }, dec: ',' }) }).els['nutri-plan'].innerHTML;
  assert.match(es, /<span><b>\d+<\/b> G<\/span><\/div>/, 'G = grasa in Spanish');
});

test('Avituallamiento: a 3-step timeline (before, during, after) with one key number each', () => {
  const h = run({ programmed: { kind: 'bike' } }).els['nutri-fuel-body'].innerHTML;
  const steps = [...h.matchAll(/<li class="fuel-step[^"]*"><div class="fuel-step-head"><h3>([^<]+)<\/h3><b class="fuel-key">([^<]+)<\/b>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(steps.map((x) => x[0]), ['Before', 'During', 'After']);
  assert.deepEqual(steps.map((x) => x[1]), ['70–140 g', '60 g/h', '70–85 g'], 'carbs before (70 kg), carbs per hour, carbs after');
  assert.match(h, /<ol class="fuel-steps">/);
});

test('waterFill port agrees with lib/nutrition/fill.mjs over FILL_CASES (with and without the clamp)', () => {
  const { api } = run();
  for (const c of FILL_CASES) assert.deepEqual(plain(api.waterFill(c.items, c.need, c.opts)), plain(waterFill(c.items, c.need, c.opts)), JSON.stringify(c));
});

/* ---------- Plan de hoy collapsed by default (native <details>), open state per viewer ---------- */
test('Plan de hoy is collapsed by default; its summary shows the plan total kcal; the open state is remembered', () => {
  const nutri = bake();
  const storage = memStorage();
  const s = run({ nutri, storage });
  const fold = s.els['nutri-plan-fold'];
  assert.equal(fold.open, false, 'collapsed by default');
  const x = planFor(nutri, 'maintain', 'rest', null);
  assert.equal(s.els['nutri-plan-kcal'].textContent, x.mt.k.toLocaleString('en') + ' kcal', 'the guide adds up to the meals target');
  assert.match(s.els['nutri-plan'].innerHTML, /class="meal-name">Breakfast/, 'rendered even while collapsed');
  fold.open = true;
  fold._listeners.toggle.forEach((fn) => fn({ target: fold }));
  assert.equal(storage.data['hc.nutri.planOpen'], '1');
  const again = run({ nutri, storage });
  assert.equal(again.els['nutri-plan-fold'].open, true, 'reopened for this viewer');
  fold.open = false;
  fold._listeners.toggle.forEach((fn) => fn({ target: fold }));
  assert.equal(storage.data['hc.nutri.planOpen'], '0');
  assert.equal(run({ nutri, storage }).els['nutri-plan-fold'].open, false);
  // the summary follows the day type
  s.fire('nutri-daytype', 'change', { value: 'gym' });
  assert.equal(s.els['nutri-plan-kcal'].textContent, planFor(nutri, 'maintain', 'gym', null).mt.k.toLocaleString('en') + ' kcal');
  // storage that throws: still collapsed, toggling never throws
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const t = run({ nutri, storage: throwing });
  assert.equal(t.els['nutri-plan-fold'].open, false);
  t.els['nutri-plan-fold'].open = true;
  assert.doesNotThrow(() => t.els['nutri-plan-fold']._listeners.toggle.forEach((fn) => fn({ target: t.els['nutri-plan-fold'] })));
});

/* ---------- Plan de hoy = the portion guide (lib/nutrition/guide.mjs, ported) ---------- */
// planFor totals of the example plan [kcal, P, C, F, factor, remainder], re-pinned DELIBERATELY when the
// portion guide replaced the menu: the automatic snack is gone, so a capped day's remainder is no longer
// filled by a snack — the guide hands it to Extras (the guide's four meal groups add up to the meals target)
const PINNED_TOTALS = {
  'maintain/rest': [2401, 139, 369, 44, 1.67, 99], 'maintain/gym': [2605, 150, 388, 52, 1.67, 445], 'maintain/bike': [2605, 150, 388, 52, 1.67, 465], 'maintain/bikeLong': [2605, 150, 388, 52, 1.67, 535],
  'cut/rest': [2150, 136, 308, 44, 1.19, 0], 'cut/gym': [2605, 150, 388, 52, 1.67, 95], 'cut/bike': [2605, 150, 388, 52, 1.67, 465], 'cut/bikeLong': [2605, 150, 388, 52, 1.67, 535],
  'bulk/rest': [2401, 139, 369, 44, 1.67, 399], 'bulk/gym': [2605, 150, 388, 52, 1.67, 745], 'bulk/bike': [2605, 150, 388, 52, 1.67, 765], 'bulk/bikeLong': [2605, 150, 388, 52, 1.67, 835],
};
const cardsOf = (html) => [...html.matchAll(/<div class="meal (gd-meal|gd-extras)"[^>]*><div class="meal-top"><div class="meal-name">([^<]+)<\/div><div class="meal-kcal"><b>([\d,.]+)<\/b> kcal<\/div><\/div>/g)]
  .map((m) => ({ kind: m[1], name: m[2], kcal: Number(m[3].replace(/[,.]/g, '')) }));
const sectionOf = (html, name) => html.split('<div class="meal-name">' + name + '<')[1].split('<div class="meal ')[0];
const selectedOf = (html, key) => {
  const sel = html.split('data-guide="' + key + '"')[1].split('</select>')[0];
  return (sel.match(/<option value="([^"]+)" selected>/) || [])[1];
};
const GRID = { ud: 100, grid: 0.5, step: 5 };

test('planFor totals (lib and the page port) equal the pinned ones; the guide\'s four meal groups add up to the meals target', () => {
  const nutri = bake();
  const s = run({ nutri });
  for (const [key, want] of Object.entries(PINNED_TOTALS)) {
    const [g, d] = key.split('/');
    for (const x of [planFor(nutri, g, d, null), s.api.planFor(nutri, g, d, null)]) assert.deepEqual([x.tot.k, x.tot.p, x.tot.c, x.tot.g, x.factor, x.rem], want, key);
    s.api.setGoal(g);
    s.fire('nutri-daytype', 'change', { value: d });
    const x = planFor(nutri, g, d, s.api.state().rideMin);
    const cards = cardsOf(s.els['nutri-plan'].innerHTML);
    assert.deepEqual(cards.map((c) => c.name), ['Breakfast', 'Lunch', 'Dinner', 'Extras'], `${key}: always the same four meal groups`);
    const b = guideBudgets(x, nutri.base[x.base].sl, MAIN_SLOTS, nutri.guide.oil[x.base]);
    if (!b.clamped || b.extras.k > 0) assert.equal(cards.reduce((a, c) => a + c.kcal, 0), x.mt.k, `${key}: the guide = the meals target`);
  }
});

test('guide ports agree with lib: guideBudgets (every goal x day type x ride), remaining / mealState / isCovered', () => {
  const nutri = bake();
  const { api } = run({ nutri });
  for (const g of ['maintain', 'cut', 'bulk']) for (const d of ['rest', 'gym', 'bike', 'bikeLong']) for (const min of [null, 60, 185, 360]) {
    const x = planFor(nutri, g, d, min);
    const sl = nutri.base[x.base].sl;
    const oil = nutri.guide.oil[x.base];
    assert.deepEqual(plain(api.guideBudgets(x, sl, MAIN_SLOTS, oil)), plain(guideBudgets(x, sl, MAIN_SLOTS, oil)), `${g}/${d}/${min}`);
  }
  // the cooking-oil split: both of lunch / dinner, only one, neither, no oil list
  const mt = { k: 2500, p: 150, c: 280, f: 65 };
  for (const [rows, slots, oil] of [
    [[[500, 30, 60, 12], [800, 50, 90, 20], [700, 45, 80, 18], [91, 0, 0, 11], [20, 1, 2, 1]], ['breakfast', 'lunch', 'dinner', null, null], [3]],
    [[[800, 50, 90, 20], [90, 0, 0, 10]], ['lunch', null], [1]],
    [[[700, 50, 90, 20], [90, 0, 0, 10]], ['dinner', null], [1]],
    [[[500, 30, 60, 12], [90, 0, 0, 10]], ['breakfast', null], [1]],
    [[[500, 30, 60, 12], [90, 0, 0, 10]], ['lunch', null], undefined],
  ]) assert.deepEqual(plain(api.guideBudgets({ meals: rows, mt }, slots, MAIN_SLOTS, oil)), plain(guideBudgets({ meals: rows, mt }, slots, MAIN_SLOTS, oil)), JSON.stringify(slots));
  const b = { k: 800, p: 50, c: 90, f: 20 };
  for (const k of [0, 50, 300, 719, 720, 900]) for (const p of [null, 0, 20, 46, 60]) {
    const logged = { k, p, c: 40, f: null };
    assert.deepEqual(plain(api.remaining(b, logged)), plain(remaining(b, logged)));
    assert.equal(api.mealState(b, logged), mealState(b, logged));
    assert.equal(api.isCovered(50 - (p || 0), 50), isCovered(50 - (p || 0), 50));
  }
  assert.equal(api.mealState(b, null), null);
  assert.deepEqual(plain(api.remaining(b, null)), plain(remaining(b, null)));
});

test('floorToStep / GRID_EPS port agrees with lib/nutrition/amounts.mjs; no inline epsilon left in the page', () => {
  const { api } = run();
  assert.equal(api.GRID_EPS, GRID_EPS);
  for (const [cap, st] of [[152, 5], [150, 5], [250, 60], [0.9, 0.3], [3, 5], [300, 100], [135, 22.5]]) assert.equal(api.floorToStep(cap, st), floorToStep(cap, st), `${cap}/${st}`);
  assert.doesNotMatch(source, /Math\.floor\(cap \/ st \+ 1e-9\)/);
});

test('exampleAmount port agrees with lib over GUIDE_CASES and every basic x role x grams (both locales)', () => {
  const { api } = run();
  assert.deepEqual(GUIDE_GRID, GRID);
  for (const c of GUIDE_CASES) assert.deepEqual(plain(api.exampleAmount(c.food, c.role, c.g, GRID)), plain(exampleAmount(c.food, c.role, c.g, GRID)), JSON.stringify(c));
  let capped = 0;
  for (const lang of ['en', 'es']) for (const food of buildBasics(ING, lang)) for (const role of ['p', 'c', 'f']) for (const g of [0, 1, 7.5, 12, 30, 45, 80, 161, 400]) {
    const lib = exampleAmount(food, role, g, GRID);
    if (lib && lib.capped) capped++;
    assert.deepEqual(plain(api.exampleAmount(food, role, g, GRID)), plain(lib), `${food.k}/${role}/${g}`);
  }
  assert.ok(capped > 20, `the sweep reaches portion caps (${capped})`);
});

test('roleOptions port agrees with lib (basics + the owner\'s products, both locales)', () => {
  const { api } = run();
  const prods = [
    { id: 3, name: 'Ñoquis frescos', unit: 'g', per100: { kcal: 160, protein: 4, carbs: 33, fat: 1 } },
    { id: 12, name: 'Atún claro', unit: 'g', per100: { kcal: 110, protein: 25, carbs: 0, fat: 1 } },
    { id: 4, name: 'Aceite', unit: 'ml', per100: { kcal: 820, protein: 0, carbs: 0, fat: 91 } },
    { id: 5, name: 'Raro', unit: 'serving', per100: { kcal: 100, protein: 5, carbs: 5, fat: 5 } },
    { id: 6, name: 'Sin kcal', unit: 'g', per100: { kcal: null, protein: 5, carbs: 5, fat: 5 } },
  ];
  for (const lang of ['en', 'es']) for (const role of ['p', 'c', 'f']) for (const p of [null, [], prods]) {
    assert.deepEqual(plain(api.roleOptions(BASICS[lang], p, role)), plain(roleOptions(BASICS[lang], p, role)), `${lang}/${role}`);
  }
});

test('rest day: Breakfast, Lunch, Dinner as plates by parts (protein / carbs / vegetables free / fat) with the plan\'s own example foods, then Extras', () => {
  const nutri = bake();
  const h = run({ nutri }).els['nutri-plan'].innerHTML;
  const x = planFor(nutri, 'maintain', 'rest', null);
  const b = guideBudgets(x, nutri.base.rest.sl, MAIN_SLOTS, nutri.guide.oil.rest);
  const lunch = sectionOf(h, 'Lunch');
  assert.deepEqual([...lunch.matchAll(/<span class="gd-l">([^<]+)<\/span>/g)].map((m) => m[1]), ['Protein', 'Carbs', 'Vegetables', 'Fat']);
  assert.match(lunch, new RegExp('<span class="gd-l">Protein</span><span class="gd-g"><b>~' + b.meals.lunch.p + '</b> g</span>'));
  assert.match(lunch, /<span class="gd-l">Vegetables<\/span><span class="gd-free">free<\/span>/);
  assert.equal(selectedOf(h, 'lunch.p'), 'b:pollo', 'the plan\'s lunch protein');
  assert.equal(selectedOf(h, 'lunch.c'), 'b:arroz');
  assert.equal(selectedOf(h, 'lunch.f'), 'b:aceiteoliva', 'no fat food at lunch: the fallback');
  assert.equal(selectedOf(h, 'dinner.f'), 'b:avellanas', 'the hazelnuts of the dinner dessert');
  const pollo = BASICS.en.find((f) => f.k === 'pollo');
  const a = exampleAmount(pollo, 'p', b.meals.lunch.p, GRID);
  assert.match(lunch, new RegExp('<span class="gd-amt">~' + a.amt + ' g</span>'));
  // the rice for the lunch carbs is past its 150 g maximum: said so, and where the rest comes from
  assert.match(lunch, /<span class="gd-amt">~150 g <span class="gd-max">\(max\.\)<\/span><\/span>/);
  assert.match(lunch, /<p class="gd-more">\+ top up with another source<\/p>/);
  // a countable example shows pieces with the grams reference; oil per tablespoon
  assert.match(sectionOf(h, 'Breakfast'), /<span class="gd-amt">\d½? bread rolls \(~[\d.]+ g\)<\/span>/);
  const extras = sectionOf(h, 'Extras');
  assert.match(extras, new RegExp('<p class="gd-budget">~' + b.extras.k + ' kcal for extras today</p>'));
  assert.match(extras, /For example: a cortado ~19 kcal · a banana ~106 kcal · a yogurt ~79 kcal · a protein shake \(30 g\) ~114 kcal\./);
  assert.match(extras, /<p class="gd-hint">Covers coffee, snacks and pre \/ post-workout\.<\/p>/, 'what Extras holds');
  // the plan's cooking oil counts in lunch and dinner, not in Extras
  const noOil = guideBudgets(x, nutri.base.rest.sl, MAIN_SLOTS);
  assert.ok(b.meals.lunch.f > noOil.meals.lunch.f && b.meals.dinner.f > noOil.meals.dinner.f, 'half the oil in each');
  assert.equal(b.meals.lunch.f + b.meals.dinner.f + b.extras.f, noOil.meals.lunch.f + noOil.meals.dinner.f + noOil.extras.f);
  assert.doesNotMatch(extras, /Split it before and after training/, 'rest day: nothing to split around');
  assert.doesNotMatch(h, /<select[^>]*class="gd-pick"[^>]*>[^]*?<\/select>[^]*?gd-add/, 'no "+" without the food log');
  assert.doesNotMatch(h, /gd-left|Left today/);
  assert.match(h, /Orientative: each example covers its macro only/);
});

test('gym day: the same four meal groups, bigger amounts where the plan grows, and Extras says to split it around training', () => {
  const s = run({ items: [{ modality: 'gym', dur: 60 }] });
  const h = s.els['nutri-plan'].innerHTML;
  assert.deepEqual(cardsOf(h).map((c) => c.name), ['Breakfast', 'Lunch', 'Dinner', 'Extras']);
  assert.match(sectionOf(h, 'Extras'), /Split it before and after training\./);
  assert.equal(selectedOf(h, 'breakfast.f'), 'b:aceiteoliva', 'no fat food at the gym-day breakfast: the fallback');
  assert.match(sectionOf(h, 'Breakfast'), /<span class="gd-amt">\d½? tablespoons? \(~\d+ g\)<\/span>/, 'oil per tablespoon');
  assert.doesNotMatch(h, /Post-workout<\/div>|Cooking oil/, 'no add-on rows: their kcal are in the Extras budget');
});

test('supplements: under the main meal of their slot; any other slot under Extras with its slot name', () => {
  const h = run().els['nutri-plan'].innerHTML;
  assert.match(sectionOf(h, 'Lunch'), /<div class="meal-supp"><svg class="supp-ico"[^>]*aria-hidden="true">.*?<\/svg><span>Demo Creatine 3 g<\/span><\/div>/);
  assert.match(sectionOf(h, 'Extras'), /<span>Demo Electrolytes \(Pre-workout\)<\/span>/);
  assert.doesNotMatch(h, /💊/, 'no emoji');
});

test('a macro the main meals already pass leaves no Extras margin and says so (never a negative budget)', () => {
  const s = run();
  s.api.setGoal('cut');
  const h = s.els['nutri-plan'].innerHTML;
  assert.match(sectionOf(h, 'Extras'), /The main meals already cover some macro/);
  assert.doesNotMatch(h, />-\d/);
});

test('picking an example: a native select per macro row; the pick persists per viewer (not daily) and recomputes the amount', () => {
  const storage = memStorage();
  let focused = null;
  const s = run({ storage, query: (sel) => ({ focus: () => { focused = sel; } }) });
  s.fire('nutri-plan', 'change', { getAttribute: (n) => (n === 'data-guide' ? 'lunch.p' : null), value: 'b:huevo' });
  assert.deepEqual(JSON.parse(storage.data['hc.nutri.guide']), { picks: { 'lunch.p': 'b:huevo' } });
  assert.equal(focused, 'select[data-guide="lunch.p"]', 'focus back on that select');
  const h = s.els['nutri-plan'].innerHTML;
  assert.equal(selectedOf(h, 'lunch.p'), 'b:huevo');
  assert.match(sectionOf(h, 'Lunch'), /<span class="gd-amt">\d+ eggs \(~\d+ g\)<\/span>/, 'eggs in pieces with the grams reference');
  // kept on another day (a preference), ignored when unknown; storage failures never break the page
  assert.equal(selectedOf(run({ storage }).els['nutri-plan'].innerHTML, 'lunch.p'), 'b:huevo');
  assert.equal(s.api.setGuidePick('lunch.x', 'b:pollo'), false);
  assert.equal(s.api.setGuidePick('snack.p', 'b:pollo'), false);
  assert.equal(s.api.setGuidePick('lunch.p', 'pollo'), false);
  const stale = run({ storage: memStorage({ 'hc.nutri.guide': JSON.stringify({ picks: { 'lunch.p': 'b:gone', 'dinner.c': 7 } }) }) });
  assert.equal(selectedOf(stale.els['nutri-plan'].innerHTML, 'lunch.p'), 'b:pollo', 'an unknown pick falls back to the default');
  assert.equal(selectedOf(run({ storage: memStorage({ 'hc.nutri.guide': '{broken' }) }).els['nutri-plan'].innerHTML, 'lunch.p'), 'b:pollo');
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const t = run({ storage: throwing });
  assert.equal(t.api.setGuidePick('lunch.p', 'b:atun'), true);
  assert.equal(selectedOf(t.els['nutri-plan'].innerHTML, 'lunch.p'), 'b:atun');
  // every option of the role: log-only basics too, sorted by name
  const opts = [...h.split('data-guide="lunch.p"')[1].split('</select>')[0].matchAll(/value="b:([^"]+)"/g)].map((m) => m[1]);
  assert.ok(opts.includes('jamoncocido') && opts.includes('pollo') && !opts.includes('arroz'));
});

// the food log's hooks (client/food.js) as the guide reads them
function foodHooks({ groups, products = [], adds = [] } = {}) {
  return {
    HCFood: {
      groupTotals: () => groups,
      products: () => products,
      addGuide: (o) => { adds.push(o); return { then: (ok, fail) => (o.fail ? fail && fail(new Error('x')) : ok && ok()) }; },
    },
    intakeRefresh: () => {},
  };
}
const Z = { k: 0, p: 0, c: 0, f: 0 };

test('with the food log: each meal shows what is left (done / so far), covered rows, Extras left and "Left today"', () => {
  const nutri = bake();
  const x = planFor(nutri, 'maintain', 'rest', null);
  const b = guideBudgets(x, nutri.base.rest.sl, MAIN_SLOTS, nutri.guide.oil.rest);
  const groups = {
    meals: { breakfast: { k: Math.ceil(b.meals.breakfast.k * 0.95), p: b.meals.breakfast.p, c: 10, f: 2 }, lunch: { k: 300, p: 20, c: 30, f: 1 }, dinner: Z },
    addon: { k: 100, p: 5, c: 10, f: 3 },
  };
  const h = run({ nutri, hooks: foodHooks({ groups }) }).els['nutri-plan'].innerHTML;
  const bf = sectionOf(h, 'Breakfast');
  assert.match(bf, new RegExp('<p class="gd-state gd-state-done">✓ ' + groups.meals.breakfast.k + ' kcal logged</p>'));
  assert.match(bf, /<li class="gd-row gd-done"><div class="gd-top"><span class="gd-l">Protein<\/span><span class="gd-ok">✓ covered<\/span>/);
  const lunch = sectionOf(h, 'Lunch');
  assert.match(lunch, /<p class="gd-state">so far: 300 kcal<\/p>/);
  assert.match(lunch, new RegExp('<b>~' + (b.meals.lunch.p - 20) + '</b> g <span class="gd-of">of ' + b.meals.lunch.p + ' g</span>'));
  const pollo = BASICS.en.find((f) => f.k === 'pollo');
  const a = exampleAmount(pollo, 'p', b.meals.lunch.p - 20, GRID);
  assert.match(lunch, new RegExp('<button type="button" class="gd-add" data-guide-add="lunch.p" data-food="b:pollo" data-amt="' + a.amt + '" data-meal="lunch" aria-label="Log ' + a.amt + ' g of Chicken breast in Lunch">\\+</button>'));
  assert.doesNotMatch(sectionOf(h, 'Dinner'), /gd-state|gd-of/, 'nothing logged there: no state line, what is left is the budget');
  assert.match(sectionOf(h, 'Dinner'), /class="gd-add"/, 'but its examples can be logged');
  assert.match(sectionOf(h, 'Extras'), new RegExp('~' + (b.extras.k - 100) + ' kcal for extras today \\(of ' + b.extras.k + '\\)'));
  const all = groups.meals.breakfast.k + 300 + 100;
  assert.match(h, new RegExp('<p class="gd-left"><span class="gd-left-lbl">Left today</span> <b>' + (x.mt.k - all).toLocaleString('en') + '</b> kcal'));
});

test('"+" logs the example amount into that meal through the food log (HCFood.addGuide); a failure re-enables it', () => {
  const adds = [];
  const s = run({ hooks: foodHooks({ groups: { meals: { breakfast: Z, lunch: Z, dinner: Z }, addon: Z }, adds }) });
  const attrs = { 'data-guide-add': 'lunch.p', 'data-food': 'b:pollo', 'data-amt': '195', 'data-meal': 'lunch' };
  const btn = { disabled: false, getAttribute: (n) => attrs[n] };
  s.fire('nutri-plan', 'click', { closest: (sel) => (sel === '[data-guide-add]' ? btn : null) });
  assert.deepEqual(plain(adds), [{ group: 'lunch', food: 'b:pollo', amt: 195 }]);
  assert.equal(btn.disabled, true, 'busy until the food log re-renders the guide');
  attrs['data-food'] = 'b:arroz';
  const btn2 = { disabled: false, getAttribute: (n) => (n === 'data-food' ? 'b:arroz' : attrs[n]) };
  const failing = run({ hooks: { ...foodHooks({ groups: { meals: { breakfast: Z, lunch: Z, dinner: Z }, addon: Z } }), HCFood: { groupTotals: () => null, products: () => null, addGuide: () => ({ then: (ok, fail) => fail(new Error('offline')) }) } } });
  failing.fire('nutri-plan', 'click', { closest: () => btn2 });
  assert.equal(btn2.disabled, false);
  // a tap elsewhere or with no food log: nothing
  assert.doesNotThrow(() => run().fire('nutri-plan', 'click', { closest: () => btn2 }));
});

test('the owner\'s products (food API, view time) join the selects as "My products"; a product pick falls back when they are not there', () => {
  const products = [{ id: 12, name: 'Atún claro Demo', unit: 'g', per100: { kcal: 110, protein: 25, carbs: 0, fat: 1 } }];
  const groups = { meals: { breakfast: Z, lunch: Z, dinner: Z }, addon: Z };
  const storage = memStorage({ 'hc.nutri.guide': JSON.stringify({ picks: { 'lunch.p': 'p:12' } }) });
  const h = run({ storage, hooks: foodHooks({ groups, products }) }).els['nutri-plan'].innerHTML;
  const sel = h.split('data-guide="lunch.p"')[1].split('</select>')[0];
  assert.match(sel, /<optgroup label="Basics">[^]*<\/optgroup><optgroup label="My products"><option value="p:12" selected>Atún claro Demo<\/option><\/optgroup>/);
  assert.match(sectionOf(h, 'Lunch'), /data-food="p:12"/);
  const off = run({ storage }).els['nutri-plan'].innerHTML;
  assert.equal(selectedOf(off, 'lunch.p'), 'b:pollo', 'no food API: the default example, the pick is kept for later');
  assert.equal(JSON.parse(storage.data['hc.nutri.guide']).picks['lunch.p'], 'p:12');
});

test('the guide re-renders on HCNutri.refresh (the food log calls it after every add / delete)', () => {
  let groups = null;
  const s = run({ hooks: { HCFood: { groupTotals: () => groups, products: () => [], addGuide: () => null }, intakeRefresh: () => {} } });
  assert.doesNotMatch(s.els['nutri-plan'].innerHTML, /gd-add/);
  groups = { meals: { breakfast: Z, lunch: { k: 200, p: 10, c: 10, f: 1 }, dinner: Z }, addon: Z };
  s.api.refresh();
  assert.match(s.els['nutri-plan'].innerHTML, /so far: 200 kcal/);
  assert.match(s.els['nutri-plan'].innerHTML, /gd-add/);
});

test('the page mirrors lib: the model line layout (LINE) and the main slots the guide budgets', () => {
  const { api } = run();
  assert.deepEqual(plain(api.LINE), { ...LINE }, 'the page mirrors the line layout');
  assert.deepEqual(bake().mainSlots, MAIN_SLOTS);
});

test('no food table baked (FOOD_BASICS absent): the budgets still show, no example select', () => {
  const h = run({ basics: null }).els['nutri-plan'].innerHTML;
  assert.deepEqual(cardsOf(h).map((c) => c.name), ['Breakfast', 'Lunch', 'Dinner', 'Extras']);
  assert.doesNotMatch(h, /could not be shown|gd-pick/);
});
