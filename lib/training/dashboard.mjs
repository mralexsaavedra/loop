/* Pure executed-workout dashboard aggregation.
 * Pure: the page builds DASH with dashboardFrom(inputs) over lib/extract/read.mjs readExtract (whose
 * trainingRows come from trainingRowsFromCells below); nothing here reads a file.
 */
import { mergeSameDay, DISPLAY_RULE } from './sessions.mjs';
import { SCORE_MODALITIES, scoreModality, byModality, byPhysical } from './modality.mjs';
import { addDays, weekStart } from '../date.mjs';

const ISO = /^\d{4}-\d{2}-\d{2}$/;


// Entreno uses Home's modality buckets (lib/training/modality.mjs): strength / hybrid / run / bike / other.
export const MODALITIES = SCORE_MODALITIES;
export const modalityGroup = scoreModality;

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

// Same-day rows go through the ONE shared rule (lib/training/sessions.mjs, DISPLAY_RULE, deduped on the
// physical family, lib/training/modality.mjs byPhysical) before anything is counted, so these totals agree with the calendar and the
// cumulative time on the same tab: stubs dropped, a Watch copy of a Strava session counted once.
export function aggregateDashboard(input) {
  const rows = mergeSameDay(input, byModality, { ...DISPLAY_RULE, dedupeKey: byPhysical }).flatMap((g) => g.rows);
  if (!rows.length) return { hasData: false };
  const dates = rows.map((r) => r.date).sort();
  const asOf = dates[dates.length - 1];
  const anchorWeek = weekStart(asOf);
  const startKey = addDays(anchorWeek, -7 * (WEEKS - 1));
  const win = rows.filter((r) => r.date >= startKey && r.date <= asOf);
  // modality split by minutes over the window
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
  // volume, the 4-week summary and the split % went to the Activity card (training-activity.ts)
  return { hasData: true, asOf, weeks: WEEKS, modality, intensity };
}
