/* Pure executed-workout dashboard aggregation — extracted verbatim from
 * data/training/generate-training.js (astro-plan-web migration, slice 2).
 * Pure: the page builds DASH with dashboardFrom(inputs) over lib/extract/read.mjs readExtract; the
 * per-directory reader (loadDashboard/dashboardBlock, taking an `extractDir`) lives in lib/training/read.mjs.
 */
import { mergeSameDay, DISPLAY_RULE } from './sessions.mjs';
import { scoreModality } from '../score/modality.mjs';

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
  // "Other" must match EXACTLY (the Watch's generic gym label, also Strava's "Workout", which Inicio
  // also counts as gym); an unanchored /Other/ would swallow unrelated types. Strava's fallback for an
  // unknown sport is "Unmapped", which lands in 'other' below.
  if (/HighIntensityInterval|CrossTraining/i.test(type) || type === 'Other') return 'hiit';
  // Anything else (walks, rows, tennis, unknown sports) is 'other', consistent with Inicio's
  // scoreModality: an unrecognised sport is never shown as "Gym".
  return 'other';
  // NOTE: the Watch labels most gym work (incl. the program's strength blocks) as HIIT,
  // so 'strength' under-counts real strength volume — surfaced as a caveat in the page.
}

/** Same-day merge key = the PHYSICAL modality (Inicio's gym / run / bike / other), not the display
 * bucket: a Watch "HIIT" row and a Strava "WeightTraining" row of one gym session land in different
 * display buckets (hiit / strength) but are the same session, and Strava must supersede the Watch
 * copy (sync:strava keeps both rows in workouts.csv). Rows are bucketed for display afterwards. */
export const mergeKey = (r) => scoreModality(r.type);

// header: date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,…
const hr = (s) => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? n : null; }; // blank/0 -> null

export function parseWorkouts(text) {
  return trainingRowsFromCells(text.trim().split('\n').slice(1).filter(Boolean).map((l) => l.split(',')));
}

/** workouts.csv cells (lib/health/read.mjs readWorkoutCells: header and blank lines dropped) -> the
 * parseWorkouts rows [{date, type, dur, hrAvg, hrMax, re, source}]; [] for no cells. */
export function trainingRowsFromCells(cells) {
  return (cells || []).map((p) => {
    const re = parseFloat(p[9]);
    return { date: p[0], type: p[1] || '', dur: parseFloat(p[2]) || 0, hrAvg: hr(p[4]), hrMax: hr(p[6]), re: Number.isFinite(re) ? re : null, source: p[7] || '' };
  }).filter((r) => ISO.test(r.date));
}

const WEEKS = 12; // dashboard window

/** readExtract inputs -> the DASH bake: {hasData: false} without workouts.csv (trainingRows null). */
export function dashboardFrom({ trainingRows }) {
  return trainingRows ? aggregateDashboard(trainingRows) : { hasData: false };
}

// Same-day rows go through the ONE shared rule (lib/training/sessions.mjs, DISPLAY_RULE, keyed by the
// physical modality, see mergeKey) before anything is counted, so these totals agree with the calendar and the
// cumulative time on the same tab: stubs dropped, a Watch copy of a Strava session counted once.
export function aggregateDashboard(input) {
  const rows = mergeSameDay(input, mergeKey, DISPLAY_RULE).flatMap((g) => g.rows);
  if (!rows.length) return { hasData: false };
  const dates = rows.map((r) => r.date).sort();
  const asOf = dates[dates.length - 1];
  const anchorWeek = weekStart(asOf);
  const start = new Date(anchorWeek + 'T00:00:00');
  start.setDate(start.getDate() - 7 * (WEEKS - 1));
  const startKey = isoDate(start);
  const win = rows.filter((r) => r.date >= startKey && r.date <= asOf);
  // modality split by minutes over the window (Watch auto-labels — see caveat in page)
  const mg = Object.fromEntries(MODALITIES.map((k) => [k, 0]));
  // per-modality HR: duration-weighted avg over sessions that carry HR, plus peak. FC is honest for
  // conditioning/running but UNDER-reads strength (low HR, high muscular load) — surfaced as a caveat.
  const hrAgg = Object.fromEntries(MODALITIES.map((k) => [k, { s: 0, d: 0, peak: 0 }]));
  let iS = 0, iD = 0, iWith = 0;
  win.forEach((r) => {
    const k = modalityGroup(r.type);
    mg[k] += r.dur;
    if (r.hrAvg != null) {
      hrAgg[k].s += r.hrAvg * r.dur; hrAgg[k].d += r.dur;
      if (r.hrMax > hrAgg[k].peak) hrAgg[k].peak = r.hrMax;
      iS += r.hrAvg * r.dur; iD += r.dur; iWith++;
    }
  });
  const modality = Object.keys(mg)
    .map((k) => ({
      key: k, min: Math.round(mg[k]),
      avgHr: hrAgg[k].d ? Math.round(hrAgg[k].s / hrAgg[k].d) : null,
      peakHr: hrAgg[k].peak || null,
    }))
    .filter((m) => m.min > 0)
    .sort((a, b) => b.min - a.min);
  const intensity = { avgHr: iD ? Math.round(iS / iD) : null, withHr: iWith, total: win.length };
  // only what the page reads (client/training-dash.js, the Intensity (HR) rows + its ⓘ): the weekly
  // volume, the 4-week summary and the split % went to the Activity card (training-activity.js)
  return { hasData: true, asOf, weeks: WEEKS, modality, intensity };
}
