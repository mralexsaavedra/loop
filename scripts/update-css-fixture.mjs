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
 *   (--help prints the usage; an unknown flag or a stray argument exits 2 before anything is read or written)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssRules, ruleDeclarationMap, canonicalSelector } from '../web/test/css-scan.mjs';
import { isMain } from './lib/is-main.mjs';
import { parseCli } from './lib/sync-common.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE_PATH = path.join(ROOT, 'web', 'test', 'fixtures', 'css-expected.json');
const BUILD_PATH = path.join(ROOT, 'web', '.test-dist', 'en-example', 'index.html');

/** @param {string} html */
function extractStyleCss(html) {
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  if (blocks.length === 0) throw new Error('no <style> block found in the given HTML');
  return blocks.join('\n');
}

/** Declaration map (`${media}|||${selector}|||${prop}` → normalized value) of a built page.
 * @param {string} html */
export function buildDeclarationMap(html) {
  return ruleDeclarationMap(parseCssRules(extractStyleCss(html)));
}

// Fixture keys predate the whitespace-minified CSS: canonicalize their selector part the same way.
/** @param {string} key */
function canonicalKey(key) {
  const [media, selector, prop] = key.split('|||');
  return `${media}|||${canonicalSelector(selector)}|||${prop}`;
}

/**
 * Two-way comparison of the fixture (plain object) against the build's declaration map.
 * Returns one line per problem: MISSING (in the fixture, not in the CSS), MISMATCH (different
 * value) and EXTRA (in the CSS, not in the fixture). Keys in `allowlist` (canonical form) are skipped.
 * @param {Record<string, string>} fixture
 * @param {Map<string, string>} outputMap
 * @param {Set<string>} [allowlist]
 * @returns {string[]}
 */
export function compareCss(fixture, outputMap, allowlist = new Set()) {
  /** @type {string[]} */
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
 * @param {Record<string, string>} fixture
 * @param {Map<string, string>} outputMap
 */
export function updateFixture(fixture, outputMap) {
  /** @type {Record<string, string | undefined>} */
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

/** @param {Record<string, string | undefined>} fixture */
export function serializeFixture(fixture) {
  return JSON.stringify(fixture, null, 2) + '\n';
}

export const USAGE = `Usage: npm run test:css:update [-- --check]

Rewrites web/test/fixtures/css-expected.json from the example build (npm run pretest first).
  --check     write nothing; exit 1 when the fixture is out of date
  --help, -h  this text`;

/** The CLI: compare (or with `--check`, only check) the fixture against the build. `buildPath` and
 * `fixturePath` default to the real files and are injectable for tests. Returns the exit code:
 * 0 = up to date, rewritten or --help, 1 = `--check` found drift (nothing written), 2 = no build, or an
 * unknown flag / stray argument (parseCli, before anything is read).
 * @param {string[]} argv @param {{ buildPath?: string, fixturePath?: string }} [paths] */
export function main(argv, { buildPath = BUILD_PATH, fixturePath = FIXTURE_PATH } = {}) {
  const cli = parseCli(argv, { usage: USAGE, options: { check: { type: 'boolean' } } });
  // the casts keep the non-strict check (no discriminated narrowing without strictNullChecks) happy
  if (cli.exit != null) {
    if (cli.exit) console.error(/** @type {{ err: string }} */ (cli).err);
    else console.log(/** @type {{ out: string }} */ (cli).out);
    return cli.exit;
  }
  const check = !!(/** @type {{ values: { check?: boolean } }} */ (cli)).values.check;
  if (!fs.existsSync(buildPath)) {
    console.error(`update-css-fixture: missing ${path.relative(ROOT, buildPath)} — run \`npm run pretest\` first`);
    return 2;
  }
  const current = fs.readFileSync(fixturePath, 'utf8');
  const { fixture, added, removed, changed } = updateFixture(
    JSON.parse(current),
    buildDeclarationMap(fs.readFileSync(buildPath, 'utf8')),
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
  fs.writeFileSync(fixturePath, text);
  console.log(`update-css-fixture: wrote ${path.relative(ROOT, fixturePath)} (${summary})`);
  return 0;
}

if (isMain(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
