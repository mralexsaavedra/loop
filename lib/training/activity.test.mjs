/* Unit tests for lib/training/activity.mjs — Entreno's 30-day calendar + cumulative training time. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activityFromRows, activityBake, buildActivity, BAKE_DAYS, WINDOW_DAYS, LEVEL_MIN } from './activity.mjs';

const r = (date, type, dur, re = null, source = 'Watch') => ({ date, type, dur, hrAvg: null, hrMax: null, re, source });

test('activityBake adds the client constants (window, level cuts) so the page never hard-codes them', () => {
  assert.deepEqual(LEVEL_MIN, [1, 30, 60, 90]);
  assert.deepEqual(activityBake({ hasData: false }), { hasData: false, windowDays: WINDOW_DAYS, levelMin: LEVEL_MIN });
});

test('windows: 30-day view, 63 baked days (two windows + the 3-day viewer slack)', () => {
  assert.equal(WINDOW_DAYS, 30);
  assert.equal(BAKE_DAYS, 63);
});

test('one entry per DISTINCT day (the Watch fragments a session): minutes summed, split by dashboard modality, dominant = most minutes', () => {
  const a = activityFromRows([
    r('2026-09-29', 'HighIntensityIntervalTraining', 30),
    r('2026-09-29', 'HighIntensityIntervalTraining', 15.4),
    r('2026-09-29', 'Running', 20),
    r('2026-09-27', 'Cycling', 90),
  ]);
  assert.equal(a.hasData, true);
  assert.equal(a.asOf, '2026-09-29');
  assert.deepEqual(a.days, [
    { date: '2026-09-27', min: 90, top: 'bike', mods: { bike: 90 } },
    { date: '2026-09-29', min: 65, top: 'hiit', mods: { hiit: 45, run: 20 } },
  ]);
});

test('only the last BAKE_DAYS days ending at the newest workout are baked (no build-time now)', () => {
  const a = activityFromRows([r('2026-01-01', 'Running', 30), r('2026-07-29', 'Running', 30), r('2026-07-28', 'Running', 30), r('2026-09-29', 'Running', 30)]);
  assert.deepEqual(a.days.map((d) => d.date), ['2026-07-29', '2026-09-29'], '2026-07-29 = asOf - 62');
});

test('zero-duration rows add nothing; no rows -> empty state', () => {
  assert.deepEqual(activityFromRows([r('2026-09-29', 'Running', 0)]), { hasData: false });
  assert.deepEqual(activityFromRows(null), { hasData: false });
  assert.deepEqual(buildActivity(null), { hasData: false });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-'));
  try {
    assert.deepEqual(buildActivity(dir), { hasData: false }, 'absent workouts.csv');
    fs.writeFileSync(path.join(dir, 'workouts.csv'), 'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source\n2026-09-29,Running,40,,,,,Watch\n');
    assert.deepEqual(buildActivity(dir).days, [{ date: '2026-09-29', min: 40, top: 'run', mods: { run: 40 } }]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the ONE same-day rule (lib/training/sessions.mjs): a 2-min Watch stub does not colour a rest day; a Watch+Strava pair counts once (Strava)', () => {
  const a = activityFromRows([
    r('2026-09-28', 'HighIntensityIntervalTraining', 2), // accidental start/stop
    r('2026-09-29', 'Cycling', 62, null, 'Apple Watch'),
    r('2026-09-29', 'Cycling', 60, 45, 'Strava API'),
  ]);
  assert.deepEqual(a.days, [{ date: '2026-09-29', min: 60, top: 'bike', mods: { bike: 60 } }]);
  assert.deepEqual(activityFromRows([r('2026-09-28', 'Running', 3)]), { hasData: false }, 'junk only = no activity');
});
