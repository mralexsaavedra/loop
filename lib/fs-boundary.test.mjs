/* Guard: which lib/ modules touch the filesystem. Convention: an area's fs I/O lives in
 * lib/<area>/read.mjs (lib/health/read.mjs, lib/nutrition/read.mjs, lib/training/read.mjs); compute
 * modules take their data as arguments and never import fs. The set of non-test lib modules that
 * import or require fs must EQUAL this allowlist: a new module importing fs fails, and so does an
 * allowlisted file that stopped importing it (drop it from the list). Later slices of the
 * code-structure refactor shrink the list toward the read.mjs files only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.dirname(fileURLToPath(import.meta.url));

const ALLOWED = [
  'health/read.mjs',
  'nutrition/read.mjs',
  'training/read.mjs',
  // still to be split into read.mjs adapters by later slices; new compute modules must not join
  'health/ride-energy.mjs',
  'journal/bake.mjs',
  'load/inputs.mjs',
  'profile/manuals.mjs',
  'profile/profile.mjs',
  'score/energy.mjs',
  'score/strain.mjs',
  'score/stress.mjs',
  'training/hr-zones.cjs',
].sort();

// import ... from 'fs' | 'node:fs' | 'fs/promises' (and node: forms), import('...'), require('...')
const FS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"](?:node:)?fs(?:\/promises)?['"]/;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

test('only the allowlisted lib modules import fs (compute modules take data as arguments)', () => {
  const found = walk(LIB)
    .filter((p) => /\.(mjs|js|cjs)$/.test(p) && !/\.test\.(mjs|js|cjs)$/.test(p))
    .filter((p) => FS_IMPORT.test(fs.readFileSync(p, 'utf8')))
    .map((p) => path.relative(LIB, p).split(path.sep).join('/'))
    .sort();
  assert.deepEqual(found, ALLOWED);
});

test('the fs import pattern catches every spelling and ignores look-alikes', () => {
  for (const s of ["import fs from 'node:fs';", 'import fs from "fs";', "import { readFile } from 'fs/promises';",
    "const fs = require('fs')", "await import('node:fs')", "import 'node:fs';"]) assert.match(s, FS_IMPORT, s);
  for (const s of ["import x from './fs.mjs';", "import p from 'node:path';", "// reads fsync"]) assert.doesNotMatch(s, FS_IMPORT, s);
});
