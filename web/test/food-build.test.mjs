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
  assert.ok(dia < plan && plan < log && log < fuel, 'Registrar sits right after Plan de hoy');
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
  const at = (src) => html.indexOf(src.slice(0, 200));
  assert.ok(at(nutriDay) > 0 && at(food) > 0 && at(intake) > 0, 'all three scripts inlined verbatim');
  assert.ok(at(nutriDay) < at(food) && at(food) < at(intake));
});

test('food.js talks only to its own origin, with the X-HC-Food header, and never stores the log in the browser', () => {
  assert.match(food, /var API = '\/api\/food';/);
  assert.match(food, /'X-HC-Food': '1'/);
  assert.doesNotMatch(food, /https?:\/\//, 'no absolute URL (Open Food Facts is called by the server)');
  assert.doesNotMatch(food, /localStorage|sessionStorage|indexedDB/);
});
