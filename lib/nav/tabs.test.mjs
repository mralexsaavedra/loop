/* Unit tests for lib/nav/tabs.mjs's filterTabs — the pure logic behind
 * plan-data.json's `page.hideTabs[]` (astro-plan-web slice 5). Data-driven
 * replacement for the legacy pattern of hand-commenting a nav <button> out
 * of plan-web.html (see CLAUDE.md's "Hoy tab is optional and source-
 * agnostic"). Only the NAV BUTTON is ever filtered — the tab-panel, its
 * baked globals and its client script always stay in the build (same
 * "panel stays intact" contract CLAUDE.md documents for the legacy path). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTabs } from './tabs.mjs';

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
