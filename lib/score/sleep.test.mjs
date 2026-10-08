import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleepPerformance, sleepEfficiency, stageShares, sleepFromInputs, buildSleepScore } from './sleep.mjs';

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

test('buildSleepScore() reads sleep-daily.csv; null without the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleep-score-'));
  try {
    assert.equal(buildSleepScore(dir), null);
    fs.writeFileSync(path.join(dir, 'sleep-daily.csv'), 'date,asleep_hours,source,bedtime,waketime,rem_h,deep_h,core_h,unspec_h,awake_h,inbed_h\n2026-09-21,6.00,W,0,6.5,1.20,0.90,3.90,0.00,0.50,6.50\n');
    const s = buildSleepScore(dir);
    assert.equal(s.need, 7.5, 'need = the stated sleep target');
    assert.equal(s.last.perf, 80);
    assert.equal(s.last.eff, 92);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
