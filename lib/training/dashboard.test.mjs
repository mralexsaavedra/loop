/* Unit tests for lib/training/dashboard.mjs — pure executed-workout
 * aggregation, extracted from data/training/generate-training.js
 * (astro-plan-web migration, slice 2). Ported from the equivalent assertions
 * in data/training/generate-training.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseWorkouts, aggregateDashboard, modalityGroup, weekStart, loadDashboard, dashboardBlock } from './dashboard.mjs';

test('modalityGroup maps Apple types to strength / hiit / run / bike / other', () => {
  assert.equal(modalityGroup('Running'), 'run');
  assert.equal(modalityGroup('TraditionalStrengthTraining'), 'strength');
  assert.equal(modalityGroup('HighIntensityIntervalTraining'), 'hiit');
  assert.equal(modalityGroup('Walking'), 'other');
  assert.equal(modalityGroup('SomeUnknownGymThing'), 'hiit', 'unrecognized gym-ish type falls back to hiit');
});

test('modalityGroup groups Cycling into bike, not other', () => {
  assert.equal(modalityGroup('Cycling'), 'bike');
});

test('weekStart returns the Monday of the week', () => {
  assert.equal(weekStart('2026-06-24'), '2026-06-22'); // Wed -> Mon
  assert.equal(weekStart('2026-06-22'), '2026-06-22'); // Mon -> itself
});

test('parseWorkouts captures per-workout HR (avg/max), null when blank', () => {
  const rows = parseWorkouts(
    'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source\n' +
    '2026-06-24,HighIntensityIntervalTraining,20,150,135,90,178,Apple Watch\n' +
    '2026-06-23,TraditionalStrengthTraining,60,300,,,,Strava\n',
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].hrAvg, 135);
  assert.equal(rows[1].hrAvg, null, 'blank HR -> null, never 0');
});

test('aggregateDashboard counts DISTINCT days and groups minutes by modality', () => {
  const d = aggregateDashboard([
    { date: '2026-06-24', type: 'TraditionalStrengthTraining', dur: 60 },
    { date: '2026-06-24', type: 'HighIntensityIntervalTraining', dur: 20 }, // same day = fragmented session
    { date: '2026-06-22', type: 'Running', dur: 30 },
  ]);
  assert.equal(d.hasData, true);
  assert.equal(d.weeklyMin.length, 12, 'always 12 weekly slots');
  assert.equal(d.recent.sessions, 2, 'distinct days, not raw rows');
});

test('aggregateDashboard degrades gracefully with no rows', () => {
  assert.deepEqual(aggregateDashboard([]), { hasData: false });
});

test('aggregateDashboard groups Cycling minutes + HR into the bike bucket', () => {
  const d = aggregateDashboard([
    { date: '2026-06-24', type: 'Cycling', dur: 45, hrAvg: 140, hrMax: 160 },
    { date: '2026-06-22', type: 'Running', dur: 30 },
  ]);
  const bike = d.modality.find((m) => m.key === 'bike');
  assert.ok(bike, 'bike modality must be present when a Cycling row exists');
  assert.equal(bike.min, 45);
  assert.equal(bike.avgHr, 140);
  const other = d.modality.find((m) => m.key === 'other');
  assert.equal(other, undefined, 'Cycling minutes must not also land in other');
});

test('loadDashboard returns an empty state when the extract dir has no workouts.csv', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-empty-'));
  try {
    assert.deepEqual(loadDashboard(dir), { hasData: false });
    assert.deepEqual(loadDashboard(null), { hasData: false }, 'null extractDir must also degrade, not throw');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadDashboard reads and aggregates workouts.csv from a real extract dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-real-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'workouts.csv'),
      'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source\n2026-06-24,Running,30,,,,,Watch\n',
    );
    const dash = loadDashboard(dir);
    assert.equal(dash.hasData, true);
    assert.equal(dash.asOf, '2026-06-24');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dashboardBlock emits a valid JS DASH object regardless of extractDir presence', () => {
  const block = dashboardBlock(null);
  assert.match(block, /var DASH = /);
  assert.doesNotThrow(() => new Function(block + '\nreturn DASH;'));
});
