/* CSS parity guard — corrective apply pass (CSS-porting gap found in
 * slices 1-4: web/src/styles/ only ever grew tokens.css, so Dia/Registro/
 * Tablas rendered unstyled).
 *
 * GIVEN the tracked, generic `<style>` block in
 * data/nutrition/plan-web.template.html (verified byte-identical to the
 * owner's live, gitignored data/nutrition/plan-web.html at the time this
 * test was written — CSS carries no personal content, only the template
 * is used here so the test runs without the owner's personal data)
 * WHEN the Astro example build inlines web/src/styles/*.css (imported by
 * web/layouts/Plan.astro) into its output
 * THEN every legacy selector+declaration (under the same @media context)
 * must be present in the built output's inlined CSS, modulo cosmetic
 * formatting differences (whitespace, comma spacing, leading zeros,
 * case) — see web/test/css-scan.mjs's normalizeValue. Intentional
 * deviations, if any, are documented in ALLOWLIST below.
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
import { parseCssRules, ruleDeclarationMap } from './css-scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const REPO_ROOT = path.dirname(WEB_ROOT);

const legacyHtmlPath = path.join(REPO_ROOT, 'data', 'nutrition', 'plan-web.template.html');
const outputHtmlPath = path.join(WEB_ROOT, 'dist', 'example', 'index.html');

// Selectors/declarations that are known, deliberate deviations from the
// legacy CSS — none currently. Format: `${media}|||${selector}|||${prop}`
// (see css-scan.mjs's ruleDeclarationMap for the exact key shape).
const ALLOWLIST = new Set([]);

function extractStyleCss(html) {
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  if (blocks.length === 0) {
    throw new Error('no <style> block found in the given HTML');
  }
  return blocks.join('\n');
}

test('every legacy plan-web CSS rule is present in the Astro build output', () => {
  assert.ok(fs.existsSync(legacyHtmlPath), `missing legacy source at ${legacyHtmlPath}`);
  assert.ok(
    fs.existsSync(outputHtmlPath),
    `missing build output at ${outputHtmlPath} — run \`npm run pretest\` (or \`npm run build:example\`) first`,
  );

  const legacyHtml = fs.readFileSync(legacyHtmlPath, 'utf8');
  const outputHtml = fs.readFileSync(outputHtmlPath, 'utf8');

  const legacyCss = extractStyleCss(legacyHtml);
  const outputCss = extractStyleCss(outputHtml);

  const legacyMap = ruleDeclarationMap(parseCssRules(legacyCss));
  const outputMap = ruleDeclarationMap(parseCssRules(outputCss));

  assert.ok(
    legacyMap.size > 50,
    `expected the legacy <style> block to parse into a substantial number of declarations, found ${legacyMap.size} — is the CSS parser broken?`,
  );

  const missing = [];
  for (const [key, value] of legacyMap) {
    if (ALLOWLIST.has(key)) continue;
    const outputValue = outputMap.get(key);
    if (outputValue === undefined) {
      missing.push(`MISSING  ${key} = ${value}`);
    } else if (outputValue !== value) {
      missing.push(`MISMATCH ${key}: legacy="${value}" output="${outputValue}"`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `${missing.length} legacy CSS declaration(s) not faithfully ported into web/src/styles/*.css:\n${missing.join('\n')}`,
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
