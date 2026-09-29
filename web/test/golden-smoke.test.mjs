/* Smoke test for the golden legacy-output fixtures captured by
 * scripts/capture-golden.mjs. These fixtures are a snapshot of the legacy
 * generators' output taken BEFORE any lib/ extraction touches them; slice 2
 * compares its refactored output against this snapshot for byte-identity.
 *
 * This test does NOT run the capture itself — capture-golden.mjs is a
 * one-shot local step (fixtures are gitignored). Run it manually first:
 *   node scripts/capture-golden.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenDir = path.join(here, '.golden', 'personal');
const EXPECTED_FILES = ['plan-web.html', 'plan-tables.md', 'blocks.json', 'inputs.sha'];

test('golden legacy fixtures exist and are non-empty', () => {
  for (const name of EXPECTED_FILES) {
    const p = path.join(goldenDir, name);
    assert.ok(
      fs.existsSync(p),
      `missing golden fixture: ${name} — run \`node scripts/capture-golden.mjs\` first`,
    );
    const { size } = fs.statSync(p);
    assert.ok(size > 0, `golden fixture is empty: ${name}`);
  }
});

test('blocks.json captures every legacy GEN:* region as a distinct, non-empty block', () => {
  const blocks = JSON.parse(fs.readFileSync(path.join(goldenDir, 'blocks.json'), 'utf8'));
  const expectedRegions = [
    'GEN:DATA', 'GEN:BREAKFAST', 'GEN:DAYPLAN', 'GEN:EXTRAS',
    'GEN:TRAINING', 'GEN:DASHBOARD', 'GEN:HEALTH',
  ];
  assert.deepEqual(Object.keys(blocks).sort(), expectedRegions.sort());
  for (const region of expectedRegions) {
    assert.ok(typeof blocks[region] === 'string' && blocks[region].length > 0, `${region} block is empty`);
    assert.ok(blocks[region].includes(region + ' START'), `${region} block missing its own START marker`);
  }
});
