/* Unit tests for lib/health/read.mjs — CSV reading helpers, extracted from
 * data/training/generate-health.js (astro-plan-web slice 2). Parameterized
 * by extractDir instead of a closed-over path, so a null/missing dir
 * degrades to the empty state exactly like a fresh clone with no export. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSeries, readTable, readDietary, readRunning, readRuns, readSleep, readWorkoutLoad, readRides, readWorkouts, readActiveEnergy } from './read.mjs';
import { correctActiveEnergy, RIDES_HEADER, HOURLY_HEADER } from './ride-energy.mjs';

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

test('readSleep reads the stage columns; older five-column rows load with null stages', () => {
  const dir = tmpExtractDir();
  try {
    fs.writeFileSync(path.join(dir, 'sleep-daily.csv'), [
      'date,asleep_hours,source,bedtime,waketime,rem_h,deep_h,core_h,unspec_h,awake_h,inbed_h',
      '2026-09-28,7.25,Watch,23.5,7', // written before the stage columns existed
      '2026-09-29,7.00,Shortcut,23,6.5,1.50,1.00,4.50,0.00,0.40,7.50',
      '2026-09-30,6.00,Zepp,0,6.5,,,,6.00,,6.50', // unstaged
    ].join('\n') + '\n');
    const rows = readSleep(dir);
    assert.deepEqual(rows[0], { date: '2026-09-28', value: 7.25, bedtime: 23.5, waketime: 7, rem: null, deep: null, core: null, unspec: null, awake: null, inbed: null });
    assert.deepEqual(rows[1], { date: '2026-09-29', value: 7, bedtime: 23, waketime: 6.5, rem: 1.5, deep: 1, core: 4.5, unspec: 0, awake: 0.4, inbed: 7.5 });
    assert.equal(rows[2].rem, null);
    assert.equal(rows[2].inbed, 6.5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readRuns returns Running workouts (Watch + Strava), same shape as readRides, sorted; null when absent', () => {
  assert.equal(readRuns(null), null);
  const dir = tmpExtractDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'workouts.csv'),
      [
        'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules,elevation_m',
        '2026-06-03,Running,40.5,,152,,171,Strava API,7.7,57,468.8,35.2',
        '2026-06-01,Running,30,,,,,Watch,5.2', // 9-col export row
        '2026-06-02,Cycling,60,,,,,Strava API,20,30,500,100',
        '2026-06-02,TraditionalStrengthTraining,60,,,,,Watch',
      ].join('\n') + '\n',
    );
    const rows = readRuns(dir);
    assert.deepEqual(rows.map((r) => r.date), ['2026-06-01', '2026-06-03']);
    assert.deepEqual(rows[0], { date: '2026-06-01', dur: 30, dist: 5.2, hrAvg: null, re: null, kj: null, elev: null, source: 'Watch' });
    assert.deepEqual(rows[1], { date: '2026-06-03', dur: 40.5, dist: 7.7, hrAvg: 152, re: 57, kj: 468.8, elev: 35.2, source: 'Strava API' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readWorkouts returns EVERY workout row with its type (same fields as readRides + type), sorted; null when absent', () => {
  assert.equal(readWorkouts(null), null);
  const dir = tmpExtractDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'workouts.csv'),
      [
        'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules,elevation_m',
        '2026-06-03,Running,40.5,,152,,171,Strava API,7.7,57,468.8,35.2',
        '2026-06-01,Walking,30,,,,,Watch,2.1', // 9-col export row
        'bad,Running,1,,,,,Watch',
      ].join('\n') + '\n',
    );
    const rows = readWorkouts(dir);
    assert.deepEqual(rows, [
      { date: '2026-06-01', type: 'Walking', dur: 30, dist: 2.1, hrAvg: null, re: null, kj: null, elev: null, source: 'Watch' },
      { date: '2026-06-03', type: 'Running', dur: 40.5, dist: 7.7, hrAvg: 152, re: 57, kj: 468.8, elev: 35.2, source: 'Strava API' },
    ]);
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
    assert.deepEqual(rows.map((r) => r.source), ['Watch', 'Strava API', 'Strava API'], 'source column (the one-source same-day rule reads it)');
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
    assert.deepEqual(rows[0], { date: '2026-06-01', dur: 45.5, dist: 18.2, hrAvg: 132, re: null, kj: null, elev: null, source: 'Watch' });
    assert.deepEqual(rows[1], { date: '2026-06-03', dur: 90, dist: 40.25, hrAvg: 141, re: 96, kj: 1310.4, elev: 412.4, source: 'Strava API' });
    assert.deepEqual([rows[2].dist, rows[2].hrAvg, rows[2].elev], [null, null, 0], '0 m is a genuine value');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// readActiveEnergy: a synthetic power-meter ride day (5 h 47 min from 09:02, Watch on the wrist)
const DAY = '2026-09-26';
const RIDE = { start: `${DAY}T09:02:00+02:00`, elapsedS: 20811, kj: 2310.7, deviceWatts: true };
const HOURLY = Object.entries({ '08': 40, '09': 300, 10: 330, 11: 330, 12: 330, 13: 330, 14: 201, 15: 60 })
  .map(([h, kcal]) => ({ start: `${DAY}T${h}:00:00+02:00`, kcal }));

test('readActiveEnergy reads the three CSVs; missing hourly / rides files -> the watch values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'active-energy-'));
  try {
    assert.equal(readActiveEnergy(null), null);
    assert.equal(readActiveEnergy(dir), null);
    fs.writeFileSync(path.join(dir, 'active-energy-daily.csv'), `date,kcal\n${DAY},2207\n`);
    assert.deepEqual(readActiveEnergy(dir), [{ date: DAY, value: 2207, source: '' }]);
    fs.writeFileSync(path.join(dir, 'active-energy-hourly.csv'),
      [HOURLY_HEADER, ...HOURLY.map((h) => `${h.start.slice(0, 10)},${h.start},${h.kcal},Shortcut`), ''].join('\n'));
    fs.writeFileSync(path.join(dir, 'rides.csv'),
      [RIDES_HEADER, `${DAY},${RIDE.start},${RIDE.elapsedS},${RIDE.kj},true,Strava API`, ''].join('\n'));
    const [r] = readActiveEnergy(dir);
    assert.equal(r.watch, 2207);
    assert.equal(r.value, correctActiveEnergy([{ date: DAY, value: 2207 }], HOURLY, [RIDE])[0].value);
    // device_watts blank (an old ingest image) -> no correction
    fs.writeFileSync(path.join(dir, 'rides.csv'), [RIDES_HEADER, `${DAY},${RIDE.start},${RIDE.elapsedS},${RIDE.kj},,Strava API`, ''].join('\n'));
    assert.equal(readActiveEnergy(dir)[0].value, 2207);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
