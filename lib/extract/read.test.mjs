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
import { monitorFrom } from '../score/monitor.mjs';
import { sleepScoreFrom } from '../score/sleep.mjs';
import { detailFrom } from '../detail/detail.mjs';

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

/* ---------- file round trips: CSV on disk -> readExtract -> the pure consumer ----------
 * The consumers' own tests feed readExtract-shaped rows; these tie the real column layout of each CSV
 * (docs/data-pipeline.md) to what the scorers read, so a renamed or shifted column fails here. */

// Write the given {file: content} map into a fresh temp extract dir, run fn(dir), then clean up.
function withExtract(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-rt-'));
  try {
    for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body);
    return fn(dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const wig = (i) => ((i * 7) % 5) - 2; // -2..2, deterministic
const SLEEP_HEADER = 'date,asleep_hours,source,bedtime,waketime,rem_h,deep_h,core_h,unspec_h,awake_h,inbed_h';

test('round trip: respiratory-daily.csv (date,brpm) -> series.respiratory -> monitorFrom scores the respiratory card', () => {
  const ds = Array.from({ length: 20 }, (_, i) => addDays('2026-09-29', i - 19));
  const csv = 'date,brpm\n' + ds.map((d, i) => `${d},${(14 + wig(i) * 0.1).toFixed(1)}`).join('\n') + '\n';
  withExtract({ 'respiratory-daily.csv': csv }, (dir) => {
    const x = readExtract(dir);
    const rows = x.series.respiratory;
    assert.equal(rows.length, 20);
    assert.deepEqual(rows[rows.length - 1], { date: '2026-09-29', value: 14.1, source: '' }, 'brpm is the value column');
    const card = monitorFrom(x).cards[0];
    assert.equal(card.key, 'respiratory');
    assert.equal(card.state, 'ok');
    assert.equal(card.value, 14.1);
    assert.equal(card.date, '2026-09-29');
    assert.equal(card.n, 19, 'baseline = the 19 nights before the newest');
    assert.equal(card.status, 'normal');
    assert.deepEqual(card.band, { lo: 13.4, median: 14, hi: 14.6 });
  });
});

test('round trip: the 11-column sleep-daily.csv -> sleep stage fields -> sleepScoreFrom perf and efficiency', () => {
  // 6.00 h asleep of 6.50 h in bed: perf = 6 / 7.5 (SLEEP_TARGET) = 80 %, efficiency = 6 / 6.5 = 92 %
  const csv = `${SLEEP_HEADER}\n2026-09-21,6.00,Watch,0,6.5,1.20,0.90,3.90,0.00,0.50,6.50\n`;
  withExtract({ 'sleep-daily.csv': csv }, (dir) => {
    const x = readExtract(dir);
    assert.deepEqual(x.sleep, [{ date: '2026-09-21', value: 6, bedtime: 0, waketime: 6.5, rem: 1.2, deep: 0.9, core: 3.9, unspec: 0, awake: 0.5, inbed: 6.5 }]);
    const s = sleepScoreFrom(x);
    assert.equal(s.need, 7.5);
    assert.equal(s.last.perf, 80);
    assert.equal(s.last.eff, 92);
  });
});

test('round trip: old five-column sleep-daily.csv -> stage fields null -> detailFrom drops the stage arrays', () => {
  const STAGES = ['rem', 'deep', 'core', 'unspec', 'awake', 'inbed'];
  // a file that is wholly the old layout: no night has stages, so the sheet leaves the arrays out
  withExtract({ 'sleep-daily.csv': 'date,asleep_hours,source,bedtime,waketime\n2026-09-28,7.25,Watch,23.5,7\n' }, (dir) => {
    const x = readExtract(dir);
    assert.equal(x.sleep.length, 1);
    for (const k of STAGES) assert.equal(x.sleep[0][k], null, k);
    assert.deepEqual([x.sleep[0].value, x.sleep[0].bedtime, x.sleep[0].waketime], [7.25, 23.5, 7]);
    const sl = detailFrom(x, { sex: null }).metrics.sleep;
    for (const k of ['rem', 'deep', 'core', 'awake', 'inbed', 'eff']) assert.equal(k in sl, false, k);
    assert.deepEqual(sl.perf, [97]);
  });
  // an old five-cell night under the new header, then a staged night: nulls where unknown
  const mixed = `${SLEEP_HEADER}\n2026-09-28,7.25,Watch,23.5,7\n2026-09-29,6.5,Watch,0.25,6.75,1.40,0.90,4.20,0.00,0.25,6.80\n`;
  withExtract({ 'sleep-daily.csv': mixed }, (dir) => {
    const x = readExtract(dir);
    for (const k of STAGES) assert.equal(x.sleep[0][k], null, k);
    const sl = detailFrom(x, { sex: null }).metrics.sleep;
    assert.deepEqual(sl.v, [7.25, 6.5]);
    assert.deepEqual(sl.bed, [23.5, 0.25]);
    assert.deepEqual([sl.rem, sl.deep, sl.core, sl.awake, sl.inbed], [[null, 1.4], [null, 0.9], [null, 4.2], [null, 0.25], [null, 6.8]]);
    assert.deepEqual(sl.perf, [97, 87]);
    assert.deepEqual(sl.eff, [null, 96], 'efficiency only where in bed is known');
    assert.deepEqual(sl.cons, [0, 30]);
  });
});
