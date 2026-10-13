/* Score build-time I/O (lib/<area>/read.mjs convention, like lib/health/read.mjs): the only module of
 * lib/score that reads the extract. Compute stays pure: strain.mjs, stress.mjs and energy.mjs score
 * parsed rows (strainFrom / stressFrom / energyFrom over lib/extract/read.mjs readExtract inputs); this
 * file reads hr-hourly.csv into those rows and projects workout-zones.csv lines (read once by
 * lib/training/read.mjs readWorkoutZonesLines) into activities. The build* wrappers are temporary
 * per-directory shims (read-at-edge E3 removes them): the page builds through readExtract + buildScoresFrom. */
import fs from 'node:fs';
import path from 'node:path';
import { readSeries, readSleep } from '../health/read.mjs';
import { readWorkoutZones, readWorkoutZonesLines } from '../training/read.mjs';
import { parseHist, strainFrom } from './strain.mjs';
import { stressFrom } from './stress.mjs';
import { energyFrom } from './energy.mjs';

const HR_HOURLY_CSV = 'hr-hourly.csv';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

/** hr-hourly.csv split into cells, header dropped, or null when the file is absent. The one read of
 * the file: lib/extract/read.mjs projects these cells both ways (hrHourlyFromCells, hrHoursFromCells). */
export function readHrHourlyCells(extractDir) {
  if (!extractDir) return null;
  const p = path.join(extractDir, HR_HOURLY_CSV);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
}

/* ---------- day strain (strain.mjs) ---------- */

/** hr-hourly.csv -> [{date, cov (covered minutes), hist: Map}] or null when absent / empty. */
export function readHrHourly(extractDir) { return hrHourlyFromCells(readHrHourlyCells(extractDir)); }

/** readHrHourlyCells() cells -> the strain projection (readHrHourly), or null. */
export function hrHourlyFromCells(cells) {
  if (!cells) return null;
  const rows = cells.filter((c) => ISO.test(c[0]) && c.length >= 9)
    .map((c) => ({ date: c[0], cov: parseFloat(c[6]) || 0, hist: parseHist(c[8]) }));
  return rows.length ? rows : null;
}

export function buildStrain(extractDir) {
  return strainFrom({ hrHourly: readHrHourly(extractDir), zones: readWorkoutZones(extractDir) });
}

/* ---------- stress estimate (stress.mjs) ---------- */

/** hr-hourly.csv -> [{date, start (local ISO hour start), avg, cov, act, hist: Map}] | null. */
export function readHrHours(extractDir) { return hrHoursFromCells(readHrHourlyCells(extractDir)); }

/** readHrHourlyCells() cells -> the stress / energy projection (readHrHours), or null. */
export function hrHoursFromCells(cells) {
  if (!cells) return null;
  const rows = cells.filter((c) => ISO.test(c[0]) && c.length >= 9 && /^\d{4}-\d{2}-\d{2}T\d{2}/.test(c[1]))
    .map((c) => ({ date: c[0], start: c[1], avg: parseFloat(c[2]), cov: parseFloat(c[6]) || 0, act: parseFloat(c[7]) || 0, hist: parseHist(c[8]) }))
    .filter((r) => r.avg > 0);
  return rows.length ? rows : null;
}

export function buildStress(extractDir) {
  return stressFrom({
    hrHours: readHrHours(extractDir), series: { rhr: readSeries(extractDir, 'rhr.csv') },
    sleep: readSleep(extractDir), zones: readWorkoutZones(extractDir),
  });
}

/* ---------- energy bank (energy.mjs) ---------- */

/** workout-zones.csv -> [{date, start, elapsed (s), z: [z0..z5] s}] of the rows WITH start + elapsed_s, or null. */
export function readActivities(extractDir) { return activitiesFromLines(readWorkoutZonesLines(extractDir)); }

/** readWorkoutZonesLines() lines (header included) -> the readActivities rows, or null. */
export function activitiesFromLines(lines) {
  if (!lines) return null;
  const head = lines[0].split(',');
  const iS = head.indexOf('start'), iE = head.indexOf('elapsed_s'), iZ = head.indexOf('z0_s');
  if (iS < 0 || iE < 0 || iZ < 0) return null;
  const rows = lines.slice(1).map((l) => l.split(',')).map((c) => ({
    date: c[0], start: c[iS], elapsed: parseFloat(c[iE]), z: c.slice(iZ, iZ + 6).map((x) => parseFloat(x)),
  })).filter((r) => ISO.test(r.date) && STAMP.test(r.start) && r.elapsed > 0 && r.z.length === 6 && r.z.every((x) => x >= 0));
  return rows.length ? rows : null;
}

/** The bakes it reads (stress, days, strain) come from the caller, so nothing is scored twice. */
export function buildEnergy(extractDir, bakes = {}) {
  return energyFrom({ hrHours: readHrHours(extractDir), activities: readActivities(extractDir), sleep: readSleep(extractDir) }, bakes);
}
