#!/usr/bin/env node
/* Garmin sync — pulls every stored Garmin activity from the ingest service (services/loop-ingest,
 * GET /export/garmin) and REBUILDS workout-plans.csv: one row per activity that followed a planned
 * (structured) Garmin workout, with what was done (duration, avg / normalized power, avg HR) and the plan's
 * steps. The day sheet shows them as "Plan" vs "Done" on the matching session (lib/detail/detail.mjs).
 *
 *   npm run sync:garmin
 *
 * Optional source: Garmin lives on the server (GARMIN_API_KEY there). This script never fails `npm run sync`:
 * no token, an ingest without /export/garmin (404), a 503, a refused connection or a server without Garmin
 * (an empty answer) is a one-line note and exit 0, and the existing file is kept as it is (stored plans stay).
 *
 * Env    : INGEST_URL, INGEST_TOKEN (resolved like every sync: scripts/lib/sync-common.mjs).
 * Writes : loop-data/extract/workout-plans.csv (temp file + rename), never header-only when it did not exist.
 *
 * Strategy: FULL pull every run, since_id only pages (like sync-strava.mjs); only plan_status "ok" rows are
 * written ("none" = no plan, "pending" = not fetched yet); nothing beyond the contract's step keys is written
 * (no names, no notes). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as common from '../../scripts/lib/sync-common.mjs';
import { localIsoWithOffset, workoutType } from './sync-strava.mjs';
import { WORKOUT_PLANS_CSV, WORKOUT_PLANS_HEADER } from '../../lib/training/read.mjs';
import { isMain } from '../../scripts/lib/is-main.mjs';
import { dataPaths } from '../../lib/paths.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..');
// SYNC_GARMIN_OUT_DIR exists only for tests; default: the extract of lib/paths.mjs (loop-data/, or HC_DATA_DIR)
/** @param {NodeJS.ProcessEnv} env @returns {string} */
const defaultOut = (env) => env.SYNC_GARMIN_OUT_DIR || dataPaths({ repoRoot: ROOT, env }).extractDir;

/** One activity of /export/garmin (untrusted: every field re-checked).
 * @typedef {{id?: unknown, start_local?: unknown, start_utc?: unknown, type?: unknown, duration_s?: unknown,
 *   avg_power?: unknown, norm_power?: unknown, avg_hr?: unknown, max_hr?: unknown, plan_status?: unknown,
 *   plan?: unknown}} GarminActivity */

// Garmin activityType.typeKey -> the Strava sport type (and trainer flag) it is, so the Strava sync's own mapping
// (sync-strava.mjs workoutType: SPORT_TYPE_MAP + the indoor-ride rule) gives the workouts.csv type: a Garmin and a
// Strava copy of one session land in the same modality, and the day sheet joins the plan by date + modality.
// Anything not listed lands on the Strava fallback ("Unmapped", the `other` modality).
/** @type {Record<string, {sport: string, trainer?: boolean}>} */
const GARMIN_TYPE_MAP = {
  cycling: { sport: 'Ride' }, road_biking: { sport: 'Ride' }, gravel_cycling: { sport: 'GravelRide' },
  mountain_biking: { sport: 'MountainBikeRide' }, cyclocross: { sport: 'Ride' }, track_cycling: { sport: 'Ride' },
  e_bike_fitness: { sport: 'EBikeRide' }, e_bike_mountain: { sport: 'EMountainBikeRide' },
  indoor_cycling: { sport: 'Ride', trainer: true }, virtual_ride: { sport: 'VirtualRide' },
  running: { sport: 'Run' }, street_running: { sport: 'Run' }, track_running: { sport: 'Run' },
  treadmill_running: { sport: 'Run' }, indoor_running: { sport: 'Run' }, trail_running: { sport: 'TrailRun' },
  virtual_run: { sport: 'VirtualRun' },
  strength_training: { sport: 'WeightTraining' }, hiit: { sport: 'HighIntensityIntervalTraining' },
  walking: { sport: 'Walk' }, hiking: { sport: 'Hike' },
  lap_swimming: { sport: 'Swim' }, open_water_swimming: { sport: 'Swim' },
  indoor_rowing: { sport: 'Rowing' }, rowing: { sport: 'Rowing' },
  elliptical: { sport: 'Elliptical' }, yoga: { sport: 'Yoga' }, pilates: { sport: 'Pilates' },
};

/** A Garmin typeKey -> the workouts.csv type (Cycling, IndoorCycling, Running... or Unmapped).
 * @param {unknown} typeKey @returns {string} */
function garminType (typeKey) {
  const own = typeof typeKey === 'string' && Object.prototype.hasOwnProperty.call(GARMIN_TYPE_MAP, typeKey);
  const m = own ? GARMIN_TYPE_MAP[/** @type {string} */ (typeKey)] : null;
  return workoutType({ sport_type: m ? m.sport : null, trainer: m ? m.trainer === true : false });
}

/** @param {unknown} v @returns {number | null} */
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** @param {unknown} v */
const intCell = (v) => (numOrNull(v) != null ? Math.round(/** @type {number} */ (v)) : '');

/** An untrusted plan -> its steps with the contract keys only (no names, no notes), or null.
 * @param {unknown} plan @returns {import('../../lib/training/read.mjs').PlanStep[] | null} */
function planSteps (plan) {
  const steps = plan && typeof plan === 'object' ? /** @type {{steps?: unknown}} */ (plan).steps : null;
  if (!Array.isArray(steps) || !steps.length) return null;
  const str = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : null);
  return steps.filter((s) => s && typeof s === 'object').map((s) => ({
    i: numOrNull(s.i), intensity: str(s.intensity) || '', dur_type: str(s.dur_type) || '', dur: numOrNull(s.dur),
    target: str(s.target), low: numOrNull(s.low), high: numOrNull(s.high), value: numOrNull(s.value),
  }));
}

/** One activity -> its workout-plans.csv line (with its local start, for sorting), or null (no plan, no date).
 * @param {GarminActivity | null | undefined} a @returns {{start: string, line: string} | null} */
function planRow (a) {
  if (!a || a.plan_status !== 'ok') return null;
  const startLocal = typeof a.start_local === 'string' ? a.start_local : '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(startLocal)) return null;
  const steps = planSteps(a.plan);
  if (!steps || !steps.length) return null;
  const json = JSON.stringify(steps);
  const line = [startLocal.slice(0, 10), localIsoWithOffset(startLocal, a.start_utc) || '', garminType(a.type),
    intCell(a.duration_s), intCell(a.avg_power), intCell(a.norm_power), intCell(a.avg_hr), '"' + json.replace(/"/g, '""') + '"'].join(',');
  return { start: startLocal, line };
}

/** activities -> the whole workout-plans.csv text (header + the "ok" rows sorted by local start).
 * @param {Array<GarminActivity | null | undefined>} activities @returns {string} */
function buildPlans (activities) {
  const rows = /** @type {Array<{start: string, line: string}>} */ (activities.map(planRow).filter(Boolean))
    .sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : x.line < y.line ? -1 : x.line > y.line ? 1 : 0));
  return [WORKOUT_PLANS_HEADER, ...rows.map((r) => r.line)].join('\n') + '\n';
}

/** Pure: the text to write (null = leave the file as it is) and the row count. An empty answer (a server without
 * Garmin, or nothing stored yet) never touches the file; a file is never created header-only.
 * @param {Array<GarminActivity | null | undefined>} activities @param {string | null} existing
 * @returns {{text: string | null, rows: number}} */
function planGarminSync (activities, existing) {
  const text = buildPlans(activities);
  const rows = text.trim().split('\n').length - 1;
  if (!activities.length) return { text: null, rows };
  if (existing == null && rows === 0) return { text: null, rows };
  return { text: text === existing ? null : text, rows };
}

/** Full pull, paged via since_id, from GET /export/garmin.
 * @param {{baseUrl: string, token: string, limit?: number, timeoutMs?: number, fetchImpl?: typeof fetch}} opts
 * @returns {Promise<GarminActivity[]>} */
function fetchGarmin ({ baseUrl, token, limit = 500, timeoutMs = 15000, fetchImpl = fetch }) {
  return common.fetchPages({
    baseUrl, token, limit, timeoutMs, fetchImpl,
    buildUrl: ({ baseUrl: base, since, limit: lim }) => `${base}/export/garmin?since_id=${since}&limit=${lim}`,
  });
}

const USAGE = `Usage: node data/apple-health/sync-garmin.mjs

Rebuilds workout-plans.csv of the extract from the Garmin activities the ingest service stores (planned workout
vs what was done). Optional: a server without Garmin, or no service at all, is a note and exit 0.
  -h, --help   this help
Env: INGEST_URL, INGEST_TOKEN (else the saved server of \`npm run connect\`, else services/loop-ingest/.env).`;

/** The CLI entry (env / log / error / fetchImpl / outDir injectable for tests). Exit 0 unless the file could not be
 * written.
 * @param {{env?: NodeJS.ProcessEnv, log?: (msg: string) => void, error?: (msg: string) => void, fetchImpl?: typeof fetch, outDir?: string}} [opts]
 * @returns {Promise<number>} */
async function main ({ env = process.env, log = console.log, error = console.error, fetchImpl = fetch, outDir = defaultOut(env) } = {}) {
  const baseUrl = common.readBaseUrl(env);
  const token = common.readIngestToken(env);
  if (!token) {
    error('Note: Garmin sync skipped (no ingest token); workout-plans.csv kept.');
    return 0;
  }
  /** @type {GarminActivity[]} */
  let activities;
  try {
    activities = await fetchGarmin({ baseUrl, token, fetchImpl });
  } catch (e) {
    const err = /** @type {common.SyncError} */ (e);
    if (err.status === 404) error('Note: Garmin sync skipped (the ingest service has no /export/garmin: an older image); workout-plans.csv kept.');
    else {
      const cause = (err.cause && (err.cause.code || err.cause.message)) || err.message;
      error(`Note: Garmin sync skipped (could not read ${baseUrl}/export/garmin: ${cause}); workout-plans.csv kept.`);
    }
    return 0;
  }
  const file = path.join(outDir, WORKOUT_PLANS_CSV);
  try {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const plan = planGarminSync(activities, existing);
    if (plan.text != null) {
      fs.mkdirSync(outDir, { recursive: true });
      common.writeAtomic(file, plan.text);
    }
    if (!activities.length) log('sync-garmin: no Garmin activities on the server (Garmin not configured, or none stored yet)');
    else log(`sync-garmin: ${activities.length} Garmin activities, ${plan.rows} planned workout(s)${plan.text == null ? ' (no changes)' : ''}`);
    return 0;
  } catch (e) {
    error(`ERROR: workout-plans.csv could not be written (${/** @type {Error} */ (e).message})`);
    return 1;
  }
}

if (isMain(import.meta.url)) common.runCli(() => main(), { guardDataRoot: true, usage: USAGE });

export { GARMIN_TYPE_MAP, garminType, localIsoWithOffset, planRow, buildPlans, planGarminSync, fetchGarmin, main };
