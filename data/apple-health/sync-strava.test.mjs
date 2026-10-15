/* Tests for the Strava sync (ingest service /export/strava -> workouts.csv). Pure functions
 * where possible, SYNTHETIC fixtures (no real personal values), no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as strava from './sync-strava.mjs';
import * as samples from './samples.mjs';
import * as zones from '../../lib/training/hr-zones.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  SPORT_TYPE_MAP, FALLBACK_TYPE, translateType, toRow, buildRows, planSync, syncDir,
  fetchActivities, WORKOUTS_HEADER, WORKOUTS_CSV, staleImageWarning,
  RIDES_CSV, RIDES_HEADER, rideRow, buildRides, stalePowerWarning,
} = strava;

// ---- rides.csv: ride windows + real power for the active-energy correction ----------------

const RIDE = {
  id: '7', start_local: '2026-09-26T09:02:00Z', start_utc: '2026-09-26T07:02:00Z', sport_type: 'Ride',
  moving_time: 19000, elapsed_time: 20811, kilojoules: 2310.7, device_watts: true,
};

test('rides.csv header and file name match lib/health/ride-energy.mjs (the reader)', async () => {
  const lib = await import('../../lib/health/ride-energy.mjs');
  assert.equal(RIDES_HEADER, lib.RIDES_HEADER);
  assert.equal(RIDES_CSV, lib.RIDES_CSV);
});

test('rideRow: local date, ISO start WITH the offset (start_local - start_utc), elapsed s, kJ, device_watts', () => {
  assert.equal(rideRow(RIDE), '2026-09-26,2026-09-26T09:02:00+02:00,20811,2310.7,true,Strava API');
  // winter offset, west of UTC, and a half-hour zone
  assert.equal(rideRow({ ...RIDE, start_local: '2026-12-05T10:00:00Z', start_utc: '2026-12-05T09:00:00Z' }).split(',')[1], '2026-12-05T10:00:00+01:00');
  assert.equal(rideRow({ ...RIDE, start_local: '2026-09-26T06:00:00Z', start_utc: '2026-09-26T10:00:00Z' }).split(',')[1], '2026-09-26T06:00:00-04:00');
  assert.equal(rideRow({ ...RIDE, start_local: '2026-09-26T12:30:00Z', start_utc: '2026-09-26T07:00:00Z' }).split(',')[1], '2026-09-26T12:30:00+05:30');
});

test('rideRow: an old ingest image (no start_utc / device_watts) keeps the row with blanks -> no correction', () => {
  const { start_utc: _u, device_watts: _d, ...old } = RIDE;
  assert.equal(rideRow(old), '2026-09-26,,20811,2310.7,,Strava API');
  assert.equal(rideRow({ ...RIDE, device_watts: false, kilojoules: null }), '2026-09-26,2026-09-26T09:02:00+02:00,20811,,false,Strava API');
  assert.equal(rideRow({ ...RIDE, start_utc: 'garbage' }).split(',')[1], '');
});

test('rideRow: only cycling-family activities with a start and an elapsed time', () => {
  assert.equal(rideRow({ ...RIDE, sport_type: 'Run' }), null);
  assert.ok(rideRow({ ...RIDE, sport_type: 'VirtualRide' }));
  assert.equal(rideRow({ ...RIDE, elapsed_time: 0, moving_time: 0 }), null);
  assert.equal(rideRow({ ...RIDE, start_local: null }), null);
  // no elapsed time -> the moving time is the best window we have
  assert.equal(rideRow({ ...RIDE, elapsed_time: null }).split(',')[2], '19000');
});

test('buildRides: sorted by start, header first', () => {
  const later = { ...RIDE, id: '8', start_local: '2026-09-27T08:00:00Z', start_utc: '2026-09-27T06:00:00Z' };
  assert.equal(buildRides([later, { ...RIDE, sport_type: 'Run' }, RIDE]),
    `${RIDES_HEADER}\n${rideRow(RIDE)}\n${rideRow(later)}\n`);
  assert.equal(buildRides([]), `${RIDES_HEADER}\n`);
});

test('planSync writes rides.csv (full rebuild); never creates an empty one', () => {
  const files = {};
  const plan = planSync([RIDE], (n) => (n in files ? files[n] : null));
  assert.equal(plan.writes[RIDES_CSV], buildRides([RIDE]));
  const none = planSync([{ ...RIDE, sport_type: 'Run' }], () => null);
  assert.equal(none.writes[RIDES_CSV], undefined);
  // an existing file is rewritten (header only) when no ride remains; unchanged -> not written
  assert.equal(planSync([], (n) => (n === RIDES_CSV ? buildRides([RIDE]) : null)).writes[RIDES_CSV], `${RIDES_HEADER}\n`);
  assert.equal(planSync([RIDE], (n) => (n === RIDES_CSV ? buildRides([RIDE]) : null)).writes[RIDES_CSV], undefined);
});

test('planSync records rides.csv in _meta.json (rows.rides + stravaSync.rides: total / power / with start)', () => {
  const { start_utc: _u, ...noStart } = { ...RIDE, id: '9', start_local: '2026-09-28T08:00:00Z' };
  const plan = planSync([RIDE, { ...RIDE, id: '8', start_local: '2026-09-27T08:00:00Z', start_utc: '2026-09-27T06:00:00Z', device_watts: false }, noStart], () => null);
  const meta = JSON.parse(plan.writes['_meta.json']);
  assert.equal(meta.rows.rides, 3);
  assert.deepEqual(meta.stravaSync.rides, { rows: 3, power: 2, withStart: 2 });
  assert.ok(meta.notes.some((n) => /rides\.csv/.test(n)));
});

test('stalePowerWarning: rides with kJ but none carrying device_watts / start_utc -> rebuild hint', () => {
  const { start_utc: _u, device_watts: _d, ...old } = RIDE;
  assert.equal(stalePowerWarning([]), null);
  assert.equal(stalePowerWarning([RIDE]), null);
  assert.equal(stalePowerWarning([{ ...RIDE, device_watts: false }]), null, 'false is a real value');
  assert.equal(stalePowerWarning([{ ...old, sport_type: 'Run' }]), null, 'only rides with kJ count');
  assert.match(stalePowerWarning([old]), /docker compose up -d --build loop-ingest/);
});

// ---- sport_type -> type mapping table ----------------------------------------------------

test('translateType maps known Strava sport types to the HealthKit-style type', () => {
  assert.equal(translateType('Run'), 'Running');
  assert.equal(translateType('TrailRun'), 'Running');
  assert.equal(translateType('VirtualRun'), 'Running');
  assert.equal(translateType('Ride'), 'Cycling');
  assert.equal(translateType('EBikeRide'), 'Cycling');
  assert.equal(translateType('VirtualRide'), 'Cycling');
  assert.equal(translateType('WeightTraining'), 'TraditionalStrengthTraining');
  assert.equal(translateType('HighIntensityIntervalTraining'), 'HighIntensityIntervalTraining');
  assert.equal(translateType('Crossfit'), 'CrossTraining');
  assert.equal(translateType('Walk'), 'Walking');
  assert.equal(translateType('Swim'), 'Swimming');
});

test('translateType falls back to a NON-gym type for an unmapped sport_type without throwing', async () => {
  const { scoreModality } = await import('../../lib/score/modality.mjs');
  const { modalityGroup } = await import('../../lib/training/dashboard.mjs');
  assert.equal(FALLBACK_TYPE, 'Unmapped');
  for (const t of ['SomeNewSport', null, undefined]) assert.equal(translateType(t), FALLBACK_TYPE);
  assert.equal(scoreModality(FALLBACK_TYPE), 'other', 'an unknown sport never counts as gym load');
  assert.equal(modalityGroup(FALLBACK_TYPE), 'other');
  assert.ok(SPORT_TYPE_MAP.Run, 'sanity: the table itself is non-empty');
});

test('racket and team sports map to Apple-style types in the `other` modality', async () => {
  const { scoreModality } = await import('../../lib/score/modality.mjs');
  const { modalityGroup } = await import('../../lib/training/dashboard.mjs');
  assert.equal(translateType('Tennis'), 'Tennis', 'the Watch exports tennis as "Tennis"');
  for (const sport of ['Tennis', 'TableTennis', 'Squash', 'Badminton', 'Racquetball', 'Padel', 'Pickleball', 'Soccer', 'Basketball', 'Volleyball', 'Golf']) {
    const t = translateType(sport);
    assert.ok(Object.prototype.hasOwnProperty.call(SPORT_TYPE_MAP, sport), `${sport} is mapped`);
    assert.equal(scoreModality(t), 'other', `${sport} -> ${t} is other on Inicio`);
    assert.equal(modalityGroup(t), 'other', `${sport} -> ${t} is other on Entreno`);
  }
});

test('Strava "Workout" (its generic type, where a Watch "Other" workout lands) keeps the Watch\'s gym label', async () => {
  const { scoreModality } = await import('../../lib/score/modality.mjs');
  assert.equal(translateType('Workout'), 'Other');
  assert.equal(scoreModality('Other'), 'gym');
});

test('every mapped type lands where its name says: no racket/outdoor sport is ever gym, run or bike by accident', async () => {
  const { scoreModality } = await import('../../lib/score/modality.mjs');
  const GYMISH = new Set(['WeightTraining', 'HighIntensityIntervalTraining', 'Crossfit', 'Workout']);
  for (const [sport, t] of Object.entries(SPORT_TYPE_MAP)) {
    const m = scoreModality(t);
    if (/Run$/.test(sport)) assert.equal(m, 'run', sport);
    else if (/Ride$|Handcycle|Velomobile/.test(sport)) assert.equal(m, 'bike', sport);
    else if (GYMISH.has(sport)) assert.equal(m, 'gym', sport);
    else assert.equal(m, 'other', sport);
  }
});

test('a Watch Tennis row and a Strava Tennis row on the same day merge into ONE session', async () => {
  const { parseWorkouts, mergeKey } = await import('../../lib/training/dashboard.mjs');
  const { mergeSameDay, DISPLAY_RULE } = await import('../../lib/training/sessions.mjs');
  const strava = toRow({ id: '9', start_local: '2026-08-22T18:00:00', sport_type: 'Tennis', moving_time: 3600, average_heartrate: 140, suffer_score: 30 });
  const watch = '2026-08-22,Tennis,62,,138,90,170,Apple\u00a0Watch de Demo,,,,';
  const rows = parseWorkouts([WORKOUTS_HEADER, watch, strava.line].join('\n'));
  const groups = mergeSameDay(rows, mergeKey, DISPLAY_RULE);
  assert.equal(groups.length, 1, 'one session for the day');
  assert.deepEqual(groups[0].rows.map(r => r.source), ['Strava API'], 'the Strava copy supersedes the Watch copy');
});

// ---- toRow: moving vs elapsed, blanks, 9-column shape, invalid input -> null -------------

test('toRow prefers moving_time over elapsed_time, converts to minutes (2 decimals)', () => {
  const r = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1830, elapsed_time: 2000 });
  assert.equal(r.date, '2026-08-20');
  assert.match(r.line, /^2026-08-20,Running,30\.5,,,,,Strava API,,,,$/);
});

test('toRow falls back to elapsed_time when moving_time is missing or zero', () => {
  const missing = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', elapsed_time: 1200 });
  assert.match(missing.line, /^2026-08-20,Running,20,/);
  const zero = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 0, elapsed_time: 600 });
  assert.match(zero.line, /^2026-08-20,Running,10,/);
});

test('toRow blanks HR/distance when absent, fills them (rounded/2dp) when present', () => {
  const noHr = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 3600 });
  assert.equal(noHr.line, '2026-08-20,Cycling,60,,,,,Strava API,,,,');
  const withHrDist = toRow({
    id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 3600,
    average_heartrate: 142.6, max_heartrate: 171.2, distance: 25123.456,
  });
  assert.equal(withHrDist.line, '2026-08-20,Cycling,60,,143,,171,Strava API,25.12,,,');
});

test('toRow produces a 12-column CSV row matching WORKOUTS_HEADER', () => {
  const r = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 600, average_heartrate: 140, max_heartrate: 160, distance: 2000 });
  assert.equal(r.line.split(',').length, 12);
  assert.equal(WORKOUTS_HEADER.split(',').length, 12);
  assert.equal(WORKOUTS_HEADER, samples.WORKOUTS_HEADER, 'one shared header constant');
  assert.match(WORKOUTS_HEADER, /,distance_km,relative_effort,kilojoules,elevation_m$/);
});

test('toRow writes relative_effort (suffer_score) and kilojoules; blank when absent; 0 is kept', () => {
  const base = { id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800 };
  assert.equal(toRow({ ...base, suffer_score: 87 }).line, '2026-08-20,Running,30,,,,,Strava API,,87,,');
  assert.equal(toRow({ ...base, suffer_score: 0, kilojoules: 0 }).line, '2026-08-20,Running,30,,,,,Strava API,,0,0,');
  assert.equal(toRow({ ...base, suffer_score: 87.4, kilojoules: 640.55 }).line, '2026-08-20,Running,30,,,,,Strava API,,87,640.55,');
  assert.equal(toRow({ ...base, suffer_score: null, kilojoules: null }).line, '2026-08-20,Running,30,,,,,Strava API,,,,');
});

test('toRow writes total_elevation_gain as elevation_m (1 decimal); blank when absent; 0 is kept', () => {
  const base = { start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 3600 };
  assert.equal(toRow({ ...base, total_elevation_gain: 412.37 }).line, '2026-08-20,Cycling,60,,,,,Strava API,,,,412.4');
  assert.equal(toRow({ ...base, total_elevation_gain: 0 }).line, '2026-08-20,Cycling,60,,,,,Strava API,,,,0');
  assert.equal(toRow({ ...base, total_elevation_gain: null }).line, '2026-08-20,Cycling,60,,,,,Strava API,,,,');
});

test('planSync: a 9-column CSV merges under the 12-col header; old rows are kept verbatim (mixed width)', () => {
  const oldHeader = 'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km';
  const files = { [WORKOUTS_CSV]: [oldHeader, '2026-08-20,Running,30,,140,,165,Watch,5'].join('\n') + '\n' };
  const plan = planSync([{ id: '2', start_local: '2026-08-21T07:00:00', sport_type: 'Run', moving_time: 1800, suffer_score: 55 }], (n) => files[n] ?? null);
  const lines = plan.writes[WORKOUTS_CSV].trim().split('\n');
  assert.equal(lines[0], WORKOUTS_HEADER);
  assert.ok(lines.includes('2026-08-20,Running,30,,140,,165,Watch,5'), 'old 9-col row untouched');
  assert.ok(lines.includes('2026-08-21,Running,30,,,,,Strava API,,55,,'));
});

test('toRow returns null when there is no usable duration (skip the activity, not the sync)', () => {
  assert.equal(toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run' }), null);
  assert.equal(toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 0, elapsed_time: 0 }), null);
  assert.equal(toRow({ id: '1', start_local: null, sport_type: 'Run', moving_time: 600 }), null, 'no start_local -> no date -> skip');
});

test('toRow slices start_local as plain text regardless of trailing Z or a UTC offset', () => {
  const withZ = toRow({ id: '1', start_local: '2026-08-20T07:00:00Z', sport_type: 'Run', moving_time: 600 });
  const withOffset = toRow({ id: '2', start_local: '2026-08-20T07:00:00+02:00', sport_type: 'Run', moving_time: 600 });
  assert.equal(withZ.date, '2026-08-20');
  assert.equal(withOffset.date, '2026-08-20');
});

// ---- buildRows: aggregates unmapped + dropped counts, tags each row with hasHr -----------

test('buildRows counts unmapped sport types and dropped (durationless/dateless) activities', () => {
  const out = buildRows([
    { id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800, average_heartrate: 140 },
    { id: '2', start_local: '2026-08-21T07:00:00', sport_type: 'Kickball', moving_time: 1200 },
    { id: '3', start_local: '2026-08-22T07:00:00', sport_type: 'Ride', moving_time: 0, elapsed_time: 0 },
    { id: '4', start_local: null, sport_type: 'Run', moving_time: 600 },
  ]);
  assert.equal(out.rows.length, 2, 'the durationless/dateless activities are skipped entirely');
  assert.deepEqual(out.unmapped, { Kickball: 1 });
  assert.equal(out.dropped, 2, 'activity 3 (no duration) and activity 4 (no date) are both dropped');
});

test('buildRows tags each row with whether it has HR (for post-merge noHr accounting)', () => {
  const out = buildRows([
    { id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800, average_heartrate: 140 },
    { id: '2', start_local: '2026-08-21T07:00:00', sport_type: 'Run', moving_time: 1800 },
  ]);
  assert.deepEqual(out.rows.map((r) => r.hasHr), [true, false]);
});

test('buildRows falls back to a "null" unmapped key when sport_type is missing', () => {
  const out = buildRows([{ id: '1', start_local: '2026-08-20T07:00:00', sport_type: undefined, moving_time: 600 }]);
  assert.deepEqual(out.unmapped, { null: 1 });
});

// ---- merge: Strava API rows are ALWAYS kept (dedupe happens at read time), historical Strava rows
// survive, same-day kept, idempotent, orphan ----

test('planSync: a date the export covers keeps BOTH the export row and the Strava row', () => {
  const files = { [WORKOUTS_CSV]: [WORKOUTS_HEADER, '2026-08-20,Cycling,62,,140,,165,Watch,20'].join('\n') + '\n' };
  const read = (name) => files[name] ?? null;
  const activities = [
    { id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 3600, suffer_score: 40 },
    { id: '2', start_local: '2026-08-21T07:00:00', sport_type: 'Ride', moving_time: 1800 }
  ];
  const plan = planSync(activities, read);
  const text = plan.writes[WORKOUTS_CSV];
  assert.match(text, /2026-08-20,Cycling,62,,140,,165,Watch,20/, 'the export row survives');
  assert.match(text, /2026-08-20,Cycling,60,,,,,Strava API,,40,,/, 'the Strava row on the covered date is kept (it carries the RE)');
  assert.match(text, /2026-08-21,Cycling,30,,,,,Strava API,/, 'the uncovered date is added');
  assert.deepEqual(JSON.parse(plan.writes['_meta.json']).stravaSync.owned[WORKOUTS_CSV], ['2026-08-20', '2026-08-21']);
});

test('planSync: a later export rewrite followed by a sync restores every Strava row, whatever the export covers', () => {
  const activities = [{ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'HighIntensityIntervalTraining', moving_time: 3000, suffer_score: 55 }];
  const files = {};
  const read = (name) => files[name] ?? null;
  Object.assign(files, planSync(activities, read).writes);
  // extract.mjs rewrites workouts.csv from a fresh export that now has a Watch row on the same date
  files[WORKOUTS_CSV] = [WORKOUTS_HEADER, '2026-08-20,HighIntensityIntervalTraining,52,,130,,170,Watch,,,,'].join('\n') + '\n';
  Object.assign(files, planSync(activities, read).writes);
  assert.match(files[WORKOUTS_CSV], /2026-08-20,HighIntensityIntervalTraining,50,,,,,Strava API,,55,,/);
  assert.match(files[WORKOUTS_CSV], /,Watch,/);
});

test('planSync: historical source=Strava rows (not Strava API) survive untouched', () => {
  const files = { [WORKOUTS_CSV]: [WORKOUTS_HEADER, '2026-08-15,Running,25,,,,,Strava,4'].join('\n') + '\n' };
  const read = (name) => files[name] ?? null;
  const plan = planSync([], read);
  assert.ok(!plan.writes[WORKOUTS_CSV] || plan.writes[WORKOUTS_CSV].includes('2026-08-15,Running,25,,,,,Strava,4'));
});

// ---- crash-window safety: the merge must drop a row ONLY by its exact source tag, never by a
// ledger date, so a stale/mismatched ledger (e.g. from a crash between extract.mjs's CSV write
// and its _meta.json write) can never delete a real export/manual row. The ledger stays pure
// reporting metadata. ----

test('planSync: a ledger claiming a date must not delete a non-Strava row on that date', () => {
  const files = {
    [WORKOUTS_CSV]: [WORKOUTS_HEADER, '2026-08-20,Running,30,,140,,165,Watch,5'].join('\n') + '\n',
    '_meta.json': JSON.stringify({ rows: {}, ranges: {}, notes: [], stravaSync: { owned: { [WORKOUTS_CSV]: ['2026-08-20'] } } })
  };
  const read = (name) => files[name] ?? null;
  // force a write so the merged text is actually inspectable
  const plan = planSync([{ id: '1', start_local: '2026-08-21T07:00:00', sport_type: 'Ride', moving_time: 1800 }], read);
  assert.match(plan.writes[WORKOUTS_CSV], /2026-08-20,Running,30,,140,,165,Watch,5/, 'the ledgered-but-non-Strava row must survive');
});

test('planSync: simulated crash (fresh export CSV, stale pre-crash ledger in _meta.json) never drops the fresh export row', () => {
  const files = {
    // extract.mjs already rewrote workouts.csv with a fresh export row on 08-20...
    [WORKOUTS_CSV]: [WORKOUTS_HEADER, '2026-08-20,Running,28,,138,,162,W,5.1'].join('\n') + '\n',
    // ...but _meta.json still carries the OLD ledger from BEFORE the crash (claims 08-20 + 08-21 as Strava-owned)
    '_meta.json': JSON.stringify({ rows: {}, ranges: {}, notes: [], stravaSync: { owned: { [WORKOUTS_CSV]: ['2026-08-20', '2026-08-21'] } } })
  };
  const read = (name) => files[name] ?? null;
  const plan = planSync([{ id: '1', start_local: '2026-08-21T07:00:00', sport_type: 'Ride', moving_time: 1800 }], read);
  assert.match(plan.writes[WORKOUTS_CSV], /2026-08-20,Running,28,,138,,162,W,5\.1/, 'the fresh export row must survive the stale ledger');
});

test('planSync: same-day activities (no export coverage) are all kept as separate rows', () => {
  const activities = [
    { id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800 },
    { id: '2', start_local: '2026-08-20T18:00:00', sport_type: 'Ride', moving_time: 3600 },
  ];
  const plan = planSync(activities, () => null);
  const lines = plan.writes[WORKOUTS_CSV].trim().split('\n').slice(1);
  assert.equal(lines.filter((l) => l.startsWith('2026-08-20,')).length, 2);
});

test('planSync: a second run with unchanged activities is byte-identical', () => {
  const activities = [{ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800 }];
  const files = {};
  const read = (name) => files[name] ?? null;
  Object.assign(files, planSync(activities, read).writes);
  const again = planSync(activities, read);
  assert.deepEqual(again.writes, {}, 'no changes on a second identical run');
});

test('planSync: a simulated re-export (activities fetched again) creates no duplicate rows', () => {
  const activities = [{ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800 }];
  const files = {};
  const read = (name) => files[name] ?? null;
  Object.assign(files, planSync(activities, read).writes);
  Object.assign(files, planSync(activities, read).writes);
  const count = (files[WORKOUTS_CSV].match(/2026-08-20/g) || []).length;
  assert.equal(count, 1);
});

test('planSync: an edited activity type is updated on the next run', () => {
  const files = {};
  const read = (name) => files[name] ?? null;
  Object.assign(files, planSync([{ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800 }], read).writes);
  Object.assign(files, planSync([{ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 1800 }], read).writes);
  assert.match(files[WORKOUTS_CSV], /2026-08-20,Cycling,/);
  assert.doesNotMatch(files[WORKOUTS_CSV], /2026-08-20,Running,/);
});

test('planSync: an existing shortcutSync ledger in _meta.json is preserved', () => {
  const files = { '_meta.json': JSON.stringify({ rows: {}, ranges: {}, notes: [], shortcutSync: { payloads: 3, added: {} } }) };
  const read = (name) => files[name] ?? null;
  const plan = planSync([{ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800 }], read);
  const meta = JSON.parse(plan.writes['_meta.json']);
  assert.deepEqual(meta.shortcutSync, { payloads: 3, added: {} });
  assert.ok(meta.stravaSync);
});

test('planSync writes nothing at all when there is no data and no existing files', () => {
  const plan = planSync([], () => null);
  assert.deepEqual(plan.writes, {});
});

test('orphan safety: a CSV with a Strava API row on D2 but a ledger without D2 is rebuilt (not silently kept)', () => {
  const files = {
    [WORKOUTS_CSV]: [WORKOUTS_HEADER, '2026-08-22,Running,15,,,,,Strava API,2'].join('\n') + '\n',
    '_meta.json': JSON.stringify({ rows: {}, ranges: {}, notes: [], stravaSync: { owned: { [WORKOUTS_CSV]: [] } } }),
  };
  const read = (name) => files[name] ?? null;
  // the current stored activity for D2 has a DIFFERENT duration than the stale CSV row
  const plan = planSync([{ id: '9', start_local: '2026-08-22T07:00:00', sport_type: 'Run', moving_time: 3000 }], read);
  assert.match(plan.writes[WORKOUTS_CSV], /2026-08-22,Running,50,/, 'rebuilt from the current activity, not kept stale');
  assert.doesNotMatch(plan.writes[WORKOUTS_CSV], /2026-08-22,Running,15,/);
});

test('unmapped and noHr counts land in _meta.json stravaSync', () => {
  const plan = planSync([
    { id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800 },
    { id: '2', start_local: '2026-08-21T07:00:00', sport_type: 'Frisbee', moving_time: 1200 },
  ], () => null);
  const meta = JSON.parse(plan.writes['_meta.json']);
  assert.deepEqual(meta.stravaSync.unmapped, { Frisbee: 1 });
  assert.equal(meta.stravaSync.noHr, 2);
  assert.equal(meta.stravaSync.dropped, 0);
});

test('noHr in _meta.json counts every written HR-less row, never an activity dropped for lacking a duration', () => {
  const files = { [WORKOUTS_CSV]: [WORKOUTS_HEADER, '2026-08-20,Running,30,,140,,165,Watch,5'].join('\n') + '\n' };
  const read = (name) => files[name] ?? null;
  const plan = planSync([
    { id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 1800 }, // export-covered date, still WRITTEN, no HR -> counts
    { id: '2', start_local: '2026-08-21T07:00:00', sport_type: 'Ride', moving_time: 1800, average_heartrate: 140 }, // has HR -> not counted
    { id: '3', start_local: '2026-08-22T07:00:00', sport_type: 'Run' } // no duration -> DROPPED before merge entirely
  ], read);
  const meta = JSON.parse(plan.writes['_meta.json']);
  assert.equal(meta.stravaSync.noHr, 1, 'only the written HR-less row counts, not the duration-dropped activity');
  assert.equal(meta.stravaSync.dropped, 1, 'the durationless activity is counted as dropped');
});

// ---- fetchActivities: paging, timeout, non-array, 404 message ---------------------------

function fakeFetch(pages, calls) {
  return async (url, opts) => {
    calls.push({ url: String(url), auth: opts.headers.authorization });
    const since = Number(new URL(url).searchParams.get('since_id'));
    const body = pages.filter((p) => Number(p.id) > since).slice(0, 2);
    return { ok: true, status: 200, json: async () => body };
  };
}

test('fetchActivities pages by since_id until a short page, hitting /export/strava', async () => {
  const pages = [1, 2, 3].map((id) => ({ id: String(id), start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 60 }));
  const calls = [];
  const out = await fetchActivities({ baseUrl: 'http://h:1', token: 'tok', limit: 2, fetchImpl: fakeFetch(pages, calls) });
  assert.equal(out.length, 3);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/export\/strava\?since_id=0&limit=2$/);
  assert.equal(calls[0].auth, 'Bearer tok');
});

test('fetchActivities rejects a non-array response', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) });
  await assert.rejects(fetchActivities({ baseUrl: 'http://h', token: 't', fetchImpl }), /expected an array/);
});

test('fetchActivities times out a hung request with a clear error', async () => {
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(fetchActivities({ baseUrl: 'http://h', token: 't', timeoutMs: 20, fetchImpl }), /timed out/);
});

test('fetchActivities surfaces a 404 distinctly (old ingest image) via err.status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(fetchActivities({ baseUrl: 'http://h', token: 't', fetchImpl }), (err) => err.status === 404);
});

// ---- disk: writes nothing when unreachable/no token; atomic writes; extract.mjs contract -

test('syncDir writes _meta.json and workouts.csv atomically (temp+rename, no leftovers)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-atomic-'));
  syncDir(dir, [{ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800 }]);
  const names = fs.readdirSync(dir).sort();
  assert.deepEqual(names, ['_meta.json', 'workouts.csv']);
  fs.rmSync(dir, { recursive: true });
});

test('syncDir writes _meta.json before workouts.csv (belt and braces against a crash mid-write)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-order-'));
  const order = [];
  syncDir(dir, [{ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800 }], {
    writeAtomic: (file) => order.push(path.basename(file)),
  });
  assert.deepEqual(order, ['_meta.json', 'workouts.csv']);
  fs.rmSync(dir, { recursive: true });
});

test('contract: an extract.mjs rewrite drops the CSV/ledger; the next Strava sync restores uncovered dates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-contract-'));
  fs.writeFileSync(path.join(dir, 'export.xml'),
    '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2026-08-18 08:00:00 +0100" duration="20" sourceName="W"></Workout>\n');
  const extract = () => execFileSync(process.execPath, [path.join(__dirname, 'extract.mjs')], { stdio: 'ignore', env: { ...process.env, EXTRACT_DIR: dir } });
  const out = path.join(dir, 'extract');
  const read = (f) => fs.readFileSync(path.join(out, f), 'utf8');

  const activities = [{ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 1800 }];

  extract();
  syncDir(out, activities);
  assert.match(read(WORKOUTS_CSV), /2026-08-18,Running,20,/, 'the export row survives');
  assert.match(read(WORKOUTS_CSV), /2026-08-20,Cycling,30,/, 'the uncovered Strava date is added');
  const beforeReextract = read(WORKOUTS_CSV);

  extract(); // a fresh export drop rewrites the CSV + _meta.json, dropping the Strava rows + ledger
  assert.doesNotMatch(read(WORKOUTS_CSV), /Strava API/);

  syncDir(out, activities); // nothing changed on Strava's side -> rebuilt from the fresh pull alone
  assert.equal(read(WORKOUTS_CSV), beforeReextract);
  fs.rmSync(dir, { recursive: true });
});

// ---- end-to-end: an unmapped Strava sport_type -> Unmapped -> the dashboard's 'other' bucket ----

test('end-to-end: an unmapped sport_type lands in the dashboard other bucket, never in gym', async () => {
  const { parseWorkouts, aggregateDashboard } = await import('../../lib/training/dashboard.mjs');
  const row = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Curling', moving_time: 1800 });
  assert.match(row.line, /^2026-08-20,Unmapped,/);
  const dash = aggregateDashboard(parseWorkouts([WORKOUTS_HEADER, row.line].join('\n')));
  const other = dash.modality.find((m) => m.key === 'other');
  assert.ok(other, 'the unmapped-type row must show up in the other bucket');
  assert.equal(other.min, 30);
  assert.ok(!dash.modality.find((m) => m.key === 'hiit' && m.min > 0), 'nothing in gym');
});

// ---- main() error paths via a real child process: no token / unreachable service / 404 old
// image must all exit 1 and touch NO file. SYNC_STRAVA_OUT_DIR/INGEST_ENV_FILE point main() at
// disposable tmp paths instead of the real personal extract dir / the real service .env. ----

const SCRIPT = path.join(__dirname, 'sync-strava.mjs');
const SCRIPT_URL = pathToFileURL(SCRIPT).href;

function runScript (env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-strava-main-'));
  const outDir = path.join(dir, 'extract'); // deliberately not pre-created
  const envFile = path.join(dir, 'no-such.env'); // deliberately missing -> no token from file
  try {
    execFileSync(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH, SYNC_STRAVA_OUT_DIR: outDir, INGEST_ENV_FILE: envFile, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, outDir };
  } catch (err) {
    return { status: err.status, stderr: err.stderr.toString(), outDir };
  }
}

test('main(): missing token -> exit 1, no files written', () => {
  const { status, stderr, outDir } = runScript({});
  assert.equal(status, 1);
  assert.match(stderr, /no ingest token/);
  assert.ok(!fs.existsSync(outDir), 'the out dir must never be created when there is no token');
});

test('main(): unreachable ingest service (no listener on the port) -> exit 1, no files written, cause code surfaced (not bare "fetch failed")', () => {
  // a real, syntactically valid port with nothing bound to it -> the child's own OS-level TCP
  // connect gets refused; this does NOT depend on reaching a server hosted by another process.
  const { status, stderr, outDir } = runScript({ INGEST_TOKEN: 'a'.repeat(64), INGEST_URL: 'http://127.0.0.1:48231' });
  assert.equal(status, 1);
  assert.doesNotMatch(stderr, /\(fetch failed\)/, 'must not surface the bare undici message');
  assert.match(stderr, /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|refused/i);
  assert.ok(!fs.existsSync(outDir), 'no file must be written when the service is unreachable');
});

test('main(): 404 from an old ingest image -> exit 1, no files written, clear rebuild message', () => {
  // The sandbox isolates localhost between sibling processes (a server hosted by THIS test
  // process is unreachable from a plain execFileSync child — verified: the child times out
  // rather than connecting). So the 404 server is started INSIDE the same child process that
  // then calls main(), via a small harness script — still "via child process" end-to-end.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-strava-404-'));
  const outDir = path.join(dir, 'extract');
  const envFile = path.join(dir, 'no-such.env');
  const harness = path.join(dir, 'harness.mjs');
  fs.writeFileSync(harness, `
    import http from 'node:http';
    const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    server.listen(0, '127.0.0.1', async () => {
      process.env.INGEST_URL = 'http://127.0.0.1:' + server.address().port;
      (await import(${JSON.stringify(SCRIPT_URL)})).main();
    });
  `);
  let result;
  try {
    execFileSync(process.execPath, [harness], {
      env: { PATH: process.env.PATH, INGEST_TOKEN: 'a'.repeat(64), SYNC_STRAVA_OUT_DIR: outDir, INGEST_ENV_FILE: envFile },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    result = { status: 0 };
  } catch (err) {
    result = { status: err.status, stderr: err.stderr.toString() };
  }
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rebuild\/restart the loop-ingest container/);
  assert.ok(!fs.existsSync(outDir), 'no file must be written on a 404');
  fs.rmSync(dir, { recursive: true });
});

// ---- stale ingest image: activities come back but none carries total_elevation_gain ------

test('staleImageWarning(): warns only when activities exist and NONE carries total_elevation_gain', () => {
  const act = (extra) => ({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 60, ...extra });
  assert.equal(staleImageWarning([]), null, 'nothing fetched -> nothing to judge');
  assert.equal(staleImageWarning([act({ total_elevation_gain: 0 })]), null, '0 m (indoor ride) is a real value');
  assert.equal(staleImageWarning([act({}), act({ total_elevation_gain: 120 })]), null, 'one activity with the field is enough');
  assert.match(staleImageWarning([act({}), act({})]), /docker compose up -d --build loop-ingest/);
});

test('main(): activities without elevation -> exit 0, rows written, stale-image warning on stderr', () => {
  // same in-child server harness as the 404 test (localhost is isolated between sibling processes)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-strava-stale-'));
  const outDir = path.join(dir, 'extract');
  const envFile = path.join(dir, 'no-such.env');
  const harness = path.join(dir, 'harness.mjs');
  const body = JSON.stringify([{ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 3600, distance: 20000 }]);
  fs.writeFileSync(harness, `
    import http from 'node:http';
    const server = http.createServer((req, res) => {
      const since = Number(new URL(req.url, 'http://x').searchParams.get('since_id'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(since >= 1 ? '[]' : ${JSON.stringify(body)});
    });
    server.listen(0, '127.0.0.1', async () => {
      process.env.INGEST_URL = 'http://127.0.0.1:' + server.address().port;
      await (await import(${JSON.stringify(SCRIPT_URL)})).main();
      server.close();
    });
  `);
  const r = spawnSync(process.execPath, [harness], {
    env: { PATH: process.env.PATH, INGEST_TOKEN: 'a'.repeat(64), SYNC_STRAVA_OUT_DIR: outDir, INGEST_ENV_FILE: envFile },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /ingest image is probably stale/);
  assert.match(r.stderr, /docker compose up -d --build loop-ingest/);
  assert.ok(fs.existsSync(path.join(outDir, WORKOUTS_CSV)), 'the sync still writes its rows');
  fs.rmSync(dir, { recursive: true });
});

// ---- workout-zones.csv: per-activity HR zones from the ingest's hr_hist --------------------

const ZRUN = { id: '31', start_local: '2026-09-29T08:00:00Z', sport_type: 'Run', moving_time: 1800, average_heartrate: 150, max_heartrate: 190, hr_hist: { 150: 1200, 175: 600 } };

test('planSync writes workout-zones.csv from hr_hist and records rows + the max HR in _meta.json', () => {
  const plan = planSync([ZRUN], () => null);
  assert.equal(plan.writes[zones.ZONES_CSV], `${zones.ZONES_HEADER}\n2026-09-29,31,Running,190,observed,150,190,0,0,0,1200,0,600,Strava API,,1800\n`); // 175 / 190 = 92 % -> Z5
  const meta = JSON.parse(plan.writes['_meta.json']);
  assert.equal(meta.rows['workout-zones'], 1);
  assert.deepEqual(meta.stravaSync.zones, { rows: 1, maxHr: 190, maxHrSource: 'observed' });
  const prof = planSync([ZRUN], () => null, { profileMaxHr: 200 });
  assert.match(prof.writes[zones.ZONES_CSV], /,200,profile,/);
});

test('planSync back-compat: no hr_hist (older ingest image) -> no workout-zones.csv and no zones meta; an existing file is rebuilt', () => {
  const { hr_hist: _h, ...old } = ZRUN;
  const plan = planSync([old], () => null);
  assert.equal(plan.writes[zones.ZONES_CSV], undefined);
  assert.equal(JSON.parse(plan.writes['_meta.json']).stravaSync.zones, undefined);
  const stale = `${zones.ZONES_HEADER}\n2026-01-01,1,Running,190,observed,,,1,0,0,0,0,0,Strava API\n`;
  const rebuilt = planSync([old], (n) => (n === zones.ZONES_CSV ? stale : null));
  assert.equal(rebuilt.writes[zones.ZONES_CSV], `${zones.ZONES_HEADER}\n`);
  const same = planSync([ZRUN], (n) => (n === zones.ZONES_CSV ? planSync([ZRUN], () => null).writes[zones.ZONES_CSV] : null));
  assert.equal(same.writes[zones.ZONES_CSV], undefined, 'unchanged -> not rewritten');
});

test('staleZonesWarning: only when NO activity carries the hr_hist key (null = not fetched yet is fine)', () => {
  const { staleZonesWarning } = strava;
  const { hr_hist: _h, ...old } = ZRUN;
  assert.match(staleZonesWarning([old]), /hr_hist/);
  assert.equal(staleZonesWarning([{ ...ZRUN, hr_hist: null }]), null);
  assert.equal(staleZonesWarning([]), null);
});
