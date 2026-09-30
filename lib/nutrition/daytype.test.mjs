/* lib/nutrition/daytype.mjs — today's nutrition day type from today's workouts and the programmed
 * session (the reference the page's client port is checked against). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DETECT, DAYTYPE_CASES, detectDayType, dayTypeOfWorkouts, dayTypeOfProgram } from './daytype.mjs';

test('thresholds: a ride of >= 150 min is bikeLong, >= 75 min is bike', () => {
  assert.deepEqual(DETECT, { bikeLongMin: 150, bikeMin: 75 });
});

test('workouts: rides by duration; gym / run / other training -> gym; nothing -> null', () => {
  assert.equal(dayTypeOfWorkouts([{ modality: 'bike', dur: 150 }]).type, 'bikeLong');
  assert.equal(dayTypeOfWorkouts([{ modality: 'bike', dur: 149 }]).type, 'bike');
  assert.equal(dayTypeOfWorkouts([{ modality: 'bike', dur: 75 }]).type, 'bike');
  assert.equal(dayTypeOfWorkouts([{ modality: 'bike', dur: 40 }]).type, 'gym', 'a short spin is still training');
  assert.equal(dayTypeOfWorkouts([{ modality: 'run', dur: 50 }]).type, 'gym');
  assert.equal(dayTypeOfWorkouts([{ modality: 'other', dur: 30 }]).type, 'gym');
  assert.equal(dayTypeOfWorkouts([]), null);
  assert.equal(dayTypeOfWorkouts(null), null);
});

test('two-a-days: the most demanding session wins, and the ride minutes ride along', () => {
  const r = dayTypeOfWorkouts([{ modality: 'gym', dur: 60 }, { modality: 'bike', dur: 95 }]);
  assert.deepEqual(r, { type: 'bike', rideMin: 95 });
});

test('programmed session: bike by durationMin (absent = bike), anything else is gym', () => {
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 200 }), 'bikeLong');
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 90 }), 'bike');
  assert.equal(dayTypeOfProgram({ kind: 'bike' }), 'bike');
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 45 }), 'gym');
  assert.equal(dayTypeOfProgram({ kind: 'gym' }), 'gym');
  assert.equal(dayTypeOfProgram({ kind: 'run' }), 'gym');
  assert.equal(dayTypeOfProgram({ focus: 'x' }), 'gym');
  assert.equal(dayTypeOfProgram(null), null);
});

test('detectDayType: done workouts, else the programmed session, else rest; the more demanding of the two wins', () => {
  assert.deepEqual(detectDayType({ items: [], programmed: null }), { type: 'rest', why: 'none', rideMin: null });
  assert.deepEqual(detectDayType({ items: [], programmed: { kind: 'gym' } }), { type: 'gym', why: 'programmed', rideMin: null });
  assert.deepEqual(detectDayType({ items: [{ modality: 'bike', dur: 160 }], programmed: null }), { type: 'bikeLong', why: 'ride', rideMin: 160 });
  assert.deepEqual(detectDayType({ items: [{ modality: 'gym', dur: 60 }], programmed: null }), { type: 'gym', why: 'workout', rideMin: null });
  // gym done this morning, a long ride programmed for later: fuel for the ride
  assert.deepEqual(detectDayType({ items: [{ modality: 'gym', dur: 60 }], programmed: { kind: 'bike', durationMin: 180 } }), { type: 'bikeLong', why: 'programmed', rideMin: null });
  // same demand: what was done wins (its ride minutes are real)
  assert.deepEqual(detectDayType({ items: [{ modality: 'bike', dur: 100 }], programmed: { kind: 'bike' } }), { type: 'bike', why: 'ride', rideMin: 100 });
});

test('DAYTYPE_CASES (shared with the client parity test) all agree with detectDayType', () => {
  assert.ok(DAYTYPE_CASES.length >= 8);
  for (const c of DAYTYPE_CASES) assert.deepEqual(detectDayType(c.input), c.expect, JSON.stringify(c.input));
});
