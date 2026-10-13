/* readExtract(extractDir) — the single extract read of a page build (docs/plan-page.md, lib purity).
 *
 * The composition root (web/src/bakes.mjs computeBakes) calls it once and hands the result to the pure
 * cores (lib/score/index.mjs buildScoresFrom, ...), so one build parses each extract file once instead of
 * once per score. It owns no parsing and imports no fs: every value comes from an area reader
 * (lib/<area>/read.mjs), which keeps fs in the readers (lib/fs-boundary.test.mjs).
 *
 * Shape (extensible: a later consumer adds its keys here, never a second read of a file already read):
 *   series       readSeries rows ({date, value, source}) | null per SERIES_FILES key: the score signals
 *                (hrv, rhr, respiratory, wristTemp, vo2max), body (weight, bodyfat, leanmass, waist), daily
 *                totals (steps, exercise, distance, flights, basal) and walkingHr
 *   sleep        readSleep rows | null
 *   activeEnergy readActiveEnergy rows (active-energy-daily.csv corrected by the power rides) | null
 *   dietary      readDietary rows (dietary-daily.csv) | null
 *   running      readRunning rows (running-daily.csv dynamics) | null
 *   workouts.csv, read once (readWorkoutCells) and projected four ways:
 *     workoutLoad  readWorkoutLoad rows (raw — callers merge same-day sessions) | null
 *     workouts     readWorkouts rows (every session with its type, sorted) | null
 *     rides, runs  readRides / readRuns rows (Cycling / Running sessions) | null
 *     trainingRows the training dashboard's parseWorkouts rows ([] for a file with no rows) | null
 *   hrHourly     hr-hourly.csv, the strain projection (readHrHourly) | null
 *   hrHours      hr-hourly.csv, the stress / energy projection (readHrHours) | null — same read, two projections
 *   zones        workout-zones.csv, readWorkoutZones rows | null
 *   activities   workout-zones.csv, readActivities rows (start + elapsed_s) | null — same read, two projections
 *   journal      readJournal days ([] when absent: the reader's own empty value)
 *
 * Null-when-absent like the readers; readExtract(null) is the same shape with every value null (journal
 * []). Deep-frozen: the inputs are shared by every core, so an in-place .sort() or assignment on them
 * throws instead of silently changing another score. Maps (the hr histograms) are frozen as objects
 * but Map entries cannot be frozen; no core writes them. */
import {
  readSeries, readSleep, readActiveEnergy, readDietary, readRunning,
  readWorkoutCells, workoutLoadFromCells, workoutsFromCells, ridesFromCells, runsFromCells,
} from '../health/read.mjs';
import { readHrHourlyCells, hrHourlyFromCells, hrHoursFromCells, activitiesFromLines } from '../score/read.mjs';
import { readWorkoutZonesLines, zonesFromLines } from '../training/read.mjs';
import { trainingRowsFromCells } from '../training/dashboard.mjs';
import { readJournal } from '../journal/read.mjs';

/** The extract series files readExtract reads, by inputs.series key. */
export const SERIES_FILES = {
  hrv: 'hrv.csv',
  rhr: 'rhr.csv',
  respiratory: 'respiratory-daily.csv',
  wristTemp: 'wristTemp.csv',
  vo2max: 'vo2max.csv',
  walkingHr: 'walking-hr-daily.csv',
  weight: 'weight.csv',
  bodyfat: 'bodyfat.csv',
  leanmass: 'leanmass.csv',
  waist: 'waist.csv',
  steps: 'steps-daily.csv',
  exercise: 'exercise-minutes-daily.csv',
  distance: 'distance-daily.csv',
  flights: 'flights-daily.csv',
  basal: 'basal-energy-daily.csv',
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
  const workoutCells = readWorkoutCells(dir);
  const zoneLines = readWorkoutZonesLines(dir);
  return deepFreeze({
    series,
    sleep: readSleep(dir),
    activeEnergy: readActiveEnergy(dir),
    dietary: readDietary(dir),
    running: readRunning(dir),
    workoutLoad: workoutLoadFromCells(workoutCells),
    workouts: workoutsFromCells(workoutCells),
    rides: ridesFromCells(workoutCells),
    runs: runsFromCells(workoutCells),
    trainingRows: workoutCells ? trainingRowsFromCells(workoutCells) : null,
    hrHourly: hrHourlyFromCells(hrCells),
    hrHours: hrHoursFromCells(hrCells),
    zones: zonesFromLines(zoneLines),
    activities: activitiesFromLines(zoneLines),
    journal: readJournal(dir),
  });
}
