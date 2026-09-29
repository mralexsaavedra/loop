/* Integration check for plan-data.json's `page.hideTabs[]` (astro-plan-web
 * slice 5) — see lib/nav/tabs.mjs for the unit-tested pure logic. This test
 * is DATA-DRIVEN: it reads whichever `hideTabs` array the personal plan
 * actually declares (instead of hardcoding the owner's current `["hoy"]`),
 * so it keeps passing whenever the owner's plan changes which tab(s) it
 * hides — or hides none at all. See CLAUDE.md's "Hoy tab is optional and
 * source-agnostic". The example build must never hide anything — CLAUDE.md:
 * "Keep the tab in the public plan-web.template.html seed as a working
 * example — never hide it there." (that file is gone post-cutover; the
 * example plan itself is the working example now).
 *
 * Skips gracefully when the personal fixture is absent (fresh clone / CI
 * without the owner's data), same pattern as web/test/leak.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const REPO_ROOT = path.dirname(WEB_ROOT);
const personalHtmlPath = path.join(WEB_ROOT, '.test-dist', 'es-personal', 'index.html');
const exampleHtmlPath = path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html');
const personalPlanPath = path.join(REPO_ROOT, 'data', 'nutrition', 'plan-data.json');
const examplePlanPath = path.join(REPO_ROOT, 'data', 'nutrition', 'plan-data.example.json');

// Every nav-tab key -> its nav <button id> (see web/pages/index.astro's TABS_ALL).
const NAV_ID = { home: 't-home', dia: 't-dia', registro: 't-registro', tablas: 't-tablas', hoy: 't-hoy', dash: 't-dash', health: 't-health' };

function readHideTabs(planPath) {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  return plan.page?.hideTabs || [];
}

test('personal build omits the nav button for every key in plan-data.json\'s page.hideTabs, keeps the rest — and always keeps the tab panel + script', {
  skip: !fs.existsSync(personalHtmlPath) && 'personal fixture not built (no plan-data.json — run npm run pretest)',
}, () => {
  const html = fs.readFileSync(personalHtmlPath, 'utf8');
  const hideTabs = readHideTabs(personalPlanPath);

  for (const [key, navId] of Object.entries(NAV_ID)) {
    const buttonRe = new RegExp(`id="${navId}"`);
    if (hideTabs.includes(key)) {
      assert.doesNotMatch(html, buttonRe, `hideTabs includes "${key}" — its nav button #${navId} must be omitted`);
    } else {
      assert.match(html, buttonRe, `"${key}" is not in hideTabs — its nav button #${navId} must be present`);
    }
    // hideTabs only removes the NAV BUTTON — every tab panel (and its baked
    // globals/script) always renders, matching the legacy "hand-commented
    // nav button, panel stays wired" contract (lib/nav/tabs.mjs's header).
    // Matches the exact `class="tab-panel" data-tab="..."` opening-tag text,
    // NOT a bare `data-tab="..."` substring — the inlined <style> block also
    // contains `[data-tab="..."] .foo {...}` CSS attribute-selector text
    // (present regardless of hideTabs), which a bare substring search would
    // match even when the real markup div were missing (see the same fix in
    // web/test/content.test.mjs, found by RED in the previous batch).
    assert.match(html, new RegExp(`class="tab-panel" data-tab="${key}"`), `the #${key} tab-panel itself must still render regardless of hideTabs`);
  }
});

test('example build does not hide any tab, regardless of the personal plan\'s hideTabs', () => {
  assert.ok(fs.existsSync(exampleHtmlPath), `missing ${exampleHtmlPath} — run npm run pretest first`);
  const html = fs.readFileSync(exampleHtmlPath, 'utf8');
  const exampleHideTabs = readHideTabs(examplePlanPath);
  assert.deepEqual(exampleHideTabs, [], 'the tracked plan-data.example.json must not hide any tab — it is the public working example');
  for (const navId of Object.values(NAV_ID)) {
    assert.match(html, new RegExp(`id="${navId}"`), `example build must keep every nav button, including #${navId}`);
  }
});

/** nav button ids in document order -> tab keys, and the keys of every panel WITHOUT `hidden`. */
function navOrderAndVisiblePanels(html) {
  const idToKey = Object.fromEntries(Object.entries(NAV_ID).map(([k, v]) => [v, k]));
  const nav = [...html.matchAll(/<button id="(t-[a-z]+)"/g)].map((m) => idToKey[m[1]]);
  const panels = [...html.matchAll(/<div class="tab-panel" data-tab="([a-z]+)"( hidden)?[^>]*>/g)];
  return { nav, visible: panels.filter((m) => !m[2]).map((m) => m[1]), all: panels.map((m) => m[1]) };
}

for (const [label, file] of [['example', exampleHtmlPath], ['personal', personalHtmlPath]]) {
  test(`${label} build: exactly one panel is un-hidden and it is the first nav button's tab (R7.1)`, {
    skip: !fs.existsSync(file) && `${label} fixture not built`,
  }, () => {
    const { nav, visible, all } = navOrderAndVisiblePanels(fs.readFileSync(file, 'utf8'));
    assert.ok(nav.length > 0);
    assert.equal(visible.length, 1, `un-hidden panels: ${visible.join(',')}`);
    assert.equal(visible[0], nav[0]);
    assert.ok(all.includes('home'), 'the home panel always renders');
  });
}

test('example build: Home is the first nav button and the active panel', () => {
  const { nav, visible } = navOrderAndVisiblePanels(fs.readFileSync(exampleHtmlPath, 'utf8'));
  assert.equal(nav[0], 'home');
  assert.deepEqual(visible, ['home']);
});
