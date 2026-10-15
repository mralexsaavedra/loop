/* Stress monitor (Inicio's second monitor tile + its deep-dive): an ESTIMATE from heart rate only,
 * labelled as such everywhere it is shown. The reference app's own stress score also reads HRV; the
 * Shortcut gives us no daytime HRV, so this is OUR heart-rate-only version, documented here and in
 * analysis/methodology.md.
 *
 * Per waking clock hour of hr-hourly.csv (lib/health/hr-hourly.mjs), outside workouts and sleep:
 *   stress = clamp(3 x (HR - RHR) / (0.3 x (HRmax - RHR)), 0, 3)
 * i.e. 0 at resting HR and 3 at resting HR + 30 % of the heart-rate reserve. Bands: low < 1,
 * medium 1-2, high >= 2.
 *   - HR of the hour: the mean of its samples when no Strava activity touches it; with one, the
 *     time-weighted mean of the `hist` part (the time OUTSIDE the activity window). Scored only with
 *     >= MIN_HOUR_MIN covered minutes outside workouts (an hour mostly spent in a workout is left out).
 *   - Sleep: an hour that overlaps the night (sleep-daily.csv bedtime -> waketime, dated the wake-up
 *     day; a bedtime after noon is the evening before) by >= SLEEP_OVERLAP_MIN minutes is left out.
 *   - RHR: rhr.csv's value of that day, else the newest of the RHR_MAX_AGE days before it.
 *   - HRmax: the one workout-zones.csv was cut with (profile.json maxHr, else the highest Strava max
 *     HR of the last 12 months: the HR-zones / day-strain rule).
 *   - No hourly steps exist in the extract (steps are daily totals), so hours dominated by walking or
 *     any movement that is not a recorded workout are NOT excluded: they can raise the estimate.
 * Per day: `now` = the latest scored hour, `avg` = the mean of the scored hours, `mins` = covered
 * minutes (outside workouts, <= 60 per hour) in each band. Fewer than MIN_HOURS scored hours -> no
 * value (avg / now / band null); the hours are still baked for the curve.
 *
 * Pure over parsed rows (lib/score/read.mjs parses hr-hourly.csv for lib/extract/read.mjs readExtract; stressFrom scores it); the bake carries
 * no build-time "now", only data dates. */
import { RECENT_DAYS } from './load.mjs';
import { roundTo } from '../health/stats.mjs';
import { addDays } from '../date.mjs';

export const STRESS_MAX = 3;
// resting HR + 30 % of the heart-rate reserve = the top of the scale
export const HRR_FRAC = 0.3;
export const BAND_MEDIUM = 1;
export const BAND_HIGH = 2;
// at least half an hour of readings outside workouts for an hour to be scored
export const MIN_HOUR_MIN = 30;
// an hour at least half asleep belongs to the night
export const SLEEP_OVERLAP_MIN = 30;
// a day needs six scored waking hours before its average means anything
export const MIN_HOURS = 6;
// resting HR may come from up to 3 days before (the page's own staleness limit)
export const RHR_MAX_AGE = 3;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const BANDS = ['low', 'medium', 'high'];

export function stressOf(hr, rhr, maxHr) {
  if (!(hr > 0) || !(rhr > 0) || !(maxHr > rhr)) return null;
  const v = (3 * (hr - rhr)) / (HRR_FRAC * (maxHr - rhr));
  return Math.max(0, Math.min(STRESS_MAX, v));
}

export function bandOf(v) {
  return v >= BAND_HIGH ? 'high' : v >= BAND_MEDIUM ? 'medium' : 'low';
}

/** The hour's heart rate outside workouts, or null when it has under MIN_HOUR_MIN minutes of it. */
export function hourHr(h) {
  if (!(h.act > 0)) return h.cov >= MIN_HOUR_MIN ? h.avg : null;
  let sec = 0, sum = 0;
  for (const [bpm, s] of h.hist || []) { sec += s; sum += bpm * s; }
  return sec / 60 >= MIN_HOUR_MIN ? sum / sec : null;
}

// a local wall-clock instant as minutes on one naive axis (the offset is ignored on purpose: sleep
// times are local decimal hours too)
const minsOf = (date, h) => Date.parse(date + 'T00:00:00Z') / 60000 + h * 60;

/** sleep-daily rows -> [{from, to}] naive local minutes; bedtime >= 12 = the evening before. */
export function sleepWindows(sleep) {
  return (sleep || []).filter((s) => s && ISO.test(s.date) && isFinite(s.bedtime) && isFinite(s.waketime) && s.bedtime != null && s.waketime != null)
    .map((s) => ({ from: minsOf(s.bedtime >= 12 ? addDays(s.date, -1) : s.date, s.bedtime), to: minsOf(s.date, s.waketime) }))
    .filter((w) => w.to > w.from);
}

const r1 = (v) => roundTo(v, 1);

/** Hours -> the scorable waking ones: [{date, t ("HH"), hr, min}] (no stress yet: RHR is per day). */
export function scoreHours(hours, windows) {
  const out = [];
  for (const h of hours || []) {
    const from = Date.parse(h.start.slice(0, 13) + ':00:00Z') / 60000;
    let asleep = 0;
    for (const w of windows) asleep += Math.max(0, Math.min(from + 60, w.to) - Math.max(from, w.from));
    if (asleep >= SLEEP_OVERLAP_MIN) continue;
    const hr = hourHr(h);
    if (hr == null) continue;
    out.push({ date: h.date, t: h.start.slice(11, 13), hr, min: Math.min(60, Math.max(0, h.cov - h.act)) });
  }
  return out;
}

function rhrOn(rhr, date) {
  let best = null;
  for (const r of rhr || []) {
    if (!r || !(r.value > 0) || r.date > date || r.date < addDays(date, -RHR_MAX_AGE)) continue;
    if (!best || r.date > best.date) best = r;
  }
  return best ? best.value : null;
}

function scoreDay(date, list, rhr, maxHr) {
  const R = rhrOn(rhr, date);
  const hours = [];
  for (const x of list) {
    const v = stressOf(x.hr, R, maxHr);
    if (v != null) hours.push({ t: x.t, v: r1(v), hr: r1(x.hr), min: x.min, raw: v });
  }
  hours.sort((a, b) => (a.t < b.t ? -1 : 1));
  const ok = hours.length >= MIN_HOURS;
  const mins = { low: 0, medium: 0, high: 0 };
  for (const h of hours) mins[bandOf(h.raw)] += Math.round(h.min);
  const avg = ok ? hours.reduce((a, h) => a + h.raw, 0) / hours.length : null;
  const last = ok ? hours[hours.length - 1] : null;
  return {
    date, rhr: R != null ? r1(R) : null, n: hours.length,
    avg: avg != null ? r1(avg) : null, band: avg != null ? bandOf(r1(avg)) : null,
    now: last ? { t: last.t, v: last.v, band: bandOf(last.v) } : null,
    mins: ok ? mins : null,
    hours: hours.map((h) => ({ t: h.t, v: h.v, hr: h.hr })),
  };
}

/** Parsed inputs -> null (no hourly data) | {ok: false, reason, asOf} | the stress bake: `days` = the
 * last RECENT_DAYS days with hourly data (Inicio's day stepping), `metric` = the day averages as a
 * dense series from the first scored day (the deep-dive's trend, the DETAIL metric shape). */
export function stressFromInputs({ hours, rhr, sleep, zones }) {
  if (!hours || !hours.length) return null;
  const dates = [...new Set(hours.map((h) => h.date))].sort();
  const asOf = dates[dates.length - 1];
  const last = zones && zones.length ? zones[zones.length - 1] : null;
  const maxHr = last && last.maxHr > 0 ? last.maxHr : null;
  if (!maxHr) return { ok: false, reason: 'noMaxHr', asOf };
  const scored = scoreHours(hours, sleepWindows(sleep));
  const by = new Map(dates.map((d) => [d, []]));
  for (const x of scored) if (by.has(x.date)) by.get(x.date).push(x);
  const all = dates.map((d) => scoreDay(d, by.get(d), rhr, maxHr));
  const firstOk = all.find((d) => d.avg != null);
  let metric = null;
  if (firstOk) {
    const v = [];
    const avgOf = new Map(all.map((d) => [d.date, d.avg]));
    for (let t = firstOk.date; t <= asOf; t = addDays(t, 1)) v.push(avgOf.has(t) ? avgOf.get(t) : null);
    metric = { kind: 'stress', dir: 0, dec: 1, start: firstOk.date, v };
  }
  const from = addDays(asOf, -(RECENT_DAYS - 1));
  return {
    ok: true, asOf, maxHr, maxSrc: last.maxSrc || null, minHours: MIN_HOURS, bands: BANDS,
    days: all.filter((d) => d.date >= from), metric,
  };
}

/** The stress estimate over lib/extract/read.mjs inputs: null without hr-hourly.csv (Inicio keeps the HRV tile). */
export function stressFrom({ hrHours = null, series = {}, sleep = null, zones = null } = {}) {
  return hrHours ? stressFromInputs({ hours: hrHours, rhr: series.rhr, sleep, zones }) : null;
}
