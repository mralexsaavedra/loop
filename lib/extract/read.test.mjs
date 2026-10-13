/* lib/extract/read.mjs: readExtract reads each extract file once (one known exception), keeps the
 * readers' null-when-absent values, and deep-freezes what it returns. Demo extract = synthetic data. */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readExtract, deepFreeze, SERIES_FILES } from './read.mjs';
import { readSeries, readSleep, readWorkoutLoad } from '../health/read.mjs';
import { readHrHourly, readHrHours, readActivities } from '../score/read.mjs';
import { readWorkoutZones } from '../training/read.mjs';
import { readJournal } from '../journal/read.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DEMO = path.join(ROOT, 'data', 'demo', 'extract');

const KEYS = ['activities', 'hrHourly', 'hrHours', 'journal', 'series', 'sleep', 'workoutLoad', 'zones'];
const EMPTY = {
  series: Object.fromEntries(Object.keys(SERIES_FILES).map((k) => [k, null])),
  sleep: null, workoutLoad: null, hrHourly: null, hrHours: null, zones: null, activities: null, journal: [],
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
  for (const [k, f] of Object.entries(SERIES_FILES)) assert.deepEqual(x.series[k], readSeries(DEMO, f), k);
  assert.deepEqual(x.sleep, readSleep(DEMO));
  assert.deepEqual(x.workoutLoad, readWorkoutLoad(DEMO));
  assert.deepEqual(x.hrHourly, readHrHourly(DEMO));
  assert.deepEqual(x.hrHours, readHrHours(DEMO));
  assert.deepEqual(x.zones, readWorkoutZones(DEMO));
  assert.deepEqual(x.activities, readActivities(DEMO));
  assert.deepEqual(x.journal, readJournal(DEMO));
  for (const k of KEYS.filter((k) => k !== 'series')) assert.ok(x[k] && x[k].length > 0, `${k} has demo rows`);
});

test('demo extract: each file is read once (workout-zones.csv twice: two parsers, E2 unifies them)', () => {
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
    'sleep-daily.csv': 1, 'workouts.csv': 1, 'hr-hourly.csv': 1, 'workout-zones.csv': 2, 'journal-daily.csv': 1,
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
