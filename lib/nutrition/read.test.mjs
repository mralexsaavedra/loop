/* lib/nutrition/read.mjs — the build-time food log reader (temp-dir fixtures; the parsing and the
 * bake window are tested purely in score.test.mjs). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { foodlogFile, buildFoodlogBake } from './read.mjs';

const H = 'date,kcal,protein_g,carbs_g,fat_g,entries,breakfast,lunch,dinner,addon,missing_macros\n';

test('foodlogFile / buildFoodlogBake: personal = data/nutrition, example = the demo extract; absent -> empty', () => {
  assert.equal(foodlogFile({ repoRoot: '/r', dataMode: 'personal', extractDir: '/x' }), path.join('/r', 'data', 'nutrition', 'foodlog-daily.csv'));
  assert.equal(foodlogFile({ repoRoot: '/r', dataMode: 'example', extractDir: '/x' }), path.join('/x', 'foodlog-daily.csv'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nscore-'));
  assert.deepEqual(buildFoodlogBake({ repoRoot: dir, dataMode: 'example', extractDir: dir }), { asOf: null, days: [] });
  fs.writeFileSync(path.join(dir, 'foodlog-daily.csv'), H + '2030-01-02,2000,150,200,70,3,1,1,1,0,\n');
  assert.equal(buildFoodlogBake({ repoRoot: dir, dataMode: 'example', extractDir: dir }).asOf, '2030-01-02');
  fs.rmSync(dir, { recursive: true });
});

test('buildFoodlogBake: a malformed row is skipped and reported once through warn, never thrown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nscore-'));
  fs.writeFileSync(path.join(dir, 'foodlog-daily.csv'), H + '2030-13-45,2000,150,200,70,3,1,1,1,0,\n2030-01-02,2000,150,200,70,3,1,1,1,0,\n');
  const warned = [];
  const b = buildFoodlogBake({ repoRoot: dir, dataMode: 'example', extractDir: dir }, { warn: (m) => warned.push(m) });
  assert.equal(b.asOf, '2030-01-02');
  assert.equal(warned.length, 1);
  assert.match(warned[0], /skipped 1 row/);
  fs.rmSync(dir, { recursive: true });
});
