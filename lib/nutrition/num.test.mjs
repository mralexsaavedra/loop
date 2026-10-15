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

test('two round1 on purpose: num.mjs is plain (the plan), foodlog.mjs is epsilon-safe (the food log)', async () => {
  const { round1: logRound1 } = await import('./foodlog.mjs');
  const v = 2.3 + 0.05; // 2.3499999999999996
  assert.equal(round1(v), 2.3);
  assert.equal(logRound1(v), 2.4);
  assert.equal(logRound1(v), roundEps(v, 1));
  // where the float is exact they agree
  for (const x of [0, 1.25, 2.45, -1.25, 99.95]) assert.equal(round1(x), logRound1(x), String(x));
});
