/* Unit tests for lib/training/activity.mjs — Entreno's 30-day calendar + cumulative training time. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityFromRows, activityBake, BAKE_DAYS, WINDOW_DAYS, PERIODS, LEVEL_MIN } from './activity.mjs';

const r = (date, type, dur, re = null, source = 'Watch') => ({ date, type, dur, hrAvg: null, hrMax: null, re, source });

test('activityBake adds the client constants (window, level cuts) so the page never hard-codes them', () => {
  assert.deepEqual(LEVEL_MIN, [1, 30, 60, 90]);
  assert.deepEqual(activityBake({ hasData: false }), { hasData: false, windowDays: WINDOW_DAYS, periods: [7, 30, 182], bakeDays: BAKE_DAYS, levelMin: LEVEL_MIN });
});

test('windows: 30-day calendar, W / M / 6M = 7 / 30 / 182 days, 367 baked days (6M twice + the 3-day viewer slack)', () => {
  assert.equal(WINDOW_DAYS, 30);
  assert.deepEqual([...PERIODS], [7, 30, 182]);
  assert.equal(BAKE_DAYS, 367);
});

test('first = the first session ever, even when it is older than the baked days', () => {
  const a = activityFromRows([r('2025-01-01', 'Running', 30), r('2026-09-29', 'Running', 30)]);
  assert.equal(a.first, '2025-01-01');
  assert.deepEqual(a.days.map((d) => d.date), ['2026-09-29']);
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

test('activityFromRows(rows, {through}): asOf runs on through the rest days (never back before the last session)', () => {
  const rows = [r('2026-10-08', 'Running', 30)];
  assert.equal(activityFromRows(rows, { through: '2026-10-13' }).asOf, '2026-10-13');
  assert.equal(activityFromRows(rows, { through: '2026-10-01' }).asOf, '2026-10-08');
  assert.deepEqual(activityFromRows(rows, { through: '2026-10-13' }).days.map((d) => d.date), ['2026-10-08'], 'rest days add no rows');
});

test('only the last BAKE_DAYS days ending at the newest workout are baked (no build-time now)', () => {
  const a = activityFromRows([r('2025-01-01', 'Running', 30), r('2025-09-28', 'Running', 30), r('2025-09-27', 'Running', 30), r('2026-09-29', 'Running', 30)]);
  assert.deepEqual(a.days.map((d) => d.date), ['2025-09-28', '2026-09-29'], '2025-09-28 = asOf - 366');
});

test('zero-duration rows add nothing; no rows -> empty state', () => {
  assert.deepEqual(activityFromRows([r('2026-09-29', 'Running', 0)]), { hasData: false });
  assert.deepEqual(activityFromRows(null), { hasData: false });
});

test('the ONE same-day rule (lib/training/sessions.mjs): a 2-min Watch stub does not colour a rest day; a Watch+Strava pair counts once (Strava)', () => {
  const a = activityFromRows([
    r('2026-09-28', 'HighIntensityIntervalTraining', 2), // accidental start/stop
    r('2026-09-29', 'Cycling', 62, null, 'Apple Watch'),
    r('2026-09-29', 'Cycling', 60, 45, 'Strava API'),
  ]);
  assert.deepEqual(a.days, [{ date: '2026-09-29', min: 60, top: 'bike', mods: { bike: 60 } }]);
  assert.deepEqual(activityFromRows([r('2026-09-28', 'Running', 2.5)]), { hasData: false }, 'stub only = no activity');
});

test('display rule: a 9-min Watch walk and a 10-min no-HR Strava ride are KEPT (load drops them as junk); a 2-min stub is not', () => {
  const a = activityFromRows([
    r('2026-09-29', 'Walking', 9, null, 'Apple Watch'),
    r('2026-09-29', 'Cycling', 10, null, 'Strava API'),
    r('2026-09-29', 'Running', 2, null, 'Apple Watch'),
  ]);
  assert.deepEqual(a.days, [{ date: '2026-09-29', min: 19, top: 'bike', mods: { bike: 10, other: 9 } }]);
});
