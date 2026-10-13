/* Unit tests for lib/score/fitness-age.mjs — fitness age from the latest VO2max against the HUNT3
 * healthy-population age-group MEANS (Loe et al. 2013, PLoS ONE, Table 2). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitnessAge, fitnessAgeFromSeries, fitnessAgeFrom, FITNESS_AGE_REF } from './fitness-age.mjs';
import { buildScoresFrom } from './index.mjs';
import { readExtract } from '../extract/read.mjs';

test('the reference curve is Loe 2013 Table 2 (mean VO2max, mL/kg/min) at the age-group midpoints', () => {
  assert.deepEqual(FITNESS_AGE_REF.male, [[25, 54.4], [35, 49.1], [45, 47.2], [55, 42.6], [65, 39.2], [75, 35.3]]);
  assert.deepEqual(FITNESS_AGE_REF.female, [[25, 43.0], [35, 40.0], [45, 38.4], [55, 34.4], [65, 31.1], [75, 28.3]]);
});

test('a VO2max equal to an age-group mean gives that group midpoint', () => {
  assert.deepEqual(fitnessAge(49.1, 'male'), { age: 35, bound: null });
  assert.deepEqual(fitnessAge(34.4, 'female'), { age: 55, bound: null });
  assert.deepEqual(fitnessAge(54.4, 'male'), { age: 25, bound: null });
  assert.deepEqual(fitnessAge(28.3, 'female'), { age: 75, bound: null });
});

test('between two means: linear interpolation, 1 decimal', () => {
  // male 35 (49.1) -> 45 (47.2): 48.15 is halfway -> 40
  assert.deepEqual(fitnessAge(48.15, 'male'), { age: 40, bound: null });
  // female 25 (43.0) -> 35 (40.0): 42.0 is one third -> 28.3
  assert.deepEqual(fitnessAge(42, 'female'), { age: 28.3, bound: null });
});

test('outside the published range: clamped to the end midpoint and flagged', () => {
  assert.deepEqual(fitnessAge(60, 'male'), { age: 25, bound: 'below' });
  assert.deepEqual(fitnessAge(30, 'male'), { age: 75, bound: 'above' });
  assert.deepEqual(fitnessAge(44, 'female'), { age: 25, bound: 'below' });
  assert.deepEqual(fitnessAge(20, 'female'), { age: 75, bound: 'above' });
});

test('no sex or no finite VO2max -> null', () => {
  assert.equal(fitnessAge(45, null), null);
  assert.equal(fitnessAge(45, 'other'), null);
  assert.equal(fitnessAge(NaN, 'male'), null);
  assert.equal(fitnessAge(0, 'male'), null);
});

const row = (date, value, source = 'Watch') => ({ date, value, source });

test('series: the latest reading with its date and source, plus the 30 / 90-day trend', () => {
  const rows = [
    row('2026-05-01', 42.6), // 55
    row('2026-07-01', 47.2), // 45 (the reading on/before 2026-07-03 = latest − 90 d)
    row('2026-08-20', 48.15), // 40
    row('2026-09-01', 49.1), // 35 (on/before 2026-09-01 = latest − 30 d)
    row('2026-10-01', 54.4, 'Shortcut'),
  ];
  const r = fitnessAgeFromSeries(rows, 'male');
  assert.equal(r.ok, true);
  assert.equal(r.sex, 'male');
  assert.equal(r.age, 25);
  assert.equal(r.bound, null);
  assert.deepEqual(r.vo2, { value: 54.4, date: '2026-10-01', source: 'Shortcut' });
  assert.deepEqual(r.trend.d30, { date: '2026-09-01', vo2: 49.1, age: 35, bound: null });
  assert.deepEqual(r.trend.d90, { date: '2026-07-01', vo2: 47.2, age: 45, bound: null });
  assert.equal(r.ref, 'loe2013');
});

test('series: two rows on the same day -> the later row wins; a series shorter than the window has no trend', () => {
  const r = fitnessAgeFromSeries([row('2026-09-20', 40, 'A'), row('2026-10-01', 49.1, 'A'), row('2026-10-01', 47.2, 'B')], 'male');
  assert.equal(r.age, 45);
  assert.equal(r.vo2.source, 'B');
  assert.equal(r.trend.d30, null);
  assert.equal(r.trend.d90, null);
});

test('series: missing inputs -> ok false with the reason (the page shows it, never a number)', () => {
  assert.deepEqual(fitnessAgeFromSeries([row('2026-10-01', 45)], null), { ok: false, reason: 'no-sex' });
  assert.deepEqual(fitnessAgeFromSeries(null, 'male'), { ok: false, reason: 'no-vo2max' });
  assert.deepEqual(fitnessAgeFromSeries([], 'female'), { ok: false, reason: 'no-vo2max' });
});

test('fitnessAgeFrom scores the readExtract vo2max series; buildScoresFrom bakes it as SCORES.fitnessAge with the given sex', () => {
  const empty = readExtract(null);
  const vo2max = [{ date: '2026-09-01', value: 40, source: 'Watch' }, { date: '2026-10-01', value: 42, source: 'Watch' }];
  const inputs = { ...empty, series: { ...empty.series, vo2max } };
  assert.equal(fitnessAgeFrom(inputs, { sex: 'female' }).age, 28.3);
  assert.deepEqual(fitnessAgeFrom(inputs, {}), { ok: false, reason: 'no-sex' });
  assert.equal(buildScoresFrom(inputs, { sex: 'female' }).fitnessAge.age, 28.3);
  assert.deepEqual(buildScoresFrom(inputs).fitnessAge, { ok: false, reason: 'no-sex' });
  assert.deepEqual(buildScoresFrom(empty, { sex: 'male' }).fitnessAge, { ok: false, reason: 'no-vo2max' });
});
