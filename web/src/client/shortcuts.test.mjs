/* web/src/client/shortcuts.js — the page's keyboard shortcuts (1-4 tabs, a add food, d journal, ? the help
 * sheet) and the help sheet view. Runs the classic script in a vm over the DOM stub, after util.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { loadUtil } from '../../test/client-util.mjs';
import { en, es } from '../i18n/detail-templates.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'shortcuts.js'), 'utf8');
const LABELS = { home: 'Inicio', entreno: 'Entreno', health: 'Salud', nutricion: 'Nutrición' };

function page({ tabs = ['home', 'entreno', 'health', 'nutricion'], actions = ['food', 'journal'], sheetOpen = false, popOpen = false, locale = 'es' } = {}) {
  const doc = new StubDocument();
  const listeners = {};
  doc.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  const clicks = [];
  for (const k of tabs) {
    const b = doc.el('t-' + k, { tag: 'button', attrs: { 'data-tab-go': k } });
    b.textContent = LABELS[k];
    b.click = () => clicks.push(k);
  }
  doc.el('act-pop', { hidden: !popOpen });
  const ran = [], opened = [];
  const window = {
    HCActions: { run: (name) => { if (!actions.includes(name)) return false; ran.push(name); return true; } },
    HCDetail: { open: (key, date) => opened.push([key, date]), state: () => (sheetOpen ? { key: 'hrv' } : null) },
  };
  const ctx = { document: doc, window, NAV: { tabs: ['home', 'entreno', 'health', 'nutricion'] }, I18N_DETAIL: locale === 'es' ? es : en, LOCALE: locale };
  vm.createContext(ctx);
  loadUtil(ctx);
  if (actions.includes('food')) ctx.HC.registerView('food-add', { render: () => ({}) });
  if (actions.includes('journal')) ctx.HC.registerView('journal', { render: () => ({}) });
  vm.runInContext(source, ctx);
  const body = doc.el(null, { tag: 'body' });
  const key = (k, mods = {}, target = body) => {
    const e = { type: 'keydown', key: k, target, defaultPrevented: false, ...mods };
    e.preventDefault = () => { e.defaultPrevented = true; };
    (listeners.keydown || []).forEach((fn) => fn(e));
    return e;
  };
  return { doc, window, ctx, clicks, ran, opened, key };
}

test('1-4 press the visible tabs\' buttons in nav order; a hidden tab shifts the numbers; 5+ does nothing', () => {
  const p = page();
  for (const k of ['1', '2', '3', '4']) assert.equal(p.key(k).defaultPrevented, true);
  assert.deepEqual(p.clicks, ['home', 'entreno', 'health', 'nutricion']);
  assert.equal(p.key('5').defaultPrevented, false);
  const q = page({ tabs: ['home', 'health', 'nutricion'] });
  q.key('2');
  q.key('4');
  assert.deepEqual(q.clicks, ['health'], 'Entreno hidden: 2 is Salud, 4 is nobody');
});

test('a opens the add food sheet and d the journal through HCActions; an action the page lacks lets the key through', () => {
  const p = page();
  assert.equal(p.key('a').defaultPrevented, true);
  assert.equal(p.key('d').defaultPrevented, true);
  assert.deepEqual(p.ran, ['food', 'journal']);
  const q = page({ actions: [] });
  assert.equal(q.key('a').defaultPrevented, false, 'example build: no food API, nothing happens');
  assert.equal(q.key('A', { shiftKey: true }).defaultPrevented, false, 'Shift+A is not a');
});

test('? opens the help sheet', () => {
  const p = page();
  assert.equal(p.key('?', { shiftKey: true }).defaultPrevented, true);
  assert.deepEqual(p.opened, [['shortcuts', null]]);
});

test('ignored while typing, with Ctrl / Cmd / Alt (the browser keeps Cmd+1), with a sheet or the "+" popover open, or when already handled', () => {
  const p = page();
  for (const tag of ['input', 'textarea', 'select']) assert.equal(p.key('1', {}, p.doc.el(null, { tag })).defaultPrevented, false, tag);
  const editable = p.doc.el(null, { tag: 'div' });
  editable.isContentEditable = true;
  p.key('a', {}, editable);
  p.key('1', { metaKey: true });
  p.key('1', { ctrlKey: true });
  p.key('a', { altKey: true });
  p.key('?', { isComposing: true });
  p.key('1', { defaultPrevented: true });
  assert.deepEqual([p.clicks, p.ran, p.opened], [[], [], []]);
  for (const opts of [{ sheetOpen: true }, { popOpen: true }]) {
    const q = page(opts);
    q.key('1');
    q.key('a');
    q.key('?');
    assert.deepEqual([q.clicks, q.ran, q.opened], [[], [], []], JSON.stringify(opts));
  }
});

test('the help sheet: a registered view listing the tabs by their own names, the actions this page has and the add sheet\'s keys', () => {
  const p = page();
  const view = p.ctx.HC.view('shortcuts');
  assert.equal(view.title(), 'Atajos de teclado');
  const { body } = view.render();
  const txt = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const s of ['1 Inicio', '2 Entreno', '3 Salud', '4 Nutrición', 'a Añadir comida', 'd Diario', '? Esta lista', '↑ ↓ Recorrer los resultados', 'Intro Elegir', '← → En las pestañas', 'Esc Volver a la lista']) assert.ok(txt.includes(s), s);
  assert.match(body, /<kbd class="kb">1<\/kbd>/);
  const q = page({ actions: [], tabs: ['home', 'nutricion'], locale: 'en' });
  const t2 = q.ctx.HC.view('shortcuts').render().body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(t2.includes('1 Inicio') && t2.includes('2 Nutrición'));
  assert.ok(!/Add food|Journal/.test(t2), 'no food / journal API: no a / d rows');
  assert.equal(q.ctx.HC.view('shortcuts').title(), 'Keyboard shortcuts');
});
