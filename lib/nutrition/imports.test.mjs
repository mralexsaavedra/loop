/* lib/nutrition stays loadable on its own: data/nutrition/generate.mjs runs from a fresh clone that holds this
 * folder (its test copies only lib/nutrition plus a few named lib files), so no module here may import
 * lib/format. The page reaches these modules through web/src/client/lib-globals.ts, which may import anything. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('no lib/nutrition module imports lib/format (an import statement, not a comment)', () => {
  const bad = [];
  for (const f of fs.readdirSync(here)) {
    if (!f.endsWith('.mjs') || f.endsWith('.test.mjs')) continue;
    const src = fs.readFileSync(path.join(here, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    if (/(^|[\s;])(import|export)\b[^;]*?from\s*['"]\.\.\/format\//m.test(src) || /\bimport\s*\(\s*['"]\.\.\/format\//.test(src)) bad.push(f);
  }
  assert.deepEqual(bad, []);
});
