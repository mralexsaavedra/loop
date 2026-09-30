/* Unit tests for lib/training/sessions.mjs — the ONE same-day merge rule every workouts.csv reader uses. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSameDay, isJunk, isStub, isPreferredSource, JUNK_MAX_MIN, JUNK_MAX_RE, STUB_MAX_MIN, SUPERSEDE_MIN_COVERAGE, DISPLAY_RULE } from './sessions.mjs';

const r = (date, type, dur, re = null, source = 'Watch') => ({ date, type, dur, re, source });
const byType = (x) => x.type;

test('isJunk: short AND effortless; either arm alone keeps the row', () => {
  assert.equal(JUNK_MAX_MIN, 11);
  assert.equal(JUNK_MAX_RE, 2);
  assert.equal(isJunk({ dur: 2, re: null }), true, 'a 2-min Watch stub is junk');
  assert.equal(isJunk({ dur: 11, re: 2 }), true);
  assert.equal(isJunk({ dur: 11.5, re: null }), false, 'longer than the cutoff');
  assert.equal(isJunk({ dur: 8, re: 30 }), false, 'a short hard block survives');
});

test('isPreferredSource: Strava rows (sync:strava "Strava API" and the legacy "Strava" tag), never the Watch', () => {
  assert.equal(isPreferredSource('Strava API'), true);
  assert.equal(isPreferredSource('Strava'), true);
  assert.equal(isPreferredSource('Apple Watch'), false);
  assert.equal(isPreferredSource(undefined), false);
  assert.equal(isPreferredSource('Demo Watch'), false);
});

test('mergeSameDay groups by date + key, oldest date first, rows kept in file order', () => {
  const g = mergeSameDay([
    r('2026-09-29', 'Running', 30),
    r('2026-09-28', 'Cycling', 60),
    r('2026-09-29', 'Running', 15),
    r('2026-09-29', 'Cycling', 20),
  ], byType);
  assert.deepEqual(g.map((x) => [x.date, x.key, x.rows.map((y) => y.dur)]), [
    ['2026-09-28', 'Cycling', [60]],
    ['2026-09-29', 'Running', [30, 15]],
    ['2026-09-29', 'Cycling', [20]],
  ]);
});

test('mergeSameDay drops invalid rows (dur <= 0) and junk by default; dropJunk:false keeps junk; stats count every drop', () => {
  const rows = [r('2026-09-29', 'Running', 0), r('2026-09-29', 'Running', 2), r('2026-09-29', 'Running', 40, 60), null];
  const stats = {};
  assert.deepEqual(mergeSameDay(rows, byType, { stats }).map((x) => x.rows.length), [1]);
  assert.deepEqual(stats, { invalid: 2, junk: 1, stub: 0, superseded: 0 });
  assert.deepEqual(mergeSameDay(rows, byType, { dropJunk: false }).map((x) => x.rows.length), [2]);
});

test('a junk-only day leaves no group at all (a 2-min stub never marks a rest day as active)', () => {
  assert.deepEqual(mergeSameDay([r('2026-09-29', 'HighIntensityIntervalTraining', 2)], byType), []);
});

test('Watch + Strava rows for the same date and key: ONE source wins (Strava, it carries RE/elevation), never summed', () => {
  const stats = {};
  const g = mergeSameDay([
    r('2026-09-29', 'Cycling', 62, null, 'Apple Watch'),
    r('2026-09-29', 'Cycling', 60, 45, 'Strava API'),
    r('2026-09-28', 'Cycling', 50, null, 'Apple Watch'),
  ], byType, { stats });
  assert.deepEqual(g.map((x) => [x.date, x.rows.map((y) => y.source)]), [
    ['2026-09-28', ['Apple Watch']],
    ['2026-09-29', ['Strava API']],
  ]);
  assert.equal(stats.superseded, 1);
});

test('the one-source rule is per key: a Strava ride does not drop the same day\'s Watch gym session', () => {
  const g = mergeSameDay([
    r('2026-09-29', 'Cycling', 60, 45, 'Strava API'),
    r('2026-09-29', 'HighIntensityIntervalTraining', 50, null, 'Apple Watch'),
  ], byType);
  assert.equal(g.length, 2);
});

test('several Strava rows of one key on a date still add up (a session logged in parts)', () => {
  const g = mergeSameDay([r('2026-09-29', 'Running', 20, 30, 'Strava API'), r('2026-09-29', 'Running', 25, 40, 'Strava API')], byType);
  assert.deepEqual(g[0].rows.map((x) => x.re), [30, 40]);
});

test('isStub: shorter than STUB_MAX_MIN (an accidental Watch start), whatever the effort', () => {
  assert.equal(STUB_MAX_MIN, 3);
  assert.equal(isStub({ dur: 2, re: null }), true);
  assert.equal(isStub({ dur: 2.9, re: 40 }), true);
  assert.equal(isStub({ dur: 3, re: null }), false, 'the cutoff is strict');
  assert.equal(isStub({ dur: 9, re: null }), false);
});

test('DISPLAY_RULE (calendar, tables, timeline, dashboard): drops stubs only, keeps short unscored sessions that load scoring drops as junk', () => {
  assert.deepEqual(DISPLAY_RULE, { dropJunk: false, dropStub: true });
  const rows = [
    r('2026-09-29', 'Walking', 9, null, 'Apple Watch'), // real 9-min walk, Watch rows carry no RE
    r('2026-09-29', 'Cycling', 10, null, 'Strava API'), // real 10-min no-HR Strava ride
    r('2026-09-29', 'Running', 2, null, 'Apple Watch'), // accidental start
  ];
  const stats = {};
  assert.deepEqual(mergeSameDay(rows, byType, { ...DISPLAY_RULE, stats }).map((x) => x.key), ['Walking', 'Cycling']);
  assert.deepEqual(stats, { invalid: 0, junk: 0, stub: 1, superseded: 0 });
  assert.deepEqual(mergeSameDay(rows, byType), [], 'load scoring (default dropJunk) still drops all three');
});

test('supersede needs coverage: Strava must cover >= SUPERSEDE_MIN_COVERAGE of the Watch minutes, else both are kept (different sessions)', () => {
  assert.equal(SUPERSEDE_MIN_COVERAGE, 0.5);
  const covered = {};
  const g1 = mergeSameDay([
    r('2026-09-29', 'Cycling', 40, null, 'Apple Watch'),
    r('2026-09-29', 'Cycling', 20, null, 'Apple Watch'),
    r('2026-09-29', 'Cycling', 30, 45, 'Strava API'), // 30 / 60 = exactly the threshold
  ], byType, { stats: covered });
  assert.deepEqual(g1[0].rows.map((x) => x.source), ['Strava API']);
  assert.equal(covered.superseded, 2);
  const partial = {};
  const g2 = mergeSameDay([
    r('2026-09-29', 'Cycling', 90, null, 'Apple Watch'), // a long Watch ride
    r('2026-09-29', 'Cycling', 20, 15, 'Strava API'), // a short, separate Strava commute
  ], byType, { stats: partial });
  assert.deepEqual(g2[0].rows.map((x) => x.source), ['Apple Watch', 'Strava API'], 'both kept');
  assert.equal(partial.superseded, 0);
});
