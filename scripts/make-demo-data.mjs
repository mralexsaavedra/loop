#!/usr/bin/env node
/* Synthetic demo data for the example build (DATA_MODE=example).
 *
 * Writes clearly FAKE Apple Health extract CSVs to data/demo/extract/ — the same file names and
 * schemas extract.js / the syncs write — so `npm run build:example` renders every section of the
 * page (Inicio dials, Salud sections, Entrenos, intake rings) without anyone's personal data.
 * Every row carries a "Demo …" source tag; see data/demo/README.md.
 *
 * Deterministic: a seeded PRNG (mulberry32) and a FIXED end date, so re-running writes identical
 * bytes and the build stays byte-identical. The figures describe an invented person (roughly
 * 82 kg, trains 5-6 days a week) and follow plausible trends, not anyone's history.
 *
 *   node scripts/make-demo-data.mjs [--end YYYY-MM-DD] [--days N] [--seed N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { READING_HEADER, SLEEP_HEADER, WORKOUTS_HEADER } = require('../data/apple-health/samples.js');

export const DEMO_DEFAULTS = { end: '2026-09-28', days: 120, seed: 20260928 };
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEMO_DIR = path.join(ROOT, 'data', 'demo', 'extract');

// mulberry32: tiny, well-distributed, seedable (Math.random is not)
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
const fx = (v, d) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
const csv = (header, rows) => [header, ...rows].join('\n') + '\n';

const SRC = { watch: 'Demo Watch', phone: 'Demo Phone', scale: 'Demo Scale', tape: 'Demo Tape', strava: 'Demo Strava' };

// weekly template (0 = Sunday): what the invented athlete does on each weekday
const PLAN = { 0: null, 1: 'gym', 2: 'run', 3: 'gym', 4: 'bike', 5: 'gym', 6: 'long' };

/** Pure: { 'file.csv': text } for the whole demo extract. */
export function makeDemoData({ end = DEMO_DEFAULTS.end, days = DEMO_DEFAULTS.days, seed = DEMO_DEFAULTS.seed } = {}) {
  const rnd = prng(seed);
  const noise = (sd) => (rnd() + rnd() + rnd() - 1.5) * sd * 1.41; // ~N(0, sd), bounded
  const dates = Array.from({ length: days }, (_, i) => addDays(end, i - days + 1));
  const out = {};
  const T = (i) => i / (days - 1); // 0 -> 1 across the window

  // ---- training -------------------------------------------------------------------------
  const workouts = [], running = [], workMin = new Map();
  dates.forEach((date, i) => {
    let kind = PLAN[weekday(date)];
    if (kind === 'long') kind = Math.floor(i / 7) % 2 ? 'longRide' : 'longRun';
    const deload = Math.floor(i / 7) % 6 === 5; // every sixth week is lighter
    if (!kind || rnd() < 0.08) return; // the odd missed session
    const k = deload ? 0.7 : 1;
    let row;
    if (kind === 'gym') {
      const dur = (55 + noise(6)) * k, hr = 128 + noise(5);
      const type = rnd() < 0.6 ? 'TraditionalStrengthTraining' : 'HighIntensityIntervalTraining';
      row = [date, type, fx(dur, 2), '', Math.round(hr), '', Math.round(hr + 38 + noise(4)), SRC.watch, '', Math.round(dur * (0.75 + noise(0.08))), '', ''];
    } else if (kind === 'run' || kind === 'longRun') {
      const km = (kind === 'run' ? 8 : 15) * k + noise(0.8), speed = 11 + T(i) * 0.6 + noise(0.4), dur = (km / speed) * 60, hr = 150 + noise(4);
      row = [date, 'Running', fx(dur, 2), '', Math.round(hr), '', Math.round(hr + 22 + noise(3)), SRC.strava, fx(km, 2), Math.round(dur * (1.4 + noise(0.1))), fx(dur * 11.5, 1), ''];
      running.push(`${date},${fx(speed, 2)},${Math.round(262 + T(i) * 8 + noise(6))},${Math.round(246 - T(i) * 6 + noise(3))},${fx(8.4 + noise(0.2), 1)},${fx(1.12 + T(i) * 0.03 + noise(0.02), 2)},${30 + Math.floor(rnd() * 40)}`);
    } else {
      const km = (kind === 'bike' ? 32 : 70) * k + noise(3), speed = 27 + noise(1.5), dur = (km / speed) * 60, hr = 136 + noise(5);
      row = [date, 'Cycling', fx(dur, 2), '', Math.round(hr), '', Math.round(hr + 30 + noise(4)), SRC.strava, fx(km, 2), Math.round(dur * (0.85 + noise(0.08))), fx(dur * 11 * (0.9 + rnd() * 0.2), 1), fx(km * (6 + rnd() * 8), 1)];
    }
    workouts.push(row.join(','));
    workMin.set(date, parseFloat(row[2]));
  });
  out['workouts.csv'] = csv(WORKOUTS_HEADER, workouts);
  out['running-daily.csv'] = csv('date,speed_kmh,power_w,gct_ms,vosc_cm,stride_m,samples', running);

  // ---- body -----------------------------------------------------------------------------
  const weight = [], bodyfat = [], lean = [], waist = [];
  dates.forEach((date, i) => {
    const w = 82.4 - 2.6 * T(i) + 0.35 * Math.sin(i / 3.1) + noise(0.25);
    if (rnd() < 0.72) weight.push(`${date},${fx(w, 2)},${SRC.scale}`);
    if (i % 7 === 3) {
      const bf = 20.5 - 1.9 * T(i) + noise(0.35);
      bodyfat.push(`${date},${fx(bf, 2)},${SRC.scale}`);
      lean.push(`${date},${fx(w * (1 - bf / 100), 2)},${SRC.scale}`);
    }
    if (i % 21 === 6) waist.push(`${date},${fx(88.5 - 2.8 * T(i) + noise(0.3), 1)},${SRC.tape}`);
  });
  out['weight.csv'] = csv(READING_HEADER, weight);
  out['bodyfat.csv'] = csv(READING_HEADER, bodyfat);
  out['leanmass.csv'] = csv(READING_HEADER, lean);
  out['waist.csv'] = csv(READING_HEADER, waist);

  // ---- recovery -------------------------------------------------------------------------
  const hrv = [], rhr = [], vo2 = [], sleep = [], resp = [], temp = [], walk = [];
  dates.forEach((date, i) => {
    const hard = workMin.has(addDays(date, -1)) ? 1 : 0; // the morning after a session
    const base = 52 + 6 * T(i) + 4 * Math.sin(i / 9);
    for (let s = 0, n = 1 + Math.floor(rnd() * 3); s < n; s++) hrv.push(`${date},${fx(base * Math.exp(noise(0.14)) - hard * 3, 1)},${SRC.watch}`);
    rhr.push(`${date},${fx(55 - 2.5 * T(i) + hard * 1.2 + noise(1.1), 2)},${SRC.watch}`);
    if (i % 7 === 5) vo2.push(`${date},${fx(44 + 1.6 * T(i) + noise(0.25), 2)},${SRC.watch}`);
    const hours = 7.25 + (weekday(date) === 6 || weekday(date) === 0 ? 0.4 : 0) + noise(0.45);
    const wake = 6.9 + (weekday(date) === 0 ? 0.8 : 0) + noise(0.25);
    let bed = wake - hours - 0.35 + noise(0.1); // a little time awake in bed
    if (bed < 0) bed += 24;
    sleep.push(`${date},${fx(hours, 2)},${SRC.watch},${fx(bed, 2)},${fx(wake, 2)}`);
    resp.push(`${date},${fx(14.6 + noise(0.35), 1)}`);
    temp.push(`${date},${fx(35.9 + noise(0.18), 2)},${SRC.watch}`);
    walk.push(`${date},${Math.round(99 - 4 * T(i) + noise(2.5))}`);
  });
  out['hrv.csv'] = csv(READING_HEADER, hrv);
  out['rhr.csv'] = csv(READING_HEADER, rhr);
  out['vo2max.csv'] = csv(READING_HEADER, vo2);
  out['sleep-daily.csv'] = csv(SLEEP_HEADER, sleep);
  out['respiratory-daily.csv'] = csv('date,brpm', resp);
  out['wristTemp.csv'] = csv(READING_HEADER, temp);
  out['walking-hr-daily.csv'] = csv('date,bpm', walk);

  // ---- activity + energy ----------------------------------------------------------------
  const steps = [], exercise = [], distance = [], flights = [], active = [], basal = [], diet = [];
  dates.forEach((date, i) => {
    const wm = workMin.get(date) || 0;
    const st = Math.max(2500, 8800 + (weekday(date) === 0 ? -2500 : 0) + noise(1800));
    steps.push(`${date},${Math.round(st)},${rnd() < 0.8 ? SRC.watch : SRC.phone}`);
    exercise.push(`${date},${Math.round(wm + 12 + noise(5))}`);
    distance.push(`${date},${fx(st * 0.00074 + (wm && rnd() < 0.3 ? 5 : 0), 2)}`);
    flights.push(`${date},${Math.max(0, Math.round(9 + noise(4)))}`);
    active.push(`${date},${Math.round(420 + st * 0.02 + wm * 7 + noise(60))}`);
    basal.push(`${date},${Math.round(1760 - 25 * T(i) + noise(18))}`);
    // food is logged on most of the last ~7 weeks, and always on the last day (rings)
    if (i >= days - 48 && (i === days - 1 || rnd() < 0.78)) {
      const p = 162 + noise(12), c = (workMin.has(date) ? 265 : 205) + noise(30), g = 68 + noise(9);
      diet.push(`${date},${Math.round(p * 4 + c * 4 + g * 9 + noise(40))},${fx(p, 1)},${fx(c, 1)},${fx(g, 1)}`);
    }
  });
  out['steps-daily.csv'] = csv('date,steps,source', steps);
  out['exercise-minutes-daily.csv'] = csv('date,minutes', exercise);
  out['distance-daily.csv'] = csv('date,km', distance);
  out['flights-daily.csv'] = csv('date,flights', flights);
  out['active-energy-daily.csv'] = csv('date,kcal', active);
  out['basal-energy-daily.csv'] = csv('date,kcal', basal);
  out['dietary-daily.csv'] = csv('date,kcal,protein_g,carbs_g,fat_g', diet);

  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--end') o.end = argv[++i];
    else if (argv[i] === '--days') o.days = Number(argv[++i]);
    else if (argv[i] === '--seed') o.seed = Number(argv[++i]);
  }
  return o;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = makeDemoData(parseArgs(process.argv.slice(2)));
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(DEMO_DIR, name), text);
  console.log(`make-demo-data: wrote ${Object.keys(files).length} synthetic CSVs -> ${path.relative(ROOT, DEMO_DIR)}/`);
}
