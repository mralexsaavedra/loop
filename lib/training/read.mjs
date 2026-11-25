/* Training build-time I/O (lib/<area>/read.mjs convention, like lib/health/read.mjs): the only
 * module of lib/training that reads the extract (lib/training/hr-zones.mjs, the sync's zone model,
 * is pure). Compute stays pure: dashboard.mjs aggregates, activity.mjs
 * builds the calendar; this file only finds and reads workouts.csv, workout-zones.csv and workout-plans.csv. */
import fs from 'node:fs';
import path from 'node:path';
import { ZONES_CSV, ZONES_HEADER } from './hr-zones.mjs';
import { trainingRowsFromCells } from './dashboard.mjs';

/** workouts.csv split into cells (header and blank lines dropped), or null when the file is absent. The
 * one read of the file: every workouts projection (workoutLoadFromCells, sessionsFromCells, the training
 * dashboard's workoutsFromCells) parses these cells, so lib/extract/read.mjs reads it once (health/read.mjs re-exports it).
 * @param {string | null | undefined} extractDir
 * @returns {string[][] | null} */
export function readWorkoutCells(extractDir) {
  if (!extractDir) return null;
  const p = path.join(extractDir, 'workouts.csv');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).filter(Boolean).map((l) => l.split(','));
}

/* ---------- workouts.csv: Entreno's dashboard (DASH) and the Activity card (ACTIVITY) ----------
 * The page reads the file once through lib/extract/read.mjs (inputs.trainingRows, projected by
 * dashboard.mjs trainingRowsFromCells) and calls the pure dashboardFrom / activityFrom. */

/** workouts.csv -> the parseWorkouts rows, or null when the file is absent.
 * @param {string | null | undefined} extractDir
 * @returns {import('./dashboard.mjs').TrainingRow[] | null} */
export function readTrainingRows(extractDir) {
  const cells = readWorkoutCells(extractDir);
  return cells ? trainingRowsFromCells(cells) : null;
}

/* ---------- workout-zones.csv (written by data/apple-health/sync-strava.mjs, zone model in
 * lib/training/hr-zones.mjs): one row per Strava activity with seconds in HR zone 0-5.
 * A missing file (fresh clone, an ingest image without the HR backfill) -> null = no zones. ---------- */

export { ZONES_CSV, ZONES_HEADER };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** @param {string | undefined} s @returns {number | null} */
const num = (s) => { const n = parseFloat(/** @type {string} */ (s)); return Number.isFinite(n) ? n : null; };

/** workout-zones.csv lines, header INCLUDED (lib/score/read.mjs activitiesFromLines locates its columns
 * by header name), or null when the file is absent. The one read of the file: lib/extract/read.mjs
 * projects these lines both ways (zonesFromLines, activitiesFromLines).
 * @param {string | null | undefined} extractDir
 * @returns {string[] | null} */
export function readWorkoutZonesLines(extractDir) {
  if (!extractDir) return null;
  const p = path.join(extractDir, ZONES_CSV);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').trim().split('\n');
}

/** One workout-zones.csv row: seconds in HR zones 0-5 (`z`) and the max HR the zones used.
 * @typedef {{date: string, id: string, type: string, maxHr: number | null, maxSrc: string | null, hrAvg: number | null, hrMax: number | null, z: (number | null)[]}} ZoneRow */

/** -> [{date, id, type, maxHr, maxSrc, hrAvg, hrMax, z: [z0..z5] seconds}] sorted by date, or null.
 * @param {string | null | undefined} extractDir
 * @returns {ZoneRow[] | null} */
export function readWorkoutZones(extractDir) { return zonesFromLines(readWorkoutZonesLines(extractDir)); }

/** readWorkoutZonesLines() lines -> the readWorkoutZones rows, or null.
 * @param {string[] | null | undefined} lines
 * @returns {ZoneRow[] | null} */
export function zonesFromLines(lines) {
  if (!lines) return null;
  const rows = lines.slice(1).filter(Boolean).map((l) => {
    const c = l.split(',');
    const z = c.slice(7, 13).map(num);
    return { date: c[0], id: c[1], type: c[2] || '', maxHr: num(c[3]), maxSrc: c[4] || null, hrAvg: num(c[5]), hrMax: num(c[6]), z };
  }).filter((r) => ISO.test(r.date) && /** @type {number} */ (r.maxHr) > 0 && r.z.length === 6 && r.z.every((x) => x != null && x >= 0));
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows.length ? rows : null;
}

/* ---------- workout-plans.csv (written by data/apple-health/sync-garmin.mjs from the ingest's /export/garmin):
 * one row per Garmin activity that followed a planned (structured) workout: what was done (duration, avg / normalized
 * power, avg HR) and the plan's steps as CSV-quoted JSON. A missing file (no Garmin source) -> null = no plans. ---------- */

export const WORKOUT_PLANS_CSV = 'workout-plans.csv';
export const WORKOUT_PLANS_HEADER = 'date,start,type,duration_s,avg_power,norm_power,avg_hr,plan';

/** One planned step as the export gives it (no names, no notes): Garmin's stepIndex, intensity, duration type and
 * value (seconds for TIME; for REPEAT_UNTIL_STEPS_CMPLT the first stepIndex it repeats), target type and range.
 * @typedef {{i: number | null, intensity: string, dur_type: string, dur: number | null, target: string | null,
 *   low: number | null, high: number | null, value: number | null}} PlanStep */
/** One workout-plans.csv row: the activity (local date, local start with offset, Apple-style type, done figures)
 * and its planned steps.
 * @typedef {{date: string, start: string | null, type: string, dur: number | null, w: number | null, np: number | null,
 *   hr: number | null, steps: PlanStep[]}} PlanRow */

// seven plain cells, then the quoted JSON of the steps (the only quoted cell)
const PLAN_LINE = /^([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),"(.*)"$/;
/** @param {unknown} v @returns {number | null} */
const numOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** @param {unknown} v @returns {string | null} */
const strOf = (v) => (typeof v === 'string' ? v : null);

/** An untrusted steps array -> PlanStep[], or null when it is not an array of objects.
 * @param {unknown} raw @returns {PlanStep[] | null} */
function planSteps(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  /** @type {PlanStep[]} */
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return null;
    const o = /** @type {Record<string, unknown>} */ (s);
    out.push({ i: numOf(o.i), intensity: strOf(o.intensity) || '', dur_type: strOf(o.dur_type) || '', dur: numOf(o.dur),
      target: strOf(o.target), low: numOf(o.low), high: numOf(o.high), value: numOf(o.value) });
  }
  return out;
}

/** -> the workout-plans.csv rows sorted by date (then start), or null (no file, or no usable row).
 * @param {string | null | undefined} extractDir
 * @returns {PlanRow[] | null} */
export function readWorkoutPlans(extractDir) {
  if (!extractDir) return null;
  const p = path.join(extractDir, WORKOUT_PLANS_CSV);
  if (!fs.existsSync(p)) return null;
  /** @type {PlanRow[]} */
  const rows = [];
  for (const line of fs.readFileSync(p, 'utf8').trim().split('\n').slice(1)) {
    const m = PLAN_LINE.exec(line);
    if (!m || !ISO.test(m[1])) continue;
    /** @type {unknown} */
    let raw;
    try { raw = JSON.parse(m[8].replace(/""/g, '"')); } catch { continue; }
    const steps = planSteps(raw);
    if (!steps) continue;
    rows.push({ date: m[1], start: m[2] || null, type: m[3], dur: num(m[4]), w: num(m[5]), np: num(m[6]), hr: num(m[7]), steps });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.start || '') < (b.start || '') ? -1 : (a.start || '') > (b.start || '') ? 1 : 0));
  return rows.length ? rows : null;
}
