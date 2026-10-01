/* web/src/client/tablas.js — paints the Tablas equivalence tables (tb-* bodies) from the shared
 * DATA / EXTRAS / VEG_KEYS / QUESO_KEYS / FRUIT_SUMMARY / I18N_TABLAS bakes. It used to live inside the
 * day builder (client/nutrition.js); the builder is gone, the tables stay. Runs the real classic script
 * in node:vm against web/test/dom-stub.mjs with the tracked example plan. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { buildNutrition } from '../../../lib/nutrition/macros.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..');
const source = fs.readFileSync(path.join(here, 'tablas.js'), 'utf8');
const ING = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/ingredients.json'), 'utf8')).ingredients;
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/plan-data.example.json'), 'utf8'));
const TB = ['tb-prot-lean', 'tb-prot-mod', 'tb-prot-fat', 'tb-cc-train', 'tb-cc-rest', 'tb-cce-train', 'tb-cce-rest', 'tb-pe', 'tb-anclaje', 'tb-fruta', 'tb-postre', 'tb-verduras', 'tb-quesos'];

function run({ ids = TB, fruit } = {}) {
  const nut = buildNutrition(ING, PLAN);
  const doc = new StubDocument();
  for (const id of ids) doc.el(id);
  const ctx = {
    document: doc, window: {},
    DATA: nut.D, EXTRAS: nut.EX, QUESO_KEYS: nut.QUESO, VEG_KEYS: nut.VEG,
    FRUIT_SUMMARY: fruit === undefined ? nut.fruitSummary : fruit,
    I18N_TABLAS: { fruitPortionLabel: 'Fruit portion', fruitPortionQty: '1 piece' },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { doc, nut };
}

test('paints every equivalence table body from the baked plan data', () => {
  const { doc, nut } = run();
  for (const id of TB) assert.match(doc.getElementById(id).innerHTML, /^<tr>/, `${id} painted`);
  const lean = nut.D.proteina.filter((o) => o.t === 'lean');
  assert.equal((doc.getElementById('tb-prot-lean').innerHTML.match(/<tr>/g) || []).length, lean.length);
  assert.ok(doc.getElementById('tb-prot-lean').innerHTML.includes(`<td class="kc">${lean[0].k}</td>`));
  // "none" placeholders are never listed as a food
  const none = nut.D.carboComida.train.filter((o) => o.none).length;
  assert.equal((doc.getElementById('tb-cc-train').innerHTML.match(/<tr>/g) || []).length, nut.D.carboComida.train.length - none);
});

test('the dessert table opens with the fruit-range summary row (a link to the fruit table), none without fruit', () => {
  const { doc, nut } = run();
  const fs0 = nut.fruitSummary;
  assert.ok(fs0, 'the example plan has fruit');
  const html = doc.getElementById('tb-postre').innerHTML;
  assert.ok(html.startsWith('<tr><td><button class="lnk" onclick="jump(\'acc-fruta\')">Fruit portion</button></td><td>1 piece</td>'));
  assert.ok(html.includes(`<td class="kc">${fs0.kMin}–${fs0.kMax}</td>`));
  assert.doesNotMatch(run({ fruit: null }).doc.getElementById('tb-postre').innerHTML, /Fruit portion/);
});

test('absent table hosts are skipped, never a throw; no day-builder globals are needed or defined', () => {
  const { doc } = run({ ids: [] });
  assert.equal(doc.getElementById('tb-pe'), null);
  assert.doesNotMatch(source, /EXTRA_KEYS|TARGET|I18N_VERDICT|bldRefresh|window\.bump/);
});
