/* Tests for Inicio's block order (web/src/client/home-order.ts): the user's order and show / hide of the
 * blocks below the tiles (My day … My dashboard), kept in localStorage, applied to the page at load and
 * after every change in the "Customize Home" sheet (the shared HC.orderList, client/util.ts). Runs the
 * classic script in a vm over a tiny fake DOM (one panel whose children can be moved). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { es as esT, en as enT } from '../i18n/score-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';
import { clientScriptSource } from '../client-bundle.mjs';

// a module script: run the bytes the page inlines (web/src/client-bundle.mjs)
const source = clientScriptSource('home-order.ts');
const plain = (x) => JSON.parse(JSON.stringify(x));
const KEY = 'hc-home-v1';

function storage(init = {}, { broken = false } = {}) {
  const data = { ...init };
  return {
    data,
    getItem: (k) => { if (broken) throw new Error('denied'); return k in data ? data[k] : null; },
    setItem: (k, v) => { if (broken) throw new Error('denied'); data[k] = String(v); },
  };
}
// the Inicio panel as built: dials, tiles, the six movable blocks, the "Customize Home" row, Hoy's source
function panel({ without = [] } = {}) {
  const kids = [];
  const parent = {
    children: kids,
    insertBefore(n, ref) {
      const i = kids.indexOf(n);
      if (i !== -1) kids.splice(i, 1);
      const at = ref ? kids.indexOf(ref) : -1;
      if (at === -1) kids.push(n); else kids.splice(at, 0, n);
      n.parentNode = parent;
    },
  };
  const node = (sel) => {
    const cls = new Set();
    const n = { sel, parentNode: parent, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
      toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); } } };
    kids.push(n);
    return n;
  };
  ['#home-dials', '#home-tiles', '#my-day', '.eat-card', '#home-tonight', '#my-journal', '#my-plan', '#my-dash', '#home-cust', '[data-section="hoy"]']
    .filter((s) => !without.includes(s)).forEach(node);
  return { parent, find: (sel) => kids.find((n) => n.sel === sel) || null, order: () => kids.map((n) => n.sel) };
}
function load({ locale = 'en', ls = storage(), dom = panel(), noStorage = false } = {}) {
  const listeners = {};
  const opened = [];
  const ctx = {
    document: {
      readyState: 'complete',
      querySelector: (s) => dom.find(s),
      getElementById: (id) => dom.find('#' + id),
      addEventListener: (e, f) => { listeners[e] = f; },
    },
    I18N_SCORE: locale === 'es' ? esT : enT, LOCALE: locale,
    HCDetail: { open: (k, d, o) => opened.push([k, o && o.focus]) },
    Math, String, Number, Array, Object, JSON,
  };
  if (!noStorage) ctx.localStorage = ls;
  ctx.window = ctx;
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  const click = (attrs) => listeners.click({ target: { closest: (s) => (s === '[data-home-act]' ? { getAttribute: (k) => attrs[k] } : null) } });
  return { ctx, dom, ls, click, opened };
}
const BUILT = ['#home-dials', '#home-tiles', '#my-day', '.eat-card', '#home-tonight', '#my-journal', '#my-plan', '#my-dash', '#home-cust', '[data-section="hoy"]'];

test('defaults: every block shown, the built order kept (dials and tiles stay on top, Hoy\'s source last)', () => {
  const { ctx, dom } = load();
  assert.deepEqual(plain(ctx.HCHomeOrder.CATALOG), ['day', 'eat', 'tonight', 'journal', 'plan', 'dash']);
  assert.deepEqual(dom.order(), BUILT);
  assert.ok(BUILT.every((s) => !dom.find(s).classList.contains('home-off')));
});

test('a saved order moves the blocks (above "Customize Home"), a hidden one gets home-off; unknown keys ignored, missing ones append shown', () => {
  const ls = storage({ [KEY]: JSON.stringify({ order: ['dash', 'bogus', 'day', 'plan'], hidden: ['plan', 'bogus'] }) });
  const { dom } = load({ ls });
  assert.deepEqual(dom.order(), ['#home-dials', '#home-tiles', '#my-dash', '#my-day', '#my-plan', '.eat-card', '#home-tonight', '#my-journal', '#home-cust', '[data-section="hoy"]']);
  assert.ok(dom.find('#my-plan').classList.contains('home-off'));
  assert.ok(!dom.find('#my-dash').classList.contains('home-off'));
  assert.ok(!dom.find('.eat-card').classList.contains('home-off'), 'not in the saved order: its default (shown)');
});

test('customize sheet: one row per block present (a missing block is not listed), full names, switch + ↑ / ↓ + ≡', () => {
  const { ctx } = load({ dom: panel({ without: ['#my-journal'] }) });
  const v = ctx.HCViews['home-edit'];
  assert.equal(v.title(), 'Customize Home');
  const body = v.render().body;
  assert.deepEqual([...body.matchAll(/<span class="db-name">([^<]+)<\/span>/g)].map((m) => m[1]), ['My day', 'Today you eat', 'Tonight', 'My plan', 'My dashboard']);
  assert.equal([...body.matchAll(/data-home-act="toggle"/g)].length, 5);
  assert.equal([...body.matchAll(/data-home-grip=""/g)].length, 5);
  assert.match(body, /aria-label="Show My plan on Home" data-home-act="toggle" data-key="plan"/);
  assert.match(body, /data-home-act="up" data-key="day" aria-label="Move My day up" disabled/);
});

test('a click saves, re-applies the order on the page and re-opens the sheet with the focus kept', () => {
  const { dom, ls, click, opened } = load();
  click({ 'data-home-act': 'up', 'data-key': 'dash' });
  click({ 'data-home-act': 'toggle', 'data-key': 'eat' });
  assert.deepEqual(JSON.parse(ls.data[KEY]), { order: ['day', 'eat', 'tonight', 'journal', 'dash', 'plan'], hidden: ['eat'] });
  assert.deepEqual(dom.order().slice(2, 8), ['#my-day', '.eat-card', '#home-tonight', '#my-journal', '#my-dash', '#my-plan']);
  assert.ok(dom.find('.eat-card').classList.contains('home-off'));
  click({ 'data-home-act': 'toggle', 'data-key': 'eat' });
  assert.ok(!dom.find('.eat-card').classList.contains('home-off'), 'switched back on');
  assert.deepEqual(plain(opened.at(-1)), ['home-edit', '[data-home-act="toggle"][data-key="eat"]']);
});

test('storage that throws: the built order, and changes still apply for the visit (in memory)', () => {
  const { dom, click } = load({ ls: storage({}, { broken: true }) });
  assert.deepEqual(dom.order(), BUILT);
  click({ 'data-home-act': 'toggle', 'data-key': 'tonight' });
  assert.ok(dom.find('#home-tonight').classList.contains('home-off'));
});

test('without the "Customize Home" row (no anchor) nothing moves', () => {
  const ls = storage({ [KEY]: JSON.stringify({ order: ['dash', 'day'], hidden: [] }) });
  const { dom } = load({ ls, dom: panel({ without: ['#home-cust'] }) });
  assert.deepEqual(dom.order(), BUILT.filter((s) => s !== '#home-cust'));
});

test('Spanish: the block names and the sheet title', () => {
  const { ctx } = load({ locale: 'es' });
  const v = ctx.HCViews['home-edit'];
  assert.equal(v.title(), 'Personalizar inicio');
  assert.deepEqual([...v.render().body.matchAll(/<span class="db-name">([^<]+)<\/span>/g)].map((m) => m[1]), ['Mi día', 'Hoy comes', 'Esta noche', 'Mi diario', 'Mi plan', 'Mi panel']);
});
