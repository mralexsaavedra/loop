/* Tests for the Strava sync (ingest service /export/strava -> workouts.csv). Pure functions
 * where possible, SYNTHETIC fixtures (no real personal values), no network. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const strava = require('./sync-strava.js');

const {
  STRAVA_SOURCE, SPORT_TYPE_MAP, translateType, toRow, buildRows, planSync, syncDir,
  fetchActivities, updateMeta, WORKOUTS_HEADER, WORKOUTS_CSV,
} = strava;

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

test('translateType falls back to Other for an unmapped sport_type without throwing', () => {
  assert.equal(translateType('SomeNewSport'), 'Other');
  assert.equal(translateType(null), 'Other');
  assert.equal(translateType(undefined), 'Other');
  assert.ok(SPORT_TYPE_MAP.Run, 'sanity: the table itself is non-empty');
});

// ---- toRow: moving vs elapsed, blanks, 9-column shape, invalid input -> null -------------

test('toRow prefers moving_time over elapsed_time, converts to minutes (2 decimals)', () => {
  const r = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1830, elapsed_time: 2000 });
  assert.equal(r.date, '2026-08-20');
  assert.match(r.line, /^2026-08-20,Running,30\.5,,,,,Strava API,$/);
});

test('toRow falls back to elapsed_time when moving_time is missing or zero', () => {
  const missing = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', elapsed_time: 1200 });
  assert.match(missing.line, /^2026-08-20,Running,20,/);
  const zero = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 0, elapsed_time: 600 });
  assert.match(zero.line, /^2026-08-20,Running,10,/);
});

test('toRow blanks HR/distance when absent, fills them (rounded/2dp) when present', () => {
  const noHr = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 3600 });
  assert.equal(noHr.line, '2026-08-20,Cycling,60,,,,,Strava API,');
  const withHrDist = toRow({
    id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 3600,
    average_heartrate: 142.6, max_heartrate: 171.2, distance: 25123.456,
  });
  assert.equal(withHrDist.line, '2026-08-20,Cycling,60,,143,,171,Strava API,25.12');
});

test('toRow produces a 9-column CSV row', () => {
  const r = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 600, average_heartrate: 140, max_heartrate: 160, distance: 2000 });
  assert.equal(r.line.split(',').length, 9);
});

test('toRow returns null when there is no usable duration (skip the activity, not the sync)', () => {
  assert.equal(toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run' }), null);
  assert.equal(toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 0, elapsed_time: 0 }), null);
  assert.equal(toRow({ id: '1', start_local: null, sport_type: 'Run', moving_time: 600 }), null, 'no start_local -> no date -> skip');
});

// ---- buildRows: aggregates unmapped + noHr counts ----------------------------------------

test('buildRows counts unmapped sport types and rows written without HR, skipping durationless activities', () => {
  const out = buildRows([
    { id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800, average_heartrate: 140 },
    { id: '2', start_local: '2026-08-21T07:00:00', sport_type: 'Kickball', moving_time: 1200 },
    { id: '3', start_local: '2026-08-22T07:00:00', sport_type: 'Ride', moving_time: 0, elapsed_time: 0 },
  ]);
  assert.equal(out.rows.length, 2, 'the durationless activity is skipped entirely');
  assert.deepEqual(out.unmapped, { Kickball: 1 });
  assert.equal(out.noHr, 1, 'the Kickball row has no HR');
});

// ---- merge: export wins by date, historical Strava rows survive, same-day kept, idempotent, orphan ----

test('planSync: export-covered dates win; the export row itself is preserved, only the Strava row is dropped', () => {
  const files = { [WORKOUTS_CSV]: [WORKOUTS_HEADER, '2026-08-20,Running,30,,140,,165,Watch,5'].join('\n') + '\n' };
  const read = (name) => files[name] ?? null;
  const activities = [
    { id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 1800 }, // covered -> dropped
    { id: '2', start_local: '2026-08-21T07:00:00', sport_type: 'Ride', moving_time: 1800 } // uncovered -> forces a write
  ];
  const plan = planSync(activities, read);
  assert.match(plan.writes[WORKOUTS_CSV], /2026-08-20,Running,30,,140,,165,Watch,5/, 'the export row survives');
  assert.doesNotMatch(plan.writes[WORKOUTS_CSV], /2026-08-20,Cycling,.*Strava API/, 'the Strava row for the covered date is dropped');
  assert.match(plan.writes[WORKOUTS_CSV], /2026-08-21,Cycling,30,,,,,Strava API,/, 'the uncovered date is added');
});

test('planSync: historical source=Strava rows (not Strava API) survive untouched', () => {
  const files = { [WORKOUTS_CSV]: [WORKOUTS_HEADER, '2026-08-15,Running,25,,,,,Strava,4'].join('\n') + '\n' };
  const read = (name) => files[name] ?? null;
  const plan = planSync([], read);
  assert.ok(!plan.writes[WORKOUTS_CSV] || plan.writes[WORKOUTS_CSV].includes('2026-08-15,Running,25,,,,,Strava,4'));
});

// ---- crash-window safety: the merge must drop a row ONLY by its exact source tag, never by a
// ledger date, so a stale/mismatched ledger (e.g. from a crash between extract.js's CSV write
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
    // extract.js already rewrote workouts.csv with a fresh export row on 08-20...
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

// ---- disk: writes nothing when unreachable/no token; atomic writes; extract.js contract --

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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

test('contract: an extract.js rewrite drops the CSV/ledger; the next Strava sync restores uncovered dates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-contract-'));
  for (const f of ['extract.js', 'samples.js']) fs.copyFileSync(path.join(__dirname, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'export.xml'),
    '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2026-08-18 08:00:00 +0100" duration="20" sourceName="W"></Workout>\n');
  const extract = () => execFileSync(process.execPath, [path.join(dir, 'extract.js')], { stdio: 'ignore' });
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
