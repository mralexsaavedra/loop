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

/* ---- three-tab layout: legacy tab keys became SECTIONS inside a top-level tab ---- */
import { resolveNav, SECTION_TAB } from './tabs.mjs';

function threeTabs() {
  return [
    { key: 'home', icon: '🏠', label: 'Inicio' },
    { key: 'nutricion', icon: '🍽️', label: 'Nutrición', sections: ['dia', 'registro', 'tablas'] },
    { key: 'health', icon: '💗', label: 'Salud' },
  ];
}

test('SECTION_TAB maps every legacy tab key to the top-level tab that now hosts it', () => {
  assert.deepEqual({ ...SECTION_TAB }, { hoy: 'home', dia: 'nutricion', registro: 'nutricion', tablas: 'nutricion', dash: 'health' });
});

test('resolveNav: no hideTabs keeps all three tabs and hides no section', () => {
  const r = resolveNav(threeTabs(), undefined);
  assert.deepEqual(r.tabs.map((t) => t.key), ['home', 'nutricion', 'health']);
  assert.deepEqual(r.hiddenSections, []);
});

test('resolveNav: the legacy "hoy" key hides the programmed-session SECTION, not a tab', () => {
  const r = resolveNav(threeTabs(), ['hoy']);
  assert.deepEqual(r.tabs.map((t) => t.key), ['home', 'nutricion', 'health']);
  assert.deepEqual(r.hiddenSections, ['hoy']);
});

test('resolveNav: legacy dia/registro/tablas/dash keys hide their sections', () => {
  const r = resolveNav(threeTabs(), ['registro', 'dash']);
  assert.deepEqual(r.tabs.map((t) => t.key), ['home', 'nutricion', 'health']);
  assert.deepEqual(r.hiddenSections, ['registro', 'dash']);
});

test('resolveNav: top-level keys hide the tab; the first remaining tab becomes active', () => {
  const r = resolveNav(threeTabs(), ['home']);
  assert.deepEqual(r.tabs.map((t) => t.key), ['nutricion', 'health']);
  assert.equal(activeTabKey(r.tabs), 'nutricion');
  assert.deepEqual(resolveNav(threeTabs(), ['nutricion', 'health']).tabs.map((t) => t.key), ['home']);
});

test('resolveNav: a tab made only of sections disappears when every one of its sections is hidden', () => {
  const r = resolveNav(threeTabs(), ['dia', 'registro', 'tablas']);
  assert.deepEqual(r.tabs.map((t) => t.key), ['home', 'health']);
  assert.deepEqual(r.hiddenSections, ['dia', 'registro', 'tablas']);
});

test('resolveNav: hiding every top-level tab leaves nothing, so activeTabKey throws', () => {
  assert.throws(() => activeTabKey(resolveNav(threeTabs(), ['home', 'nutricion', 'health']).tabs), /every tab is hidden/i);
  assert.throws(() => activeTabKey(resolveNav(threeTabs(), ['home', 'health', 'dia', 'registro', 'tablas']).tabs), /every tab is hidden/i);
});

test('resolveNav ignores unknown keys', () => {
  const r = resolveNav(threeTabs(), ['nonexistent']);
  assert.deepEqual(r.tabs.map((t) => t.key), ['home', 'nutricion', 'health']);
  assert.deepEqual(r.hiddenSections, []);
});
