/* Unit tests for web/src/client/core.js — runs the actual classic-script
 * source through node:vm against web/test/dom-stub.mjs, so these tests
 * exercise the SAME text that gets embedded via `is:inline set:html` in
 * the built page (see astro.config.mjs / layouts/Plan.astro).
 *
 * Contract under test (astro-plan-web slice 3, per design's IMPORTANT note
 * carried from slice 1): setTab/jump/bump must use the LEGACY
 * markup contract — ids like `t-dia`, `.tab-panel[data-tab]`
 * — not slice 1's invented `data-tab-btn` scheme,
 * so the parity test (legacy vs Astro id/onclick sets) passes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { TAB_KEYS, SECTION_TAB } from '../../../lib/nav/tabs.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'core.js'), 'utf8');

function makeContext(doc) {
  const window = { scrollTo: () => { window._scrolledTop = true; } };
  // the page bakes NAV from lib/nav/tabs.mjs (layouts/Plan.astro) before core.js runs
  const NAV = { tabs: [...TAB_KEYS], sectionTab: { ...SECTION_TAB } };
  const ctx = { document: doc, window, setTimeout, console, Math, Number, String, NAV };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return ctx;
}

function makeTabPage(doc) {
  // four top-level tabs (Inicio / Entreno / Salud / Nutrición) — nav ids t-<key>, aria-pressed toggled by setTab
  const tabs = [...TAB_KEYS];
  const navIds = Object.fromEntries(tabs.map((t) => [t, 't-' + t]));
  tabs.forEach((t) => doc.el(navIds[t], { attrs: { 'aria-pressed': String(t === 'home') } }));
  // tab panels — `.tab-panel[data-tab]` contract
  const panels = {};
  tabs.forEach((t) => { panels[t] = doc.el(null, { classes: ['tab-panel'], attrs: { 'data-tab': t }, hidden: t !== 'home' }); });
  // former tabs, now sections inside a panel (id sec-<key>); tablas is a <details> fold
  const sections = {};
  Object.entries(SECTION_TAB).forEach(([key, tab]) => {
    const fold = key === 'tablas';
    sections[key] = doc.el(`sec-${key}`, { tag: fold ? 'details' : 'section', classes: ['tab-section'], attrs: { 'data-section': key }, parent: panels[tab] });
  });
  return { navIds, panels, sections };
}

test('core.js keeps no hand-copied SECTION_TAB: it reads the baked NAV', () => {
  assert.doesNotMatch(source, /hoy:\s*'home'/);
  assert.doesNotMatch(source, /'t-health'/);
});

test('setTab shows the Entreno tab (t-entreno) and hides the others', () => {
  const doc = new StubDocument();
  const { panels, navIds } = makeTabPage(doc);
  const { window } = makeContext(doc);
  window.setTab('entreno');
  assert.equal(panels.entreno.hidden, false);
  assert.equal(panels.home.hidden, true);
  assert.equal(doc.getElementById(navIds.entreno).getAttribute('aria-pressed'), 'true');
  assert.equal(doc.getElementById(navIds.home).getAttribute('aria-pressed'), 'false');
});

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

test('setTab scrolls to top unless called with scrollTop=false (used internally by jump())', () => {
  const doc = new StubDocument();
  makeTabPage(doc);
  const { window } = makeContext(doc);

  window.setTab('health', false);
  assert.equal(window._scrolledTop, undefined, 'no scroll when scrollTop is explicitly false');

  window.setTab('nutricion');
  assert.equal(window._scrolledTop, true);
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

test('no bump() any more: the day builder\'s extras steppers are gone', () => {
  const doc = new StubDocument();
  const { window } = makeContext(doc);
  assert.equal(typeof window.bump, 'undefined');
  assert.doesNotMatch(source, /bldRecalc/);
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
  assert.equal(panels.entreno.hidden, false, 'the Entrenamiento dashboard now lives in Entreno');
  assert.equal(panels.nutricion.hidden, true);
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

test('jumpOr() jumps to a reachable target, else falls back to opening the given tab', async () => {
  const doc = new StubDocument();
  const { panels, sections } = makeTabPage(doc);
  const target = doc.el('hl-recovery', { parent: panels.health });
  const { window } = makeContext(doc);

  window.jumpOr('hl-recovery', 'health');
  assert.equal(panels.health.hidden, false);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(target._scrolledIntoView, true);

  window.setTab('home');
  window.jumpOr('hl-missing', 'health');
  assert.equal(panels.health.hidden, false, 'missing target: open the tab instead');

  window.setTab('home');
  sections.dash.hidden = true;
  window.jumpOr('sec-dash', 'entreno');
  assert.equal(panels.entreno.hidden, false, 'target in a hidden section: open the tab instead');
});

test('the train/rest toggle is gone: core.js exposes no setDay (Resumen de hoy picks the day type)', () => {
  const doc = new StubDocument();
  makeTabPage(doc);
  const { window } = makeContext(doc);
  assert.equal(window.setDay, undefined);
  assert.doesNotMatch(source, /day-toggle|b-train|b-rest/);
});

/* ---------- midnight rollover: one reload when the viewer's day changes ---------- */
function rolloverPage({ at, sheetOpen = false }) {
  const doc = new StubDocument();
  const listeners = {};
  doc.addEventListener = (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); };
  doc.hidden = false;
  const sheet = doc.el('detail', { hidden: !sheetOpen });
  // the inline Mis productos / Mis recetas editors: a field inside the host = an open editor
  const editors = {};
  for (const id of ['fp-body', 'fr-body']) {
    const host = doc.el(id);
    host.fields = 0;
    host.querySelector = (sel) => (/input/.test(sel) && /select/.test(sel) && /textarea/.test(sel) && host.fields ? { tagName: 'INPUT' } : null);
    editors[id] = host;
  }
  doc.activeElement = null;
  const clock = { now: new Date(at).getTime() };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [clock.now])); }
    static now() { return clock.now; }
  }
  const timers = [];
  const reloads = [];
  const winListeners = {};
  const reloadState = { throws: false };
  const window = {
    scrollTo() {},
    location: { reload: () => { reloads.push(clock.now); if (reloadState.throws) throw new Error('sandboxed'); } },
    addEventListener: (evt, fn) => { (winListeners[evt] = winListeners[evt] || []).push(fn); },
  };
  const NAV = { tabs: [...TAB_KEYS], sectionTab: { ...SECTION_TAB } };
  const ctx = {
    document: doc, window, console, Math, Number, String, Array, Object, JSON, NAV, LOCALE: 'en', Date: FakeDate,
    setTimeout, setInterval: (fn, ms) => { timers.push({ fn, ms, on: true }); return timers.length; },
    clearInterval: (id) => { if (timers[id - 1]) timers[id - 1].on = false; },
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  const visible = () => (listeners.visibilitychange || []).forEach((fn) => fn());
  const tick = () => timers.filter((t) => t.on).forEach((t) => t.fn());
  const pageshow = (persisted) => (winListeners.pageshow || []).forEach((fn) => fn({ persisted }));
  const watching = () => timers.filter((t) => t.on).length;
  return { doc, sheet, editors, clock, reloads, timers, visible, tick, pageshow, watching, reloadState };
}

test('rollover: an open product / recipe editor defers the reload (a half-filled form is never lost)', () => {
  for (const id of ['fp-body', 'fr-body']) {
    const p = rolloverPage({ at: '2026-10-01T23:50:00' });
    p.editors[id].fields = 3;
    p.clock.now = new Date('2026-10-02T00:05:00').getTime();
    p.visible();
    assert.equal(p.reloads.length, 0, `${id}: editor open`);
    assert.equal(p.watching(), 1);
    p.tick();
    assert.equal(p.reloads.length, 0, `${id}: still open`);
    p.editors[id].fields = 0; // saved or cancelled
    p.tick();
    assert.equal(p.reloads.length, 1, `${id}: reloads once the editor closed`);
    assert.equal(p.watching(), 0);
  }
});

test('rollover: a focused text field anywhere defers the reload; a focused radio does not', () => {
  const p = rolloverPage({ at: '2026-10-01T23:50:00' });
  p.clock.now = new Date('2026-10-02T00:05:00').getTime();
  p.doc.activeElement = { tagName: 'INPUT', type: 'text' };
  p.visible();
  assert.equal(p.reloads.length, 0);
  p.doc.activeElement = { tagName: 'INPUT', type: 'radio' };
  p.tick();
  assert.equal(p.reloads.length, 1);
});

test('rollover: a page restored from the back-forward cache (pageshow, persisted) reloads on a new day', () => {
  const p = rolloverPage({ at: '2026-10-01T23:50:00' });
  p.pageshow(true);
  assert.equal(p.reloads.length, 0, 'same day');
  p.clock.now = new Date('2026-10-02T06:00:00').getTime();
  p.pageshow(true);
  assert.equal(p.reloads.length, 1);
});

test('rollover: pageshow with the sheet open defers too, and arms one watcher', () => {
  const p = rolloverPage({ at: '2026-10-01T23:50:00', sheetOpen: true });
  p.clock.now = new Date('2026-10-02T06:00:00').getTime();
  p.pageshow(true);
  p.visible();
  assert.equal(p.reloads.length, 0);
  assert.equal(p.watching(), 1);
});

test('rollover: the watcher stops when there is nothing to do (page hidden, clock back) and re-arms on the next event', () => {
  const p = rolloverPage({ at: '2026-10-01T23:50:00', sheetOpen: true });
  p.clock.now = new Date('2026-10-02T00:05:00').getTime();
  p.visible();
  assert.equal(p.watching(), 1);
  p.doc.hidden = true;
  p.tick();
  assert.equal(p.watching(), 0, 'hidden page: no polling in the background');
  p.doc.hidden = false;
  p.visible();
  assert.equal(p.watching(), 1, 're-armed by visibilitychange');
  p.clock.now = new Date('2026-10-01T23:59:00').getTime(); // clock moved back to the load day
  p.tick();
  assert.equal(p.watching(), 0);
  assert.equal(p.reloads.length, 0);
  p.clock.now = new Date('2026-10-02T00:10:00').getTime();
  p.pageshow(false);
  assert.equal(p.watching(), 1, 're-armed by pageshow');
});

test('rollover: a reload that throws (sandboxed frame) is retried on a later visibility change, never in a loop', () => {
  const p = rolloverPage({ at: '2026-10-01T23:50:00' });
  p.reloadState.throws = true;
  p.clock.now = new Date('2026-10-02T00:05:00').getTime();
  assert.doesNotThrow(() => p.visible());
  assert.equal(p.reloads.length, 1);
  assert.equal(p.watching(), 0, 'no watcher retrying every second');
  p.tick();
  assert.equal(p.reloads.length, 1);
  p.reloadState.throws = false;
  p.visible();
  assert.equal(p.reloads.length, 2, 'the next visibility change retries');
});

test('rollover: becoming visible on the same day does nothing; on a new day it reloads once', () => {
  const p = rolloverPage({ at: '2026-10-01T23:50:00' });
  p.visible();
  assert.equal(p.reloads.length, 0, 'same day');
  p.clock.now = new Date('2026-10-02T07:10:00').getTime();
  p.doc.hidden = true;
  p.visible();
  assert.equal(p.reloads.length, 0, 'still hidden: wait for the page to be visible');
  p.doc.hidden = false;
  p.visible();
  assert.equal(p.reloads.length, 1, 'a new day: reload');
  p.visible();
  assert.equal(p.reloads.length, 1, 'never twice');
});

test('rollover: an open detail sheet defers the reload until it closes', () => {
  const p = rolloverPage({ at: '2026-10-01T23:50:00', sheetOpen: true });
  p.clock.now = new Date('2026-10-02T00:05:00').getTime();
  p.visible();
  assert.equal(p.reloads.length, 0, 'the sheet may hold an unsaved food form');
  assert.equal(p.timers.filter((t) => t.on).length, 1, 'one watcher while deferred');
  p.visible();
  assert.equal(p.timers.filter((t) => t.on).length, 1, 'never a second watcher');
  p.tick();
  assert.equal(p.reloads.length, 0, 'still open');
  p.sheet.hidden = true;
  p.tick();
  assert.equal(p.reloads.length, 1, 'reloads once the sheet closed');
  assert.equal(p.timers.filter((t) => t.on).length, 0, 'the watcher stops');
});

test('rollover: a deferred reload also happens on the next visibility change with the sheet closed', () => {
  const p = rolloverPage({ at: '2026-10-01T23:50:00', sheetOpen: true });
  p.clock.now = new Date('2026-10-02T00:05:00').getTime();
  p.visible();
  p.sheet.hidden = true;
  p.visible();
  assert.equal(p.reloads.length, 1);
});

test('rollover: without the shared helpers (HC) core.js wires nothing and never throws', () => {
  const doc = new StubDocument();
  const { window } = makeContext(doc);
  assert.equal(typeof window.setTab, 'function');
});
