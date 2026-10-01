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
import { DAYTYPE_CASES } from '../../../lib/nutrition/daytype.mjs';
import { fuelPlan } from '../../../lib/nutrition/fuel.mjs';
import { planFor, solveScale } from '../../../lib/nutrition/scale.mjs';
import { applyPicks, swapOption, swapIng, NONE_KEY } from '../../../lib/nutrition/blocks.mjs';
import { lineCap } from '../../../lib/nutrition/amounts.mjs';
import { CAT_RULES, FOOD_CATS } from '../../../lib/nutrition/categories.mjs';
import { LINE } from '../../../lib/nutrition/amounts.mjs';
import { MAIN_SLOTS, isMainMeal } from '../../../lib/nutrition/slots.mjs';

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
function run({ nutri = bake(), items = [], programmed = null, locale = 'en', storage = memStorage(), today = TODAY, hooks = true, extra = {}, intake, query } = {}) {
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
  assert.match(els['nutri-plan'].innerHTML, /class="mp mp-flex mp-block"><span class="mp-l"><select class="mp-pick" data-block="lunch\/carboComida" aria-label="Change Rice \(Lunch\)">.*?<\/select><span class="mp-dir" role="img" aria-label="portion scaled (up|down) to the target">[↑↓]<\/span><\/span><span class="mp-q">\d+ g<\/span><\/li>/);
  assert.match(els['nutri-plan'].innerHTML, /<li class="mp-sub"><span class="mp-l">Bread<\/span><span class="mp-q">~2 bread rolls \(80 g\)<\/span><\/li>/, 'a countable food shows pieces with the grams reference');
  assert.doesNotMatch(els['nutri-plan'].innerHTML, /mp-tag|scaled<\/span>/, 'no loud "scaled" label');
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
  assert.match(els['nutri-target'].innerHTML, new RegExp('Meals ' + two.tot.k.toLocaleString('en') + ' kcal'));
  const targetBefore = els['nutri-target'].innerHTML;
  calls.length = 0;
  fire('nutri-ride-wrap', 'change', { id: 'nutri-ride', value: '180' });
  assert.equal(api.state().rideMin, 180);
  assert.match(els['nutri-fuel-body'].innerHTML, /180 g in total/);
  assert.match(els['nutri-target'].innerHTML, /ride fuel 720 kcal/);
  assert.match(els['nutri-target'].innerHTML, new RegExp('Meals ' + three.tot.k.toLocaleString('en') + ' kcal'));
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

test('every goal x day type renders a target and a plan (all 12)', () => {
  const s = run();
  for (const g of ['maintain', 'cut', 'bulk']) for (const d of ['rest', 'gym', 'bike', 'bikeLong']) {
    s.api.setGoal(g);
    s.fire('nutri-daytype', 'change', { value: d });
    const t = s.els['nutri-target'].innerHTML + s.els['nutri-plan'].innerHTML;
    assert.doesNotMatch(t, /NaN|undefined|null|could not be shown/, `${g}/${d}`);
    assert.match(s.els['nutri-plan'].innerHTML, /class="meal"/);
  }
});

test('supplements sit under the meal of their slot; one with no such meal today goes to "other supplements"', () => {
  const { els } = run();
  const html = els['nutri-plan'].innerHTML;
  const lunch = html.split('class="meal-name">Lunch<')[1].split('class="meal"')[0];
  assert.match(lunch, /<div class="meal-supp"><svg class="supp-ico"[^>]*aria-hidden="true">.*?<\/svg><span>Demo Creatine 3 g<\/span><\/div>/);
  assert.match(html, /Other supplements today/);
  assert.match(html, /<span>Demo Electrolytes \(Pre-workout\)<\/span>/);
  assert.doesNotMatch(html, /💊/, 'no emoji');
});

test('a remainder beyond the tolerance is stated with what to do; within it nothing is said', () => {
  const nutri = bake();
  const cut = run({ nutri });
  cut.api.setGoal('cut'); // the example's cut rest day lands on its target
  assert.doesNotMatch(cut.els['nutri-target'].innerHTML, /short|over:/);
  nutri.base.rest.flex = []; // nothing to scale: the whole gap is the remainder
  nutri.plans.maintain.rest.t = { ...nutri.plans.maintain.rest.t, kcal: nutri.plans.maintain.rest.t.kcal + 400 };
  const x = planFor(nutri, 'maintain', 'rest', null);
  assert.ok(x.rem > 75, `rem ${x.rem}`);
  const grams = Math.round(x.rem / 4 / 5) * 5;
  assert.match(run({ nutri }).els['nutri-target'].innerHTML, new RegExp('~' + x.rem.toLocaleString('en') + ' kcal short: add ~' + grams + ' g of carbs'));
  nutri.plans.maintain.rest.t = { ...nutri.plans.maintain.rest.t, kcal: 700 };
  assert.match(run({ nutri }).els['nutri-target'].innerHTML, /kcal over: trim fat or extras/);
});

test('protein or fat far from the target is flagged (they are not scaled)', () => {
  const nutri = bake();
  nutri.plans.maintain.rest.t = { ...nutri.plans.maintain.rest.t, p: 220 };
  assert.match(run({ nutri }).els['nutri-target'].innerHTML, /plan's protein \(\d+ g\) is off the target \(220 g\)/);
});

test('only whole-unit portions flexible: the unrounded remainder is reported with a note', () => {
  const syn = plain(buildNutriToday(buildNutrition(SYN_ING, SYN_PLAN), SYN_PLAN));
  syn.plans.maintain.rest.t = { kcal: 950, p: 60, f: 8, c: 138 };
  const x = planFor(syn, 'maintain', 'rest', null);
  assert.equal(x.udOnly, true);
  assert.ok(Math.abs(x.rem) > 75, `rem ${x.rem}`);
  const html = run({ nutri: syn }).els['nutri-plan'].innerHTML;
  assert.match(html, /Only portions counted in pieces are adjustable/);
  assert.match(html, new RegExp('Carb portions ×' + x.factor.toFixed(2)));
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

test('the removed day builder\'s hook is never called (a stale window.bldRefresh is ignored); a failing ring refresh says so', () => {
  const calls = [];
  const s = run({ hooks: { bldRefresh: () => calls.push('bld'), intakeRefresh: () => calls.push('intake') } });
  s.api.setGoal('cut');
  assert.deepEqual(calls, ['intake', 'intake']);
  assert.doesNotMatch(source, /bldRefresh|r-verdict/);
  const t = run({ hooks: { intakeRefresh: () => { throw new Error('x'); } } });
  assert.match(t.els.intake.innerHTML, /could not be shown/);
});

test('Spanish: labels, thousands with a dot, decimal comma in the carb factor', () => {
  const { els, api } = run({ locale: 'es', nutri: bake({ units: { g: 'g', ml: 'ml', ud: 'ud' }, dec: ',' }) });
  assert.match(els['nutri-target'].innerHTML, /<b class="nt-kcal">2\.500<\/b>/);
  assert.match(els['nutri-target'].innerHTML, /Proteína/);
  api.setGoal('cut'); // a day whose portions still have a common factor
  assert.match(els['nutri-plan'].innerHTML, /Raciones de carbohidratos ×\d,\d\d /);
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

test('Plan de hoy: a composite item lists its components as readable sub-rows (name · amount), fixed and scaled', () => {
  const nutri = bake();
  const meal = nutri.base.rest.meals[0];
  meal.parts.push({ l: 'Toast with avocado', q: '82 g + 20 g', c: ['Toast', 'Avocado'], a: ['82 g', '20 g'] });
  const h = run({ nutri }).els['nutri-plan'].innerHTML;
  assert.match(h, /<li class="mp mp-comp"><span class="mp-l">Toast with avocado<\/span><\/li><li class="mp-sub"><span class="mp-l">Toast<\/span><span class="mp-q">82 g<\/span><\/li><li class="mp-sub"><span class="mp-l">Avocado<\/span><span class="mp-q">20 g<\/span><\/li>/);
  assert.doesNotMatch(h, /82 g \+ 20 g/, 'never the cryptic "82 g + 20 g"');
});

test('Avituallamiento: a 3-step timeline (before, during, after) with one key number each', () => {
  const h = run({ programmed: { kind: 'bike' } }).els['nutri-fuel-body'].innerHTML;
  const steps = [...h.matchAll(/<li class="fuel-step[^"]*"><div class="fuel-step-head"><h3>([^<]+)<\/h3><b class="fuel-key">([^<]+)<\/b>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(steps.map((x) => x[0]), ['Before', 'During', 'After']);
  assert.deepEqual(steps.map((x) => x[1]), ['70–140 g', '60 g/h', '70–85 g'], 'carbs before (70 kg), carbs per hour, carbs after');
  assert.match(h, /<ol class="fuel-steps">/);
});

/* ---------- HCNutri.todayPlan: the food log's "Del plan" tab reads Plan de hoy, never re-computes it ---------- */
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TODAY_PLAN_CASES = [
  { label: 'rest, default goal', opts: {}, goal: 'maintain', d: 'rest', min: null },
  { label: 'gym done, bulk', opts: { items: [{ modality: 'gym', dur: 60 }], storage: memStorage({ 'hc.nutri.goal': 'bulk' }) }, goal: 'bulk', d: 'gym', min: null },
  { label: 'programmed ride picked at 3 h, cut', opts: { programmed: { kind: 'bike' }, storage: memStorage({ 'hc.nutri.goal': 'cut', 'hc.nutri.rideMin': JSON.stringify({ date: TODAY, type: 'bike', min: 180 }) }) }, goal: 'cut', d: 'bike', min: 180 },
  { label: 'long ride recorded (real minutes), maintain', opts: { items: [{ modality: 'bike', dur: 200 }] }, goal: 'maintain', d: 'bikeLong', min: 200 },
];

test('HCNutri.todayPlan: today\'s Plan de hoy meals exactly as rendered (same goal x day type x ride minutes, same planFor)', () => {
  const nutri = bake();
  for (const c of TODAY_PLAN_CASES) {
    const s = run(c.opts);
    assert.equal(s.api.state().dayType, c.d, c.label);
    const x = planFor(nutri, c.goal, c.d, c.min);
    const base = nutri.base[x.base];
    const plan = plain(s.api.todayPlan());
    const html = s.els['nutri-plan'].innerHTML;
    assert.equal(plan.length, base.meals.length, c.label);
    let fi = 0;
    plan.forEach((m, i) => {
      assert.equal(m.name, base.meals[i].n);
      assert.equal(m.slot, base.meals[i].s);
      assert.deepEqual([m.kcal, m.p, m.c, m.g], x.meals[i], `${c.label}: meal ${i} totals = Plan de hoy's`);
      // a main meal is a card, an add-on a row of the add-ons card; both print the same kcal
      const shown = MAIN_SLOTS.includes(m.slot)
        ? `<div class="meal-name">${escHtml(m.name)}</div><div class="meal-kcal"><b>${m.kcal.toLocaleString('en')}</b> kcal</div>`
        : `<div class="addon-name">${escHtml(m.name)}</div><div class="addon-kcal"><b>${m.kcal.toLocaleString('en')}</b> kcal</div>`;
      assert.ok(html.includes(shown), `${c.label}: meal ${i} kcal on the page`);
      assert.equal(m.items.length, base.meals[i].parts.length);
      m.items.forEach((it, j) => {
        const part = base.meals[i].parts[j];
        assert.equal(it.name, part.l);
        const k = part.x ? fi++ : -1;
        if (part.c) {
          assert.equal(it.amount, null, 'a composite has no amount of its own');
          const amts = part.x ? x.flexAmts[k] : part.a || [];
          assert.deepEqual(it.components, part.c.map((name, n) => ({ name, amount: amts[n] != null ? amts[n] : null })));
        } else {
          assert.equal(it.amount, part.x ? x.flex[k] : part.q || null);
          if (it.amount) assert.ok(html.includes(`<span class="mp-q">${escHtml(it.amount)}</span>`), `${c.label}: "${it.amount}" shown in Plan de hoy`);
        }
        assert.ok(Number.isInteger(it.kcal) && it.kcal >= 0);
        for (const v of [it.p, it.c, it.g]) assert.equal(Math.round(v * 10) / 10, v, 'macros to 1 decimal');
      });
      // the items add up to the meal (each rounded once)
      const sum = m.items.reduce((a, it) => a + it.kcal, 0);
      assert.ok(Math.abs(sum - m.kcal) <= m.items.length, `${c.label}: meal ${i} items ${sum} vs ${m.kcal}`);
    });
    assert.equal(fi, x.flex.length, 'every flex part consumed in part order');
  }
});

test('HCNutri.todayPlan follows a goal / day type change and is read-only (a copy each call)', () => {
  const s = run();
  const before = plain(s.api.todayPlan());
  s.api.setGoal('cut');
  const cut = planFor(bake(), 'cut', 'rest', null);
  assert.deepEqual(plain(s.api.todayPlan()).map((m) => m.kcal), cut.meals.map((m) => m[0]));
  const a = s.api.todayPlan();
  a[0].kcal = -1;
  a[0].items.length = 0;
  assert.notEqual(s.api.todayPlan()[0].kcal, -1);
  assert.ok(s.api.todayPlan()[0].items.length > 0);
  assert.notDeepEqual(before.map((m) => m.kcal), cut.meals.map((m) => m[0]));
});

test('HCNutri.todayPlan is null when Plan de hoy has nothing to show (no base day / no meals)', () => {
  const nutri = bake();
  nutri.base.rest = null;
  assert.equal(run({ nutri }).api.todayPlan(), null);
  const empty = bake();
  empty.base.rest.meals = [];
  assert.equal(run({ nutri: empty }).api.todayPlan(), null);
});

test('lib solveScale / planFor expose each flex part\'s macros at its rounded amount (flexMac); fixed parts carry their own (m)', () => {
  const nutri = bake();
  for (const d of ['rest', 'gym', 'bike']) {
    const x = planFor(nutri, 'maintain', d, d === 'bike' ? 120 : null);
    const base = nutri.base[x.base];
    assert.equal(x.flexMac.length, x.flex.length);
    // meal totals = fixed parts + scaled flex parts
    let fi = 0;
    base.meals.forEach((meal, i) => {
      const t = [0, 0, 0, 0];
      meal.parts.forEach((p) => { const m = p.x ? x.flexMac[fi++] : p.m; for (let n = 0; n < 4; n++) t[n] += m[n]; });
      assert.deepEqual(t.map(Math.round), x.meals[i], `${d}: meal ${i}`);
    });
  }
});

/* ---------- choosable blocks: picks (lib/nutrition/blocks.mjs applyPicks, ported) ---------- */
// every single pick of every block of the example, plus a few combinations, per base day
// a block's option keys: a list block's options, or a food block's category foods (+ "none" when skippable)
function optKeys(nutri, b) {
  if (!b.I) return nutri.lists[b.L].map((o) => o.k);
  return nutri.foods.cats[b.I].concat(nutri.foods.rules[b.I].skip ? [NONE_KEY] : []);
}
function pickCases(nutri) {
  const out = [undefined, {}];
  for (const day of ['train', 'rest']) {
    const blocks = nutri.base[day].blocks;
    const all = {};
    for (const id of Object.keys(blocks)) {
      const keys = optKeys(nutri, blocks[id]);
      for (const k of keys) out.push({ [id]: k });
      all[id] = keys[keys.length - 1];
    }
    out.push(all);
  }
  out.push({ 'lunch/carboComida': 'Pasta', 'dinner/proteina': 'Salmon', 'snack/anclaje': 'Tuna', 'breakfast/desayuno': 'A · Oat pancake' });
  out.push({ 'lunch/calabacin': NONE_KEY, 'breakfast/leche': 'yogurgriego', 'Cooking oil/aceiteoliva': 'mantequillalight', 'breakfast/avena': 'arroz', 'snack/platano': NONE_KEY, 'postworkout/wheyup': 'pollo' });
  out.push({ 'lunch/proteina': 'Nope', 'x/y': 'Rice', 'lunch/postre': 12 });
  return out;
}
const bakeEs = () => plain(buildNutriToday(buildNutrition(ING, PLAN), PLAN, { units: { g: 'g', ml: 'ml', ud: 'ud' }, dec: ',', lang: 'es' }));

test('planFor / applyPicks ports agree with lib with picks (every single pick + combinations, all goals x day types)', () => {
  for (const nutri of [bake(), bakeEs()]) {
    const { api } = run({ nutri });
    const cases = pickCases(nutri);
    assert.ok(cases.length > 30, `${cases.length} pick cases`);
    for (const picks of cases) {
      for (const g of ['maintain', 'cut', 'bulk']) for (const d of ['rest', 'gym', 'bike', 'bikeLong']) {
        const min = d === 'bikeLong' ? 240 : null;
        assert.deepEqual(plain(api.planFor(nutri, g, d, min, picks)), plain(planFor(nutri, g, d, min, picks)), `${g}/${d} ${JSON.stringify(picks)}`);
      }
      for (const day of ['train', 'rest']) {
        assert.deepEqual(plain(api.applyPicks(nutri.base[day], nutri.lists, picks, nutri.fmt, nutri.foods)), plain(applyPicks(nutri.base[day], nutri.lists, picks, nutri.fmt, nutri.foods)), `${day} ${JSON.stringify(picks)}`);
      }
    }
  }
});

test('swapOption port agrees with lib for every block and option (both locales)', () => {
  for (const nutri of [bake(), bakeEs()]) {
    const { api } = run({ nutri });
    assert.deepEqual(plain(api.LINE), { ...LINE }, 'the page mirrors the line layout');
    let n = 0;
    for (const day of ['train', 'rest']) for (const [id, b] of Object.entries(nutri.base[day].blocks)) {
      if (b.I) continue; // food blocks: the swapIng parity test below
      for (const o of nutri.lists[b.L]) {
        assert.deepEqual(plain(api.swapOption(b, nutri.lists[b.L], o.k, nutri.fmt)), plain(swapOption(b, nutri.lists[b.L], o.k, nutri.fmt)), `${day} ${id} ${o.k}`);
        n++;
      }
    }
    assert.ok(n > 20, `${n} swaps`);
  }
});

test('swapIng port agrees with lib for every food block and option, "none" included (both locales)', () => {
  for (const nutri of [bake(), bakeEs()]) {
    const { api } = run({ nutri });
    let n = 0;
    const cats = new Set();
    for (const day of ['train', 'rest']) for (const [id, b] of Object.entries(nutri.base[day].blocks)) {
      if (!b.I) continue;
      cats.add(b.I);
      for (const k of optKeys(nutri, b)) {
        assert.deepEqual(plain(api.swapIng(b, nutri.foods, k, nutri.fmt)), plain(swapIng(b, nutri.foods, k, nutri.fmt)), `${day} ${id} ${k}`);
        n++;
      }
    }
    assert.deepEqual([...cats].sort(), ['carb', 'dairy', 'fat', 'fruit', 'protein', 'veg'], 'every category rule of the example is exercised');
    assert.ok(n > 120, `${n} food swaps`);
  }
});

test('ingAmount port agrees with lib for every category rule (synthetic foods: unit food, countable, none of the macro)', () => {
  const nutri = bake();
  const { api } = run({ nutri });
  const F = nutri.foods.ings;
  const keys = Object.keys(F);
  let n = 0;
  for (const cat of FOOD_CATS) for (const d of ['pollo', 'huevo', 'platano', 'aceiteoliva', 'leche', 'calabacin']) for (const o of keys) for (const amt of [5, 37, 150, 300]) {
    const b = { I: cat, d, a: amt, fx: false };
    const foods = { ...nutri.foods, rules: { [cat]: CAT_RULES[cat] } };
    assert.deepEqual(plain(api.swapIng(b, foods, o, nutri.fmt)), plain(swapIng(b, foods, o, nutri.fmt)), `${cat} ${d} ${amt} -> ${o}`);
    n++;
  }
  assert.ok(n > 5000, `${n} cases`);
});

test('setPick reads the block from today\'s base day without re-solving the plan', () => {
  const nutri = bake();
  const t = run({ nutri });
  const cell = nutri.plans[t.api.state().goal][t.api.state().dayType];
  let solved = 0;
  const target = cell.t;
  Object.defineProperty(cell, 't', { get() { solved++; return target; }, configurable: true });
  assert.equal(t.api.setPick('nope/x', 'Rice'), false);
  assert.equal(solved, 0, 'an unknown block: no planFor run');
});

test('the example day stays on target whatever single food is picked, unless no carb portion can grow any more', () => {
  const nutri = bake();
  for (const picks of pickCases(nutri)) {
    for (const [g, d] of [['cut', 'rest'], ['maintain', 'rest'], ['maintain', 'gym']]) {
      const x = planFor(nutri, g, d, null, picks);
      // an extreme pick can push the carb factor to its limit, or every portion reaches its cap: the page says so
      if (x.clamp || x.allCapped) continue;
      assert.ok(Math.abs(x.rem) <= nutri.tolerance, `${g}/${d} ${JSON.stringify(picks)}: rem ${x.rem}`);
    }
  }
});

test('a block renders as a labelled select of its list (grouped like the tables); the default view is today\'s plan', () => {
  const { els, api } = run();
  const html = els['nutri-plan'].innerHTML;
  assert.match(html, /<select class="mp-pick" data-block="lunch\/proteina" aria-label="Change Chicken breast \(Lunch\)"><optgroup label="Lean"><option value="Chicken breast" selected>Chicken breast<\/option>/);
  assert.match(html, /<optgroup label="Moderate"><option value="Turkey ham">Turkey ham<\/option><\/optgroup><optgroup label="Fatty">/);
  assert.match(html, /data-block="lunch\/carboComida"[^>]*><option value="Rice" selected>Rice<\/option><option value="Pasta">Pasta<\/option>/, 'a list without groups: plain options');
  assert.doesNotMatch(html, /nutri-picks-reset/, 'nothing picked: no reset link');
  assert.deepEqual(plain(api.state().picks), {});
});

test('picking an option: kept for today, the plan re-solved, the rings refreshed, focus back on that select', () => {
  const storage = memStorage();
  const queried = [];
  const s = run({ storage, query: (sel) => { queried.push(sel); return { focus() { queried.push('focused'); } }; } });
  s.calls.length = 0;
  s.fire('nutri-plan', 'change', { value: 'Salmon', getAttribute: (n) => (n === 'data-block' ? 'lunch/proteina' : null) });
  assert.deepEqual(JSON.parse(storage.data['hc.nutri.picks']), { date: TODAY, picks: { 'lunch/proteina': 'Salmon' } });
  const html = s.els['nutri-plan'].innerHTML;
  assert.match(html, /<option value="Salmon" selected>Salmon<\/option>/);
  // salmon 20 g P / 100 g against chicken 140 g (32 g P): 160 g
  assert.match(html, /data-block="lunch\/proteina"[^]*?<\/select><\/span><span class="mp-q">160 g<\/span>/);
  assert.match(html, /You swapped foods: the rest of the day was re-solved to stay on target\. <button type="button" class="lnk nutri-picks-reset" id="nutri-picks-reset">Back to the base plan<\/button>/);
  assert.deepEqual(s.calls, [['intake', 2500]], 'the target is unchanged; the rings are refreshed');
  assert.deepEqual(queried, ['select[data-block="lunch/proteina"]', 'focused']);
  const x = planFor(bake(), 'maintain', 'rest', null, { 'lunch/proteina': 'Salmon' });
  assert.deepEqual(plain(s.api.todayPlan()).map((m) => m.kcal), x.meals.map((m) => m[0]));
  assert.equal(s.api.todayPlan()[1].items[0].name, 'Salmon');
  assert.equal(s.api.todayPlan()[1].items[0].amount, '160 g');
  // back to the default option: the pick is dropped (and the storage key with it)
  s.fire('nutri-plan', 'change', { value: 'Chicken breast', getAttribute: () => 'lunch/proteina' });
  assert.equal(storage.data['hc.nutri.picks'], undefined);
  assert.doesNotMatch(s.els['nutri-plan'].innerHTML, /nutri-picks-reset/);
});

test('reset: every pick dropped; an unknown block id is ignored', () => {
  const storage = memStorage({ 'hc.nutri.picks': JSON.stringify({ date: TODAY, picks: { 'lunch/carboComida': 'Pasta', 'dinner/postre': 'Banana' } }) });
  const s = run({ storage });
  assert.deepEqual(plain(s.api.state().picks), { 'lunch/carboComida': 'Pasta', 'dinner/postre': 'Banana' });
  assert.match(s.els['nutri-plan'].innerHTML, /<option value="Pasta" selected>/);
  s.fire('nutri-plan', 'change', { value: 'Rice', getAttribute: () => 'nope/x' });
  assert.deepEqual(plain(s.api.state().picks), { 'lunch/carboComida': 'Pasta', 'dinner/postre': 'Banana' });
  s.fire('nutri-plan', 'click', { closest: (sel) => (sel === '#nutri-picks-reset' ? {} : null) });
  assert.deepEqual(plain(s.api.state().picks), {});
  assert.equal(storage.data['hc.nutri.picks'], undefined);
  assert.match(s.els['nutri-plan'].innerHTML, /<option value="Rice" selected>/);
});

test('picks expire the next day; a broken or foreign value is ignored; storage failures never break the page', () => {
  const old = run({ storage: memStorage({ 'hc.nutri.picks': JSON.stringify({ date: '2030-01-09', picks: { 'lunch/carboComida': 'Pasta' } }) }) });
  assert.deepEqual(plain(old.api.state().picks), {});
  const junk = run({ storage: memStorage({ 'hc.nutri.picks': '{nope' }) });
  assert.deepEqual(plain(junk.api.state().picks), {});
  const odd = run({ storage: memStorage({ 'hc.nutri.picks': JSON.stringify({ date: TODAY, picks: { 'lunch/carboComida': 3, 'lunch/postre': 'Quinoa' } }) }) });
  assert.deepEqual(plain(odd.api.state().picks), { 'lunch/postre': 'Quinoa' }, 'kept, but a key not in the list is ignored by applyPicks');
  assert.match(odd.els['nutri-plan'].innerHTML, /<option value="Apple" selected>/);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const t = run({ storage: throwing });
  assert.equal(t.api.setPick('lunch/carboComida', 'Pasta'), true);
  assert.match(t.els['nutri-plan'].innerHTML, /<option value="Pasta" selected>/);
});

test('a pick follows the day type: the same block id on the other base day (Pasta on rest and gym)', () => {
  const s = run();
  s.api.setPick('lunch/carboComida', 'Pasta');
  assert.match(s.els['nutri-plan'].innerHTML, /<option value="Pasta" selected>/);
  s.fire('nutri-daytype', 'change', { value: 'gym' });
  assert.equal(s.api.state().dayType, 'gym');
  assert.match(s.els['nutri-plan'].innerHTML, /data-block="lunch\/carboComida"[^>]*>[^]*?<option value="Pasta" selected>/);
});

test('Spanish: the select and the reset link are localized; countable foods in Spanish', () => {
  const s = run({ nutri: bakeEs(), locale: 'es' });
  s.api.setPick('lunch/postre', 'Banana');
  const html = s.els['nutri-plan'].innerHTML;
  assert.match(html, /aria-label="Cambiar Banana \(Lunch\)"/);
  assert.match(html, /<optgroup label="Fruta">/);
  assert.match(html, /plátanos? medianos?/);
  assert.match(html, /Volver al plan base/);
});

/* ---------- three main meals + ONE add-ons card (display grouping only: no number changes) ---------- */
// planFor totals of the example plan [kcal, P, C, F, factor, remainder], re-pinned DELIBERATELY when
// portion caps + water-filling landed (lib/nutrition/scale.mjs): the example's carb parts now stop at
// realistic portions (potato 400 g, rice 150 g, two fruit pieces…), so most plans end short and say so
const PINNED_TOTALS = {
  'maintain/rest': [2401, 139, 369, 44, 1.67, 99], 'maintain/gym': [2605, 150, 388, 52, 1.67, 445], 'maintain/bike': [2605, 150, 388, 52, 1.67, 465], 'maintain/bikeLong': [2605, 150, 388, 52, 1.67, 535],
  'cut/rest': [2150, 136, 308, 44, 1.19, 0], 'cut/gym': [2605, 150, 388, 52, 1.67, 95], 'cut/bike': [2605, 150, 388, 52, 1.67, 465], 'cut/bikeLong': [2605, 150, 388, 52, 1.67, 535],
  'bulk/rest': [2401, 139, 369, 44, 1.67, 399], 'bulk/gym': [2605, 150, 388, 52, 1.67, 745], 'bulk/bike': [2605, 150, 388, 52, 1.67, 765], 'bulk/bikeLong': [2605, 150, 388, 52, 1.67, 835],
};
const cardsOf = (html) => [...html.matchAll(/<div class="meal( meal-addons)?"><div class="meal-top"><div class="meal-name">([^<]+)<\/div><div class="meal-kcal"><b>([\d,.]+)<\/b> kcal<\/div><\/div>/g)]
  .map((m) => ({ addons: !!m[1], name: m[2], kcal: Number(m[3].replace(/[,.]/g, '')) }));
const addonRowsOf = (html) => [...html.matchAll(/<div class="addon"><div class="addon-top"><div class="addon-name">([^<]+)<\/div><div class="addon-kcal"><b>([\d,.]+)<\/b> kcal<\/div><\/div>/g)]
  .map((m) => ({ name: m[1], kcal: Number(m[2].replace(/[,.]/g, '')) }));

test('planFor totals (lib and the page port) equal the pinned ones, and the cards add up to the day', () => {
  const nutri = bake();
  const s = run({ nutri });
  for (const [key, want] of Object.entries(PINNED_TOTALS)) {
    const [g, d] = key.split('/');
    for (const x of [planFor(nutri, g, d, null), s.api.planFor(nutri, g, d, null)]) assert.deepEqual([x.tot.k, x.tot.p, x.tot.c, x.tot.g, x.factor, x.rem], want, key);
    s.api.setGoal(g);
    s.fire('nutri-daytype', 'change', { value: d });
    const x = planFor(nutri, g, d, s.api.state().rideMin);
    const cards = cardsOf(s.els['nutri-plan'].innerHTML);
    assert.equal(cards.reduce((a, c) => a + c.kcal, 0), x.meals.reduce((a, m) => a + m[0], 0), `${key}: main cards + the add-ons card = every meal`);
  }
});

test('the page classifies main meals vs add-ons like lib (baked MAIN_SLOTS + isMainMeal)', () => {
  const nutri = bake();
  assert.deepEqual(nutri.mainSlots, MAIN_SLOTS);
  const { api } = run({ nutri });
  for (const day of ['train', 'rest']) {
    nutri.base[day].meals.forEach((m, i) => assert.equal(api.isMainMeal(m), isMainMeal(PLAN.dayPlan[day].meals[i]), `${day}: ${m.n}`));
  }
  assert.equal(api.isMainMeal({ n: 'x', s: null }), false);
  assert.equal(api.isMainMeal(null), false);
});

test('Plan de hoy (rest): Breakfast, Lunch, Dinner cards, then ONE Extras card holding every other meal as a compact row', () => {
  const nutri = bake();
  const s = run({ nutri });
  const html = s.els['nutri-plan'].innerHTML;
  const cards = cardsOf(html);
  assert.deepEqual(cards.map((c) => c.name), ['Breakfast', 'Lunch', 'Dinner', 'Extras'], 'the add-ons card comes after dinner');
  assert.deepEqual(cards.map((c) => c.addons), [false, false, false, true]);
  const rows = addonRowsOf(html);
  assert.deepEqual(rows.map((r) => r.name), ['Protein anchor', 'Cooking oil'], 'add-ons keep their day order');
  const x = planFor(nutri, 'maintain', 'rest', null);
  const names = nutri.base.rest.meals.map((m) => m.n);
  assert.deepEqual(rows.map((r) => r.kcal), rows.map((r) => x.meals[names.indexOf(r.name)][0]), 'each row = that meal\'s kcal');
  assert.equal(cards[3].kcal, rows.reduce((a, r) => a + r.kcal, 0), 'the card kcal = the sum of its rows');
  const addons = html.split('class="meal meal-addons"')[1];
  assert.match(addons, /<select class="mp-pick" data-block="snack\/anclaje" aria-label="Change [^"]+ \(Protein anchor\)">/, 'a choosable block stays choosable on its add-on row');
  assert.match(addons, /<span class="mp-dir" role="img"/, 'the scaled-portion arrow is kept');
  assert.match(addons, /<li class="mp mp-block"><span class="mp-l"><select class="mp-pick" data-block="Cooking oil\/aceiteoliva" aria-label="Change Olive oil \(Cooking oil\)">[^]*?<option value="aceiteoliva" selected>Olive oil<\/option>[^]*?<\/select><\/span><span class="mp-q">~1 tablespoon \(11 g\)<\/span><\/li>/, 'a fixed food is a select of its category, also on an add-on row');
  assert.doesNotMatch(html, /<div class="meal-name">(Protein anchor|Cooking oil)<\/div>/, 'no full card per add-on');
});

test('Plan de hoy (gym): Post-workout and Cooking oil are add-on rows; Spanish heading "Añadidos"', () => {
  const s = run({ items: [{ modality: 'gym', dur: 60 }] });
  assert.equal(s.api.state().dayType, 'gym');
  const html = s.els['nutri-plan'].innerHTML;
  assert.deepEqual(cardsOf(html).map((c) => c.name), ['Breakfast', 'Lunch', 'Dinner', 'Extras']);
  assert.deepEqual(addonRowsOf(html).map((r) => r.name), ['Post-workout', 'Cooking oil']);
  const es = run({ nutri: bakeEs(), locale: 'es' }).els['nutri-plan'].innerHTML;
  assert.match(es, /<div class="meal meal-addons"><div class="meal-top"><div class="meal-name">Añadidos<\/div>/);
});

test('a supplement of an add-on slot sits on that add-on row; a day with no add-ons has no add-ons card', () => {
  const nutri = bake({ supplements: [{ name: 'Demo Whey', dose: '30 g', meal: 'postworkout' }, { name: 'Demo Magnesium', dose: null, meal: 'snack' }] });
  const gym = run({ nutri, items: [{ modality: 'gym', dur: 60 }] }).els['nutri-plan'].innerHTML;
  const post = gym.split('<div class="addon-name">Post-workout</div>')[1].split('<div class="addon">')[0];
  assert.match(post, /<div class="meal-supp"><svg class="supp-ico"[^>]*>.*?<\/svg><span>Demo Whey 30 g<\/span><\/div>/);
  const rest = run({ nutri }).els['nutri-plan'].innerHTML;
  const anchor = rest.split('<div class="addon-name">Protein anchor</div>')[1].split('<div class="addon">')[0];
  assert.match(anchor, /<span>Demo Magnesium<\/span>/);
  const syn = plain(buildNutriToday(buildNutrition(SYN_ING, SYN_PLAN), SYN_PLAN, {}));
  const none = run({ nutri: syn }).els['nutri-plan'].innerHTML;
  assert.doesNotMatch(none, /meal-addons|class="addon"/);
  assert.deepEqual(cardsOf(none).map((c) => c.name), ['Lunch']);
});

/* ---------- every fixed {ing} part is choosable among the foods of its category ---------- */
test('a fixed food renders as a select of its category (default = its label), with "none" only where skipping is sensible', () => {
  const { els } = run();
  const html = els['nutri-plan'].innerHTML;
  const sel = (id) => (html.match(new RegExp('<select class="mp-pick" data-block="' + id.replace('/', '\\/') + '"[^]*?</select>')) || [''])[0];
  const veg = sel('lunch/calabacin');
  assert.match(veg, /aria-label="Change Zucchini \(Lunch\)"/);
  assert.match(veg, /<option value="calabacin" selected>Zucchini<\/option>/, 'the default keeps the plan\'s own label');
  assert.match(veg, /<option value="pimiento">Bell pepper<\/option>/, 'other foods by their localized name');
  assert.match(veg, /<option value="none">No vegetables<\/option><\/select>$/, '"none" last');
  assert.doesNotMatch(veg, /optgroup/);
  assert.doesNotMatch(sel('Cooking oil/aceiteoliva'), /value="none"/, 'the cooking fat is never skipped');
  assert.match(sel('snack/platano'), /<option value="none">No fruit<\/option>/);
  assert.ok(sel('dinner/calabacin'), 'lunch and dinner each have their own block');
});

test('picking a food: kept for today, the amount follows the category rule, the day re-solved; "Del plan" logs the pick', () => {
  const storage = memStorage();
  const s = run({ storage });
  s.fire('nutri-plan', 'change', { value: 'pimiento', getAttribute: (n) => (n === 'data-block' ? 'lunch/calabacin' : null) });
  assert.deepEqual(JSON.parse(storage.data['hc.nutri.picks']), { date: TODAY, picks: { 'lunch/calabacin': 'pimiento' } });
  const html = s.els['nutri-plan'].innerHTML;
  assert.match(html, /data-block="lunch\/calabacin" aria-label="Change Bell pepper \(Lunch\)">[^]*?<option value="pimiento" selected>Bell pepper<\/option>[^]*?<\/select><\/span><span class="mp-q">150 g<\/span>/, 'veg keeps the same grams');
  assert.match(html, /nutri-picks-reset/);
  const x = planFor(bake(), 'maintain', 'rest', null, { 'lunch/calabacin': 'pimiento' });
  const plan = plain(s.api.todayPlan());
  assert.deepEqual(plan.map((m) => m.kcal), x.meals.map((m) => m[0]));
  assert.ok(plan[1].items.some((it) => it.name === 'Bell pepper' && it.amount === '150 g'));
  assert.ok(!plan[1].items.some((it) => it.name === 'Zucchini'));
});

test('"none": the row keeps its select (to undo it) but no amount; the day is re-solved; "Del plan" leaves it out', () => {
  const s = run();
  const before = plain(s.api.todayPlan());
  assert.equal(s.api.setPick('lunch/calabacin', NONE_KEY), true);
  const html = s.els['nutri-plan'].innerHTML;
  assert.match(html, /<li class="mp mp-block mp-none"><span class="mp-l"><select class="mp-pick" data-block="lunch\/calabacin" aria-label="Change No vegetables \(Lunch\)">[^]*?<option value="none" selected>No vegetables<\/option><\/select><\/span><\/li>/);
  const x = planFor(bake(), 'maintain', 'rest', null, { 'lunch/calabacin': NONE_KEY });
  assert.ok(Math.abs(x.rem) <= bake().tolerance || x.allCapped, `rem ${x.rem}`);
  const plan = plain(s.api.todayPlan());
  assert.equal(plan[1].items.length, before[1].items.length - 1, 'nothing to log for a skipped food');
  assert.deepEqual(plan.map((m) => m.kcal), x.meals.map((m) => m[0]));
  // a meal whose every food is skipped has nothing to log
  const t = run();
  t.api.setPick('snack/platano', NONE_KEY);
  t.api.setPick('snack/anclaje', 'Nope');
  assert.ok(t.api.todayPlan().every((m) => m.items.length > 0));
});

test('Spanish: a food select and its "none" option are localized', () => {
  const s = run({ nutri: bakeEs(), locale: 'es' });
  const html = s.els['nutri-plan'].innerHTML;
  assert.match(html, /data-block="lunch\/calabacin" aria-label="Cambiar Zucchini \(Lunch\)">[^]*?<option value="pimiento">Pimiento<\/option>[^]*?<option value="none">Sin verdura<\/option>/);
  for (const cat of FOOD_CATS.filter((c) => CAT_RULES[c].skip)) {
    for (const T of [esN, enN]) assert.equal(typeof T.plan.none[cat], 'string', `none label for ${cat}`);
  }
});

/* ---------- realistic portion caps + water-filling ---------- */
// every flex line's numeric amount (planFor flexN) against its cap, over the model planFor solved
function overCap(nutri, x, picks) {
  const mdl = applyPicks(nutri.base[x.base], nutri.lists, picks, nutri.fmt, nutri.foods);
  const out = [];
  mdl.flex.forEach((f, i) => {
    if (!f.ln) return;
    f.ln.forEach((l, j) => {
      const cap = lineCap(l);
      if (cap && x.flexN[i][j] > cap) out.push(`${i}.${j}: ${x.flexN[i][j]} > ${cap}`);
    });
  });
  return out;
}

test('on the example no flex portion ever exceeds its cap: all 12 plans, every ride duration, every single pick', () => {
  const nutri = bake();
  let n = 0;
  for (const g of ['maintain', 'cut', 'bulk']) for (const d of ['rest', 'gym', 'bike', 'bikeLong']) {
    for (const min of [null, 60, 360]) {
      const x = planFor(nutri, g, d, min);
      assert.deepEqual(overCap(nutri, x), [], `${g}/${d}/${min}`);
      n++;
    }
    for (const picks of pickCases(nutri)) {
      const x = planFor(nutri, g, d, null, picks);
      assert.deepEqual(overCap(nutri, x, picks), [], `${g}/${d} ${JSON.stringify(picks)}`);
      n++;
    }
  }
  assert.ok(n > 400, `${n} plans checked`);
  // the owner's case: a maintain gym day no longer asks for an unrealistic plate of pasta or rice
  const gym = planFor(nutri, 'maintain', 'gym', null, { 'lunch/carboComida': 'Pasta' });
  const i = gym.view.flatMap((m) => m.parts.filter((p) => p.x)).findIndex((p) => p.l === 'Pasta');
  assert.ok(i >= 0 && gym.flexN[i][0] <= 150, `pasta ${gym.flexN[i] && gym.flexN[i][0]} g`);
});

test('planFor flexN = each flex part\'s numeric line amounts ([null] for a manual block), aligned with flexAmts', () => {
  const nutri = bake();
  const x = planFor(nutri, 'maintain', 'gym', null);
  assert.equal(x.flexN.length, x.flexAmts.length);
  x.flexN.forEach((a, i) => assert.equal(a.length, x.flexAmts[i].length));
  const syn = plain(buildNutriToday(buildNutrition(SYN_ING, SYN_PLAN), SYN_PLAN));
  const lentils = planFor(syn, 'maintain', 'gym', null);
  assert.ok(lentils.flexN.some((a) => a.length === 1 && a[0] === null), 'the flex lentils bowl is a manual block');
});

test('every flex portion at its maximum and the day still short: an extra snack is suggested, never a bigger plate', () => {
  const nutri = bake();
  const x = planFor(nutri, 'maintain', 'gym', null);
  assert.equal(x.allCapped || x.clamp === 'max', true, 'the example gym day cannot grow its plates any more');
  assert.ok(x.rem > 75, `rem ${x.rem}`);
  const s = run({ nutri });
  s.fire('nutri-daytype', 'change', { value: 'gym' });
  const html = s.els['nutri-target'].innerHTML;
  assert.match(html, new RegExp('~' + x.rem.toLocaleString('en') + ' kcal short: add a snack \\(e\\.g\\. fruit or a sandwich\\)'));
  assert.doesNotMatch(html, /g of carbs/, 'no "add N g of carbs" to a plate already at its maximum');
  const es = run({ nutri: bakeEs(), locale: 'es' });
  es.fire('nutri-daytype', 'change', { value: 'gym' });
  assert.match(es.els['nutri-target'].innerHTML, /Faltan ~[\d.]+ kcal: añade un tentempié \(p\. ej\. fruta o un bocadillo\)/);
  // bike days keep "add it to the ride fuel"
  s.fire('nutri-daytype', 'change', { value: 'bike' });
  const bx = planFor(nutri, 'maintain', 'bike', s.api.state().rideMin);
  if (bx.rem > 75) {
    assert.match(s.els['nutri-target'].innerHTML, /add them to the ride fuel/);
    assert.doesNotMatch(s.els['nutri-target'].innerHTML, /add a snack/);
  }
});

test('the factor line stays honest with capped portions: "some portions are at their maximum" / every portion at its maximum', () => {
  const nutri = bake();
  const s = run({ nutri });
  s.api.setGoal('cut');
  const some = planFor(nutri, 'cut', 'rest', null);
  assert.equal(some.capped && !some.allCapped, true, 'cut/rest: some portions capped');
  assert.match(s.els['nutri-plan'].innerHTML, new RegExp('Carb portions ×' + some.factor.toFixed(2) + ' vs the base plan; some portions are at their maximum\\.'));
  s.api.setGoal('maintain');
  s.fire('nutri-daytype', 'change', { value: 'gym' });
  const all = planFor(nutri, 'maintain', 'gym', null);
  if (all.allCapped) assert.match(s.els['nutri-plan'].innerHTML, /Every carb portion is at its maximum/);
  const es = run({ nutri: bakeEs(), locale: 'es' });
  es.api.setGoal('cut');
  assert.match(es.els['nutri-plan'].innerHTML, /algunas raciones están en su máximo/);
});

/* ---------- Plan de hoy collapsed by default (native <details>), open state per viewer ---------- */
test('Plan de hoy is collapsed by default; its summary shows the plan total kcal; the open state is remembered', () => {
  const nutri = bake();
  const storage = memStorage();
  const s = run({ nutri, storage });
  const fold = s.els['nutri-plan-fold'];
  assert.equal(fold.open, false, 'collapsed by default');
  const x = planFor(nutri, 'maintain', 'rest', null);
  assert.equal(s.els['nutri-plan-kcal'].textContent, x.tot.k.toLocaleString('en') + ' kcal');
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
  assert.equal(s.els['nutri-plan-kcal'].textContent, planFor(nutri, 'maintain', 'gym', null).tot.k.toLocaleString('en') + ' kcal');
  // storage that throws: still collapsed, toggling never throws
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const t = run({ nutri, storage: throwing });
  assert.equal(t.els['nutri-plan-fold'].open, false);
  t.els['nutri-plan-fold'].open = true;
  assert.doesNotThrow(() => t.els['nutri-plan-fold']._listeners.toggle.forEach((fn) => fn({ target: t.els['nutri-plan-fold'] })));
});

test('"Del plan" (HCNutri.todayPlan) works while Plan de hoy is collapsed: it reads the plan, not the DOM', () => {
  const nutri = bake();
  const s = run({ nutri });
  assert.equal(s.els['nutri-plan-fold'].open, false);
  const meals = s.api.todayPlan();
  assert.ok(Array.isArray(meals) && meals.length > 0);
  const x = planFor(nutri, 'maintain', 'rest', null);
  assert.equal(meals.reduce((a, m) => a + m.kcal, 0), x.meals.filter((m, i) => meals.some((mm) => mm.name === nutri.base.rest.meals[i].n)).reduce((a, m) => a + m[0], 0));
  s.els['nutri-plan'].innerHTML = ''; // even with nothing rendered
  assert.deepEqual(plain(s.api.todayPlan()), plain(meals));
});
