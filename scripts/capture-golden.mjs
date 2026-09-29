#!/usr/bin/env node
/* Captures a golden snapshot of the LEGACY generator output — plan-web.html
 * (all GEN:* regions applied), plan-tables.md, the individual GEN:* block
 * strings, and a hash of the input files that produced them — BEFORE the
 * Astro migration (see astro-plan-web) touches any generator.
 *
 * Runs the three legacy CommonJS generators (data/nutrition/generate.js,
 * data/training/generate-training.js, data/training/generate-health.js)
 * IN MEMORY via createRequire. Requiring them only evaluates their
 * top-level computation (guarded by `require.main === module` for the
 * actual file-writing CLI path) — this script NEVER writes to the tracked
 * plan-web.html. It only READS it and writes the result into a gitignored
 * fixture directory (web/test/.golden/personal/).
 *
 * A later slice (lib/ extraction) asserts its refactored output is
 * byte-identical to this snapshot, skipping with a warning if the input
 * hash captured here has since changed (re-run this script to recapture).
 *
 * Run: node scripts/capture-golden.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const nutritionDir = path.join(ROOT, 'data', 'nutrition');
const trainingDir = path.join(ROOT, 'data', 'training');
const extractDir = path.join(ROOT, 'data', 'apple-health', 'extract');
const htmlPath = path.join(nutritionDir, 'plan-web.html');
const outDir = path.join(ROOT, 'web', 'test', '.golden', 'personal');

/* Every GEN:* region the three legacy generators splice into plan-web.html.
 * Extracted from the FINAL built HTML by regex (not by calling internal,
 * unexported block-builder functions) so this script stays decoupled from
 * generator internals. */
const GEN_REGIONS = [
  ['GEN:DATA', /[ \t]*\/\* GEN:DATA START[\s\S]*?\/\* GEN:DATA END \*\//],
  ['GEN:BREAKFAST', /[ \t]*<!-- GEN:BREAKFAST START[\s\S]*?<!-- GEN:BREAKFAST END -->/],
  ['GEN:DAYPLAN', /[ \t]*<!-- GEN:DAYPLAN START[\s\S]*?<!-- GEN:DAYPLAN END -->/],
  ['GEN:EXTRAS', /[ \t]*<!-- GEN:EXTRAS START[\s\S]*?<!-- GEN:EXTRAS END -->/],
  ['GEN:TRAINING', /[ \t]*\/\* GEN:TRAINING START[\s\S]*?\/\* GEN:TRAINING END \*\//],
  ['GEN:DASHBOARD', /[ \t]*\/\* GEN:DASHBOARD START[\s\S]*?\/\* GEN:DASHBOARD END \*\//],
  ['GEN:HEALTH', /[ \t]*\/\* GEN:HEALTH START[\s\S]*?\/\* GEN:HEALTH END \*\//],
];

function extractBlocks(html) {
  const blocks = {};
  for (const [name, re] of GEN_REGIONS) {
    const m = html.match(re);
    if (!m) throw new Error(`capture-golden: ${name} region not found in the built plan-web.html`);
    blocks[name] = m[0];
  }
  return blocks;
}

/* Hash the personal inputs that determine generator output, so a later
 * consumer can detect "the owner edited plan data mid-migration" and skip
 * the byte-identity check with a warning instead of failing hard. */
function hashInputs() {
  const hash = crypto.createHash('sha256');
  const files = [
    path.join(nutritionDir, 'ingredients.json'),
    path.join(nutritionDir, 'plan-data.json'),
    path.join(trainingDir, 'training-data.json'),
  ];
  if (fs.existsSync(extractDir)) {
    const csvs = fs.readdirSync(extractDir).filter(f => f.endsWith('.csv')).sort();
    for (const name of csvs) files.push(path.join(extractDir, name));
  }
  for (const f of files) {
    hash.update(path.relative(ROOT, f));
    hash.update('\0');
    hash.update(fs.existsSync(f) ? fs.readFileSync(f) : Buffer.from('MISSING'));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function main() {
  if (!fs.existsSync(htmlPath)) {
    throw new Error(
      `capture-golden: ${htmlPath} not found — this needs the personal plan-web.html ` +
      '(run `npm run generate` first).',
    );
  }

  const gen = require(path.join(nutritionDir, 'generate.js'));
  const genTraining = require(path.join(trainingDir, 'generate-training.js'));
  const genHealth = require(path.join(trainingDir, 'generate-health.js'));

  let html = fs.readFileSync(htmlPath, 'utf8');
  html = gen.buildHtml(html);
  html = genTraining.buildHtml(html);
  html = genHealth.buildHtml(html);

  const tables = gen.buildTables();
  const blocks = extractBlocks(html);
  const inputsSha = hashInputs();

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'plan-web.html'), html);
  fs.writeFileSync(path.join(outDir, 'plan-tables.md'), tables);
  fs.writeFileSync(path.join(outDir, 'blocks.json'), JSON.stringify(blocks, null, 2));
  fs.writeFileSync(path.join(outDir, 'inputs.sha'), inputsSha + '\n');

  console.log(`Captured golden fixtures -> ${path.relative(ROOT, outDir)}/`);
}

main();
