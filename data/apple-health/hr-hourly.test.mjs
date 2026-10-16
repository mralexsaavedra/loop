/* Tests for the Shortcut heart-rate samples -> hr-hourly.csv aggregation (lib/health/hr-hourly.mjs). SYNTHETIC values only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../../lib/health/hr-hourly.mjs';

const s = (hm, value, day = '2030-01-02', off = '+0100') => ({ start: `${day} ${hm}:00 ${off}`, value });
const cols = line => line.split(',');

test('parseSample: "ISO;bpm" -> {start, value}; out of 25-240 bpm, malformed or decimal-comma lines', () => {
  assert.deepEqual(H.parseSample('2030-01-02T09:07:12+01:00;72'), { start: '2030-01-02 09:07:12 +0100', value: 72 });
  assert.deepEqual(H.parseSample('2030-01-02T09:07:12+01:00;72,5'), { start: '2030-01-02 09:07:12 +0100', value: 72.5 });
  assert.equal(H.parseSample('2030-01-02T09:07:12+01:00;24'), null);
  assert.equal(H.parseSample('2030-01-02T09:07:12+01:00;241'), null);
  assert.deepEqual(H.parseSample('2030-01-02T09:07:12+01:00;25').value, 25);
  assert.deepEqual(H.parseSample('2030-01-02T09:07:12+01:00;240').value, 240);
  assert.equal(H.parseSample('garbage;72'), null);
  assert.equal(H.parseSample('2030-01-02T09:07:12+01:00;'), null);
});

test('hourlyRows: one row per clock hour — avg / max / min / n of every sample, covered minutes to the next sample', () => {
  const rows = H.hourlyRows([s('09:00', 60), s('09:05', 80), s('09:10', 100), s('10:00', 70)], [], 'Shortcut');
  assert.deepEqual(rows.map(r => r.date), ['2030-01-02', '2030-01-02']);
  const [a, b] = rows.map(r => cols(r.line));
  assert.deepEqual(a.slice(0, 8), ['2030-01-02', '2030-01-02T09:00:00+01:00', '80.0', '100', '60', '3', '20.0', '0.0']);
  // 09:00 + 09:05 cover 5 min each; 09:10 -> 10:00 is 50 min, capped at 10
  assert.equal(a[8], '60:300 80:300 100:600');
  assert.equal(a[9], 'Shortcut');
  // the newest sample has no next sample: it covers nothing
  assert.deepEqual(b.slice(2, 9), ['70.0', '70', '70', '1', '0.0', '0.0', '']);
});

test('hourlyRows: samples are sorted by instant and bpm below 50 never enter the histogram (always zone 0)', () => {
  const rows = H.hourlyRows([s('03:10', 52), s('03:00', 45)], [], 'Shortcut');
  const c = cols(rows[0].line);
  assert.equal(c[6], '10.0');
  assert.equal(c[8], ''); // 45 bpm covers 03:00-03:10, below the floor; 52 is the newest sample
});

test('hourlyRows: coverage overlapping an activity window is left out of the histogram and counted in act_min', () => {
  const win = H.activityWindows('date,activity_id,type,max_hr,max_hr_source,hr_avg,hr_max,z0_s,z1_s,z2_s,z3_s,z4_s,z5_s,source,start,elapsed_s\n' +
    '2030-01-02,1,Running,190,observed,150,170,0,0,0,0,0,0,Strava API,2030-01-02T09:05:00+01:00,300\n');
  assert.deepEqual(win, [{ from: Date.parse('2030-01-02T09:05:00+01:00'), to: Date.parse('2030-01-02T09:10:00+01:00') }]);
  // 09:00-09:08 (8 min): 5 min outside, 3 inside; 09:08-09:12 (4 min): 2 inside, 2 outside
  const rows = H.hourlyRows([s('09:00', 90), s('09:08', 150), s('09:12', 95)], win, 'Shortcut');
  const c = cols(rows[0].line);
  assert.equal(c[6], '12.0');
  assert.equal(c[7], '5.0');
  assert.equal(c[8], '90:300 150:120');
});

test('hourlyRows: DST fall-back keeps both 02:00 hours apart (keyed by local hour + offset)', () => {
  const rows = H.hourlyRows([s('02:30', 60, '2030-10-27', '+0200'), s('02:30', 61, '2030-10-27', '+0100')], [], 'Shortcut');
  assert.deepEqual(rows.map(r => cols(r.line)[1]), ['2030-10-27T02:00:00+02:00', '2030-10-27T02:00:00+01:00']);
});

test('activityWindows: rows without a start or elapsed time (older files) are skipped; null text -> []', () => {
  assert.deepEqual(H.activityWindows(null), []);
  assert.deepEqual(H.activityWindows('date,activity_id\n2030-01-02,1,Running,190,observed,,,0,0,0,0,0,0,Strava API\n'), []);
  assert.deepEqual(H.activityWindows('h\n2030-01-02,1,R,190,o,,,0,0,0,0,0,0,S,,600\n'), []);
});

test('hourlyRows: several samples at ONE instant (a band stamps every record at hh:00:00) share its coverage evenly', () => {
  // three records at 09:00 then one at 09:30: the 10-min cap is split 1/3 each, never all to one value
  const [line] = H.hourlyRows([s('09:00', 60), s('09:00', 66), s('09:00', 60), s('09:30', 70)], [], 'Shortcut').map(r => r.line);
  assert.deepEqual(cols(line), ['2030-01-02', '2030-01-02T09:00:00+01:00', '64.0', '70', '60', '4', '10.0', '0.0', '60:400 66:200', 'Shortcut']);
});
