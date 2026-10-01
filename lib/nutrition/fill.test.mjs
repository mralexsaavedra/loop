/* lib/nutrition/fill.mjs — the ONE water-filling of the carb solve (scale.mjs) and the snack (snack.mjs). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waterFill, FILL_CASES } from './fill.mjs';

const CLAMP = [0.6, 2];

test('one common factor when nothing passes its cap', () => {
  assert.deepEqual(waterFill([{ k: 100, cap: 5 }, { k: 300, cap: 5 }], 600), { f: 1.5, clamp: null, held: [false, false] });
  assert.deepEqual(waterFill([{ k: 100, cap: 5 }, { k: 300, cap: 5 }], 600, { clamp: CLAMP, start: 1 }), { f: 1.5, clamp: null, held: [false, false] });
});

test('an item past its cap is held there and the factor re-solved over the rest', () => {
  // 1000 kcal over 100 + 300 -> 2.5; the first caps at 1.2 (120), the rest: 880 / 300 = 2.93
  const r = waterFill([{ k: 100, cap: 1.2 }, { k: 300, cap: 5 }], 1000);
  assert.deepEqual(r, { f: 2.93, clamp: null, held: [true, false] });
});

test('the clamp: bounded with its label; a cap below the minimum still wins', () => {
  assert.deepEqual(waterFill([{ k: 100, cap: 9 }], 1000, { clamp: CLAMP, start: 1 }), { f: 2, clamp: 'max', held: [false] });
  assert.deepEqual(waterFill([{ k: 100, cap: 9 }], 10, { clamp: CLAMP, start: 1 }), { f: 0.6, clamp: 'min', held: [false] });
  assert.deepEqual(waterFill([{ k: 100, cap: 0.5 }, { k: 100, cap: 9 }], 100, { clamp: CLAMP, start: 1 }), { f: 0.6, clamp: 'min', held: [true, false] });
});

test('without a clamp the factor never goes below 0 and may pass 2', () => {
  assert.deepEqual(waterFill([{ k: 100, cap: 9 }], -50), { f: 0, clamp: null, held: [false] });
  assert.deepEqual(waterFill([{ k: 100, cap: 9 }], 500), { f: 5, clamp: null, held: [false] });
});

test('every item held: the largest cap, no clamp; nothing to fill: the start factor', () => {
  assert.deepEqual(waterFill([{ k: 100, cap: 1.5 }, { k: 100, cap: 1.2 }], 1000, { clamp: CLAMP, start: 1 }), { f: 1.5, clamp: null, held: [true, true] });
  assert.deepEqual(waterFill([], 300, { clamp: CLAMP, start: 1 }), { f: 1, clamp: null, held: [] });
  assert.deepEqual(waterFill([], 300), { f: 0, clamp: null, held: [] });
  assert.deepEqual(waterFill([{ k: 0, cap: 2 }], 300), { f: 0, clamp: null, held: [false] });
});

test('FILL_CASES: shared cases (the page port runs them too) cover both modes', () => {
  assert.ok(FILL_CASES.length >= 6);
  assert.ok(FILL_CASES.some((c) => c.opts && c.opts.clamp) && FILL_CASES.some((c) => !c.opts));
  for (const c of FILL_CASES) assert.ok(Number.isFinite(waterFill(c.items, c.need, c.opts).f));
});
