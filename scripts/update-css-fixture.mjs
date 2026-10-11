#!/usr/bin/env node
/* Regenerates web/test/fixtures/css-expected.json — the declaration map the CSS parity test
 * (web/test/css-parity.test.mjs) compares the built page's CSS against — from the current example
 * build (web/.test-dist/en-example/index.html; run `npm run pretest` or `npm test` first).
 *
 * The fixture's hand-edit convention is kept so a regeneration diff shows only real changes:
 * existing keys stay in their current order (a changed value is updated in place), new keys are
 * appended at the end in build order, and keys no longer in the CSS are deleted.
 *
 *   npm run test:css:update            # rewrite the fixture
 *   npm run test:css:update -- --check # exit 1 if the fixture is out of date, write nothing
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssRules, ruleDeclarationMap, canonicalSelector } from '../web/test/css-scan.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const FIXTURE_PATH = path.join(ROOT, 'web', 'test', 'fixtures', 'css-expected.json');
export const BUILD_PATH = path.join(ROOT, 'web', '.test-dist', 'en-example', 'index.html');

export function extractStyleCss(html) {
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  if (blocks.length === 0) throw new Error('no <style> block found in the given HTML');
  return blocks.join('\n');
}

/** Declaration map (`${media}|||${selector}|||${prop}` → normalized value) of a built page. */
export function buildDeclarationMap(html) {
  return ruleDeclarationMap(parseCssRules(extractStyleCss(html)));
}

// Fixture keys predate the whitespace-minified CSS: canonicalize their selector part the same way.
export function canonicalKey(key) {
  const [media, selector, prop] = key.split('|||');
  return `${media}|||${canonicalSelector(selector)}|||${prop}`;
}

/**
 * Two-way comparison of the fixture (plain object) against the build's declaration map.
 * Returns one line per problem: MISSING (in the fixture, not in the CSS), MISMATCH (different
 * value) and EXTRA (in the CSS, not in the fixture). Keys in `allowlist` (canonical form) are skipped.
 */
export function compareCss(fixture, outputMap, allowlist = new Set()) {
  const problems = [];
  const seen = new Set();
  for (const [key, value] of Object.entries(fixture)) {
    const canon = canonicalKey(key);
    seen.add(canon);
    if (allowlist.has(canon)) continue;
    const outputValue = outputMap.get(canon);
    if (outputValue === undefined) problems.push(`MISSING  ${canon} = ${value}`);
    else if (outputValue !== value) problems.push(`MISMATCH ${canon}: expected="${value}" output="${outputValue}"`);
  }
  for (const [key, value] of outputMap) {
    if (!seen.has(key) && !allowlist.has(key)) problems.push(`EXTRA    ${key} = ${value}`);
  }
  return problems;
}

/**
 * The regenerated fixture: existing keys in their order (value from the build), stale keys dropped,
 * new keys appended in build order. Returns `{ fixture, added, removed, changed }`.
 */
export function updateFixture(fixture, outputMap) {
  const next = {};
  const seen = new Set();
  let removed = 0;
  let changed = 0;
  for (const [key, value] of Object.entries(fixture)) {
    const canon = canonicalKey(key);
    if (!outputMap.has(canon) || seen.has(canon)) {
      removed++;
      continue;
    }
    seen.add(canon);
    const outputValue = outputMap.get(canon);
    if (outputValue !== value) changed++;
    next[key] = outputValue;
  }
  let added = 0;
  for (const [key, value] of outputMap) {
    if (seen.has(key)) continue;
    next[key] = value;
    added++;
  }
  return { fixture: next, added, removed, changed };
}

export function serializeFixture(fixture) {
  return JSON.stringify(fixture, null, 2) + '\n';
}

function main(argv) {
  const check = argv.includes('--check');
  if (!fs.existsSync(BUILD_PATH)) {
    console.error(`update-css-fixture: missing ${path.relative(ROOT, BUILD_PATH)} — run \`npm run pretest\` first`);
    return 2;
  }
  const current = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const { fixture, added, removed, changed } = updateFixture(
    JSON.parse(current),
    buildDeclarationMap(fs.readFileSync(BUILD_PATH, 'utf8')),
  );
  const text = serializeFixture(fixture);
  const summary = `${added} added, ${removed} removed, ${changed} changed`;
  if (text === current) {
    console.log(`update-css-fixture: fixture up to date (${Object.keys(fixture).length} declarations)`);
    return 0;
  }
  if (check) {
    console.error(`update-css-fixture: fixture out of date (${summary}) — run \`npm run test:css:update\``);
    return 1;
  }
  fs.writeFileSync(FIXTURE_PATH, text);
  console.log(`update-css-fixture: wrote ${path.relative(ROOT, FIXTURE_PATH)} (${summary})`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
