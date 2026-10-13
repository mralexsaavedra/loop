/* lib/training/read.mjs — the workout-zones.csv reader against temp-dir extracts, and Entreno's DASH +
 * ACTIVITY over readExtract-shaped workouts.csv rows (no files). The aggregation itself is tested purely
 * in dashboard.test.mjs / activity.test.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWorkoutZones, ZONES_CSV, ZONES_HEADER } from './read.mjs';
import { readExtract } from '../extract/read.mjs';
import { dashboardFrom, trainingRowsFromCells } from './dashboard.mjs';
import { activityFrom } from './activity.mjs';


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
