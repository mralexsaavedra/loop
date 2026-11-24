/* Guard: a lib module's file name says which one it is. Two modules in different folders never share a name
 * (lib/score/energy.mjs, the energy bank, and lib/nutrition/energy.mjs, the daily energy need, were renamed
 * apart), and no module is named like another lib folder (lib/nutrition/score.mjs read as "the score folder"; it
 * is now nutri-score.mjs; lib/journal/journal.mjs, an area's main module, may share its own folder's name). The area readers keep their shared name by convention (read.mjs, lib/fs-boundary.test.mjs). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.dirname(fileURLToPath(import.meta.url));
const SHARED_BY_CONVENTION = new Set(['read.mjs']);

/** @param {string} dir @returns {string[]} */
function modules(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return modules(p);
    return e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs') && !e.name.endsWith('.cases.mjs') ? [p] : [];
  });
}

const rel = (/** @type {string} */ p) => path.relative(LIB, p).split(path.sep).join('/');

test('no two lib modules in different folders share a file name (read.mjs aside)', () => {
  const byName = new Map();
  for (const p of modules(LIB)) {
    const name = path.basename(p);
    if (SHARED_BY_CONVENTION.has(name)) continue;
    byName.set(name, [...(byName.get(name) ?? []), rel(p)]);
  }
  assert.deepEqual([...byName.values()].filter((paths) => paths.length > 1), []);
});

test('no lib module is named like ANOTHER lib folder (an area\'s main module may share its own folder\'s name)', () => {
  const folders = new Set(fs.readdirSync(LIB, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
  const misnamed = modules(LIB).filter((p) => {
    const name = path.basename(p, '.mjs');
    return folders.has(name) && name !== rel(p).split('/')[0];
  });
  assert.deepEqual(misnamed.map(rel), []);
});
