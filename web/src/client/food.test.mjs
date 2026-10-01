/* web/src/client/food.js — Nutrición food log (Registrar, the add sheet, Mis productos, Mis recetas).
 * Runs the real classic script in node:vm against web/test/dom-stub.mjs with a stubbed fetch and a
 * fixed clock; nothing real is requested. The formula port is pinned against lib/nutrition/foodlog.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { loadUtil } from '../../test/client-util.mjs';
import { es as esF, en as enF } from '../i18n/food-templates.mjs';
import { FOODLOG_CASES, runCase, FOOD_MEALS, FOOD_STORES, FOOD_UNITS, FOOD_LIMITS, BASIC_CASES, runBasicCase } from '../../../lib/nutrition/foodlog.mjs';
import { buildBasics } from '../../../lib/nutrition/basics.mjs';
import { MEAL_GROUPS, MAIN_SLOTS, ADDON_GROUP, ADDON_SLOT } from '../../../lib/nutrition/slots.mjs';
const FOOD_CONST = { meals: FOOD_MEALS, stores: FOOD_STORES, units: FOOD_UNITS, limits: FOOD_LIMITS, groups: MEAL_GROUPS, mainSlots: MAIN_SLOTS, addonGroup: ADDON_GROUP, addonSlot: ADDON_SLOT };

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'food.js'), 'utf8');
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
function setup({ routes = {}, locale = 'es', fetchImpl, extraIds = [], time, basics } = {}) {
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
  const hooks = [];
  const opened = [];
  const window = {
    HCNutri: { refresh: () => hooks.push('nutri') },
    intakeRefresh: () => hooks.push('intake'),
    HCDetail: { open: (key, date, opts) => opened.push([key, opts]), close: () => opened.push(['close']) },
  };
  const ctx = {
    document: doc, window, I18N_FOOD: locale === 'es' ? esF : enF, FOOD_CONST, FOOD_BASICS: basics === undefined ? BASICS[locale] : basics,
    LOCALE: locale, Date: fixedDate(TODAY, time), Math, JSON, Number, String, Object, Array, Promise, isFinite, fetch, Uint8Array, setTimeout, clearTimeout,
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
  assert.deepEqual(t.hooks, [], 'nothing refreshed');
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
  assert.deepEqual(t.hooks, ['nutri'], 'Resumen de hoy re-reads the totals (it refreshes the rings itself)');
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
  assert.match(text(html), /Yogur natural 1 ración 75 kcal P 12,5 · C 5 · G 0,3/);
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
  assert.match(groups.addon, /Café<\/span><span class="fe-slot">Snack<\/span>/);
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

test('a recipe entry is logged in servings; a quick entry sends only what the owner typed', async () => {
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

test('Open Food Facts: a barcode result shows what OFF has, marks what is missing, and saves only after the owner confirms', async () => {
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
  t.input('frf-ing-0', '2');
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
  t.fire('change', t.input('frf-ing-0', '2'));
  assert.equal(t.els['frf-amt-0-unit'].textContent, 'ml', 'the amount suffix is the product unit');
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

/* ---------- basics: generic foods of the public food DB, searched next to the owner's products ---------- */
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
  assert.ok(both.indexOf('data-kind="product" data-id="2"') < both.indexOf('Básicos'), 'the owner\'s products first');
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
  t.fire('input', t.input('fa-q', 'allioli'));
  assert.match(text(t.els['fa-list'].innerHTML), new RegExp('Allioli \\(Hacendado\\) 712 kcal por 100 g · ' + esF.sheet.basicLabelSrc));
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
  t.input('fa-unit', 'g');
  t.input('fa-amt', 'mucho');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(t.els['fa-amt-err'].textContent, esF.fieldErrors.number);
  assert.equal(t.calls.filter((c) => c.key === 'POST /api/food/log').length, 0);
  t.input('fa-amt', '4000');
  t.fire('click', t.button({ 'data-food-act': 'save' }));
  await flush();
  assert.equal(t.calls.filter((c) => c.key === 'POST /api/food/log').length, 0, '4 kg of olive oil (36,000 kcal) is over the quick-entry limit');
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
