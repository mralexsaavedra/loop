/* Tests for the loop-free Shortcut heart-rate lists (`hr_t` + `hr_v`, zipped by index) in
 * lib/health/hr-hourly.mjs. SYNTHETIC values only. The rest of the module is covered by
 * data/apple-health/hr-hourly.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './hr-hourly.mjs';

const T = ['2030-01-02T09:00:00+01:00', '2030-01-02T09:05:00+01:00', '2030-01-02T09:10:00+01:00'];

test('zipHrLists: index-paired Start Date / Value lines -> the same samples as hr_samples', () => {
  const { samples, warning } = H.zipHrLists(T.join('\n'), '60\n80\n100');
  assert.equal(warning, null);
  assert.deepEqual(samples, ['09:00', '09:05', '09:10'].map((hm, i) => ({ start: `2030-01-02 ${hm}:00 +0100`, value: [60, 80, 100][i] })));
  assert.deepEqual(samples, T.map((t, i) => H.parseSample(`${t};${[60, 80, 100][i]}`)));
});

test('zipHrLists: a value may carry a unit or a decimal comma; the leading number is the bpm', () => {
  const { samples } = H.zipHrLists(T.join('\n'), '72 count/min\n72,5 lpm\n 98.4 bpm');
  assert.deepEqual(samples.map(s => s.value), [72, 72.5, 98.4]);
});

test('zipHrLists: out-of-range, unparseable value or timestamp drops only that pair', () => {
  const { samples, warning } = H.zipHrLists([...T, 'garbage'].join('\n'), '24\nlpm\n241\n70');
  assert.equal(warning, null);
  assert.deepEqual(samples, []);
  assert.deepEqual(H.zipHrLists(T.join('\n'), '25\n240\nx').samples.map(s => s.value), [25, 240]);
});

test('zipHrLists: different lengths -> no samples at all and a warning (never mis-paired)', () => {
  const r = H.zipHrLists(T.join('\n'), '60\n80');
  assert.deepEqual(r.samples, []);
  assert.match(r.warning, /3 .*2/);
  // one list missing while the other is present is a mismatch too
  assert.deepEqual(H.zipHrLists(T.join('\n'), undefined).samples, []);
  assert.ok(H.zipHrLists(T.join('\n'), undefined).warning);
  assert.deepEqual(H.zipHrLists(undefined, '60').samples, []);
  assert.ok(H.zipHrLists(undefined, '60').warning);
});

test('zipHrLists: neither list -> nothing, no warning', () => {
  assert.deepEqual(H.zipHrLists(undefined, undefined), { samples: [], warning: null });
  assert.deepEqual(H.zipHrLists('', ''), { samples: [], warning: null });
});

test('zipHrLists: a blank line is skipped only when blank in BOTH lists; a one-sided blank is a mismatch', () => {
  const both = H.zipHrLists(`${T[0]}\n\n${T[1]}\r\n${T[2]}\n`, '60\n\n80\r\n100\n');
  assert.equal(both.warning, null);
  assert.deepEqual(both.samples.map(s => s.value), [60, 80, 100]);
  const oneSided = H.zipHrLists(`${T[0]}\n\n${T[1]}`, '60\n70\n80');
  assert.deepEqual(oneSided.samples, []);
  assert.ok(oneSided.warning);
  // same count, blank on different rows: pairing would shift, so it is a mismatch too
  const shifted = H.zipHrLists(`${T[0]}\n\n${T[1]}`, '60\n80\n');
  assert.deepEqual(shifted.samples, []);
  assert.ok(shifted.warning);
});

test('mergeHrSamples: hr_samples lines + zipped lists, union deduped by exact timestamp (lists win a tie)', () => {
  const payload = {
    hr_samples: `${T[0]};61\n${T[1]};81`,
    hr_t: `${T[1]}\n${T[2]}`,
    hr_v: '82 lpm\n101',
  };
  const { samples, warning } = H.mergeHrSamples(payload);
  assert.equal(warning, null);
  assert.deepEqual(samples.map(s => [s.start.slice(11, 16), s.value]), [['09:00', 61], ['09:05', 82], ['09:10', 101]]);
  // a mismatched pair of lists still keeps the hr_samples lines
  const bad = H.mergeHrSamples({ ...payload, hr_v: '82' });
  assert.deepEqual(bad.samples.map(s => s.value), [61, 81]);
  assert.ok(bad.warning);
  assert.deepEqual(H.mergeHrSamples({}), { samples: [], warning: null });
});
