/* Content-level regression guard for the example build (astro-plan-web
 * cutover corrective batch). output-guard.test.mjs and css-parity.test.mjs
 * only check STRUCTURE (no external refs, CSS present) — nothing asserts
 * that lib-computed VALUES (day totals, breakfast macros, extras names)
 * actually make it into the right tab's rendered markup. This derives its
 * expectations from the SAME lib functions the Astro pages call (never
 * hardcoded numbers), so it stays correct if the example plan data changes,
 * while still catching a real wiring regression (e.g. a tab reading the
 * wrong view-model, or a value silently dropped from a template).
 *
 * Run `npm run pretest` first (or `npm test`, which runs it automatically).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInputs } from '../../lib/load/inputs.mjs';
import { buildNutrition } from '../../lib/nutrition/macros.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const REPO_ROOT = path.dirname(WEB_ROOT);
const examplePath = path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html');

const dotThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Slices out one tab-panel's markup by finding the next tab-panel's
 * opening <div> (tab panels are rendered as consecutive sibling divs in
 * web/pages/index.astro) — good enough for substring containment checks,
 * no full HTML parser needed. Matches the exact `class="tab-panel"
 * data-tab="..."` opening-tag text, NOT a bare `data-tab="..."` substring —
 * the inlined <style> block also contains `[data-tab="..."] .foo {...}`
 * attribute-selector CSS earlier in the document, which a bare substring
 * search would match first. */
function sliceTabPanel(html, key) {
  const marker = `class="tab-panel" data-tab="${key}"`;
  const markerIdx = html.indexOf(marker);
  assert.ok(markerIdx !== -1, `tab panel <div class="tab-panel" data-tab="${key}"> not found in built HTML`);
  const divStart = html.lastIndexOf('<div', markerIdx);
  const nextIdx = html.indexOf('class="tab-panel" data-tab="', markerIdx + marker.length);
  const end = nextIdx === -1 ? html.length : html.lastIndexOf('<div', nextIdx);
  return html.slice(divStart, end);
}

/** Slices one section (a former tab: dia/registro/tablas/hoy/dash) out of its tab panel — from its
 * `class="tab-section" data-section="..."` opening tag to the next section or tab panel. */
function sliceSection(html, key) {
  const m = new RegExp(`<(section|details) class="tab-section[^"]*" data-section="${key}"`).exec(html);
  assert.ok(m, `section data-section="${key}" not found in built HTML`);
  const rest = html.slice(m.index + m[0].length);
  const next = rest.search(/<(section|details) class="tab-section|<div class="tab-panel"/);
  return html.slice(m.index, next === -1 ? html.length : m.index + m[0].length + next);
}

/** The top-level tab panel that hosts a section (the section must sit INSIDE it). */
function assertSectionInPanel(html, key, tab) {
  const panel = sliceTabPanel(html, tab);
  assert.match(panel, new RegExp(`data-section="${key}"`), `section "${key}" must live inside the "${tab}" tab panel`);
}

function loadExampleNut() {
  const { ingredients, plan } = loadInputs({ repoRoot: REPO_ROOT, dataMode: 'example' });
  const nut = buildNutrition(ingredients, plan);
  return { plan, nut };
}

test('example build renders lib-computed day kcal/protein totals in the Mi día tab', () => {
  assert.ok(fs.existsSync(examplePath), `missing ${examplePath} — run \`npm run pretest\` first`);
  const html = fs.readFileSync(examplePath, 'utf8');
  const { nut } = loadExampleNut();
  const diaHtml = sliceSection(html, 'dia');

  for (const day of ['train', 'rest']) {
    const totals = nut.DAYPLAN[day].meals.reduce((s, meal) => {
      const m = nut.mealMacros(meal);
      return { k: s.k + m.k, p: s.p + m.p, c: s.c + m.c, g: s.g + m.g };
    }, { k: 0, p: 0, c: 0, g: 0 });
    const kcalText = dotThousands(Math.round(totals.k));
    const proteinText = `${Math.round(totals.p)} g`;
    assert.ok(diaHtml.includes(kcalText), `expected the "${day}" day kcal total "${kcalText}" in the Mi día tab, got:\n${diaHtml.slice(0, 400)}`);
    assert.ok(diaHtml.includes(proteinText), `expected the "${day}" day protein total "${proteinText}" in the Mi día tab`);
  }
});

test('example build renders a lib-computed breakfast component row in the Tablas tab', () => {
  assert.ok(fs.existsSync(examplePath), `missing ${examplePath} — run \`npm run pretest\` first`);
  const html = fs.readFileSync(examplePath, 'utf8');
  const { nut } = loadExampleNut();
  const tablasHtml = sliceSection(html, 'tablas');

  assert.ok(nut.breakfast.length > 0, 'example plan must have at least one breakfast option to make this test meaningful');
  const row = nut.breakfast[0].rows[0];
  assert.ok(tablasHtml.includes(row.name), `expected breakfast component name "${row.name}" in the Tablas tab`);
  assert.ok(tablasHtml.includes(`class="kc">${row.k}</td>`), `expected breakfast component kcal "${row.k}" in the Tablas tab`);
  assert.ok(tablasHtml.includes(`<td>${row.p}</td>`), `expected breakfast component protein "${row.p}" in the Tablas tab`);
});

test('example build renders lib-provided extras item names in the Registro tab', () => {
  assert.ok(fs.existsSync(examplePath), `missing ${examplePath} — run \`npm run pretest\` first`);
  const html = fs.readFileSync(examplePath, 'utf8');
  const { plan } = loadExampleNut();
  const registroHtml = sliceSection(html, 'registro');

  assert.ok(plan.extrasDisplay?.length > 0, 'example plan must declare at least one extrasDisplay group to make this test meaningful');
  for (const group of plan.extrasDisplay) {
    for (const item of group.items) {
      assert.ok(registroHtml.includes(item.name), `expected extras item name "${item.name}" (key "${item.key}") in the Registro tab`);
      assert.ok(registroHtml.includes(`id="x-${item.key}"`), `expected the stepper counter #x-${item.key} in the Registro tab`);
    }
  }
});

test('example build: t-home is the first nav button and pressed; the Home panel is visible, Nutrición hidden', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const firstBtn = html.match(/<button id="(t-[a-z]+)"[^>]*>/);
  assert.equal(firstBtn[1], 't-home');
  assert.match(firstBtn[0], /aria-pressed="true"/);
  assert.match(html, /<div class="tab-panel" data-tab="home">/);
  assert.match(html, /<div class="tab-panel" data-tab="nutricion" hidden>/);
  assert.match(html, /<div id="home"><\/div>/);
});

test('example build (synthetic demo extract): SCORES, dials and every Salud section are populated; Home scripts are inline classic scripts', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  assert.match(html, /var SCORES = \{"hasData":true/);
  assert.match(html, /var I18N_SCORE = /);
  assert.match(html, /var DIALS = \{"track":"M[^"]+","sleep":\{"state":"ok"[\s\S]*"recovery":\{"state":"ok"[\s\S]*"load":\{"state":"ok"/, 'dials baked and ungated from demo data');
  const health = JSON.parse(html.match(/var HEALTH = (\{.*?\});\n/)[1]);
  for (const k of ['body', 'activity', 'energy', 'running', 'cycling', 'recovery', 'loadRecovery']) assert.equal(health[k].hasData, true, `HEALTH.${k}`);
  assert.match(html, /Demo Scale/, 'the page names the synthetic source');
  assert.match(html, /var INTAKE = \{"latest":\{"date":"\d{4}-\d{2}-\d{2}"/);
  assert.match(html, /getElementById\('home'\)/);
});

test('example build: every former tab lives as a section in its new tab, in order', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  assertSectionInPanel(html, 'hoy', 'home');
  for (const key of ['dia', 'registro', 'tablas']) assertSectionInPanel(html, key, 'nutricion');
  assertSectionInPanel(html, 'dash', 'entreno');
  const nutricion = sliceTabPanel(html, 'nutricion');
  const order = ['dia', 'registro', 'tablas'].map((k) => nutricion.indexOf(`data-section="${k}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'Nutrición order: Mi día, Registro, Tablas');
  assert.match(sliceSection(html, 'hoy'), /<div id="train-today"><\/div>/);
  assert.match(sliceSection(html, 'dash'), /<div id="train-dash"><\/div>/);
  assert.match(sliceTabPanel(html, 'health'), /<div id="health"><\/div>/);
});

test('example build: glance on Inicio, detail behind it — Entreno holds load detail, run/bike/load-vs-recovery, then the dashboard; Salud holds the rest', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const home = sliceTabPanel(html, 'home');
  assert.doesNotMatch(home, /id="score-load"|id="health-train"|id="health"/, 'no detail hosts on Inicio');
  const entreno = sliceTabPanel(html, 'entreno');
  const at = (id) => entreno.indexOf(`id="${id}"`);
  assert.ok(at('score-load') !== -1 && at('score-load') < at('train-activity') && at('train-activity') < at('health-train') && at('health-train') < at('sec-dash'), 'Entreno order: load detail, calendar + cumulative, run/bike/load vs recovery, dashboard');
  assert.match(html, /var ACTIVITY = \{"hasData":true,"asOf":"\d{4}-\d{2}-\d{2}","days":\[/, 'demo data fills the calendar');
  assert.match(html, /var I18N_ACTIVITY = /);
  assert.match(html, /getElementById\('train-activity'\)/, 'training-activity.js is inlined');
  assert.match(sliceTabPanel(html, 'health'), /<div id="health"><\/div>/);
});

test('example build: Inicio reads today top to bottom — dials, monitor, timeline, advice, eat card, programmed session; the timeline is baked from demo data', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const home = sliceTabPanel(html, 'home');
  const at = ['id="home-dials"', 'id="monitor"', 'id="timeline"', 'id="home"', 'class="eat-card"', 'data-section="hoy"'].map((n) => home.indexOf(n));
  assert.ok(at.every((v, i) => v !== -1 && (i === 0 || v > at[i - 1])), `Inicio order ${at}`);
  assert.match(html, /"timeline":\{"asOf":"\d{4}-\d{2}-\d{2}","days":\[\{"date"/, 'demo data fills the timeline');
  assert.match(html, /getElementById\('timeline'\)/, 'timeline.js is inlined');
});

test('example build (demo intake logged): Mi día keeps the intake rings host and Registro carries no "no food logged" hint', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  assert.match(sliceSection(html, 'dia'), /<div id="intake"><\/div>/);
  assert.doesNotMatch(sliceSection(html, 'registro'), /class="sec-hint"/);
});

test('example build: Registro and Tablas are collapsible <details> folds with a summary', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  for (const key of ['registro', 'tablas']) {
    const sec = sliceSection(html, key);
    assert.match(sec, /^<details class="tab-section/, `${key} must be a <details> fold`);
    assert.match(sec, /<summary/);
  }
});

test('example build: Inicio carries a compact "today you eat" card with the Mi día totals, a day toggle and a link to Nutrición', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const { nut } = loadExampleNut();
  const home = sliceTabPanel(html, 'home');
  const cardAt = home.indexOf('class="eat-card"');
  assert.ok(cardAt !== -1, 'eat card missing from the Inicio panel');
  assert.ok(home.indexOf('<div id="home">') < cardAt && cardAt < home.indexOf('data-section="hoy"'), 'order: scores, eat card, programmed session');
  const card = home.slice(cardAt, home.indexOf('data-section="hoy"'));
  for (const day of ['train', 'rest']) {
    const t = nut.DAYPLAN[day].meals.reduce((s, meal) => {
      const m = nut.mealMacros(meal);
      return { k: s.k + m.k, p: s.p + m.p, c: s.c + m.c, g: s.g + m.g };
    }, { k: 0, p: 0, c: 0, g: 0 });
    // each block runs from its opening tag to the next eat-day block / the card's link
    const blocks = card.split('<div class="eat-day"').slice(1);
    const block = blocks.find((b) => b.startsWith(` data-day="${day}"`));
    assert.ok(block, `eat-day block for ${day} missing`);
    assert.equal(/^ data-day="[a-z]+" hidden/.test(block), day === 'rest', 'train shown by default, rest hidden');
    for (const v of [dotThousands(Math.round(t.k)), `${Math.round(t.p)} g`, `${Math.round(t.c)} g`, `${Math.round(t.g)} g`]) {
      assert.ok(block.split('eat-link')[0].includes(v), `expected "${v}" in the ${day} eat-day block`);
    }
  }
  assert.match(card, /data-set-day="train"[^>]*onclick="setDay\('train'\)"|onclick="setDay\('train'\)"[^>]*data-set-day="train"/);
  assert.match(card, /onclick="setDay\('rest'\)"/);
  assert.match(card, /onclick="setTab\('nutricion'\)"[^>]*>See full plan/);
  assert.doesNotMatch(card, /class="meal"/, 'the full meal plan is NOT duplicated on Inicio');
});

test('example build: the Salud recovery detail card spans the full grid row, headline | sparkline | contributors side by side on wide screens', async () => {
  const { parseCssRules, ruleDeclarationMap } = await import('./css-scan.mjs');
  const html = fs.readFileSync(examplePath, 'utf8');
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const map = ruleDeclarationMap(parseCssRules(css));
  const wide = [...map.entries()].filter(([k]) => k.startsWith('(min-width:900px)|||'));
  assert.ok(wide.some(([k, v]) => k.endsWith('|||grid-column') && k.split('|||')[1].split(',').map((x) => x.trim()).includes('#health > #score-recovery') && v === '1 / -1'), '#score-recovery spans 1 / -1');
  assert.ok(wide.some(([k, v]) => k === '(min-width:900px)|||.rec-layout|||grid-template-columns' && (v.match(/minmax\(/g) || []).length === 3), 'three columns on wide screens');
  assert.ok(![...map.keys()].some((k) => k.startsWith('|||.rec-layout|||grid-template-columns')), 'stacked (one column) on phones');
});

test('example build: the shared client helpers (util.js) are inlined FIRST, right after the baked HC_CONST, before every other script', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const utilIdx = scripts.findIndex((s) => /\bvar HC = \(function/.test(s));
  const constIdx = scripts.findIndex((s) => /\bvar HC_CONST = \{"staleDays":\d+\}/.test(s));
  const coreIdx = scripts.findIndex((s) => /function setTab\(/.test(s));
  assert.ok(constIdx !== -1 && utilIdx !== -1 && coreIdx !== -1, `HC_CONST ${constIdx}, util ${utilIdx}, core ${coreIdx}`);
  assert.ok(constIdx <= utilIdx && utilIdx < coreIdx, 'HC_CONST, then util.js, then core.js and the rest');
  assert.match(html, /var ACTIVITY = \{[^;]*"windowDays":30,"levelMin":\[1,30,60,90\]\}/, 'calendar constants baked from lib');
  const dateIdx = scripts.findIndex((s) => /\bvar I18N_DATE = \{"weekdays":\["Mon"/.test(s));
  assert.ok(dateIdx !== -1 && dateIdx <= utilIdx, 'the date names of HC.fmtDate are baked before util.js');
});

test('example build: the detail sheet ships hidden OUTSIDE .wrap (so the page can go inert), with DETAIL baked for every demo metric and detail.js before freshness.js', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const sheet = /<div id="detail" class="dt-sheet"[^>]*>/.exec(html);
  assert.ok(sheet, 'sheet host present');
  assert.match(sheet[0], /role="dialog"/);
  assert.match(sheet[0], /aria-modal="true"/);
  assert.match(sheet[0], /\shidden(?=[\s>])/);
  const footerEnd = html.lastIndexOf('</footer>');
  assert.ok(html.indexOf('id="detail"') > (footerEnd === -1 ? html.indexOf('class="tab-panel"') : footerEnd), 'after the page content');
  const m = /var DETAIL = (\{.*?\});\nvar I18N_DETAIL = /s.exec(html);
  assert.ok(m, 'DETAIL baked');
  const detail = JSON.parse(m[1].replace(/\\u003c/g, '<'));
  for (const key of ['sleep', 'recovery', 'hrv', 'rhr', 'respiratory', 'wristTemp', 'walkingHr', 'vo2max', 'steps', 'exercise', 'distance', 'flights', 'energy', 'weight', 'bodyfat', 'lean', 'waist', 'workouts', 'load-gym', 'load-run', 'load-bike']) {
    assert.ok(detail.metrics[key] && detail.metrics[key].v.length > 0, `demo DETAIL has ${key}`);
  }
  assert.ok(detail.sessions.length > 0);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
  const detailIdx = scripts.findIndex((s) => /window\.HCDetail = /.test(s));
  assert.ok(detailIdx !== -1 && detailIdx === scripts.length - 2, 'detail.js runs after every card renderer, right before freshness.js');
});

test('example build: the freshness line + Sync button ship HIDDEN (shown only when /api/sync/status answers), copy baked, script last', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const block = /<div class="fresh" id="freshness"[^>]*>/.exec(html);
  assert.ok(block, 'freshness block present');
  assert.match(block[0], /\shidden(?=[\s>])/, 'hidden until freshness.js confirms the endpoint');
  assert.ok(html.indexOf('id="freshness"') < html.indexOf('class="tabnav"'), 'in the header area, above the tab nav');
  assert.match(html, /<button type="button" class="fresh-btn" id="sync-btn">Sync<\/button>/);
  assert.match(html, /var I18N_SYNC = \{"ariaLabel":"Data freshness"/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.match(scripts.at(-1), /\/api\/sync\/status/, 'freshness.js is the last script');
  assert.doesNotMatch(html, /\/export\/|\/ingest\//, 'the page never names a data endpoint');
});
