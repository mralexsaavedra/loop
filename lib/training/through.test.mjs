/* Unit tests for lib/training/through.mjs — the day training data is covered through. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainingThrough } from './through.mjs';

const s = (...dates) => dates.map((date) => ({ date, value: 1 }));

test('trainingThrough: the newest day of the Watch\'s own nightly / hourly data (HRV, resting HR, sleep, hourly HR)', () => {
  assert.equal(trainingThrough({ series: { hrv: s('2026-10-12', '2026-10-13'), rhr: s('2026-10-12') }, sleep: s('2026-10-11'), hrHourly: [{ date: '2026-10-10' }] }), '2026-10-13');
  assert.equal(trainingThrough({ series: { hrv: null, rhr: null }, sleep: null, hrHourly: [{ date: '2026-10-09' }, { date: '2026-10-10' }] }), '2026-10-10');
});

test('trainingThrough: no Watch data = null (training then ends at its own last session, as before)', () => {
  assert.equal(trainingThrough({ series: {}, sleep: null, hrHourly: null }), null);
  assert.equal(trainingThrough({}), null);
});
