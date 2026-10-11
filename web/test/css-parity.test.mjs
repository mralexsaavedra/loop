/* CSS regression guard — originally a corrective apply pass (CSS-porting
 * gap found in slices 1-4: web/src/styles/ only ever grew tokens.css, so
 * Dia/Registro/Tablas rendered unstyled), diffed against the legacy
 * `data/nutrition/plan-web.template.html` at the time.
 *
 * astro-plan-web slice 7 (cutover) retires the legacy template entirely, so
 * this test now compares against a CHECKED-IN snapshot fixture
 * (`web/test/fixtures/css-expected.json`) instead: a declaration map
 * captured from a verified-good Astro example build (the same build that was
 * visually approved before cutover), kept in sync since.
 *
 * The check is two-way: an edit to web/src/styles/*.css that drops or changes
 * a declaration fails it, and so does a declaration added to the CSS but not
 * to the fixture. A DELIBERATE CSS change must update the fixture too:
 * `npm run test:css:update` (scripts/update-css-fixture.mjs) regenerates it
 * from the current build, keeping existing keys in order, appending new keys
 * at the end and deleting stale ones.
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
import { buildDeclarationMap, compareCss } from '../../scripts/update-css-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);

const expectedFixturePath = path.join(here, 'fixtures', 'css-expected.json');
const outputHtmlPath = path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html');

// Selectors/declarations that are known, deliberate deviations from the
// checked-in expectation — none currently. Format: `${media}|||${selector}|||${prop}`
// (see css-scan.mjs's ruleDeclarationMap for the exact key shape).
const ALLOWLIST = new Set([]);

test('the checked-in CSS fixture and the Astro build output hold exactly the same declarations', () => {
  assert.ok(fs.existsSync(expectedFixturePath), `missing checked-in fixture at ${expectedFixturePath}`);
  assert.ok(
    fs.existsSync(outputHtmlPath),
    `missing build output at ${outputHtmlPath} — run \`npm run pretest\` (or \`npm run build:example\`) first`,
  );

  const fixture = JSON.parse(fs.readFileSync(expectedFixturePath, 'utf8'));
  const outputMap = buildDeclarationMap(fs.readFileSync(outputHtmlPath, 'utf8'));

  assert.ok(
    Object.keys(fixture).length > 50,
    `expected the checked-in fixture to hold a substantial number of declarations, found ${Object.keys(fixture).length} — is the fixture corrupt?`,
  );

  const problems = compareCss(fixture, outputMap, ALLOWLIST);
  assert.deepEqual(
    problems,
    [],
    `${problems.length} CSS declaration(s) differ between web/src/styles/*.css and the fixture (intentional? run \`npm run test:css:update\`):\n${problems.join('\n')}`,
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
