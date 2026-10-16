#!/usr/bin/env node
/* Apple Health extractor — turns the huge export.xml (~700 MB) into small, grep-able
 * per-metric CSVs so every analysis reads the cache instead of re-streaming the XML.
 *
 *   node data/apple-health/extract.mjs
 *
 * Reads  : data/apple-health/export.xml   (gitignored — personal data)
 * Writes : data/apple-health/extract/*.csv + _meta.json  (gitignored), each atomically (temp file + rename),
 *          all under the _meta.json.lock the syncs share (sync-common.mjs withLock), and ONLY after the whole
 *          file was read: a read error or an export without its closing </HealthData> (truncated: a copy
 *          still in progress, a full disk) exits 1 with one ERROR line and keeps the previous extract.
 * HC_DATA_DIR (lib/paths.mjs) moves both: <data root>/files/import/export.xml in, <data root>/extract out.
 * EXTRACT_DIR (tests only) replaces data/apple-health: <dir>/export.xml in, <dir>/extract out (wins over HC_DATA_DIR).
 *
 * Streams line by line (never loads the file whole). Each <Record>/<Workout> opening
 * tag carries the attributes we need on a single line, so a per-line regex is enough.
 *
 * Sparse body metrics (weight, body fat, RHR, VO2, HRV) keep a SOURCE column on purpose:
 * weight often mixes multiple scales/apps, and body fat must be compared within
 * one source only (see profile/baseline.md). High-volume series (steps, energy) are summed
 * per day; energy uses ONE source per day by precedence (Watch > wrist wearable app > iPhone). Daily TOTAL series skip the export's last date
 * (a partial day, recorded as _meta.json exportLastDate). Sleep is best-effort (see _meta.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { isMain } from '../../scripts/lib/is-main.mjs';
import { writeAtomic, runCli, withLock } from './sync-common.mjs';
import { dataPaths } from '../../lib/paths.mjs';
// shared with sync-shortcut.mjs so export- and Shortcut-derived rows are formatted identically
import { APPLE_WATCH_RE, derivedRestingHr, csvSource, pickEnergySource, READING_HEADER, SLEEP_HEADER, WORKOUTS_HEADER, workoutRow, day, num, minutesBetween, wristTempDate, readingRow, sleepRow, sleepNights, sleepStage } from '../../lib/extract/samples.mjs';

const DIR = process.env.EXTRACT_DIR;
const PATHS = dataPaths({ repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') });
const SRC = DIR ? path.join(DIR, 'export.xml') : PATHS.exportXml;
const OUT = DIR ? path.join(DIR, 'extract') : PATHS.extractDir;

const attr = (s, name) => { const m = s.match(new RegExp(' ' + name + '="([^"]*)"')); return m ? m[1] : null; };

// sparse readings: [{date, value, source}]
const readings = { weight: [], bodyfat: [], rhr: [], vo2max: [], hrv: [], leanmass: [], wristTemp: [], hrRecovery: [], waist: [] };
// output file per readings key (default `${key}.csv`)
const READING_FILE = { hrRecovery: 'hr-recovery.csv' };
// daily energy per source: Map<date, Map<source, kcal sum>>. Every device / app writes its OWN
// estimate of the same burn (RENPHO writes an estimated BMR as Basal Energy on weigh-in days, which
// doubled basal), so per day and type ONE source wins by precedence (samples.mjs pickEnergySource:
// Apple Watch > a wrist-wearable app > iPhone; scales and training / nutrition apps never count) and
// only its sum is written. A day with excluded sources only is MISSING (no row).
const energyBySrc = { active: new Map(), basal: new Map() };
// The export's last date is a PARTIAL day (export.xml is taken mid-day): <ExportDate value>, else the
// newest record date. Daily TOTAL series drop it (the Shortcut sync fills it, see sync-shortcut.mjs).
let exportDate = null;
let maxRecordDate = null;
// per-source daily totals for series logged by MULTIPLE devices (iPhone + Watch): we take the
// MAX across sources per day (summing would double-count, exactly like steps). Map<date, Map<src, sum>>
const maxSrc = { exercise: new Map(), distance: new Map(), flights: new Map() };
// daily means: Map<date, {s, n}>  (many readings/day → average them)
const meanDaily = { respiratory: new Map(), walkingHr: new Map() };
// running performance: Map<date, {speed:{s,n}, power:{s,n}, gct:{s,n}, vosc:{s,n}, stride:{s,n}}>
// samples are recorded DURING runs; we keep per-day means (only days with a run have rows). 0s are junk.
const running = new Map();
// steps can come from several devices (phone, watch, other trackers) → keep per-source, take max/day (summing double-counts)
const stepsBySrc = new Map();
// dietary daily: Map<date, {kcal,p,c,g}>
const diet = new Map();
// sleep segments [{start, end, source, stage}] -> nights via samples.mjs sleepNights (naps excluded,
// max across sources per night avoids a double count) — the same rule sync-shortcut.mjs uses
const sleepSegs = [];
// night heart-rate samples (00:00-07:00, never an Apple Watch: it measures its own resting HR) of the
// devices that may need a DERIVED resting HR (samples.mjs derivedRestingHr); kept small on purpose
const nightHr = [];
const workouts = []; // {date, type, durationMin, energyKcal, hrAvg, hrMin, hrMax, source}

const Q = 'HKQuantityTypeIdentifier';
const addEnergy = (key, d, src, v) => addMaxSrc(energyBySrc[key], d, src || '', v);
const addDiet = (d, key, v) => { if (!d || v == null) return; const o = diet.get(d) || { kcal: 0, p: 0, c: 0, g: 0 }; o[key] += v; diet.set(d, o); };
const addMean = (map, d, v) => { if (!d || v == null) return; const o = map.get(d) || { s: 0, n: 0 }; o.s += v; o.n++; map.set(d, o); };
// per-source daily accumulator (later collapsed to max-across-sources per day)
const addMaxSrc = (map, d, src, v) => { if (!d || v == null) return; const m = map.get(d) || new Map(); m.set(src, (m.get(src) || 0) + v); map.set(d, m); };
// add a running-metric sample for a day; drop non-positive values (Zepp emits 0 placeholders)
const addRun = (d, key, v) => { if (!d || !(v > 0)) return; const o = running.get(d) || {}; const m = o[key] || { s: 0, n: 0 }; m.s += v; m.n++; o[key] = m; running.set(d, o); };
const runMean = (o, key) => (o[key] && o[key].n ? o[key].s / o[key].n : null);

function handleRecord(line) {
  const type = attr(line, 'type');
  if (!type) return;
  const d = day(attr(line, 'startDate'));
  const v = num(attr(line, 'value'));
  const src = attr(line, 'sourceName');
  if (d && (!maxRecordDate || d > maxRecordDate)) maxRecordDate = d;
  switch (type) {
    case Q + 'BodyMass':           return v != null && readings.weight.push({ date: d, value: v, source: src });
    case Q + 'BodyFatPercentage':  return v != null && readings.bodyfat.push({ date: d, value: +(v * 100).toFixed(2), source: src }); // fraction -> %
    case Q + 'RestingHeartRate':   return v != null && readings.rhr.push({ date: d, value: v, source: src });
    case Q + 'HeartRate': {
      const start = attr(line, 'startDate');
      if (v == null || !start || !(+start.slice(11, 13) < 7) || APPLE_WATCH_RE.test(src || '')) return;
      return nightHr.push({ start, value: v, source: src });
    }
    case Q + 'VO2Max':             return v != null && readings.vo2max.push({ date: d, value: v, source: src });
    case Q + 'HeartRateVariabilitySDNN': return v != null && readings.hrv.push({ date: d, value: +v.toFixed(1), source: src });
    case Q + 'StepCount': {
      if (d && v != null) { const m = stepsBySrc.get(d) || new Map(); m.set(src, (m.get(src) || 0) + v); stepsBySrc.set(d, m); }
      return;
    }
    case Q + 'ActiveEnergyBurned':   return addEnergy('active', d, src, v);
    case Q + 'BasalEnergyBurned':    return addEnergy('basal', d, src, v);
    case Q + 'DietaryEnergyConsumed':return addDiet(d, 'kcal', v);
    case Q + 'DietaryProtein':       return addDiet(d, 'p', v);
    case Q + 'DietaryCarbohydrates': return addDiet(d, 'c', v);
    case Q + 'DietaryFatTotal':      return addDiet(d, 'g', v);
    case Q + 'LeanBodyMass':         return v != null && readings.leanmass.push({ date: d, value: +v.toFixed(2), source: src });
    case Q + 'HeartRateRecoveryOneMinute': return v != null && readings.hrRecovery.push({ date: d, value: +v.toFixed(1), source: src }); // Cardio Recovery, bpm
    case Q + 'WaistCircumference': { // stored in cm whatever unit the export used
      const cm = v == null ? null : { m: v * 100, in: v * 2.54, ft: v * 30.48 }[attr(line, 'unit')] ?? v;
      return cm != null && readings.waist.push({ date: d, value: +cm.toFixed(1), source: src });
    }
    // dated by the wake-up night (like sleep-daily.csv), not the sample's start date
    case Q + 'AppleSleepingWristTemperature': return v != null && readings.wristTemp.push({ date: wristTempDate(attr(line, 'startDate'), attr(line, 'endDate')), value: +v.toFixed(2), source: src });
    case Q + 'AppleExerciseTime':       return addMaxSrc(maxSrc.exercise, d, src, v);
    case Q + 'DistanceWalkingRunning':  return addMaxSrc(maxSrc.distance, d, src, v);
    case Q + 'FlightsClimbed':          return addMaxSrc(maxSrc.flights, d, src, v);
    case Q + 'RespiratoryRate':         return addMean(meanDaily.respiratory, d, v);
    case Q + 'WalkingHeartRateAverage': return addMean(meanDaily.walkingHr, d, v);
    case Q + 'RunningSpeed':            return addRun(d, 'speed', v);
    case Q + 'RunningPower':            return addRun(d, 'power', v);
    case Q + 'RunningGroundContactTime':  return addRun(d, 'gct', v);
    case Q + 'RunningVerticalOscillation':return addRun(d, 'vosc', v);
    case Q + 'RunningStrideLength':     return addRun(d, 'stride', v);
    case 'HKCategoryTypeIdentifierSleepAnalysis': {
      // every stage is kept: asleep ones build the night, Awake / InBed only add their stage columns
      const stage = sleepStage(attr(line, 'value'));
      if (!stage) return;
      const start = attr(line, 'startDate'), end = attr(line, 'endDate');
      if (!(minutesBetween(start, end) > 0)) return;
      return sleepSegs.push({ start, end, source: src, stage });
    }
  }
}

// A <Workout> spans multiple lines: an opening tag, then child <WorkoutStatistics>/<MetadataEntry>
// lines, then </Workout>. The opening tag alone lacks intensity, so we keep the workout OPEN across
// lines and attach its child stats before pushing it on close.
let curWorkout = null;
function handleWorkoutOpen(line) {
  curWorkout = {
    date: day(attr(line, 'startDate')),
    type: (attr(line, 'workoutActivityType') || '').replace('HKWorkoutActivityType', ''),
    durationMin: num(attr(line, 'duration')),
    energyKcal: num(attr(line, 'totalEnergyBurned')), // legacy attr; null on newer exports (see child stats)
    source: attr(line, 'sourceName'),
    hrAvg: null, hrMin: null, hrMax: null, distanceKm: null,
  };
  if (line.indexOf('</Workout>') !== -1) handleWorkoutClose(); // self-contained on one line (rare)
}
// child stats carry per-workout HR (avg/min/max) and, on newer exports, the energy the opening tag drops
function handleWorkoutStat(line) {
  if (!curWorkout) return;
  const t = attr(line, 'type');
  if (t === Q + 'HeartRate') {
    curWorkout.hrAvg = num(attr(line, 'average'));
    curWorkout.hrMin = num(attr(line, 'minimum'));
    curWorkout.hrMax = num(attr(line, 'maximum'));
  } else if (t === Q + 'ActiveEnergyBurned' && curWorkout.energyKcal == null) {
    curWorkout.energyKcal = num(attr(line, 'sum'));
  } else if (t === Q + 'DistanceWalkingRunning') {
    curWorkout.distanceKm = num(attr(line, 'sum')); // GPS distance for the session (run/walk)
  }
}
function handleWorkoutClose() {
  if (curWorkout) { workouts.push(curWorkout); curWorkout = null; }
}

const csv = (file, header, rows) => {
  writeAtomic(path.join(OUT, file), [header, ...rows].join('\n') + '\n');
  return rows.length;
};
const sortByDate = arr => arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const range = dates => dates.length ? `${dates[0]}..${dates[dates.length - 1]}` : 'n/a';

let lineCount = 0;
// the export's closing tag: without it the file is truncated and nothing is written
let sawEnd = false;
function onLine(line) {
  lineCount++;
  if (line.indexOf('</HealthData>') !== -1) sawEnd = true;
  // cheap prefilter before regex work ('<Workout ' has a trailing space → won't match '<WorkoutStatistics')
  if (line.indexOf('<Record ') !== -1) handleRecord(line);
  else if (line.indexOf('<ExportDate ') !== -1) exportDate = day(attr(line, 'value')) || null;
  else if (line.indexOf('<Workout ') !== -1) handleWorkoutOpen(line);
  else if (line.indexOf('<WorkoutStatistics ') !== -1) handleWorkoutStat(line);
  else if (line.indexOf('</Workout>') !== -1) handleWorkoutClose();
}
function onClose() {
  if (!sawEnd) {
    throw new Error(`export.xml ends before </HealthData> after ${lineCount.toLocaleString()} lines (truncated: still copying, or a full disk?); nothing written, the previous extract is kept`);
  }
  const counts = {};
  const exportLastDate = exportDate || maxRecordDate;
  // daily TOTAL series skip the partial last day (means, points, sleep and workouts keep it)
  const complete = (/** @type {any[]} */ [d]) => d !== exportLastDate;
  // resting HR derived from the night's heart rate where nothing measured it (measured always wins)
  const derivedRhr = derivedRestingHr(nightHr, readings.rhr);
  readings.rhr.push(...derivedRhr);
  // sparse readings
  for (const [k, arr] of Object.entries(readings)) {
    sortByDate(arr);
    counts[k] = csv(READING_FILE[k] || `${k}.csv`, READING_HEADER, arr.map(readingRow));
  }
  counts.rhr_derived = derivedRhr.length;
  // daily sums
  const dumpDaily = (map, file, col) => {
    const rows = [...map.entries()].filter(complete).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, v]) => `${d},${Math.round(v)}`);
    return csv(file, `date,${col}`, rows);
  };
  // steps: max across the day's sources (dedupe overlapping devices)
  counts.steps = csv('steps-daily.csv', 'date,steps,source',
    [...stepsBySrc.entries()].filter(complete).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, bySrc]) => {
      let best = null;
      for (const [s, v] of bySrc) if (!best || v > best.v) best = { s, v };
      return `${d},${Math.round(best.v)},${csvSource(best.s)}`;
    }));
  // energy: ONE source per day by precedence; energySources counts the days each family won
  const energySources = { active: {}, basal: {} };
  const dumpEnergy = (key, file) => {
    const won = new Map();
    for (const [d, bySrc] of energyBySrc[key]) {
      const pick = pickEnergySource(bySrc);
      if (!pick) continue;
      won.set(d, pick.kcal);
      if (complete([d])) energySources[key][pick.family] = (energySources[key][pick.family] || 0) + 1;
    }
    return dumpDaily(won, file, 'kcal');
  };
  counts.active_energy = dumpEnergy('active', 'active-energy-daily.csv');
  counts.basal_energy = dumpEnergy('basal', 'basal-energy-daily.csv');
  // dietary
  counts.dietary = csv('dietary-daily.csv', 'date,kcal,protein_g,carbs_g,fat_g',
    [...diet.entries()].filter(complete).sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([d, o]) => `${d},${Math.round(o.kcal)},${o.p.toFixed(1)},${o.c.toFixed(1)},${o.g.toFixed(1)}`));
  // sleep — main sleep per wake-up night (naps excluded), max minutes across sources.
  // bedtime/waketime = earliest start / latest end of that main sleep (decimal local hour).
  counts.sleep = csv('sleep-daily.csv', SLEEP_HEADER,
    sleepNights(sleepSegs).map(n => sleepRow(n.date, n.minutes, n.source, n.ck, n.stages)));
  // activity: MAX across sources per day (iPhone + Watch both log these → summing double-counts)
  const dumpMaxSrc = (map, file, col, dec) => csv(file, `date,${col}`,
    [...map.entries()].filter(complete).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, bySrc]) => {
      let best = null; for (const [s, v] of bySrc) if (!best || v > best.v) best = { s, v };
      return `${d},${dec != null ? best.v.toFixed(dec) : Math.round(best.v)}`;
    }));
  counts.exercise = dumpMaxSrc(maxSrc.exercise, 'exercise-minutes-daily.csv', 'minutes');
  counts.flights = dumpMaxSrc(maxSrc.flights, 'flights-daily.csv', 'flights');
  counts.distance = dumpMaxSrc(maxSrc.distance, 'distance-daily.csv', 'km', 2);
  // daily means
  const dumpMean = (map, file, col, dec = 1) => csv(file, `date,${col}`,
    [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, o]) => `${d},${(o.s / o.n).toFixed(dec)}`));
  counts.respiratory = dumpMean(meanDaily.respiratory, 'respiratory-daily.csv', 'brpm');
  counts.walking_hr = dumpMean(meanDaily.walkingHr, 'walking-hr-daily.csv', 'bpm', 0);
  // running performance — per-day means over a run's samples (only days with a run get a row)
  counts.running = csv('running-daily.csv', 'date,speed_kmh,power_w,gct_ms,vosc_cm,stride_m,samples',
    [...running.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, o]) => {
      const f = (k, dec) => { const m = runMean(o, k); return m == null ? '' : m.toFixed(dec); };
      const n = Math.max(...['speed', 'power', 'gct', 'vosc', 'stride'].map(k => o[k] ? o[k].n : 0));
      return `${d},${f('speed', 2)},${f('power', 0)},${f('gct', 0)},${f('vosc', 1)},${f('stride', 2)},${n}`;
    }));
  // workouts
  sortByDate(workouts);
  counts.workouts = csv('workouts.csv', WORKOUTS_HEADER, workouts.map(workoutRow));

  const meta = {
    extractedFrom: 'export.xml',
    linesScanned: lineCount,
    exportLastDate,
    energySources,
    rows: counts,
    ranges: {
      weight: range(readings.weight.map(r => r.date)),
      restingHR: range(readings.rhr.map(r => r.date)),
      steps: range([...stepsBySrc.keys()].sort()),
      dietary: range([...diet.keys()].sort()),
      workouts: range(workouts.map(w => w.date).sort()),
      running: range([...running.keys()].sort()),
      distance: range([...maxSrc.distance.keys()].sort()),
    },
    notes: [
      'Body metrics keep a source column — weight mixes scales/apps; compare body fat within one scale only.',
      'steps = max across devices per day (phone + watch + other trackers overlap → summing would double-count).',
      'active/basal energy = per day and type, the sum of ONE source chosen by precedence: Apple Watch > a wrist-wearable app (Zepp, Mi Fit, Amazfit, Garmin Connect, Polar Flow, Fitbit, Huawei Health) > iPhone; never a sum across sources. Scales (their BMR estimate on weigh-in days) and training / nutrition apps are never used; a day with only those has no row. energySources = days won per source family and type. dietary = per-day sums (intake exists only on days a food app logged it).',
      'exportLastDate = the export\'s <ExportDate> (else the newest record date): a PARTIAL day, dropped from the daily TOTAL series (steps, active/basal energy, exercise, distance, flights, dietary); npm run sync fills it from the Shortcut. Means, points, sleep and workouts keep it.',
      'sleep is best-effort: asleep intervals only, main sleep per wake-up night (naps excluded: blocks outside the 20:00-12:00 window or far from the main block), max across sources per night; verify against the Watch trend.',
      'sleep bedtime/waketime = earliest start / latest end of the night\'s main sleep, decimal local hour.',
      'sleep ESTIMATED nights: a source that never wrote an asleep value (a band that writes only In bed, e.g. Mi Fitness; never the iPhone) gives a night with no asleep data from any source its main in-bed block (same nap rules, at least 3 h) as asleep_hours, source "<app> (in bed)", every stage column blank.',
      'sleep stage columns (hours; blank = unknown, e.g. rows written before they existed): rem_h/deep_h/core_h = the winning source\'s main-sleep minutes per stage (blank on unstaged nights), unspec_h = "Asleep (unspecified)" (older Watch data, third-party trackers), awake_h = that source\'s Awake records inside the sleep window (first asleep start to last asleep end), inbed_h = that window united with any source\'s overlapping InBed records (the iPhone writes InBed; without one it is the window itself). asleep_hours is unchanged and can differ from the stage sum by overlaps.',
      'rhr.csv also carries DERIVED resting HR (source "<app> (derived)", rows: rhr_derived) for a device that writes heart rate but no RestingHeartRate (Mi Fitness and similar): the lowest 30-min rolling mean (>= 4 samples) of the heart-rate samples between 00:00 and 07:00 of that date, needing samples in >= 3 clock hours; never on a date with a measured value, never from a source that measures it, never from an Apple Watch.',
      'wristTemp is dated by the wake-up night (18:00 roll-over, like sleep), not the sample start date.',
      'exercise/distance/flights = max across devices per day (iPhone+Watch overlap → summing double-counts, like steps); respiratory & walking-HR are per-day means.',
      'running-daily = per-day MEANS over a run\'s samples (only days with a run get a row); 0-valued samples (Zepp placeholders) dropped. speed km/h, power W, gct ms, vosc cm, stride m.',
      'hr-recovery.csv = Cardio Recovery (HeartRateRecoveryOneMinute, bpm drop 1 min after a workout), one row per sample.',
      'waist.csv = WaistCircumference in cm (sparse, manual measurements, one row per sample).',
      'leanmass & wristTemp are sparse, source-tagged (leanmass mixes scales like weight; wrist temp is sleeping-watch only).',
      'workouts now carry hr_avg/hr_min/hr_max (bpm) and energy_kcal pulled from child <WorkoutStatistics> (per-workout intensity; HR coverage starts when a watch was first worn).',
      'workouts.csv has 12 columns; relative_effort, kilojoules and elevation_m are filled only by Strava rows (npm run sync:strava) and stay empty on export rows. Readers tolerate shorter rows from older runs.',
      'Regenerate after dropping a new export: node data/apple-health/extract.mjs',
    ],
  };
  writeAtomic(path.join(OUT, '_meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`Scanned ${lineCount.toLocaleString()} lines → ${OUT}`);
  console.log(Object.entries(counts).map(([k, n]) => `  ${k}: ${n}`).join('\n'));
}

/** Streams SRC into the extract; resolves to the exit code (1 = no export.xml, nothing written). Run once
 * per process: the series above are module state. */
export function main() {
  if (!fs.existsSync(SRC)) {
    console.error('ERROR: export.xml not found at ' + SRC + '\nNo export yet? Put it there (README → Level 1, step 3), or see the page with demo data: npm run build:example');
    return Promise.resolve(1);
  }
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(SRC, { encoding: 'utf8' });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    // any failure while reading rejects ONCE (runCli: one ERROR line, exit 1) and the 'close' that follows
    // writes nothing, so a half-read export never replaces a good extract
    let failed = false;
    const fail = (/** @type {any} */ err) => {
      if (failed) return;
      failed = true;
      reject(err);
      rl.close();
      input.destroy();
    };
    input.on('error', fail);
    rl.on('error', fail);
    rl.on('line', (line) => {
      if (failed) return;
      try { onLine(line); } catch (err) { fail(err); }
    });
    rl.on('close', () => {
      if (failed) return;
      try {
        fs.mkdirSync(OUT, { recursive: true }); // the lockfile needs the directory
        withLock(path.join(OUT, '_meta.json.lock'), () => onClose());
        resolve(0);
      } catch (err) { reject(err); }
    });
  });
}

const USAGE = `Usage: node data/apple-health/extract.mjs

Streams data/apple-health/export.xml into the per-metric CSVs + _meta.json of data/apple-health/extract/.
  -h, --help   this help
Env: HC_DATA_DIR (the data root: <root>/files/import/export.xml in, <root>/extract out; HC_FILES_DIR moves files/);
EXTRACT_DIR (tests only) replaces data/apple-health: <dir>/export.xml in, <dir>/extract out.`;

if (isMain(import.meta.url)) runCli(() => main(), { usage: USAGE });
