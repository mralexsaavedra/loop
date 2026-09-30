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
function run({ nutri = bake(), items = [], programmed = null, locale = 'en', storage = memStorage(), today = TODAY, hooks = true, extra = {}, intake } = {}) {
  const doc = new StubDocument();
  const els = {};
  for (const id of ['nutri-daytype', 'nutri-daytype-src', 'nutri-why', 'nutri-target', 'nutri-plan', 'nutri-fuel-block', 'nutri-ride-wrap', 'nutri-fuel-body', 'eat-body', 'intake', 'r-verdict']) els[id] = doc.el(id);
  els['nutri-auto'] = doc.el('nutri-auto', { tag: 'button', hidden: true });
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
  // the day builder and the intake rings: both read window.nutriTarget() when refreshed
  if (hooks === true) {
    window.bldRefresh = () => calls.push(['bld', window.nutriTarget().k]);
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

test('planFor / solveScale ports agree with lib/nutrition/scale.mjs (example plan + units, manual and ml parts)', () => {
  const syn = plain(buildNutriToday(buildNutrition(SYN_ING, SYN_PLAN), SYN_PLAN, { units: { g: 'g', ml: 'ml', ud: 'pc' }, dec: ',' }));
  for (const nutri of [bake(), syn]) {
    const { api } = run({ nutri });
    for (const g of ['maintain', 'cut', 'bulk']) for (const d of ['rest', 'gym', 'bike', 'bikeLong']) for (const min of [null, 60, 120, 185, 240, 360]) {
      assert.deepEqual(plain(api.planFor(nutri, g, d, min)), plain(planFor(nutri, g, d, min)), `${g}/${d}/${min}`);
    }
    for (const day of ['train', 'rest']) for (let target = 300; target < 5000; target += 173) {
      assert.deepEqual(plain(api.solveScale(nutri.base[day], target, nutri.fmt)), plain(solveScale(nutri.base[day], target, nutri.fmt)), `${day}/${target}`);
    }
  }
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
  assert.match(els['nutri-plan'].innerHTML, /class="mp mp-flex"><span class="mp-l">Bread<span class="mp-dir" role="img" aria-label="portion scaled (up|down) to the target">[↑↓]<\/span><\/span><span class="mp-q">\d+ g<\/span><\/li>/);
  assert.doesNotMatch(els['nutri-plan'].innerHTML, /mp-tag|scaled<\/span>/, 'no loud "scaled" label');
  assert.equal(els['nutri-fuel-block'].hidden, true);
  assert.deepEqual(calls, [['bld', 2500], ['intake', 2500]], 'the day builder and the rings are refreshed with today\'s target');
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
  assert.deepEqual(calls, [['bld', x.mt.k], ['intake', x.mt.k]], 'rings and builder get the meals target');
});

test('a programmed bike session: bike (auto), picker defaults to 2 h; picking 3 h re-scales the meals, fuel, rings', () => {
  const { els, fire, api, calls, storage } = run({ programmed: { kind: 'bike', focus: 'Ride', blocks: [] } });
  assert.equal(api.state().dayType, 'bike');
  assert.match(els['nutri-ride-wrap'].innerHTML, /<option value="120" selected>2 h<\/option>/);
  assert.match(els['nutri-fuel-body'].innerHTML, /120 g in total/);
  const two = planFor(bake(), 'maintain', 'bike', 120);
  const three = planFor(bake(), 'maintain', 'bike', 180);
  assert.match(els['nutri-target'].innerHTML, new RegExp('Meals ' + two.tot.k.toLocaleString('en') + ' kcal'));
  const planBefore = els['nutri-plan'].innerHTML;
  calls.length = 0;
  fire('nutri-ride-wrap', 'change', { id: 'nutri-ride', value: '180' });
  assert.equal(api.state().rideMin, 180);
  assert.match(els['nutri-fuel-body'].innerHTML, /180 g in total/);
  assert.match(els['nutri-target'].innerHTML, /ride fuel 720 kcal/);
  assert.match(els['nutri-target'].innerHTML, new RegExp('Meals ' + three.tot.k.toLocaleString('en') + ' kcal'));
  assert.ok(three.tot.k < two.tot.k, 'a longer ride leaves less for the meals');
  assert.notEqual(els['nutri-plan'].innerHTML, planBefore, 'Plan de hoy re-rendered with the new amounts');
  assert.deepEqual(calls, [['bld', three.mt.k], ['intake', three.mt.k]]);
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
  assert.deepEqual(s.calls.map((c) => c[1]), [2500, 2500, 3050, 3050], 'builder + rings follow every day type change');
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
  assert.doesNotMatch(run({ nutri }).els['nutri-target'].innerHTML, /short|over:/);
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
  assert.match(html, /Only whole-unit portions are adjustable/);
  assert.match(html, new RegExp('Carb portions ×' + x.factor.toFixed(2)));
});

test('Inicio card: day type + goal and today\'s target kcal / macros', () => {
  const { els } = run({ items: [{ modality: 'run', dur: 45 }] });
  const h = els['eat-body'].innerHTML;
  assert.match(h, /Gym or run \(auto\) · Maintain/);
  assert.match(h, /~3,050<span>kcal/);
  assert.match(h, /<b>150 g<\/b><span>Protein/);
});

test('window.nutriTarget: today\'s target (goal x day type) for the day builder and the rings; on bike days the MEALS target', () => {
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

test('a failing day builder never leaves the rings stale; a failing ring refresh says so', () => {
  const calls = [];
  const s = run({ hooks: { bldRefresh: () => { throw new Error('x'); }, intakeRefresh: () => calls.push('intake') } });
  s.api.setGoal('cut');
  assert.deepEqual(calls, ['intake', 'intake']);
  const t = run({ hooks: { intakeRefresh: () => { throw new Error('x'); } } });
  assert.match(t.els.intake.innerHTML, /could not be shown/);
});

test('Spanish: labels, thousands with a dot, decimal comma in the carb factor', () => {
  const { els } = run({ locale: 'es', nutri: bake({ units: { g: 'g', ml: 'ml', ud: 'ud' }, dec: ',' }) });
  assert.match(els['nutri-target'].innerHTML, /<b class="nt-kcal">2\.500<\/b>/);
  assert.match(els['nutri-target'].innerHTML, /Proteína/);
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

test('no day builder / rings scripts and no NUTRI: nothing throws', () => {
  assert.doesNotThrow(() => run({ hooks: false }));
  assert.doesNotThrow(() => run({ nutri: null }));
});

test('setGoal refreshes everything that reads the target at once: summary, chip, plan, Inicio card, builder and rings (nutriTarget)', () => {
  const s = run();
  const plan0 = s.els['nutri-plan'].innerHTML;
  s.calls.length = 0;
  s.api.setGoal('cut');
  assert.equal(s.window.nutriTarget().k, 2150);
  assert.deepEqual(s.calls, [['bld', 2150], ['intake', 2150]]);
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
