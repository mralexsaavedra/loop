/* Legacy-vs-Astro parity for all 6 tabs (Mi día + Registro + Tablas + Hoy +
 * Entrenos + Salud — astro-plan-web slice 5 added Hoy/Entrenos, slice 6
 * adds Salud). Per spec's "Automated
 * parity check": compares id sets + onclick sets (structure/wiring) and
 * spot-checks normalized text for the ported tabs. Pixel diffs are not
 * required; the owner does a visual review at cutover (slice 6/7) — see
 * spec.
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
 * against without a real browser). The Tablas tab's `tb-postre` fruit-
 * summary row (client-painted from FRUIT_SUMMARY) gets the same
 * script-execution treatment — see KNOWN_DEVIATIONS below.
 *
 * KNOWN_DEVIATIONS (content, not structure — id/onclick/static-text parity
 * above still holds exactly):
 *  - tb-postre's fruit-summary row: legacy hand-typed a fixed literal
 *    ("~60–105 kcal · 1 P · 15–27 C · 0 G") that had drifted from the real
 *    fruit list (it no longer covered every fruit added since). Astro
 *    COMPUTES it from lib/nutrition/macros.mjs's fruitSummary (min/max
 *    kcal+carb over every fruit-cat postre item, rounded average protein/
 *    fat) — see macros.test.mjs. The numbers legitimately differ from the
 *    legacy literal; this is a bug fix, not a regression. Both sides are
 *    client-painted (empty <tbody id="tb-postre"> in the server-rendered
 *    HTML on both legacy and Astro), so it never affects the static
 *    id/onclick/text parity checks above — only the script-execution
 *    check below observes it.
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

const PORTED = ['dia', 'registro', 'tablas', 'hoy', 'dash', 'health'];

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

test('legacy vs Astro: Mi día + Registro + Tablas have identical id sets', { skip: !haveFixtures && 'golden/Astro personal fixtures not built — run `node scripts/capture-golden.mjs && npm run pretest`' }, () => {
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

test('legacy vs Astro: Mi día + Registro + Tablas have identical onclick sets', { skip: !haveFixtures && 'fixtures not built' }, () => {
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

test('legacy vs Astro: normalized meal-name / heading text matches for Mi día + Registro + Tablas', { skip: !haveFixtures && 'fixtures not built' }, () => {
  const legacy = fs.readFileSync(goldenPath, 'utf8');
  const astro = fs.readFileSync(astroPath, 'utf8');
  for (const tab of PORTED) {
    const legacyText = normalizedText(extractTabPanel(legacy, tab));
    const astroText = normalizedText(extractTabPanel(astro, tab));
    assert.equal(astroText, legacyText, `normalized static text mismatch in tab "${tab}" (dynamic client-computed values like #r-kcal/#r-verdict are covered separately, not by this snapshot compare)`);
  }
});

/* ---- client-computed Registro verdict: "the calcDay fallback" ---- */

/** A `Date` subclass whose no-arg constructor (and `.now()`) always
 * resolves to `iso` (a 'YYYY-MM-DD' string, midnight local) — every other
 * call form (`new Date(y, m, d)`, used by fmtLong()/fmtD() to PARSE an
 * already-known date) behaves exactly like the real `Date`. Lets
 * web/src/client/training-today.js's `iso(new Date())` "what day is it"
 * check run deterministically inside node:vm — see design's Testing
 * Strategy: "fixed Date". */
function makeFixedDate(iso) {
  const RealDate = Date;
  function FixedDate(...args) {
    return args.length ? new RealDate(...args) : new RealDate(iso + 'T00:00:00');
  }
  FixedDate.prototype = RealDate.prototype;
  FixedDate.now = () => new RealDate(iso + 'T00:00:00').getTime();
  return FixedDate;
}

function runBuiltScripts(html, seed, preSeed, fixedDateIso) {
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
  // Tablas' client-painted equivalence tables — only tb-postre (the
  // computed fruit-summary row) is asserted on below, but registering all
  // of them mirrors the real DOM shape paint()/el() run against.
  ['tb-prot-lean', 'tb-prot-mod', 'tb-prot-fat', 'tb-cc-train', 'tb-cc-rest', 'tb-cce-train', 'tb-cce-rest', 'tb-pe', 'tb-anclaje', 'tb-fruta', 'tb-postre', 'tb-verduras', 'tb-quesos'].forEach((id) => doc.el(id, { tag: 'tbody' }));
  // Hoy/Entrenos/Salud hosts (astro-plan-web slices 5-6) — same "register
  // the real DOM shape" rationale as the Tablas tbodies above.
  doc.el('train-today', { tag: 'div' });
  doc.el('train-dash', { tag: 'div' });
  doc.el('health', { tag: 'div' });
  if (preSeed) preSeed(doc);

  const window = { scrollTo() {}, navigator: {} };
  const ctx = { document: doc, window, setTimeout, console, Math, Number, String, Array, Object, JSON };
  if (fixedDateIso) ctx.Date = makeFixedDate(fixedDateIso);
  vm.createContext(ctx);
  scripts.forEach((s) => vm.runInContext(s, ctx));
  if (seed) seed(doc, window);
  return { doc, window };
}

/** Runs the GOLDEN legacy `<script>` blocks (the owner's real, hand-
 * translated Spanish page) through the same stub DOM/fixed-Date harness,
 * for a direct legacy-vs-Astro text diff on #train-today/#train-dash. */
function runGoldenScripts(fixedDateIso) {
  const html = fs.readFileSync(goldenPath, 'utf8');
  return runBuiltScripts(html, undefined, undefined, fixedDateIso);
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

/* ---- Tablas' client-painted fruit-summary row (tb-postre) — see
   KNOWN_DEVIATIONS above: content intentionally differs from the legacy
   literal, this only asserts it renders real, non-empty, locale-correct
   computed text. */

test('Astro (personal, es): #tb-postre renders a computed, non-empty fruit-summary row (differs from the legacy literal — see KNOWN_DEVIATIONS)', { skip: !fs.existsSync(astroPath) && 'personal fixture not built' }, () => {
  const html = fs.readFileSync(astroPath, 'utf8');
  const { doc } = runBuiltScripts(html);
  const tbPostre = doc.getElementById('tb-postre').innerHTML;
  assert.ok(tbPostre.length > 0, 'tb-postre must not be empty after the scripts run');
  assert.match(tbPostre, /Fruta \(1 pieza\)/, 'es build must render the Spanish fruit-portion label');
  assert.match(tbPostre, /jump\('acc-fruta'\)/, 'fruit-summary row keeps the jump() link to the Fruit accordion');
  assert.match(tbPostre, /<td class="kc">\d+–\d+<\/td>/, 'kcal column is a computed min–max range, not the legacy fixed literal');
});

test('Astro (example, en): #tb-postre renders a computed, non-empty fruit-summary row', () => {
  const examplePath = path.join(WEB_ROOT, 'dist', 'example', 'index.html');
  assert.ok(fs.existsSync(examplePath), `missing ${examplePath} — run npm run pretest first`);
  const html = fs.readFileSync(examplePath, 'utf8');
  const { doc } = runBuiltScripts(html);
  const tbPostre = doc.getElementById('tb-postre').innerHTML;
  assert.ok(tbPostre.length > 0);
  assert.match(tbPostre, /Fruit \(1 piece\)/, 'en build must render the English fruit-portion label');
  assert.match(tbPostre, /<td class="kc">\d+–\d+<\/td>/);
});

/* ---- Hoy (#train-today) / Entrenos (#train-dash) — astro-plan-web slice 5.
 * Both tabs are 100% client-rendered (empty <div id="train-today"/"train-dash">
 * server-side on both legacy and Astro), so the PORTED id/onclick/text
 * checks above only confirm the host wrapper markup. The real content is
 * verified here by running BOTH the golden legacy scripts and the built
 * Astro scripts through the same stub-DOM/fixed-Date harness for the SAME
 * training-data.json inputs, then diffing normalized text — a genuine
 * legacy-vs-Astro comparison, not just a "renders something" smoke check.
 *
 * KNOWN_DEVIATIONS (content, not structure):
 *  - #train-today's "before first programmed day" branch: the tracked
 *    generic template has three empty-state branches (before-first /
 *    after-last / rest-day); the owner's live personal page had DROPPED
 *    the before-first branch when it was hand-translated (see
 *    web/src/i18n/hoy-templates.mjs's header). This port restores all
 *    three from the template, so it is only checked against the EXAMPLE
 *    build below (no golden/personal counterpart exists for that branch).
 *  - #train-dash's note1Html: the owner's live page appends one
 *    plan-specific parenthetical ("tu plan lleva pista + tirada larga")
 *    that is intentionally NOT reproduced in the generic dict — see
 *    web/src/i18n/dash-templates.mjs's header. The exact-match test below
 *    therefore asserts on everything EXCEPT that one note, and separately
 *    confirms the golden text is a superset (personal customization on
 *    top of, not a replacement of, the generic copy).
 */

test('Astro (personal, es): #train-today for a date WITH a programmed session matches the golden legacy script byte-for-byte (normalized text)', { skip: !haveFixtures && 'golden/Astro personal fixtures not built' }, () => {
  const fixedDateIso = '2026-06-01'; // a real entry in the owner's training-data.json (kind:gym, focus:"Sentadilla + metcon")
  const golden = runGoldenScripts(fixedDateIso);
  const astro = runBuiltScripts(fs.readFileSync(astroPath, 'utf8'), undefined, undefined, fixedDateIso);
  const goldenText = normalizedText(golden.doc.getElementById('train-today').innerHTML);
  const astroText = normalizedText(astro.doc.getElementById('train-today').innerHTML);
  assert.equal(astroText, goldenText);
  assert.match(astroText, /Sentadilla \+ metcon/);
  assert.match(astroText, /BSQ EVERY 3' × 5 RONDAS/);
});

test('Astro (personal, es): #train-today for a date AFTER the program ends matches the golden legacy script byte-for-byte (normalized text)', { skip: !haveFixtures && 'golden/Astro personal fixtures not built' }, () => {
  const fixedDateIso = '2026-07-15'; // after TRAINING_META.last (2026-06-30)
  const golden = runGoldenScripts(fixedDateIso);
  const astro = runBuiltScripts(fs.readFileSync(astroPath, 'utf8'), undefined, undefined, fixedDateIso);
  const goldenText = normalizedText(golden.doc.getElementById('train-today').innerHTML);
  const astroText = normalizedText(astro.doc.getElementById('train-today').innerHTML);
  assert.equal(astroText, goldenText);
  assert.match(astroText, /El plan cargado llega hasta el/);
});

test('Astro (example, en): #train-today for a date BEFORE the program starts renders the restored "sample data" branch (KNOWN_DEVIATION — no golden/personal counterpart)', () => {
  const examplePath = path.join(WEB_ROOT, 'dist', 'example', 'index.html');
  assert.ok(fs.existsSync(examplePath), `missing ${examplePath} — run npm run pretest first`);
  const fixedDateIso = '2025-12-01'; // before the example seed's first day (2026-01-05)
  const { doc } = runBuiltScripts(fs.readFileSync(examplePath, 'utf8'), undefined, undefined, fixedDateIso);
  const text = normalizedText(doc.getElementById('train-today').innerHTML);
  assert.match(text, /This is sample data/);
  assert.doesNotMatch(text, /rest day/i, 'the before-first branch must not fall through to the generic rest-day message');
});

test('Astro (personal, es): #train-dash matches the golden legacy script (normalized text, excluding the owner\'s plan-specific note sentence — see KNOWN_DEVIATIONS)', { skip: !haveFixtures && 'golden/Astro personal fixtures not built' }, () => {
  const golden = runGoldenScripts();
  const astro = runBuiltScripts(fs.readFileSync(astroPath, 'utf8'));
  const personalOnlySentence = 'la carrera está infra-registrada (tu plan lleva pista + tirada larga)';
  // Tags whose closing `</b>` directly abuts a "." leave a stray space
  // after tag-stripping (` .` instead of `.`) — a cosmetic normalization
  // artifact present in BOTH the legacy template's and this dict's markup
  // (same `<b>...</b>.` adjacency style), not a real content difference.
  const tidy = (s) => s.replace(/ \./g, '.');
  const goldenText = tidy(normalizedText(golden.doc.getElementById('train-dash').innerHTML).toLowerCase());
  const astroText = tidy(normalizedText(astro.doc.getElementById('train-dash').innerHTML).toLowerCase());
  assert.match(goldenText, /tu plan lleva pista \+ tirada larga/, 'sanity-check the personal customization is really present in golden');
  assert.equal(astroText, tidy(goldenText.replace(personalOnlySentence, 'la carrera está infra-registrada')));
});

test('Astro (example, en): #train-dash renders the documented empty state (no Apple Health export in example mode)', () => {
  const examplePath = path.join(WEB_ROOT, 'dist', 'example', 'index.html');
  assert.ok(fs.existsSync(examplePath), `missing ${examplePath} — run npm run pretest first`);
  const { doc } = runBuiltScripts(fs.readFileSync(examplePath, 'utf8'));
  const text = doc.getElementById('train-dash').innerHTML;
  assert.match(text, /No workout data yet/);
  assert.match(text, /data\/apple-health\//);
});

/* ---- Salud (#health) — astro-plan-web slice 6. Fully client-rendered
 * (empty <div id="health"> server-side on both legacy and Astro), same
 * treatment as Hoy/Entrenos above. HEALTH is a fully precomputed snapshot
 * baked at build time (no `new Date()` "what day is it" branching), so no
 * fixed Date is needed here — both scripts run against the SAME real
 * `Date.now()` when executed together in one test, which keeps the one
 * genuinely wall-clock-dependent bit (energy section's `ago()` "last
 * logged X ago" caveat) deterministic between golden and Astro.
 *
 * KNOWN_DEVIATION (content, not structure): the running section's closing
 * note. The owner's live personal page ends with a Hyrox-specific goal
 * ("Para Hyrox, bajar el ritmo comprometido es la prioridad.") that is
 * intentionally NOT reproduced in the generic dict — personal
 * customization, not generic copy — see
 * web/src/i18n/health-templates.mjs's header. The exact-match test below
 * asserts on everything except that one clause.
 */

test('Astro (personal, es): #health matches the golden legacy script (normalized text, excluding the owner\'s Hyrox-specific running goal — see KNOWN_DEVIATIONS)', { skip: !haveFixtures && 'golden/Astro personal fixtures not built' }, () => {
  const golden = runGoldenScripts();
  const astro = runBuiltScripts(fs.readFileSync(astroPath, 'utf8'));
  const personalOnlySentence = 'para hyrox, bajar el ritmo comprometido es la prioridad.';
  const genericSentence = 'mejorar el ritmo al mismo esfuerzo es la señal a vigilar.';
  const goldenText = normalizedText(golden.doc.getElementById('health').innerHTML).toLowerCase();
  const astroText = normalizedText(astro.doc.getElementById('health').innerHTML).toLowerCase();
  assert.ok(goldenText.length > 0, 'golden #health must not be empty (the owner has real Apple Health data baked in)');
  assert.match(goldenText, /para hyrox, bajar el ritmo comprometido es la prioridad\./, 'sanity-check the personal customization is really present in golden');
  assert.equal(astroText, goldenText.replace(personalOnlySentence, genericSentence));
});

test('Astro (personal, es): #health renders es-locale comma-decimal numbers and es-ES short dates (nf())', { skip: !fs.existsSync(astroPath) && 'personal fixture not built' }, () => {
  const { doc } = runBuiltScripts(fs.readFileSync(astroPath, 'utf8'));
  const html = doc.getElementById('health').innerHTML;
  assert.ok(html.length > 0);
  // Spot-check a representative set of real-valued (non-integer) fields
  // that go through nf() — see health.js's file header for exactly which
  // call sites apply it. The load-vs-recovery split's hrvHigh/hrvLow cards
  // are a deliberate exception (kept period-decimal, matching the golden
  // legacy page's own output byte-for-byte — see the exact-match test
  // above) so this check is scoped, not a blanket "no periods" regex.
  assert.match(html, /75,6<small>kg<\/small>/, 'weight trend value must use a comma decimal');
  assert.match(html, /14,8<small>%<\/small>/, 'body fat trend value must use a comma decimal');
  assert.match(html, />9,7<small>km\/día/, 'distance trend value must use a comma decimal');
  assert.match(html, /54,3<small>ml\/kg\/min/, 'VO₂max trend value must use a comma decimal');
  assert.match(html, />31 mar</, 'es build must use es-ES short-date formatting (day-first, abbreviated month)');
});

test('Astro (example, en): #health renders the documented empty state (no Apple Health export in example mode)', () => {
  const examplePath = path.join(WEB_ROOT, 'dist', 'example', 'index.html');
  assert.ok(fs.existsSync(examplePath), `missing ${examplePath} — run npm run pretest first`);
  const { doc } = runBuiltScripts(fs.readFileSync(examplePath, 'utf8'));
  const text = doc.getElementById('health').innerHTML;
  assert.match(text, /No health data yet/);
  assert.match(text, /data\/apple-health\//);
});
