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
  // three top-level tabs (Inicio / Nutrición / Salud) — nav ids t-<key>, aria-pressed toggled by setTab
  const tabs = ['home', 'nutricion', 'health'];
  const navIds = { home: 't-home', nutricion: 't-nutricion', health: 't-health' };
  tabs.forEach((t) => doc.el(navIds[t], { attrs: { 'aria-pressed': String(t === 'home') } }));
  // tab panels — `.tab-panel[data-tab]` contract
  const panels = {};
  tabs.forEach((t) => { panels[t] = doc.el(null, { classes: ['tab-panel'], attrs: { 'data-tab': t }, hidden: t !== 'home' }); });
  // former tabs, now sections inside a panel (id sec-<key>); registro/tablas are <details> folds
  const SECTION_TAB = { hoy: 'home', dia: 'nutricion', registro: 'nutricion', tablas: 'nutricion', dash: 'health' };
  const sections = {};
  Object.entries(SECTION_TAB).forEach(([key, tab]) => {
    const fold = key === 'registro' || key === 'tablas';
    sections[key] = doc.el(`sec-${key}`, { tag: fold ? 'details' : 'section', classes: ['tab-section'], attrs: { 'data-section': key }, parent: panels[tab] });
  });
  doc.el('day-toggle', { attrs: {} });
  return { navIds, panels, sections };
}

test('setTab shows only the matching .tab-panel[data-tab] and hides the rest (legacy contract)', () => {
  const doc = new StubDocument();
  const { panels } = makeTabPage(doc);
  const { window } = makeContext(doc);

  window.setTab('nutricion');

  assert.equal(panels.home.hidden, true);
  assert.equal(panels.nutricion.hidden, false);
  assert.equal(panels.health.hidden, true);
});

test('setTab toggles aria-pressed on the nav button ids (t-home, t-nutricion, t-health)', () => {
  const doc = new StubDocument();
  const { navIds } = makeTabPage(doc);
  const { window } = makeContext(doc);

  window.setTab('health');

  assert.equal(doc.getElementById(navIds.home).getAttribute('aria-pressed'), 'false');
  assert.equal(doc.getElementById(navIds.health).getAttribute('aria-pressed'), 'true');
  assert.equal(doc.getElementById(navIds.nutricion).getAttribute('aria-pressed'), 'false');
});

test('setTab shows the day-toggle only on the Nutrición tab', () => {
  const doc = new StubDocument();
  makeTabPage(doc);
  const { window } = makeContext(doc);
  const dayToggle = doc.getElementById('day-toggle');

  window.setTab('health');
  assert.equal(dayToggle.style.display, 'none');

  window.setTab('nutricion');
  assert.equal(dayToggle.style.display, '');
});

test('setTab scrolls to top unless called with scrollTop=false (used internally by jump())', () => {
  const doc = new StubDocument();
  makeTabPage(doc);
  const { window } = makeContext(doc);

  window.setTab('health', false);
  assert.equal(window._scrolledTop, undefined, 'no scroll when scrollTop is explicitly false');

  window.setTab('nutricion');
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
  const details = doc.el('acc-proteina', { tag: 'details', open: false, parent: panels.nutricion });
  panels.nutricion.hidden = true;
  const { window } = makeContext(doc);

  window.jump('acc-proteina');

  assert.equal(panels.nutricion.hidden, false, 'jump switches to the details element\'s enclosing tab');
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
  window.setTab('nutricion');
  window.setTab('home');
  assert.equal(panels.home.hidden, false);
  assert.equal(panels.nutricion.hidden, true);
  assert.equal(doc.getElementById(navIds.home).getAttribute('aria-pressed'), 'true');
  assert.equal(doc.getElementById(navIds.nutricion).getAttribute('aria-pressed'), 'false');
  assert.equal(doc.getElementById('day-toggle').style.display, 'none');
});

test('setTab with a legacy tab key opens the tab that now hosts that section and scrolls to it', async () => {
  const doc = new StubDocument();
  const { panels, sections, navIds } = makeTabPage(doc);
  const { window } = makeContext(doc);

  window.setTab('tablas');

  assert.equal(panels.nutricion.hidden, false);
  assert.equal(panels.home.hidden, true);
  assert.equal(doc.getElementById(navIds.nutricion).getAttribute('aria-pressed'), 'true');
  assert.equal(sections.tablas.open, true, 'the collapsed Tablas fold is opened');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sections.tablas._scrolledIntoView, true);

  window.setTab('dash');
  assert.equal(panels.health.hidden, false);
});

test('jump() into a table nested in a collapsed section fold opens the fold too', () => {
  const doc = new StubDocument();
  const { sections } = makeTabPage(doc);
  const inner = doc.el('acc-anclaje', { tag: 'details', open: false, parent: sections.tablas });
  const { window } = makeContext(doc);

  window.jump('acc-anclaje');

  assert.equal(inner.open, true);
  assert.equal(sections.tablas.open, true, 'the enclosing <details class="tab-section"> must open, or the target stays invisible');
});

test('jump() is a no-op for a target inside a section hidden by page.hideTabs', () => {
  const doc = new StubDocument();
  const { panels, sections } = makeTabPage(doc);
  sections.hoy.hidden = true;
  panels.home.hidden = true;
  panels.health.hidden = false;
  const target = doc.el('in-hoy', { parent: sections.hoy });
  const { window } = makeContext(doc);

  window.jump('in-hoy');

  assert.equal(panels.home.hidden, true, 'must not switch to a tab just to land on a hidden section');
  assert.equal(target._scrolledIntoView, false);
});

test('setDay also switches the Inicio "today you eat" card (.eat-day) and every [data-set-day] toggle button', () => {
  const doc = new StubDocument();
  doc.el(null, { classes: ['day-panel'], attrs: { 'data-day': 'train' } });
  doc.el(null, { classes: ['day-panel'], attrs: { 'data-day': 'rest' }, hidden: true });
  const eatTrain = doc.el(null, { classes: ['eat-day'], attrs: { 'data-day': 'train' } });
  const eatRest = doc.el(null, { classes: ['eat-day'], attrs: { 'data-day': 'rest' }, hidden: true });
  doc.el('b-train', { attrs: { 'aria-pressed': 'true' } });
  doc.el('b-rest', { attrs: { 'aria-pressed': 'false' } });
  const cardTrain = doc.el(null, { tag: 'button', attrs: { 'data-set-day': 'train', 'aria-pressed': 'true' } });
  const cardRest = doc.el(null, { tag: 'button', attrs: { 'data-set-day': 'rest', 'aria-pressed': 'false' } });
  const { window } = makeContext(doc);

  window.setDay('rest');

  assert.equal(eatTrain.hidden, true);
  assert.equal(eatRest.hidden, false);
  assert.equal(cardTrain.getAttribute('aria-pressed'), 'false');
  assert.equal(cardRest.getAttribute('aria-pressed'), 'true');
});
