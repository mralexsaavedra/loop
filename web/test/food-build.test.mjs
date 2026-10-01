/* Build-output guard for the food log (Nutrición part 2): the example build carries the food UI fully
 * wired but HIDDEN (it only appears on the LAN page, when /api/food/products answers at view time), the
 * copy and constants are baked, and food.js runs after nutri-day.js and before intake.js (it defines
 * window.foodTotals, which both read). Reads the fixture built by `npm run pretest`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const htmlPath = path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html');
const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
const food = fs.readFileSync(path.join(WEB_ROOT, 'src', 'client', 'food.js'), 'utf8');
const nutriDay = fs.readFileSync(path.join(WEB_ROOT, 'src', 'client', 'nutri-day.js'), 'utf8');
const intake = fs.readFileSync(path.join(WEB_ROOT, 'src', 'client', 'intake.js'), 'utf8');

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

test('copy + constants are baked; food.js is inlined after nutri-day.js and before intake.js', () => {
  assert.match(html, /var I18N_FOOD = \{/);
  assert.match(html, /var FOOD_CONST = \{"meals":\["breakfast","lunch","preworkout","postworkout","dinner","snack"\],"stores":\["mercadona","dia","eroski","other"\],"units":\["g","ml"\],"limits":\{"nameMax":120,/, 'the shared limits are baked too');
  assert.match(html, /"groups":\["breakfast","lunch","dinner","addon"\],"mainSlots":\["breakfast","lunch","dinner"\],"addonGroup":"addon","addonSlot":"snack"\}/, 'Registrar\'s four groups come baked from lib/nutrition/slots.mjs');
  const at = (src) => html.indexOf(src.slice(0, 200));
  assert.ok(at(nutriDay) > 0 && at(food) > 0 && at(intake) > 0, 'all three scripts inlined verbatim');
  assert.ok(at(nutriDay) < at(food) && at(food) < at(intake));
});

test('the public basics are baked once as FOOD_BASICS, localized, compact (lib/nutrition/basics.mjs)', () => {
  const m = /var FOOD_BASICS = (\[.*?\]);/.exec(html);
  assert.ok(m, 'FOOD_BASICS baked');
  const list = JSON.parse(m[1]);
  assert.ok(list.length >= 100, `${list.length} basics`);
  assert.deepEqual(list.find((b) => b.k === 'huevo'), { k: 'huevo', n: 'Egg', u: 'ud', m: [72, 6.3, 0.4, 5], c: 'protein', pc: { a: 100, r: 50, o: 'egg', m: 'eggs' } });
  assert.equal(list.find((b) => b.k === 'arroz').x, 150, 'the portion cap rides along for the portion guide');
  assert.ok(m[1].length < 16 * 1024, `FOOD_BASICS is ${m[1].length} bytes`);
  assert.ok(html.indexOf('var FOOD_BASICS') < html.indexOf(food.slice(0, 200)), 'baked before food.js runs');
  assert.ok(html.indexOf('var FOOD_BASICS') < html.indexOf(nutriDay.slice(0, 200)), 'baked before nutri-day.js renders the portion guide');
});

test('food.js talks only to its own origin, with the X-HC-Food header, and never stores the log in the browser', () => {
  assert.match(food, /var API = '\/api\/food';/);
  assert.match(food, /'X-HC-Food': '1'/);
  assert.doesNotMatch(food, /https?:\/\//, 'no absolute URL (Open Food Facts is called by the server)');
  assert.doesNotMatch(food, /localStorage|sessionStorage|indexedDB/);
});
