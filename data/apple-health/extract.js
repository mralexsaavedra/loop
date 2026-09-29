#!/usr/bin/env node
/* Apple Health extractor — turns the huge export.xml (~700 MB) into small, grep-able
 * per-metric CSVs so every analysis reads the cache instead of re-streaming the XML.
 *
 *   node data/apple-health/extract.js
 *
 * Reads  : data/apple-health/export.xml   (gitignored — personal data)
 * Writes : data/apple-health/extract/*.csv + _meta.json  (gitignored)
 *
 * Streams line by line (never loads the file whole). Each <Record>/<Workout> opening
 * tag carries the attributes we need on a single line, so a per-line regex is enough.
 *
 * Sparse body metrics (weight, body fat, RHR, VO2, HRV) keep a SOURCE column on purpose:
 * weight often mixes multiple scales/apps, and body fat must be compared within
 * one source only (see profile/baseline.md). High-volume series (steps, energy) are summed
 * per day. Sleep is best-effort (see note in _meta.json).
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DIR = __dirname;
const SRC = path.join(DIR, 'export.xml');
const OUT = path.join(DIR, 'extract');

if (!fs.existsSync(SRC)) { console.error('ERROR: export.xml not found at ' + SRC); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const attr = (s, name) => { const m = s.match(new RegExp(' ' + name + '="([^"]*)"')); return m ? m[1] : null; };
// shared with sync-shortcut.js so export- and Shortcut-derived rows are formatted identically
const { READING_HEADER, SLEEP_HEADER, day, num, absMs, minutesBetween, sleepNight, readingRow, sleepRow } = require('./samples.js');

// sparse readings: [{date, value, source}]
const readings = { weight: [], bodyfat: [], rhr: [], vo2max: [], hrv: [], leanmass: [], wristTemp: [], hrRecovery: [] };
// output file per readings key (default `${key}.csv`)
const READING_FILE = { hrRecovery: 'hr-recovery.csv' };
// daily sums: Map<date, number>  (energy is single-source per the export → summing is correct)
const daily = { active: new Map(), basal: new Map() };
// per-source daily totals for series logged by MULTIPLE devices (iPhone + Watch): we take the
// MAX across sources per day (summing would double-count, exactly like steps). Map<date, Map<src, sum>>
const maxSrc = { exercise: new Map(), distance: new Map(), flights: new Map() };
// daily means: Map<date, {s, n}>  (many readings/day → average them)
const meanDaily = { respiratory: new Map(), walkingHr: new Map() };
// running performance: Map<date, {speed:{s,n}, power:{s,n}, gct:{s,n}, vosc:{s,n}, stride:{s,n}}>
// samples are recorded DURING runs; we keep per-day means (only days he ran have rows). 0s are junk.
const running = new Map();
// sleep clock: Map<night, {start, end}> earliest asleep start / latest asleep end (for bedtime regularity)
const sleepClock = new Map();
// steps come from 3 devices (iPhone/Zepp/Mi Fit) → keep per-source, take max/day (summing double-counts)
const stepsBySrc = new Map();
// dietary daily: Map<date, {kcal,p,c,g}>
const diet = new Map();
// sleep: Map<date, Map<source, minutes>>  (max across sources per night avoids double-count)
const sleep = new Map();
const workouts = []; // {date, type, durationMin, energyKcal, hrAvg, hrMin, hrMax, source}

const Q = 'HKQuantityTypeIdentifier';
const addSum = (map, d, v) => { if (d && v != null) map.set(d, (map.get(d) || 0) + v); };
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
  switch (type) {
    case Q + 'BodyMass':           return v != null && readings.weight.push({ date: d, value: v, source: src });
    case Q + 'BodyFatPercentage':  return v != null && readings.bodyfat.push({ date: d, value: +(v * 100).toFixed(2), source: src }); // fraction -> %
    case Q + 'RestingHeartRate':   return v != null && readings.rhr.push({ date: d, value: v, source: src });
    case Q + 'VO2Max':             return v != null && readings.vo2max.push({ date: d, value: v, source: src });
    case Q + 'HeartRateVariabilitySDNN': return v != null && readings.hrv.push({ date: d, value: +v.toFixed(1), source: src });
    case Q + 'StepCount': {
      if (d && v != null) { const m = stepsBySrc.get(d) || new Map(); m.set(src, (m.get(src) || 0) + v); stepsBySrc.set(d, m); }
      return;
    }
    case Q + 'ActiveEnergyBurned':   return addSum(daily.active, d, v);
    case Q + 'BasalEnergyBurned':    return addSum(daily.basal, d, v);
    case Q + 'DietaryEnergyConsumed':return addDiet(d, 'kcal', v);
    case Q + 'DietaryProtein':       return addDiet(d, 'p', v);
    case Q + 'DietaryCarbohydrates': return addDiet(d, 'c', v);
    case Q + 'DietaryFatTotal':      return addDiet(d, 'g', v);
    case Q + 'LeanBodyMass':         return v != null && readings.leanmass.push({ date: d, value: +v.toFixed(2), source: src });
    case Q + 'HeartRateRecoveryOneMinute': return v != null && readings.hrRecovery.push({ date: d, value: +v.toFixed(1), source: src }); // Cardio Recovery, bpm
    case Q + 'AppleSleepingWristTemperature': return v != null && readings.wristTemp.push({ date: d, value: +v.toFixed(2), source: src });
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
      const val = attr(line, 'value') || '';
      if (!/Asleep/.test(val)) return; // count asleep stages only (skip InBed / Awake)
      const start = attr(line, 'startDate'), end = attr(line, 'endDate');
      const mins = minutesBetween(start, end);
      if (!(mins > 0)) return;
      // attribute to the wake-up date so an evening→morning night isn't split across two rows
      const night = sleepNight(start);
      const bySrc = sleep.get(night) || new Map();
      bySrc.set(src, (bySrc.get(src) || 0) + mins);
      sleep.set(night, bySrc);
      // earliest asleep start / latest asleep end of the night -> bedtime & wake regularity
      const ck = sleepClock.get(night) || { start: start, end: end };
      if (absMs(start) < absMs(ck.start)) ck.start = start;
      if (absMs(end) > absMs(ck.end)) ck.end = end;
      return sleepClock.set(night, ck);
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
  fs.writeFileSync(path.join(OUT, file), [header, ...rows].join('\n') + '\n');
  return rows.length;
};
const sortByDate = arr => arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const range = dates => dates.length ? `${dates[0]}..${dates[dates.length - 1]}` : 'n/a';

let lineCount = 0;
const rl = readline.createInterface({ input: fs.createReadStream(SRC, { encoding: 'utf8' }), crlfDelay: Infinity });
rl.on('line', line => {
  lineCount++;
  // cheap prefilter before regex work ('<Workout ' has a trailing space → won't match '<WorkoutStatistics')
  if (line.indexOf('<Record ') !== -1) handleRecord(line);
  else if (line.indexOf('<Workout ') !== -1) handleWorkoutOpen(line);
  else if (line.indexOf('<WorkoutStatistics ') !== -1) handleWorkoutStat(line);
  else if (line.indexOf('</Workout>') !== -1) handleWorkoutClose();
});
rl.on('close', () => {
  const counts = {};
  // sparse readings
  for (const [k, arr] of Object.entries(readings)) {
    sortByDate(arr);
    counts[k] = csv(READING_FILE[k] || `${k}.csv`, READING_HEADER, arr.map(readingRow));
  }
  // daily sums
  const dumpDaily = (map, file, col) => {
    const rows = [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, v]) => `${d},${Math.round(v)}`);
    return csv(file, `date,${col}`, rows);
  };
  // steps: max across the day's sources (dedupe overlapping devices)
  counts.steps = csv('steps-daily.csv', 'date,steps,source',
    [...stepsBySrc.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, bySrc]) => {
      let best = null;
      for (const [s, v] of bySrc) if (!best || v > best.v) best = { s, v };
      return `${d},${Math.round(best.v)},${best.s || ''}`;
    }));
  counts.active_energy = dumpDaily(daily.active, 'active-energy-daily.csv', 'kcal');
  counts.basal_energy = dumpDaily(daily.basal, 'basal-energy-daily.csv', 'kcal');
  // dietary
  counts.dietary = csv('dietary-daily.csv', 'date,kcal,protein_g,carbs_g,fat_g',
    [...diet.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([d, o]) => `${d},${Math.round(o.kcal)},${o.p.toFixed(1)},${o.c.toFixed(1)},${o.g.toFixed(1)}`));
  // sleep — max minutes across sources per night (avoids cross-source double count).
  // bedtime/waketime = earliest asleep start / latest asleep end of the night (decimal local hour).
  counts.sleep = csv('sleep-daily.csv', SLEEP_HEADER,
    [...sleep.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, bySrc]) => {
      let best = null;
      for (const [s, m] of bySrc) if (!best || m > best.m) best = { s, m };
      return sleepRow(d, best.m, best.s, sleepClock.get(d));
    }));
  // activity: MAX across sources per day (iPhone + Watch both log these → summing double-counts)
  const dumpMaxSrc = (map, file, col, dec) => csv(file, `date,${col}`,
    [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, bySrc]) => {
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
  // running performance — per-day means over a run's samples (only days he ran get a row)
  counts.running = csv('running-daily.csv', 'date,speed_kmh,power_w,gct_ms,vosc_cm,stride_m,samples',
    [...running.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, o]) => {
      const f = (k, dec) => { const m = runMean(o, k); return m == null ? '' : m.toFixed(dec); };
      const n = Math.max(...['speed', 'power', 'gct', 'vosc', 'stride'].map(k => o[k] ? o[k].n : 0));
      return `${d},${f('speed', 2)},${f('power', 0)},${f('gct', 0)},${f('vosc', 1)},${f('stride', 2)},${n}`;
    }));
  // workouts
  sortByDate(workouts);
  const bpm = v => (v != null ? Math.round(v) : '');
  const km2 = v => (v != null ? Math.round(v * 100) / 100 : '');
  counts.workouts = csv('workouts.csv', 'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km',
    workouts.map(w => `${w.date},${w.type},${w.durationMin ?? ''},${w.energyKcal ?? ''},${bpm(w.hrAvg)},${bpm(w.hrMin)},${bpm(w.hrMax)},${w.source || ''},${km2(w.distanceKm)}`));

  const allDates = sortByDate([...readings.weight]).map(r => r.date);
  const meta = {
    extractedFrom: 'export.xml',
    linesScanned: lineCount,
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
      'steps = max across devices per day (iPhone/Zepp/Mi Fit overlap → summing would double-count).',
      'active/basal energy + dietary are per-day sums (energy validated single-source; logging stopped 2025-11-26).',
      'sleep is best-effort: asleep intervals only, max across sources per night; verify against the Watch trend.',
      'sleep bedtime/waketime = earliest asleep start / latest asleep end of the night, decimal local hour.',
      'exercise/distance/flights = max across devices per day (iPhone+Watch overlap → summing double-counts, like steps); respiratory & walking-HR are per-day means.',
      'running-daily = per-day MEANS over a run\'s samples (only days with a run get a row); 0-valued samples (Zepp placeholders) dropped. speed km/h, power W, gct ms, vosc cm, stride m.',
      'hr-recovery.csv = Cardio Recovery (HeartRateRecoveryOneMinute, bpm drop 1 min after a workout), one row per sample.',
      'leanmass & wristTemp are sparse, source-tagged (leanmass mixes scales like weight; wrist temp is sleeping-watch only).',
      'workouts now carry hr_avg/hr_min/hr_max (bpm) and energy_kcal pulled from child <WorkoutStatistics> (per-workout intensity; HR coverage is Apple-Watch-era, ~2025+).',
      'Regenerate after dropping a new export: node data/apple-health/extract.js',
    ],
  };
  fs.writeFileSync(path.join(OUT, '_meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`Scanned ${lineCount.toLocaleString()} lines → ${OUT}`);
  console.log(Object.entries(counts).map(([k, n]) => `  ${k}: ${n}`).join('\n'));
});
