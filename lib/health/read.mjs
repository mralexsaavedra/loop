/* CSV reading helpers for the health tab. Every function takes `extractDir` (a path, or null/absent), so
 * a null/missing extractDir degrades to the same empty result a missing individual file produces — never
 * throws.
 */
import fs from 'node:fs';
import path from 'node:path';
import { correctActiveEnergy, HOURLY_CSV, RIDES_CSV } from './ride-energy.mjs';
import { isInBedEstimate } from '../extract/samples.mjs';
import { readWorkoutCells } from '../training/read.mjs';

// workouts.csv's one reader is lib/training/read.mjs; it keeps its historical import path here
export { readWorkoutCells } from '../training/read.mjs';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A "date,value[,source]" CSV row (readSeries); source '' when the column is absent.
 * @typedef {{date: string, value: number, source: string}} SeriesRow */
/** A readTable row: the date plus one number-or-null per mapped column.
 * @template {string} K
 * @typedef {{date: string} & {[P in K]: number | null}} TableRow */
/** dietary-daily.csv row (readDietary): kcal as `value`, macros in grams (null = blank).
 * @typedef {{date: string, value: number | null, p: number | null, c: number | null, g: number | null}} DietaryRow */
/** running-daily.csv row (readRunning).
 * @typedef {TableRow<'speed' | 'power' | 'gct' | 'vosc' | 'stride'>} RunningRow */
/** sleep-daily.csv row (readSleep): hours; a null stage = unknown; `estimated` only on an in-bed-only night.
 * @typedef {{date: string, value: number, bedtime: number | null, waketime: number | null, rem: number | null,
 *   deep: number | null, core: number | null, unspec: number | null, awake: number | null, inbed: number | null,
 *   estimated?: true}} SleepRow */
/** workouts.csv projected for training load (readWorkoutLoad).
 * @typedef {{date: string, type: string, dur: number, hrAvg: number | null, re: number | null, kj: number | null,
 *   source: string}} WorkoutLoadRow */
/** workouts.csv session of one type family (sessionsFromCells); `type` only on workoutsFromCells rows.
 * @typedef {{date: string, type?: string, dur: number, dist: number | null, hrAvg: number | null, re: number | null,
 *   kj: number | null, elev: number | null, source: string}} SessionRow */

/* ---------- CSV helpers ---------- */
// Read a "date,value[,source]" CSV -> [{date, value, source}] sorted by date. null if absent.
/** @param {string | null | undefined} extractDir @param {string} name @returns {SeriesRow[] | null} */
export function readSeries(extractDir, name) {
  if (!extractDir) return null;
  const p = path.join(extractDir, name);
  if (!fs.existsSync(p)) return null;
  const rows = fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).filter(Boolean)
    .map((l) => {
      const c = l.split(',');
      return { date: c[0], value: parseFloat(c[1]), source: c[2] || '' };
    })
    .filter((r) => ISO.test(r.date) && isFinite(r.value));
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows.length ? rows : null;
}

// Generic CSV reader: parse a file into rows of {date, ...mapped fields}, dropping bad dates.
// `fields` maps an output key to a column index (numbers); `onRow(row, cells)` may add keys from the
// raw cells (text columns); null when the file is absent or empty.
/**
 * @template {string} K
 * @param {string | null | undefined} extractDir
 * @param {string} name
 * @param {Record<K, number>} fields
 * @param {(row: TableRow<K>, cells: string[]) => void} [onRow]
 * @returns {TableRow<K>[] | null} */
export function readTable(extractDir, name, fields, onRow) {
  if (!extractDir) return null;
  const p = path.join(extractDir, name);
  if (!fs.existsSync(p)) return null;
  /** @param {string} s */
  const num = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
  const rows = fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).filter(Boolean)
    .map((l) => {
      const c = l.split(',');
      // filled key by key below: a TableRow once the loop ends
      const o = /** @type {TableRow<K>} */ ({ date: c[0] });
      for (const [k, i] of /** @type {[string, number][]} */ (Object.entries(fields))) /** @type {Record<string, unknown>} */ (o)[k] = num(c[i]);
      if (onRow) onRow(o, c);
      return o;
    })
    .filter((r) => ISO.test(r.date));
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows.length ? rows : null;
}

// dietary-daily.csv: date,kcal,protein_g,carbs_g,fat_g -> [{date, value:kcal, p, c, g}]
// a blank kcal cell stays a row with value null (isFinite(null) is true): its readers compare it (>= / >), which a
// null never passes, and its macros still count (web/test and read.test pin it)
/** @param {string | null | undefined} extractDir @returns {DietaryRow[] | null} */
export function readDietary(extractDir) {
  const rows = readTable(extractDir, 'dietary-daily.csv', { value: 1, p: 2, c: 3, g: 4 });
  return /** @type {DietaryRow[] | null} */ (rows && rows.filter((r) => r.value == null || Number.isFinite(r.value)));
}
// running-daily.csv: date,speed_kmh,power_w,gct_ms,vosc_cm,stride_m,samples
/** @param {string | null | undefined} extractDir @returns {RunningRow[] | null} */
export function readRunning(extractDir) { return readTable(extractDir, 'running-daily.csv', { speed: 1, power: 2, gct: 3, vosc: 4, stride: 5 }); }

// sleep-daily.csv: date,asleep_hours,source,bedtime,waketime,rem_h,deep_h,core_h,unspec_h,awake_h,inbed_h
// -> [{date, value:hours, bedtime, waketime, rem, deep, core, unspec, awake, inbed, estimated?}] (hours; a
// blank or absent stage column — older five-column rows — reads as null = unknown). estimated: true (only
// then present) = an in-bed-only night, value = its time in bed (source "<app> (in bed)",
// lib/extract/samples.mjs isInBedEstimate).
// a night with blank hours is dropped: every reader rounds / averages the value (a null would count as 0)
/** @param {string | null | undefined} extractDir @returns {SleepRow[] | null} */
export function readSleep(extractDir) {
  const rows = readTable(extractDir, 'sleep-daily.csv', { value: 1, bedtime: 3, waketime: 4, rem: 5, deep: 6, core: 7, unspec: 8, awake: 9, inbed: 10 },
    (o, c) => { if (isInBedEstimate(c[2])) /** @type {SleepRow} */ (o).estimated = true; });
  return /** @type {SleepRow[] | null} */ (rows && rows.filter((r) => Number.isFinite(r.value)));
}

// A blank/absent/non-numeric cell -> null; '0' and '1' are genuine values (never test `> 0`).
/** @param {unknown} cell @returns {number | null} */
export function parseRe(cell) {
  if (cell == null || String(cell).trim() === '') return null;
  const n = parseFloat(/** @type {string} */ (cell));
  return Number.isFinite(n) ? n : null;
}

// workouts.csv: date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source[,distance_km,
// relative_effort,kilojoules] -> [{date, type, dur, hrAvg, re, kj}]. The old 9-col header and
// mixed-width files are tolerated: an absent column reads as null. Rows are RAW: every caller
// (load series, timeline, Salud's aggLoadRecovery) applies lib/training/sessions.mjs mergeSameDay.
/** @param {string | null | undefined} extractDir @returns {WorkoutLoadRow[] | null} */
export function readWorkoutLoad(extractDir) { return workoutLoadFromCells(readWorkoutCells(extractDir)); }

/** readWorkoutCells() cells -> the readWorkoutLoad rows, or null.
 * @param {string[][] | null | undefined} cells @returns {WorkoutLoadRow[] | null} */
export function workoutLoadFromCells(cells) {
  if (!cells) return null;
  const rows = cells.map(/** @returns {WorkoutLoadRow} */ (c) => {
    const hr = parseFloat(c[4]);
    return { date: c[0], type: c[1] || '', dur: parseFloat(c[2]) || 0, hrAvg: Number.isFinite(hr) && hr > 0 ? hr : null, re: parseRe(c[9]), kj: parseRe(c[10]), source: c[7] || '' };
  }).filter((r) => ISO.test(r.date));
  return rows.length ? rows : null;
}

// workouts.csv cells -> sessions of one type family [{date, dur, dist, hrAvg, re, kj, elev, source}], sorted.
// Positional up to the 12th column (elevation_m); a shorter row (9-/11-col) reads its absent
// columns as null.
/** @param {string[][] | null | undefined} cells @param {RegExp} typeRe @param {boolean} [withType] @returns {SessionRow[] | null} */
function sessionsFromCells(cells, typeRe, withType = false) {
  if (!cells) return null;
  const out = cells
    .filter((c) => ISO.test(c[0]) && typeRe.test(c[1] || ''))
    .map(/** @returns {SessionRow} */ (c) => {
      const hr = parseRe(c[4]);
      const row = { date: c[0], dur: parseRe(c[2]) || 0, dist: parseRe(c[8]), hrAvg: hr != null && hr > 0 ? hr : null, re: parseRe(c[9]), kj: parseRe(c[10]), elev: parseRe(c[11]), source: c[7] || '' };
      // date first, then type, then the rest (the key order of `{ date, type, ...row }`)
      const { date, ...rest } = row;
      return withType ? { date, type: c[1] || '', ...rest } : row;
    });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out.length ? out : null;
}
// Every workout row with its type (the detail views list a day's sessions of any modality).
/** @param {string[][] | null | undefined} cells */
export const workoutsFromCells = (cells) => /** @type {(SessionRow & {type: string})[] | null} */ (sessionsFromCells(cells, /(?:)/, true));
// Cycling-family types: what both extract.mjs and sync-strava.mjs write for any ride.
/** @param {string[][] | null | undefined} cells */
export const ridesFromCells = (cells) => sessionsFromCells(cells, /Cycling/i);
// Running workouts from the Watch export and from sync:strava (a Strava-only run has no
// running-daily.csv dynamics; aggRunning left-joins them by date).
/** @param {string[][] | null | undefined} cells */
export const runsFromCells = (cells) => sessionsFromCells(cells, /Running/i);
/** @param {string | null | undefined} extractDir */
export function readWorkouts(extractDir) { return workoutsFromCells(readWorkoutCells(extractDir)); }
/** @param {string | null | undefined} extractDir */
export function readRides(extractDir) { return ridesFromCells(readWorkoutCells(extractDir)); }
/** @param {string | null | undefined} extractDir */
export function readRuns(extractDir) { return runsFromCells(readWorkoutCells(extractDir)); }

/* ---------- Active energy (power-meter ride correction, lib/health/ride-energy.mjs) ---------- */
// headerless rows of a plain CSV -> arrays of cells; [] when the file is absent
/** @param {string} extractDir @param {string} name @returns {string[][]} */
function readCsv(extractDir, name) {
  const p = path.join(extractDir, name);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).filter(Boolean).map((l) => l.split(','));
}
/** @param {string} s */
const numOrNull = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

/** The active energy every reader uses: active-energy-daily.csv corrected by the power rides
 * (the pure correctActiveEnergy); null when the daily file is absent. Missing hourly / rides
 * files -> the Watch values. */
/** @param {string | null | undefined} extractDir */
export function readActiveEnergy(extractDir) {
  if (!extractDir) return null;
  const daily = readSeries(extractDir, 'active-energy-daily.csv');
  if (!daily) return null;
  const hourly = readCsv(extractDir, HOURLY_CSV).map((c) => ({ start: c[1], kcal: numOrNull(c[2]) }));
  const rides = readCsv(extractDir, RIDES_CSV).map((c) => ({
    start: c[1], elapsedS: numOrNull(c[2]), kj: numOrNull(c[3]),
    deviceWatts: c[4] === 'true' ? true : c[4] === 'false' ? false : null,
  }));
  return correctActiveEnergy(daily, hourly, rides);
}
