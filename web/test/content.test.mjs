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

function loadExampleNut() {
  const { ingredients, plan } = loadInputs({ repoRoot: REPO_ROOT, dataMode: 'example' });
  const nut = buildNutrition(ingredients, plan);
  return { plan, nut };
}

test('example build renders lib-computed day kcal/protein totals in the Mi día tab', () => {
  assert.ok(fs.existsSync(examplePath), `missing ${examplePath} — run \`npm run pretest\` first`);
  const html = fs.readFileSync(examplePath, 'utf8');
  const { nut } = loadExampleNut();
  const diaHtml = sliceTabPanel(html, 'dia');

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
  const tablasHtml = sliceTabPanel(html, 'tablas');

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
  const registroHtml = sliceTabPanel(html, 'registro');

  assert.ok(plan.extrasDisplay?.length > 0, 'example plan must declare at least one extrasDisplay group to make this test meaningful');
  for (const group of plan.extrasDisplay) {
    for (const item of group.items) {
      assert.ok(registroHtml.includes(item.name), `expected extras item name "${item.name}" (key "${item.key}") in the Registro tab`);
      assert.ok(registroHtml.includes(`id="x-${item.key}"`), `expected the stepper counter #x-${item.key} in the Registro tab`);
    }
  }
});
