/* lib/training/read.mjs — the workout-zones.csv reader against temp-dir extracts, and Entreno's DASH +
 * ACTIVITY over readExtract-shaped workouts.csv rows (no files). The aggregation itself is tested purely
 * in dashboard.test.mjs / activity.test.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWorkoutZones, ZONES_CSV, ZONES_HEADER, readWorkoutPlans, WORKOUT_PLANS_CSV, WORKOUT_PLANS_HEADER } from './read.mjs';
import { readExtract } from '../extract/read.mjs';
import { dashboardFrom, trainingRowsFromCells } from './dashboard.mjs';
import { activityFrom } from './activity.mjs';


/** @template T @param {Record<string, string>} files @param {(dir: string) => T} fn @returns {T} */
function withDir(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'training-read-'));
  try {
    for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), t);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// the readExtract trainingRows of a workouts.csv holding these data lines (header dropped, like readWorkoutCells)
/** @param {...string} lines */
const trainingRows = (...lines) => trainingRowsFromCells(lines.map((l) => l.split(',')));

test('dashboardFrom: an empty state without workouts.csv (readExtract(null) included); aggregates its rows', () => {
  assert.deepEqual(dashboardFrom(readExtract(null)), { hasData: false }, 'null extractDir must also degrade, not throw');
  const dash = dashboardFrom({ trainingRows: trainingRows('2026-06-24,Running,30,,,,,Watch') });
  assert.equal(dash.hasData, true);
  assert.equal(dash.asOf, '2026-06-24');
});

test('activityFrom: no workouts.csv -> empty state; its rows -> the calendar days', () => {
  assert.deepEqual(activityFrom(readExtract(null)), { hasData: false });
  const a = activityFrom({ trainingRows: trainingRows('2026-09-29,Running,40,,,,,Watch') });
  assert.deepEqual(a.days, [{ date: '2026-09-29', min: 40, top: 'run', mods: { run: 40 } }]);
});

test('readWorkoutZones: back-compat — no extract dir or no file -> null (no zones on the page)', () => {
  assert.equal(readWorkoutZones(null), null);
  assert.equal(withDir({}, readWorkoutZones), null);
  assert.equal(withDir({ [ZONES_CSV]: ZONES_HEADER + '\n' }, readWorkoutZones), null);
});

test('readWorkoutZones: parses rows, sorted by date; a malformed row is dropped', () => {
  const text = [ZONES_HEADER,
    '2026-09-29,31,Running,190,observed,150,,0,0,0,1200,0,600,Strava API',
    '2026-09-28,30,Cycling,190,profile,140,170,10,20,30,40,50,60,Strava API',
    'bad,1,Running,190,observed,,,0,0,0,0,0,0,x',
    '2026-09-27,2,Running,190,observed,,,0,0,,0,0,0,x'].join('\n') + '\n';
  const rows = withDir({ [ZONES_CSV]: text }, readWorkoutZones);
  assert.deepEqual(rows, [
    { date: '2026-09-28', id: '30', type: 'Cycling', maxHr: 190, maxSrc: 'profile', hrAvg: 140, hrMax: 170, z: [10, 20, 30, 40, 50, 60] },
    { date: '2026-09-29', id: '31', type: 'Running', maxHr: 190, maxSrc: 'observed', hrAvg: 150, hrMax: null, z: [0, 0, 0, 1200, 0, 600] },
  ]);
});

/* ---------- workout-plans.csv (data/apple-health/sync-garmin.mjs): the planned Garmin workout of an activity ---------- */

const STEPS = [
  { i: 1, intensity: 'WARMUP', dur_type: 'TIME', dur: 600, target: 'NO_TARGET', low: null, high: null, value: null },
  { i: 2, intensity: 'ACTIVE', dur_type: 'TIME', dur: 4200, target: 'POWER_3S', low: 125, high: 135, value: null },
];
/** @param {unknown} v */
const quoted = (v) => '"' + JSON.stringify(v).replace(/"/g, '""') + '"';

test('readWorkoutPlans: no extract dir, no file or a header-only file -> null (no plan on the page)', () => {
  assert.equal(WORKOUT_PLANS_CSV, 'workout-plans.csv');
  assert.equal(WORKOUT_PLANS_HEADER, 'date,start,type,duration_s,avg_power,norm_power,avg_hr,plan');
  assert.equal(readWorkoutPlans(null), null);
  assert.equal(withDir({}, readWorkoutPlans), null);
  assert.equal(withDir({ [WORKOUT_PLANS_CSV]: WORKOUT_PLANS_HEADER + '\n' }, readWorkoutPlans), null);
});

test('readWorkoutPlans: parses rows (the CSV-quoted steps JSON included), sorted by date; a malformed row is dropped', () => {
  const text = [WORKOUT_PLANS_HEADER,
    `2026-09-29,2026-09-29T18:00:00+02:00,Running,1800,,,151,${quoted([STEPS[0]])}`,
    `2026-09-28,2026-09-28T07:30:00+02:00,IndoorCycling,3600.4,118,121.6,132,${quoted(STEPS)}`,
    `bad,,Running,1800,,,,${quoted(STEPS)}`,
    '2026-09-27,,Running,1800,,,,"not json"',
    `2026-09-26,,Running,1800,,,,${quoted({ steps: STEPS })}`].join('\n') + '\n';
  const rows = withDir({ [WORKOUT_PLANS_CSV]: text }, readWorkoutPlans);
  assert.deepEqual(rows, [
    { date: '2026-09-28', start: '2026-09-28T07:30:00+02:00', type: 'IndoorCycling', dur: 3600.4, w: 118, np: 121.6, hr: 132, steps: STEPS },
    { date: '2026-09-29', start: '2026-09-29T18:00:00+02:00', type: 'Running', dur: 1800, w: null, np: null, hr: 151, steps: [STEPS[0]] },
  ]);
});
