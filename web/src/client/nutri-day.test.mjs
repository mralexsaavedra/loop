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

function run({ nutri = bake(), items = [], programmed = null, locale = 'en', storage = memStorage(), today = TODAY, setDay = null, extra = {} } = {}) {
  const doc = new StubDocument();
  const els = {};
  for (const id of ['nutri-goal', 'nutri-daytype', 'nutri-daytype-src', 'nutri-why', 'nutri-target', 'nutri-plan', 'nutri-fuel-block', 'nutri-ride-wrap', 'nutri-fuel-body', 'eat-body']) els[id] = doc.el(id);
  els['nutri-auto'] = doc.el('nutri-auto', { tag: 'button', hidden: true });
  els['nutri-fuel-block'].hidden = true;
  const radios = {};
  for (const g of ['maintain', 'cut', 'bulk']) radios['g-' + g] = doc.el(null, { tag: 'input', attrs: { name: 'nutri-goal', value: g } });
  for (const d of ['rest', 'gym', 'bike', 'bikeLong']) radios['d-' + d] = doc.el(null, { tag: 'input', attrs: { name: 'nutri-day', value: d } });
  const calls = [];
  const window = { localStorage: storage };
  if (setDay !== false) window.setDay = setDay || ((d) => calls.push(d));
  const ctx = {
    document: doc, window, NUTRI: nutri, I18N_NUTRI: locale === 'es' ? esN : enN, I18N_DATE: locale === 'es' ? esDate : enDate, LOCALE: locale,
    SCORES: { timeline: { asOf: today, days: [{ date: today, sleep: 7.5, items }] } },
    TRAINING: programmed ? { [today]: programmed } : {},
    Math, String, Number, JSON, Array, Object, isFinite, Date: fixedDate(today), ...extra,
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  const fire = (id, evt, target) => els[id]._listeners[evt].forEach((fn) => fn({ target }));
  return { els, radios, window, calls, storage, fire, api: window.HCNutri };
}
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

test('no workout, nothing programmed: rest (auto), the default goal, rest target and plan; no fuelling block', () => {
  const { els, radios, calls } = run();
  assert.deepEqual(checkedOf(radios, 'g-'), ['maintain']);
  assert.deepEqual(checkedOf(radios, 'd-'), ['rest']);
  assert.equal(els['nutri-daytype-src'].textContent, '(auto)');
  assert.equal(els['nutri-auto'].hidden, true);
  assert.match(els['nutri-why'].textContent, /No workout recorded or programmed today/);
  assert.match(els['nutri-target'].innerHTML, /<b>2,500<\/b><span>kcal<\/span>/);
  assert.match(els['nutri-target'].innerHTML, /<b>150 g<\/b><span>Protein<\/span>/);
  assert.match(els['nutri-target'].innerHTML, /<b>340 g<\/b><span>Carbs<\/span>/);
  assert.match(els['nutri-plan'].innerHTML, /class="meal-name">Breakfast</);
  assert.match(els['nutri-plan'].innerHTML, /class="mp mp-flex"><span class="mp-l">Bread<\/span><span class="mp-q">\d+ g<\/span><span class="mp-tag"/);
  assert.equal(els['nutri-fuel-block'].hidden, true);
  assert.deepEqual(calls, ['rest'], 'the legacy train/rest state follows the day type');
});

test('a long ride recorded today: bikeLong (auto) with its minutes, the ride fuel block, the plan counts the fuel', () => {
  const { els, radios, api, calls } = run({ items: [{ modality: 'gym', dur: 50 }, { modality: 'bike', dur: 185 }] });
  assert.deepEqual(checkedOf(radios, 'd-'), ['bikeLong']);
  assert.match(els['nutri-why'].textContent, /Ride recorded today: 3 h 5 min/);
  assert.equal(els['nutri-fuel-block'].hidden, false);
  assert.match(els['nutri-ride-wrap'].innerHTML, /<option value="185" selected>3 h 5 min \(recorded\)<\/option>/);
  assert.match(els['nutri-fuel-body'].innerHTML, /60–90 g\/h/);
  assert.match(els['nutri-fuel-body'].innerHTML, /Not medical advice/);
  assert.match(els['nutri-fuel-body'].innerHTML, /70\.0 kg/);
  assert.match(els['nutri-fuel-body'].innerHTML, /185–280 g \(~230 g\) in total/);
  assert.match(els['nutri-target'].innerHTML, /Meals [\d,]+ kcal \+ ride fuel [\d,]+ kcal = [\d,]+ kcal/);
  assert.equal(api.state().rideMin, 185);
  assert.deepEqual(calls, ['train']);
});

test('a programmed bike session: bike (auto), picker defaults to 2 h; picking 3 h re-renders fuel and the day total', () => {
  const { els, fire, api } = run({ programmed: { kind: 'bike', focus: 'Ride', blocks: [] } });
  assert.equal(api.state().dayType, 'bike');
  assert.match(els['nutri-ride-wrap'].innerHTML, /<option value="120" selected>2 h<\/option>/);
  assert.match(els['nutri-fuel-body'].innerHTML, /120 g in total/);
  fire('nutri-ride-wrap', 'change', { id: 'nutri-ride', value: '180' });
  assert.equal(api.state().rideMin, 180);
  assert.match(els['nutri-fuel-body'].innerHTML, /180 g in total/);
  assert.match(els['nutri-target'].innerHTML, /ride fuel 720 kcal/);
});

test('manual override: stored with its date, "(chosen)", back-to-auto button; picking the detected type clears it', () => {
  const s = run();
  s.fire('nutri-daytype', 'change', { name: 'nutri-day', value: 'gym' });
  assert.equal(s.api.state().dayType, 'gym');
  assert.equal(s.els['nutri-daytype-src'].textContent, '(chosen)');
  assert.equal(s.els['nutri-auto'].hidden, false);
  assert.match(s.els['nutri-auto'].textContent, /Use the detected one: Rest/);
  assert.deepEqual(JSON.parse(s.storage.data['hc.nutri.dayType']), { date: TODAY, type: 'gym' });
  assert.match(s.els['nutri-target'].innerHTML, /<b>3,050<\/b>/);
  assert.deepEqual(s.calls, ['rest', 'train']);
  s.els['nutri-auto']._listeners.click[0]();
  assert.equal(s.api.state().dayType, 'rest');
  assert.equal(s.storage.data['hc.nutri.dayType'], undefined);
  s.fire('nutri-daytype', 'change', { value: 'rest' });
  assert.equal(s.api.state().override, null);
});

test('a stored override from another day has expired; today\'s is honoured', () => {
  const old = run({ storage: memStorage({ 'hc.nutri.dayType': JSON.stringify({ date: '2030-01-09', type: 'bike' }) }) });
  assert.equal(old.api.state().dayType, 'rest');
  const fresh = run({ storage: memStorage({ 'hc.nutri.dayType': JSON.stringify({ date: TODAY, type: 'bike' }) }) });
  assert.equal(fresh.api.state().dayType, 'bike');
  assert.equal(fresh.els['nutri-daytype-src'].textContent, '(chosen)');
});

test('goal choice persists; an unknown stored goal or broken storage falls back to the plan default', () => {
  const s = run();
  s.fire('nutri-goal', 'change', { name: 'nutri-goal', value: 'cut' });
  assert.equal(s.storage.data['hc.nutri.goal'], 'cut');
  assert.match(s.els['nutri-target'].innerHTML, /<b>2,150<\/b>/);
  assert.equal(run({ storage: memStorage({ 'hc.nutri.goal': 'bulk' }) }).api.state().goal, 'bulk');
  assert.equal(run({ storage: memStorage({ 'hc.nutri.goal': 'shred', 'hc.nutri.dayType': '{broken' }) }).api.state().goal, 'maintain');
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const t = run({ storage: throwing });
  t.fire('nutri-goal', 'change', { value: 'bulk' });
  assert.equal(t.api.state().goal, 'bulk', 'works without storage');
});

test('every goal x day type renders a target and a plan (all 12)', () => {
  const s = run();
  for (const g of ['maintain', 'cut', 'bulk']) for (const d of ['rest', 'gym', 'bike', 'bikeLong']) {
    s.fire('nutri-goal', 'change', { value: g });
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
  assert.match(lunch, /💊 Demo Creatine 3 g/);
  assert.match(html, /Other supplements today/);
  assert.match(html, /💊 Demo Electrolytes \(Pre-workout\)/);
});

test('a remainder beyond the tolerance is stated with what to do; within it nothing is said', () => {
  const nutri = bake();
  assert.doesNotMatch(run({ nutri }).els['nutri-target'].innerHTML, /short|over:/);
  nutri.plans.maintain.rest.rem = 300;
  nutri.plans.maintain.rest.tot.k -= 300;
  assert.match(run({ nutri }).els['nutri-target'].innerHTML, /~300 kcal short: add ~75 g of carbs/);
  nutri.plans.maintain.rest.rem = -200;
  assert.match(run({ nutri }).els['nutri-target'].innerHTML, /~200 kcal over: trim fat or extras/);
});

test('protein or fat far from the target is flagged (they are not scaled)', () => {
  const nutri = bake();
  nutri.plans.maintain.rest.tot.p = 120;
  assert.match(run({ nutri }).els['nutri-target'].innerHTML, /plan's protein \(120 g\) is off the target \(150 g\)/);
});

test('Inicio card: day type + goal and today\'s target kcal / macros', () => {
  const { els } = run({ items: [{ modality: 'run', dur: 45 }] });
  const h = els['eat-body'].innerHTML;
  assert.match(h, /Gym or run \(auto\) · Maintain/);
  assert.match(h, /~3,050<span>kcal/);
  assert.match(h, /<b>150 g<\/b><span>Protein/);
});

test('window.nutriTarget gives the intake rings today\'s target', () => {
  const { window } = run();
  const t = window.nutriTarget();
  assert.deepEqual([t.k, t.p, t.c, t.g], [2500, 150, 340, 60]);
  assert.match(t.label, /Rest · Maintain/);
});

test('Spanish: labels, thousands with a dot, decimal comma in the carb factor', () => {
  const { els } = run({ locale: 'es' });
  assert.match(els['nutri-target'].innerHTML, /<b>2\.500<\/b>/);
  assert.match(els['nutri-target'].innerHTML, /Proteína/);
  assert.match(els['nutri-plan'].innerHTML, /Raciones de carbohidratos ×1,\d+/);
  assert.equal(els['nutri-daytype-src'].textContent, '(auto)');
});

test('per-block isolation: a broken plan shows a one-line message there, the summary still renders', () => {
  const nutri = bake();
  nutri.base.rest = null;
  const { els } = run({ nutri });
  assert.match(els['nutri-plan'].innerHTML, /could not be shown|no meals/);
  assert.match(els['nutri-target'].innerHTML, /2,500/);
});

test('no setDay (Registro script absent) and no NUTRI: nothing throws', () => {
  assert.doesNotThrow(() => run({ setDay: false }));
  assert.doesNotThrow(() => run({ nutri: null }));
});
