/* lib/nutrition/intake.mjs — the Nutrición intake rings' baked view-model: the most recent
 * logged day's intake (dietary-daily.csv) next to the plan's training-day total (the fallback target). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestIntake, intakeFrom, INTAKE_FRESH_DAYS, INTAKE_BOOT_GRACE_MS } from './intake.mjs';
import { readExtract } from '../extract/read.mjs';

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

test('intakeFrom(): latest logged day + the rounded training-day total; no build-time clock', () => {
  // readDietary rows: blank macro cells read as null
  const dietary = [{ date: '2030-01-02', value: 2000, p: 150, c: 200, g: 60 }, { date: '2030-01-05', value: 1500, p: null, c: null, g: null }];
  const out = intakeFrom({ dietary }, targets);
  assert.deepEqual(out, {
    latest: { date: '2030-01-05', k: 1500, p: null, c: null, g: null },
    target: { train: { k: 2400, p: 170, c: 260, g: 71 } },
    freshDays: INTAKE_FRESH_DAYS,
    bootGraceMs: INTAKE_BOOT_GRACE_MS,
  });
});

test('intakeFrom(readExtract(null)) keeps the targets but has no intake (empty state)', () => {
  const out = intakeFrom(readExtract(null), targets);
  assert.equal(out.latest, null);
  assert.equal(out.target.train.k, 2400);
  assert.equal('rest' in out.target, false, 'the rest-day total is not baked (nothing reads it)');
});

test('the food API boot grace period is a short named constant (a few seconds), baked, never a client literal', () => {
  assert.ok(Number.isInteger(INTAKE_BOOT_GRACE_MS) && INTAKE_BOOT_GRACE_MS >= 1000 && INTAKE_BOOT_GRACE_MS <= 5000);
  assert.equal(intakeFrom(readExtract(null), targets).bootGraceMs, INTAKE_BOOT_GRACE_MS);
});

test('intakeFrom reads only the inputs\' dietary rows (readExtract shape); null inputs -> no latest day', () => {
  const targets = { train: { k: 2500.4, p: 150.6, c: 300, g: 70 } };
  const dietary = [{ date: '2030-01-01', value: 2000, p: 120, c: 200, g: 60 }];
  const out = intakeFrom({ dietary }, targets);
  assert.deepEqual(out.latest, latestIntake(dietary));
  assert.deepEqual(out.target, { train: { k: 2500, p: 151, c: 300, g: 70 } });
  assert.equal(intakeFrom({ dietary: null }, targets).latest, null);
});
