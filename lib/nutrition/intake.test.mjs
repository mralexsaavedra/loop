/* lib/nutrition/intake.mjs — the Nutrición intake rings' baked view-model: the most recent
 * logged day's intake (dietary-daily.csv) next to the plan's training-day total (the fallback target). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { latestIntake, buildIntake, INTAKE_FRESH_DAYS } from './intake.mjs';

const targets = { train: { k: 2400.4, p: 170.2, c: 260, g: 70.6 }, rest: { k: 2000, p: 160, c: 180, g: 70 } };

test('latestIntake() picks the most recent day with kcal > 0 and rounds it', () => {
  const rows = [
    { date: '2030-01-01', value: 2100, p: 150, c: 220, g: 70 },
    { date: '2030-01-03', value: 1840.6, p: 140.26, c: null, g: 61.04 },
    { date: '2030-01-04', value: 0, p: 0, c: 0, g: 0 },
  ];
  assert.deepEqual(latestIntake(rows), { date: '2030-01-03', k: 1841, p: 140.3, c: null, g: 61 });
});

test('latestIntake() is null without any logged day (never falls back to a target)', () => {
  assert.equal(latestIntake(null), null);
  assert.equal(latestIntake([]), null);
  assert.equal(latestIntake([{ date: '2030-01-01', value: 0, p: 10, c: 10, g: 10 }]), null);
});

test('buildIntake(): latest logged day + the rounded training-day total; no build-time clock', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-'));
  fs.writeFileSync(path.join(dir, 'dietary-daily.csv'), 'date,kcal,protein_g,carbs_g,fat_g\n2030-01-02,2000,150.0,200.0,60.0\n2030-01-05,1500,,,\n');
  const out = buildIntake(dir, targets);
  assert.deepEqual(out, {
    latest: { date: '2030-01-05', k: 1500, p: null, c: null, g: null },
    target: { train: { k: 2400, p: 170, c: 260, g: 71 } },
    freshDays: INTAKE_FRESH_DAYS,
  });
  fs.rmSync(dir, { recursive: true });
});

test('buildIntake(null) keeps the targets but has no intake (empty state)', () => {
  assert.equal(buildIntake(null, targets).latest, null);
  assert.equal(buildIntake(null, targets).target.train.k, 2400);
  assert.equal('rest' in buildIntake(null, targets).target, false, 'the rest-day total is not baked (nothing reads it)');
});
