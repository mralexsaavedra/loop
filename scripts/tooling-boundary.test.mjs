/* Guard: the direction between the two tooling folders. data/ holds the scripts that fetch or build one
 * area's inputs (data/apple-health, data/nutrition, data/profile); scripts/ holds the repo-wide CLIs and,
 * in scripts/lib/, the tooling kernel every CLI shares (sync-common.mjs, is-main.mjs, data-root-guard.mjs,
 * generated.mjs). Dependencies point one way only:
 *   - no non-test module under scripts/ imports from data/ (a helper both need lives in scripts/lib/);
 *   - a module under data/ imports from scripts/ only through scripts/lib/, never a top-level CLI.
 * lib/ has its own guard (lib/fs-boundary.test.mjs: no lib module imports from data/). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(SCRIPTS, '..');
const DATA = path.join(REPO, 'data');
const SCRIPTS_LIB = path.join(SCRIPTS, 'lib') + path.sep;
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(mjs|js|cjs)$/.test(e.name) ? [p] : [];
  });
}

/** Every relative import of `file`, resolved to an absolute path. */
function importsOf(file) {
  return [...fs.readFileSync(file, 'utf8').matchAll(SPEC)]
    .map((m) => m[1])
    .filter((s) => s.startsWith('.'))
    .map((s) => path.resolve(path.dirname(file), s));
}

const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');
const isTest = (p) => /\.test\.(mjs|js|cjs)$/.test(p);

test('no non-test module under scripts/ imports from data/', () => {
  const found = walk(SCRIPTS)
    .filter((p) => !isTest(p))
    .flatMap((p) => importsOf(p).filter((t) => t.startsWith(DATA + path.sep)).map((t) => `${rel(p)} -> ${rel(t)}`));
  assert.deepEqual(found, []);
});

test('data/ imports from scripts/ only through scripts/lib/', () => {
  const found = walk(DATA)
    .flatMap((p) => importsOf(p)
      .filter((t) => t.startsWith(SCRIPTS + path.sep) && !t.startsWith(SCRIPTS_LIB))
      .map((t) => `${rel(p)} -> ${rel(t)}`));
  assert.deepEqual(found, []);
});
