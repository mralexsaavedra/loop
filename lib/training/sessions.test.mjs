/* Unit tests for lib/training/sessions.mjs — the ONE same-day merge rule every workouts.csv reader uses. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSameDay, isJunk, isStub, sourceRank, SOURCE_PRECEDENCE, JUNK_MAX_MIN, JUNK_MAX_RE, STUB_MAX_MIN, SUPERSEDE_MIN_COVERAGE, DISPLAY_RULE } from './sessions.mjs';

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

test('sourceRank: Strava API > Strava (HealthKit copy) > Apple Watch > any other app (lower = wins)', () => {
  assert.deepEqual(SOURCE_PRECEDENCE.map((p) => p.name), ['Strava API', 'Strava', 'Apple Watch']);
  assert.equal(sourceRank('Strava API'), 0);
  assert.equal(sourceRank('Strava'), 1);
  assert.equal(sourceRank('Apple Watch de Someone'), 2);
  assert.equal(sourceRank('apple watch'), 2);
  const other = SOURCE_PRECEDENCE.length;
  for (const s of ['Hevy', 'Zepp', 'ROXFIT', 'Demo Watch', 'Demo Strava', 'Strava Beacon', '', undefined]) assert.equal(sourceRank(s), other, String(s));
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

/* ---------- source-aware rule: apps mirror the SAME workout into Apple Health ---------- */
const h = (date, type, dur, source, extra = {}) => ({ date, type, dur, re: null, source, ...extra });

test('Strava API + its HealthKit copy ("Strava") of the same activity count ONCE (the Strava API rows)', () => {
  const stats = {};
  const g = mergeSameDay([
    h('2026-09-29', 'Cycling', 61, 'Strava'),
    h('2026-09-29', 'Cycling', 60, 'Strava API', { re: 45 }),
  ], byType, { stats });
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].rows.map((x) => x.source), ['Strava API']);
  assert.equal(stats.superseded, 1);
});

test('Watch 60 + Hevy 58 of one gym session count ONCE (the Watch outranks any other app)', () => {
  const g = mergeSameDay([
    h('2026-09-29', 'TraditionalStrengthTraining', 58, 'Hevy'),
    h('2026-09-29', 'TraditionalStrengthTraining', 60, 'Apple Watch de X'),
  ], byType);
  assert.deepEqual(g[0].rows.map((x) => [x.source, x.dur]), [['Apple Watch de X', 60]]);
});

test('Watch 60 + Strava API 25 of one modality: under the coverage floor they are DIFFERENT sessions, both groups kept', () => {
  const stats = {};
  const g = mergeSameDay([
    h('2026-09-29', 'HighIntensityIntervalTraining', 60, 'Apple Watch de X'),
    h('2026-09-29', 'HighIntensityIntervalTraining', 25, 'Strava API', { re: 30 }),
  ], byType, { stats });
  assert.deepEqual(g[0].rows.map((x) => x.source).sort(), ['Apple Watch de X', 'Strava API']);
  assert.equal(stats.superseded, 0);
});

test('fragments from ONE source are all kept (summed by callers), also when another source is dropped', () => {
  const g = mergeSameDay([
    h('2026-09-29', 'Running', 30, 'Apple Watch de X'),
    h('2026-09-29', 'Running', 25, 'Apple Watch de X'),
    h('2026-09-29', 'Running', 52, 'Nike Run Club'),
  ], byType);
  assert.deepEqual(g[0].rows.map((x) => x.dur), [30, 25]);
});

test('never summed across sources: two other apps with one session keep only one (the longer)', () => {
  const g = mergeSameDay([
    h('2026-09-29', 'HighIntensityIntervalTraining', 45, 'Zepp'),
    h('2026-09-29', 'HighIntensityIntervalTraining', 50, 'ROXFIT'),
  ], byType);
  assert.deepEqual(g[0].rows.map((x) => x.source), ['ROXFIT']);
});

test('three sources: the short Strava API row stays a separate session, Hevy folds into the Watch session', () => {
  const g = mergeSameDay([
    h('2026-09-29', 'HighIntensityIntervalTraining', 60, 'Apple Watch de X'),
    h('2026-09-29', 'HighIntensityIntervalTraining', 58, 'Hevy'),
    h('2026-09-29', 'HighIntensityIntervalTraining', 25, 'Strava API', { re: 30 }),
  ], byType);
  assert.deepEqual(g[0].rows.map((x) => x.source).sort(), ['Apple Watch de X', 'Strava API']);
});

test('a chosen source without HR inherits the dropped copy\'s HR (duration-weighted avg, max of max); inputs untouched', () => {
  const watch = [
    h('2026-09-29', 'Cycling', 40, 'Apple Watch de X', { hrAvg: 140, hrMax: 170 }),
    h('2026-09-29', 'Cycling', 20, 'Apple Watch de X', { hrAvg: 110, hrMax: 150 }),
  ];
  const strava = h('2026-09-29', 'Cycling', 58, 'Strava API', { re: 50, hrAvg: null });
  const g = mergeSameDay([...watch, strava], byType);
  assert.equal(g.length, 1);
  assert.equal(g[0].rows.length, 1);
  const s = g[0].rows[0];
  assert.equal(s.source, 'Strava API');
  assert.equal(s.hrAvg, 130); // (140*40 + 110*20) / 60
  assert.equal(s.hrMax, 170);
  assert.equal(s.re, 50, 'its own RE is kept');
  assert.equal(strava.hrAvg, null, 'the input row is not mutated');
});

test('HR is not overwritten when the chosen source has it', () => {
  const g = mergeSameDay([
    h('2026-09-29', 'Cycling', 60, 'Apple Watch de X', { hrAvg: 140 }),
    h('2026-09-29', 'Cycling', 58, 'Strava API', { re: 50, hrAvg: 135 }),
  ], byType);
  assert.equal(g[0].rows[0].hrAvg, 135);
});

test('a chosen source without RE inherits the dropped copy\'s RE, spread over its rows by duration', () => {
  const g = mergeSameDay([
    h('2026-09-29', 'Running', 30, 'Apple Watch de X'),
    h('2026-09-29', 'Running', 30, 'Apple Watch de X'),
    h('2026-09-29', 'Running', 55, 'Nike Run Club', { re: 40 }),
  ], byType);
  assert.deepEqual(g[0].rows.map((x) => x.re), [20, 20]);
});

test('HR carried into a merged session reaches load vs recovery readers (hrAvg != null filter)', () => {
  const g = mergeSameDay([
    h('2026-09-29', 'Cycling', 60, 'Apple Watch de X', { hrAvg: 140 }),
    h('2026-09-29', 'Cycling', 58, 'Strava API', { re: 50 }),
  ], byType);
  assert.equal(g[0].rows.filter((x) => x.hrAvg != null).length, 1);
});
