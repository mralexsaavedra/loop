/* Unit tests for lib/nav/tabs.mjs's filterTabs — the pure logic behind
 * plan-data.json's `page.hideTabs[]` (astro-plan-web slice 5). Data-driven
 * replacement for the legacy pattern of hand-commenting a nav <button> out
 * of the pre-Astro generated page (deleted at the astro-plan-web cutover) —
 * see CLAUDE.md's "Hoy tab is optional and source-
 * agnostic"). Only the NAV BUTTON is ever filtered — the tab-panel, its
 * baked globals and its client script always stay in the build (same
 * "panel stays intact" contract CLAUDE.md documents for the legacy path). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTabs, activeTabKey } from './tabs.mjs';

function fixtureTabs() {
  return [
    { key: 'dia', icon: '🍽️', label: 'Mi día' },
    { key: 'registro', icon: '📋', label: 'Registro' },
    { key: 'tablas', icon: '📊', label: 'Tablas' },
    { key: 'hoy', icon: '🏋️', label: 'Hoy' },
    { key: 'dash', icon: '📈', label: 'Entrenos' },
  ];
}

test('filterTabs removes tabs whose key is in hideTabs, preserving order', () => {
  const result = filterTabs(fixtureTabs(), ['hoy']);
  assert.deepEqual(result.map((t) => t.key), ['dia', 'registro', 'tablas', 'dash']);
});

test('filterTabs with an empty hideTabs array returns every tab unchanged', () => {
  const result = filterTabs(fixtureTabs(), []);
  assert.deepEqual(result, fixtureTabs());
});

test('filterTabs defaults to no hiding when hideTabs is undefined/null', () => {
  assert.deepEqual(filterTabs(fixtureTabs(), undefined).map((t) => t.key), ['dia', 'registro', 'tablas', 'hoy', 'dash']);
  assert.deepEqual(filterTabs(fixtureTabs(), null).map((t) => t.key), ['dia', 'registro', 'tablas', 'hoy', 'dash']);
});

test('filterTabs ignores hideTabs keys that do not match any tab', () => {
  const result = filterTabs(fixtureTabs(), ['nonexistent']);
  assert.deepEqual(result.map((t) => t.key), ['dia', 'registro', 'tablas', 'hoy', 'dash']);
});

test('filterTabs can hide multiple tabs at once', () => {
  const result = filterTabs(fixtureTabs(), ['hoy', 'dash']);
  assert.deepEqual(result.map((t) => t.key), ['dia', 'registro', 'tablas']);
});

test('activeTabKey is the first key of the FILTERED list, so a hidden first tab hands over to the next', () => {
  const all = [{ key: 'home' }, ...fixtureTabs()];
  assert.equal(activeTabKey(filterTabs(all, [])), 'home');
  assert.equal(activeTabKey(filterTabs(all, ['home'])), 'dia');
  assert.equal(activeTabKey(filterTabs(all, ['home', 'dia'])), 'registro');
});

test('activeTabKey throws a clear error when every tab is hidden (no orphan visible panel)', () => {
  const all = fixtureTabs();
  assert.throws(() => activeTabKey(filterTabs(all, all.map((t) => t.key))), /every tab is hidden/i);
  assert.throws(() => activeTabKey([]), /every tab is hidden/i);
});


/* ---- four-tab layout: legacy tab keys became SECTIONS inside a top-level tab ---- */
import { resolveNav, SECTION_TAB, TAB_KEYS, sectionsOf, showDayToggle } from './tabs.mjs';

function fourTabs() {
  return [
    { key: 'home', icon: '🏠', label: 'Inicio' },
    { key: 'entreno', icon: '🏃', label: 'Entreno' },
    { key: 'health', icon: '💗', label: 'Salud' },
    { key: 'nutricion', icon: '🍽️', label: 'Nutrición', sections: sectionsOf('nutricion') },
  ];
}

test('TAB_KEYS lists the four top-level tabs in nav order', () => {
  assert.deepEqual([...TAB_KEYS], ['home', 'entreno', 'health', 'nutricion']);
});

test('SECTION_TAB maps every legacy tab key to the top-level tab that now hosts it (dash lives in Entreno)', () => {
  assert.deepEqual({ ...SECTION_TAB }, { hoy: 'home', dash: 'entreno', dia: 'nutricion', registro: 'nutricion', tablas: 'nutricion' });
  for (const tab of Object.values(SECTION_TAB)) assert.ok(TAB_KEYS.includes(tab));
});

test('sectionsOf derives a tab\'s sections from SECTION_TAB (no second hand-kept list)', () => {
  assert.deepEqual(sectionsOf('nutricion'), ['dia', 'registro', 'tablas']);
  assert.deepEqual(sectionsOf('entreno'), ['dash']);
  assert.deepEqual(sectionsOf('health'), []);
});

test('resolveNav: no hideTabs keeps all four tabs and hides no section', () => {
  const r = resolveNav(fourTabs(), undefined);
  assert.deepEqual(r.tabs.map((t) => t.key), ['home', 'entreno', 'health', 'nutricion']);
  assert.deepEqual(r.hiddenSections, []);
});

test('resolveNav: the legacy "hoy" key hides the programmed-session SECTION, not a tab', () => {
  const r = resolveNav(fourTabs(), ['hoy']);
  assert.deepEqual(r.tabs.map((t) => t.key), ['home', 'entreno', 'health', 'nutricion']);
  assert.deepEqual(r.hiddenSections, ['hoy']);
});

test('resolveNav: legacy dia/registro/tablas/dash keys hide their sections; Entreno stays (it holds more than dash)', () => {
  const r = resolveNav(fourTabs(), ['registro', 'dash']);
  assert.deepEqual(r.tabs.map((t) => t.key), ['home', 'entreno', 'health', 'nutricion']);
  assert.deepEqual(r.hiddenSections, ['dash', 'registro']);
});

test('resolveNav: top-level keys hide the tab; the first remaining tab becomes active', () => {
  const r = resolveNav(fourTabs(), ['home']);
  assert.deepEqual(r.tabs.map((t) => t.key), ['entreno', 'health', 'nutricion']);
  assert.equal(activeTabKey(r.tabs), 'entreno');
  assert.deepEqual(resolveNav(fourTabs(), ['home', 'entreno']).tabs.map((t) => t.key), ['health', 'nutricion']);
  assert.deepEqual(resolveNav(fourTabs(), ['nutricion', 'health', 'entreno']).tabs.map((t) => t.key), ['home']);
});

test('resolveNav: a tab made only of sections disappears when every one of its sections is hidden', () => {
  const r = resolveNav(fourTabs(), ['dia', 'registro', 'tablas']);
  assert.deepEqual(r.tabs.map((t) => t.key), ['home', 'entreno', 'health']);
  assert.deepEqual(r.hiddenSections, ['dia', 'registro', 'tablas']);
});

test('resolveNav: hiding every top-level tab leaves nothing, so activeTabKey throws', () => {
  assert.throws(() => activeTabKey(resolveNav(fourTabs(), ['home', 'entreno', 'health', 'nutricion']).tabs), /every tab is hidden/i);
  assert.throws(() => activeTabKey(resolveNav(fourTabs(), ['home', 'entreno', 'health', 'dia', 'registro', 'tablas']).tabs), /every tab is hidden/i);
});

test('resolveNav ignores unknown keys', () => {
  const r = resolveNav(fourTabs(), ['nonexistent']);
  assert.deepEqual(r.tabs.map((t) => t.key), ['home', 'entreno', 'health', 'nutricion']);
  assert.deepEqual(r.hiddenSections, []);
});

test('showDayToggle: the train/rest toggle only drives Mi día and Registro, so it is off when both are hidden', () => {
  assert.equal(showDayToggle([]), true);
  assert.equal(showDayToggle(undefined), true);
  assert.equal(showDayToggle(['dia']), true);
  assert.equal(showDayToggle(['registro']), true);
  assert.equal(showDayToggle(['dia', 'registro']), false, 'only Tablas left: no toggle');
  assert.equal(showDayToggle(['nutricion']), false, 'Nutrición hidden: no toggle');
});
