/* lib/nutrition/num.mjs — the shared rounding helpers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fin, round1, round2, roundEps, ROUND_EPS } from './num.mjs';

test('fin: a finite number only', () => {
  for (const v of [0, -1.5, 1e9]) assert.equal(fin(v), true, String(v));
  for (const v of [NaN, Infinity, -Infinity, '1', null, undefined, {}]) assert.equal(fin(v), false, String(v));
});

test('roundEps: x.x5 never rounds down on floating-point noise; round1 / round2 stay plain', () => {
  assert.equal(ROUND_EPS, 1e-9);
  assert.equal(round2(1.005), 1, 'plain: 1.005 * 100 = 100.4999…');
  assert.equal(roundEps(1.005, 2), 1.01);
  assert.equal(roundEps(0.1 + 0.2, 1), 0.3);
  assert.equal(roundEps(2.45, 1), 2.5);
  assert.equal(roundEps(99.5, 0), 100);
  assert.equal(round1(1.25), 1.3);
});
