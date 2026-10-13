/* The ingest service's src/food-calc.js is GENERATED from lib/nutrition/foodlog.mjs: the committed file
 * must be exactly what the generator writes now (a lib change without `npm run gen:food-calc` fails here). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeGenerated } from './lib/generated.mjs';
import { foodCalcSource, FOOD_CALC_PATH, FOOD_CALC_HEADER } from './gen-food-calc.mjs';
import { esmModule } from '../lib/build/esm-module.mjs';

const committed = readFileSync(FOOD_CALC_PATH, 'utf8');

test('food-calc.js starts with the GENERATED header', () => {
  assert.ok(committed.startsWith('/* ' + FOOD_CALC_HEADER), 'services/health-ingest/src/food-calc.js is not generated: run `npm run gen:food-calc`');
});

test('food-calc.js is current: regenerating it from the lib gives the committed bytes', () => {
  assert.ok(committed === foodCalcSource(), 'services/health-ingest/src/food-calc.js is out of date: run `npm run gen:food-calc`');
});

test('the generator is deterministic', () => {
  assert.equal(foodCalcSource(), foodCalcSource());
});

/* ---------- lib/build/esm-module.mjs ---------- */
function twice(v) {
  return helper(v) * K;
}
function helper(v) {
  return v + 1;
}

test('esmModule: exported and hidden constants, local and exported functions, frozen values stay frozen', async () => {
  const src = esmModule('demo', { consts: { LIST: Object.freeze(['a']), N: 2 }, hidden: { K: 3 }, local: { helper }, fns: { twice } });
  assert.match(src, /^\/\* demo \*\/\n/);
  assert.match(src, /export const LIST = Object\.freeze\(\["a"\]\);/);
  assert.match(src, /\nconst K = 3;/);
  assert.match(src, /\nfunction helper\(v\)/);
  const mod = await import('data:text/javascript,' + encodeURIComponent(src));
  assert.deepEqual(Object.keys(mod).sort(), ['LIST', 'N', 'twice']);
  assert.equal(mod.twice(1), 6);
  assert.ok(Object.isFrozen(mod.LIST));
});

test('esmModule: a frozen constant is frozen at every level; an unfrozen one stays mutable', async () => {
  const TREE = Object.freeze({ a: [1, [2, { z: 'x' }]], b: { c: 'y' }, n: null });
  const LOOSE = { d: [1] };
  const src = esmModule('demo', { consts: { TREE, LOOSE } });
  assert.match(src, /export const LOOSE = \{"d":\[1\]\};/);
  const mod = await import('data:text/javascript,' + encodeURIComponent(src));
  assert.deepEqual(mod.TREE, TREE);
  for (const v of [mod.TREE, mod.TREE.a, mod.TREE.a[1], mod.TREE.a[1][1], mod.TREE.b]) assert.ok(Object.isFrozen(v), JSON.stringify(v));
  assert.ok(!Object.isFrozen(mod.LOOSE) && !Object.isFrozen(mod.LOOSE.d));
});

test('esmModule: refuses values that do not print as themselves, renamed keys and duplicate names', () => {
  assert.throws(() => esmModule('x', { consts: { A: NaN } }), /not JSON-safe/);
  assert.throws(() => esmModule('x', { consts: { A: { b: undefined } } }), /not JSON-safe/);
  assert.throws(() => esmModule('x', { consts: { A: /re/ } }), /not JSON-safe/);
  assert.throws(() => esmModule('x', { fns: { other: helper } }), /declares helper/);
  assert.throws(() => esmModule('x', { fns: { arrow: () => 1 } }), /not a function declaration/);
  assert.throws(() => esmModule('x', { hidden: { helper: 1 }, local: { helper } }), /declared twice/);
});

test('writeGenerated: --check reports drift without writing, a write is idempotent, a current file passes', (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const dir = mkdtempSync(join(tmpdir(), 'gen-'));
  try {
    const file = join(dir, 'out.js');
    const opts = { label: 'x/out.js', script: 'gen:x' };
    assert.equal(writeGenerated(file, 'A\n', { ...opts, check: true }), 1); // missing = drift
    assert.throws(() => readFileSync(file));
    assert.equal(writeGenerated(file, 'A\n', opts), 0);
    assert.equal(readFileSync(file, 'utf8'), 'A\n');
    assert.equal(writeGenerated(file, 'A\n', { ...opts, check: true }), 0);
    writeFileSync(file, 'hand edit\n');
    assert.equal(writeGenerated(file, 'A\n', { ...opts, check: true }), 1);
    assert.equal(readFileSync(file, 'utf8'), 'hand edit\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
