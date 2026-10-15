/* Guard: which lib/ modules touch the filesystem. Convention: an area's fs I/O lives in its reader,
 * lib/<area>/read.mjs; compute modules take their data as arguments and never import fs. The set of
 * non-test lib modules that import or require fs must EQUAL the area readers plus the named
 * EXCEPTIONS: a new module importing fs fails, and so does a listed file that stopped importing it
 * (drop it from the list). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.dirname(fileURLToPath(import.meta.url));

// (a) the area readers: every one is named read.mjs
const READERS = ['health', 'journal', 'nutrition', 'profile', 'score', 'training'].map((a) => `${a}/read.mjs`);

// (b) the documented exceptions: fs users that are not an area reader, each with its reason
const EXCEPTIONS = {
  'load/inputs.mjs': 'the build-input loader of scripts/build-web.mjs and web/src/env.mjs',
  'profile/manuals.mjs': 'write-side publisher, used only by scripts/publish-manuals.mjs',
};

const ALLOWED = [...READERS, ...Object.keys(EXCEPTIONS)].sort();

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

test('every exception exists and has a reason; every reader is a read.mjs', () => {
  for (const [rel, why] of Object.entries(EXCEPTIONS)) {
    assert.ok(fs.existsSync(path.join(LIB, rel)), `${rel} is listed but missing`);
    assert.ok(why.length > 10, `${rel} needs a reason`);
    assert.notEqual(path.basename(rel), 'read.mjs', `${rel} is a reader, not an exception`);
  }
  for (const rel of READERS) assert.equal(path.basename(rel), 'read.mjs');
});

test('the fs import pattern catches every spelling and ignores look-alikes', () => {
  for (const s of ["import fs from 'node:fs';", 'import fs from "fs";', "import { readFile } from 'fs/promises';",
    "const fs = require('fs')", "await import('node:fs')", "import 'node:fs';"]) assert.match(s, FS_IMPORT, s);
  for (const s of ["import x from './fs.mjs';", "import p from 'node:path';", "// reads fsync"]) assert.doesNotMatch(s, FS_IMPORT, s);
});

// Read at the edge (docs/plan-page.md): the extract is read once, by lib/extract/read.mjs readExtract, which
// only web/src/bakes.mjs calls; compute modules take that data as arguments. So no lib module other than a
// reader (any read.mjs, lib/extract/read.mjs included) or a fs EXCEPTION above may import a read.mjs: a
// compute module that does is reading at the core again. READ_IMPORT_EXCEPTIONS names any legitimate
// remaining importer with its reason (none today).
const READ_IMPORT_EXCEPTIONS = {};

// import ... from '<anything>/read.mjs' (also './read.mjs'), import('...read.mjs'), require('...read.mjs')
const READ_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"](?:[^'"]*\/)?read\.mjs['"]/;

test('no compute lib module imports a reader (only readers and the fs exceptions do)', () => {
  const found = walk(LIB)
    .filter((p) => /\.(mjs|js|cjs)$/.test(p) && !/\.test\.(mjs|js|cjs)$/.test(p))
    .map((p) => path.relative(LIB, p).split(path.sep).join('/'))
    .filter((rel) => path.basename(rel) !== 'read.mjs' && !(rel in EXCEPTIONS))
    .filter((rel) => READ_IMPORT.test(fs.readFileSync(path.join(LIB, rel), 'utf8')))
    .sort();
  assert.deepEqual(found, Object.keys(READ_IMPORT_EXCEPTIONS).sort());
});

test('the reader import pattern catches every spelling and ignores look-alikes', () => {
  for (const s of ["import { a } from './read.mjs';", "} from '../health/read.mjs';", "import '../x/read.mjs';",
    "await import('../extract/read.mjs')", "require(\"./read.mjs\")"]) assert.match(s, READ_IMPORT, s);
  for (const s of ["import x from './thread.mjs';", "import y from './read-only.mjs';", '// readExtract reads read.mjs files'])
    assert.doesNotMatch(s, READ_IMPORT, s);
});

// lib/ is the code; data/ holds the inputs and the scripts that fetch them. No lib module (tests included)
// imports from data/: a helper both need lives in lib/ (lib/extract/samples.mjs) and the script imports it.
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

test('no lib module imports from data/', () => {
  const DATA = path.join(LIB, '..', 'data') + path.sep;
  const found = walk(LIB)
    .filter((p) => /\.(mjs|js|cjs)$/.test(p))
    .filter((p) => [...fs.readFileSync(p, 'utf8').matchAll(SPEC)].some((m) => m[1].startsWith('.') && path.resolve(path.dirname(p), m[1]).startsWith(DATA)))
    .map((p) => path.relative(LIB, p).split(path.sep).join('/'));
  assert.deepEqual(found, []);
});
