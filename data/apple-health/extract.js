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
 * weight mixes scales (RENPHO/OKOK) + manual apps, and body fat must be compared within
 * one scale only (see profile/baseline.md). High-volume series (steps, energy) are summed
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
const day = dt => (dt || '').slice(0, 10);              // "2026-06-12 09:10:00 +0200" -> "2026-06-12"
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
// minutes between two "YYYY-MM-DD HH:MM:SS +ZZZZ" stamps (same tz → ignore offset, parse naive-local)
const minutesBetween = (start, end) => (Date.parse(end.slice(0, 19).replace(' ', 'T')) - Date.parse(start.slice(0, 19).replace(' ', 'T'))) / 60000;
// add one calendar day to "YYYY-MM-DD" (UTC math → no host-tz drift)
const addDay = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };

// sparse readings: [{date, value, source}]
const readings = { weight: [], bodyfat: [], rhr: [], vo2max: [], hrv: [] };
// daily sums: Map<date, number>  (energy is single-source per the export → summing is correct)
const daily = { active: new Map(), basal: new Map() };
// steps come from 3 devices (iPhone/Zepp/Mi Fit) → keep per-source, take max/day (summing double-counts)
const stepsBySrc = new Map();
// dietary daily: Map<date, {kcal,p,c,g}>
const diet = new Map();
// sleep: Map<date, Map<source, minutes>>  (max across sources per night avoids double-count)
const sleep = new Map();
const workouts = []; // {date, type, durationMin, energyKcal, source}

const Q = 'HKQuantityTypeIdentifier';
const addSum = (map, d, v) => { if (d && v != null) map.set(d, (map.get(d) || 0) + v); };
const addDiet = (d, key, v) => { if (!d || v == null) return; const o = diet.get(d) || { kcal: 0, p: 0, c: 0, g: 0 }; o[key] += v; diet.set(d, o); };

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
    case 'HKCategoryTypeIdentifierSleepAnalysis': {
      const val = attr(line, 'value') || '';
      if (!/Asleep/.test(val)) return; // count asleep stages only (skip InBed / Awake)
      const start = attr(line, 'startDate'), end = attr(line, 'endDate');
      const mins = minutesBetween(start, end);
      if (!(mins > 0)) return;
      // attribute to the wake-up date so an evening→morning night isn't split across two rows
      const hour = +start.slice(11, 13);
      const night = hour >= 18 ? addDay(day(start)) : day(start);
      const bySrc = sleep.get(night) || new Map();
      bySrc.set(src, (bySrc.get(src) || 0) + mins);
      return sleep.set(night, bySrc);
    }
  }
}

function handleWorkout(line) {
  workouts.push({
    date: day(attr(line, 'startDate')),
    type: (attr(line, 'workoutActivityType') || '').replace('HKWorkoutActivityType', ''),
    durationMin: num(attr(line, 'duration')),
    energyKcal: num(attr(line, 'totalEnergyBurned')), // may be null on newer exports (stats live in children)
    source: attr(line, 'sourceName'),
  });
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
  // cheap prefilter before regex work
  if (line.indexOf('<Record ') !== -1) handleRecord(line);
  else if (line.indexOf('<Workout ') !== -1) handleWorkout(line);
});
rl.on('close', () => {
  const counts = {};
  // sparse readings
  for (const [k, arr] of Object.entries(readings)) {
    sortByDate(arr);
    counts[k] = csv(`${k}.csv`, 'date,value,source', arr.map(r => `${r.date},${r.value},${r.source || ''}`));
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
  // sleep — max minutes across sources per night (avoids cross-source double count)
  counts.sleep = csv('sleep-daily.csv', 'date,asleep_hours,source',
    [...sleep.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, bySrc]) => {
      let best = null;
      for (const [s, m] of bySrc) if (!best || m > best.m) best = { s, m };
      return `${d},${(best.m / 60).toFixed(2)},${best.s || ''}`;
    }));
  // workouts
  sortByDate(workouts);
  counts.workouts = csv('workouts.csv', 'date,type,duration_min,energy_kcal,source',
    workouts.map(w => `${w.date},${w.type},${w.durationMin ?? ''},${w.energyKcal ?? ''},${w.source || ''}`));

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
    },
    notes: [
      'Body metrics keep a source column — weight mixes scales/apps; compare body fat within one scale only.',
      'steps = max across devices per day (iPhone/Zepp/Mi Fit overlap → summing would double-count).',
      'active/basal energy + dietary are per-day sums (energy validated single-source; logging stopped 2025-11-26).',
      'sleep is best-effort: asleep intervals only, max across sources per night; verify against the Watch trend.',
      'workout energy_kcal may be blank on newer exports (stats moved to child elements).',
      'Regenerate after dropping a new export: node data/apple-health/extract.js',
    ],
  };
  fs.writeFileSync(path.join(OUT, '_meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`Scanned ${lineCount.toLocaleString()} lines → ${OUT}`);
  console.log(Object.entries(counts).map(([k, n]) => `  ${k}: ${n}`).join('\n'));
});
