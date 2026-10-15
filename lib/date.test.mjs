/* lib/date.mjs: the ONE set of calendar-date helpers over 'YYYY-MM-DD' strings. UTC math, so neither the
 * host time zone nor a DST change can move a date. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { MS_PER_DAY, isIsoDate, dayDiff, addDays, weekStart } from './date.mjs';

test('MS_PER_DAY is one UTC day', () => {
  assert.equal(MS_PER_DAY, 24 * 60 * 60 * 1000);
});

test('isIsoDate: only a real calendar date in the YYYY-MM-DD shape', () => {
  for (const ok of ['2030-01-01', '2028-02-29', '2030-12-31']) assert.equal(isIsoDate(ok), true, ok);
  for (const bad of ['2030-02-29', '2030-02-31', '2030-13-01', '2030-00-10', '2030-01-00', '2030-1-01', '2030-01-01T00:00:00Z', ' 2030-01-01', '', null, undefined, 20300101, new Date(0)]) {
    assert.equal(isIsoDate(bad), false, String(bad));
  }
});

test('dayDiff: whole days from a to b (b - a); NaN when either is not a date', () => {
  assert.equal(dayDiff('2030-01-01', '2030-01-01'), 0);
  assert.equal(dayDiff('2030-01-01', '2030-01-31'), 30);
  assert.equal(dayDiff('2030-01-31', '2030-01-01'), -30);
  assert.equal(dayDiff('2028-02-28', '2028-03-01'), 2, 'leap day');
  assert.equal(dayDiff('2029-12-31', '2030-01-01'), 1, 'year boundary');
  assert.ok(Number.isNaN(dayDiff('2030-01-01', 'nope')));
  assert.ok(Number.isNaN(dayDiff('2030-13-01', '2030-01-01')));
});

test('addDays: n calendar days later (n < 0 earlier), across months, years and leap days', () => {
  assert.equal(addDays('2030-01-31', 1), '2030-02-01');
  assert.equal(addDays('2030-03-01', -1), '2030-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2029-12-31', 1), '2030-01-01');
  assert.equal(addDays('2030-01-10', 0), '2030-01-10');
  assert.equal(addDays('2030-01-10', -365), '2029-01-10');
});

test('addDays: an invalid date throws a RangeError (never a silent "NaN" date)', () => {
  assert.throws(() => addDays('nope', 1), RangeError);
  assert.throws(() => addDays('2030-13-01', 1), RangeError);
});

test('weekStart: the Monday of the date\'s week; null for an invalid date', () => {
  assert.equal(weekStart('2026-06-24'), '2026-06-22', 'Wednesday');
  assert.equal(weekStart('2026-06-22'), '2026-06-22', 'Monday');
  assert.equal(weekStart('2026-06-28'), '2026-06-22', 'Sunday');
  assert.equal(weekStart('2030-01-01'), '2029-12-31', 'across a year');
  assert.equal(weekStart('nope'), null);
  assert.equal(weekStart('2030-02-30'), null);
});

// DST weeks in Europe/Madrid and America/New_York: a local-midnight implementation shifts by an hour there
test('every helper gives the same answer in any host time zone (DST weeks included)', () => {
  const code = `import('./lib/date.mjs').then((D) => console.log(JSON.stringify([
    D.dayDiff('2030-03-30', '2030-04-01'), D.dayDiff('2030-10-26', '2030-10-28'), D.dayDiff('2030-03-09', '2030-03-11'),
    D.addDays('2030-03-30', 1), D.addDays('2030-10-27', 1), D.addDays('2030-03-10', 1),
    D.weekStart('2030-03-31'), D.weekStart('2030-10-27'), D.isIsoDate('2030-03-31'),
  ])))`;
  const outs = ['UTC', 'Europe/Madrid', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'].map((TZ) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, TZ }, cwd: new URL('..', import.meta.url).pathname });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  });
  assert.deepEqual(JSON.parse(outs[0]), [2, 2, 2, '2030-03-31', '2030-10-28', '2030-03-11', '2030-03-25', '2030-10-21', true]);
  for (const o of outs) assert.equal(o, outs[0]);
});

test('impossible dates in the YYYY-MM-DD shape are rejected, never rolled over (2030-02-31 is not March 3)', () => {
  assert.throws(() => addDays('2030-02-31', 1), RangeError);
  assert.throws(() => addDays('2030-13-01', 1), RangeError);
  assert.throws(() => addDays('2030-04-31', 0), RangeError);
  assert.throws(() => addDays('nope', 1), RangeError);
  assert.ok(Number.isNaN(dayDiff('2030-02-31', '2030-03-05')));
  assert.ok(Number.isNaN(dayDiff('2030-03-05', '2030-02-29')));
  assert.equal(addDays('2028-02-29', 1), '2028-03-01', 'a real leap day is fine');
  assert.equal(dayDiff('2028-02-29', '2028-03-01'), 1);
});

test('addDays: n must be an integer number of days (a string "1" never concatenates to day 11)', () => {
  assert.throws(() => addDays('2026-01-01', /** @type {any} */ ('1')), RangeError);
  assert.throws(() => addDays('2026-01-01', 1.5), RangeError);
  assert.throws(() => addDays('2026-01-01', NaN), RangeError);
  assert.throws(() => addDays('2026-01-01', /** @type {any} */ (undefined)), RangeError);
  assert.equal(addDays('2026-01-01', 0), '2026-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});
