/* lib/nutrition/daytype.mjs — today's nutrition day type from today's workouts and the programmed
 * session (the reference the page's client port is checked against). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DETECT, enduranceOf, DAYTYPE_CASES, DAYINPUT_CASES, detectDayType, dayTypeOfWorkouts, dayTypeOfProgram, dayInputFor } from './daytype.mjs';

test('thresholds: only real training counts', () => {
  assert.deepEqual(DETECT, { bikeLongMin: 150, bikeMin: 75, rideMin: 30, gymMin: 20, otherMin: 45, indoorLongMin: 120 });
});

test('gym / run sessions count from 20 min; shorter ones are stubs', () => {
  assert.equal(dayTypeOfWorkouts([{ modality: 'gym', dur: 20 }]).type, 'gym');
  assert.equal(dayTypeOfWorkouts([{ modality: 'run', dur: 50 }]).type, 'run');
  assert.equal(dayTypeOfWorkouts([{ modality: 'gym', dur: 19 }]), null);
  assert.equal(dayTypeOfWorkouts([{ modality: 'run', dur: 8 }]), null);
});

test('"other" (walks, tennis, ...) never raises the day unless it lasts >= 45 min (then gym)', () => {
  assert.equal(dayTypeOfWorkouts([{ modality: 'other', dur: 20 }]), null, 'a 20-min walk is a rest day');
  assert.equal(dayTypeOfWorkouts([{ modality: 'other', dur: 44 }]), null);
  assert.equal(dayTypeOfWorkouts([{ modality: 'other', dur: 45 }]).type, 'gym');
  assert.equal(dayTypeOfWorkouts([{ modality: 'other', dur: 70 }]).type, 'gym', 'tennis 70 min');
});

test('rides: < 30 min ignored, 30-74 indoor, >= 75 bike, >= 150 bikeLong', () => {
  assert.equal(dayTypeOfWorkouts([{ modality: 'bike', dur: 25 }]), null, 'a commute ride is not training');
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'bike', dur: 30 }]), { type: 'indoor', rideMin: null });
  assert.equal(dayTypeOfWorkouts([{ modality: 'bike', dur: 74 }]).type, 'indoor');
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

test('programmed session: bike by durationMin (absent = bike; < 30 min is not training), no kind is gym', () => {
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 200 }), 'bikeLong');
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 90 }), 'bike');
  assert.equal(dayTypeOfProgram({ kind: 'bike' }), 'bike');
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 45 }), 'indoor');
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 20 }), null);
  assert.equal(dayTypeOfProgram({ kind: 'gym' }), 'gym');
  assert.equal(dayTypeOfProgram({ kind: 'run' }), 'run');
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

test('dayInputFor: the timeline wins its dates; other days take DETAIL.sessions (minutes) + TRAINING', () => {
  const sessions = [{ d: '2030-01-05', m: 'bike', min: 170, km: 60 }, { d: '2030-01-06', m: 'other', min: 20 }];
  const input = dayInputFor('2030-01-05', { sessions });
  assert.deepEqual(input, { items: [{ modality: 'bike', dur: 170 }], programmed: null, known: true, inferred: false });
  assert.deepEqual(detectDayType(input), { type: 'bikeLong', why: 'ride', rideMin: 170 }, 'same thresholds as today');
  assert.equal(detectDayType(dayInputFor('2030-01-06', { sessions })).type, 'rest', 'a 20-min walk stays rest');
  const tl = [{ date: '2030-01-05', items: [{ modality: 'gym', dur: 60 }] }];
  assert.deepEqual(dayInputFor('2030-01-05', { timeline: tl, sessions }).items, [{ modality: 'gym', dur: 60 }]);
});

test('dayInputFor: known only with a session, a sleep reading (the Watch was worn) or a programmed session', () => {
  const sleep = { start: '2030-01-01', v: [7, null, 8] };
  assert.equal(dayInputFor('2030-01-01', { sleep }).known, true, 'slept with the Watch, no session = a rest day');
  assert.equal(dayInputFor('2030-01-02', { sleep }).known, false, 'nothing recorded at all');
  assert.equal(dayInputFor('2030-01-09', { sleep }).known, false, 'outside the series');
  assert.equal(dayInputFor('2030-01-02', { training: { '2030-01-02': { kind: 'gym' } } }).known, true);
  assert.equal(dayInputFor('2030-01-02', { sleep: { start: 'bad', v: [1] } }).known, false);
  assert.deepEqual(dayInputFor('2030-01-02'), { items: [], programmed: null, known: false, inferred: false });
  assert.equal(dayInputFor('2030-01-01', { sleep }).inferred, true, 'a rest day assumed from sleep alone');
  assert.equal(dayInputFor('2030-01-02', { training: { '2030-01-02': { kind: 'gym' } } }).inferred, false);
});

test('DAYINPUT_CASES (shared with the client parity test) agree with dayInputFor', () => {
  assert.ok(DAYINPUT_CASES.length >= 6);
  for (const c of DAYINPUT_CASES) assert.deepEqual(dayInputFor(c.date, c.data), c.expect, c.date);
});

test('enduranceOf: the modalities measured by length besides rides (running -> run, swimming -> other)', () => {
  assert.deepEqual(enduranceOf(undefined), []);
  assert.deepEqual(enduranceOf([]), []);
  assert.deepEqual(enduranceOf([{ sport: 'yoga', minutes: 60, perWeek: 3 }, { sport: 'cycling', minutes: 120, perWeek: 2 }]), []);
  assert.deepEqual(enduranceOf([{ sport: 'swimming', minutes: 45, perWeek: 2 }, { sport: 'running', minutes: 50, perWeek: 3 }]), ['run', 'other']);
});

test('enduranceOf knows every sport of lib/nutrition/energy.mjs SPORTS', async () => {
  const { SPORTS } = await import('./energy.mjs');
  for (const sport of Object.keys(SPORTS)) assert.ok(Array.isArray(enduranceOf([{ sport, minutes: 60, perWeek: 1 }])), sport);
});

/* ---------- day types by sport (odd/tasks/nutrition-day-types.md S3, S4) ---------- */
test('S3 strength / hybrid: >= 20 min each; the same day they are summed (hybrid part >= 20 -> hybrid, else gym by the sum)', () => {
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'strength', dur: 20 }]), { type: 'gym', rideMin: null });
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'hybrid', dur: 20 }]), { type: 'hybrid', rideMin: null });
  assert.equal(dayTypeOfWorkouts([{ modality: 'hybrid', dur: 19 }]), null);
  assert.equal(dayTypeOfWorkouts([{ modality: 'strength', dur: 12 }, { modality: 'hybrid', dur: 10 }]).type, 'gym', 'sum 22 min, hybrid part short');
  assert.equal(dayTypeOfWorkouts([{ modality: 'strength', dur: 5 }, { modality: 'hybrid', dur: 19 }]).type, 'gym', 'sum 24 min');
  assert.equal(dayTypeOfWorkouts([{ modality: 'strength', dur: 40 }, { modality: 'hybrid', dur: 25 }]).type, 'hybrid');
  assert.equal(dayTypeOfWorkouts([{ modality: 'strength', dur: 10 }, { modality: 'hybrid', dur: 8 }]), null, 'sum 18 min');
  assert.equal(dayTypeOfWorkouts([{ modality: 'gym', dur: 30 }]).type, 'gym', 'a legacy gym item counts as strength');
  assert.equal(dayTypeOfWorkouts([{ modality: 'gym', dur: 10 }, { modality: 'hybrid', dur: 20 }]).type, 'hybrid');
});

test('S3 runs: >= 20 min -> run; the per-person endurance rule keeps >= 75 min runs bike / bikeLong', async () => {
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'run', dur: 30 }]), { type: 'run', rideMin: null });
  assert.equal(dayTypeOfWorkouts([{ modality: 'run', dur: 19 }]), null);
  assert.equal(dayTypeOfWorkouts([{ modality: 'run', dur: 80 }]).type, 'run', 'no running sport: a long run is still a run day');
  const endurance = enduranceOf([{ sport: 'running', minutes: 80, perWeek: 3 }]);
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'run', dur: 80 }], endurance), { type: 'bike', rideMin: 80 });
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'run', dur: 40 }], endurance), { type: 'run', rideMin: null });
});

test('S3 indoor rides: < 30 ignored, 30-119 indoor, >= 120 the outdoor ride rule', () => {
  assert.equal(dayTypeOfWorkouts([{ modality: 'bike', dur: 25, indoor: true }]), null);
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'bike', dur: 60, indoor: true }]), { type: 'indoor', rideMin: null });
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'bike', dur: 90, indoor: true }]), { type: 'indoor', rideMin: null }, 'a 90-min trainer session is not a road ride');
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'bike', dur: 119, indoor: true }]), { type: 'indoor', rideMin: null });
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'bike', dur: 130, indoor: true }]), { type: 'bike', rideMin: 130 });
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'bike', dur: 160, indoor: true }]), { type: 'bikeLong', rideMin: 160 });
});

test('S3 outdoor rides: < 30 ignored (commute), 30-74 indoor, >= 75 bike, >= 150 bikeLong', () => {
  assert.equal(dayTypeOfWorkouts([{ modality: 'bike', dur: 25 }]), null);
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'bike', dur: 40 }]), { type: 'indoor', rideMin: null });
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'bike', dur: 74 }]), { type: 'indoor', rideMin: null });
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'bike', dur: 90 }]), { type: 'bike', rideMin: 90 });
  assert.deepEqual(dayTypeOfWorkouts([{ modality: 'bike', dur: 160 }]), { type: 'bikeLong', rideMin: 160 });
});

test('S3 RANK: rest < gym < hybrid < indoor < run < bike < bikeLong; the most demanding item wins', async () => {
  const { CLIENT } = await import('./daytype.mjs');
  assert.deepEqual(CLIENT.consts.RANK, { rest: 0, gym: 1, hybrid: 2, indoor: 3, run: 4, bike: 5, bikeLong: 6 });
  assert.equal(dayTypeOfWorkouts([{ modality: 'run', dur: 30 }, { modality: 'bike', dur: 60, indoor: true }]).type, 'run');
  assert.equal(dayTypeOfWorkouts([{ modality: 'strength', dur: 60 }, { modality: 'bike', dur: 45, indoor: true }]).type, 'indoor');
  assert.equal(dayTypeOfWorkouts([{ modality: 'hybrid', dur: 45 }, { modality: 'strength', dur: 30 }]).type, 'hybrid');
});

test('S3 detectDayType: hybrid / indoor / run are workouts without ride minutes (no during-ride fuelling)', () => {
  assert.deepEqual(detectDayType({ items: [{ modality: 'bike', dur: 60, indoor: true }], programmed: null }), { type: 'indoor', why: 'workout', rideMin: null });
  assert.deepEqual(detectDayType({ items: [{ modality: 'hybrid', dur: 50 }], programmed: null }), { type: 'hybrid', why: 'workout', rideMin: null });
  assert.deepEqual(detectDayType({ items: [{ modality: 'run', dur: 45 }], programmed: null }), { type: 'run', why: 'workout', rideMin: null });
});

test('S3 programmed kinds: gym, hybrid, run (endurance rule kept), indoor, bike by durationMin (absent = bike)', () => {
  assert.equal(dayTypeOfProgram({ kind: 'gym' }), 'gym');
  assert.equal(dayTypeOfProgram({ kind: 'hybrid' }), 'hybrid');
  assert.equal(dayTypeOfProgram({ kind: 'indoor' }), 'indoor');
  assert.equal(dayTypeOfProgram({ kind: 'indoor', durationMin: 60 }), 'indoor');
  assert.equal(dayTypeOfProgram({ kind: 'run' }), 'run');
  assert.equal(dayTypeOfProgram({ kind: 'run', durationMin: 100 }), 'run');
  assert.equal(dayTypeOfProgram({ kind: 'run', durationMin: 100 }, ['run']), 'bike');
  assert.equal(dayTypeOfProgram({ kind: 'bike' }), 'bike');
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 45 }), 'indoor');
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 20 }), null);
  assert.equal(dayTypeOfProgram({ kind: 'bike', durationMin: 200 }), 'bikeLong');
  assert.equal(dayTypeOfProgram({ focus: 'x' }), 'gym', 'no kind: gym, as before');
});

test('S4 dayInputFor: a DETAIL bike session of type IndoorCycling is an indoor item; both paths give the same day type', () => {
  const sessions = [{ d: '2030-02-01', m: 'bike', t: 'IndoorCycling', min: 60 }, { d: '2030-02-02', m: 'bike', t: 'Cycling', min: 60 }];
  assert.deepEqual(dayInputFor('2030-02-01', { sessions }).items, [{ modality: 'bike', dur: 60, indoor: true }]);
  assert.deepEqual(dayInputFor('2030-02-02', { sessions }).items, [{ modality: 'bike', dur: 60 }]);
  const fromSessions = detectDayType(dayInputFor('2030-02-01', { sessions }));
  const fromTimeline = detectDayType(dayInputFor('2030-02-01', { timeline: [{ date: '2030-02-01', items: [{ modality: 'bike', dur: 60, re: null, sessions: 1, indoor: true }] }] }));
  assert.deepEqual(fromSessions, fromTimeline);
  assert.equal(fromSessions.type, 'indoor');
  assert.ok(DAYINPUT_CASES.some((c) => c.expect.items.some((it) => it.indoor === true)), 'DAYINPUT_CASES pin the indoor flag');
  assert.ok(DAYTYPE_CASES.some((c) => c.expect.type === 'indoor') && DAYTYPE_CASES.some((c) => c.expect.type === 'hybrid') && DAYTYPE_CASES.some((c) => c.expect.type === 'run'), 'DAYTYPE_CASES cover the new types');
});
