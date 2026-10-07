/* CSS regression guard — originally a corrective apply pass (CSS-porting
 * gap found in slices 1-4: web/src/styles/ only ever grew tokens.css, so
 * Dia/Registro/Tablas rendered unstyled), diffed against the legacy
 * `data/nutrition/plan-web.template.html` at the time.
 *
 * astro-plan-web slice 7 (cutover) retires the legacy template entirely, so
 * this test now compares against a CHECKED-IN snapshot fixture
 * (`web/test/fixtures/css-expected.json`) instead: a declaration map
 * captured from a verified-good Astro example build (the same build the
 * owner visually approved before cutover). Any future edit to
 * web/src/styles/*.css that silently drops or changes a declaration will
 * fail this test; a DELIBERATE CSS change must update the fixture too
 * (regenerate with the snippet in this file's header comment below).
 *
 * To regenerate the fixture after an intentional CSS change:
 *   node --input-type=module -e "
 *     import fs from 'node:fs';
 *     import { parseCssRules, ruleDeclarationMap } from './web/test/css-scan.mjs';
 *     const html = fs.readFileSync('web/.test-dist/en-example/index.html', 'utf8');
 *     const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
 *     const map = ruleDeclarationMap(parseCssRules(css));
 *     const obj = Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
 *     fs.writeFileSync('web/test/fixtures/css-expected.json', JSON.stringify(obj, null, 2) + '\n');
 *   "
 *
 * Run `npm run pretest` (or `npm test`, which runs pretest automatically)
 * before this file — it reads an already-built fixture, it does not build
 * one itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssRules, ruleDeclarationMap, canonicalSelector } from './css-scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);

const expectedFixturePath = path.join(here, 'fixtures', 'css-expected.json');
const outputHtmlPath = path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html');

// Selectors/declarations that are known, deliberate deviations from the
// checked-in expectation — none currently. Format: `${media}|||${selector}|||${prop}`
// (see css-scan.mjs's ruleDeclarationMap for the exact key shape).
const ALLOWLIST = new Set([]);

function extractStyleCss(html) {
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  if (blocks.length === 0) {
    throw new Error('no <style> block found in the given HTML');
  }
  return blocks.join('\n');
}

test('every checked-in expected CSS declaration is present in the Astro build output', () => {
  assert.ok(fs.existsSync(expectedFixturePath), `missing checked-in fixture at ${expectedFixturePath}`);
  assert.ok(
    fs.existsSync(outputHtmlPath),
    `missing build output at ${outputHtmlPath} — run \`npm run pretest\` (or \`npm run build:example\`) first`,
  );

  // Fixture keys predate the whitespace-minified CSS: canonicalize their selector part the same way.
  const expectedMap = new Map(
    Object.entries(JSON.parse(fs.readFileSync(expectedFixturePath, 'utf8'))).map(([key, value]) => {
      const [media, selector, prop] = key.split('|||');
      return [`${media}|||${canonicalSelector(selector)}|||${prop}`, value];
    }),
  );
  const outputHtml = fs.readFileSync(outputHtmlPath, 'utf8');
  const outputCss = extractStyleCss(outputHtml);
  const outputMap = ruleDeclarationMap(parseCssRules(outputCss));

  assert.ok(
    expectedMap.size > 50,
    `expected the checked-in fixture to hold a substantial number of declarations, found ${expectedMap.size} — is the fixture corrupt?`,
  );

  const missing = [];
  for (const [key, value] of expectedMap) {
    if (ALLOWLIST.has(key)) continue;
    const outputValue = outputMap.get(key);
    if (outputValue === undefined) {
      missing.push(`MISSING  ${key} = ${value}`);
    } else if (outputValue !== value) {
      missing.push(`MISMATCH ${key}: expected="${value}" output="${outputValue}"`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `${missing.length} expected CSS declaration(s) missing/changed in web/src/styles/*.css (unintentional? see this file's header to regenerate the fixture if intentional):\n${missing.join('\n')}`,
  );
});

test('the Astro build output still has no scoped-style artifacts (data-astro-cid)', () => {
  const outputHtml = fs.readFileSync(outputHtmlPath, 'utf8');
  assert.doesNotMatch(
    outputHtml,
    /data-astro-cid/,
    'scoped <style> is banned by design — all CSS must be global stylesheets imported by the layout',
  );
});

test('the Astro build output inlines CSS (no external stylesheet links)', () => {
  const outputHtml = fs.readFileSync(outputHtmlPath, 'utf8');
  assert.doesNotMatch(outputHtml, /<link[^>]+rel="stylesheet"/, 'expected zero external stylesheet <link> tags — CSS must be inlined');
});
