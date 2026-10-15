/* scripts/make-logo.mjs: a contributor-only tool whose two packages (fontkitten, sharp) are not declared in
 * package.json. Importing it writes nothing; a missing package is one clear error. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDeps } from './make-logo.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'make-logo.mjs');

test('loadDeps: a missing optional package -> an error naming fontkitten and sharp and how to get them', async () => {
  const missing = async (/** @type {string} */ m) => { throw new Error(`Cannot find package '${m}'`); };
  await assert.rejects(loadDeps(missing), /needs the optional packages fontkitten and sharp .*npm ci/);
  const fake = async (/** @type {string} */ m) => (m === 'sharp' ? { default: 'S' } : { create: 'C' });
  assert.deepEqual(await loadDeps(fake), { create: 'C', sharp: 'S' });
});

test('make-logo without a font path prints the usage and exits 1, writing nothing', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^usage: node scripts\/make-logo\.mjs/);
});
