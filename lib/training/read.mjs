/* Training build-time I/O (lib/<area>/read.mjs convention, like lib/health/read.mjs): the only
 * module of lib/training that reads the extract (lib/training/hr-zones.cjs, the sync's zone model,
 * still has its own writer-side fs). Compute stays pure: dashboard.mjs aggregates, activity.mjs
 * builds the calendar; this file only finds and reads workouts.csv and workout-zones.csv. */
import fs from 'node:fs';
import path from 'node:path';
import hrZones from './hr-zones.cjs';
import { parseWorkouts, aggregateDashboard } from './dashboard.mjs';
import { activityFromRows } from './activity.mjs';

/* ---------- workouts.csv: Entreno's dashboard (DASH) and the Activity card (ACTIVITY) ---------- */

export function loadDashboard(extractDir) {
  if (!extractDir) return { hasData: false };
  const csvPath = path.join(extractDir, 'workouts.csv');
  if (!fs.existsSync(csvPath)) return { hasData: false };
  return aggregateDashboard(parseWorkouts(fs.readFileSync(csvPath, 'utf8')));
}

export function dashboardBlock(extractDir) {
  return [
    '    /* GEN:DASHBOARD START — generated from apple-health workouts.csv by generate-training.js. DO NOT EDIT BY HAND. */',
    '    var DASH = ' + JSON.stringify(loadDashboard(extractDir)) + ';',
    '    /* GEN:DASHBOARD END */',
  ].join('\n');
}

export function buildActivity(extractDir) {
  if (!extractDir) return { hasData: false };
  const p = path.join(extractDir, 'workouts.csv');
  if (!fs.existsSync(p)) return { hasData: false };
  return activityFromRows(parseWorkouts(fs.readFileSync(p, 'utf8')));
}

/* ---------- workout-zones.csv (written by data/apple-health/sync-strava.js, zone model in
 * lib/training/hr-zones.cjs): one row per Strava activity with seconds in HR zone 0-5.
 * A missing file (fresh clone, an ingest image without the HR backfill) -> null = no zones. ---------- */

export const { ZONES_CSV, ZONES_HEADER } = hrZones;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

/** -> [{date, id, type, maxHr, maxSrc, hrAvg, hrMax, z: [z0..z5] seconds}] sorted by date, or null. */
export function readWorkoutZones(extractDir) {
  if (!extractDir) return null;
  const p = path.join(extractDir, ZONES_CSV);
  if (!fs.existsSync(p)) return null;
  const rows = fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).filter(Boolean).map((l) => {
    const c = l.split(',');
    const z = c.slice(7, 13).map(num);
    return { date: c[0], id: c[1], type: c[2] || '', maxHr: num(c[3]), maxSrc: c[4] || null, hrAvg: num(c[5]), hrMax: num(c[6]), z };
  }).filter((r) => ISO.test(r.date) && r.maxHr > 0 && r.z.length === 6 && r.z.every((x) => x != null && x >= 0));
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows.length ? rows : null;
}
