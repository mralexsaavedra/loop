/* Day strain 0-21 (Inicio's third dial): OUR all-day cardiovascular load on a 0-21 scale shaped like
 * the reference's "Strain". The reference's own formula is not public; this one is documented here
 * and in analysis/methodology.md, and every number on the page says it is an estimate.
 *
 * Load per day (Edwards TRIMP): sum over the day of minutes x zone weight, zones by % of max HR as in
 * the per-workout zones (lib/training/hr-zones.cjs: Z1 50-60 % -> 1, Z2 -> 2, Z3 -> 3, Z4 -> 4,
 * Z5 >= 90 % -> 5; below 50 % -> 0). Two sources, never overlapping:
 *   - during a Strava activity: the activity's HR-stream histogram (workout-zones.csv: exact seconds
 *     per zone);
 *   - the rest of the day: the Shortcut Watch samples (hr-hourly.csv `hist`: each sample covers the
 *     time to the next one, at most 10 min, with the Strava activity windows already left out,
 *     lib/health/hr-hourly.cjs).
 * Max HR = the one workout-zones.csv was cut with (profile.json maxHr, else the highest Strava max HR
 * of the last 12 months: the same rule as the zones).
 *
 * Strain = 21 x (1 - e^(-load / K)): saturating, so each extra point costs more load near the top.
 * K is calibrated to the user: the 95th-percentile FULL day (>= FULL_DAY_MIN covered minutes) of the
 * CALIB_DAYS days before the newest day maps to TARGET_P95 (18), i.e. K = p95 / ln(7). One K scores
 * every day (past days move a little when K drifts). Fewer than MIN_CALIB_DAYS full days, no max HR,
 * or no load at all -> {ok: false}: Inicio keeps the Relative Effort load dial (the fallback).
 * Each contributor's share of the day's strain is proportional to its load (s_i = strain x L_i / L).
 *
 * Pure over parsed rows; the bake carries no build-time "now", only data dates. */
import fs from 'node:fs';
import path from 'node:path';
import hrZones from '../training/hr-zones.cjs';
import { readWorkoutZones } from '../training/read.mjs';
import { scoreModality } from './modality.mjs';
import { percentile, RECENT_DAYS } from './load.mjs';
import { addDays, roundTo } from '../health/stats.mjs';

export const STRAIN_MAX = 21;
export const TARGET_P95 = 18;
// a quarter: long enough for a stable 95th percentile, short enough to follow a change of block
export const CALIB_DAYS = 90;
// two weeks of full days before the scale means anything (one hard week would set it alone)
export const MIN_CALIB_DAYS = 14;
// a day the Watch saw for at least 10 h counts as a full day for calibration (a not-worn day would
// drag the 95th percentile down)
export const FULL_DAY_MIN = 600;
const HR_HOURLY_CSV = 'hr-hourly.csv';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
// e^(-p95 / K) = 1 - 18 / 21 = 1 / 7
const LN_TARGET = -Math.log(1 - TARGET_P95 / STRAIN_MAX);

/** "60:300 72:120" -> Map(bpm -> covered seconds); junk pairs skipped. */
export function parseHist(s) {
  const out = new Map();
  for (const p of String(s || '').split(' ')) {
    const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(p);
    if (m && +m[2] > 0) out.set(+m[1], +m[2]);
  }
  return out;
}

/** One hour's histogram -> minutes x zone weight (weight = zone number, Z0 = 0). */
export function hourlyLoad(hist, maxHr) {
  let l = 0;
  for (const [bpm, sec] of hist) l += (sec / 60) * hrZones.zoneOf(bpm, maxHr);
  return l;
}

/** [z0..z5] seconds of one activity -> minutes x zone weight. */
export function activityLoad(z) {
  return z.reduce((a, sec, k) => a + (sec / 60) * k, 0);
}

export function strainOf(load, K) {
  return K > 0 && load > 0 ? Math.min(STRAIN_MAX, STRAIN_MAX * (1 - Math.exp(-load / K))) : 0;
}

/** hr-hourly.csv -> [{date, cov (covered minutes), hist: Map}] or null when absent / empty. */
export function readHrHourly(extractDir) {
  if (!extractDir) return null;
  const p = path.join(extractDir, HR_HOURLY_CSV);
  if (!fs.existsSync(p)) return null;
  const rows = fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','))
    .filter((c) => ISO.test(c[0]) && c.length >= 9)
    .map((c) => ({ date: c[0], cov: parseFloat(c[6]) || 0, hist: parseHist(c[8]) }));
  return rows.length ? rows : null;
}

/** {hourly, zones} -> {maxHr, maxSrc, days: [{date, all, cov, acts: [{t, m, load}], load}]}: one entry
 * per day WITH hourly data (a day of workouts only has no all-day picture: no strain). */
export function dayLoads({ hourly, zones }) {
  const last = zones && zones.length ? zones[zones.length - 1] : null;
  const maxHr = last && last.maxHr > 0 ? last.maxHr : null;
  const by = new Map();
  for (const h of hourly || []) {
    const d = by.get(h.date) || { date: h.date, all: 0, cov: 0, acts: [], load: 0 };
    d.all += maxHr ? hourlyLoad(h.hist, maxHr) : 0;
    d.cov += h.cov;
    by.set(h.date, d);
  }
  for (const z of zones || []) {
    const d = by.get(z.date);
    if (d) d.acts.push({ t: z.type, m: scoreModality(z.type), load: activityLoad(z.z) });
  }
  const days = [...by.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const d of days) d.load = d.all + d.acts.reduce((a, x) => a + x.load, 0);
  return { maxHr, maxSrc: last ? last.maxSrc : null, days };
}

/** K from the full days of the CALIB_DAYS before asOf (asOf itself is still filling up). */
export function calibrate(days, asOf) {
  const from = addDays(asOf, -CALIB_DAYS);
  const loads = days.filter((d) => d.date >= from && d.date < asOf && d.cov >= FULL_DAY_MIN).map((d) => d.load);
  const p95 = loads.length >= MIN_CALIB_DAYS ? percentile(loads, 0.95) : null;
  return p95 > 0 ? { K: p95 / LN_TARGET, p95, n: loads.length } : { K: null, p95: null, n: loads.length };
}

const r1 = (v) => roundTo(v, 1);

/** One day -> its strain + each contributor's share (activities, then the all-day remainder `alls`). */
function scoreDay(d, K) {
  const s = strainOf(d.load, K);
  const share = (l) => (d.load > 0 ? r1((s * l) / d.load) : 0);
  return { date: d.date, s: r1(s), load: r1(d.load), all: r1(d.all), alls: share(d.all), cov: Math.round(d.cov),
    acts: d.acts.map((a) => ({ t: a.t, m: a.m, load: r1(a.load), s: share(a.load) })) };
}

/** Parsed inputs -> null (no hourly data) | {ok: false, reason, asOf, n} | the strain bake. `all` =
 * every scored day as {date, value} (the DETAIL history), not baked into SCORES. */
export function strainFromInputs({ hourly, zones }) {
  if (!hourly || !hourly.length) return null;
  const L = dayLoads({ hourly, zones });
  const asOf = L.days[L.days.length - 1].date;
  if (!L.maxHr) return { ok: false, reason: 'noMaxHr', asOf, n: 0 };
  const c = calibrate(L.days, asOf);
  if (!c.K) return { ok: false, reason: 'fewDays', asOf, n: c.n };
  const from = addDays(asOf, -(RECENT_DAYS - 1));
  const scored = L.days.map((d) => scoreDay(d, c.K));
  return {
    ok: true, asOf, K: roundTo(c.K, 3), p95: r1(c.p95), n: c.n, windowDays: CALIB_DAYS, maxHr: L.maxHr, maxSrc: L.maxSrc,
    days: scored.filter((d) => d.date >= from),
    all: scored.map((d) => ({ date: d.date, value: d.s })),
  };
}

export function buildStrain(extractDir) {
  const hourly = readHrHourly(extractDir);
  return hourly ? strainFromInputs({ hourly, zones: readWorkoutZones(extractDir) }) : null;
}
