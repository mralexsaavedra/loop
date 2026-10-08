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
import { TAB_KEYS } from '../../lib/nav/tabs.mjs';
import { buildNutrition } from '../../lib/nutrition/macros.mjs';
import * as nutriToday from '../../lib/nutrition/today.mjs';
import { buildReference } from '../../lib/nutrition/reference.mjs';

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

/** Slices one section (a former tab: dia/tablas/hoy/dash) out of its tab panel — from its
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

test('example build: the dia section carries Resumen de hoy (day type radios only, target host, intake host), Plan de hoy and the ride-fuelling block, and bakes the 12 lib-computed plans', () => {
  assert.ok(fs.existsSync(examplePath), `missing ${examplePath} — run \`npm run pretest\` first`);
  const html = fs.readFileSync(examplePath, 'utf8');
  const { plan, nut } = loadExampleNut();
  const dia = sliceSection(html, 'dia');
  const at = ["Today's summary", 'id="nutri-daytype"', 'id="nutri-target"', 'id="intake"', 'id="food-log-block"', "Today's plan", 'id="nutri-plan"', 'id="nutri-fuel-block"', 'Ride fuelling'].map((n) => {
    const i = dia.indexOf(n.replace("'", '&#39;')); // Astro escapes the apostrophe in text
    return i !== -1 ? i : dia.indexOf(n);
  });
  at.forEach((i, n) => assert.ok(i !== -1, `marker ${n} missing from the dia section`));
  assert.deepEqual([...at].sort((x, y) => x - y), at, 'order: summary, food log (Registrar), plan, fuelling');
  // labelled radios: the 4 day types are the ONLY control; the goal lives in the profile sheet (a chip
  // next to today's kcal, client-rendered, opens it)
  assert.equal((dia.match(/<input type="radio" name="nutri-day"/g) || []).length, 4);
  assert.doesNotMatch(dia, /nutri-goal"|name="nutri-goal/, 'no goal radio group in Nutrición');
  assert.match(dia, /<div class="nutri-block" id="nutri-fuel-block" hidden>/, 'fuelling shows only on bike day types (client-side)');
  // the baked plans are the lib's own
  const m = html.match(/var NUTRI = (\{.*?\});\n/);
  assert.ok(m, 'NUTRI bake missing');
  const baked = JSON.parse(m[1]);
  const { buildNutriToday } = nutriToday;
  const expected = buildNutriToday(nut, plan, { units: { g: 'g', ml: 'ml', ud: 'pc' }, dec: '.', supplements: baked.supplements, weight: baked.weight });
  assert.deepEqual(baked.plans, JSON.parse(JSON.stringify(expected.plans)));
  assert.equal(baked.supplements.length, 3, 'the synthetic example supplements ride along');
});

test('example build: Nutrición opens like Salud / Entreno (centred title + ⓘ), the summary notes sit behind its ⓘ, the kcal ring bakes the Inicio ring', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const nutricion = sliceTabPanel(html, 'nutricion');
  assert.match(nutricion, /<div class="hs-top nu-top">\s*<h2 class="hs-title">Nutrition<\/h2>\s*<button type="button" class="hs-i" data-hs-info="nu-intro" aria-expanded="false" aria-controls="nu-intro" aria-label="About Nutrition">/);
  assert.match(nutricion, /<div class="hs-info" id="nu-intro" hidden><p>[^<]+<\/p><p>[^<]*not medical advice\.[^<]*<\/p><\/div>/);
  assert.ok(nutricion.indexOf('id="nu-intro"') < nutricion.indexOf('data-section="dia"'), 'the header leads the tab');
  assert.match(nutricion, /<h2 class="hs-lbl">Today(&#39;|')s summary<\/h2>\s*<button type="button" class="hs-i" data-hs-info="nutri-sum-info"[^>]*aria-label="About Today(&#39;|')s summary"/);
  assert.match(nutricion, /<div class="hs-info" id="nutri-sum-info" hidden><\/div>/, 'filled by nutri-day.js');
  assert.match(html, /var NUTRI_ARC = "M60 6A54 54 0 0 1 60 114A54 54 0 0 1 60 6";/, 'the full ring of view/dial.mjs, no 270° arc');
});

test('example build: Balance (intake vs expenditure + macro split) lives in Nutrición, after the day\'s blocks and before Progreso; Salud has no host for it', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const dia = sliceSection(html, 'dia');
  assert.match(dia, /<div class="nutri-block" id="nutri-balance" hidden><\/div>/, 'client-rendered by health.js, hidden until it has something');
  const at = (id) => dia.indexOf(`id="${id}"`);
  assert.ok(at('nutri-fuel-block') < at('nutri-balance') && at('nutri-balance') < at('nutri-progress-block'), 'order: fuelling, Balance, Progreso');
  assert.equal(sliceTabPanel(html, 'health').indexOf('nutri-balance'), -1);
  assert.match(html, /"balance":\{"from":"\d{4}-\d{2}-\d{2}"/, 'the demo extract carries a balance window');
});

test('example build: Tablas shows fixed reference values per natural unit (lib/nutrition/reference.mjs), never portions', () => {
  assert.ok(fs.existsSync(examplePath), `missing ${examplePath} — run \`npm run pretest\` first`);
  const html = fs.readFileSync(examplePath, 'utf8');
  const { nut } = loadExampleNut();
  const tablasHtml = sliceSection(html, 'tablas');
  const ref = buildReference(nut, { lang: 'en', words: { raw: 'raw', dry: 'dry', cooked: 'cooked', serving: 'serving', unit: 'pc' } });
  assert.match(tablasHtml, /<p class="acc-note tablas-ref-note">Reference values per natural unit/);
  // a breakfast is a group row + its component foods
  assert.ok(tablasHtml.includes(`<tr class="ref-group"><td colspan="6">${ref.desayunos[0].name}</td></tr>`));
  // a countable food: per piece with the grams reference, flagged as a typical weight
  assert.match(tablasHtml, /<td>Banana<\/td>\s*<td class="ref-unit">1 medium banana \(~120 g\)<small class="ref-typ">typical weight<\/small><\/td>\s*<td class="kc">106<\/td>/);
  // rice / pasta per 100 g dry, ONE table (no train / rest portion columns)
  assert.match(tablasHtml, /<td>Rice<\/td>\s*<td class="ref-unit">100 g dry<\/td>\s*<td class="kc">360<\/td>/);
  assert.equal((tablasHtml.match(/<td>Rice<\/td>/g) || []).length, 1);
  assert.doesNotMatch(tablasHtml, /Cant\.|<caption>🏋️|Training<\/caption>|tb-cc-|tb-prot-/);
});

test('example build: Tablas reference headers align with their cells (text columns left, numeric columns right)', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const tablasHtml = sliceSection(html, 'tablas');
  // the Reference header carries the same class as its (left-aligned, sans) cells; kcal / P / C / F stay numeric
  assert.match(tablasHtml, /<thead><tr><th>Food<\/th><th class="ref-unit">Reference<\/th><th>kcal<\/th><th>P<\/th><th>C<\/th><th>F<\/th><\/tr><\/thead>/);
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const rule = (sel) => { const m = css.match(new RegExp('(?:^|[}\\s,])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[,{][^}]*}')); return m ? m[0] : ''; };
  assert.match(rule('th.ref-unit'), /text-align:\s*left/, 'the Reference header is left-aligned like its cells');
  assert.match(rule('th:first-child'), /text-align:\s*left/, 'the first column (food) header stays left-aligned');
  assert.match(rule('th'), /text-align:\s*right/, 'numeric headers stay right-aligned with their cells');
});

test('example build: the day builder (Constructor de día, section registro) is gone: no section, no form, no script, no builder-only bakes', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  assert.doesNotMatch(html, /data-section="registro"|id="sec-registro"/);
  assert.doesNotMatch(html, /id="bld-|id="r-verdict"|id="x-|bldRefresh|bldRecalc|window\.bump/);
  for (const g of ['TARGET', 'EXTRA_KEYS', 'EXTRA_NAMES', 'INDULGE', 'ALCOHOL_KEYS', 'MEAL_REPLACE_KEYS', 'I18N_VERDICT', 'I18N_LOG', 'PE_LABEL', 'COPY_MSG', 'COPY_FALLBACK_MSG']) {
    assert.doesNotMatch(html, new RegExp(`var ${g}\\s*=`), `${g} was baked only for the day builder`);
  }
  assert.doesNotMatch(html, /Day builder|Constructor de día/);
  // Tablas is server-rendered reference values now: no client painter, no bakes for it
  for (const g of ['DATA', 'EXTRAS', 'VEG_KEYS', 'QUESO_KEYS', 'FRUIT_SUMMARY', 'I18N_TABLAS']) assert.doesNotMatch(html, new RegExp(`var ${g}\\s*=`), g);
  assert.doesNotMatch(html, /paint\(\s*["']tb-prot-lean["']/, 'client/tablas.js is gone');
});

test('example build: t-home is the first nav button and pressed; the Home panel is visible, Nutrición hidden', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const firstBtn = html.match(/<button id="(t-[a-z]+)"[^>]*>/);
  assert.equal(firstBtn[1], 't-home');
  assert.match(firstBtn[0], /aria-pressed="true"/);
  assert.match(html, /<div class="tab-panel" data-tab="home">/);
  assert.match(html, /<div class="tab-panel" data-tab="nutricion" hidden>/);
  assert.match(html, /<div id="home-advice"><\/div>/);
});

test('example build: no tab key is an element id, so a #<tab> URL never scrolls the page to an element', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  for (const key of TAB_KEYS) {
    assert.doesNotMatch(html, new RegExp(`\\sid="${key}"`), `id="${key}" collides with the #${key} tab hash`);
  }
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
  assert.match(html, /getElementById\(["']home-advice["']\)/);
});

test('example build: every former tab lives as a section in its new tab, in order', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  assertSectionInPanel(html, 'hoy', 'home');
  for (const key of ['dia', 'tablas']) assertSectionInPanel(html, key, 'nutricion');
  assertSectionInPanel(html, 'dash', 'entreno');
  const nutricion = sliceTabPanel(html, 'nutricion');
  const order = ['dia', 'tablas'].map((k) => nutricion.indexOf(`data-section="${k}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'Nutrición order: Mi día, Tablas');
  assert.match(sliceSection(html, 'hoy'), /<div id="train-today"><\/div>/);
  assert.match(sliceSection(html, 'dash'), /<div id="train-dash"><\/div>/);
  assert.doesNotMatch(sliceSection(html, 'dash'), /<h2/, 'the former Workouts dashboard heading is gone: its volume / split merged into the Activity card');
  assert.equal((sliceTabPanel(html, 'entreno').match(/<h2/g) || []).length, 1, 'Entreno has ONE page heading (the centred title)');
  assert.match(sliceTabPanel(html, 'health'), /<div id="health-body"><\/div>/);
});

test('example build: glance on Inicio, detail behind it — Entreno holds the load summary, the Activity card, run/bike/load-vs-recovery, then intensity; Salud holds the rest', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const home = sliceTabPanel(html, 'home');
  assert.doesNotMatch(home, /id="score-load"|id="health-train"|id="health-body"/, 'no detail hosts on Inicio');
  const entreno = sliceTabPanel(html, 'entreno');
  // header like Salud's: centred uppercase title + an ⓘ whose hidden block holds the intro + shared caveats
  assert.match(entreno, /<div class="hs-top tr-top">\s*<h2 class="hs-title">Training<\/h2>\s*<button type="button" class="hs-i" data-hs-info="tr-intro" aria-expanded="false" aria-controls="tr-intro" aria-label="About Training">/);
  assert.match(entreno, /<div class="hs-info" id="tr-intro" hidden><p>[^<]+<\/p><p>[^<]+<\/p><p>[^<]*not medical advice\.<\/p><\/div>/);
  assert.ok(entreno.indexOf('id="tr-intro"') < entreno.indexOf('id="score-load"'), 'the header leads the tab');
  assert.doesNotMatch(html.match(/var I18N_ACTIVITY = (\{.*?\});\n/)[1], /"head"/, 'the header copy is built, not baked for the client');
  const at = (id) => entreno.indexOf(`id="${id}"`);
  assert.ok(at('score-load') !== -1 && at('score-load') < at('train-activity') && at('train-activity') < at('health-train') && at('health-train') < at('sec-dash'), 'Entreno order: load summary, Activity card, run/bike/load vs recovery, intensity');
  assert.match(html, /var ACTIVITY = \{"hasData":true,"asOf":"\d{4}-\d{2}-\d{2}","first":"\d{4}-\d{2}-\d{2}","days":\[/, 'demo data fills the Activity card');
  assert.match(html, /var I18N_ACTIVITY = /);
  assert.match(html, /getElementById\(["']train-activity["']\)/, 'training-activity.js is inlined');
  assert.match(sliceTabPanel(html, 'health'), /<div id="health-body"><\/div>/);
});

test('example build: Inicio reads today top to bottom — dials, monitor tiles, "My day" (outlook bar + today\'s activities), eat card, Tonight / My plan / My dashboard, the programmed-session source; the timeline is baked from demo data', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const home = sliceTabPanel(html, 'home');
  const at = ['id="home-dials"', 'id="home-tiles"', 'id="my-day"', 'id="home-advice"', 'id="timeline"', 'class="eat-card"', 'id="home-tonight"', 'id="my-plan"', 'id="my-dash"', 'data-section="hoy"'].map((n) => home.indexOf(n));
  assert.ok(at.every((v, i) => v !== -1 && (i === 0 || v > at[i - 1])), `Inicio order ${at}`);
  assert.match(home, /<h2 class="home-h" id="my-day-h">My day<\/h2>/);
  // the full monitor list moved to Salud: Inicio keeps only the summary tiles (no fold, no grid)
  assert.doesNotMatch(home, /id="monitor"|monitor-fold|hm-fold/);
  assert.match(html, /"timeline":\{"asOf":"\d{4}-\d{2}-\d{2}","days":\[\{"date"/, 'demo data fills the timeline');
  assert.match(html, /getElementById\(["']timeline["']\)/, 'timeline.js is inlined');
  assert.match(html, /getElementById\(["']home-tiles["']\)/, 'monitor.js writes the tiles');
  // Tonight + My plan ship hidden; client/home-week.js (an end-of-body script) reveals them
  assert.match(home, /<div id="home-tonight" hidden><\/div>/);
  assert.match(home, /<section class="home-sec" id="my-plan" aria-labelledby="my-plan-h" hidden>\s*<h2 class="home-h" id="my-plan-h">My plan<\/h2>/);
  assert.doesNotMatch(home, /<script/, 'no script inside the Inicio panel');
  // home-week.js + home-dash.js run in the end-of-body list, after their globals and before
  // deepdive.js / detail.js, so their views (tonight, dash-edit) exist when detail.js runs
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
  const idx = (re) => scripts.findIndex((x) => re.test(x));
  const week = idx(/window\.HCWeekPlan\s*=/), dash = idx(/window\.HCDash\s*=/), deep = idx(/window\.HCDeep\s*=/), detail = idx(/window\.HCDetail\s*=/);
  const adherence = idx(/window\.HCAdherence\s*=/), util = idx(/var HC\s*=\s*\(function/);
  assert.ok(util !== -1 && adherence !== -1 && week > adherence && week > util, 'after util.js and adherence.js');
  assert.ok(dash > week && deep > dash && detail === deep + 1, 'home-week → home-dash → deepdive → detail');
  assert.match(home, /<section class="home-sec" id="my-dash" aria-labelledby="my-dash-h" hidden>[\s\S]*?My dashboard<\/h2>\s*<button type="button" class="db-cust" id="dash-edit" data-detail="dash-edit"/);
  assert.match(html, /"tonight":\{"asOf":"\d{4}-\d{2}-\d{2}","wake":/, 'demo data bakes a bedtime');
});

test('example build: the health monitor list leads Salud (before the sections host) and Inicio\'s summary tile jumps to it', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const salud = sliceTabPanel(html, 'health');
  // header first: the centred title + an ⓘ toggle holding the tab intro, the green glow behind it
  const at = ['class="hs-glow"', '<h2 class="hs-title">Health</h2>', '<span class="hs-i-slot" id="hs-intro-i" data-label="About Health"></span>', '<div class="hs-info" id="hs-intro" hidden>', 'id="monitor"', 'id="health-body"'].map((n) => salud.indexOf(n));
  // the ⓘ itself is HC.infoBtn's markup, written by client/health.js: no static copy in the tab
  assert.doesNotMatch(salud.slice(0, salud.indexOf('id="monitor"')), /<button[^>]*class="hs-i"/);
  assert.ok(at.every((v, i) => v !== -1 && (i === 0 || v > at[i - 1])), `Salud order ${at}`);
  assert.match(salud, /<div class="hs-info" id="hs-intro" hidden><p>Body, activity &amp; recovery from your latest Apple Health export\.<\/p><p>Each row:/);
  assert.ok(salud.indexOf('<div id="monitor"></div>') !== -1, 'the monitor host is in Salud');
  assert.ok(salud.indexOf('<div id="monitor"></div>') < salud.indexOf('<div id="health-body"></div>'), 'monitor first');
  assert.equal(html.split('id="monitor"').length - 1, 1, 'one monitor host on the page');
  assert.match(html, /jump\(\\?'monitor\\?'\)/, 'the tile still jumps to #monitor');
  assert.match(html, /"anchorTab":\{"monitor":"health"\}/, '#monitor deep-links to Salud');
});

test('example build: the programmed session is a row of "Today\'s activities", not a block — its section is a hidden source the session sheet reads', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  assert.match(sliceSection(html, 'hoy'), /^<section class="tab-section hoy-src" data-section="hoy" id="sec-hoy" aria-hidden="true">/);
  assert.match(html, /\.hoy-src\{display:none\}|\.hoy-src \{\s*display: none;?\s*\}/);
  assert.match(html, /HCViews\[["']hoy-session["']\]|["']hoy-session["']/, 'training-today.js registers the session view');
});

test('example build (demo intake logged): Mi día keeps the intake rings host', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  assert.match(sliceSection(html, 'dia'), /<div id="intake"><\/div>/);
});

test('example build: Tablas is a collapsible <details> fold with a summary', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  for (const key of ['tablas']) {
    const sec = sliceSection(html, key);
    assert.match(sec, /^<details class="tab-section/, `${key} must be a <details> fold`);
    assert.match(sec, /<summary/);
  }
});

test('example build: Inicio carries a compact "today you eat" card (filled client-side with today\'s target) and a link to Nutrición', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const home = sliceTabPanel(html, 'home');
  const cardAt = home.indexOf('class="eat-card"');
  assert.ok(cardAt !== -1, 'eat card missing from the Inicio panel');
  assert.ok(home.indexOf('<div id="home-advice">') < cardAt && cardAt < home.indexOf('id="home-tonight"'), 'order: dials + advice, eat card, then Tonight');
  const card = home.slice(cardAt, home.indexOf('id="home-tonight"'));
  assert.match(card, /<div id="eat-body" aria-live="polite"><\/div>/);
  assert.match(card, /onclick="setTab\('nutricion'\)"[^>]*>See the full plan/);
  assert.doesNotMatch(card, /class="meal"/, 'the full meal plan is NOT duplicated on Inicio');
});

test('example build: the Salud recovery card stays stacked at every width (headline, trend, contributors in 2 × 2)', async () => {
  const { parseCssRules, ruleDeclarationMap } = await import('./css-scan.mjs');
  const html = fs.readFileSync(examplePath, 'utf8');
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const map = ruleDeclarationMap(parseCssRules(css)); // selectors in css-scan's canonical form (`a>b`)
  assert.ok(![...map.keys()].some((k) => k.endsWith('|||.rec-layout|||grid-template-columns')), 'no column template on .rec-layout at any width');
  assert.equal(String(map.get('|||.rec-contrib|||grid-template-columns')).replace(/\s+/g, ''), 'repeat(2,minmax(0,1fr))', 'the contributors are a 2 × 2 block');
});

test('example build: the shared client helpers (util.js) are inlined FIRST, right after the baked HC_CONST, before every other script', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const utilIdx = scripts.findIndex((s) => /\bvar HC\s*=\s*\(function/.test(s));
  const constIdx = scripts.findIndex((s) => /\bvar HC_CONST = \{"staleDays":\d+\}/.test(s));
  const coreIdx = scripts.findIndex((s) => /function setTab\(/.test(s));
  assert.ok(constIdx !== -1 && utilIdx !== -1 && coreIdx !== -1, `HC_CONST ${constIdx}, util ${utilIdx}, core ${coreIdx}`);
  assert.ok(constIdx <= utilIdx && utilIdx < coreIdx, 'HC_CONST, then util.js, then core.js and the rest');
  assert.match(html, /var ACTIVITY = \{[^;]*"windowDays":30,"periods":\[7,30,182\],"bakeDays":367,"levelMin":\[1,30,60,90\]\}/, 'calendar + window constants baked from lib');
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
  const detailIdx = scripts.findIndex((s) => /window\.HCDetail\s*=/.test(s));
  assert.ok(detailIdx !== -1 && detailIdx === scripts.length - 2, 'detail.js runs after every card renderer, right before freshness.js');
});

test('example build: the freshness line + Sync button ship HIDDEN (shown only when /api/sync/status answers), copy baked, script last', () => {
  const html = fs.readFileSync(examplePath, 'utf8');
  const block = /<div class="fresh" id="freshness"[^>]*>/.exec(html);
  assert.ok(block, 'freshness block present');
  assert.match(block[0], /\shidden(?=[\s>])/, 'hidden until freshness.js confirms the endpoint');
  assert.ok(html.indexOf('id="freshness"') < html.indexOf('class="tabnav"'), 'in the header area, above the tab nav');
  assert.match(html, /<button type="button" class="fresh-btn" id="sync-btn" aria-label="Sync" title="Sync"><svg class="fresh-ico"/, 'icon-only Sync, labelled');
  assert.match(html, /<button type="button" class="fresh-sum" id="fresh-sum" aria-expanded="false" aria-controls="fresh-pop">/);
  assert.match(html, /<div class="fresh-pop" id="fresh-pop" hidden><p class="fresh-line" id="fresh-line"><\/p><\/div>/, 'per-source detail in a popover');
  assert.match(html, /var I18N_SYNC = \{"ariaLabel":"Data freshness"/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.match(scripts.at(-1), /\/api\/sync\/status/, 'freshness.js is the last script');
  assert.doesNotMatch(html, /\/export\/|\/ingest\//, 'the page never names a data endpoint');
});

// Tablas renders a list section only when it has rows: a plan whose list holds only the "none" option
// (or nothing) gets no empty accordion. Checked on both builds: the example has rows everywhere; the
// personal build (only when present, gitignored inputs) may have emptied lists.
const TABLAS_SECTIONS = [['desayunos', 'acc-desayunos'], ['carboComida', 'acc-carbo-comida'], ['carboCena', 'acc-carbo-cena'], ['anclaje', 'acc-anclaje'], ['postentreno', 'acc-postentreno'], ['fruta', 'acc-fruta'], ['postre', 'acc-postre'], ['verduras', 'acc-verduras'], ['quesos', 'acc-quesos']];
for (const [mode, dir, lang] of [['example', 'en-example', 'en'], ['personal', 'es-personal', 'es']]) {
  const file = path.join(WEB_ROOT, '.test-dist', dir, 'index.html');
  test(`${mode} build: Tablas renders a list section only when it has rows`, { skip: mode === 'personal' && !fs.existsSync(file) && 'no personal build' }, () => {
    assert.ok(fs.existsSync(file), `missing ${file} — run \`npm run pretest\` first`);
    const tablasHtml = sliceSection(fs.readFileSync(file, 'utf8'), 'tablas');
    const { ingredients, plan } = loadInputs({ repoRoot: REPO_ROOT, dataMode: mode });
    const ref = buildReference(buildNutrition(ingredients, plan), { lang, words: { raw: 'raw', dry: 'dry', cooked: 'cooked', serving: 'serving', unit: 'pc' } });
    for (const [key, id] of TABLAS_SECTIONS) {
      assert.equal(tablasHtml.includes(`<details id="${id}">`), ref[key].length > 0, `${id}: rendered iff it has rows (${ref[key].length})`);
      if (mode === 'example') assert.ok(ref[key].length > 0, `the example plan keeps ${key} populated`);
    }
    const protRows = ['lean', 'mod', 'fat'].some((t) => ref.proteina[t].length > 0);
    assert.equal(tablasHtml.includes('<details id="acc-proteina">'), protRows);
  });
}
