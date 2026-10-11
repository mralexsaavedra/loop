/* The one number / percent / duration formatter (lib/format/numbers.mjs, docs/design-system.md →
 * "Numbers"), in both locales, and its classic-script twin (clientSource) behaving the same. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as F from './numbers.mjs';

test('fmtInt groups every value >= 1000, 4 digits too, in both locales', () => {
  assert.equal(F.fmtInt(999, 'es'), '999');
  assert.equal(F.fmtInt(1000, 'es'), '1.000');
  assert.equal(F.fmtInt(2500, 'es'), '2.500');
  assert.equal(F.fmtInt(13463, 'es'), '13.463');
  assert.equal(F.fmtInt(1234567, 'es'), '1.234.567');
  assert.equal(F.fmtInt(2500, 'en'), '2,500');
  assert.equal(F.fmtInt(999.6, 'en'), '1,000', 'rounded before grouping');
  assert.equal(F.fmtInt(0, 'es'), '0');
  assert.equal(F.fmtInt(-2500, 'es'), '-2.500');
  assert.equal(F.fmtInt(-0.4, 'es'), '0', 'a value that rounds to zero has no sign');
  assert.equal(F.fmtInt(12, 'en', true), '+12');
});

test('fmtNumber: fixed decimals, decimal comma in es, grouping, sign rule', () => {
  assert.equal(F.fmtNumber(7.5, 1, 'es'), '7,5');
  assert.equal(F.fmtNumber(7.5, 1, 'en'), '7.5');
  assert.equal(F.fmtNumber(1234.56, 1, 'es'), '1.234,6');
  assert.equal(F.fmtNumber(1234.56, 1, 'en'), '1,234.6');
  assert.equal(F.fmtNumber(0.3, 1, 'es', true), '+0,3');
  assert.equal(F.fmtNumber(-0.04, 1, 'es', true), '0,0', 'no "-0,0" / "+0,0"');
  assert.equal(F.fmtNumber(-2.4, 1, 'es'), '-2,4');
  assert.equal(F.fmtNumber('80.1', 1, 'es'), '80,1', 'a numeric string is a number');
});

test('absent values print the one dash', () => {
  for (const v of [null, undefined, '', NaN, Infinity, -Infinity, 'abc', true]) {
    assert.equal(F.fmtNumber(v, 1, 'es'), '—', String(v));
    assert.equal(F.fmtInt(v, 'en'), '—');
    assert.equal(F.fmtPercent(v, 'es'), '—');
    assert.equal(F.fmtMinutes(v), '—');
    assert.equal(F.fmtHours(v), '—');
    assert.equal(F.fmtRaw(v, 'es'), '—');
  }
});

test('fmtPercent: no space, both locales', () => {
  assert.equal(F.fmtPercent(97, 'es'), '97%');
  assert.equal(F.fmtPercent(97.4, 'en'), '97%');
  assert.equal(F.fmtPercent(12, 'es', true), '+12%');
  assert.equal(F.fmtPercent(-6, 'es', true), '-6%');
  assert.equal(F.fmtPercent(0, 'es', true), '0%');
  assert.equal(F.fmtPercent(41.25, 'es', false, 1), '41,3%');
});

test('fmtMinutes / fmtHours: h:mm, minutes rounded first', () => {
  assert.equal(F.fmtMinutes(421), '7:01');
  assert.equal(F.fmtMinutes(37), '0:37');
  assert.equal(F.fmtMinutes(0), '0:00');
  assert.equal(F.fmtMinutes(1626), '27:06');
  assert.equal(F.fmtMinutes(59.6), '1:00');
  assert.equal(F.fmtMinutes(-29), '-0:29');
  assert.equal(F.fmtMinutes(29, true), '+0:29');
  assert.equal(F.fmtMinutes(-0.3, true), '0:00', 'rounds to zero: no sign');
  assert.equal(F.fmtHours(7.5), '7:30');
  assert.equal(F.fmtHours(7.999), '8:00', 'never "7:60"');
  assert.equal(F.fmtHours(7.0167), '7:01');
  assert.equal(F.fmtHours(-0.5, true), '-0:30');
});

test('fmtRaw keeps the decimals the value carries, grouped', () => {
  assert.equal(F.fmtRaw(1.25, 'es'), '1,25');
  assert.equal(F.fmtRaw(1.25, 'en'), '1.25');
  assert.equal(F.fmtRaw(2500, 'es'), '2.500');
  assert.equal(F.fmtRaw(-0.5, 'es'), '-0,5');
  assert.equal(F.fmtRaw(60, 'es'), '60');
});

test('fmtPlain: an input value, never grouped, empty when absent', () => {
  assert.equal(F.fmtPlain(2500.25, 1, 'es'), '2500,3');
  assert.equal(F.fmtPlain(80.5, 1, 'en'), '80.5');
  assert.equal(F.fmtPlain(null, 1, 'es'), '');
  assert.equal(F.fmtPlain(1000.5, null, 'es'), '1000,5', 'null decimals = the value as it is');
});

test('clientSource is a classic script whose HC_FMT matches the module', () => {
  const src = F.clientSource();
  assert.doesNotMatch(src, /\bexport\b|\bimport\b/);
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  const C = ctx.HC_FMT;
  const cases = [
    ['fmtInt', [13463, 'es']], ['fmtInt', [2500, 'en']], ['fmtNumber', [-0.04, 1, 'es', true]],
    ['fmtNumber', [1234.56, 1, 'es']], ['fmtPercent', [97, 'es']], ['fmtMinutes', [421]],
    ['fmtHours', [7.999]], ['fmtRaw', [1.25, 'es']], ['fmtPlain', [2500.25, 1, 'es']], ['fmtInt', [null, 'es']],
  ];
  for (const [fn, args] of cases) assert.equal(C[fn](...args), F[fn](...args), `${fn}(${args})`);
  assert.equal(C.DASH, '—');
});

test('classicGlobal survives bundler renaming: public keys from the map, constants under every spelling the bodies use', () => {
  // what Rollup emits when two bundled libs both declare fin / ISO_RE: renamed declarations and references
  const fin$3 = vm.runInNewContext('(function fin$3(v) { return typeof v === "number" && isFinite(v); })');
  const isoOk = vm.runInNewContext('(function isoOk(s) { return ISO_RE$2.test(s) && fin$3(LIMITS$1.max) && LIMITS.max > 0; })');
  const src = F.classicGlobal('HC_T', { consts: { LIMITS: { max: 3 } }, hidden: { ISO_RE: /^\d{4}$/ }, fns: { fin: fin$3, isoOk } });
  assert.doesNotMatch(src, /\bexport\b|\bimport\b/);
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  assert.deepEqual(Object.keys(ctx.HC_T), ['LIMITS', 'fin', 'isoOk']);
  assert.equal(ctx.HC_T.fin(2), true);
  assert.equal(ctx.HC_T.isoOk('2030'), true);
  assert.equal(ctx.HC_T.isoOk('x'), false);
  assert.throws(() => F.classicGlobal('HC_T', { fns: { f: () => 1 } }), /not a function declaration/);
});
