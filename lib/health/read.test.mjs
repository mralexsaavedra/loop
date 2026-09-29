/* Unit tests for lib/health/read.mjs — CSV reading helpers, extracted from
 * data/training/generate-health.js (astro-plan-web slice 2). Parameterized
 * by extractDir instead of a closed-over path, so a null/missing dir
 * degrades to the empty state exactly like a fresh clone with no export. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSeries, readTable, readDietary, readRunning, readRunDistByDate, readSleep, readWorkoutLoad } from './read.mjs';

function tmpExtractDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'health-extract-'));
}

test('readSeries returns null when the extract dir is null or the file is absent', () => {
  assert.equal(readSeries(null, 'weight.csv'), null);
  const dir = tmpExtractDir();
  try {
    assert.equal(readSeries(dir, 'weight.csv'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readSeries parses date,value[,source] rows, sorted and filtered to valid ISO dates', () => {
  const dir = tmpExtractDir();
  try {
    fs.writeFileSync(path.join(dir, 'weight.csv'), 'date,value,source\n2026-06-02,80.1,scale-a\n2026-06-01,80.5,scale-a\nbad-row\n');
    const rows = readSeries(dir, 'weight.csv');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.date), ['2026-06-01', '2026-06-02'], 'sorted ascending');
    assert.equal(rows[0].value, 80.5);
    assert.equal(rows[0].source, 'scale-a');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readTable maps arbitrary columns by index and drops bad dates', () => {
  const dir = tmpExtractDir();
  try {
    fs.writeFileSync(path.join(dir, 'running-daily.csv'), 'date,speed,power\n2026-06-01,11.5,260\nnot-a-date,1,1\n');
    const rows = readTable(dir, 'running-daily.csv', { speed: 1, power: 2 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].speed, 11.5);
    assert.equal(rows[0].power, 260);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readDietary parses kcal + macro columns (blank kcal -> null, filtered downstream by aggEnergy, not here — legacy uses global isFinite(null)===true)', () => {
  const dir = tmpExtractDir();
  try {
    fs.writeFileSync(path.join(dir, 'dietary-daily.csv'), 'date,kcal,protein_g,carbs_g,fat_g\n2026-06-01,2000,150,200,60\n2026-06-02,,,,\n');
    const rows = readDietary(dir);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].value, 2000);
    assert.equal(rows[0].p, 150);
    assert.equal(rows[1].value, null, 'blank kcal column parses to null, not dropped by readDietary itself');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readRunning and readSleep return null for a missing extract dir', () => {
  assert.equal(readRunning(null), null);
  assert.equal(readSleep(null), null);
});

test('readRunDistByDate sums GPS distance for Running-type workouts per day, {} when absent', () => {
  assert.deepEqual(readRunDistByDate(null), {});
  const dir = tmpExtractDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'workouts.csv'),
      'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km\n' +
      '2026-06-01,RunningWorkout,30,,,,,\Watch,5.2\n' +
      '2026-06-01,RunningWorkout,10,,,,,\Watch,1.1\n' +
      '2026-06-01,TraditionalStrengthTraining,60,,,,,\Watch,0\n',
    );
    const out = readRunDistByDate(dir);
    assert.ok(Math.abs(out['2026-06-01'] - 6.3) < 0.001, 'sums both running-workout distances for the day');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readWorkoutLoad returns {date,dur,hrAvg} rows, null when the extract dir is absent', () => {
  assert.equal(readWorkoutLoad(null), null);
  const dir = tmpExtractDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'workouts.csv'),
      'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source\n2026-06-01,Running,30,150,140,90,175,Watch\n',
    );
    const rows = readWorkoutLoad(dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].dur, 30);
    assert.equal(rows[0].hrAvg, 140);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
