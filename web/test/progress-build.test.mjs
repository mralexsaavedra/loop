/* Build-output guard for Progreso (weight vs the goal), Constancia (food log adherence) and the
 * server-side settings: the hosts sit after the day's blocks in the dia section, Constancia ships
 * hidden (LAN page only), the thresholds are baked from lib/, and the three scripts are inlined after
 * food-*.js (whose API client they reuse) and before intake.ts / profile.ts / detail.ts. Reads the fixture
 * built by `npm run pretest`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slimScript } from '../src/slim-script.mjs';
import { PROGRESS } from '../../lib/nutrition/progress.mjs';
import { ADHERENCE } from '../../lib/nutrition/adherence.mjs';
import { clientScriptSource } from '../src/client-bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const htmlPath = path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html');
const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
// the bytes the page inlines: a classic script as is, a module script (*.ts) bundled
const src = (/** @type {string} */ name) => clientScriptSource(name);
const NAMES = ['food-core.ts', 'food-sheet.ts', 'food-catalog.ts', 'food-log.ts', 'settings.ts', 'progress.ts', 'adherence.ts', 'intake.ts', 'profile.ts', 'detail-state.ts', 'detail-chart.ts', 'detail.ts'];
const at = (/** @type {string} */ name) => {
  const i = html.indexOf(slimScript(src(name)));
  assert.ok(i > 0, `${name} is not inlined whole (as slimScript emits it) in ${htmlPath}`);
  return i;
};

test('Progreso and Constancia follow the day\'s blocks in the dia section; Constancia ships hidden with its 7 / 14 / 28 switch', () => {
  assert.ok(html, `missing ${htmlPath}: run npm run pretest`);
  const fuel = html.indexOf('id="nutri-fuel-block"');
  const prog = html.indexOf('id="nutri-progress-block"');
  const adh = html.indexOf('id="food-adherence-block"');
  const products = html.indexOf('id="food-products"');
  assert.ok(fuel > 0 && fuel < prog && prog < adh && adh < products, 'after Avituallamiento, before Mis productos');
  assert.match(html, /<div class="nutri-block" id="nutri-progress-block"> <div class="hs-head"> <h2 class="hs-lbl">Progress<\/h2> <button type="button" class="hs-i" id="nutri-progress-i" data-hs-info="nutri-progress-info" aria-expanded="false" aria-controls="nutri-progress-info" aria-label="About Progress">/, 'Progreso is not hidden: it needs only baked data; the shared section header with its ⓘ');
  assert.match(html, /<div class="hs-info" id="nutri-progress-info" hidden><\/div> <div id="nutri-progress"><\/div> <\/div>/, 'the ⓘ block (filled by progress.ts) right before the card');
  assert.match(html, /<h2 class="hs-lbl">Consistency<\/h2>[\s\S]{0,200}<button type="button" class="hs-i" data-hs-info="adh-info" aria-expanded="false" aria-controls="adh-info" aria-label="About Consistency">/, 'Constancia\'s ⓘ controls the notes block adherence.ts leads its host with');
  assert.match(html, /<div class="nutri-block" id="food-adherence-block" hidden>/);
  const block = html.slice(adh, products);
  assert.equal((block.match(/<input type="radio" name="adh-win"/g) || []).length, 3);
  assert.match(block, /name="adh-win" value="7" checked/);
  assert.match(block, /<legend class="seg-lbl">Period<\/legend>/);
});

test('the thresholds come baked from lib/ (NUTRI.progress / NUTRI.adherence) and FOOD_CONST carries the goals', () => {
  const m = /var NUTRI = (\{.*?\});\n/.exec(html);
  assert.ok(m, 'NUTRI baked');
  const nutri = JSON.parse(m[1]);
  assert.deepEqual(nutri.progress, JSON.parse(JSON.stringify(PROGRESS)));
  assert.deepEqual(nutri.adherence, JSON.parse(JSON.stringify(ADHERENCE)));
  assert.match(html, /var FOOD_CONST = \{[^\n]*"goals":\["maintain","cut","bulk"\]/);
  assert.match(html, /"targetWeightMin":35,"targetWeightMax":250,"summaryDaysMax":120/);
});

test('script order: food (core, sheet, catalog, log) -> settings -> progress -> adherence -> intake -> profile -> detail', () => {
  const pos = NAMES.map(at);
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i - 1] < pos[i], `${NAMES[i - 1]} before ${NAMES[i]}`);
});

test('settings.ts and adherence.ts talk only through HCFood.api; none of the three stores anything in the browser', () => {
  for (const name of ['settings.ts', 'progress.ts', 'adherence.ts']) {
    const s = slimScript(src(name)); // code only: the header comments may name what is NOT used
    assert.doesNotMatch(s, /\bfetch\(|https?:\/\/|XMLHttpRequest/, `${name}: no own requests or absolute URLs`);
    assert.doesNotMatch(s, /localStorage|sessionStorage|indexedDB/, `${name}: nothing kept in the browser`);
    assert.doesNotMatch(s, /toLocale\w*String|Intl\.DateTimeFormat/, `${name}: dates through HC.fmtDate / fmtMonth`);
  }
  assert.match(src('settings.ts'), /api\((['"])PUT\1, (['"])\/settings\2, body\)/); // a module: esbuild prints ""
  assert.match(src('adherence.ts'), /call\(["']GET["'], ["']\/log\/summary\?from=["'] \+ dates\[0\] \+ ["']&to=["'] \+ dates\[dates\.length - 1\]\)/);
});
