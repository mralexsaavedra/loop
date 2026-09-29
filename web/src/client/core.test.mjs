/* Unit tests for web/src/client/core.js — runs the actual classic-script
 * source through node:vm against web/test/dom-stub.mjs, so these tests
 * exercise the SAME text that gets embedded via `is:inline set:html` in
 * the built page (see astro.config.mjs / layouts/Plan.astro).
 *
 * Contract under test (astro-plan-web slice 3, per design's IMPORTANT note
 * carried from slice 1): setTab/setDay/jump/bump must use the LEGACY
 * markup contract — ids like `t-dia`/`b-train`, `.tab-panel[data-tab]`,
 * `.day-panel[data-day]` — not slice 1's invented `data-tab-btn` scheme,
 * so the parity test (legacy vs Astro id/onclick sets) passes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'core.js'), 'utf8');

function makeContext(doc) {
  const window = { scrollTo: () => { window._scrolledTop = true; } };
  const ctx = { document: doc, window, setTimeout, console, Math, Number, String };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return ctx;
}

function makeTabPage(doc) {
  // nav buttons — legacy ids, aria-pressed toggled by setTab
  const tabs = ['home', 'dia', 'registro', 'tablas', 'hoy', 'dash', 'health'];
  const navIds = { home: 't-home', dia: 't-dia', registro: 't-registro', tablas: 't-tablas', hoy: 't-hoy', dash: 't-dash', health: 't-health' };
  tabs.forEach((t) => doc.el(navIds[t], { attrs: { 'aria-pressed': String(t === 'home') } }));
  // tab panels — legacy `.tab-panel[data-tab]` contract, NOT data-tab-panel
  const panels = {};
  tabs.forEach((t) => { panels[t] = doc.el(null, { classes: ['tab-panel'], attrs: { 'data-tab': t }, hidden: t !== 'home' }); });
  doc.el('day-toggle', { attrs: {} });
  return { navIds, panels };
}

test('setTab shows only the matching .tab-panel[data-tab] and hides the rest (legacy contract)', () => {
  const doc = new StubDocument();
  const { panels } = makeTabPage(doc);
  const { window } = makeContext(doc);

  window.setTab('registro');

  assert.equal(panels.dia.hidden, true);
  assert.equal(panels.registro.hidden, false);
  assert.equal(panels.tablas.hidden, true);
});

test('setTab toggles aria-pressed on the legacy nav button ids (t-dia, t-registro, ...)', () => {
  const doc = new StubDocument();
  const { navIds } = makeTabPage(doc);
  const { window } = makeContext(doc);

  window.setTab('tablas');

  assert.equal(doc.getElementById(navIds.dia).getAttribute('aria-pressed'), 'false');
  assert.equal(doc.getElementById(navIds.tablas).getAttribute('aria-pressed'), 'true');
  assert.equal(doc.getElementById(navIds.registro).getAttribute('aria-pressed'), 'false');
});

test('setTab hides the day-toggle outside dia/registro and shows it for dia/registro', () => {
  const doc = new StubDocument();
  makeTabPage(doc);
  const { window } = makeContext(doc);
  const dayToggle = doc.getElementById('day-toggle');

  window.setTab('hoy');
  assert.equal(dayToggle.style.display, 'none');

  window.setTab('registro');
  assert.equal(dayToggle.style.display, '');
});

test('setTab scrolls to top unless called with scrollTop=false (used internally by jump())', () => {
  const doc = new StubDocument();
  makeTabPage(doc);
  const { window } = makeContext(doc);

  window.setTab('tablas', false);
  assert.equal(window._scrolledTop, undefined, 'no scroll when scrollTop is explicitly false');

  window.setTab('dia');
  assert.equal(window._scrolledTop, true);
});

test('setDay toggles .day-panel[data-day] hidden state and b-train/b-rest aria-pressed', () => {
  const doc = new StubDocument();
  const trainPanel = doc.el(null, { classes: ['day-panel'], attrs: { 'data-day': 'train' }, hidden: false });
  const restPanel = doc.el(null, { classes: ['day-panel'], attrs: { 'data-day': 'rest' }, hidden: true });
  doc.el('b-train', { attrs: { 'aria-pressed': 'true' } });
  doc.el('b-rest', { attrs: { 'aria-pressed': 'false' } });
  const { window } = makeContext(doc);

  window.setDay('rest');

  assert.equal(trainPanel.hidden, true);
  assert.equal(restPanel.hidden, false);
  assert.equal(doc.getElementById('b-train').getAttribute('aria-pressed'), 'false');
  assert.equal(doc.getElementById('b-rest').getAttribute('aria-pressed'), 'true');
});

test('setDay calls window.bldRefresh() when nutrition.js has registered it (legacy hook pattern)', () => {
  const doc = new StubDocument();
  doc.el(null, { classes: ['day-panel'], attrs: { 'data-day': 'train' } });
  doc.el(null, { classes: ['day-panel'], attrs: { 'data-day': 'rest' } });
  doc.el('b-train', { attrs: { 'aria-pressed': 'true' } });
  doc.el('b-rest', { attrs: { 'aria-pressed': 'false' } });
  const { window } = makeContext(doc);
  let refreshed = false;
  window.bldRefresh = () => { refreshed = true; };

  window.setDay('rest');

  assert.equal(refreshed, true);
});

test('jump() opens the target <details>, switches to its tab (without scrolling the page top), then scrolls it into view', async () => {
  const doc = new StubDocument();
  const { panels } = makeTabPage(doc);
  const details = doc.el('acc-proteina', { tag: 'details', attrs: { 'data-tab': undefined }, open: false, parent: panels.tablas });
  panels.tablas.hidden = true;
  const { window } = makeContext(doc);

  window.jump('acc-proteina');

  assert.equal(panels.tablas.hidden, false, 'jump switches to the details element\'s enclosing tab');
  assert.equal(details.open, true);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(details._scrolledIntoView, true);
});

test('jump() is a no-op when the target id does not exist', () => {
  const doc = new StubDocument();
  const { window } = makeContext(doc);
  assert.doesNotThrow(() => window.jump('nope'));
});

test('bump() increments/decrements the legacy `x-<key>` counter element, clamped at 0', () => {
  const doc = new StubDocument();
  doc.el('x-cafe', { textContent: '0' });
  const { window } = makeContext(doc);

  window.bump('cafe', 1);
  assert.equal(doc.getElementById('x-cafe').textContent, '1');

  window.bump('cafe', 1);
  assert.equal(doc.getElementById('x-cafe').textContent, '2');

  window.bump('cafe', -5);
  assert.equal(doc.getElementById('x-cafe').textContent, '0', 'clamped at 0, never negative');
});

test('bump() calls window.bldRecalc() after updating the counter (nutrition.js registers this hook)', () => {
  const doc = new StubDocument();
  doc.el('x-aceite', { textContent: '0' });
  const { window } = makeContext(doc);
  let recalced = 0;
  window.bldRecalc = () => { recalced += 1; };

  window.bump('aceite', 1);

  assert.equal(recalced, 1);
});

test('setTab knows the Home tab: t-home <-> home', () => {
  const doc = new StubDocument();
  const { panels, navIds } = makeTabPage(doc);
  const { window } = makeContext(doc);
  window.setTab('registro');
  window.setTab('home');
  assert.equal(panels.home.hidden, false);
  assert.equal(panels.registro.hidden, true);
  assert.equal(doc.getElementById(navIds.home).getAttribute('aria-pressed'), 'true');
  assert.equal(doc.getElementById(navIds.registro).getAttribute('aria-pressed'), 'false');
  assert.equal(doc.getElementById('day-toggle').style.display, 'none');
});
