/* Unit tests for lib/health/read.mjs — CSV reading helpers, extracted from
 * data/training/generate-health.js (astro-plan-web slice 2). Parameterized
 * by extractDir instead of a closed-over path, so a null/missing dir
 * degrades to the empty state exactly like a fresh clone with no export. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSeries, readTable, readDietary, readRunning, readRunDistByDate, readSleep, readWorkoutLoad, readRides } from './read.mjs';

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

test('readWorkoutLoad also returns type, re, kj; tolerates the old 9-col header and mixed-width files', () => {
  const dir = tmpExtractDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'workouts.csv'),
      [
        'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules',
        '2026-06-01,Running,30,150,140,90,175,Watch,5', // old 9-col row under the new header
        '2026-06-02,Cycling,60,,150,,170,Strava API,20,0,540.5',
        '2026-06-03,Running,20,,,,,Strava API,,87,',
      ].join('\n') + '\n',
    );
    const rows = readWorkoutLoad(dir);
    assert.equal(rows.length, 3);
    assert.deepEqual([rows[0].type, rows[0].re, rows[0].kj], ['Running', null, null], 'absent columns -> null');
    assert.deepEqual([rows[1].re, rows[1].kj], [0, 540.5], 're = 0 is a genuine value');
    assert.deepEqual([rows[2].re, rows[2].kj], [87, null]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readRides sorts rides by date regardless of file order', () => {
  const dir = tmpExtractDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'workouts.csv'),
      [
        'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules,elevation_m',
        '2026-06-05,Cycling,60,,,,,Strava API,20,30,500,100',
        '2026-06-01,Cycling,45,,,,,Watch,15',
        '2026-06-03,Cycling,30,,,,,Watch,10',
      ].join('\n') + '\n',
    );
    assert.deepEqual(readRides(dir).map((r) => r.date), ['2026-06-01', '2026-06-03', '2026-06-05']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readRides returns cycling workouts only, positional up to elevation_m; shorter rows read as null', () => {
  assert.equal(readRides(null), null);
  const dir = tmpExtractDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'workouts.csv'),
      [
        'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules,elevation_m',
        '2026-06-01,Cycling,45.5,,132,,160,Watch,18.2', // 9-col export row
        '2026-06-02,Running,30,,150,,170,Strava API,6,40,,',
        '2026-06-03,Cycling,90,,141,,178,Strava API,40.25,96,1310.4,412.4',
        '2026-06-04,Cycling,60,,,,,Strava API,,12,480,0', // indoor: no GPS, 0 m climbed
      ].join('\n') + '\n',
    );
    const rows = readRides(dir);
    assert.deepEqual(rows.map((r) => r.date), ['2026-06-01', '2026-06-03', '2026-06-04']);
    assert.deepEqual(rows[0], { date: '2026-06-01', dur: 45.5, dist: 18.2, hrAvg: 132, re: null, kj: null, elev: null });
    assert.deepEqual(rows[1], { date: '2026-06-03', dur: 90, dist: 40.25, hrAvg: 141, re: 96, kj: 1310.4, elev: 412.4 });
    assert.deepEqual([rows[2].dist, rows[2].hrAvg, rows[2].elev], [null, null, 0], '0 m is a genuine value');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
