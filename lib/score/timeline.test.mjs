/* Unit tests for lib/score/timeline.mjs — Inicio's "today" timeline (sleep + workouts per day). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { timelineFromInputs, buildTimeline, TIMELINE_DAYS } from './timeline.mjs';
import { buildScores } from './index.mjs';

const w = (date, type, dur, re = null, source = 'Watch') => ({ date, type, dur, hrAvg: null, re, kj: null, source });
const s = (date, value) => ({ date, value });

test('bakes the last TIMELINE_DAYS days ending at the newest data date, oldest first; only dates with something', () => {
  assert.equal(TIMELINE_DAYS, 3);
  const t = timelineFromInputs(
    [w('2026-09-20', 'Running', 40, 50), w('2026-09-27', 'Running', 40, 50), w('2026-09-29', 'Cycling', 60, 70)],
    [s('2026-09-26', 7), s('2026-09-28', 7.2), s('2026-09-29', 6.9)],
  );
  assert.equal(t.asOf, '2026-09-29');
  assert.deepEqual(t.days.map((d) => d.date), ['2026-09-27', '2026-09-28', '2026-09-29']);
  assert.deepEqual(t.days[2], { date: '2026-09-29', sleep: 6.9, items: [{ modality: 'bike', dur: 60, re: 70, sessions: 1 }] });
  assert.deepEqual(t.days[1], { date: '2026-09-28', sleep: 7.2, items: [] });
  assert.equal(t.days[0].sleep, null, 'no sleep that night: null, never 0');
});

test('same-day rows of one modality merge (the Watch fragments a session); stubs are dropped (display rule)', () => {
  const t = timelineFromInputs([
    w('2026-09-29', 'HighIntensityIntervalTraining', 30, null),
    w('2026-09-29', 'TraditionalStrengthTraining', 25, 20),
    w('2026-09-29', 'Running', 2, 1), // stub: an accidental start
    w('2026-09-29', 'Running', 45, 60),
    w('2026-09-29', 'Tennis', 60, null),
  ], null);
  assert.deepEqual(t.days[0].items, [
    { modality: 'gym', dur: 55, re: 20, sessions: 2 },
    { modality: 'run', dur: 45, re: 60, sessions: 1 },
    { modality: 'other', dur: 60, re: null, sessions: 1 },
  ]);
  assert.equal(t.days[0].sleep, null);
});

test('display rule: short unscored sessions the load rule drops as junk are listed (9-min Watch walk, 10-min no-HR Strava ride)', () => {
  const t = timelineFromInputs([
    w('2026-09-29', 'Walking', 9, null, 'Apple Watch'),
    w('2026-09-29', 'Cycling', 10, null, 'Strava API'),
    w('2026-09-29', 'Running', 2, null, 'Apple Watch'),
  ], null);
  assert.deepEqual(t.days[0].items, [
    { modality: 'bike', dur: 10, re: null, sessions: 1 },
    { modality: 'other', dur: 9, re: null, sessions: 1 },
  ]);
});

test('durations are rounded to whole minutes; RE stays null when no fragment carried it', () => {
  const t = timelineFromInputs([w('2026-09-29', 'Cycling', 50.4), w('2026-09-29', 'Cycling', 12.3, null)], null);
  assert.deepEqual(t.days[0].items, [{ modality: 'bike', dur: 63, re: null, sessions: 2 }]);
});

test('no data at all -> a defined empty timeline (no throw)', () => {
  assert.deepEqual(timelineFromInputs(null, null), { asOf: null, days: [] });
  assert.deepEqual(buildTimeline(null), { asOf: null, days: [] });
});

test('buildScores bakes the timeline even without score data (like the monitor)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-'));
  try {
    fs.writeFileSync(path.join(dir, 'workouts.csv'), 'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules,elevation_m\n2026-09-29,Running,40,,150,,170,Strava API,8,57,,\n');
    const scores = buildScores(dir);
    assert.deepEqual(scores.timeline, { asOf: '2026-09-29', days: [{ date: '2026-09-29', sleep: null, items: [{ modality: 'run', dur: 40, re: 57, sessions: 1 }] }] });
    assert.deepEqual(buildScores(null).timeline, { asOf: null, days: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a Watch + Strava pair for one modality on one date is ONE item (Strava, with its RE), not two parts summed', () => {
  const t = timelineFromInputs([w('2026-09-29', 'Running', 46, null, 'Apple Watch'), w('2026-09-29', 'Running', 45, 94, 'Strava API')], []);
  assert.deepEqual(t.days[0].items, [{ modality: 'run', dur: 45, re: 94, sessions: 1 }]);
});

test('the night\'s bedtime / wake time ride along when the sleep row has them (decimal hours, 2 dp), absent otherwise', () => {
  const t = timelineFromInputs([], [{ date: '2026-09-29', value: 7.1, bedtime: 23.1166, waketime: 6.9 }, { date: '2026-09-28', value: 7 }]);
  const [d28, d29] = t.days;
  assert.equal(d29.bed, 23.12);
  assert.equal(d29.wake, 6.9);
  assert.equal('bed' in d28, false);
  assert.equal('wake' in d28, false);
});
