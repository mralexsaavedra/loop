/* Integration check for plan-data.json's `page.hideTabs[]` (astro-plan-web
 * slice 5; three-tab layout) — see lib/nav/tabs.mjs for the unit-tested pure logic.
 * Top-level keys (home/nutricion/health) remove a nav button; the legacy keys
 * (hoy/dia/registro/tablas/dash) now hide the matching SECTION inside a tab. This test
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
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const REPO_ROOT = path.dirname(WEB_ROOT);
const personalHtmlPath = path.join(WEB_ROOT, '.test-dist', 'es-personal', 'index.html');
const exampleHtmlPath = path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html');
const personalPlanPath = path.join(REPO_ROOT, 'data', 'nutrition', 'plan-data.json');
const examplePlanPath = path.join(REPO_ROOT, 'data', 'nutrition', 'plan-data.example.json');

// Every top-level nav key -> its nav <button id> (see web/pages/index.astro's TABS_ALL).
const NAV_ID = { home: 't-home', nutricion: 't-nutricion', health: 't-health' };
// Legacy tab keys, now sections -> the tab panel that hosts them (lib/nav/tabs.mjs SECTION_TAB).
const SECTION_TAB = { hoy: 'home', dia: 'nutricion', registro: 'nutricion', tablas: 'nutricion', dash: 'health' };

function readHideTabs(planPath) {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  return plan.page?.hideTabs || [];
}

/** { key: isHidden } for every `class="tab-section" data-section="..."` opening tag. */
function sectionStates(html) {
  const out = {};
  for (const m of html.matchAll(/<(?:section|details) class="tab-section[^"]*" data-section="([a-z]+)"[^>]*>/g)) {
    out[m[1]] = /\shidden(?=[\s>])/.test(m[0]);
  }
  return out;
}

/** nav button ids in document order -> tab keys, and the keys of every panel WITHOUT `hidden`. */
function navOrderAndVisiblePanels(html) {
  const idToKey = Object.fromEntries(Object.entries(NAV_ID).map(([k, v]) => [v, k]));
  const nav = [...html.matchAll(/<button id="(t-[a-z]+)"/g)].map((m) => idToKey[m[1]]);
  const panels = [...html.matchAll(/<div class="tab-panel" data-tab="([a-z]+)"( hidden)?[^>]*>/g)];
  return { nav, visible: panels.filter((m) => !m[2]).map((m) => m[1]), all: panels.map((m) => m[1]) };
}

/** Assert a built page honours `hideTabs` for both nav buttons and sections. */
function assertHonours(html, hideTabs) {
  const hidden = new Set(hideTabs);
  const states = sectionStates(html);
  for (const key of Object.keys(SECTION_TAB)) {
    assert.ok(key in states, `section "${key}" must always render (hideTabs only hides it)`);
    assert.equal(states[key], hidden.has(key), `section "${key}" hidden=${states[key]}, expected ${hidden.has(key)}`);
  }
  const allSectionsGone = ['dia', 'registro', 'tablas'].every((k) => hidden.has(k));
  for (const [key, navId] of Object.entries(NAV_ID)) {
    const expectHidden = hidden.has(key) || (key === 'nutricion' && allSectionsGone);
    const re = new RegExp(`id="${navId}"`);
    if (expectHidden) assert.doesNotMatch(html, re, `"${key}" hidden — nav button #${navId} must be omitted`);
    else assert.match(html, re, `"${key}" visible — nav button #${navId} must be present`);
    // panels always render (baked globals + scripts stay wired)
    assert.match(html, new RegExp(`class="tab-panel" data-tab="${key}"`), `the ${key} tab-panel must still render`);
  }
  const { nav, visible } = navOrderAndVisiblePanels(html);
  assert.ok(nav.length <= 3);
  assert.deepEqual(visible, [nav[0]], 'exactly one panel visible: the first nav button\'s');
}

test('personal build honours plan-data.json\'s page.hideTabs (nav buttons + sections)', {
  skip: !fs.existsSync(personalHtmlPath) && 'personal fixture not built (no plan-data.json — run npm run pretest)',
}, () => {
  assertHonours(fs.readFileSync(personalHtmlPath, 'utf8'), readHideTabs(personalPlanPath));
});

test('example build does not hide any tab or section, regardless of the personal plan\'s hideTabs', () => {
  assert.ok(fs.existsSync(exampleHtmlPath), `missing ${exampleHtmlPath} — run npm run pretest first`);
  const html = fs.readFileSync(exampleHtmlPath, 'utf8');
  assert.deepEqual(readHideTabs(examplePlanPath), [], 'the tracked plan-data.example.json must not hide any tab — it is the public working example');
  assertHonours(html, []);
  assert.equal(sectionStates(html).hoy, false, 'the programmed-session section is visible in the example');
});

for (const [label, file] of [['example', exampleHtmlPath], ['personal', personalHtmlPath]]) {
  test(`${label} build: exactly 3 nav items max, one un-hidden panel = the first nav button's tab (R7.1)`, {
    skip: !fs.existsSync(file) && `${label} fixture not built`,
  }, () => {
    const { nav, visible, all } = navOrderAndVisiblePanels(fs.readFileSync(file, 'utf8'));
    assert.ok(nav.length > 0 && nav.length <= 3);
    assert.equal(visible.length, 1, `un-hidden panels: ${visible.join(',')}`);
    assert.equal(visible[0], nav[0]);
    assert.deepEqual(all, ['home', 'nutricion', 'health'], 'the three panels always render, in order');
  });
}

test('example build: exactly 3 nav items, Home first and the active panel', () => {
  const { nav, visible } = navOrderAndVisiblePanels(fs.readFileSync(exampleHtmlPath, 'utf8'));
  assert.deepEqual(nav, ['home', 'nutricion', 'health']);
  assert.deepEqual(visible, ['home']);
});

/** Build the tracked example inputs under os.tmpdir() with a given hideTabs; returns spawn result + html. */
function buildWithHideTabs(hideTabs) {
  // Throwaway repo root holding copies of the tracked example inputs; HC_REPO_ROOT points env.mjs
  // at it, so no repo file is touched.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hide-tabs-'));
  try {
    fs.mkdirSync(path.join(tmp, 'data', 'nutrition'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'data', 'training'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'data', 'nutrition', 'ingredients.json'), path.join(tmp, 'data', 'nutrition', 'ingredients.json'));
    fs.copyFileSync(path.join(REPO_ROOT, 'data', 'training', 'training-data.example.json'), path.join(tmp, 'data', 'training', 'training-data.example.json'));
    const plan = JSON.parse(fs.readFileSync(examplePlanPath, 'utf8'));
    plan.page = { ...(plan.page || {}), hideTabs };
    fs.writeFileSync(path.join(tmp, 'data', 'nutrition', 'plan-data.example.json'), JSON.stringify(plan));
    const outDir = path.join(tmp, 'out');
    const r = spawnSync(path.join(REPO_ROOT, 'node_modules', '.bin', 'astro'), ['build', '--root', WEB_ROOT, '--outDir', outDir], {
      env: { ...process.env, HC_REPO_ROOT: tmp, DATA_MODE: 'example', LOCALE: 'en' },
      encoding: 'utf8',
    });
    const htmlPath = path.join(outDir, 'index.html');
    return { r, html: fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : null };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('build-level: legacy keys hide their sections; top-level keys hide their tab', () => {
  for (const hideTabs of [['hoy'], ['dia', 'dash'], ['registro', 'tablas', 'home'], ['dia', 'registro', 'tablas'], ['health']]) {
    const { r, html } = buildWithHideTabs(hideTabs);
    assert.equal(r.status, 0, `build with hideTabs=${JSON.stringify(hideTabs)} failed:\n${r.stderr}`);
    assertHonours(html, hideTabs);
  }
});

test('build-level: hiding EVERY top-level tab fails the Astro build with a clear message (no orphan visible panel)', () => {
  for (const hideTabs of [Object.keys(NAV_ID), ['home', 'health', 'dia', 'registro', 'tablas']]) {
    const { r } = buildWithHideTabs(hideTabs);
    assert.notEqual(r.status, 0, `the build must fail for hideTabs=${JSON.stringify(hideTabs)}`);
    assert.match(r.stdout + r.stderr, /every tab is hidden/i);
  }
});
