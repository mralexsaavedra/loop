/* Unit tests for lib/score/tonight.mjs — the "Tonight" bedtime rule (usual wake − sleep target). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tonightFromSleep, tonightFrom, TONIGHT_WINDOW, TONIGHT_MIN_NIGHTS } from './tonight.mjs';
import { buildScoresFrom } from './index.mjs';
import { readExtract } from '../extract/read.mjs';
import { SLEEP_TARGET } from '../health/aggregate.mjs';

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const night = (date, waketime, value = 7) => ({ date, value, bedtime: null, waketime });
const nights = (asOf, wakes) => wakes.map((h, i) => night(addDays(asOf, i - (wakes.length - 1)), h));

test('bedtime = median wake of the last 14 nights − the 7.5 h sleep target', () => {
  assert.equal(TONIGHT_WINDOW, 14);
  assert.equal(TONIGHT_MIN_NIGHTS, 7);
  assert.equal(SLEEP_TARGET, 7.5);
  const t = tonightFromSleep(nights('2026-09-28', [7, 7.5, 8, 6.5, 7.25, 7, 9, 7.75, 7.5]));
  assert.equal(t.asOf, '2026-09-28');
  assert.equal(t.wake, 7.5);
  assert.equal(t.bed, 0, '07:30 − 7.5 h = 00:00, wrapped into the day');
  assert.equal(t.target, 7.5);
  assert.equal(t.nights, 9);
  assert.equal(t.window, 14);
});

test('a bedtime before midnight wraps to the evening clock; an even count takes the mean of the middle two', () => {
  const t = tonightFromSleep(nights('2026-09-28', [6.5, 6.5, 6.5, 7, 7, 7, 7, 6]));
  assert.equal(t.wake, 6.75);
  assert.equal(t.bed, 23.25, '06:45 − 7:30 = 23:15 the evening before');
  assert.equal(tonightFromSleep(nights('2026-09-28', [8, 8, 8, 8, 8, 8, 8]), 8).bed, 0);
});

test('only nights inside the 14-day window ending at the newest night count; older ones are ignored', () => {
  const old = nights('2026-09-01', [11, 11, 11, 11, 11, 11, 11, 11]);
  const recent = nights('2026-09-28', [7, 7, 7, 7, 7, 7, 7]);
  const t = tonightFromSleep([...old, ...recent]);
  assert.equal(t.wake, 7);
  assert.equal(t.nights, 7);
});

test('fewer than 7 nights with a wake time in the window → null (the card is hidden)', () => {
  assert.equal(tonightFromSleep(nights('2026-09-28', [7, 7, 7, 7, 7, 7])), null);
  // rows without a wake clock, or no sleep, do not count
  const rows = [...nights('2026-09-28', [7, 7, 7, 7, 7, 7]), night('2026-09-20', null), { date: '2026-09-21', value: 0, waketime: 7 }];
  assert.equal(tonightFromSleep(rows), null);
  assert.equal(tonightFromSleep(null), null);
  assert.equal(tonightFromSleep([]), null);
});

test('wake clocks just before and just after midnight sit together (no 12 h jump in the median)', () => {
  const t = tonightFromSleep(nights('2026-09-28', [23.5, 23.75, 0.25, 0.5, 23.9, 0.1, 0]));
  assert.ok(t.wake < 0.5 || t.wake > 23.5, `median near midnight, got ${t.wake}`);
  assert.equal(t.wake, 0);
  assert.equal(t.bed, 16.5);
});

test('tonightFrom scores the readExtract sleep rows; buildScoresFrom bakes it as SCORES.tonight (null without data)', () => {
  const empty = readExtract(null);
  assert.equal(tonightFrom(empty), null);
  assert.equal(buildScoresFrom(empty).tonight, null);
  const sleep = [];
  for (let i = 7; i >= 0; i--) sleep.push({ ...night(addDays('2026-09-28', -i), 7.25, 7.1), bedtime: 23.5 });
  const t = tonightFrom({ sleep });
  assert.deepEqual(t, { asOf: '2026-09-28', wake: 7.25, bed: 23.75, target: 7.5, nights: 8, window: 14 });
  assert.deepEqual(buildScoresFrom({ ...empty, sleep }).tonight, t);
});
