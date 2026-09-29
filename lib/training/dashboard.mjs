/* Pure executed-workout dashboard aggregation — extracted verbatim from
 * data/training/generate-training.js (astro-plan-web migration, slice 2).
 * loadDashboard/dashboardBlock take an `extractDir` parameter instead of a
 * closed-over path, so both the legacy generator (real CSV path) and future
 * Astro/env.mjs callers (resolved dir or null) can share this module.
 */
import fs from 'node:fs';
import path from 'node:path';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const isoDate = (dt) => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');

export function weekStart(date) { // Monday-based ISO week start for a 'YYYY-MM-DD' string
  const dt = new Date(date + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return isoDate(dt);
}

export const MODALITIES = ['strength', 'hiit', 'run', 'bike', 'other'];

export function modalityGroup(type) {
  if (/Running/i.test(type)) return 'run';
  // Cycling-family types (incl. e-bike, virtual/indoor rides — all normalized to "Cycling" by
  // extract.js and sync-strava.js) get their own bucket instead of falling into 'other'.
  if (/Cycling/i.test(type)) return 'bike';
  if (/TraditionalStrength|FunctionalStrength/i.test(type)) return 'strength';
  if (/HighIntensityInterval|CrossTraining|Other/i.test(type)) return 'hiit';
  if (/Rowing|Walking|Hiking|Pilates|Elliptical|Swim/i.test(type)) return 'other';
  return 'hiit'; // unknown gym-ish work -> conditioning bucket
  // NOTE: the Watch labels most gym work (incl. the program's strength blocks) as HIIT,
  // so 'strength' under-counts real strength volume — surfaced as a caveat in the page.
}

// header: date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source
const hr = (s) => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? n : null; }; // blank/0 -> null

export function parseWorkouts(text) {
  return text.trim().split('\n').slice(1).filter(Boolean).map((l) => {
    const p = l.split(',');
    return { date: p[0], type: p[1] || '', dur: parseFloat(p[2]) || 0, hrAvg: hr(p[4]), hrMax: hr(p[6]) };
  }).filter((r) => ISO.test(r.date));
}

const WEEKS = 12; // dashboard window

export function aggregateDashboard(rows) {
  if (!rows || !rows.length) return { hasData: false };
  const dates = rows.map((r) => r.date).sort();
  const asOf = dates[dates.length - 1];
  const anchorWeek = weekStart(asOf);
  const start = new Date(anchorWeek + 'T00:00:00');
  start.setDate(start.getDate() - 7 * (WEEKS - 1));
  const startKey = isoDate(start);
  const win = rows.filter((r) => r.date >= startKey && r.date <= asOf);
  // weekly buckets (emit every slot, including zero-activity weeks)
  const wk = {};
  win.forEach((r) => { const k = weekStart(r.date); (wk[k] = wk[k] || { min: 0, days: new Set() }); wk[k].min += r.dur; wk[k].days.add(r.date); });
  const weeks = [];
  for (let i = 0; i < WEEKS; i++) {
    const d = new Date(start); d.setDate(d.getDate() + 7 * i); const k = isoDate(d); const b = wk[k];
    weeks.push({ w: k, days: b ? b.days.size : 0, min: b ? Math.round(b.min) : 0 });
  }
  // recent 4 weeks (28 days back from asOf)
  const r4 = new Date(asOf + 'T00:00:00'); r4.setDate(r4.getDate() - 27);
  const recentRows = rows.filter((r) => r.date >= isoDate(r4) && r.date <= asOf);
  const recentDays = new Set(recentRows.map((r) => r.date));
  const recent = {
    daysPerWeek: Math.round(recentDays.size / 4 * 10) / 10,
    minPerWeek: Math.round(recentRows.reduce((s, r) => s + r.dur, 0) / 4),
    sessions: recentDays.size,
  };
  // modality split by minutes over the window (Watch auto-labels — see caveat in page)
  const mg = Object.fromEntries(MODALITIES.map((k) => [k, 0]));
  // per-modality HR: duration-weighted avg over sessions that carry HR, plus peak. FC is honest for
  // conditioning/running but UNDER-reads strength (low HR, high muscular load) — surfaced as a caveat.
  const hrAgg = Object.fromEntries(MODALITIES.map((k) => [k, { s: 0, d: 0, peak: 0 }]));
  let iS = 0, iD = 0, iPeak = 0, iWith = 0;
  win.forEach((r) => {
    const k = modalityGroup(r.type);
    mg[k] += r.dur;
    if (r.hrAvg != null) {
      hrAgg[k].s += r.hrAvg * r.dur; hrAgg[k].d += r.dur;
      if (r.hrMax > hrAgg[k].peak) hrAgg[k].peak = r.hrMax;
      iS += r.hrAvg * r.dur; iD += r.dur; iWith++;
      if (r.hrMax > iPeak) iPeak = r.hrMax;
    }
  });
  const tot = Object.values(mg).reduce((a, b) => a + b, 0) || 1;
  const modality = Object.keys(mg)
    .map((k) => ({
      key: k, min: Math.round(mg[k]), pct: Math.round(100 * mg[k] / tot),
      avgHr: hrAgg[k].d ? Math.round(hrAgg[k].s / hrAgg[k].d) : null,
      peakHr: hrAgg[k].peak || null,
    }))
    .filter((m) => m.min > 0)
    .sort((a, b) => b.min - a.min);
  const intensity = { avgHr: iD ? Math.round(iS / iD) : null, peakHr: iPeak || null, withHr: iWith, total: win.length };
  return { hasData: true, asOf, weeks: WEEKS, weeklyMin: weeks, recent, modality, intensity };
}

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
