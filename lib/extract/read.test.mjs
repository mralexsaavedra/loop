/* lib/extract/read.mjs: readExtract reads each extract file once, keeps the
 * readers' null-when-absent values, and deep-freezes what it returns. Demo extract = synthetic data. */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readExtract, deepFreeze, SERIES_FILES } from './read.mjs';
import {
  readSeries, readSleep, readWorkoutLoad, readActiveEnergy, readDietary, readRunning, readWorkouts, readRides, readRuns,
} from '../health/read.mjs';
import { readHrHourly, readHrHours, readActivities } from '../score/read.mjs';
import { readWorkoutZones, readTrainingRows } from '../training/read.mjs';
import { readJournal } from '../journal/read.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DEMO = path.join(ROOT, 'data', 'demo', 'extract');

// key -> its per-directory area reader (the inputs must equal what that reader returns)
const READ = {
  sleep: readSleep, activeEnergy: readActiveEnergy, dietary: readDietary, running: readRunning,
  workoutLoad: readWorkoutLoad, workouts: readWorkouts, rides: readRides, runs: readRuns, trainingRows: readTrainingRows,
  hrHourly: readHrHourly, hrHours: readHrHours, zones: readWorkoutZones, activities: readActivities, journal: readJournal,
};
const KEYS = ['series', ...Object.keys(READ)].sort();
const EMPTY = {
  series: Object.fromEntries(Object.keys(SERIES_FILES).map((k) => [k, null])),
  ...Object.fromEntries(Object.keys(READ).map((k) => [k, null])), journal: [],
};

test('readExtract(null) and an empty dir give the all-null shape (journal [], the reader\'s empty)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-empty-'));
  try {
    for (const d of [null, undefined, dir, path.join(dir, 'missing')]) assert.deepEqual(readExtract(d), EMPTY, String(d));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('demo extract: every key equals its area reader (no parsing of its own)', () => {
  const x = readExtract(DEMO);
  assert.deepEqual(Object.keys(x).sort(), KEYS);
  for (const [k, f] of Object.entries(SERIES_FILES)) {
    assert.deepEqual(x.series[k], readSeries(DEMO, f), k);
    assert.ok(x.series[k] && x.series[k].length > 0, `series.${k} has demo rows`);
  }
  for (const [k, read] of Object.entries(READ)) {
    assert.deepEqual(x[k], read(DEMO), k);
    assert.ok(x[k] && x[k].length > 0, `${k} has demo rows`);
  }
});

test('a workouts.csv with no valid rows: the session projections are null, the training rows []', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-hdr-'));
  try {
    fs.writeFileSync(path.join(dir, 'workouts.csv'), 'date,type,duration_min\n');
    const x = readExtract(dir);
    for (const k of ['workoutLoad', 'workouts', 'rides', 'runs']) assert.equal(x[k], null, k);
    assert.deepEqual(x.trainingRows, []);
    assert.deepEqual(x.trainingRows, readTrainingRows(dir));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('demo extract: each file is read once (workouts.csv, hr-hourly.csv, workout-zones.csv: one read, several projections)', () => {
  const counts = {};
  const original = fs.readFileSync;
  const spy = mock.method(fs, 'readFileSync', function (p, ...rest) {
    const b = path.basename(String(p));
    counts[b] = (counts[b] || 0) + 1;
    return original.call(this, p, ...rest);
  });
  try { readExtract(DEMO); } finally { spy.mock.restore(); }
  const expected = {
    ...Object.fromEntries(Object.values(SERIES_FILES).map((f) => [f, 1])),
    'sleep-daily.csv': 1, 'workouts.csv': 1, 'hr-hourly.csv': 1, 'workout-zones.csv': 1, 'journal-daily.csv': 1,
    'active-energy-daily.csv': 1, 'dietary-daily.csv': 1, 'running-daily.csv': 1,
  };
  assert.deepEqual(counts, expected);
});

test('the inputs are deep-frozen: an in-place sort or assignment by a core throws', () => {
  const x = readExtract(DEMO);
  assert.ok(Object.isFrozen(x) && Object.isFrozen(x.series) && Object.isFrozen(x.sleep) && Object.isFrozen(x.sleep[0]));
  assert.ok(Object.isFrozen(x.hrHourly[0].hist), 'the histogram Map object is frozen too');
  assert.throws(() => x.sleep.sort(), TypeError);
  assert.throws(() => { x.series.hrv[0].value = 0; }, TypeError);
  assert.throws(() => { x.extra = 1; }, TypeError);
  assert.ok(Object.isFrozen(readExtract(null)));
});

test('deepFreeze walks arrays, objects and Map values; primitives pass through', () => {
  const inner = { a: 1 };
  const v = deepFreeze({ list: [{ b: 2 }], m: new Map([[1, inner]]) });
  assert.ok(Object.isFrozen(v.list[0]) && Object.isFrozen(v.m) && Object.isFrozen(inner));
  assert.equal(deepFreeze(3), 3);
  assert.equal(deepFreeze(null), null);
});
