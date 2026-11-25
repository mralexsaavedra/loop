/* Tests for the Garmin sync (ingest service /export/garmin -> workout-plans.csv). SYNTHETIC fixtures (no real
 * personal values), no network: fetch is a fake. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as garmin from './sync-garmin.mjs';
import { readWorkoutPlans, WORKOUT_PLANS_CSV, WORKOUT_PLANS_HEADER } from '../../lib/training/read.mjs';
import { scoreModality } from '../../lib/training/modality.mjs';

const { garminType, planRow, buildPlans, planGarminSync, fetchGarmin, main } = garmin;

const STEPS = [
  { i: 1, intensity: 'WARMUP', dur_type: 'TIME', dur: 600, target: 'NO_TARGET', low: null, high: null, value: null },
  { i: 2, intensity: 'ACTIVE', dur_type: 'TIME', dur: 4200, target: 'POWER_3S', low: 125, high: 135, value: null },
  { i: 3, intensity: 'COOLDOWN', dur_type: 'TIME', dur: 600, target: 'NO_TARGET', low: null, high: null, value: null },
];
/** @param {Record<string, unknown>} [over] */
const act = (over = {}) => ({
  id: '101', start_local: '2026-09-28T07:30:00', start_utc: '2026-09-28T05:30:00Z', type: 'indoor_cycling',
  duration_s: 3600.4, avg_power: 118.4, norm_power: 121.6, avg_hr: 132.2, max_hr: 160,
  plan_status: 'ok', plan: { steps: STEPS }, ...over,
});

test('garminType: Garmin typeKeys land on the Apple-style types the Strava sync writes (indoor rides apart)', () => {
  assert.equal(garminType('indoor_cycling'), 'IndoorCycling');
  assert.equal(garminType('virtual_ride'), 'IndoorCycling');
  assert.equal(garminType('road_biking'), 'Cycling');
  assert.equal(garminType('cycling'), 'Cycling');
  assert.equal(garminType('gravel_cycling'), 'Cycling');
  assert.equal(garminType('mountain_biking'), 'Cycling');
  assert.equal(garminType('running'), 'Running');
  assert.equal(garminType('treadmill_running'), 'Running');
  assert.equal(garminType('trail_running'), 'Running');
  assert.equal(garminType('strength_training'), 'TraditionalStrengthTraining');
  assert.equal(garminType('something_new'), 'Unmapped');
  assert.equal(garminType('toString'), 'Unmapped', 'own keys only');
  assert.equal(garminType(null), 'Unmapped');
  // the same modality the zone join of the day sheet keys on
  assert.equal(scoreModality(garminType('indoor_cycling')), 'bike');
  assert.equal(scoreModality(garminType('running')), 'run');
});

test('planRow: date, local start WITH its offset, rounded done figures and the steps as CSV-quoted JSON', () => {
  const r = /** @type {NonNullable<ReturnType<typeof planRow>>} */ (planRow(act()));
  assert.equal(r.line, '2026-09-28,2026-09-28T07:30:00+02:00,IndoorCycling,3600,118,122,132,' +
    '"' + JSON.stringify(STEPS).replace(/"/g, '""') + '"');
  // missing figures and an unusable UTC start stay blank
  const blank = /** @type {NonNullable<ReturnType<typeof planRow>>} */ (planRow(act({ start_utc: null, avg_power: null, norm_power: undefined, avg_hr: 'x' })));
  assert.match(blank.line, /^2026-09-28,,IndoorCycling,3600,,,,"/);
});

test('planRow: only activities with plan_status "ok" and a steps array; nothing beyond the contract keys is written', () => {
  assert.equal(planRow(act({ plan_status: 'none', plan: null })), null);
  assert.equal(planRow(act({ plan_status: 'pending', plan: null })), null);
  assert.equal(planRow(act({ plan: null })), null);
  assert.equal(planRow(act({ plan: { steps: [] } })), null);
  assert.equal(planRow(act({ start_local: null })), null);
  assert.equal(planRow(null), null);
  // a server that leaks a name or a note never gets it into the file
  const leaky = act({ workoutName: 'secret', plan: { workoutName: 'secret', steps: [{ ...STEPS[1], notes: 'secret', name: 'secret' }] } });
  const line = /** @type {NonNullable<ReturnType<typeof planRow>>} */ (planRow(leaky)).line;
  assert.doesNotMatch(line, /secret/);
});

test('buildPlans: header first, rows sorted by local start; readWorkoutPlans reads back what was written', () => {
  const text = buildPlans([act({ id: '2', start_local: '2026-09-29T18:00:00', start_utc: '2026-09-29T16:00:00Z', type: 'running' }), act(), act({ id: '3', plan_status: 'none', plan: null })]);
  const lines = text.trim().split('\n');
  assert.equal(lines[0], WORKOUT_PLANS_HEADER);
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^2026-09-28,/);
  assert.match(lines[2], /^2026-09-29,.*,Running,/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-garmin-read-'));
  try {
    fs.writeFileSync(path.join(dir, WORKOUT_PLANS_CSV), text);
    const rows = /** @type {NonNullable<ReturnType<typeof readWorkoutPlans>>} */ (readWorkoutPlans(dir));
    assert.deepEqual(rows.map((r) => [r.date, r.type, r.dur, r.w, r.np, r.hr]), [['2026-09-28', 'IndoorCycling', 3600, 118, 122, 132], ['2026-09-29', 'Running', 3600, 118, 122, 132]]);
    assert.deepEqual(rows[0].steps, STEPS);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('planGarminSync: rebuilds the file; an empty answer (Garmin not configured) never touches an existing file nor creates one', () => {
  assert.deepEqual(planGarminSync([act()], null).rows, 1);
  assert.equal(planGarminSync([act()], 'old').text, buildPlans([act()]));
  assert.equal(planGarminSync([], 'old').text, null, 'kept: stored plans stay (S2 / S4)');
  assert.equal(planGarminSync([], null).text, null, 'never created empty');
  assert.equal(planGarminSync([act({ plan_status: 'none', plan: null })], null).text, null, 'no plan anywhere: no header-only file');
  assert.equal(planGarminSync([act({ plan_status: 'none', plan: null })], 'old').text, `${WORKOUT_PLANS_HEADER}\n`, 'activities but no plan any more: rebuilt');
  assert.equal(planGarminSync([act()], buildPlans([act()])).text, null, 'unchanged: no write');
});

/** @param {Array<{ id: string }>} items @param {string[]} calls @returns {typeof fetch} */
function fakeFetch(items, calls) {
  return /** @type {typeof fetch} */ (/** @type {unknown} */ (async (/** @type {string} */ url, /** @type {{ headers: { authorization: string } }} */ opts) => {
    calls.push(`${url} ${opts.headers.authorization}`);
    const since = Number(new URL(url).searchParams.get('since_id'));
    const limit = Number(new URL(url).searchParams.get('limit'));
    return { ok: true, status: 200, headers: new Headers(), json: async () => items.filter((p) => Number(p.id) > since).slice(0, limit) };
  }));
}

test('fetchGarmin pages by since_id until a short page, hitting /export/garmin with the ingest token', async () => {
  /** @type {string[]} */
  const calls = [];
  const out = await fetchGarmin({ baseUrl: 'http://h:1/', token: 'tok', limit: 2, fetchImpl: fakeFetch([act({ id: '1' }), act({ id: '2' }), act({ id: '3' })], calls) });
  assert.equal(out.length, 3);
  assert.deepEqual(calls, ['http://h:1/export/garmin?since_id=0&limit=2 Bearer tok', 'http://h:1/export/garmin?since_id=2&limit=2 Bearer tok']);
});

// ---- main(): never an error exit for a missing / unconfigured Garmin; a failure leaves the file as it was ----

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-garmin-main-'));
  const outDir = path.join(dir, 'extract');
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const env = { INGEST_URL: 'http://127.0.0.1:9', INGEST_TOKEN: 't', INGEST_ENV_FILE: path.join(dir, 'no.env'), HC_DATA_DIR: path.join(dir, 'root') };
  const file = path.join(outDir, WORKOUT_PLANS_CSV);
  return {
    dir, outDir, out, err, env, file,
    io: { log: (/** @type {string} */ s) => out.push(s), error: (/** @type {string} */ s) => err.push(s) },
    /** @param {number} status @param {unknown} body @returns {typeof fetch} */
    answer: (status, body) => /** @type {typeof fetch} */ (/** @type {unknown} */ (async () => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body }))),
    refused: /** @type {typeof fetch} */ (/** @type {unknown} */ (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); })),
    seed: () => { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(file, 'previous'); },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('main(): pulls /export/garmin and rebuilds workout-plans.csv with the "ok" rows only -> exit 0', async () => {
  const h = harness();
  try {
    h.seed();
    const code = await main({ env: h.env, ...h.io, fetchImpl: h.answer(200, [act(), act({ id: '102', plan_status: 'pending', plan: null })]), outDir: h.outDir });
    assert.equal(code, 0);
    assert.equal(fs.readFileSync(h.file, 'utf8'), buildPlans([act()]));
    assert.match(h.out.join('\n'), /1 planned workout/);
  } finally { h.cleanup(); }
});

test('main(): Garmin not configured on the server ([]), a 404 / 503, a refused connection or no token -> exit 0, the file untouched', async () => {
  const h = harness();
  try {
    h.seed();
    for (const fetchImpl of [h.answer(200, []), h.answer(404, {}), h.answer(503, {}), h.refused]) {
      assert.equal(await main({ env: h.env, ...h.io, fetchImpl, outDir: h.outDir }), 0);
      assert.equal(fs.readFileSync(h.file, 'utf8'), 'previous');
    }
    assert.match(h.err.join('\n'), /no \/export\/garmin/);
    assert.match(h.err.join('\n'), /ECONNREFUSED/);
    assert.doesNotMatch(h.err.join('\n'), /ERROR/, 'a note, never an error');
    const { INGEST_TOKEN: _t, ...noToken } = h.env;
    assert.equal(await main({ env: noToken, ...h.io, fetchImpl: h.answer(200, [act()]), outDir: h.outDir }), 0);
    assert.equal(fs.readFileSync(h.file, 'utf8'), 'previous');
    // and with no file at all, none is created
    fs.rmSync(h.outDir, { recursive: true });
    assert.equal(await main({ env: h.env, ...h.io, fetchImpl: h.answer(200, []), outDir: h.outDir }), 0);
    assert.equal(fs.existsSync(h.file), false);
  } finally { h.cleanup(); }
});
