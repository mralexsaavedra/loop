/* Unit tests for lib/training/dashboard.mjs — pure executed-workout
 * aggregation, extracted from data/training/generate-training.js
 * (astro-plan-web migration, slice 2). Ported from the equivalent assertions
 * in data/training/generate-training.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activityFromRows } from './activity.mjs';
import { parseWorkouts, aggregateDashboard, modalityGroup, weekStart, loadDashboard, dashboardBlock } from './dashboard.mjs';

test('modalityGroup maps Apple types to strength / hiit / run / bike / other', () => {
  assert.equal(modalityGroup('Running'), 'run');
  assert.equal(modalityGroup('TraditionalStrengthTraining'), 'strength');
  assert.equal(modalityGroup('HighIntensityIntervalTraining'), 'hiit');
  assert.equal(modalityGroup('Walking'), 'other');
  assert.equal(modalityGroup('Tennis'), 'other', 'an unknown type is "other", like Inicio (never counted as Gym)');
  assert.equal(modalityGroup('SomeUnknownThing'), 'other');
  assert.equal(modalityGroup('Other'), 'hiit', 'the exact Watch/Strava "Other" label stays with gym work, like Inicio');
  assert.equal(modalityGroup('OtherSport'), 'other', '"Other" must match exactly');
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
  assert.deepEqual([rows[0].source, rows[1].source, rows[0].re], ['Apple Watch', 'Strava', null], 'source + RE for the one-source same-day rule');
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

test('aggregateDashboard follows the same-day DISPLAY rule, so it agrees with the calendar on active days and minutes', () => {
  const w = (date, type, dur, re = null, source = 'Apple Watch') => ({ date, type, dur, hrAvg: null, hrMax: null, re, source });
  const rows = [
    w('2026-09-29', 'Cycling', 62), // Watch copy of the Strava ride below
    w('2026-09-29', 'Cycling', 60, 45, 'Strava API'),
    w('2026-09-28', 'HighIntensityIntervalTraining', 2), // accidental start: no active day
    w('2026-09-27', 'Walking', 9), // short unscored walk: kept
    w('2026-09-25', 'Running', 40),
  ];
  const d = aggregateDashboard(rows);
  const a = activityFromRows(rows);
  assert.equal(d.recent.sessions, a.days.length, 'same active days');
  assert.equal(d.recent.sessions, 3);
  assert.equal(d.recent.minPerWeek, Math.round(a.days.reduce((s, x) => s + x.min, 0) / 4), 'same minutes');
  assert.equal(d.weeklyMin.reduce((s, x) => s + x.min, 0), 109, 'the Watch copy and the stub are not counted');
  assert.equal(d.modality.find((m) => m.key === 'bike').min, 60);
  assert.equal(d.intensity.total, 3, 'surviving rows');
});

test('aggregateDashboard: stub-only data is an empty state', () => {
  assert.deepEqual(aggregateDashboard([{ date: '2026-09-28', type: 'Running', dur: 1 }]), { hasData: false });
});

test('Strava rows kept next to the Watch copy count once: dedupe runs on the physical modality (Inicio buckets)', () => {
  const w = (date, type, dur, re = null, source = 'Apple Watch') => ({ date, type, dur, hrAvg: null, hrMax: null, re, source });
  const rows = [
    // same gym session: the Watch labels it HIIT, Strava (WeightTraining) strength -> Strava only
    w('2026-09-29', 'HighIntensityIntervalTraining', 52),
    w('2026-09-29', 'TraditionalStrengthTraining', 50, 60, 'Strava API'),
    // different modalities on one day: both count
    w('2026-09-28', 'Running', 30),
    w('2026-09-28', 'Cycling', 45, 30, 'Strava API'),
  ];
  const d = aggregateDashboard(rows);
  assert.equal(d.weeklyMin.reduce((s, x) => s + x.min, 0), 125, 'the Watch copy of the gym session is not counted');
  assert.deepEqual(d.modality.map((m) => [m.key, m.min]).sort(), [['bike', 45], ['run', 30], ['strength', 50]]);
  const a = activityFromRows(rows);
  assert.deepEqual(a.days.map((x) => [x.date, x.min]), [['2026-09-28', 75], ['2026-09-29', 50]]);
  assert.deepEqual(a.days[1].mods, { strength: 50 });
});
