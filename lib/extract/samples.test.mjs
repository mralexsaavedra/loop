/* Tests for the shared Apple Health sample helpers (used by extract.mjs AND sync-shortcut.mjs,
 * so export-derived and Shortcut-derived rows are formatted identically). Synthetic values only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as s from './samples.mjs';

test('day() keeps the local calendar date of an export stamp', () => {
  assert.equal(s.day('2030-01-02 23:59:00 +0200'), '2030-01-02');
  assert.equal(s.day(null), '');
});

test('num() parses finite numbers only', () => {
  assert.equal(s.num('12.5'), 12.5);
  assert.equal(s.num('abc'), null);
});

test('minutesBetween() measures real elapsed time', () => {
  assert.equal(s.minutesBetween('2030-01-01 23:30:00 +0100', '2030-01-02 00:15:00 +0100'), 45);
});

test('minutesBetween() is offset-aware across a DST fall-back (Europe/Madrid, +02:00 -> +01:00)', () => {
  // last Sunday of October 2026: 03:00 CEST becomes 02:00 CET -> the night lasts one hour longer
  assert.equal(s.minutesBetween('2026-10-24 23:00:00 +0200', '2026-10-25 07:00:00 +0100'), 540);
  // spring-forward (last Sunday of March 2026) -> one hour shorter
  assert.equal(s.minutesBetween('2026-03-28 23:00:00 +0100', '2026-03-29 07:00:00 +0200'), 420);
});

test('minutesBetween() falls back to the naive local clock without an offset', () => {
  assert.equal(s.minutesBetween('2030-01-01 23:30:00', '2030-01-02 00:15:00'), 45);
});

test('absMs() orders stamps by real instant, not by wall clock', () => {
  // 02:30 CEST happens BEFORE 02:10 CET on the fall-back night
  assert.ok(s.absMs('2026-10-25 02:30:00 +0200') < s.absMs('2026-10-25 02:10:00 +0100'));
});

test('addDay() crosses month and year boundaries', () => {
  assert.equal(s.addDay('2030-12-31'), '2031-01-01');
  assert.equal(s.addDay('2030-02-28'), '2030-03-01');
});

test('clockHour() returns the local decimal hour', () => {
  assert.equal(s.clockHour('2030-01-01 23:30:00 +0100'), 23.5);
  assert.equal(s.clockHour('2030-01-01 07:15:00 +0100'), 7.25);
});

test('sleepNight() assigns evening starts to the next (wake-up) date', () => {
  assert.equal(s.sleepNight('2030-01-01 22:00:00 +0100'), '2030-01-02');
  assert.equal(s.sleepNight('2030-01-01 18:00:00 +0100'), '2030-01-02');
  assert.equal(s.sleepNight('2030-01-02 01:00:00 +0100'), '2030-01-02');
  assert.equal(s.sleepNight('2030-01-02 17:59:00 +0100'), '2030-01-02');
});

test('isoToExportStamp() converts ISO-8601 with offset to the export format, keeping local time', () => {
  assert.equal(s.isoToExportStamp('2030-01-02T08:05:09+02:00'), '2030-01-02 08:05:09 +0200');
  assert.equal(s.isoToExportStamp('2030-01-02T08:05:09-05:30'), '2030-01-02 08:05:09 -0530');
  assert.equal(s.isoToExportStamp('2030-01-02T08:05:09Z'), '2030-01-02 08:05:09 +0000');
  assert.equal(s.isoToExportStamp('2030-01-02T08:05+02:00'), '2030-01-02 08:05:00 +0200');
  assert.equal(s.isoToExportStamp('not a date'), null);
  assert.equal(s.isoToExportStamp(''), null);
});

test('readingRow() and sleepRow() match the extract CSV schemas', () => {
  assert.equal(s.READING_HEADER, 'date,value,source');
  assert.equal(s.SLEEP_HEADER, 'date,asleep_hours,source,bedtime,waketime,rem_h,deep_h,core_h,unspec_h,awake_h,inbed_h');
  assert.equal(s.readingRow({ date: '2030-01-02', value: 50.5, source: 'X' }), '2030-01-02,50.5,X');
  assert.equal(s.readingRow({ date: '2030-01-02', value: 50 }), '2030-01-02,50,');
  const ck = { start: '2030-01-01 23:30:00 +0100', end: '2030-01-02 07:15:00 +0100' };
  assert.equal(s.sleepRow('2030-01-02', 450, 'X', ck), '2030-01-02,7.50,X,23.5,7.25,,,,,,');
  assert.equal(s.sleepRow('2030-01-02', 450, 'X', null), '2030-01-02,7.50,X,,,,,,,,');
  const st = { rem: 90, deep: 60, core: 300, unspec: 0, awake: 15, inbed: 480 };
  assert.equal(s.sleepRow('2030-01-02', 450, 'X', ck, st), '2030-01-02,7.50,X,23.5,7.25,1.50,1.00,5.00,0.00,0.25,8.00');
  // unstaged (Asleep-unspecified only): REM / deep / core / awake stay empty, unspec + in bed are written
  assert.equal(s.sleepRow('2030-01-02', 450, 'X', ck, { rem: null, deep: null, core: null, unspec: 450, awake: null, inbed: 465 }), '2030-01-02,7.50,X,23.5,7.25,,,,7.50,,7.75');
});

test('WORKOUTS_HEADER has 12 columns and workoutRow() emits three trailing empty Strava-only columns', () => {
  assert.equal(s.WORKOUTS_HEADER.split(',').length, 12);
  assert.match(s.WORKOUTS_HEADER, /,relative_effort,kilojoules,elevation_m$/);
  const line = s.workoutRow({ date: '2030-01-01', type: 'Running', durationMin: 30, energyKcal: null, hrAvg: 140.4, hrMin: null, hrMax: 165, source: 'Watch', distanceKm: 5.004 });
  assert.equal(line, '2030-01-01,Running,30,,140,,165,Watch,5,,,');
  assert.equal(line.split(',').length, 12);
});

// ---- sleepNights(): one main-sleep night per wake-up date, naps excluded ----------------

const seg = (start, end, source = 'W') => ({ start, end, source });
const nightRows = segs => s.sleepNights(segs).map(n => s.sleepRow(n.date, n.minutes, n.source, n.ck).split(',').slice(0, 5).join(','));
const stg = (start, end, stage, source = 'W') => ({ start, end, stage, source });

test('sleepNights(): a nap crossing 18:00 is not split across two nights and never sets bed/wake', () => {
  const rows = nightRows([
    seg('2030-01-01 23:30:00 +0100', '2030-01-02 07:00:00 +0100'),
    // nap 17:40-18:40 on 01-02 (a short awake gap inside it)
    seg('2030-01-02 17:40:00 +0100', '2030-01-02 18:10:00 +0100'),
    seg('2030-01-02 18:12:00 +0100', '2030-01-02 18:40:00 +0100'),
    seg('2030-01-03 00:00:00 +0100', '2030-01-03 07:30:00 +0100'),
  ]);
  assert.deepEqual(rows, [
    '2030-01-02,7.50,W,23.5,7',
    '2030-01-03,7.50,W,0,7.5',
  ]);
});

test('sleepNights(): an afternoon nap adds neither minutes nor a wake time to the night', () => {
  const rows = nightRows([
    seg('2030-01-01 23:00:00 +0100', '2030-01-02 07:00:00 +0100'),
    seg('2030-01-02 15:00:00 +0100', '2030-01-02 15:45:00 +0100'),
  ]);
  assert.deepEqual(rows, ['2030-01-02,8.00,W,23,7']);
});

test('sleepNights(): a split night with a long wake-up at 3 am stays ONE night', () => {
  const rows = nightRows([
    seg('2030-01-01 23:00:00 +0100', '2030-01-02 03:00:00 +0100'),
    // awake 03:00-04:30 (90 min, longer than the block gap)
    seg('2030-01-02 04:30:00 +0100', '2030-01-02 07:30:00 +0100'),
  ]);
  assert.deepEqual(rows, ['2030-01-02,7.00,W,23,7.5']);
});

test('sleepNights(): a nap-only day yields no night row', () => {
  assert.deepEqual(nightRows([seg('2030-01-02 15:00:00 +0100', '2030-01-02 16:00:00 +0100')]), []);
});

test('sleepNights(): a late doze hours after waking is a nap, not a later wake time', () => {
  const rows = nightRows([
    seg('2030-01-01 23:00:00 +0100', '2030-01-02 06:00:00 +0100'),
    seg('2030-01-02 10:00:00 +0100', '2030-01-02 10:40:00 +0100'),
  ]);
  assert.deepEqual(rows, ['2030-01-02,7.00,W,23,6']);
});

test('sleepNights(): per source, the source with the most main-sleep minutes wins; overlaps count once', () => {
  const rows = nightRows([
    seg('2030-01-01 23:00:00 +0100', '2030-01-02 03:00:00 +0100', 'A'),
    seg('2030-01-02 02:00:00 +0100', '2030-01-02 06:00:00 +0100', 'A'), // overlaps 1 h
    seg('2030-01-01 23:30:00 +0100', '2030-01-02 07:00:00 +0100', 'B'),
    seg('2030-01-02 14:00:00 +0100', '2030-01-02 16:00:00 +0100', 'A'), // nap: never makes A win
  ]);
  assert.deepEqual(rows, ['2030-01-02,7.50,B,23.5,7']);
});

test('wristTempDate(): sleeping wrist temperature is dated by the wake-up night, like sleep', () => {
  assert.equal(s.wristTempDate('2030-01-01 23:10:00 +0100'), '2030-01-02');
  assert.equal(s.wristTempDate('2030-01-02 00:20:00 +0100'), '2030-01-02');
});

test('sleepNights(): a morning nap starting 2.5 h after the night ends is NOT absorbed (after-end gap cap)', () => {
  const rows = nightRows([
    seg('2030-01-01 23:00:00 +0100', '2030-01-02 06:30:00 +0100'),
    seg('2030-01-02 09:00:00 +0100', '2030-01-02 10:00:00 +0100'),
  ]);
  assert.deepEqual(rows, ['2030-01-02,7.50,W,23,6.5']);
});

test('sleepNights(): falling back asleep within the after-end gap after an early-morning wake still joins the night', () => {
  const rows = nightRows([
    seg('2030-01-01 23:00:00 +0100', '2030-01-02 05:30:00 +0100'),
    seg('2030-01-02 06:25:00 +0100', '2030-01-02 07:30:00 +0100'), // 55 min awake, starts after 05:00
  ]);
  assert.deepEqual(rows, ['2030-01-02,7.58,W,23,7.5']);
});

test('sleepNights(): a 1 h wake at 02:30 (23:00-02:30 + 03:30-07:00) is one night', () => {
  const rows = nightRows([
    seg('2030-01-01 23:00:00 +0100', '2030-01-02 02:30:00 +0100'),
    seg('2030-01-02 03:30:00 +0100', '2030-01-02 07:00:00 +0100'),
  ]);
  assert.deepEqual(rows, ['2030-01-02,7.00,W,23,7']);
});

test('sleepNights(): a mid-night wake-up longer than the after-end cap still joins when the block starts before 05:00', () => {
  const rows = nightRows([
    seg('2030-01-01 23:00:00 +0100', '2030-01-02 01:30:00 +0100'),
    seg('2030-01-02 03:30:00 +0100', '2030-01-02 08:00:00 +0100'), // 2 h awake, back asleep at 03:30
  ]);
  assert.deepEqual(rows, ['2030-01-02,7.00,W,23,8']);
});

test('wristTempDate(start, end): dated by the midpoint with the 18:00 roll-over, exactly like a sleep block', () => {
  // a 17:30-23:30 block: its midpoint (20:30) belongs to the next wake-up date, like sleepNights
  assert.equal(s.wristTempDate('2030-01-01 17:30:00 +0100', '2030-01-01 23:30:00 +0100'), '2030-01-02');
  const nights = s.sleepNights([seg('2030-01-01 17:30:00 +0100', '2030-01-01 23:30:00 +0100')]);
  assert.equal(nights[0].date, '2030-01-02', 'sleepNights dates the same block identically');
  assert.equal(s.wristTempDate('2030-01-01 23:10:00 +0100', '2030-01-02 07:00:00 +0100'), '2030-01-02');
  // without an end (a Shortcut point sample) the start alone decides, as before
  assert.equal(s.wristTempDate('2030-01-01 17:30:00 +0100'), '2030-01-01');
});

// ---- falling back asleep after an early wake-up (ends before 10:00 -> up to a 3 h gap) ------

test('sleepNights(): 23:59-03:19 then back asleep 05:08-07:32 is ONE night (morning block ends before 10:00)', () => {
  const segs = [
    seg('2030-01-01 23:59:00 +0100', '2030-01-02 03:19:00 +0100'),
    seg('2030-01-02 05:08:00 +0100', '2030-01-02 07:32:00 +0100'), // 1 h 49 awake, starts after 05:00
  ];
  assert.equal(s.sleepNights(segs).length, 1);
  assert.deepEqual(nightRows(segs), ['2030-01-02,5.73,W,23.98,7.53']); // 3 h 20 + 2 h 24
});

test('sleepNights(): 01:19-06:21 then back asleep 07:57-09:48 is ONE night (~6.9 h)', () => {
  const rows = nightRows([
    seg('2030-01-02 01:19:00 +0100', '2030-01-02 06:21:00 +0100'),
    seg('2030-01-02 07:57:00 +0100', '2030-01-02 09:48:00 +0100'),
  ]);
  assert.deepEqual(rows, ['2030-01-02,6.88,W,1.32,9.8']);
});

test('sleepNights(): a morning block ending AFTER 10:00 keeps the 60-min after-end cap (09:00-10:30 after a 06:30 wake is a nap)', () => {
  const rows = nightRows([
    seg('2030-01-01 23:00:00 +0100', '2030-01-02 06:30:00 +0100'),
    seg('2030-01-02 09:00:00 +0100', '2030-01-02 10:30:00 +0100'),
  ]);
  assert.deepEqual(rows, ['2030-01-02,7.50,W,23,6.5']);
});

test('sleepNights(): a block ending before 10:00 but more than 3 h after the wake-up is still a nap', () => {
  const rows = nightRows([
    seg('2030-01-01 22:00:00 +0100', '2030-01-02 05:10:00 +0100'),
    seg('2030-01-02 08:20:00 +0100', '2030-01-02 09:30:00 +0100'), // 3 h 10 awake
  ]);
  assert.deepEqual(rows, ['2030-01-02,7.17,W,22,5.17']);
});

test('sleepNights(): TRADE-OFF — a 07:30-09:30 nap after a 06:30 wake JOINS the night (indistinguishable from falling back asleep)', () => {
  const rows = nightRows([
    seg('2030-01-01 23:00:00 +0100', '2030-01-02 06:30:00 +0100'),
    seg('2030-01-02 07:30:00 +0100', '2030-01-02 09:30:00 +0100'), // ends before 10:00, 1 h gap
  ]);
  assert.deepEqual(rows, ['2030-01-02,9.50,W,23,9.5']);
});

// ---- sleep stages: per-night REM / deep / core / unspecified / awake / in bed -----------------

test('sleepNights(): per-stage minutes of the main sleep; awake only inside the night; in bed = window + InBed', () => {
  const [n] = s.sleepNights([
    stg('2030-01-01 22:50:00 +0100', '2030-01-02 07:10:00 +0100', 'inbed', 'iPhone'), // the phone's bedtime record
    stg('2030-01-01 23:00:00 +0100', '2030-01-02 01:00:00 +0100', 'core'),
    stg('2030-01-02 01:00:00 +0100', '2030-01-02 01:20:00 +0100', 'awake'),
    stg('2030-01-02 01:20:00 +0100', '2030-01-02 02:20:00 +0100', 'deep'),
    stg('2030-01-02 02:20:00 +0100', '2030-01-02 03:50:00 +0100', 'rem'),
    stg('2030-01-02 03:50:00 +0100', '2030-01-02 07:00:00 +0100', 'core'),
    stg('2030-01-02 07:00:00 +0100', '2030-01-02 07:30:00 +0100', 'awake'), // after the last asleep end: not counted
    stg('2030-01-02 15:00:00 +0100', '2030-01-02 15:40:00 +0100', 'core'), // nap: no stage minutes
  ]);
  assert.equal(n.date, '2030-01-02');
  assert.equal(n.minutes, 460);
  assert.deepEqual(n.stages, { rem: 90, deep: 60, core: 310, unspec: 0, awake: 20, inbed: 500 });
});

test('sleepNights(): without an InBed record, in bed = the sleep window (first asleep start to last asleep end)', () => {
  const [n] = s.sleepNights([
    stg('2030-01-01 23:00:00 +0100', '2030-01-02 03:00:00 +0100', 'core'),
    stg('2030-01-02 03:00:00 +0100', '2030-01-02 03:30:00 +0100', 'awake'),
    stg('2030-01-02 03:30:00 +0100', '2030-01-02 07:00:00 +0100', 'rem'),
  ]);
  assert.equal(n.minutes, 450);
  assert.deepEqual(n.stages, { rem: 210, deep: 0, core: 240, unspec: 0, awake: 30, inbed: 480 });
});

test('sleepNights(): unstaged (Asleep-unspecified / no stage) nights keep REM / deep / core / awake unknown', () => {
  const [n] = s.sleepNights([seg('2030-01-01 23:00:00 +0100', '2030-01-02 07:00:00 +0100')]);
  assert.deepEqual(n.stages, { rem: null, deep: null, core: null, unspec: 480, awake: null, inbed: 480 });
});

test('sleepNights(): awake / in-bed records never create a night nor make a source win', () => {
  assert.deepEqual(s.sleepNights([stg('2030-01-01 23:00:00 +0100', '2030-01-02 07:00:00 +0100', 'inbed', 'iPhone'),
    stg('2030-01-02 01:00:00 +0100', '2030-01-02 02:00:00 +0100', 'awake')]), []);
  const [n] = s.sleepNights([
    stg('2030-01-01 23:00:00 +0100', '2030-01-02 06:00:00 +0100', 'core', 'A'),
    stg('2030-01-01 22:00:00 +0100', '2030-01-02 09:00:00 +0100', 'awake', 'B'),
    stg('2030-01-01 23:30:00 +0100', '2030-01-02 05:00:00 +0100', 'unspec', 'B'),
  ]);
  assert.equal(n.source, 'A');
  assert.equal(n.stages.awake, 0, "B's awake record is not A's");
});

test('sleepNights(): duplicated / overlapping stage records of one source count once', () => {
  const [n] = s.sleepNights([
    stg('2030-01-01 23:00:00 +0100', '2030-01-02 03:00:00 +0100', 'core'),
    stg('2030-01-01 23:00:00 +0100', '2030-01-02 03:00:00 +0100', 'core'),
    stg('2030-01-02 02:00:00 +0100', '2030-01-02 07:00:00 +0100', 'core'),
  ]);
  assert.equal(n.minutes, 480);
  assert.equal(n.stages.core, 480);
});

test('sleepStage(): Apple export values -> stage keys', () => {
  assert.equal(s.sleepStage('HKCategoryValueSleepAnalysisAsleepCore'), 'core');
  assert.equal(s.sleepStage('HKCategoryValueSleepAnalysisAsleepDeep'), 'deep');
  assert.equal(s.sleepStage('HKCategoryValueSleepAnalysisAsleepREM'), 'rem');
  assert.equal(s.sleepStage('HKCategoryValueSleepAnalysisAsleepUnspecified'), 'unspec');
  assert.equal(s.sleepStage('HKCategoryValueSleepAnalysisAsleep'), 'unspec');
  assert.equal(s.sleepStage('HKCategoryValueSleepAnalysisAwake'), 'awake');
  assert.equal(s.sleepStage('HKCategoryValueSleepAnalysisInBed'), 'inbed');
  assert.equal(s.sleepStage('HKCategoryValueSleepAnalysisWhatever'), null);
});

test('csvSource: decodes XML entities and turns commas / line breaks into spaces (the Shortcut rule)', () => {
  assert.equal(s.csvSource('Alex, Watch'), 'Alex  Watch');
  assert.equal(s.csvSource('Scale, Kitchen &amp; Co'), 'Scale  Kitchen & Co');
  assert.equal(s.csvSource('&lt;a&gt; &quot;b&quot; &apos;c&apos; &#233;&#xE9;'), '<a> "b" \'c\' éé');
  assert.equal(s.csvSource('&amp;lt;'), '&lt;'); // decoded once, never twice
  assert.equal(s.csvSource('a\r\nb\nc'), 'a  b c');
  assert.equal(s.csvSource('&#x2C;'), ' '); // an encoded comma is still a comma
  assert.equal(s.csvSource('&bogus; &#xZZ;'), '&bogus; &#xZZ;');
  assert.equal(s.csvSource('Apple Watch de Demo'), 'Apple Watch de Demo');
  assert.equal(s.csvSource(null), '');
  assert.equal(s.csvSource(undefined), '');
});

test('row builders write the source through csvSource', () => {
  assert.equal(s.readingRow({ date: '2030-01-02', value: 70, source: 'Scale, Kitchen &amp; Co' }), '2030-01-02,70,Scale  Kitchen & Co');
  assert.equal(s.sleepRow('2030-01-02', 420, 'Alex, Watch', null, null).split(',')[2], 'Alex  Watch');
  assert.equal(s.workoutRow({ date: '2030-01-02', type: 'Running', source: 'Alex, Watch' }).split(',').length, 12);
  assert.equal(s.workoutRow({ date: '2030-01-02', type: 'Running', source: 'Alex, Watch' }).split(',')[7], 'Alex  Watch');
});

// ---- in-bed-only nights (a band that writes only "In bed", e.g. Mi Fitness) -> estimated sleep ----

const MIF = 'Mi Fitness';
const blank6 = { rem: null, deep: null, core: null, unspec: null, awake: null, inbed: null };

test('sleepNights(): an in-bed-only source gives an ESTIMATED night (in-bed time, "<source> (in bed)", stage columns blank); daytime fragments are ignored', () => {
  const nights = s.sleepNights([
    stg('2030-01-01 23:30:00 +0100', '2030-01-02 03:00:00 +0100', 'inbed', MIF),
    stg('2030-01-02 03:20:00 +0100', '2030-01-02 07:30:00 +0100', 'inbed', MIF), // a 20 min gap: same block
    stg('2030-01-02 15:00:00 +0100', '2030-01-02 15:50:00 +0100', 'inbed', MIF), // afternoon fragments
    stg('2030-01-02 16:20:00 +0100', '2030-01-02 17:00:00 +0100', 'inbed', MIF),
    stg('2030-01-03 11:00:00 +0100', '2030-01-03 11:40:00 +0100', 'inbed', MIF), // late-morning fragment alone
  ]);
  assert.equal(nights.length, 1);
  const [n] = nights;
  assert.equal(n.date, '2030-01-02');
  assert.equal(n.minutes, 460);
  assert.equal(n.source, 'Mi Fitness (in bed)');
  assert.equal(n.estimated, true);
  assert.deepEqual(n.stages, blank6);
  assert.equal(s.sleepRow(n.date, n.minutes, n.source, n.ck, n.stages), '2030-01-02,7.67,Mi Fitness (in bed),23.5,7.5,,,,,,');
  assert.equal(s.isInBedEstimate(n.source), true);
  assert.equal(s.isInBedEstimate('Mi Fitness'), false);
});

test('sleepNights(): an in-bed main block under 3 h is not a night', () => {
  assert.deepEqual(s.sleepNights([stg('2030-01-02 04:00:00 +0100', '2030-01-02 06:50:00 +0100', 'inbed', MIF)]), []);
  assert.equal(s.sleepNights([stg('2030-01-02 04:00:00 +0100', '2030-01-02 07:00:00 +0100', 'inbed', MIF)]).length, 1);
});

test('sleepNights(): a night with asleep data is never estimated; a source that ever wrote asleep data never estimates (the Watch), nor does the iPhone', () => {
  const nights = s.sleepNights([
    // night 1: the Watch slept, the band was in bed -> the Watch's asleep night, unchanged
    stg('2030-01-01 23:00:00 +0100', '2030-01-02 07:00:00 +0100', 'core', 'W'),
    stg('2030-01-01 22:00:00 +0100', '2030-01-02 08:00:00 +0100', 'inbed', MIF),
    // night 2: only the band -> estimated
    stg('2030-01-02 23:00:00 +0100', '2030-01-03 07:00:00 +0100', 'inbed', MIF),
    // night 3: the Watch wrote only InBed (no asleep that night), the iPhone its bedtime -> no night
    stg('2030-01-03 23:00:00 +0100', '2030-01-04 07:00:00 +0100', 'inbed', 'W'),
    stg('2030-01-03 23:00:00 +0100', '2030-01-04 07:00:00 +0100', 'inbed', 'iPhone de Demo'),
  ]);
  assert.deepEqual(nights.map(n => [n.date, n.source, n.minutes, !!n.estimated]), [
    ['2030-01-02', 'W', 480, false],
    ['2030-01-03', 'Mi Fitness (in bed)', 480, true],
  ]);
  assert.equal(nights[0].stages.inbed, 600, 'the band\'s InBed still widens the Watch night\'s in-bed column');
});

test('sleepNights(): two in-bed-only sources on one night -> the longer one', () => {
  const [n] = s.sleepNights([
    stg('2030-01-01 23:00:00 +0100', '2030-01-02 06:00:00 +0100', 'inbed', MIF),
    stg('2030-01-01 23:30:00 +0100', '2030-01-02 07:30:00 +0100', 'inbed', 'Zepp Life'),
  ]);
  assert.deepEqual([n.source, n.minutes], ['Zepp Life (in bed)', 480]);
});

// ---- derived resting HR from heart-rate samples (no measured RestingHeartRate) -----------------

// Mi Fitness-style hour buckets: `n` records stamped at hh:00:00 (each spans the clock hour)
const bucket = (date, hh, bpms, source = MIF) => bpms.map(value => ({ start: `${date} ${hh}:00:00 +0100`, value, source }));
const nightBuckets = (date, low = 53) => [
  ...bucket(date, '00', [62, 60, 61, 63, 60, 62]),
  ...bucket(date, '01', [58, 57, 59, 58, 57, 58]),
  ...bucket(date, '03', [low - 1, low, low + 1, low - 1, low, low + 1]),
  ...bucket(date, '05', [60, 61, 59, 60]),
  ...bucket(date, '10', [45, 45, 45, 45]), // daytime: outside the night window
];

test('derivedRestingHr(): the lowest 30-min mean of the night (00:00-07:00) per day, tagged "<source> (derived)"', () => {
  assert.deepEqual(s.derivedRestingHr([...nightBuckets('2030-01-02'), ...nightBuckets('2030-01-03', 55)]), [
    { date: '2030-01-02', value: 53, source: 'Mi Fitness (derived)' },
    { date: '2030-01-03', value: 55, source: 'Mi Fitness (derived)' },
  ]);
  assert.equal(s.isDerivedReading('Mi Fitness (derived)'), true);
  assert.equal(s.isDerivedReading('Mi Fitness'), false);
});

test('derivedRestingHr(): coverage — fewer than 3 night hours is no row; a 30-min window needs 4 samples', () => {
  const two = [...bucket('2030-01-02', '01', [58, 57, 59, 58]), ...bucket('2030-01-02', '03', [52, 53, 54, 52])];
  assert.deepEqual(s.derivedRestingHr(two), []);
  const thin = [...two, ...bucket('2030-01-02', '04', [40, 40, 40])]; // a 3-sample hour: too thin to be the minimum
  assert.deepEqual(s.derivedRestingHr(thin), [{ date: '2030-01-02', value: 52.8, source: 'Mi Fitness (derived)' }]);
  const glitch = [...two, ...bucket('2030-01-02', '05', [20, 20, 20, 20, 300])]; // out of 25-240 bpm: dropped (still a 3rd hour? no: no sample left)
  assert.deepEqual(s.derivedRestingHr(glitch), []);
});

test('derivedRestingHr(): a rolling 30-min window over real timestamps (crosses the clock hour)', () => {
  const at = (hm, value) => ({ start: `2030-01-02 ${hm}:00 +0100`, value, source: 'Band' });
  const hr = [];
  for (let m = 0; m < 7 * 60; m += 5) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0'), mm = String(m % 60).padStart(2, '0');
    hr.push(at(`${hh}:${mm}`, 60));
  }
  for (const r of hr) if (r.start >= '2030-01-02 02:45' && r.start < '2030-01-02 03:15') r.value = 50; // 02:45-03:10
  assert.deepEqual(s.derivedRestingHr(hr), [{ date: '2030-01-02', value: 50, source: 'Band (derived)' }]);
});

test('derivedRestingHr(): measured resting HR always wins — no row on a measured date, none from a source that measures, none from an Apple Watch', () => {
  const measured = [{ date: '2030-01-02', value: 50, source: 'Oura' }];
  assert.deepEqual(s.derivedRestingHr([...nightBuckets('2030-01-02'), ...nightBuckets('2030-01-03')], measured).map(r => r.date), ['2030-01-03']);
  // a source that wrote any RestingHeartRate never gets a derived value, even on its unmeasured days
  assert.deepEqual(s.derivedRestingHr(nightBuckets('2030-01-03', 53).map(r => ({ ...r, source: 'Oura' })), measured), []);
  const watch = 'Apple Watch de Demo';
  assert.deepEqual(s.derivedRestingHr(nightBuckets('2030-01-03').map(r => ({ ...r, source: watch }))), []);
});
