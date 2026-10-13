#!/usr/bin/env node
/* Synthetic demo data for the example build (DATA_MODE=example).
 *
 * Writes clearly FAKE Apple Health extract CSVs to data/demo/extract/ — the same file names and
 * schemas extract.mjs / the syncs write — so `npm run build:example` renders every section of the
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
import { fileURLToPath } from 'node:url';
import { journalCsv } from '../lib/journal/journal.mjs';
import { JOURNAL_FILE } from '../lib/journal/bake.mjs';
import { FOODLOG_FILE, FOODLOG_HEADER } from '../lib/nutrition/score.mjs';
import { isMain } from './lib/is-main.mjs';
import { READING_HEADER, SLEEP_HEADER, WORKOUTS_HEADER } from '../data/apple-health/samples.mjs';
import { HR_HOURLY_HEADER, HR_HOURLY_CSV } from '../lib/health/hr-hourly.mjs';
import { ZONES_HEADER, ZONES_CSV } from '../lib/training/hr-zones.mjs';

// journal-daily.csv: the last JOURNAL_DAYS days, most of them journaled (the example's My journal card +
// behaviour insights)
const JOURNAL_DAYS = 70;
// hr-hourly.csv covers only the last four weeks (the Shortcut key is recent; enough to calibrate strain)
const HR_DAYS = 28;
// foodlog-daily.csv: the last FOOD_DAYS days, most of them logged (the example's nutrition score)
const FOOD_DAYS = 60;

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
  // sleep stages draw from their OWN stream, so adding them left every other demo series unchanged
  const srnd = prng(seed + 1);
  const snoise = (sd) => (srnd() + srnd() + srnd() - 1.5) * sd * 1.41;
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
    // stages as shares of the asleep time (REM ~22 %, deep ~15 %, core the rest), awake inside the
    // window, in bed = the bed-to-wake window (no phone InBed record in the demo)
    const rem = hours * (0.22 + snoise(0.03)), deep = hours * (0.15 + snoise(0.025)) - hard * 0.1;
    const inbed = (wake - bed + 24) % 24;
    const st = [rem, deep, hours - rem - deep, 0, Math.max(0.05, inbed - hours), inbed];
    sleep.push(`${date},${fx(hours, 2)},${SRC.watch},${fx(bed, 2)},${fx(wake, 2)},${st.map((v) => fx(v, 2)).join(',')}`);
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

  // ---- per-workout HR zones (workout-zones.csv, as sync-strava.mjs writes it) -------------------
  // one row per Demo Strava run / ride: ~97 % of the duration spread over zones 0-5 around a
  // typical split (runs mostly zone 3, rides mostly zone 2); max HR = the highest Demo Strava max
  // HR, like the "observed" rule. Its own PRNG, so the other files never change because of it.
  const zrnd = prng(seed + 2);
  const stravaRows = workouts.map((l) => l.split(',')).filter((c) => c[7] === SRC.strava);
  const zMax = Math.max(...stravaRows.map((c) => Number(c[6])));
  const SPLIT = { Running: [0.02, 0.05, 0.2, 0.45, 0.22, 0.06], Cycling: [0.05, 0.2, 0.45, 0.22, 0.07, 0.01] };
  const zoneRows = stravaRows.map((c, i) => {
    const w = SPLIT[c[1]].map((x) => x * (0.7 + zrnd() * 0.6));
    const sum = w.reduce((a, b) => a + b, 0);
    const total = parseFloat(c[2]) * 60 * 0.97;
    // the activity window (start + elapsed_s): every demo session starts at 18:00 local, +02:00
    return [c[0], 9000001 + i, c[1], zMax, 'observed', c[4], c[6], ...w.map((x) => Math.round((total * x) / sum)), SRC.strava,
      `${c[0]}T18:00:00+02:00`, Math.round(parseFloat(c[2]) * 60)].join(',');
  });
  out[ZONES_CSV] = csv(ZONES_HEADER, zoneRows);

  // ---- Watch heart rate per clock hour (hr-hourly.csv, as the Shortcut sync writes it) ---------
  // the last HR_DAYS days, a sample every 5 min: nights ~55 bpm, days ~58-70 with the odd walk at
  // 100-120 and the Watch-only gym session at 120-140, and the Strava session's window (18:00 + its elapsed time) left out of the histogram
  // (act_min), exactly like lib/health/hr-hourly.mjs. Its own PRNG, so the other files never change.
  const hrnd = prng(seed + 3);
  const gymDays = new Set(workouts.map((l) => l.split(',')).filter((c) => c[7] === SRC.watch).map((c) => c[0]));
  const actSec = new Map(zoneRows.map((l) => l.split(',')).map((c) => [c[0], Number(c[15])]));
  const hourly = [];
  for (const date of dates.slice(-HR_DAYS)) {
    for (let h = 0; h < 24; h++) {
      const act = Math.max(0, Math.min(60, (actSec.get(date) || 0) / 60 - (h - 18) * 60)) * (h >= 18 ? 1 : 0);
      const night = h < 7 || h === 23;
      const base = night ? 52 + hrnd() * 6 : 58 + hrnd() * 12;
      const free = 60 - act;
      // minutes of brisk walking, or the gym session (Watch only, no Strava window: all-day load)
      const gym = h === 18 && gymDays.has(date) ? 45 : 0;
      const walk = Math.min(free, gym || (!night && hrnd() < 0.12 ? 10 + Math.round(hrnd() * 25) : 0));
      const up = Math.min(10, free - walk);
      const buckets = [[Math.round(base), free - walk - up], [Math.round(base + 6), up], ...(walk ? [[Math.round((gym ? 120 : 98) + hrnd() * 20), walk]] : [])]
        .filter(([, m]) => m > 0);
      const hist = buckets.filter(([b]) => b >= 50).map(([b, m]) => `${b}:${Math.round(m * 60)}`).join(' ');
      const all = act ? [...buckets, [150, act]] : buckets;
      const avg = all.reduce((x, [b, m]) => x + b * m, 0) / 60;
      hourly.push([date, `${date}T${String(h).padStart(2, '0')}:00:00+02:00`, fx(avg, 1), Math.max(...all.map(([b]) => b)), Math.min(...all.map(([b]) => b)),
        12, '60.0', fx(act, 1), hist, SRC.watch].join(','));
    }
  }
  out[HR_HOURLY_CSV] = csv(HR_HOURLY_HEADER, hourly);

  // ---- behaviour journal (journal-daily.csv, as scripts/sync-journal.mjs writes it) -------------
  // an invented routine: drinks mostly on Friday / Saturday, late caffeine and screens now and then,
  // mobility on rest days, rare illness; ~1 day in 8 not journaled. Its own PRNG, so the other files
  // never change. Any association with the demo recovery is chance, like the rest of the demo.
  const jrnd = prng(seed + 4);
  const journal = [];
  for (const date of dates.slice(-JOURNAL_DAYS)) {
    if (jrnd() < 0.12) continue;
    const wd = weekday(date), weekend = wd === 5 || wd === 6;
    const yes = (p) => jrnd() < p;
    journal.push({ date, notes: null, answers: {
      caffeine_late: yes(0.3), nap: yes(weekend ? 0.4 : 0.15), mobility: yes(PLAN[wd] ? 0.25 : 0.8),
      alcohol: weekend ? (yes(0.7) ? 1 + Math.floor(jrnd() * 4) : 0) : (yes(0.12) ? 1 : 0),
      late_meal: yes(weekend ? 0.5 : 0.2), screen_in_bed: yes(0.45), evening_supplements: yes(0.85),
      stressful_day: yes(wd >= 1 && wd <= 4 ? 0.35 : 0.1), ill: yes(0.03),
    } });
  }
  out[JOURNAL_FILE] = journalCsv(journal);

  // ---- food log (foodlog-daily.csv, as data/nutrition/sync-foodlog.js writes it) ----------------
  // an invented eater around the example plan's maintain targets for the weekday's session (meals
  // kcal: rest 2300, gym / run 2700, ride days ~2800-2900 after the ride fuel; protein 125 g, fat 65 g):
  // ~1 day in 8 not logged, a looser weekend, a dinner left unlogged now and then, and a few days with
  // an entry lacking protein or fat (missing_macros: those sums are minimums). Its own PRNG.
  const frnd = prng(seed + 5);
  const fnoise = (sd) => (frnd() + frnd() + frnd() - 1.5) * sd * 1.41;
  const MEALS_K = { gym: 2700, run: 2700, bike: 2800, long: 2900 };
  const food = [];
  for (const date of dates.slice(-FOOD_DAYS)) {
    if (frnd() < 0.12) continue;
    const wd = weekday(date), weekend = wd === 0 || wd === 6;
    const kcalT = MEALS_K[PLAN[wd]] || 2300;
    const noDinner = frnd() < 0.08;
    const k = Math.round(kcalT * (1 + fnoise(weekend ? 0.16 : 0.1)) * (noDinner ? 0.7 : 1));
    const p = Math.max(40, 125 * (0.95 + fnoise(0.15)) * (noDinner ? 0.7 : 1));
    const f = Math.max(15, 65 * (1.05 + fnoise(weekend ? 0.25 : 0.15)));
    const c = Math.max(50, (k - 4 * p - 9 * f) / 4);
    const miss = frnd() < 0.08 ? (frnd() < 0.5 ? ['protein'] : ['fat']) : [];
    const groups = [1 + Math.floor(frnd() * 3), 1 + Math.floor(frnd() * 3), noDinner ? 0 : 1 + Math.floor(frnd() * 3), Math.floor(frnd() * 3)];
    const n = groups.reduce((a, b) => a + b, 0);
    const pv = miss[0] === 'protein' ? p * 0.8 : p, fv = miss[0] === 'fat' ? f * 0.7 : f;
    food.push([date, k, fx(pv, 1), fx(c, 1), fx(fv, 1), n, ...groups, miss.join(';')].join(','));
  }
  out[FOODLOG_FILE] = csv(FOODLOG_HEADER, food);

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

if (isMain(import.meta.url)) {
  const files = makeDemoData(parseArgs(process.argv.slice(2)));
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(DEMO_DIR, name), text);
  console.log(`make-demo-data: wrote ${Object.keys(files).length} synthetic CSVs -> ${path.relative(ROOT, DEMO_DIR)}/`);
}
