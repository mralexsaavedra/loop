/* Training build-time I/O (lib/<area>/read.mjs convention, like lib/health/read.mjs): the only
 * module of lib/training that reads the extract (lib/training/hr-zones.mjs, the sync's zone model,
 * is pure). Compute stays pure: dashboard.mjs aggregates, activity.mjs
 * builds the calendar; this file only finds and reads workouts.csv and workout-zones.csv. */
import fs from 'node:fs';
import path from 'node:path';
import { ZONES_CSV, ZONES_HEADER } from './hr-zones.mjs';
import { readWorkoutCells } from '../health/read.mjs';
import { trainingRowsFromCells } from './dashboard.mjs';

/* ---------- workouts.csv: Entreno's dashboard (DASH) and the Activity card (ACTIVITY) ----------
 * The page reads the file once through lib/extract/read.mjs (inputs.trainingRows, projected by
 * dashboard.mjs trainingRowsFromCells) and calls the pure dashboardFrom / activityFrom. */

/** workouts.csv -> the parseWorkouts rows, or null when the file is absent. */
export function readTrainingRows(extractDir) {
  const cells = readWorkoutCells(extractDir);
  return cells ? trainingRowsFromCells(cells) : null;
}

/* ---------- workout-zones.csv (written by data/apple-health/sync-strava.js, zone model in
 * lib/training/hr-zones.mjs): one row per Strava activity with seconds in HR zone 0-5.
 * A missing file (fresh clone, an ingest image without the HR backfill) -> null = no zones. ---------- */

export { ZONES_CSV, ZONES_HEADER };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

/** workout-zones.csv lines, header INCLUDED (lib/score/read.mjs activitiesFromLines locates its columns
 * by header name), or null when the file is absent. The one read of the file: lib/extract/read.mjs
 * projects these lines both ways (zonesFromLines, activitiesFromLines). */
export function readWorkoutZonesLines(extractDir) {
  if (!extractDir) return null;
  const p = path.join(extractDir, ZONES_CSV);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').trim().split('\n');
}

/** -> [{date, id, type, maxHr, maxSrc, hrAvg, hrMax, z: [z0..z5] seconds}] sorted by date, or null. */
export function readWorkoutZones(extractDir) { return zonesFromLines(readWorkoutZonesLines(extractDir)); }

/** readWorkoutZonesLines() lines -> the readWorkoutZones rows, or null. */
export function zonesFromLines(lines) {
  if (!lines) return null;
  const rows = lines.slice(1).filter(Boolean).map((l) => {
    const c = l.split(',');
    const z = c.slice(7, 13).map(num);
    return { date: c[0], id: c[1], type: c[2] || '', maxHr: num(c[3]), maxSrc: c[4] || null, hrAvg: num(c[5]), hrMax: num(c[6]), z };
  }).filter((r) => ISO.test(r.date) && r.maxHr > 0 && r.z.length === 6 && r.z.every((x) => x != null && x >= 0));
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows.length ? rows : null;
}
