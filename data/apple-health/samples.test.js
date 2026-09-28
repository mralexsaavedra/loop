/* Tests for the shared Apple Health sample helpers (used by extract.js AND sync-shortcut.js,
 * so export-derived and Shortcut-derived rows are formatted identically). Synthetic values only. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('./samples.js');

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
  assert.equal(s.SLEEP_HEADER, 'date,asleep_hours,source,bedtime,waketime');
  assert.equal(s.readingRow({ date: '2030-01-02', value: 50.5, source: 'X' }), '2030-01-02,50.5,X');
  assert.equal(s.readingRow({ date: '2030-01-02', value: 50 }), '2030-01-02,50,');
  const ck = { start: '2030-01-01 23:30:00 +0100', end: '2030-01-02 07:15:00 +0100' };
  assert.equal(s.sleepRow('2030-01-02', 450, 'X', ck), '2030-01-02,7.50,X,23.5,7.25');
  assert.equal(s.sleepRow('2030-01-02', 450, 'X', null), '2030-01-02,7.50,X,,');
});
