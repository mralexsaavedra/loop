/* Tests for the Strava sync (ingest service /export/strava -> workouts.csv). Pure functions
 * where possible, SYNTHETIC fixtures (no real personal values), no network. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const strava = require('./sync-strava.js');
const samples = require('./samples.js');

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
  assert.match(r.line, /^2026-08-20,Running,30\.5,,,,,Strava API,,,$/);
});

test('toRow falls back to elapsed_time when moving_time is missing or zero', () => {
  const missing = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', elapsed_time: 1200 });
  assert.match(missing.line, /^2026-08-20,Running,20,/);
  const zero = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 0, elapsed_time: 600 });
  assert.match(zero.line, /^2026-08-20,Running,10,/);
});

test('toRow blanks HR/distance when absent, fills them (rounded/2dp) when present', () => {
  const noHr = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 3600 });
  assert.equal(noHr.line, '2026-08-20,Cycling,60,,,,,Strava API,,,');
  const withHrDist = toRow({
    id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 3600,
    average_heartrate: 142.6, max_heartrate: 171.2, distance: 25123.456,
  });
  assert.equal(withHrDist.line, '2026-08-20,Cycling,60,,143,,171,Strava API,25.12,,');
});

test('toRow produces an 11-column CSV row matching WORKOUTS_HEADER', () => {
  const r = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 600, average_heartrate: 140, max_heartrate: 160, distance: 2000 });
  assert.equal(r.line.split(',').length, 11);
  assert.equal(WORKOUTS_HEADER.split(',').length, 11);
  assert.equal(WORKOUTS_HEADER, samples.WORKOUTS_HEADER, 'one shared header constant');
  assert.match(WORKOUTS_HEADER, /,distance_km,relative_effort,kilojoules$/);
});

test('toRow writes relative_effort (suffer_score) and kilojoules; blank when absent; 0 is kept', () => {
  const base = { id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Run', moving_time: 1800 };
  assert.equal(toRow({ ...base, suffer_score: 87 }).line, '2026-08-20,Running,30,,,,,Strava API,,87,');
  assert.equal(toRow({ ...base, suffer_score: 0, kilojoules: 0 }).line, '2026-08-20,Running,30,,,,,Strava API,,0,0');
  assert.equal(toRow({ ...base, suffer_score: 87.4, kilojoules: 640.55 }).line, '2026-08-20,Running,30,,,,,Strava API,,87,640.55');
  assert.equal(toRow({ ...base, suffer_score: null, kilojoules: null }).line, '2026-08-20,Running,30,,,,,Strava API,,,');
});

test('planSync: a 9-column CSV merges under the 11-col header; old rows are kept verbatim (mixed width)', () => {
  const oldHeader = 'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km';
  const files = { [WORKOUTS_CSV]: [oldHeader, '2026-08-20,Running,30,,140,,165,Watch,5'].join('\n') + '\n' };
  const plan = planSync([{ id: '2', start_local: '2026-08-21T07:00:00', sport_type: 'Run', moving_time: 1800, suffer_score: 55 }], (n) => files[n] ?? null);
  const lines = plan.writes[WORKOUTS_CSV].trim().split('\n');
  assert.equal(lines[0], WORKOUTS_HEADER);
  assert.ok(lines.includes('2026-08-20,Running,30,,140,,165,Watch,5'), 'old 9-col row untouched');
  assert.ok(lines.includes('2026-08-21,Running,30,,,,,Strava API,,55,'));
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
  assert.equal(meta.stravaSync.dropped, 0);
});

test('noHr in _meta.json only counts rows actually WRITTEN, not activities dropped by export-wins or lacking duration', () => {
  const files = { [WORKOUTS_CSV]: [WORKOUTS_HEADER, '2026-08-20,Running,30,,140,,165,Watch,5'].join('\n') + '\n' };
  const read = (name) => files[name] ?? null;
  const plan = planSync([
    { id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Ride', moving_time: 1800 }, // covered date -> DROPPED by merge, no HR either way
    { id: '2', start_local: '2026-08-21T07:00:00', sport_type: 'Ride', moving_time: 1800 }, // uncovered, no HR -> WRITTEN, counts
    { id: '3', start_local: '2026-08-22T07:00:00', sport_type: 'Run' } // no duration -> DROPPED before merge entirely
  ], read);
  const meta = JSON.parse(plan.writes['_meta.json']);
  assert.equal(meta.stravaSync.noHr, 1, 'only the one written HR-less row counts, not the merge-dropped or duration-dropped activities');
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

// ---- end-to-end: an unmapped Strava sport_type -> 'Other' -> the dashboard's 'hiit' bucket ----

test('end-to-end: an unmapped sport_type translates to Other and lands in the dashboard hiit bucket', async () => {
  const { modalityGroup, parseWorkouts, aggregateDashboard } = await import('../../lib/training/dashboard.mjs');
  const row = toRow({ id: '1', start_local: '2026-08-20T07:00:00', sport_type: 'Curling', moving_time: 1800 });
  assert.match(row.line, /^2026-08-20,Other,/);
  assert.equal(modalityGroup('Other'), 'hiit');
  const parsed = parseWorkouts([WORKOUTS_HEADER, row.line].join('\n'));
  const dash = aggregateDashboard(parsed);
  const hiit = dash.modality.find((m) => m.key === 'hiit');
  assert.ok(hiit, 'the unmapped-type row must show up in the hiit bucket');
  assert.equal(hiit.min, 30);
});

// ---- main() error paths via a real child process: no token / unreachable service / 404 old
// image must all exit 1 and touch NO file. SYNC_STRAVA_OUT_DIR/INGEST_ENV_FILE point main() at
// disposable tmp paths instead of the real personal extract dir / the real service .env. ----

const SCRIPT = path.join(__dirname, 'sync-strava.js');

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
  const harness = path.join(dir, 'harness.js');
  fs.writeFileSync(harness, `
    const http = require('http');
    const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    server.listen(0, '127.0.0.1', () => {
      process.env.INGEST_URL = 'http://127.0.0.1:' + server.address().port;
      require(${JSON.stringify(SCRIPT)}).main();
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
  assert.match(result.stderr, /rebuild\/restart the health-ingest container/);
  assert.ok(!fs.existsSync(outDir), 'no file must be written on a 404');
  fs.rmSync(dir, { recursive: true });
});
