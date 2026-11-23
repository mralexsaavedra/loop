/* Guard: the dependency direction between the lib areas that build the Health / Home / Training views. Each
 * module sits on a layer and imports only from LOWER layers (or its own folder):
 *
 *   0  kernel   lib/*.mjs (stats, date, paths...), lib/format/, lib/build/, lib/extract/ (the parsed-sample kernel)
 *   1  training sessions, zones, modality, the workouts readers
 *   2  score    the recovery / strain / sleep / energy cores
 *   3  health, journal   the views' aggregates, built on the scores
 *
 * Other folders (nutrition, profile, detail, load, nav...) are not ranked here; lib/fs-boundary.test.mjs keeps lib
 * free of data/ and the fs use in the readers.
 *
 * ROOTS are the composition roots: they assemble every area for one consumer, so they may import any layer, and
 * no lib module may import them (only the page build, web/src/bakes.mjs, does).
 *
 * KNOWN_BACK_EDGES lists the imports that still go UP a layer. It must EQUAL what the scan finds: a new back-edge
 * fails, and so does a listed one that was removed (drop it from the list). The list only shrinks; it is empty. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.dirname(fileURLToPath(import.meta.url));
const FOLDER_LAYER = { format: 0, build: 0, extract: 0, training: 1, score: 2, health: 3, journal: 3 };

const ROOTS = {
  'extract/read.mjs': 'readExtract: reads every area of the extract once (health, journal, score, training)',
  'score/index.mjs': 'buildScoresFrom: the Home tab\'s SCORES bake, the score cores plus the journal\'s behaviours',
};

const KNOWN_BACK_EDGES = [];

const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const rel = (p) => path.relative(LIB, p).split(path.sep).join('/');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

/** The layer of a lib-relative path, or null when it is not ranked. Top-level files are the kernel. */
function layerOf(file) {
  const parts = file.split('/');
  if (parts.length === 1) return 0;
  return Object.hasOwn(FOLDER_LAYER, parts[0]) ? FOLDER_LAYER[parts[0]] : null;
}

/** Every lib import of a lib module, as [from, to] lib-relative paths (relative specifiers only). */
function libImports() {
  const out = [];
  for (const p of walk(LIB)) {
    if (!p.endsWith('.mjs') || p.endsWith('.test.mjs')) continue;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(SPEC)) {
      if (m[1].startsWith('.')) out.push([rel(p), rel(path.resolve(path.dirname(p), m[1]))]);
    }
  }
  return out;
}

/** Every import from one ranked folder to another that does not go down a layer: "from -> to". */
function backEdges() {
  const out = [];
  for (const p of walk(LIB)) {
    if (!p.endsWith('.mjs') || p.endsWith('.test.mjs')) continue;
    const from = rel(p);
    const fromLayer = layerOf(from);
    if (fromLayer == null || Object.hasOwn(ROOTS, from)) continue;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(SPEC)) {
      if (!m[1].startsWith('.')) continue;
      const to = rel(path.resolve(path.dirname(p), m[1]));
      const toLayer = layerOf(to);
      if (toLayer == null || to.split('/')[0] === from.split('/')[0]) continue;
      if (toLayer >= fromLayer && !(fromLayer === 0 && toLayer === 0)) out.push(`${from} -> ${to}`);
    }
  }
  return [...new Set(out)].sort();
}

test('lib areas import only from lower layers, except the known back-edges (a list that only shrinks)', () => {
  assert.deepEqual(backEdges(), [...KNOWN_BACK_EDGES].sort());
});

test('the composition roots exist, still assemble more than one layer, and no lib module imports them', () => {
  const imports = libImports();
  for (const root of Object.keys(ROOTS)) {
    assert.ok(fs.existsSync(path.join(LIB, root)), `${root} is listed in ROOTS but missing`);
    const layers = new Set(imports.filter(([from]) => from === root).map(([, to]) => layerOf(to)).filter((l) => l != null));
    assert.ok(layers.size > 1, `${root} no longer assembles several layers: drop it from ROOTS`);
  }
  assert.deepEqual(imports.filter(([, to]) => Object.hasOwn(ROOTS, to)).map(([from, to]) => `${from} -> ${to}`), []);
});
