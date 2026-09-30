/* CSV reading helpers for the health tab — extracted from
 * data/training/generate-health.js (astro-plan-web migration, slice 2).
 * Every function takes `extractDir` (a path, or null/absent) instead of a
 * closed-over path, so both the legacy generator (real CSV dir) and future
 * Astro/env.mjs callers (resolved dir or null on a fresh clone) share this
 * module. A null/missing extractDir degrades to the same empty result a
 * missing individual file already produced — never throws.
 */
import fs from 'node:fs';
import path from 'node:path';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- CSV helpers ---------- */
// Read a "date,value[,source]" CSV -> [{date, value, source}] sorted by date. null if absent.
export function readSeries(extractDir, name, valueCol = 1) {
  if (!extractDir) return null;
  const p = path.join(extractDir, name);
  if (!fs.existsSync(p)) return null;
  const rows = fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).filter(Boolean)
    .map((l) => {
      const c = l.split(',');
      return { date: c[0], value: parseFloat(c[valueCol]), source: c[2] || '' };
    })
    .filter((r) => ISO.test(r.date) && isFinite(r.value));
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows.length ? rows : null;
}

// Generic CSV reader: parse a file into rows of {date, ...mapped fields}, dropping bad dates.
// `fields` maps an output key to a column index; null when the file is absent or empty.
export function readTable(extractDir, name, fields) {
  if (!extractDir) return null;
  const p = path.join(extractDir, name);
  if (!fs.existsSync(p)) return null;
  const num = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
  const rows = fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).filter(Boolean)
    .map((l) => {
      const c = l.split(',');
      const o = { date: c[0] };
      for (const [k, i] of Object.entries(fields)) o[k] = num(c[i]);
      return o;
    })
    .filter((r) => ISO.test(r.date));
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows.length ? rows : null;
}

// dietary-daily.csv: date,kcal,protein_g,carbs_g,fat_g -> [{date, value:kcal, p, c, g}]
export function readDietary(extractDir) {
  const rows = readTable(extractDir, 'dietary-daily.csv', { value: 1, p: 2, c: 3, g: 4 });
  return rows && rows.filter((r) => isFinite(r.value));
}
// running-daily.csv: date,speed_kmh,power_w,gct_ms,vosc_cm,stride_m,samples
export function readRunning(extractDir) { return readTable(extractDir, 'running-daily.csv', { speed: 1, power: 2, gct: 3, vosc: 4, stride: 5 }); }

// sleep-daily.csv: date,asleep_hours,source,bedtime,waketime -> [{date, value:hours, bedtime, waketime}]
export function readSleep(extractDir) {
  const rows = readTable(extractDir, 'sleep-daily.csv', { value: 1, bedtime: 3, waketime: 4 });
  return rows && rows.filter((r) => isFinite(r.value));
}

// A blank/absent/non-numeric cell -> null; '0' and '1' are genuine values (never test `> 0`).
export function parseRe(cell) {
  if (cell == null || String(cell).trim() === '') return null;
  const n = parseFloat(cell);
  return Number.isFinite(n) ? n : null;
}

// workouts.csv: date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source[,distance_km,
// relative_effort,kilojoules] -> [{date, type, dur, hrAvg, re, kj}]. The old 9-col header and
// mixed-width files are tolerated: an absent column reads as null. Rows are RAW: every caller
// (load series, timeline, Salud's aggLoadRecovery) applies lib/training/sessions.mjs mergeSameDay.
export function readWorkoutLoad(extractDir) {
  if (!extractDir) return null;
  const p = path.join(extractDir, 'workouts.csv');
  if (!fs.existsSync(p)) return null;
  const rows = fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).filter(Boolean).map((l) => {
    const c = l.split(','); const hr = parseFloat(c[4]);
    return { date: c[0], type: c[1] || '', dur: parseFloat(c[2]) || 0, hrAvg: Number.isFinite(hr) && hr > 0 ? hr : null, re: parseRe(c[9]), kj: parseRe(c[10]), source: c[7] || '' };
  }).filter((r) => ISO.test(r.date));
  return rows.length ? rows : null;
}

// workouts.csv -> sessions of one type family [{date, dur, dist, hrAvg, re, kj, elev, source}], sorted.
// Positional up to the 12th column (elevation_m); a shorter row (9-/11-col) reads its absent
// columns as null.
function readSessions(extractDir, typeRe, withType = false) {
  if (!extractDir) return null;
  const p = path.join(extractDir, 'workouts.csv');
  if (!fs.existsSync(p)) return null;
  const cells = fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).filter(Boolean).map((l) => l.split(','));
  const out = cells
    .filter((c) => ISO.test(c[0]) && typeRe.test(c[1] || ''))
    .map((c) => {
      const hr = parseRe(c[4]);
      const row = { date: c[0], dur: parseRe(c[2]) || 0, dist: parseRe(c[8]), hrAvg: hr != null && hr > 0 ? hr : null, re: parseRe(c[9]), kj: parseRe(c[10]), elev: parseRe(c[11]), source: c[7] || '' };
      return withType ? { date: row.date, type: c[1] || '', ...row } : row;
    });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out.length ? out : null;
}
// Every workout row with its type (the detail views list a day's sessions of any modality).
export function readWorkouts(extractDir) { return readSessions(extractDir, /(?:)/, true); }
// Cycling-family types: what both extract.js and sync-strava.js write for any ride.
export function readRides(extractDir) { return readSessions(extractDir, /Cycling/i); }
// Running workouts from the Watch export and from sync:strava (a Strava-only run has no
// running-daily.csv dynamics; aggRunning left-joins them by date).
export function readRuns(extractDir) { return readSessions(extractDir, /Running/i); }
