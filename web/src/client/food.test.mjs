/* web/src/client/food-*.js (core, sheet, catalog, log) — Nutrición food log (Registrar, the add sheet, Mis productos, Mis recetas).
 * Runs the real classic script in node:vm against web/test/dom-stub.mjs with a stubbed fetch and a
 * fixed clock; nothing real is requested. The formula port is pinned against lib/nutrition/foodlog.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { loadUtil, FOOD_SOURCE } from '../../test/client-util.mjs';
import { es as esF, en as enF } from '../i18n/food-templates.mjs';
import { es as esDate, en as enDate } from '../i18n/date-templates.mjs';
import { FOOD_MEALS, FOOD_STORES, FOOD_UNITS, FOOD_LIMITS } from '../../../lib/nutrition/foodlog.mjs';
import { FOODLOG_CASES, runCase, BASIC_CASES, runBasicCase } from '../../../lib/nutrition/foodlog.cases.mjs';
import { buildBasics } from '../../../lib/nutrition/basics.mjs';
import { MEAL_GROUPS, MAIN_SLOTS, ADDON_GROUP, ADDON_SLOT, LATE_NIGHT_HOUR } from '../../../lib/nutrition/slots.mjs';
const FOOD_CONST = { meals: FOOD_MEALS, stores: FOOD_STORES, units: FOOD_UNITS, limits: FOOD_LIMITS, groups: MEAL_GROUPS, mainSlots: MAIN_SLOTS, addonGroup: ADDON_GROUP, addonSlot: ADDON_SLOT, lateNightHour: LATE_NIGHT_HOUR };

const here = path.dirname(fileURLToPath(import.meta.url));
const source = FOOD_SOURCE; // the four food scripts, in page order
const ING = JSON.parse(fs.readFileSync(path.join(here, '../../../data/nutrition/ingredients.json'), 'utf8')).ingredients;
const BASICS = { es: buildBasics(ING, 'es'), en: buildBasics(ING, 'en') };
const TODAY = '2030-01-10';
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const text = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });

const YOG = { id: 1, name: 'Yogur natural', brand: 'Hacendado', store: 'mercadona', barcode: null, unit: 'g', per100: { kcal: 60, protein: 10, carbs: 4, fat: 0.2 }, servingSize: 125, source: 'label' };
const MILK = { id: 2, name: 'Leche', brand: null, store: 'dia', barcode: null, unit: 'ml', per100: { kcal: 46, protein: 3.4, carbs: 4.8, fat: 1.6 }, servingSize: null, source: 'off' };
const OATS = { id: 3, name: 'Avena', brand: null, store: 'eroski', barcode: null, unit: 'g', per100: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 }, servingSize: 40, source: 'manual' };
const RECIPE = { id: 9, name: 'Porridge', kind: 'serving', servings: 2, cookedWeightG: null, ingredients: [{ productId: 3, amount: 80, name: 'Avena', unit: 'g' }, { productId: 2, amount: 300, name: 'Leche', unit: 'ml' }], complete: true, perServing: { kcal: 218, protein: 10.5, carbs: 30.7, fat: 5.2 }, per100: null };
const ENTRY = { id: 50, date: TODAY, meal: 'breakfast', refType: 'product', refId: 1, label: 'Yogur natural', amount: 1, unit: 'serving', kcal: 75, protein: 12.5, carbs: 5, fat: 0.3 };
const TOTALS1 = { kcal: 75, protein: 12.5, carbs: 5, fat: 0.3, count: 1, missing: { protein: false, carbs: false, fat: false } };

function fixedDate(iso, time = '12:00:00') {
  const RealDate = Date;
  return class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(iso + 'T' + time); }
    static now() { return new RealDate(iso + 'T' + time).getTime(); }
  };
}

/** routes: { 'GET /api/food/products': response | fn(init, n) | Error }; unknown -> network error */
function setup({ routes = {}, locale = 'es', fetchImpl, extraIds = [], time, basics, location, foodConst = FOOD_CONST } = {}) {
  const calls = [];
  const counts = {};
  const fetch = fetchImpl || (async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    calls.push({ key, init, body: init.body ? JSON.parse(init.body) : undefined });
    counts[key] = (counts[key] || 0) + 1;
    const r = routes[key];
    if (r === undefined) throw new TypeError('Failed to fetch');
    const res = typeof r === 'function' ? r(init, counts[key]) : r;
    if (res instanceof Error) throw res;
    return res;
  });
  const doc = new StubDocument();
  const listeners = {};
  doc.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  const fire = (type, target, extra = {}) => (listeners[type] || []).forEach((fn) => fn({ type, target, preventDefault() {}, ...extra }));
  const els = {};
  for (const id of ['food-log', 'food-msg', 'fp-body', 'fp-msg', 'fr-body', 'fr-msg', ...extraIds]) els[id] = doc.el(id);
  for (const id of ['food-log-block', 'food-products', 'food-recipes']) els[id] = doc.el(id, { hidden: true });
  // the day navigator (static markup in Dia.astro): prev / next / back to today + the live date label
  for (const [id, act] of [['food-day-prev', 'day-prev'], ['food-day-next', 'day-next'], ['food-day-today', 'day-today']]) els[id] = doc.el(id, { tag: 'button', attrs: { 'data-food-act': act } });
  els['food-day-label'] = doc.el('food-day-label');
  const hooks = [];
  const opened = [];
  const window = {
    HCNutri: { refresh: () => hooks.push('nutri') },
    intakeRefresh: () => hooks.push('intake'),
    HCDetail: { open: (key, date, opts) => opened.push([key, opts]), close: () => opened.push(['close']) },
  };
  const ctx = {
    document: doc, window, I18N_FOOD: locale === 'es' ? esF : enF, FOOD_CONST: foodConst, FOOD_BASICS: basics === undefined ? BASICS[locale] : basics,
    LOCALE: locale, I18N_DATE: locale === 'es' ? esDate : enDate, Date: fixedDate(TODAY, time), Math, JSON, Number, String, Object, Array, Promise, isFinite, fetch, Uint8Array, setTimeout, clearTimeout,
    ...(location ? { location } : {}),
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  const button = (attrs) => doc.el(null, { tag: 'button', attrs });
  const input = (id, value) => { const el = doc.el(id, { tag: 'input' }); el.value = value; return el; };
  return { ctx, doc, els, calls, window, hooks, opened, fire, button, input, F: window.HCFood };
}

const BOOT = {
  'GET /api/food/products': json({ products: [YOG, MILK, OATS] }),
  'GET /api/food/recipes': json({ recipes: [RECIPE] }),
  [`GET /api/food/log?date=${TODAY}`]: json({ date: TODAY, entries: [ENTRY], totals: TOTALS1 }),
};

test('parity: the page computes exactly what lib/nutrition/foodlog.mjs computes', () => {
  const { F } = setup({ fetchImpl: async () => { throw new TypeError('x'); } });
  for (const c of FOODLOG_CASES) assert.deepEqual(JSON.parse(JSON.stringify(runCase(c, F))), c.expect, c.name);
});

test('no food API (artifact, file://, example build): everything stays hidden, no sheet, no totals', async () => {
  const t = setup();
  await flush();
  assert.equal(t.els['food-log-block'].hidden, true);
  assert.equal(t.els['food-products'].hidden, true);
  assert.equal(t.els['food-recipes'].hidden, true);
  assert.equal(t.els['food-log'].innerHTML, '');
  assert.equal(t.window.foodTotals(), null);
  assert.equal(t.window.HCViews, undefined, 'the add sheet is registered only when the server answers');
  assert.deepEqual(t.hooks, ['nutri'], 'Resumen de hoy re-renders (it refreshes the rings itself): the dial + rings fall back to the Apple Health day, now that the API is known absent');
});

test('HCFood.pending(): true while the boot request is in flight, false once it answers or fails; each re-renders the rings', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const t = setup({ routes: { ...BOOT, 'GET /api/food/products': () => gate.then(() => BOOT['GET /api/food/products']) } });
  assert.equal(t.F.pending(), true, 'set synchronously at load, before intake.js renders');
  assert.equal(t.F.ready(), false);
  release();
  await flush();
  assert.equal(t.F.pending(), false);
  assert.equal(t.F.ready(), true);
  assert.equal(t.hooks[0], 'intake', 'the rings leave the pending state at once (today\'s log follows)');
  const f = setup();
  assert.equal(f.F.pending(), true);
  await flush();
  assert.equal(f.F.pending(), false);
  assert.equal(f.F.ready(), false);
});

test('no fetch at all: the script still defines a null foodTotals and touches nothing', () => {
  const doc = new StubDocument();
  const ctx = { document: doc, window: {}, I18N_FOOD: esF, FOOD_CONST, LOCALE: 'es', Date: fixedDate(TODAY) };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  assert.equal(ctx.window.foodTotals(), null);
});

test('server answers: hosts appear, every request carries X-HC-Food, today is the viewer\'s local date', async () => {
  const t = setup({ routes: BOOT });
  await flush();
  assert.equal(t.els['food-log-block'].hidden, false);
  assert.equal(t.els['food-products'].hidden, false);
  assert.equal(t.els['food-recipes'].hidden, false);
  assert.deepEqual(t.calls.map((c) => c.key).sort(), ['GET /api/food/log?date=2030-01-10', 'GET /api/food/products', 'GET /api/food/recipes']);
  for (const c of t.calls) assert.equal(c.init.headers['X-HC-Food'], '1');
  assert.ok(t.window.HCViews['food-add'], 'the add sheet view is registered');
  assert.deepEqual(t.hooks, ['intake', 'nutri'], 'the rings leave the boot wait, then Resumen de hoy re-reads the totals (it refreshes the rings itself)');
});

test('Registrar: four groups (Desayuno, Comida, Cena, Añadidos), entry kcal + P/C/G, a labelled delete button, one add button per group, the day total', async () => {
  const t = setup({ routes: BOOT });
  await flush();
  const html = t.els['food-log'].innerHTML;
  for (const g of MEAL_GROUPS) assert.match(html, new RegExp(`id="food-add-${g}"[^>]*data-food-act="add"[^>]*data-meal="${g}"`));
  for (const s of ['preworkout', 'postworkout', 'snack']) assert.doesNotMatch(html, new RegExp(`id="food-add-${s}"`), 'no card per add-on slot');
  assert.deepEqual([...html.matchAll(/<h3 class="food-meal-name"[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1]), ['Desayuno', 'Comida', 'Cena', 'Añadidos']);
  assert.match(html, /aria-label="Añadir a Desayuno"/);
  assert.match(html, /aria-label="Añadir a Añadidos"/);
  assert.match(html, /data-food-act="del" data-id="50" aria-label="Borrar Yogur natural"/);
  assert.match(text(html), /Registrado hoy 75 kcal/);
  // a list row: name · amount (secondary) on the left with the macros as the small line, kcal alone on the right
  assert.match(text(html), /Yogur natural 1 ración P 12,5 · C 5 · G 0,3 75 kcal/);
  assert.match(html, /<li class="fe"><div class="fe-main"><span class="fe-label">Yogur natural<\/span><span class="fe-amt">1 ración<\/span><span class="fe-pcf">P 12,5 · C 5 · G 0,3<\/span><\/div><div class="fe-side"><span class="fe-kcal"><b>75<\/b> kcal<\/span><\/div><button type="button" class="food-icon-btn" data-food-act="del"/);
});

test('Registrar: pre / post workout and snack entries show in Añadidos with a tiny muted slot tag; main meals carry no tag', async () => {
  const pre = { ...ENTRY, id: 61, meal: 'preworkout', refType: 'quick', refId: null, label: 'Plátano', amount: 1, unit: 'serving', kcal: 105, protein: 1.3, carbs: 27, fat: 0.4 };
  const snack = { ...ENTRY, id: 62, meal: 'snack', refType: 'quick', refId: null, label: 'Café', amount: 1, unit: 'serving', kcal: 30, protein: 2, carbs: 3, fat: 1 };
  const dinner = { ...ENTRY, id: 63, meal: 'dinner', label: 'Merluza' };
  const totals = { kcal: 285, protein: 18.3, carbs: 38, fat: 1.7, count: 4, missing: { protein: false, carbs: false, fat: false } };
  const t = setup({ routes: { ...BOOT, [`GET /api/food/log?date=${TODAY}`]: json({ date: TODAY, entries: [ENTRY, pre, snack, dinner], totals }) } });
  await flush();
  const html = t.els['food-log'].innerHTML;
  const groups = Object.fromEntries(html.split('<section class="food-meal" ').slice(1).map((s) => [s.match(/aria-labelledby="fm-h-(\w+)"/)[1], s]));
  assert.deepEqual(Object.keys(groups), ['breakfast', 'lunch', 'dinner', 'addon']);
  assert.match(groups.addon, /Plátano<\/span><span class="fe-slot">Pre-entreno<\/span>/);
  assert.match(groups.addon, /Café<\/span><span class="fe-slot">Tentempié<\/span>/);
  assert.match(groups.addon, /<span class="food-meal-kcal"><b>135<\/b> kcal<\/span>/, 'the group kcal = its entries');
  assert.match(groups.dinner, /Merluza/);
  assert.doesNotMatch(groups.dinner + groups.breakfast, /fe-slot/);
  assert.doesNotMatch(groups.lunch, /class="fe"/, 'an empty group lists nothing');
});
test('foodTotals: today with >= 1 entry only (never from the target), with the missing-macro flags', async () => {
  const t = setup({ routes: BOOT });
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(t.window.foodTotals())), { date: TODAY, k: 75, p: 12.5, c: 5, g: 0.3, n: 1, missing: { protein: false, carbs: false, fat: false }, src: 'log' });
  const empty = setup({ routes: { ...BOOT, [`GET /api/food/log?date=${TODAY}`]: json({ date: TODAY, entries: [], totals: { ...TOTALS1, kcal: 0, protein: 0, carbs: 0, fat: 0, count: 0 } }) } });
  await flush();
  assert.equal(empty.window.foodTotals(), null);
});

test('the add sheet: opens on the tapped meal, lists products by store, filters by search', async () => {
  const t = setup({ routes: BOOT, extraIds: ['fa-list'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'lunch' }));
  assert.equal(t.opened[0][0], 'food-add');
  assert.equal(t.opened[0][1].focus, '#fa-q, #fa-label', 'focus lands in the search (or the quick name), not the meal select');
  const view = t.window.HCViews['food-add'];
  assert.equal(view.title(), 'Añadir comida');
  const { body } = view.render();
  assert.match(body, /<option value="lunch" selected>Comida<\/option>/);
  assert.match(body, /<label[^>]*for="fa-meal"/);
  assert.match(body, /<label[^>]*for="fa-q"/);
  for (const s of ['Mercadona', 'Dia', 'Eroski']) assert.match(body, new RegExp(s));
  assert.match(body, /data-food-act="pick" data-kind="product" data-id="1"/);
  t.fire('input', t.input('fa-q', 'lech'));
  assert.match(t.els['fa-list'].innerHTML, /Leche/);
  assert.doesNotMatch(t.els['fa-list'].innerHTML, /Yogur/);
});

test('adding a product: live preview with the shared formula, POST with the local date, then refresh + announce + close', async () => {
  let posted;
  const routes = {
    ...BOOT,
    'POST /api/food/log': (init) => {
      posted = JSON.parse(init.body);
      return json({ entry: { ...ENTRY, id: 51, meal: 'lunch', label: 'Leche', refId: 2, amount: 250, unit: 'ml', kcal: 115, protein: 8.5, carbs: 12, fat: 4 }, totals: { ...TOTALS1, kcal: 190, protein: 21, carbs: 17, fat: 4.3, count: 2 } }, 201);
    },
  };
  const t = setup({ routes, extraIds: ['fa-panel', 'fa-prev', 'fa-msg', 'food-add-lunch'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'lunch' }));
  t.window.HCViews['food-add'].render();
  t.input('fa-meal', 'lunch');
  t.fire('click', t.button({ 'data-food-act': 'pick', 'data-kind': 'product', 'data-id': '2' }));
  assert.match(t.els['fa-panel'].innerHTML, /<option value="ml" selected>ml<\/option>/);
  assert.doesNotMatch(t.els['fa-panel'].innerHTML, /value="serving"/, 'no serving without a serving size');
  const amt = t.input('fa-amt', '250');
  t.input('fa-unit', 'ml');
  t.fire('input', amt);
  assert.match(text(t.els['fa-prev'].innerHTML), /115 kcal/);
  t.hooks.length = 0;
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.match(posted.requestId, /^[A-Za-z0-9-]{8,64}$/, 'every add carries its request id');
  delete posted.requestId;
  assert.deepEqual(posted, { date: TODAY, meal: 'lunch', refType: 'product', refId: 2, amount: 250, unit: 'ml' });
  const post = t.calls.find((c) => c.key === 'POST /api/food/log');
  assert.equal(post.init.headers['Content-Type'], 'application/json');
  assert.equal(post.init.headers['X-HC-Food'], '1');
  assert.deepEqual(t.opened.at(-1), ['close']);
  assert.match(t.els['food-log'].innerHTML, /Leche/);
  assert.equal(t.window.foodTotals().k, 190);
  assert.deepEqual(t.hooks, ['nutri']);
  assert.equal(t.els['food-msg'].textContent, 'Añadido: Leche (115 kcal).');
});

test('a decimal comma is accepted; an amount the unit cannot take is not sent', async () => {
  const t = setup({ routes: { ...BOOT, 'POST /api/food/log': json({}, 500) }, extraIds: ['fa-panel', 'fa-prev', 'fa-msg'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'breakfast' }));
  t.window.HCViews['food-add'].render();
  t.fire('click', t.button({ 'data-food-act': 'pick', 'data-kind': 'product', 'data-id': '1' }));
  t.input('fa-unit', 'serving');
  t.fire('input', t.input('fa-amt', '1,5'));
  assert.match(text(t.els['fa-prev'].innerHTML), /113 kcal/);
  t.input('fa-amt', '0');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(t.calls.filter((c) => c.key === 'POST /api/food/log').length, 0);
  assert.equal(t.els['fa-msg'].textContent, esF.sheet.previewNone);
});

test('switching a product to servings sets the amount to 1; back to its unit sets the serving size', async () => {
  const t = setup({ routes: BOOT, extraIds: ['fa-panel', 'fa-prev', 'fa-msg'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'breakfast' }));
  t.window.HCViews['food-add'].render();
  t.fire('click', t.button({ 'data-food-act': 'pick', 'data-kind': 'product', 'data-id': '3' }));
  assert.match(t.els['fa-panel'].innerHTML, /<option value="g" selected>g<\/option><option value="serving">/);
  t.input('fa-amt', '25');
  t.fire('change', t.input('fa-unit', 'serving'));
  assert.equal(t.doc.getElementById('fa-amt').value, '1', '25 typed as grams never becomes 25 servings');
  assert.match(text(t.els['fa-prev'].innerHTML), /149 kcal/);
  t.input('fa-amt', '2');
  t.fire('change', t.input('fa-unit', 'g'));
  assert.equal(t.doc.getElementById('fa-amt').value, '40', 'back to grams = one serving in grams');
  assert.match(text(t.els['fa-prev'].innerHTML), /149 kcal/);
  t.fire('change', t.input('fa-unit', 'g'));
  assert.equal(t.doc.getElementById('fa-amt').value, '40', 'the same unit again changes nothing');
});

test('a recipe entry is logged in servings; a quick entry sends only what the user typed', async () => {
  const bodies = [];
  const routes = { ...BOOT, 'POST /api/food/log': (init) => { const b = JSON.parse(init.body); delete b.requestId; bodies.push(b); return json({ entry: { ...ENTRY, id: 60 + bodies.length }, totals: TOTALS1 }, 201); } };
  const t = setup({ routes, extraIds: ['fa-panel', 'fa-prev', 'fa-msg'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'dinner' }));
  t.window.HCViews['food-add'].render();
  t.fire('click', t.button({ 'data-food-act': 'tab', 'data-tab': 'recipes' }));
  assert.match(t.els['fa-panel'].innerHTML, /data-food-act="pick" data-kind="recipe" data-id="9"/);
  t.fire('click', t.button({ 'data-food-act': 'pick', 'data-kind': 'recipe', 'data-id': '9' }));
  t.input('fa-amt', '1');
  t.input('fa-unit', 'serving');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.deepEqual(bodies[0], { date: TODAY, meal: 'dinner', refType: 'recipe', refId: 9, amount: 1, unit: 'serving' });

  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'snack' }));
  t.window.HCViews['food-add'].render();
  t.fire('click', t.button({ 'data-food-act': 'tab', 'data-tab': 'quick' }));
  t.input('fa-label', ' Pintxo ');
  t.input('fa-kcal', '250');
  t.input('fa-p', '');
  t.input('fa-c', '20');
  t.input('fa-f', '');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.deepEqual(bodies[1], { date: TODAY, meal: 'snack', refType: 'quick', label: 'Pintxo', kcal: 250, carbs: 20 });
});

test('save errors: offline keeps the sheet and the log untouched; atwater offers "save anyway" and resends with force', async () => {
  let n = 0;
  const routes = {
    ...BOOT,
    'POST /api/food/log': (init) => {
      n++;
      if (n === 1) return new TypeError('Failed to fetch');
      if (n === 2) return json({ error: 'atwater' }, 400);
      return json({ entry: { ...ENTRY, id: 70 }, totals: TOTALS1 }, 201);
    },
  };
  const t = setup({ routes, extraIds: ['fa-panel', 'fa-prev', 'fa-msg'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'snack' }));
  t.window.HCViews['food-add'].render();
  t.fire('click', t.button({ 'data-food-act': 'tab', 'data-tab': 'quick' }));
  t.input('fa-label', 'Barrita');
  t.input('fa-kcal', '100');
  t.input('fa-p', '30');
  t.input('fa-c', '30');
  t.input('fa-f', '10');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(t.els['fa-msg'].textContent, esF.errors.offline);
  assert.equal(t.opened.at(-1)[0], 'food-add', 'the sheet stays open');
  assert.equal(t.window.foodTotals().n, 1, 'nothing half-saved');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.match(t.els['fa-msg'].innerHTML, /data-food-act="save-force"/);
  t.fire('click', t.button({ 'data-food-act': 'save-force' }));
  await flush();
  assert.equal(t.calls.filter((c) => c.key === 'POST /api/food/log').at(-1).body.force, true);
  assert.deepEqual(t.opened.at(-1), ['close']);
});

test('deleting an entry: DELETE with the header, the entry leaves, totals recomputed, Resumen refreshed', async () => {
  const t = setup({ routes: { ...BOOT, 'DELETE /api/food/log/50': json({ ok: true }) } });
  await flush();
  t.hooks.length = 0;
  t.fire('click', t.button({ 'data-food-act': 'del', 'data-id': '50' }));
  await flush();
  const del = t.calls.find((c) => c.key === 'DELETE /api/food/log/50');
  assert.equal(del.init.headers['X-HC-Food'], '1');
  assert.doesNotMatch(t.els['food-log'].innerHTML, /data-id="50"/);
  assert.equal(t.window.foodTotals(), null, 'no entries left: back to the Apple Health intake');
  assert.deepEqual(t.hooks, ['nutri']);
  assert.equal(t.els['food-msg'].textContent, 'Borrado: Yogur natural.');
});

test('a failed delete says why in one line and keeps the entry', async () => {
  const t = setup({ routes: { ...BOOT, 'DELETE /api/food/log/50': json({ error: 'rate_limited' }, 429) } });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'del', 'data-id': '50' }));
  await flush();
  assert.match(t.els['food-log'].innerHTML, /data-id="50"/);
  assert.equal(t.els['food-msg'].textContent, esF.errors.rate_limited);
});

test('Mis productos: grouped by store with per-100 macros, edit / archive buttons labelled', async () => {
  const t = setup({ routes: BOOT });
  await flush();
  const html = t.els['fp-body'].innerHTML;
  const order = ['Mercadona', 'Dia', 'Eroski'].map((s) => html.indexOf(`>${s}<`));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'store groups in order');
  assert.match(html, /aria-label="Editar Yogur natural"/);
  assert.match(html, /aria-label="Archivar Yogur natural"/);
  assert.match(text(html), /60 kcal · P 10 · C 4 · G 0,2 por 100 g/);
});

test('Open Food Facts: a barcode result shows what OFF has, marks what is missing, and saves only after the user confirms', async () => {
  const offProduct = { code: '8480000123456', name: 'Yogur griego', brand: 'Demo', stores: 'Mercadona', unit: 'g', per100: { kcal: 130, protein: 6, carbs: 4, fat: null }, servingSize: 125, complete: false };
  let posted = [];
  const routes = {
    ...BOOT,
    'GET /api/food/off?barcode=8480000123456': json({ product: offProduct }),
    'POST /api/food/products': (init) => {
      const b = JSON.parse(init.body);
      posted.push(b);
      return b.force ? json({ product: { ...b, id: 4, per100: b.per100 } }, 201) : json({ error: 'atwater' }, 400);
    },
  };
  const t = setup({ routes, extraIds: ['fp-results', 'fp-form-msg'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'p-new' }));
  assert.ok(t.els['fp-body'].innerHTML.includes(esF.products.offCredit), 'the search panel credits Open Food Facts (ODbL)');
  t.input('fp-code', ' 8480000123456 ');
  t.fire('click', t.button({ 'data-food-act': 'p-code' }));
  await flush();
  const card = t.els['fp-results'].innerHTML;
  assert.match(text(card), /Yogur griego/);
  assert.match(card, /is-missing/);
  assert.equal(posted.length, 0, 'a lookup never saves');
  t.fire('click', t.button({ 'data-food-act': 'p-use', 'data-i': '0' }));
  const form = t.els['fp-body'].innerHTML;
  assert.match(form, /id="fpf-name"[^>]*value="Yogur griego"/);
  assert.match(form, /id="fpf-f"[^>]*value=""/);
  assert.match(form, new RegExp(esF.products.offMissing));
  assert.ok(form.includes(esF.products.offCredit), 'an OFF-filled form credits Open Food Facts');
  assert.match(form, /<label[^>]*for="fpf-kcal"/);
  for (const [id, v] of [['fpf-name', 'Yogur griego'], ['fpf-brand', 'Demo'], ['fpf-store', 'mercadona'], ['fpf-code', '8480000123456'], ['fpf-unit', 'g'], ['fpf-kcal', '130'], ['fpf-p', '6'], ['fpf-c', '4'], ['fpf-f', '10'], ['fpf-serv', '125']]) t.input(id, v);
  t.fire('click', t.button({ 'data-food-act': 'p-save' }));
  await flush();
  assert.deepEqual(posted[0], { name: 'Yogur griego', brand: 'Demo', store: 'mercadona', barcode: '8480000123456', unit: 'g', per100: { kcal: 130, protein: 6, carbs: 4, fat: 10 }, servingSize: 125, source: 'off', offCode: '8480000123456' });
  assert.match(t.els['fp-form-msg'].innerHTML, /data-food-act="p-save-force"/, '"save anyway" sits in the form, next to its save button');
  assert.equal(t.els['fp-msg'].textContent, '');
  t.fire('click', t.button({ 'data-food-act': 'p-save-force' }));
  await flush();
  assert.equal(posted[1].force, true);
  assert.match(t.els['fp-body'].innerHTML, /Yogur griego/);
  assert.equal(t.els['fp-msg'].textContent, esF.products.saved);
});

test('a product form with a missing required value is not sent', async () => {
  const t = setup({ routes: BOOT, extraIds: ['fp-form-msg', 'fpf-p-err'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'p-new' }));
  t.fire('click', t.button({ 'data-food-act': 'p-label' }));
  for (const [id, v] of [['fpf-name', 'X'], ['fpf-store', 'dia'], ['fpf-unit', 'g'], ['fpf-kcal', '100'], ['fpf-p', ''], ['fpf-c', '1'], ['fpf-f', '1']]) t.input(id, v);
  t.fire('click', t.button({ 'data-food-act': 'p-save' }));
  await flush();
  assert.equal(t.calls.filter((c) => c.key === 'POST /api/food/products').length, 0);
  assert.match(t.els['fp-form-msg'].textContent, /proteína/);
  assert.equal(t.els['fpf-p-err'].textContent, esF.fieldErrors.required);
});

test('Mis recetas: per-serving macros listed; the editor previews with the shared formula and saves ingredients', async () => {
  let posted;
  const routes = { ...BOOT, 'POST /api/food/recipes': (init) => { posted = JSON.parse(init.body); return json({ recipe: { ...RECIPE, id: 10, name: posted.name } }, 201); } };
  const t = setup({ routes, extraIds: ['frf-prev'] });
  await flush();
  assert.match(text(t.els['fr-body'].innerHTML), /Porridge.*218 kcal/);
  t.fire('click', t.button({ 'data-food-act': 'r-new' }));
  assert.match(t.els['fr-body'].innerHTML, /<label[^>]*for="frf-name"/);
  t.input('frf-name', 'Batido');
  t.input('frf-kind', 'serving');
  t.input('frf-serv', '1');
  t.fire('click', t.button({ 'data-food-act': 'r-pick', 'data-i': '0', 'data-kind': 'product', 'data-id': '2' }));
  t.fire('input', t.input('frf-amt-0', '330'));
  assert.match(text(t.els['frf-prev'].innerHTML), /152 kcal/);
  t.fire('click', t.button({ 'data-food-act': 'r-save' }));
  await flush();
  assert.deepEqual(posted, { name: 'Batido', kind: 'serving', servings: 1, ingredients: [{ productId: 2, amount: 330 }] });
  assert.equal(t.els['fr-msg'].textContent, esF.recipes.saved);
});

test('en locale: the English copy and a decimal point', async () => {
  const t = setup({ routes: BOOT, locale: 'en' });
  await flush();
  assert.match(text(t.els['food-log'].innerHTML), /Logged today 75 kcal/);
  assert.match(text(t.els['food-log'].innerHTML), /P 12\.5 · C 5 · F 0\.3/);
});

const entry = (o) => ({ ...ENTRY, ...o });

test('foodTotals: a macro NO entry states is null (a dash, never 0); a macro SOME entries lack keeps its sum, flagged as a minimum', async () => {
  const quick = [entry({ id: 1, refType: 'quick', protein: null, carbs: null, fat: null, kcal: 250 }), entry({ id: 2, refType: 'quick', protein: null, carbs: null, fat: null, kcal: 100 })];
  const all = setup({ routes: { ...BOOT, [`GET /api/food/log?date=${TODAY}`]: json({ date: TODAY, entries: quick, totals: { kcal: 350, protein: 0, carbs: 0, fat: 0, count: 2, missing: { protein: true, carbs: true, fat: true } } }) } });
  await flush();
  const a = all.window.foodTotals();
  assert.equal(a.k, 350);
  assert.equal(a.p, null);
  assert.equal(a.c, null);
  assert.equal(a.g, null);
  const partial = setup({ routes: { ...BOOT, [`GET /api/food/log?date=${TODAY}`]: json({ date: TODAY, entries: [ENTRY, quick[0]], totals: { kcal: 325, protein: 12.5, carbs: 5, fat: 0.3, count: 2, missing: { protein: true, carbs: true, fat: true } } }) } });
  await flush();
  const b = partial.window.foodTotals();
  assert.equal(b.p, 12.5);
  assert.equal(b.missing.protein, true, 'a minimum: some entries lack protein');
});

test('idempotent add: one request id per pending add, reused on a retry after an ambiguous failure (offline / 5xx), the log re-read after it, and a replayed row never duplicated', async () => {
  let n = 0;
  const saved = entry({ id: 80, meal: 'snack', refType: 'quick', label: 'Barrita', kcal: 200, protein: null, carbs: null, fat: null });
  const routes = {
    ...BOOT,
    'POST /api/food/log': () => {
      n++;
      if (n === 1) return new TypeError('Failed to fetch'); // the add may or may not have landed
      if (n === 2) return json({ error: 'internal' }, 500);
      return json({ entry: saved, totals: { ...TOTALS1, kcal: 275, count: 2 } }, 200); // the server replays the stored row
    },
  };
  const t = setup({ routes, extraIds: ['fa-panel', 'fa-prev', 'fa-msg'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'snack' }));
  t.window.HCViews['food-add'].render();
  t.fire('click', t.button({ 'data-food-act': 'tab', 'data-tab': 'quick' }));
  t.input('fa-label', 'Barrita');
  t.input('fa-kcal', '200');
  const logReads = () => t.calls.filter((c) => c.key === `GET /api/food/log?date=${TODAY}`).length;
  const before = logReads();
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(logReads(), before + 1, 'after an ambiguous failure the log is read again');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(logReads(), before + 2);
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  const ids = t.calls.filter((c) => c.key === 'POST /api/food/log').map((c) => c.body.requestId);
  assert.equal(ids.length, 3);
  assert.match(ids[0], /^[A-Za-z0-9-]{8,64}$/);
  assert.ok(ids.every((id) => id === ids[0]), 'the same pending add keeps its id');
  // the re-read may already have brought the row in: a replayed entry replaces, never duplicates
  const rows = t.window.HCFood.state().log.entries.filter((e) => e.id === 80);
  assert.equal(rows.length, 1);
  // a NEW add gets a new id
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'snack' }));
  t.window.HCViews['food-add'].render();
  t.fire('click', t.button({ 'data-food-act': 'tab', 'data-tab': 'quick' }));
  t.input('fa-label', 'Otra');
  t.input('fa-kcal', '50');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.notEqual(t.calls.filter((c) => c.key === 'POST /api/food/log').at(-1).body.requestId, ids[0]);
});

test('the request id works without crypto.randomUUID (plain http on the LAN is not a secure context)', async () => {
  const t = setup({ routes: { ...BOOT, 'POST /api/food/log': json({ entry: entry({ id: 90 }), totals: TOTALS1 }, 201) }, extraIds: ['fa-panel', 'fa-msg'] });
  t.ctx.crypto = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = i * 17; return a; } };
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'snack' }));
  t.window.HCViews['food-add'].render();
  t.fire('click', t.button({ 'data-food-act': 'tab', 'data-tab': 'quick' }));
  t.input('fa-label', 'x');
  t.input('fa-kcal', '1');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.match(t.calls.find((c) => c.key === 'POST /api/food/log').body.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('a delete answered 404 (already gone, e.g. a double tap) removes the row silently', async () => {
  const t = setup({ routes: { ...BOOT, 'DELETE /api/food/log/50': json({ error: 'not_found' }, 404) } });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'del', 'data-id': '50' }));
  await flush();
  assert.doesNotMatch(t.els['food-log'].innerHTML, /data-id="50"/);
  assert.equal(t.els['food-msg'].textContent, '');
  assert.equal(t.window.foodTotals(), null);
});

test('limits come baked from lib/nutrition/foodlog.mjs (FOOD_CONST.limits), never as client literals', () => {
  assert.match(source, /K\.limits/);
  assert.doesNotMatch(source, /\[0-9\]\{8,14\}/, 'the barcode pattern is baked');
  assert.doesNotMatch(source, /maxlength="(120|80)"/);
});

/* ---------- number parsing, unit suffixes, inline field errors ---------- */
// focus spy: real inputs are built by innerHTML (the stub does not parse it), so tests register them
const focusSpy = (t) => {
  const log = [];
  const reg = (id, value) => { const el = t.input(id, value); el.focus = () => log.push(id); return el; };
  return { log, reg };
};

test('parseNum: trims, takes a decimal comma, strips a trailing unit of that field; a bare unit or empty = not set; anything else is NaN', () => {
  const t = setup({ routes: {} });
  const P = t.F.parseNum;
  assert.equal(P('30 g', ['g']), 30);
  assert.equal(P('30g', ['g']), 30);
  assert.equal(P(' 30 G ', ['g']), 30);
  assert.equal(P('30 gr', ['g']), 30);
  assert.equal(P('250 ml', ['ml']), 250);
  assert.equal(P('1,5', ['g']), 1.5);
  assert.equal(P('1,5', null), 1.5);
  assert.equal(P('130 kcal', ['kcal']), 130);
  assert.equal(P('g', ['g']), null, 'only a unit: not set');
  assert.equal(P('ml', ['g']), null, 'only a unit: not set');
  assert.equal(P('  ', ['g']), null);
  assert.equal(P('', null), null);
  for (const bad of ['abc', '1e3', '-5', 'Infinity', '30 kg', '0x10', '1,5,2', '3 4']) assert.ok(Number.isNaN(P(bad, ['g'])), bad);
  assert.ok(Number.isNaN(P('250 ml', ['g'])), 'never g <-> ml');
  assert.ok(Number.isNaN(P('2 g', null)), 'a count takes no unit');
});

test('product form: a new product defaults to the FIRST configured store (FOOD_CONST.stores), not a hard-coded one', async () => {
  const stores = ['dia', ...FOOD_CONST.stores.filter((x) => x !== 'dia')];
  const t = setup({ routes: BOOT, foodConst: { ...FOOD_CONST, stores } });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'p-new' }));
  t.fire('click', t.button({ 'data-food-act': 'p-label' }));
  const html = t.els['fp-body'].innerHTML;
  assert.match(html, /<select class="food-in" id="fpf-store"><option value="dia" selected>/);
  assert.equal((html.match(/<option value="\w+" selected>[^<]*<\/option>(?=[^]*id="fpf-unit")/g) || []).length, 1, 'one store selected');
});

test('product form: the serving field says what it asks, shows the product unit as a suffix that follows "Se mide en", and has a placeholder', async () => {
  const t = setup({ routes: BOOT, extraIds: ['fpf-serv-unit'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'p-new' }));
  t.fire('click', t.button({ 'data-food-act': 'p-label' }));
  const html = t.els['fp-body'].innerHTML;
  assert.match(html, /<label class="food-lbl" for="fpf-serv">Peso de una ración \(opcional\)<\/label>/);
  assert.match(html, /id="fpf-serv"[^>]*placeholder="p\. ej\. 30"/);
  assert.match(html, /<span class="food-suffix" id="fpf-serv-unit">g<\/span>/);
  assert.match(html, /<span class="food-suffix" id="fpf-p-unit">g<\/span>/, 'per-100 macros carry "g"');
  assert.match(html, /<span class="food-suffix" id="fpf-kcal-unit">kcal<\/span>/);
  assert.match(html, /id="fpf-serv"[^>]*aria-describedby="[^"]*fpf-serv-err/);
  assert.match(html, /<small class="food-err" id="fpf-serv-err"><\/small>/);
  // the status line sits inside the form, right after the save button and before the product list
  const save = html.indexOf('id="fp-save"');
  const msg = html.indexOf('id="fp-form-msg"');
  const list = html.indexOf('class="fp-all"');
  assert.ok(save > 0 && save < msg && msg < list, 'form status next to the save button');
  assert.match(html, /id="fp-form-msg" role="status" aria-live="polite"/);
  const unit = t.input('fpf-unit', 'ml');
  t.fire('change', unit);
  assert.equal(t.els['fpf-serv-unit'].textContent, 'ml');
  const en = setup({ routes: BOOT, locale: 'en' });
  await flush();
  en.fire('click', en.button({ 'data-food-act': 'p-new' }));
  en.fire('click', en.button({ 'data-food-act': 'p-label' }));
  assert.match(en.els['fp-body'].innerHTML, /for="fpf-serv">One serving weighs \(optional\)</);
  assert.match(en.els['fp-body'].innerHTML, /placeholder="e\.g\. 30"/);
});

test('product form: "g" in the optional serving = not set; units typed after numbers are accepted', async () => {
  const posted = [];
  const routes = { ...BOOT, 'POST /api/food/products': (init) => { const b = JSON.parse(init.body); posted.push(b); return json({ product: { ...b, id: 4 + posted.length } }, 201); } };
  const t = setup({ routes, extraIds: ['fp-form-msg'] });
  await flush();
  const fill = (serv) => {
    t.fire('click', t.button({ 'data-food-act': 'p-new' }));
    t.fire('click', t.button({ 'data-food-act': 'p-label' }));
    for (const [id, v] of [['fpf-name', 'Pan'], ['fpf-store', 'dia'], ['fpf-unit', 'g'], ['fpf-kcal', '250 kcal'], ['fpf-p', '9,5 g'], ['fpf-c', '48g'], ['fpf-f', ' 2 '], ['fpf-serv', serv]]) t.input(id, v);
    t.fire('click', t.button({ 'data-food-act': 'p-save' }));
  };
  fill('g');
  await flush();
  assert.deepEqual(posted[0], { name: 'Pan', store: 'dia', unit: 'g', per100: { kcal: 250, protein: 9.5, carbs: 48, fat: 2 }, source: 'label' });
  fill('30 g');
  await flush();
  assert.equal(posted[1].servingSize, 30);
  assert.equal(t.els['fp-msg'].textContent, esF.products.saved, 'a save result outside the closed form');
});

test('product form: a non-numeric value is an inline error under its field (aria-invalid, described, focused), the form status sits in the form', async () => {
  const t = setup({ routes: BOOT, extraIds: ['fp-form-msg', 'fpf-serv-err', 'fpf-c-err'] });
  await flush();
  const f = focusSpy(t);
  t.fire('click', t.button({ 'data-food-act': 'p-new' }));
  t.fire('click', t.button({ 'data-food-act': 'p-label' }));
  for (const [id, v] of [['fpf-name', 'Pan'], ['fpf-store', 'dia'], ['fpf-unit', 'g'], ['fpf-kcal', '250'], ['fpf-p', '9'], ['fpf-f', '2']]) t.input(id, v);
  const carbs = f.reg('fpf-c', 'mucho');
  const serv = f.reg('fpf-serv', 'una');
  t.fire('click', t.button({ 'data-food-act': 'p-save' }));
  await flush();
  assert.equal(t.calls.filter((c) => c.key === 'POST /api/food/products').length, 0);
  for (const el of [carbs, serv]) {
    assert.equal(el.getAttribute('aria-invalid'), 'true');
    assert.match(el.getAttribute('aria-describedby'), new RegExp(el.getAttribute('id') + '-err'));
  }
  assert.equal(t.els['fpf-c-err'].textContent, esF.fieldErrors.number);
  assert.equal(t.els['fpf-serv-err'].textContent, esF.fieldErrors.number);
  assert.deepEqual(f.log, ['fpf-c'], 'focus on the first invalid field');
  assert.equal(t.els['fp-form-msg'].textContent, 'Revisa este dato: carbohidratos.');
  assert.equal(t.els['fp-msg'].textContent, '', 'nothing below the product list');
  // fixed and saved again: the errors clear
  carbs.value = '48';
  serv.value = '';
  t.fire('click', t.button({ 'data-food-act': 'p-save' }));
  assert.equal(carbs.getAttribute('aria-invalid'), null);
  assert.equal(t.els['fpf-c-err'].textContent, '');
});

test('product form: a server "invalid" with a field lands inline on that field', async () => {
  const t = setup({ routes: { ...BOOT, 'POST /api/food/products': json({ error: 'invalid', field: 'per100.fat' }, 400) }, extraIds: ['fp-form-msg', 'fpf-f-err'] });
  await flush();
  const f = focusSpy(t);
  t.fire('click', t.button({ 'data-food-act': 'p-new' }));
  t.fire('click', t.button({ 'data-food-act': 'p-label' }));
  for (const [id, v] of [['fpf-name', 'Pan'], ['fpf-store', 'dia'], ['fpf-unit', 'g'], ['fpf-kcal', '250'], ['fpf-p', '9'], ['fpf-c', '48']]) t.input(id, v);
  const fat = f.reg('fpf-f', '2');
  t.fire('click', t.button({ 'data-food-act': 'p-save' }));
  await flush();
  assert.equal(fat.getAttribute('aria-invalid'), 'true');
  assert.notEqual(t.els['fpf-f-err'].textContent, '');
  assert.deepEqual(f.log, ['fpf-f']);
  assert.equal(t.els['fp-form-msg'].textContent, 'Revisa este dato: grasa.');
});

test('recipe form: units accepted, an invalid amount is an inline error, the status sits inside the form; the ingredient suffix follows the product', async () => {
  let posted;
  const routes = { ...BOOT, 'POST /api/food/recipes': (init) => { posted = JSON.parse(init.body); return json({ recipe: { ...RECIPE, id: 10, name: posted.name } }, 201); } };
  const t = setup({ routes, extraIds: ['frf-prev', 'fr-form-msg', 'frf-amt-0-err', 'frf-amt-0-unit'] });
  await flush();
  const f = focusSpy(t);
  t.fire('click', t.button({ 'data-food-act': 'r-new' }));
  const html = t.els['fr-body'].innerHTML;
  const save = html.indexOf('data-food-act="r-save"');
  const msg = html.indexOf('id="fr-form-msg"');
  assert.ok(save > 0 && save < msg && msg < html.indexOf('class="fp-all"'));
  t.input('frf-name', 'Lote');
  t.fire('change', t.input('frf-kind', 'batch'));
  t.input('frf-cooked', '500 g');
  t.fire('click', t.button({ 'data-food-act': 'r-pick', 'data-i': '0', 'data-kind': 'product', 'data-id': '2' }));
  assert.match(t.els['fr-body'].innerHTML, /id="frf-amt-0-unit">ml</, 'the amount suffix is the product unit');
  const amt = f.reg('frf-amt-0', 'un vaso');
  t.fire('click', t.button({ 'data-food-act': 'r-save' }));
  await flush();
  assert.equal(posted, undefined);
  assert.equal(amt.getAttribute('aria-invalid'), 'true');
  assert.equal(t.els['frf-amt-0-err'].textContent, esF.fieldErrors.number);
  assert.deepEqual(f.log, ['frf-amt-0']);
  assert.match(t.els['fr-form-msg'].textContent, /cantidad/);
  t.input('frf-amt-0', '330 ml');
  t.fire('click', t.button({ 'data-food-act': 'r-save' }));
  await flush();
  assert.deepEqual(posted, { name: 'Lote', kind: 'batch', cookedWeightG: 500, ingredients: [{ productId: 2, amount: 330 }] });
  assert.equal(t.els['fr-msg'].textContent, esF.recipes.saved);
});

test('add sheet: an amount with its unit is accepted; quick entry: a bare unit = not set, a non-number is an inline error', async () => {
  const bodies = [];
  const routes = { ...BOOT, 'POST /api/food/log': (init) => { const b = JSON.parse(init.body); delete b.requestId; bodies.push(b); return json({ entry: { ...ENTRY, id: 60 + bodies.length }, totals: TOTALS1 }, 201); } };
  const t = setup({ routes, extraIds: ['fa-panel', 'fa-prev', 'fa-msg', 'fa-p-err'] });
  await flush();
  const f = focusSpy(t);
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'lunch' }));
  t.window.HCViews['food-add'].render();
  t.fire('click', t.button({ 'data-food-act': 'pick', 'data-kind': 'product', 'data-id': '2' }));
  t.input('fa-unit', 'ml');
  t.input('fa-amt', '250 ml');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(bodies[0].amount, 250);

  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'snack' }));
  t.window.HCViews['food-add'].render();
  t.fire('click', t.button({ 'data-food-act': 'tab', 'data-tab': 'quick' }));
  assert.match(t.els['fa-panel'].innerHTML, /<span class="food-suffix" id="fa-kcal-unit">kcal<\/span>/);
  t.input('fa-label', 'Pintxo');
  t.input('fa-kcal', '250 kcal');
  const p = f.reg('fa-p', 'algo');
  t.input('fa-c', 'g');
  t.input('fa-f', '');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(bodies.length, 1, 'not sent');
  assert.equal(p.getAttribute('aria-invalid'), 'true');
  assert.equal(t.els['fa-p-err'].textContent, esF.fieldErrors.number);
  assert.deepEqual(f.log, ['fa-p']);
  t.input('fa-p', '10 g');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.deepEqual(bodies[1], { date: TODAY, meal: 'snack', refType: 'quick', label: 'Pintxo', kcal: 250, protein: 10 });
});

/* ---------- Plan de hoy's portion guide: today's log per group, the products, the "+" add ---------- */
test('the add sheet has three tabs (no "Del plan": Plan de hoy is a portion guide now)', async () => {
  const t = setup({ routes: BOOT, extraIds: ['fa-panel', 'fa-msg'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'lunch' }));
  const body = t.window.HCViews['food-add'].render().body;
  assert.deepEqual([...body.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]), ['products', 'recipes', 'quick']);
  assert.doesNotMatch(source, /todayPlan|fa-plan/);
  // the tabs are THE segmented control (docs/design-system.md), full width: one pressed option
  assert.match(body, /<div class="dt-range dt-range-fill fa-tabs" role="group" aria-label="[^"]+"><button type="button" class="fa-tab" data-food-act="tab"/);
  assert.equal((body.match(/class="fa-tab"[^>]*aria-pressed="true"/g) || []).length, 1);
  // one short word each, so the three fit one line at 360 px ("MIS PRODUCTOS" wrapped)
  assert.deepEqual([...body.matchAll(/data-tab="[a-z]+"[^>]*>([^<]+)</g)].map((m) => m[1]), ['Productos', 'Recetas', 'Rápido']);
});

test('HCFood.groupTotals: today\'s sums per Registrar group (a missing macro counts 0); null without the food API', async () => {
  const pre = { ...ENTRY, id: 61, meal: 'preworkout', refType: 'quick', label: 'Plátano', kcal: 105, protein: 1.3, carbs: 27, fat: null };
  const lunch = { ...ENTRY, id: 62, meal: 'lunch', kcal: 412, protein: 30.25, carbs: 40, fat: 10.04 };
  const routes = { ...BOOT, [`GET /api/food/log?date=${TODAY}`]: json({ date: TODAY, entries: [ENTRY, pre, lunch], totals: TOTALS1 }) };
  const t = setup({ routes });
  assert.equal(t.F.groupTotals(), null, 'before the API answered');
  assert.equal(t.F.products(), null);
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(t.F.groupTotals())), {
    meals: { breakfast: { k: 75, p: 12.5, c: 5, f: 0.3 }, lunch: { k: 412, p: 30.3, c: 40, f: 10 }, dinner: { k: 0, p: 0, c: 0, f: 0 } },
    addon: { k: 105, p: 1.3, c: 27, f: 0 },
  });
  const prods = t.F.products();
  assert.deepEqual(prods.map((p) => p.id), [1, 2, 3]);
  assert.deepEqual(JSON.parse(JSON.stringify(prods[0])), { id: 1, name: 'Yogur natural', brand: 'Hacendado', unit: 'g', per100: { kcal: 60, protein: 10, carbs: 4, fat: 0.2 } });
  prods[0].name = 'x';
  assert.equal(t.F.products()[0].name, 'Yogur natural', 'a copy');
  const off = setup();
  await flush();
  assert.equal(off.F.groupTotals(), null);
});

test('HCFood.addGuide: a basic = ONE quick entry in that meal (pieces when it has them), macros from the basics formula; Registrar + Plan de hoy refresh', async () => {
  const bodies = [];
  const saved = { ...ENTRY, id: 70, meal: 'lunch', refType: 'quick', label: 'Pechuga de pollo · 195 g', kcal: 213, protein: 44.7, carbs: 0, fat: 4.5 };
  const routes = { ...BOOT, 'POST /api/food/log': (init) => { bodies.push(JSON.parse(init.body)); return json({ entry: saved, totals: TOTALS1 }); } };
  const t = setup({ routes, extraIds: ['food-add-lunch'] });
  await flush();
  t.hooks.length = 0;
  const e = await t.F.addGuide({ group: 'lunch', food: 'b:pollo', amt: 195 });
  assert.equal(e.id, 70);
  const b = bodies[0];
  assert.match(b.requestId, /^[0-9a-f-]{36}$/);
  delete b.requestId;
  assert.deepEqual(b, { date: TODAY, meal: 'lunch', refType: 'quick', label: 'Pechuga de pollo · 195 g', kcal: 213, protein: 44.7, carbs: 0, fat: 4.5, force: true });
  assert.match(t.els['food-log'].innerHTML, /Pechuga de pollo · 195 g/);
  assert.deepEqual(t.hooks, ['nutri'], 'Plan de hoy re-renders (what is left)');
  assert.match(t.els['food-msg'].textContent, /Pechuga de pollo · 195 g/);
  // a countable food in pieces, a unit food in units
  await t.F.addGuide({ group: 'breakfast', food: 'b:platano', amt: 180 });
  assert.equal(bodies[1].label, 'Plátano · 1,5 ud (~180 g)');
  assert.equal(bodies[1].kcal, 158);
  await t.F.addGuide({ group: 'dinner', food: 'b:huevo', amt: 300 });
  assert.equal(bodies[2].label, 'Huevo · 3 ud (~150 g)');
  assert.equal(bodies[2].kcal, 216);
});

test('HCFood.addGuide: an owner product = a product entry (the server applies its formula)', async () => {
  const bodies = [];
  const routes = { ...BOOT, 'POST /api/food/log': (init) => { bodies.push(JSON.parse(init.body)); return json({ entry: { ...ENTRY, id: 71 }, totals: TOTALS1 }); } };
  const t = setup({ routes });
  await flush();
  await t.F.addGuide({ group: 'dinner', food: 'p:2', amt: 210 });
  delete bodies[0].requestId;
  assert.deepEqual(bodies[0], { date: TODAY, meal: 'dinner', refType: 'product', refId: 2, amount: 210, unit: 'ml' });
});

test('HCFood.addGuide: an ambiguous failure keeps the request id for the retry (no duplicate); a refusal or bad input sends nothing new', async () => {
  const bodies = [];
  let n = 0;
  const routes = { ...BOOT, 'POST /api/food/log': (init) => { bodies.push(JSON.parse(init.body)); n++; return n === 1 ? new TypeError('offline') : json({ entry: { ...ENTRY, id: 72 }, totals: TOTALS1 }); } };
  const t = setup({ routes });
  await flush();
  await assert.rejects(t.F.addGuide({ group: 'lunch', food: 'b:arroz', amt: 150 }));
  assert.match(t.els['food-msg'].textContent, new RegExp(esF.errors.offline.slice(0, 12)));
  await t.F.addGuide({ group: 'lunch', food: 'b:arroz', amt: 150 });
  assert.equal(bodies[0].requestId, bodies[1].requestId, 'the retry is the same add');
  await t.F.addGuide({ group: 'lunch', food: 'b:arroz', amt: 150 });
  assert.notEqual(bodies[2].requestId, bodies[1].requestId, 'a new tap after a success is a new add');
  const before = bodies.length;
  for (const o of [{ group: 'addon', food: 'b:arroz', amt: 50 }, { group: 'lunch', food: 'b:nope', amt: 50 }, { group: 'lunch', food: 'p:999', amt: 50 }, { group: 'lunch', food: 'x', amt: 50 }, { group: 'lunch', food: 'b:arroz', amt: 0 }, { group: 'lunch', food: 'b:arroz', amt: 99999 }, null]) {
    await assert.rejects(t.F.addGuide(o));
  }
  assert.equal(bodies.length, before, 'nothing sent');
  const off = setup();
  await flush();
  await assert.rejects(off.F.addGuide({ group: 'lunch', food: 'b:arroz', amt: 50 }));
});

/* ---------- basics: generic foods of the public food DB, searched next to the user's products ---------- */
const BASIC_IDS = ['fa-panel', 'fa-prev', 'fa-msg', 'fa-list', 'fa-amt-err', 'food-add-breakfast', 'food-add-addon'];
function openProducts(t, meal = 'breakfast') {
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': meal }));
  return t.window.HCViews['food-add'].render().body;
}
const pickBasic = (t, key) => t.fire('click', t.button({ 'data-food-act': 'pick', 'data-kind': 'basic', 'data-id': key }));

test('parity: the page computes exactly what lib/nutrition/foodlog.mjs computes for a basic', () => {
  const { F } = setup({ fetchImpl: async () => { throw new TypeError('x'); } });
  for (const c of BASIC_CASES) assert.deepEqual(JSON.parse(JSON.stringify(runBasicCase(c, F))), c.expect, c.name);
});

test('basics search: an empty search lists only the products (plus a hint); typing adds a Básicos group after them, accent- and case-insensitive, marked as average values', async () => {
  const t = setup({ routes: BOOT, extraIds: BASIC_IDS });
  await flush();
  const body = openProducts(t);
  assert.doesNotMatch(body, /data-kind="basic"/, 'no basics before typing: the list stays short');
  assert.ok(text(body).includes(esF.sheet.typeToSearch), 'a hint that typing also searches the basics');
  t.fire('input', t.input('fa-q', 'PLATANO'));
  const html = t.els['fa-list'].innerHTML;
  assert.match(html, /<h4 class="fa-store">Básicos<\/h4>/);
  assert.match(html, /data-food-act="pick" data-kind="basic" data-id="platano"/);
  assert.match(text(html), /Plátano 88 kcal por 100 g · valor medio/);
  assert.doesNotMatch(text(html), new RegExp(esF.sheet.noMatch));
  t.fire('input', t.input('fa-q', 'lech'));
  const both = t.els['fa-list'].innerHTML;
  assert.ok(both.indexOf('data-kind="product" data-id="2"') < both.indexOf('Básicos'), 'the user\'s products first');
  assert.match(both, /data-kind="basic" data-id="leche"/);
  assert.match(both, /data-kind="basic" data-id="lechuga"/);
  assert.match(text(both), /Huevo|Leche/);
  t.fire('input', t.input('fa-q', 'huevo'));
  assert.match(text(t.els['fa-list'].innerHTML), /Huevo 72 kcal por ud · valor medio/, 'a unit food is per unit');
  t.fire('input', t.input('fa-q', 'zzzz'));
  assert.equal(text(t.els['fa-list'].innerHTML), esF.sheet.noMatch);
});

test('basics search: a verified product label of the food DB says so instead of "average values"', async () => {
  const t = setup({ routes: BOOT, extraIds: BASIC_IDS });
  await flush();
  openProducts(t);
  t.fire('input', t.input('fa-q', 'estrella galicia (5'));
  assert.match(text(t.els['fa-list'].innerHTML), new RegExp('Cerveza especial Estrella Galicia \\(5,5%\\) 47 kcal por 100 ml · ' + esF.sheet.basicLabelSrc));
});

// a hidden basic (h: 1, `basic: false` in the food DB: it is logged as one of your own products instead) never lists
const HIDDEN_BASICS = [
  { k: 'vis', n: 'Salsa visible', u: 'g', m: [100, 1, 2, 3], c: 'sauce' },
  { k: 'hid', n: 'Salsa oculta', u: 'g', m: [200, 1, 2, 3], c: 'sauce', h: 1 },
];

test('basics search: a hidden basic (h) is never listed, in the add sheet or the recipe picker', async () => {
  const t = setup({ routes: BOOT, extraIds: [...BASIC_IDS, 'frf-list-0', 'frf-prev'], basics: HIDDEN_BASICS });
  await flush();
  openProducts(t);
  t.fire('input', t.input('fa-q', 'salsa'));
  const html = t.els['fa-list'].innerHTML;
  assert.match(html, /data-kind="basic" data-id="vis"/);
  assert.doesNotMatch(html, /data-id="hid"/);
  t.fire('input', t.input('fa-q', 'oculta'));
  assert.doesNotMatch(t.els['fa-list'].innerHTML, /data-id="hid"/);
  t.fire('click', t.button({ 'data-food-act': 'r-new' }));
  t.fire('input', t.input('frf-ing-0', 'salsa'));
  const list = t.els['frf-list-0'].innerHTML;
  assert.match(list, /data-kind="basic" data-id="vis"/);
  assert.doesNotMatch(list, /data-id="hid"/);
});

test('basics without any product yet: the search box is there and finds basics', async () => {
  const t = setup({ routes: { ...BOOT, 'GET /api/food/products': json({ products: [] }) }, extraIds: BASIC_IDS });
  await flush();
  const body = openProducts(t);
  assert.match(body, /<label[^>]*for="fa-q"/);
  assert.match(text(body), new RegExp(esF.sheet.noProducts));
  t.fire('input', t.input('fa-q', 'huevo'));
  assert.match(t.els['fa-list'].innerHTML, /data-kind="basic" data-id="huevo"/);
});

test('a basic opens the amount panel in its natural unit: 1 piece for an egg (toggle to grams), live preview with the label', async () => {
  const t = setup({ routes: BOOT, extraIds: BASIC_IDS });
  await flush();
  openProducts(t);
  pickBasic(t, 'huevo');
  const panel = t.els['fa-panel'].innerHTML;
  assert.match(panel, /<option value="piece" selected>huevos \(~50 g\)<\/option><option value="g">g<\/option>/);
  assert.match(panel, /id="fa-amt" type="text" inputmode="decimal" autocomplete="off" value="1"/, 'prefilled with ONE piece, not a usual serving');
  assert.match(text(panel), new RegExp(esF.sheet.basicNote.slice(0, 30)));
  t.input('fa-unit', 'piece');
  t.fire('input', t.input('fa-amt', '2'));
  assert.match(text(t.els['fa-prev'].innerHTML), /Huevo · 2 ud \(~100 g\) 144 kcal · P 12,6 · C 0,8 · G 10/);
  t.fire('change', t.input('fa-unit', 'g'));
  assert.equal(t.doc.getElementById('fa-amt').value, '100', 'switching to grams keeps the same amount of food');
  assert.match(text(t.els['fa-prev'].innerHTML), /Huevo · 100 g 144 kcal/);
  t.fire('change', t.input('fa-unit', 'piece'));
  assert.equal(t.doc.getElementById('fa-amt').value, '2');
});

test('a basic without a piece is weighed in its own unit, prefilled with 100 (ml for a liquid, never grams)', async () => {
  const t = setup({ routes: BOOT, extraIds: BASIC_IDS });
  await flush();
  openProducts(t);
  pickBasic(t, 'leche');
  const panel = t.els['fa-panel'].innerHTML;
  assert.match(panel, /<select class="food-in" id="fa-unit"><option value="ml" selected>ml<\/option><\/select>/);
  assert.match(panel, /id="fa-amt"[^>]*value="100"/);
  pickBasic(t, 'platano');
  assert.match(t.els['fa-panel'].innerHTML, /<option value="piece" selected>plátanos medianos \(~120 g\)<\/option><option value="g">g<\/option>/);
});

test('saving a basic: ONE quick entry with all four macros and the amount in its label, through the request-id flow', async () => {
  const bodies = [];
  const routes = {
    ...BOOT,
    'POST /api/food/log': (init) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) return new TypeError('Failed to fetch');
      return json({ entry: entry({ id: 90, refType: 'quick', label: 'Huevo · 2 ud (~100 g)', kcal: 144, protein: 12.6, carbs: 0.8, fat: 10 }), totals: { ...TOTALS1, kcal: 219, count: 2 } }, 201);
    },
  };
  const t = setup({ routes, extraIds: BASIC_IDS });
  await flush();
  openProducts(t);
  t.input('fa-meal', 'breakfast');
  pickBasic(t, 'huevo');
  t.input('fa-unit', 'piece');
  t.input('fa-amt', '2');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(t.els['fa-msg'].textContent, esF.errors.offline);
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].requestId, bodies[1].requestId, 'the retry of the same add keeps its request id');
  const b = { ...bodies[1] };
  delete b.requestId;
  assert.deepEqual(b, { date: TODAY, meal: 'breakfast', refType: 'quick', label: 'Huevo · 2 ud (~100 g)', kcal: 144, protein: 12.6, carbs: 0.8, fat: 10 });
  assert.deepEqual(t.opened.at(-1), ['close']);
  assert.equal(t.els['food-msg'].textContent, 'Añadido: Huevo · 2 ud (~100 g) (144 kcal).');
});

test('a basic with an invalid or absurd amount is not sent; the error lands under the amount field', async () => {
  const t = setup({ routes: { ...BOOT, 'POST /api/food/log': json({}, 500) }, extraIds: BASIC_IDS });
  await flush();
  openProducts(t);
  pickBasic(t, 'aceiteoliva');
  t.input('fa-unit', 'ml');
  t.input('fa-amt', 'mucho');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(t.els['fa-amt-err'].textContent, esF.fieldErrors.number);
  assert.equal(t.calls.filter((c) => c.key === 'POST /api/food/log').length, 0);
  t.input('fa-amt', '4000');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(t.calls.filter((c) => c.key === 'POST /api/food/log').length, 0, '4 l of olive oil (~33,000 kcal) is over the quick-entry limit');
  assert.equal(t.els['fa-amt-err'].textContent, esF.fieldErrors.tooBig);
});

test('en locale: basics in English, "pc" in the label, a decimal point', async () => {
  const bodies = [];
  const routes = { ...BOOT, 'POST /api/food/log': (init) => { bodies.push(JSON.parse(init.body)); return json({ entry: entry({ id: 91 }), totals: TOTALS1 }, 201); } };
  const t = setup({ routes, locale: 'en', extraIds: BASIC_IDS });
  await flush();
  openProducts(t);
  t.fire('input', t.input('fa-q', 'banana'));
  assert.match(text(t.els['fa-list'].innerHTML), /Basics Banana 88 kcal per 100 g · average values/);
  pickBasic(t, 'platano');
  t.input('fa-unit', 'piece');
  t.input('fa-amt', '1.5');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(bodies[0].label, 'Banana · 1.5 pc (~180 g)');
  assert.equal(bodies[0].kcal, 158);
});

/* ---------- Mis recetas: the ingredient picker also offers the public basics ---------- */
const rPick = (t, i, kind, id) => t.fire('click', t.button({ 'data-food-act': 'r-pick', 'data-i': String(i), 'data-kind': kind, 'data-id': String(id) }));
const EGG_SNAP = { basic: 'huevo', name: 'Huevo', unit: 'ud', amount: 2, per100: { kcal: 72, protein: 6.3, carbs: 0.4, fat: 5 } };

test('recipe picker: an empty search lists Mis productos (+ a hint); typing adds "Básicos · valor medio" after them, accent- and case-insensitive', async () => {
  const t = setup({ routes: BOOT, extraIds: ['frf-list-0', 'frf-prev'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'r-new' }));
  const html = t.els['fr-body'].innerHTML;
  assert.match(html, /<label[^>]*for="frf-ing-0"[^>]*>Ingrediente 1<\/label><input class="food-in" id="frf-ing-0" type="search"/);
  assert.match(html, /id="frf-list-0"/);
  assert.match(text(html), /Mis productos .*Yogur natural.*Leche.*Avena/);
  assert.match(text(html), /Escribe para buscar también en los básicos/);
  assert.doesNotMatch(html, /data-kind="basic"/, 'an empty search lists products only');
  t.fire('input', t.input('frf-ing-0', 'PLATANO'));
  const list = t.els['frf-list-0'].innerHTML;
  assert.match(list, /<h4 class="fa-store">Básicos · valor medio<\/h4>/);
  assert.match(list, /data-food-act="r-pick" data-i="0" data-kind="basic" data-id="platano"/);
  assert.match(text(list), /Plátano 88 kcal por 100 g · valor medio/);
  t.fire('input', t.input('frf-ing-0', 'lech'));
  const both = t.els['frf-list-0'].innerHTML;
  assert.ok(both.indexOf('Mis productos') < both.indexOf('data-id="2"') && both.indexOf('data-id="2"') < both.indexOf('Básicos'), 'the user\'s products first');
  assert.match(both, /data-kind="basic" data-id="leche"/);
  t.fire('input', t.input('frf-ing-0', 'zzzz'));
  assert.equal(text(t.els['frf-list-0'].innerHTML), 'Nada coincide.');
});

test('recipe with a product + a basic in pieces + a basic in grams: natural units, pieces <-> grams toggle, live preview, the snapshot is sent', async () => {
  let posted;
  const routes = { ...BOOT, 'POST /api/food/recipes': (init) => { posted = JSON.parse(init.body); return json({ recipe: { ...RECIPE, id: 11, name: posted.name, ingredients: posted.ingredients } }, 201); } };
  const t = setup({ routes, extraIds: ['frf-prev'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'r-new' }));
  t.input('frf-name', 'Tortitas');
  t.input('frf-serv', '2');
  rPick(t, 0, 'product', 3);
  t.input('frf-amt-0', '80');
  t.fire('click', t.button({ 'data-food-act': 'r-add-ing' }));
  rPick(t, 1, 'basic', 'huevo');
  let html = t.els['fr-body'].innerHTML;
  assert.match(text(html), /Huevo valor medio/, 'the pick shows its name + the average-value tag');
  assert.match(html, /<select class="food-in" id="frf-mode-1"><option value="piece" selected>huevos \(~50 g\)<\/option><option value="g">g<\/option><\/select>/, 'pieces first, grams as the toggle');
  assert.match(html, /id="frf-amt-1"[^>]*value="1"/, 'prefilled with one piece');
  t.input('frf-amt-1', '2');
  // pieces -> grams converts the typed amount, grams -> pieces back
  t.fire('change', t.input('frf-mode-1', 'g'));
  assert.equal(t.doc.getElementById('frf-amt-1').value, '100');
  t.fire('change', t.input('frf-mode-1', 'piece'));
  assert.equal(t.doc.getElementById('frf-amt-1').value, '2');
  t.fire('click', t.button({ 'data-food-act': 'r-add-ing' }));
  rPick(t, 2, 'basic', 'platano');
  t.input('frf-amt-2', '1');
  t.fire('change', t.input('frf-mode-2', 'g'));
  assert.equal(t.doc.getElementById('frf-amt-2').value, '120', 'one medium banana ~120 g');
  t.fire('input', t.input('frf-amt-2', '240'));
  assert.match(text(t.els['frf-prev'].innerHTML), /Por ración: 326 kcal · P 12,7 · C 50,9 · G 8,2/, 'the shared formula: the same numbers as the server');
  t.fire('click', t.button({ 'data-food-act': 'r-save' }));
  await flush();
  assert.deepEqual(posted, { name: 'Tortitas', kind: 'serving', servings: 2, ingredients: [
    { productId: 3, amount: 80 },
    EGG_SNAP,
    { basic: 'platano', name: 'Plátano', unit: 'g', amount: 240, per100: { kcal: 88, protein: 0.8, carbs: 22.5, fat: 0.3 } },
  ] });
  assert.equal(t.els['fr-msg'].textContent, esF.recipes.saved);
});

test('a basic counted in grams is stored in units of that food (60 g of egg = 1.2), and "Cambiar" goes back to the search', async () => {
  let posted;
  const routes = { ...BOOT, 'POST /api/food/recipes': (init) => { posted = JSON.parse(init.body); return json({ recipe: { ...RECIPE, id: 12 } }, 201); } };
  const t = setup({ routes, extraIds: ['frf-prev'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'r-new' }));
  t.input('frf-name', 'Revuelto');
  t.input('frf-serv', '1');
  rPick(t, 0, 'basic', 'leche');
  assert.match(t.els['fr-body'].innerHTML, /id="frf-amt-0-unit">ml</, 'a liquid without pieces: ml only, no toggle');
  assert.doesNotMatch(t.els['fr-body'].innerHTML, /id="frf-mode-0"/);
  t.fire('click', t.button({ 'data-food-act': 'r-unpick', 'data-i': '0' }));
  assert.match(t.els['fr-body'].innerHTML, /id="frf-ing-0" type="search"/);
  rPick(t, 0, 'basic', 'huevo');
  t.input('frf-mode-0', 'g');
  t.input('frf-amt-0', '60 g');
  t.fire('click', t.button({ 'data-food-act': 'r-save' }));
  await flush();
  assert.deepEqual(posted.ingredients, [{ ...EGG_SNAP, amount: 1.2 }]);
});

test('editing a recipe with basics: listed with name + "valor medio" and the amount in its unit; loaded back into the picker; the stored snapshot is resent unchanged', async () => {
  // a snapshot taken when the table said 70 kcal: editing must not refresh it from FOOD_BASICS
  const old = { ...EGG_SNAP, per100: { ...EGG_SNAP.per100, kcal: 70 } };
  const MIXED = { id: 20, name: 'Tortilla', kind: 'serving', servings: 2, cookedWeightG: null, complete: true, perServing: { kcal: 284, protein: 14.4, carbs: 23.9, fat: 12.8 }, per100: null,
    ingredients: [{ productId: 3, amount: 80, name: 'Avena', unit: 'g' }, old, { basic: 'leche', name: 'Leche', unit: 'ml', amount: 200, per100: { kcal: 46, protein: 3.4, carbs: 4.8, fat: 1.7 } }] };
  let put;
  const routes = { ...BOOT, 'GET /api/food/recipes': json({ recipes: [MIXED] }), 'PUT /api/food/recipes/20': (init) => { put = JSON.parse(init.body); return json({ recipe: MIXED }); } };
  const t = setup({ routes, extraIds: ['frf-prev'] });
  await flush();
  const list = text(t.els['fr-body'].innerHTML);
  assert.match(list, /Avena 80 g · Huevo 2 ud valor medio · Leche 200 ml valor medio/);
  t.fire('click', t.button({ 'data-food-act': 'r-edit', 'data-id': '20' }));
  const html = t.els['fr-body'].innerHTML;
  assert.match(text(html), /Avena .*Huevo valor medio.*Leche valor medio/);
  assert.match(html, /<option value="piece" selected>huevos \(~50 g\)<\/option>/, 'a ud basic opens in pieces');
  assert.match(html, /id="frf-amt-1"[^>]*value="2"/);
  assert.match(html, /id="frf-amt-2"[^>]*value="200"/);
  t.fire('click', t.button({ 'data-food-act': 'r-save' }));
  await flush();
  assert.deepEqual(put.ingredients, [{ productId: 3, amount: 80 }, old, MIXED.ingredients[2]]);
});

test('recipe save: a basic snapshot that fails the Atwater check offers "save anyway" and resends with force', async () => {
  const bodies = [];
  const routes = { ...BOOT, 'POST /api/food/recipes': (init) => { const b = JSON.parse(init.body); bodies.push(b); return b.force ? json({ recipe: { ...RECIPE, id: 13 } }, 201) : json({ error: 'atwater' }, 400); } };
  const t = setup({ routes, extraIds: ['frf-prev', 'fr-form-msg'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'r-new' }));
  t.input('frf-name', 'Bizcocho');
  t.input('frf-serv', '8');
  rPick(t, 0, 'basic', 'levadura');
  t.input('frf-amt-0', '16');
  t.fire('click', t.button({ 'data-food-act': 'r-save' }));
  await flush();
  assert.match(t.els['fr-form-msg'].innerHTML, /data-food-act="r-save-force"/);
  t.fire('click', t.button({ 'data-food-act': 'r-save-force' }));
  await flush();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].force, undefined);
  assert.equal(bodies[1].force, true);
  assert.equal(t.els['fr-msg'].textContent, esF.recipes.saved);
});

test('no products yet: a recipe can still be made from basics alone', async () => {
  const t = setup({ routes: { ...BOOT, 'GET /api/food/products': json({ products: [] }), 'GET /api/food/recipes': json({ recipes: [] }) } });
  await flush();
  assert.match(t.els['fr-body'].innerHTML, /data-food-act="r-new"/);
  assert.doesNotMatch(text(t.els['fr-body'].innerHTML), new RegExp(esF.recipes.needProducts));
  const none = setup({ routes: { ...BOOT, 'GET /api/food/products': json({ products: [] }), 'GET /api/food/recipes': json({ recipes: [] }) }, basics: [] });
  await flush();
  assert.match(text(none.els['fr-body'].innerHTML), new RegExp(esF.recipes.needProducts), 'nothing to pick from at all');
});

test('en locale: the recipe picker copy', async () => {
  const t = setup({ routes: BOOT, locale: 'en', extraIds: ['frf-list-0'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'r-new' }));
  assert.match(text(t.els['fr-body'].innerHTML), /Ingredient 1 .*My products/);
  t.fire('input', t.input('frf-ing-0', 'egg'));
  assert.match(t.els['frf-list-0'].innerHTML, /Basics · average value/);
});

/* ---------- the day navigator: view (and add to / delete from) another day ---------- */
const YDAY = '2030-01-09';
const YDAY2 = '2030-01-08';
const YENTRY = { ...ENTRY, id: 70, date: YDAY, meal: 'dinner', refType: 'quick', label: 'Pizza', amount: null, unit: null, kcal: 800, protein: 30, carbs: 90, fat: 30 };
const YTOTALS = { kcal: 800, protein: 30, carbs: 90, fat: 30, count: 1, missing: { protein: false, carbs: false, fat: false } };
const NAV = { ...BOOT, [`GET /api/food/log?date=${YDAY}`]: json({ date: YDAY, entries: [YENTRY], totals: YTOTALS }) };

test('day navigator: opens on today ("Hoy"), next disabled, no "back to today"; prev loads yesterday with the same cards, total, delete and add buttons', async () => {
  const t = setup({ routes: NAV });
  await flush();
  assert.equal(t.els['food-day-label'].textContent, 'Hoy');
  assert.equal(t.els['food-day-next'].disabled, true, 'no future days');
  assert.equal(t.els['food-day-today'].hidden, true);
  assert.notEqual(t.els['food-day-prev'].disabled, true, 'past days are always reachable');
  t.hooks.length = 0;
  t.fire('click', t.els['food-day-prev']);
  await flush();
  assert.ok(t.calls.some((c) => c.key === `GET /api/food/log?date=${YDAY}`), 'yesterday\'s log is read');
  assert.equal(t.els['food-day-label'].textContent, 'mié 9 ene');
  assert.equal(t.els['food-day-next'].disabled, false);
  assert.equal(t.els['food-day-today'].hidden, false);
  const html = t.els['food-log'].innerHTML;
  assert.match(html, /Pizza/);
  assert.doesNotMatch(html, /Yogur natural/, 'today\'s entries are not shown on another day');
  assert.match(html, /data-food-act="del" data-id="70"/);
  for (const g of MEAL_GROUPS) assert.match(html, new RegExp(`id="food-add-${g}"`));
  assert.match(text(html), /Total del día 800 kcal/);
  assert.doesNotMatch(text(html), /Registrado hoy/);
  // the contracts stay today-only
  assert.equal(t.window.foodTotals().k, 75);
  assert.equal(t.F.groupTotals().meals.breakfast.k, 75);
  assert.equal(t.F.groupTotals().meals.dinner.k, 0);
  assert.equal(t.F.state().log.date, TODAY, 'today\'s log is kept apart from the viewed day');
  assert.deepEqual(t.hooks, [], 'viewing another day refreshes nothing of today');
});

test('day navigator: next walks forward, back to today jumps home and is hidden there; an empty past day says so', async () => {
  const t = setup({ routes: { ...NAV, [`GET /api/food/log?date=${YDAY2}`]: json({ date: YDAY2, entries: [], totals: { ...YTOTALS, kcal: 0, protein: 0, carbs: 0, fat: 0, count: 0 } }) } });
  await flush();
  t.fire('click', t.els['food-day-prev']);
  await flush();
  t.fire('click', t.els['food-day-prev']);
  await flush();
  assert.equal(t.els['food-day-label'].textContent, 'mar 8 ene');
  assert.match(text(t.els['food-log'].innerHTML), /Nada registrado ese día\./);
  t.fire('click', t.els['food-day-next']);
  await flush();
  assert.equal(t.els['food-day-label'].textContent, 'mié 9 ene');
  assert.match(t.els['food-log'].innerHTML, /Pizza/);
  t.fire('click', t.els['food-day-today']);
  await flush();
  assert.equal(t.els['food-day-label'].textContent, 'Hoy');
  assert.equal(t.els['food-day-next'].disabled, true);
  assert.equal(t.els['food-day-today'].hidden, true);
  assert.match(t.els['food-log'].innerHTML, /Yogur natural/);
  assert.match(text(t.els['food-log'].innerHTML), /Registrado hoy 75 kcal/);
  // next on today goes nowhere (the button is disabled; a stray action is a no-op too)
  const reads = t.calls.length;
  t.fire('click', t.button({ 'data-food-act': 'day-next' }));
  await flush();
  assert.equal(t.els['food-day-label'].textContent, 'Hoy');
  assert.equal(t.calls.length, reads);
});

test('adding on a past day: the sheet names the date, the POST sends that date, today\'s totals and Resumen stay untouched', async () => {
  let posted;
  const saved = { ...YENTRY, id: 71, meal: 'lunch', label: 'Ensalada', kcal: 150, protein: null, carbs: null, fat: null };
  const routes = { ...NAV, 'POST /api/food/log': (init) => { posted = JSON.parse(init.body); return json({ entry: saved, totals: { ...YTOTALS, kcal: 950, count: 2 } }, 201); } };
  const t = setup({ routes, extraIds: ['fa-panel', 'fa-prev', 'fa-msg', 'food-add-lunch'] });
  await flush();
  t.fire('click', t.els['food-day-prev']);
  await flush();
  t.hooks.length = 0;
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'lunch' }));
  const view = t.window.HCViews['food-add'];
  view.render();
  assert.equal(view.title(), 'Añadir comida · mié 9 ene');
  t.fire('click', t.button({ 'data-food-act': 'tab', 'data-tab': 'quick' }));
  t.input('fa-meal', 'lunch');
  t.input('fa-label', 'Ensalada');
  t.input('fa-kcal', '150');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(posted.date, YDAY, 'logged to the viewed day');
  assert.match(t.els['food-log'].innerHTML, /Ensalada/);
  assert.match(t.els['food-log'].innerHTML, /Pizza/);
  assert.match(text(t.els['food-log'].innerHTML), /Total del día 950 kcal/);
  assert.equal(t.window.foodTotals().k, 75, 'today untouched');
  assert.equal(t.F.state().log.entries.length, 1);
  assert.deepEqual(t.hooks, [], 'today did not change: nothing of Resumen de hoy re-renders');
  assert.equal(t.els['food-msg'].textContent, 'Añadido: Ensalada (150 kcal).');
  // back on today the sheet title is the plain one
  t.fire('click', t.els['food-day-today']);
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'lunch' }));
  view.render();
  assert.equal(view.title(), 'Añadir comida');
});

test('adding on a past day: an ambiguous failure re-reads THAT day (same request id), never today\'s', async () => {
  let n = 0;
  const saved = { ...YENTRY, id: 72, meal: 'snack', label: 'Barrita', kcal: 200 };
  const routes = { ...NAV, 'POST /api/food/log': () => (++n === 1 ? new TypeError('Failed to fetch') : json({ entry: saved, totals: { ...YTOTALS, kcal: 1000, count: 2 } }, 200)) };
  const t = setup({ routes, extraIds: ['fa-panel', 'fa-prev', 'fa-msg'] });
  await flush();
  t.fire('click', t.els['food-day-prev']);
  await flush();
  const reads = (d) => t.calls.filter((c) => c.key === `GET /api/food/log?date=${d}`).length;
  const today0 = reads(TODAY), yday0 = reads(YDAY);
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'addon' }));
  t.window.HCViews['food-add'].render();
  t.fire('click', t.button({ 'data-food-act': 'tab', 'data-tab': 'quick' }));
  t.input('fa-label', 'Barrita');
  t.input('fa-kcal', '200');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(reads(YDAY), yday0 + 1, 'the viewed day is read again');
  assert.equal(reads(TODAY), today0);
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  const posts = t.calls.filter((c) => c.key === 'POST /api/food/log').map((c) => c.body);
  assert.equal(posts.length, 2);
  assert.ok(posts.every((b) => b.date === YDAY && b.requestId === posts[0].requestId));
  assert.equal(t.F.state().log.entries.length, 1, 'today untouched');
  assert.equal(t.F.state().log.entries.filter((e) => e.id === 72).length, 0);
});

test('deleting on a past day: that day\'s row leaves, today\'s log and totals stay', async () => {
  const t = setup({ routes: { ...NAV, 'DELETE /api/food/log/70': json({ ok: true }) } });
  await flush();
  t.fire('click', t.els['food-day-prev']);
  await flush();
  t.hooks.length = 0;
  t.fire('click', t.button({ 'data-food-act': 'del', 'data-id': '70' }));
  await flush();
  assert.ok(t.calls.some((c) => c.key === 'DELETE /api/food/log/70'));
  assert.doesNotMatch(t.els['food-log'].innerHTML, /data-id="70"/);
  assert.equal(t.els['food-msg'].textContent, 'Borrado: Pizza.');
  assert.equal(t.window.foodTotals().k, 75);
  assert.deepEqual(t.hooks, []);
  // a today entry id is not deletable from another day's view
  t.fire('click', t.button({ 'data-food-act': 'del', 'data-id': '50' }));
  await flush();
  assert.ok(!t.calls.some((c) => c.key === 'DELETE /api/food/log/50'));
});

test('HCFood.addGuide always logs to today, also while another day is viewed', async () => {
  let posted;
  const saved = { ...ENTRY, id: 73, meal: 'lunch', label: 'Arroz', kcal: 350 };
  const t = setup({ routes: { ...NAV, 'POST /api/food/log': (init) => { posted = JSON.parse(init.body); return json({ entry: saved, totals: { ...TOTALS1, kcal: 425, count: 2 } }, 201); } } });
  await flush();
  t.fire('click', t.els['food-day-prev']);
  await flush();
  await t.F.addGuide({ group: 'lunch', food: 'p:3', amt: 80 });
  assert.equal(posted.date, TODAY);
  assert.equal(t.window.foodTotals().k, 425);
  assert.doesNotMatch(t.els['food-log'].innerHTML, /Arroz/, 'the viewed day is still yesterday');
  assert.equal(t.els['food-day-label'].textContent, 'mié 9 ene');
});

test('a slow response for a day already left never overwrites the current view', async () => {
  let releaseY;
  const slowY = new Promise((r) => { releaseY = r; });
  const routes = {
    ...NAV,
    [`GET /api/food/log?date=${YDAY}`]: () => slowY,
    [`GET /api/food/log?date=${YDAY2}`]: json({ date: YDAY2, entries: [{ ...YENTRY, id: 74, date: YDAY2, label: 'Lentejas' }], totals: YTOTALS }),
  };
  const t = setup({ routes });
  await flush();
  t.fire('click', t.els['food-day-prev']); // yesterday: slow
  await flush();
  t.fire('click', t.els['food-day-prev']); // the day before: fast
  await flush();
  assert.match(t.els['food-log'].innerHTML, /Lentejas/);
  releaseY(json({ date: YDAY, entries: [YENTRY], totals: YTOTALS }));
  await flush();
  assert.equal(t.els['food-day-label'].textContent, 'mar 8 ene');
  assert.match(t.els['food-log'].innerHTML, /Lentejas/);
  assert.doesNotMatch(t.els['food-log'].innerHTML, /Pizza/);
  // and a slow past day that lands after going back to today is ignored too
  let releaseY2;
  const t2 = setup({ routes: { ...NAV, [`GET /api/food/log?date=${YDAY}`]: () => new Promise((r) => { releaseY2 = r; }) } });
  await flush();
  t2.fire('click', t2.els['food-day-prev']);
  await flush();
  t2.fire('click', t2.els['food-day-today']);
  await flush();
  releaseY2(json({ date: YDAY, entries: [YENTRY], totals: YTOTALS }));
  await flush();
  assert.equal(t2.els['food-day-label'].textContent, 'Hoy');
  assert.match(t2.els['food-log'].innerHTML, /Yogur natural/);
  assert.doesNotMatch(t2.els['food-log'].innerHTML, /Pizza/);
});

test('midnight: on "today" the view moves to the new today; on a past day it stays there and only today\'s totals reload', async () => {
  const NEXT = '2030-01-11';
  const NENTRY = { ...ENTRY, id: 90, date: NEXT, label: 'Tostada', kcal: 120 };
  const routes = { ...NAV, [`GET /api/food/log?date=${NEXT}`]: json({ date: NEXT, entries: [NENTRY], totals: { ...TOTALS1, kcal: 120 } }) };
  const t = setup({ routes });
  await flush();
  t.ctx.Date = fixedDate(NEXT, '08:00:00');
  t.doc.hidden = false;
  t.hooks.length = 0;
  t.fire('visibilitychange', t.doc);
  await flush();
  assert.equal(t.els['food-day-label'].textContent, 'Hoy');
  assert.match(t.els['food-log'].innerHTML, /Tostada/);
  assert.equal(t.window.foodTotals().date, NEXT);
  assert.deepEqual(t.hooks, ['nutri']);
  assert.equal(t.els['food-day-next'].disabled, true);

  const p = setup({ routes });
  await flush();
  p.fire('click', p.els['food-day-prev']);
  await flush();
  p.ctx.Date = fixedDate(NEXT, '08:00:00');
  p.doc.hidden = false;
  p.hooks.length = 0;
  p.fire('visibilitychange', p.doc);
  await flush();
  assert.equal(p.els['food-day-label'].textContent, 'mié 9 ene', 'still on the day being looked at');
  assert.match(p.els['food-log'].innerHTML, /Pizza/);
  assert.equal(p.window.foodTotals().date, NEXT, 'today\'s totals moved to the new day');
  assert.equal(p.window.foodTotals().k, 120);
  assert.deepEqual(p.hooks, ['nutri']);
  assert.equal(p.els['food-day-next'].disabled, false);
  assert.equal(p.els['food-day-today'].hidden, false);
});

test('en locale: "Today", English dates and the day total of another day', async () => {
  const t = setup({ routes: NAV, locale: 'en' });
  await flush();
  assert.equal(t.els['food-day-label'].textContent, 'Today');
  t.fire('click', t.els['food-day-prev']);
  await flush();
  assert.equal(t.els['food-day-label'].textContent, 'Wed 9 Jan');
  assert.match(text(t.els['food-log'].innerHTML), /Day total 800 kcal/);
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'lunch' }));
  const view = t.window.HCViews['food-add'];
  view.render();
  assert.equal(view.title(), 'Add food · Wed 9 Jan');
});

test('a sheet opened on "today" logs to the today of the SAVE (23:58 -> 00:02), and its ambiguous re-read reads that day', async () => {
  const NEXT = '2030-01-11';
  let n = 0;
  const saved = { ...ENTRY, id: 91, date: NEXT, meal: 'snack', refType: 'quick', label: 'Barrita', kcal: 200 };
  const routes = {
    ...BOOT,
    [`GET /api/food/log?date=${NEXT}`]: json({ date: NEXT, entries: [], totals: { ...TOTALS1, kcal: 0, count: 0 } }),
    'POST /api/food/log': () => (++n === 1 ? new TypeError('Failed to fetch') : json({ entry: saved, totals: { ...TOTALS1, kcal: 200, count: 1 } }, 200)),
  };
  const t = setup({ routes, extraIds: ['fa-panel', 'fa-prev', 'fa-msg'], time: '23:58:00' });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'addon' }));
  const view = t.window.HCViews['food-add'];
  view.render();
  assert.equal(view.title(), 'Añadir comida');
  t.fire('click', t.button({ 'data-food-act': 'tab', 'data-tab': 'quick' }));
  t.input('fa-label', 'Barrita');
  t.input('fa-kcal', '200');
  t.ctx.Date = fixedDate(NEXT, '00:02:00');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(t.calls.filter((c) => c.key === 'POST /api/food/log')[0].body.date, NEXT, 'logged to the day it was saved on');
  assert.ok(t.calls.some((c) => c.key === `GET /api/food/log?date=${NEXT}`), 'the re-read is today\'s, never dropped as a stale past day');
  assert.equal(t.F.state().log.date, NEXT);
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  const posts = t.calls.filter((c) => c.key === 'POST /api/food/log').map((c) => c.body);
  assert.ok(posts.every((b) => b.date === NEXT && b.requestId === posts[0].requestId));
  assert.equal(t.window.foodTotals().k, 200);
  assert.equal(t.els['food-day-label'].textContent, 'Hoy');
});

test('a sheet opened on a past day keeps that day even when the save happens after midnight', async () => {
  let posted;
  const saved = { ...YENTRY, id: 92, label: 'Fruta', kcal: 60 };
  const routes = { ...NAV, 'POST /api/food/log': (init) => { posted = JSON.parse(init.body); return json({ entry: saved, totals: { ...YTOTALS, kcal: 860, count: 2 } }, 201); } };
  const t = setup({ routes, extraIds: ['fa-panel', 'fa-prev', 'fa-msg'], time: '23:58:00' });
  await flush();
  t.fire('click', t.els['food-day-prev']);
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'dinner' }));
  t.window.HCViews['food-add'].render();
  t.fire('click', t.button({ 'data-food-act': 'tab', 'data-tab': 'quick' }));
  t.input('fa-label', 'Fruta');
  t.input('fa-kcal', '60');
  t.ctx.Date = fixedDate('2030-01-11', '00:02:00');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(posted.date, YDAY);
  assert.match(t.els['food-log'].innerHTML, /Fruta/);
});

test('a delete in flight survives a re-fetch of its day: the row leaves the CURRENT log (past day, and today with Resumen refreshed)', async () => {
  let releaseDel;
  const t = setup({ routes: { ...NAV, 'DELETE /api/food/log/70': () => new Promise((r) => { releaseDel = r; }), [`GET /api/food/log?date=${YDAY2}`]: json({ date: YDAY2, entries: [], totals: YTOTALS }) } });
  await flush();
  t.fire('click', t.els['food-day-prev']);
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'del', 'data-id': '70' }));
  await flush();
  t.fire('click', t.els['food-day-prev']);
  await flush();
  t.fire('click', t.els['food-day-next']); // yesterday is read again, the row still there
  await flush();
  assert.match(t.els['food-log'].innerHTML, /data-id="70"/);
  releaseDel(json({ ok: true }));
  await flush();
  assert.doesNotMatch(t.els['food-log'].innerHTML, /data-id="70"/);
  assert.equal(t.F.state().dayLog.entries.length, 0);
  assert.match(text(t.els['food-log'].innerHTML), /Total del día 0 kcal/);

  // today: the log is re-read (an ambiguous guide add) while the delete is pending
  let releaseToday;
  const d = setup({
    routes: {
      ...BOOT,
      'DELETE /api/food/log/50': () => new Promise((r) => { releaseToday = r; }),
      'POST /api/food/log': () => new TypeError('Failed to fetch'),
    },
  });
  await flush();
  d.fire('click', d.button({ 'data-food-act': 'del', 'data-id': '50' }));
  await flush();
  const before = d.F.state().log;
  await d.F.addGuide({ group: 'lunch', food: 'p:3', amt: 80 }).catch(() => {});
  await flush();
  assert.notEqual(d.F.state().log, before, 'today\'s log object was replaced by the re-read');
  d.hooks.length = 0;
  releaseToday(json({ ok: true }));
  await flush();
  assert.equal(d.F.state().log.entries.length, 0);
  assert.equal(d.window.foodTotals(), null);
  assert.deepEqual(d.hooks, ['nutri']);
});

test('a failed past-day load offers Reintentar (re-reads that day); a stale failure after leaving the day is ignored', async () => {
  let n = 0;
  const t = setup({ routes: { ...NAV, [`GET /api/food/log?date=${YDAY}`]: () => (++n === 1 ? json({ error: 'internal' }, 500) : json({ date: YDAY, entries: [YENTRY], totals: YTOTALS })) } });
  await flush();
  t.fire('click', t.els['food-day-prev']);
  await flush();
  const html = t.els['food-log'].innerHTML;
  assert.match(html, /<button type="button" class="food-btn food-btn-ghost" id="food-day-retry" data-food-act="day-retry">Reintentar<\/button>/);
  t.fire('click', t.button({ 'data-food-act': 'day-retry' }));
  await flush();
  assert.equal(n, 2);
  assert.match(t.els['food-log'].innerHTML, /Pizza/);
  assert.doesNotMatch(t.els['food-log'].innerHTML, /day-retry/);
  // on today a stray retry does nothing
  t.fire('click', t.els['food-day-today']);
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'day-retry' }));
  await flush();
  assert.equal(n, 2);

  let failLate;
  const s = setup({ routes: { ...NAV, [`GET /api/food/log?date=${YDAY}`]: () => new Promise((r) => { failLate = r; }), [`GET /api/food/log?date=${YDAY2}`]: json({ date: YDAY2, entries: [], totals: YTOTALS }) } });
  await flush();
  s.fire('click', s.els['food-day-prev']);
  await flush();
  s.fire('click', s.els['food-day-prev']);
  await flush();
  failLate(json({ error: 'internal' }, 500));
  await flush();
  assert.doesNotMatch(s.els['food-log'].innerHTML, /day-retry/);
  assert.equal(s.els['food-msg'].textContent, '');
  assert.equal(s.els['food-day-label'].textContent, 'mar 8 ene');

  const e = setup({ routes: { ...NAV, [`GET /api/food/log?date=${YDAY}`]: json({ error: 'internal' }, 500) }, locale: 'en' });
  await flush();
  e.fire('click', e.els['food-day-prev']);
  await flush();
  assert.match(e.els['food-log'].innerHTML, />Retry<\/button>/);
});

/* ---------- hooks for settings.js / adherence.js (the one API client, a day to show, log changes) ---------- */
test('HCFood.api is the one food API client (header, JSON, coarse codes) for settings.js and adherence.js; ready() follows the probe', async () => {
  const off = setup();
  await flush();
  assert.equal(off.F.ready(), false);
  const t = setup({ routes: { ...BOOT, 'PUT /api/food/settings': json({ error: 'invalid', field: 'goal' }, 400) } });
  await flush();
  assert.equal(t.F.ready(), true);
  await assert.rejects(t.F.api('PUT', '/settings', { goal: 'x' }), (e) => e.code === 'invalid' && e.field === 'goal' && e.status === 400);
  const put = t.calls.find((c) => c.key === 'PUT /api/food/settings');
  assert.equal(put.init.headers['X-HC-Food'], '1');
  assert.equal(put.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(put.body, { goal: 'x' });
});

test('HCFood.showDay (a Constancia cell): Registrar moves to that day and reads it; today = back to today; nothing without the API', async () => {
  const PAST = '2030-01-08';
  const t = setup({ routes: { ...BOOT, [`GET /api/food/log?date=${PAST}`]: json({ date: PAST, entries: [{ ...ENTRY, id: 77, date: PAST }], totals: TOTALS1 }) } });
  await flush();
  assert.equal(t.F.showDay(PAST), true);
  await flush();
  assert.equal(t.els['food-day-label'].textContent, 'mar 8 ene');
  assert.match(t.els['food-log'].innerHTML, /data-id="77"/);
  assert.equal(t.F.showDay(TODAY), true);
  assert.equal(t.els['food-day-label'].textContent, 'Hoy');
  assert.equal(t.F.showDay('2030-02-31'), false);
  const off = setup();
  await flush();
  assert.equal(off.F.showDay(PAST), false);
});

test('every add / delete (any day) asks Constancia to re-read its summary (HCAdherence.reload), a throwing one is ignored', async () => {
  const t = setup({ routes: { ...BOOT, 'DELETE /api/food/log/50': json({ ok: true }) } });
  let reloads = 0;
  t.window.HCAdherence = { reload: () => { reloads++; throw new Error('boom'); } };
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'del', 'data-id': '50' }));
  await flush();
  assert.equal(reloads, 1);
  assert.doesNotMatch(t.els['food-log'].innerHTML, /data-id="50"/, 'the delete still lands');
});

test('parseNum takes a trailing kg on a kg field (the target weight), never on a g one', () => {
  const { F } = setup({ fetchImpl: async () => { throw new TypeError('x'); } });
  assert.equal(F.parseNum('72,5 kg', ['kg']), 72.5);
  assert.equal(F.parseNum('80kg', ['kg']), 80);
  assert.ok(Number.isNaN(F.parseNum('80 kg', ['g'])));
  assert.equal(F.parseNum('kg', ['kg']), null);
});

/* ---------- late night: before LATE_NIGHT_HOUR the evening still belongs to the day before ---------- */
const sheetMeal = (t) => {
  t.fire('click', t.button({ 'data-food-act': 'add' }));
  return /<option value="(\w+)" selected>/.exec(t.window.HCViews['food-add'].render().body)[1];
};

test('late night: the lib cutoff is 04:00', () => {
  assert.equal(LATE_NIGHT_HOUR, 4);
});

for (const time of ['00:30:00', '03:59:00']) {
  test(`late night (${time}): the navigator opens on yesterday, "Hoy" shows, the sheet guesses dinner and logs to yesterday`, async () => {
    let posted;
    const saved = { ...YENTRY, id: 93, label: 'Cena', kcal: 500 };
    const routes = { ...NAV, 'POST /api/food/log': (init) => { posted = JSON.parse(init.body); return json({ entry: saved, totals: { ...YTOTALS, kcal: 1300, count: 2 } }, 201); } };
    const t = setup({ routes, time, extraIds: ['fa-panel', 'fa-prev', 'fa-msg'] });
    await flush();
    assert.equal(t.els['food-day-label'].textContent, 'mié 9 ene');
    assert.equal(t.els['food-day-today'].hidden, false, 'the "back to today" button is offered');
    assert.equal(t.els['food-day-next'].disabled, false);
    assert.match(t.els['food-log'].innerHTML, /Pizza/);
    assert.equal(t.F.state().log.date, TODAY, 'today\'s log is still loaded for the today-only contracts');
    assert.equal(t.window.foodTotals().date, TODAY);
    assert.equal(sheetMeal(t), 'dinner');
    t.fire('click', t.button({ 'data-food-act': 'tab', 'data-tab': 'quick' }));
    t.input('fa-label', 'Cena');
    t.input('fa-kcal', '500');
    t.fire('click', t.button({ 'data-food-act': 'save' }));
    await flush();
    assert.equal(posted.date, YDAY, 'a sheet opened on yesterday logs to yesterday');
    assert.equal(posted.meal, 'dinner');
    t.fire('click', t.els['food-day-today']);
    await flush();
    assert.equal(t.els['food-day-label'].textContent, 'Hoy');
    assert.equal(t.els['food-day-today'].hidden, true);
    assert.match(t.els['food-log'].innerHTML, /Yogur natural/);
  });
}

test('late night: from 04:00 the navigator opens on today and the sheet guesses breakfast; 23:00 is today + dinner', async () => {
  const t = setup({ routes: NAV, time: '04:00:00' });
  await flush();
  assert.equal(t.els['food-day-label'].textContent, 'Hoy');
  assert.equal(t.els['food-day-today'].hidden, true);
  assert.equal(sheetMeal(t), 'breakfast');
  const n = setup({ routes: NAV, time: '23:00:00' });
  await flush();
  assert.equal(n.els['food-day-label'].textContent, 'Hoy');
  assert.equal(sheetMeal(n), 'dinner');
});

test('late night: a viewer on "today" who comes back after midnight lands on the day before; back after 04:00 returns to today', async () => {
  const NEXT = '2030-01-11';
  const routes = { ...NAV, [`GET /api/food/log?date=${NEXT}`]: json({ date: NEXT, entries: [], totals: { ...TOTALS1, kcal: 0, count: 0 } }) };
  const t = setup({ routes, time: '23:00:00' });
  await flush();
  t.ctx.Date = fixedDate(NEXT, '00:30:00');
  t.doc.hidden = false;
  t.fire('visibilitychange', t.doc);
  await flush();
  assert.equal(t.els['food-day-label'].textContent, 'jue 10 ene', 'still on the evening being logged');
  assert.match(t.els['food-log'].innerHTML, /Yogur natural/);
  assert.equal(t.window.foodTotals(), null, 'today (the new day) has nothing logged yet');
  assert.equal(t.F.state().log.date, NEXT);
  t.ctx.Date = fixedDate(NEXT, '08:00:00');
  t.fire('visibilitychange', t.doc);
  await flush();
  assert.equal(t.els['food-day-label'].textContent, 'Hoy', 'the automatic late-night view expires at 04:00');

  // a day the user picked by hand is never moved
  const p = setup({ routes: NAV, time: '00:30:00' });
  await flush();
  p.fire('click', p.els['food-day-prev']);
  await flush();
  p.ctx.Date = fixedDate(TODAY, '08:00:00');
  p.doc.hidden = false;
  p.fire('visibilitychange', p.doc);
  await flush();
  assert.equal(p.els['food-day-label'].textContent, 'mar 8 ene');
});

/* ---------- the intake rings' past day (HCFood.recentDay): the most recent food-log day in the window ---------- */
const SUMMARY_URL = 'GET /api/food/log/summary?from=2030-01-07&to=2030-01-10';
const sumDay = (date, k, extra = {}) => ({ date, k, p: 80, c: 120, f: 40, n: 3, missing: { p: false, c: false, f: false }, groups: { breakfast: 1, lunch: 1, dinner: 1, addon: 0 }, ...extra });

test('recentDay: null without the food API; nothing requested', async () => {
  const t = setup();
  await flush();
  assert.equal(t.F.recentDay(3), null);
  assert.equal(t.calls.filter((c) => /summary/.test(c.key)).length, 0);
});

test('recentDay: reads the summary of the window once (lazily), then returns the newest logged day in the foodTotals shape and refreshes the rings', async () => {
  const t = setup({ routes: { ...BOOT, [SUMMARY_URL]: json({ days: [sumDay('2030-01-07', 2100), sumDay('2030-01-09', 1800, { p: 95.5, c: null, missing: { p: true, c: true, f: false } }), sumDay('2030-01-08', 0, { n: 0 })] }) } });
  await flush();
  assert.equal(t.calls.filter((c) => /summary/.test(c.key)).length, 0, 'not read until the rings ask');
  t.hooks.length = 0;
  assert.equal(t.F.recentDay(3), null, 'still loading');
  await flush();
  assert.deepEqual(t.hooks, ['intake'], 'the rings re-render once the summary answers');
  assert.deepEqual(JSON.parse(JSON.stringify(t.F.recentDay(3))), { date: '2030-01-09', k: 1800, p: 95.5, c: null, g: 40, n: 3, missing: { protein: true, carbs: true, fat: false }, src: 'log' });
  assert.equal(t.calls.filter((c) => c.key === SUMMARY_URL).length, 1, 'read once');
  assert.equal(t.calls.find((c) => c.key === SUMMARY_URL).init.headers['X-HC-Food'], '1');
});

test('recentDay: an empty window or a failed read is null (no retry loop); an add / delete re-reads it', async () => {
  let n = 0;
  const t = setup({ routes: { ...BOOT, 'DELETE /api/food/log/50': json({ ok: true }), [SUMMARY_URL]: () => (++n === 1 ? json({ days: [] }) : json({ days: [sumDay('2030-01-08', 1500)] })) } });
  await flush();
  t.F.recentDay(3);
  await flush();
  assert.equal(t.F.recentDay(3), null);
  await flush();
  assert.equal(n, 1);
  // the real rings ask again from intakeRefresh: mimic it
  t.window.intakeRefresh = () => { t.hooks.push('intake'); t.F.recentDay(3); };
  t.fire('click', t.button({ 'data-food-act': 'del', 'data-id': '50' }));
  await flush();
  assert.equal(n, 2, 'a change in the log re-reads the window');
  assert.equal(t.F.recentDay(3).date, '2030-01-08');
  const f = setup({ routes: { ...BOOT, [SUMMARY_URL]: json({ error: 'internal' }, 500) } });
  await flush();
  f.F.recentDay(3);
  await flush();
  assert.equal(f.F.recentDay(3), null);
  await flush();
  assert.equal(f.calls.filter((c) => c.key === SUMMARY_URL).length, 1);
});

test('file:// (no LAN): the food log never calls /api/food and degrades as when the API is down; http still fetches', async () => {
  const off = setup({ routes: BOOT, location: { protocol: 'file:' } });
  await flush();
  assert.equal(off.calls.length, 0, 'no LAN fetch from a file');
  const down = setup({ routes: {}, location: { protocol: 'http:' } });
  await flush();
  assert.ok(down.calls.length > 0, 'served: it asks the API');
  assert.equal(off.els['food-log-block'].hidden, down.els['food-log-block'].hidden, 'same state as an unreachable API');
  assert.equal(off.els['food-log'].innerHTML, down.els['food-log'].innerHTML);
  const on = setup({ routes: BOOT, location: { protocol: 'http:' } });
  await flush();
  assert.ok(on.calls.some((c) => c.key === 'GET /api/food/products'), 'the LAN page still fetches');
});

test('a product marked servingDefault starts the add sheet in servings (amount 1); grams stay one switch away', async () => {
  const routes = { ...BOOT, 'GET /api/food/products': json({ products: [YOG, MILK, { ...OATS, servingDefault: true }] }) };
  const t = setup({ routes, extraIds: ['fa-panel', 'fa-prev', 'fa-msg'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'add', 'data-meal': 'breakfast' }));
  t.window.HCViews['food-add'].render();
  t.fire('click', t.button({ 'data-food-act': 'pick', 'data-kind': 'product', 'data-id': '3' }));
  assert.match(t.els['fa-panel'].innerHTML, /<option value="serving" selected>[^<]*<\/option><option value="g">/);
  assert.match(t.els['fa-panel'].innerHTML, /id="fa-amt"[^>]*value="1"/, 'one serving to start');
  t.input('fa-amt', '1');
  t.fire('change', t.input('fa-unit', 'g'));
  assert.equal(t.doc.getElementById('fa-amt').value, '40', 'to grams = one serving in grams');
  // a product without the flag keeps grams first (unchanged)
  t.fire('click', t.button({ 'data-food-act': 'pick', 'data-kind': 'product', 'data-id': '1' }));
  assert.match(t.els['fa-panel'].innerHTML, /<option value="g" selected>g<\/option><option value="serving">/);
});

test('product form: the "log by serving" switch is sent as servingDefault: true, prefilled on edit, and left out when off', async () => {
  const put = [];
  const flagged = { ...YOG, servingDefault: true };
  const routes = {
    ...BOOT,
    'GET /api/food/products': json({ products: [flagged, MILK, OATS] }),
    'PUT /api/food/products/1': (init) => { const b = JSON.parse(init.body); put.push(b); return json({ product: { ...flagged, ...b, id: 1 } }); },
  };
  const t = setup({ routes, extraIds: ['fp-form-msg'] });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'p-edit', 'data-id': '1' }));
  const form = t.els['fp-body'].innerHTML;
  assert.match(form, /id="fpf-sdef"[^>]*aria-checked="true"|aria-checked="true"[^>]*id="fpf-sdef"/);
  assert.ok(form.includes(esF.products.form.servingDefault));
  for (const [id, v] of [['fpf-name', 'Yogur natural'], ['fpf-brand', 'Hacendado'], ['fpf-store', 'mercadona'], ['fpf-code', ''], ['fpf-unit', 'g'], ['fpf-kcal', '60'], ['fpf-p', '10'], ['fpf-c', '4'], ['fpf-f', '0.2'], ['fpf-serv', '125']]) t.input(id, v);
  t.fire('click', t.button({ 'data-food-act': 'p-save' }));
  await flush();
  assert.equal(put[0].servingDefault, true);
  t.fire('click', t.button({ 'data-food-act': 'p-edit', 'data-id': '1' }));
  t.fire('click', t.button({ 'data-food-act': 'p-sdef' }));
  for (const [id, v] of [['fpf-name', 'Yogur natural'], ['fpf-brand', 'Hacendado'], ['fpf-store', 'mercadona'], ['fpf-code', ''], ['fpf-unit', 'g'], ['fpf-kcal', '60'], ['fpf-p', '10'], ['fpf-c', '4'], ['fpf-f', '0.2'], ['fpf-serv', '125']]) t.input(id, v);
  t.fire('click', t.button({ 'data-food-act': 'p-save' }));
  await flush();
  assert.equal('servingDefault' in put[1], false, 'off = not sent (the server reads absent as false)');
});
