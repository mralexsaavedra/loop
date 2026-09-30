/* lib/nutrition/daytype.mjs — today's nutrition day type from today's workouts and the programmed
 * session (the reference the page's client port is checked against). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DETECT, DAYTYPE_CASES, detectDayType, dayTypeOfWorkouts, dayTypeOfProgram } from './daytype.mjs';

test('thresholds: only real training counts', () => {
  assert.deepEqual(DETECT, { bikeLongMin: 150, bikeMin: 75, rideMin: 30, gymMin: 20, otherMin: 45 });
});

test('gym / run sessions count from 20 min; shorter ones are stubs', () => {
  assert.equal(dayTypeOfWorkouts([{ modality: 'gym', dur: 20 }]).type, 'gym');
  assert.equal(dayTypeOfWorkouts([{ modality: 'run', dur: 50 }]).type, 'gym');
  assert.equal(dayTypeOfWorkouts([{ modality: 'gym', dur: 19 }]), null);
  assert.equal(dayTypeOfWorkouts([{ modality: 'run', dur: 8 }]), null);
});

test('"other" (walks, tennis, ...) never raises the day unless it lasts >= 45 min (then gym)', () => {
  assert.equal(dayTypeOfWorkouts([{ modality: 'other', dur: 20 }]), null, 'a 20-min walk is a rest day');
  assert.equal(dayTypeOfWorkouts([{ modality: 'other', dur: 44 }]), null);
  assert.equal(dayTypeOfWorkouts([{ modality: 'other', dur: 45 }]).type, 'gym');
  assert.equal(dayTypeOfWorkouts([{ modality: 'other', dur: 70 }]).type, 'gym', 'tennis 70 min');
});

test('rides: < 30 min ignored, 30-74 gym, >= 75 bike, >= 150 bikeLong', () => {
  assert.equal(dayTypeOfWorkouts([{ modality: 'bike', dur: 25 }]), null, 'a commute ride is not training');
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'bike', dur: 30 }]), { type: 'gym', rideMin: null });
  assert.equal(dayTypeOfWorkouts([{ modality: 'bike', dur: 74 }]).type, 'gym');
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'bike', dur: 75 }]), { type: 'bike', rideMin: 75 });
  assert.equal(dayTypeOfWorkouts([{ modality: 'bike', dur: 149 }]).type, 'bike');
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'bike', dur: 150 }]), { type: 'bikeLong', rideMin: 150 });
});

test('stubs and junk are dropped: zero / negative / non-numeric durations, null items', () => {
  assert.equal(dayTypeOfWorkouts([{ modality: 'gym', dur: 0 }, null, { modality: 'bike', dur: -5 }, { modality: 'run', dur: 'x' }]), null);
  assert.equal(dayTypeOfWorkouts([]), null);
  assert.equal(dayTypeOfWorkouts(null), null);
});

test('two-a-days: the most demanding session wins, and the ride minutes ride along', () => {
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'gym', dur: 60 }, { modality: 'bike', dur: 95 }]), { type: 'bike', rideMin: 95 });
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'other', dur: 20 }, { modality: 'bike', dur: 25 }]), null, 'walk + commute = rest');
});

test('programmed session: bike by durationMin (absent = bike; < 30 min is not training), anything else is gym', () => {
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 200 }), 'bikeLong');
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 90 }), 'bike');
  assert.equal(dayTypeOfProgram({ kind: 'bike' }), 'bike');
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 45 }), 'gym');
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 20 }), null);
  assert.equal(dayTypeOfProgram({ kind: 'gym' }), 'gym');
  assert.equal(dayTypeOfProgram({ kind: 'run' }), 'gym');
  assert.equal(dayTypeOfProgram({ focus: 'x' }), 'gym');
  assert.equal(dayTypeOfProgram(null), null);
});

test('detectDayType: done workouts, else the programmed session, else rest; the more demanding of the two wins', () => {
  assert.deepEqual(detectDayType({ items: [], programmed: null }), { type: 'rest', why: 'none', rideMin: null });
  assert.deepEqual(detectDayType({ items: [{ modality: 'other', dur: 20 }], programmed: null }), { type: 'rest', why: 'none', rideMin: null });
  assert.deepEqual(detectDayType({ items: [{ modality: 'bike', dur: 25 }], programmed: null }), { type: 'rest', why: 'none', rideMin: null });
  assert.deepEqual(detectDayType({ items: [{ modality: 'other', dur: 70 }], programmed: null }), { type: 'gym', why: 'workout', rideMin: null });
  assert.deepEqual(detectDayType({ items: [], programmed: { kind: 'gym' } }), { type: 'gym', why: 'programmed', rideMin: null });
  assert.deepEqual(detectDayType({ items: [{ modality: 'bike', dur: 160 }], programmed: null }), { type: 'bikeLong', why: 'ride', rideMin: 160 });
  // gym done this morning, a long ride programmed for later: fuel for the ride
  assert.deepEqual(detectDayType({ items: [{ modality: 'gym', dur: 60 }], programmed: { kind: 'bike', durationMin: 180 } }), { type: 'bikeLong', why: 'programmed', rideMin: null });
  // same demand: what was done wins (its ride minutes are real)
  assert.deepEqual(detectDayType({ items: [{ modality: 'bike', dur: 100 }], programmed: { kind: 'bike' } }), { type: 'bike', why: 'ride', rideMin: 100 });
});

test('DAYTYPE_CASES (shared with the client parity test) cover the edges and all agree with detectDayType', () => {
  assert.ok(DAYTYPE_CASES.length >= 14);
  for (const c of DAYTYPE_CASES) assert.deepEqual(detectDayType(c.input), c.expect, JSON.stringify(c.input));
});
