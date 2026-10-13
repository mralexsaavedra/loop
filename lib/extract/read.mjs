/* readExtract(extractDir) — the single extract read of a page build (docs/plan-page.md, lib purity).
 *
 * The composition root (web/src/bakes.mjs computeBakes) calls it once and hands the result to the pure
 * cores (lib/score/index.mjs buildScoresFrom, ...), so one build parses each extract file once instead of
 * once per score. It owns no parsing and imports no fs: every value comes from an area reader
 * (lib/<area>/read.mjs), which keeps fs in the readers (lib/fs-boundary.test.mjs).
 *
 * Shape (extensible: a later consumer adds its keys here, never a second read of a file already read):
 *   series      {hrv, rhr, respiratory, wristTemp, vo2max}: readSeries rows ({date, value, source}) | null
 *   sleep       readSleep rows | null
 *   workoutLoad readWorkoutLoad rows (workouts.csv, raw — callers merge same-day sessions) | null
 *   hrHourly    hr-hourly.csv, the strain projection (readHrHourly) | null
 *   hrHours     hr-hourly.csv, the stress / energy projection (readHrHours) | null — same read, two projections
 *   zones       readWorkoutZones rows (workout-zones.csv) | null
 *   activities  readActivities rows (workout-zones.csv start + elapsed_s) | null
 *   journal     readJournal days ([] when absent: the reader's own empty value)
 *
 * Null-when-absent like the readers; readExtract(null) is the same shape with every value null (journal
 * []). Deep-frozen: the inputs are shared by every core, so an in-place .sort() or assignment on them
 * throws instead of silently changing another score. Maps (the hr histograms) are frozen as objects
 * but Map entries cannot be frozen; no core writes them.
 *
 * Known extra read: workout-zones.csv is read by both readWorkoutZones and readActivities (two parsers
 * in two areas); unifying them is part of the read-at-edge E2 task. */
import { readSeries, readSleep, readWorkoutLoad } from '../health/read.mjs';
import { readHrHourlyCells, hrHourlyFromCells, hrHoursFromCells, readActivities } from '../score/read.mjs';
import { readWorkoutZones } from '../training/read.mjs';
import { readJournal } from '../journal/read.mjs';

/** The extract series files readExtract reads, by inputs.series key. */
export const SERIES_FILES = {
  hrv: 'hrv.csv',
  rhr: 'rhr.csv',
  respiratory: 'respiratory-daily.csv',
  wristTemp: 'wristTemp.csv',
  vo2max: 'vo2max.csv',
};

/** Freeze a value and everything reachable through arrays, plain objects and Map values. */
export function deepFreeze(v) {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  Object.freeze(v);
  if (v instanceof Map) for (const x of v.values()) deepFreeze(x);
  else for (const k of Object.keys(v)) deepFreeze(v[k]);
  return v;
}

/** extractDir (a path, or null) -> the frozen inputs object described above. Never throws on a
 * missing file or directory (the readers return null / []). */
export function readExtract(extractDir) {
  const dir = extractDir || null;
  const series = Object.fromEntries(Object.entries(SERIES_FILES).map(([k, f]) => [k, readSeries(dir, f)]));
  const hrCells = readHrHourlyCells(dir);
  return deepFreeze({
    series,
    sleep: readSleep(dir),
    workoutLoad: readWorkoutLoad(dir),
    hrHourly: hrHourlyFromCells(hrCells),
    hrHours: hrHoursFromCells(hrCells),
    zones: readWorkoutZones(dir),
    activities: readActivities(dir),
    journal: readJournal(dir),
  });
}
