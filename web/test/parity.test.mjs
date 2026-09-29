/* Legacy-vs-Astro parity for the tabs built so far (Mi día + Registro —
 * astro-plan-web slice 3). Per spec's "Automated parity check": compares
 * id sets + onclick sets (structure/wiring) and spot-checks normalized
 * text for the ported tabs. Pixel diffs are not required; the owner does
 * a visual review at cutover (slice 6/7) — see spec.
 *
 * Uses the golden legacy snapshot captured by scripts/capture-golden.mjs
 * (slice 0) as the legacy reference and the personal-mode Astro fixture
 * built by web/test/build-fixtures.mjs (pretest) as the Astro reference.
 * Both are gitignored/personal — this test SKIPS gracefully when either
 * is absent (fresh clone / CI without the owner's data), same pattern as
 * web/test/golden-smoke.test.mjs and web/test/leak.test.mjs.
 *
 * For the client-computed Registro verdict text (design's "... or the
 * calcDay fallback"), this test runs the ACTUAL built <script> tags
 * (Bake + core + nutrition) through node:vm against
 * web/test/dom-stub.mjs and asserts #r-verdict renders real, non-empty,
 * locale-correct text after a plausible selection — instead of a full
 * legacy-vs-Astro DOM diff (legacy has no equivalent harness to diff
 * against without a real browser).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { StubDocument, StubElement } from './dom-stub.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const ROOT = path.dirname(WEB_ROOT);

const goldenPath = path.join(WEB_ROOT, 'test', '.golden', 'personal', 'plan-web.html');
const astroPath = path.join(WEB_ROOT, 'dist', 'personal', 'index.html');

const PORTED = ['dia', 'registro'];

function extractTabPanel(html, tabKey) {
  const startRe = new RegExp(`<div class="tab-panel" data-tab="${tabKey}"[^>]*>`);
  const m = html.match(startRe);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = html.slice(start);
  const endMatch = rest.match(/<div class="tab-panel" data-tab="|<footer|<script/);
  const end = endMatch ? endMatch.index : rest.length;
  return rest.slice(0, end);
}
function idsOf(html) {
  return [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]).sort();
}
function onclicksOf(html) {
  return [...html.matchAll(/\bonclick="([^"]+)"/g)].map((m) => m[1]).sort();
}
function normalizedText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const haveFixtures = fs.existsSync(goldenPath) && fs.existsSync(astroPath);

test('legacy vs Astro: Mi día + Registro have identical id sets', { skip: !haveFixtures && 'golden/Astro personal fixtures not built — run `node scripts/capture-golden.mjs && npm run pretest`' }, () => {
  const legacy = fs.readFileSync(goldenPath, 'utf8');
  const astro = fs.readFileSync(astroPath, 'utf8');
  for (const tab of PORTED) {
    const legacySection = extractTabPanel(legacy, tab);
    const astroSection = extractTabPanel(astro, tab);
    assert.ok(legacySection, `legacy fixture missing tab-panel[data-tab="${tab}"]`);
    assert.ok(astroSection, `Astro fixture missing tab-panel[data-tab="${tab}"]`);
    assert.deepEqual(idsOf(astroSection), idsOf(legacySection), `id set mismatch in tab "${tab}"`);
  }
});

test('legacy vs Astro: Mi día + Registro have identical onclick sets', { skip: !haveFixtures && 'fixtures not built' }, () => {
  const legacy = fs.readFileSync(goldenPath, 'utf8');
  const astro = fs.readFileSync(astroPath, 'utf8');
  for (const tab of PORTED) {
    const legacySection = extractTabPanel(legacy, tab);
    const astroSection = extractTabPanel(astro, tab);
    assert.deepEqual(onclicksOf(astroSection), onclicksOf(legacySection), `onclick set mismatch in tab "${tab}"`);
  }
});

test('legacy vs Astro: Mi día day-summary kcal figures match exactly (train/rest)', { skip: !haveFixtures && 'fixtures not built' }, () => {
  const legacy = fs.readFileSync(goldenPath, 'utf8');
  const astro = fs.readFileSync(astroPath, 'utf8');
  const kcalOf = (html) => [...extractTabPanel(html, 'dia').matchAll(/class="kcal">~([\d.]+)/g)].map((m) => m[1]);
  assert.deepEqual(kcalOf(astro), kcalOf(legacy));
});

test('legacy vs Astro: normalized meal-name / heading text matches for Mi día + Registro', { skip: !haveFixtures && 'fixtures not built' }, () => {
  const legacy = fs.readFileSync(goldenPath, 'utf8');
  const astro = fs.readFileSync(astroPath, 'utf8');
  for (const tab of PORTED) {
    const legacyText = normalizedText(extractTabPanel(legacy, tab));
    const astroText = normalizedText(extractTabPanel(astro, tab));
    assert.equal(astroText, legacyText, `normalized static text mismatch in tab "${tab}" (dynamic client-computed values like #r-kcal/#r-verdict are covered separately, not by this snapshot compare)`);
  }
});

/* ---- client-computed Registro verdict: "the calcDay fallback" ---- */

function runBuiltScripts(html, seed) {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const doc = new StubDocument();
  const selectIds = ['bld-desayuno', 'bld-prot-comida', 'bld-carbo-comida', 'bld-postre-comida', 'bld-postentreno', 'bld-prot-cena', 'bld-carbo-cena', 'bld-postre-cena'];
  for (const id of selectIds) {
    const el = doc.el(id, { tag: 'select' });
    el.options = [];
    el.selectedIndex = 0;
    el.appendChild = function (opt) { this.options.push(opt); };
    Object.defineProperty(el, 'innerHTML', { set(v) { if (v === '') this.options = []; }, get() { return ''; } });
  }
  doc.el('bld-pe-label', {});
  doc.el('bld-notes', { tag: 'textarea' });
  doc.el('r-kcal', {});
  doc.el('r-macros', {});
  doc.el('r-verdict', {});
  doc.el('bld-msg', {});
  doc.el('bld-output', { tag: 'textarea' });
  doc.el('bld-copy', { tag: 'button' });
  doc.el('b-train', { attrs: { 'aria-pressed': 'true' } });
  doc.el('b-rest', { attrs: { 'aria-pressed': 'false' } });
  doc.createElement = function (tag) { return new StubElement(tag); };

  const window = { scrollTo() {}, navigator: {} };
  const ctx = { document: doc, window, setTimeout, console, Math, Number, String, Array, Object, JSON };
  vm.createContext(ctx);
  scripts.forEach((s) => vm.runInContext(s, ctx));
  if (seed) seed(doc, window);
  return { doc, window };
}

test('Astro (personal, es): #r-verdict renders non-empty, locale-correct computed text via the built Bake+core+nutrition scripts', { skip: !fs.existsSync(astroPath) && 'personal fixture not built' }, () => {
  const html = fs.readFileSync(astroPath, 'utf8');
  const { doc } = runBuiltScripts(html);
  const verdict = doc.getElementById('r-verdict').innerHTML;
  const kcal = doc.getElementById('r-kcal').innerHTML;
  assert.ok(verdict.length > 0, 'r-verdict must not be empty after the scripts run');
  assert.match(verdict, /Proteína/, 'es build must render Spanish verdict text, not English');
  assert.match(kcal, /objetivo/, 'es build kcal suffix must say "objetivo", not "target"');
});

test('Astro (example, en): #r-verdict renders non-empty, locale-correct computed text', () => {
  const examplePath = path.join(WEB_ROOT, 'dist', 'example', 'index.html');
  assert.ok(fs.existsSync(examplePath), `missing ${examplePath} — run npm run pretest first`);
  const html = fs.readFileSync(examplePath, 'utf8');
  const { doc } = runBuiltScripts(html);
  const verdict = doc.getElementById('r-verdict').innerHTML;
  const kcal = doc.getElementById('r-kcal').innerHTML;
  assert.ok(verdict.length > 0);
  assert.match(verdict, /Protein/, 'en build must render English verdict text, not Spanish');
  assert.match(kcal, /target/);
});
