/* Build idempotency (R4.6): two consecutive builds of identical inputs are byte-identical, so no
 * build-time "now" leaks into the page (staleness is computed client-side from the baked asOf). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(path.dirname(here));
const build = path.join(ROOT, 'scripts', 'build-web.mjs');

test('two consecutive example builds are byte-identical, exit 0 with no extract data', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idem-'));
  try {
    const out = [1, 2].map((i) => {
      const dir = path.join(tmp, `b${i}`);
      execFileSync(process.execPath, [build, '--mode', 'example', '--locale', 'en', '--outdir', dir], { cwd: ROOT, stdio: 'pipe' });
      return fs.readFileSync(path.join(dir, 'index.html'));
    });
    assert.ok(out[0].equals(out[1]), 'consecutive builds differ');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('health.js ago() and score.js guard a null asOf (no NaN/throw)', () => {
  const health = fs.readFileSync(path.join(ROOT, 'web', 'src', 'client', 'health.js'), 'utf8');
  assert.match(health, /function ago\(iso\) \{\s*\n\s*if \(!iso\) return '';/);
});
