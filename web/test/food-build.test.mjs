/* Build-output guard for the food log (docs/nutrition-food-log.md): the example build carries the food UI fully
 * wired but HIDDEN (it only appears on the LAN page, when /api/food/products answers at view time), the
 * copy and constants are baked, and the food scripts (food-core / -sheet / -catalog / -log.js) run after nutri-day.js and before intake.js (it defines
 * window.foodTotals, which both read). Reads the fixture built by `npm run pretest`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slimScript } from '../src/slim-script.mjs';
import { FOOD_SCRIPTS, FOOD_SOURCES, FOOD_SOURCE } from './client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const htmlPath = path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html');
const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
const food = FOOD_SOURCE; // the four food scripts (food-core / -sheet / -catalog / -log.js), joined
const nutriDay = fs.readFileSync(path.join(WEB_ROOT, 'src', 'client', 'nutri-day.js'), 'utf8');
const intake = fs.readFileSync(path.join(WEB_ROOT, 'src', 'client', 'intake.js'), 'utf8');
// where a client script sits in the built page: the WHOLE script as the build inlines it (slimScript);
// a script that is not there fails naming it, never as a bare -1 in a comparison
const SCRIPT_NAME = new Map([...FOOD_SOURCES.map((s, i) => [s, FOOD_SCRIPTS[i]]), [nutriDay, 'nutri-day.js'], [intake, 'intake.js']]);
const inlinedAt = (src) => {
  const at = html.indexOf(slimScript(src));
  assert.ok(at > 0, `${SCRIPT_NAME.get(src) || 'client script'} is not inlined whole (as slimScript emits it) in ${htmlPath}`);
  return at;
};

test('the food hosts ship hidden: Registrar in the dia section, Mis productos / Mis recetas as folds before Tablas', () => {
  assert.ok(html, `missing ${htmlPath}: run npm run pretest`);
  assert.match(html, /<div class="nutri-block food-block" id="food-log-block" hidden>/);
  assert.match(html, /<details class="tab-section sec-fold food-fold" id="food-products" hidden>/);
  assert.match(html, /<details class="tab-section sec-fold food-fold" id="food-recipes" hidden>/);
  const dia = html.indexOf('id="sec-dia"');
  const plan = html.indexOf('id="nutri-plan"');
  const log = html.indexOf('id="food-log-block"');
  const fuel = html.indexOf('id="nutri-fuel-block"');
  const summary = html.indexOf('id="nutri-summary"');
  assert.ok(dia < summary && summary < log && log < plan && plan < fuel, 'Registrar sits right after Resumen de hoy, then Plan de hoy, then Avituallamiento');
  // Plan de hoy is a native <details>, collapsed by default (no `open`), its summary = heading + the plan's kcal
  assert.match(html, /<details class="nutri-block sec-fold nutri-fold" id="nutri-plan-fold"><summary><h2>Today(&#39;|')s plan<\/h2><span class="nutri-fold-kcal" id="nutri-plan-kcal"><\/span><span class="chev">›<\/span><\/summary>\s*<div id="nutri-plan"><\/div>\s*<\/details>/);
  assert.doesNotMatch(html, /<details class="nutri-block sec-fold nutri-fold" id="nutri-plan-fold"[^>]* open/, 'collapsed by default');
  assert.doesNotMatch(html, /<details[^>]*id="nutri-fuel-block"/, 'Avituallamiento is never collapsed');
  const products = html.indexOf('id="food-products"');
  const tablas = html.indexOf('id="sec-tablas"');
  assert.ok(fuel < products && products < tablas, 'the folds sit between the dia section and Tablas');
  assert.match(html, /role="status" aria-live="polite"/);
  // the section's own status line (saved / archived) sits ABOVE its body, never below the list
  // (form errors and "save anyway" go to the form's own line, next to its save button)
  for (const [msg, body] of [['fp-msg', 'fp-body'], ['fr-msg', 'fr-body']]) {
    const m = html.indexOf(`id="${msg}"`);
    assert.ok(m > 0 && m < html.indexOf(`id="${body}"`), `${msg} before ${body}`);
  }
});

test('Registrar\'s day navigator ships as static markup on the heading line: real buttons with labels, next disabled, back to today hidden, a live date label left empty (nothing time-based baked)', () => {
  const block = html.slice(html.indexOf('id="food-log-block"'), html.indexOf('id="food-log"'));
  assert.match(block, /<button type="button" class="nav-btn" id="food-day-prev" data-food-act="day-prev" aria-label="Previous day">/);
  assert.match(block, /<button type="button" class="nav-btn" id="food-day-next" data-food-act="day-next" aria-label="Next day" disabled>/);
  assert.match(block, /<span class="food-day-label" id="food-day-label" aria-live="polite"><\/span>/);
  assert.match(block, /<button type="button" class="food-btn food-btn-ghost food-day-today" id="food-day-today" data-food-act="day-today" aria-label="Back to today" hidden>Today<\/button>/, 'a short visible label, the full action as its name');
  assert.match(block, /<div class="food-head"> <h2 class="hs-lbl">Log food<\/h2> <div class="food-day" role="group" aria-label="Log day">/, 'the title (the shared section label) and the navigator share one row');
});

test('copy + constants are baked; the food scripts are inlined after nutri-day.js and before intake.js', () => {
  assert.match(html, /var I18N_FOOD = \{/);
  assert.match(html, /var FOOD_CONST = \{"meals":\["breakfast","lunch","preworkout","postworkout","dinner","snack"\],"stores":\["mercadona","dia","eroski","other"\],"units":\["g","ml"\],"limits":\{"nameMax":120,/, 'the shared limits are baked too');
  assert.match(html, /"groups":\["breakfast","lunch","dinner","addon"\],"mainSlots":\["breakfast","lunch","dinner"\],"addonGroup":"addon","addonSlot":"snack","lateNightHour":4\}/, 'Registrar\'s four groups and the late-night cutoff come baked from lib/nutrition/slots.mjs');
  const at = inlinedAt;
  const foodAt = FOOD_SOURCES.map(at); // the four food scripts, each inlined whole, in page order
  for (let i = 1; i < foodAt.length; i++) assert.ok(foodAt[i - 1] < foodAt[i], `${FOOD_SCRIPTS[i - 1]} before ${FOOD_SCRIPTS[i]}`);
  assert.ok(at(nutriDay) > 0 && at(intake) > 0, 'nutri-day.js and intake.js inlined whole (as slimScript emits them)');
  assert.ok(at(nutriDay) < foodAt[0] && foodAt[foodAt.length - 1] < at(intake));
});

test('the public basics are baked once as FOOD_BASICS, localized, compact (lib/nutrition/basics.mjs)', () => {
  const m = /var FOOD_BASICS = (\[.*?\]);/.exec(html);
  assert.ok(m, 'FOOD_BASICS baked');
  const list = JSON.parse(m[1]);
  assert.ok(list.length >= 100, `${list.length} basics`);
  assert.deepEqual(list.find((b) => b.k === 'huevo'), { k: 'huevo', n: 'Egg', u: 'ud', m: [72, 6.3, 0.4, 5], c: 'protein', pc: { a: 100, r: 50, o: 'egg', m: 'eggs' } });
  assert.equal(list.find((b) => b.k === 'arroz').x, 150, 'the portion cap rides along for the portion guide');
  // 24 KB: ~188 basics (the 2026-10-02 Spanish basics took it to ~20 KB, ~105 B per food); still a small
  // share of the single-file page, and the budget keeps an eye on per-food growth (new baked fields).
  assert.ok(m[1].length < 24 * 1024, `FOOD_BASICS is ${m[1].length} bytes`);
  assert.ok(html.indexOf('var FOOD_BASICS') < inlinedAt(FOOD_SOURCES[0]), 'baked before the food scripts run');
  assert.ok(html.indexOf('var FOOD_BASICS') < inlinedAt(nutriDay), 'baked before nutri-day.js renders the portion guide');
});

test('the food scripts talk only to its own origin, with the X-HC-Food header, and never stores the log in the browser', () => {
  assert.match(food, /var API = '\/api\/food';/);
  assert.match(food, /HC\.jsonApi\(API, 'X-HC-Food', TIMEOUT_MS\)/, 'every call through the shared wrapper (util.js) with its own header');
  assert.doesNotMatch(food, /https?:\/\//, 'no absolute URL (Open Food Facts is called by the server)');
  assert.doesNotMatch(food, /localStorage|sessionStorage|indexedDB/);
});
