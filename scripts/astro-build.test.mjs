// Every Astro build goes through scripts/lib/astro-build.mjs, the one place that holds the build lock: a direct call to
// the Astro binary anywhere else could run beside another build and delete its prerender chunks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = 'scripts/lib/astro-build.mjs';
const SELF = 'scripts/astro-build.test.mjs';

test('no file but the helper runs the Astro binary', () => {
  const files = execFileSync('git', ['ls-files', '*.mjs', '*.js', '*.sh', '*.json'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => f && f !== HELPER && f !== SELF);
  const offenders = files.filter((f) => {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    return /'\.bin',\s*'astro'/.test(s) || /\.bin\/astro\b/.test(s) || /\bastro build\b/.test(s);
  });
  assert.deepEqual(offenders, []);
});
