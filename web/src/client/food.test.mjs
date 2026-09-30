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
import { FOODLOG_CASES, runCase, FOOD_MEALS, FOOD_STORES, FOOD_UNITS } from '../../../lib/nutrition/foodlog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'food.js'), 'utf8');
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

function fixedDate(iso) {
  const RealDate = Date;
  return class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(iso + 'T12:00:00'); }
    static now() { return new RealDate(iso + 'T12:00:00').getTime(); }
  };
}

/** routes: { 'GET /api/food/products': response | fn(init, n) | Error }; unknown -> network error */
function setup({ routes = {}, locale = 'es', fetchImpl, extraIds = [] } = {}) {
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
    document: doc, window, I18N_FOOD: locale === 'es' ? esF : enF, FOOD_CONST: { meals: FOOD_MEALS, stores: FOOD_STORES, units: FOOD_UNITS },
    LOCALE: locale, Date: fixedDate(TODAY), Math, JSON, Number, String, Object, Array, Promise, isFinite, fetch,
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
  const ctx = { document: doc, window: {}, I18N_FOOD: esF, FOOD_CONST: { meals: FOOD_MEALS, stores: FOOD_STORES, units: FOOD_UNITS }, LOCALE: 'es', Date: fixedDate(TODAY) };
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

test('Registrar: grouped by meal slot, entry kcal + P/C/G, a labelled delete button, one add button per slot, the day total', async () => {
  const t = setup({ routes: BOOT });
  await flush();
  const html = t.els['food-log'].innerHTML;
  for (const m of FOOD_MEALS) assert.match(html, new RegExp(`id="food-add-${m}"[^>]*data-food-act="add"[^>]*data-meal="${m}"`));
  assert.match(html, /aria-label="Añadir a Desayuno"/);
  assert.match(html, /data-food-act="del" data-id="50" aria-label="Borrar Yogur natural"/);
  assert.match(text(html), /Registrado hoy 75 kcal/);
  assert.match(text(html), /Yogur natural 1 ración 75 kcal P 12,5 · C 5 · G 0,3/);
  assert.ok(html.indexOf('Desayuno') < html.indexOf('Comida'), 'slots in day order');
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
  const routes = { ...BOOT, 'POST /api/food/log': (init) => { bodies.push(JSON.parse(init.body)); return json({ entry: { ...ENTRY, id: 60 + bodies.length }, totals: TOTALS1 }, 201); } };
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
  const t = setup({ routes, extraIds: ['fp-results'] });
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
  assert.match(t.els['fp-msg'].innerHTML, /data-food-act="p-save-force"/);
  t.fire('click', t.button({ 'data-food-act': 'p-save-force' }));
  await flush();
  assert.equal(posted[1].force, true);
  assert.match(t.els['fp-body'].innerHTML, /Yogur griego/);
  assert.equal(t.els['fp-msg'].textContent, esF.products.saved);
});

test('a product form with a missing required value is not sent', async () => {
  const t = setup({ routes: BOOT });
  await flush();
  t.fire('click', t.button({ 'data-food-act': 'p-new' }));
  t.fire('click', t.button({ 'data-food-act': 'p-label' }));
  for (const [id, v] of [['fpf-name', 'X'], ['fpf-store', 'dia'], ['fpf-unit', 'g'], ['fpf-kcal', '100'], ['fpf-p', ''], ['fpf-c', '1'], ['fpf-f', '1']]) t.input(id, v);
  t.fire('click', t.button({ 'data-food-act': 'p-save' }));
  await flush();
  assert.equal(t.calls.filter((c) => c.key === 'POST /api/food/products').length, 0);
  assert.match(t.els['fp-msg'].textContent, /proteína/);
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
