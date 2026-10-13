import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sleepPerformance, sleepEfficiency, stageShares, sleepFromInputs, sleepScoreFrom } from './sleep.mjs';
import { readExtract } from '../extract/read.mjs';

test('sleepPerformance(): asleep / need x 100, rounded, capped at 100; null without a need or hours', () => {
  assert.equal(sleepPerformance(6.9, 7.5), 92);
  assert.equal(sleepPerformance(9, 7.5), 100);
  assert.equal(sleepPerformance(0, 7.5), 0);
  assert.equal(sleepPerformance(null, 7.5), null);
  assert.equal(sleepPerformance(7, 0), null);
});

test('sleepEfficiency(): asleep / in bed x 100, capped at 100; null when in bed is unknown', () => {
  assert.equal(sleepEfficiency(7, 7.5), 93);
  assert.equal(sleepEfficiency(7, 6.8), 100);
  assert.equal(sleepEfficiency(7, null), null);
  assert.equal(sleepEfficiency(7, 0), null);
});

test('stageShares(): REM / deep / core as % of asleep; null on an unstaged night', () => {
  assert.deepEqual(stageShares({ value: 8, rem: 2, deep: 1.2, core: 4.8 }), { rem: 25, deep: 15, core: 60 });
  assert.equal(stageShares({ value: 8, rem: null, deep: null, core: null, unspec: 8 }), null);
  assert.equal(stageShares({ value: 0, rem: 0, deep: 0, core: 0 }), null);
});

const night = (date, value, o = {}) => ({ date, value, bedtime: 23, waketime: 7, rem: null, deep: null, core: null, unspec: null, awake: null, inbed: null, ...o });

test('sleepFromInputs(): last night with performance, efficiency, consistency, stages and restorative time', () => {
  const rows = [];
  for (let d = 1; d <= 20; d++) rows.push(night(`2026-09-${String(d).padStart(2, '0')}`, 7.5));
  rows.push(night('2026-09-21', 6.9, { bedtime: 23.5, waketime: 7.5, rem: 1.5, deep: 1.1, core: 4.3, unspec: 0, awake: 0.4, inbed: 7.4 }));
  const s = sleepFromInputs(rows, 7.5);
  assert.equal(s.need, 7.5);
  assert.deepEqual(s.last, {
    date: '2026-09-21', hours: 6.9, perf: 92, eff: 93, cons: 30,
    stages: { rem: 1.5, deep: 1.1, core: 4.3, unspec: 0, awake: 0.4, inbed: 7.4 },
    shares: { rem: 22, deep: 16, core: 62 }, restorative: 2.6,
  });
});

test('sleepFromInputs(): an old five-column night hides efficiency, stages and shares (never invented)', () => {
  const s = sleepFromInputs([night('2026-09-21', 8)], 7.5);
  assert.equal(s.last.perf, 100);
  assert.equal(s.last.eff, null);
  assert.equal(s.last.stages, null);
  assert.equal(s.last.shares, null);
  assert.equal(s.last.restorative, null);
  assert.equal(s.last.cons, null, 'no prior nights = no consistency baseline');
  assert.equal(sleepFromInputs([], 7.5), null);
  assert.equal(sleepFromInputs([night('2026-09-21', 8)], null), null);
});

test('sleepScoreFrom() scores the readExtract sleep rows; null without sleep-daily.csv', () => {
  assert.equal(sleepScoreFrom(readExtract(null)), null);
  const sleep = [{ date: '2026-09-21', value: 6, bedtime: 0, waketime: 6.5, rem: 1.2, deep: 0.9, core: 3.9, unspec: 0, awake: 0.5, inbed: 6.5 }];
  const s = sleepScoreFrom({ sleep });
  assert.equal(s.need, 7.5, 'need = the stated sleep target');
  assert.equal(s.last.perf, 80);
  assert.equal(s.last.eff, 92);
});
