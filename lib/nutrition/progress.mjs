/* Weight progress vs the nutrition goal. The page runs THESE functions on the viewer's clock over the
 * baked DETAIL.metrics.weight: web/src/client/lib-globals.ts publishes them as the page global HC_PROG
 * (first in web/src/client/manifest.mjs, before util.ts), which web/src/client/progress.ts reads; a test
 * runs HC_PROG over PROGRESS_CASES against the module. Shown in Nutrición ("Progreso") and as one line in the profile sheet.
 *
 * Method (stated on screen): the series is the weight card's 7-day rolling average (DETAIL `roll`, one
 * value per weigh-in day); the rate is the least-squares slope of those averages over the last
 * `windowDays` (28) days ending at the newest one, in kg/week. It needs >= `minReadings` averages
 * spanning >= `minSpanDays` days, else "few data". The series mixes scales, so it is a TREND, never a
 * precise number.
 *
 * Status vs the goal — per-goal bands from analysis/methodology.md (`bands`: fat loss 0.25–0.5 kg/week,
 * muscle gain 0.1–0.25 kg/week; never more than `maxPctWeek` (1 %) of bodyweight a week): cut / bulk ->
 * `onPace` (inside the goal's band, the goal's way), `slow` (less, a flat trend included), `fast` (over
 * the band's max or over 1 % of the current average), `wrong` (more than `flatKg` the other way),
 * `reached` (a target within `reachedKg`); maintain -> `steady` (within ±`stableKg`) or `drift` (the sign
 * of the rate says up / down). `mismatch` = the target lies on the other side of the goal.
 * ETA (only on pace, towards the target): remaining ÷ the OBSERVED rate, as a range ±`etaSpread` (20 %).
 * Pure: no I/O. */

import { fin } from './num.mjs';

export const DAYS_PER_WEEK = 7;
export const PROGRESS = Object.freeze({
  windowDays: 28,
  minReadings: 8,
  minSpanDays: 21,
  // kg/week the goal's way (analysis/methodology.md)
  bands: Object.freeze({ cut: Object.freeze({ min: 0.25, max: 0.5 }), bulk: Object.freeze({ min: 0.1, max: 0.25 }) }),
  stableKg: 0.1, // maintain: within ±0.1 kg/week is stable
  maxPctWeek: 1, // % of bodyweight per week
  flatKg: 0.1, // kg/week: a smaller move is noise, never "the wrong way"
  reachedKg: 0.5, // a 7-day average this close to the target has reached it
  etaSpread: 0.2, // the ETA range: the observed rate ±20 %
  staleDays: 14, // the newest weigh-in older than this: no status (the page says so)
  daysPerWeek: DAYS_PER_WEEK, // baked with NUTRI.progress
});
const DIR = { cut: -1, bulk: 1, maintain: 0 };
const MS_PER_DAY = 86400000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function round(v, dec) {
  var f = Math.pow(10, dec);
  return Math.round(v * f + (v >= 0 ? 1e-9 : -1e-9)) / f;
}
function dayNum(iso) {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / MS_PER_DAY;
}
function isoOf(n) {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** DETAIL.metrics.weight ({start, roll}) -> [{date, kg}] of the days with a 7-day average, oldest first. */
export function rollPoints(m) {
  if (!m || typeof m.start !== 'string' || !ISO_RE.test(m.start) || !Array.isArray(m.roll)) return [];
  var s = dayNum(m.start), out = [];
  m.roll.forEach(function (v, i) { if (fin(v)) out.push({ date: isoOf(s + i), kg: v }); });
  return out;
}

/** The slope of the points of the last windowDays ending at the newest: {rate (kg/week) | null, n, span, from}. */
export function weeklyRate(points) {
  if (!points || !points.length) return { rate: null, n: 0, span: 0, from: null };
  var end = dayNum(points[points.length - 1].date);
  var win = points.filter(function (p) { return dayNum(p.date) > end - PROGRESS.windowDays; });
  var x0 = dayNum(win[0].date), span = end - x0;
  var out = { rate: null, n: win.length, span: span, from: win[0].date };
  if (win.length < PROGRESS.minReadings || span < PROGRESS.minSpanDays) return out;
  var mx = 0, my = 0;
  win.forEach(function (p) { mx += dayNum(p.date) - x0; my += p.kg; });
  mx /= win.length;
  my /= win.length;
  var sxy = 0, sxx = 0;
  win.forEach(function (p) {
    var dx = dayNum(p.date) - x0 - mx;
    sxy += dx * (p.kg - my);
    sxx += dx * dx;
  });
  out.rate = sxx > 0 ? (sxy / sxx) * DAYS_PER_WEEK : null;
  return out;
}

/** weightProgress()'s result (see below).
 * @typedef {{current: {date: string, kg: number}, rate: number | null, n: number, span: number, from: string,
 *   remaining: number | null, status: string, mismatch: boolean, etaWeeks: number[] | null}} WeightProgress (etaWeeks = [soon, late]) *

/** m = DETAIL.metrics.weight, opts = {goal, target (kg | null)} -> null without any 7-day average, else
 * {current: {date, kg}, rate (kg/week, 2 decimals) | null, n, span, from, remaining (target − current,
 * 1 decimal) | null, status, mismatch, etaWeeks: [soon, late] | null}.
 * @returns {WeightProgress | null} */
export function weightProgress(m, opts) {
  var o = opts || {};
  var pts = rollPoints(m);
  if (!pts.length) return null;
  var last = pts[pts.length - 1];
  var current = { date: last.date, kg: round(last.kg, 1) };
  var r = weeklyRate(pts);
  var dir = o.goal in DIR ? DIR[o.goal] : 0;
  var target = fin(o.target) ? o.target : null;
  var remaining = target != null ? round(target - current.kg, 1) : null;
  var toGo = remaining != null ? remaining * dir : null;
  var mismatch = dir !== 0 && toGo != null && toGo < 0 && Math.abs(remaining) > PROGRESS.reachedKg;
  var rate = r.rate != null ? round(r.rate, 2) : null;
  var status;
  if (dir !== 0 && remaining != null && Math.abs(remaining) <= PROGRESS.reachedKg) status = 'reached';
  else if (rate == null) status = 'fewData';
  else if (dir === 0) status = Math.abs(rate) <= PROGRESS.stableKg ? 'steady' : 'drift';
  else {
    var band = PROGRESS.bands[o.goal];
    var safeMax = Math.min(band.max, (current.kg * PROGRESS.maxPctWeek) / 100);
    var s = rate * dir;
    if (s < -PROGRESS.flatKg) status = 'wrong';
    else if (s > safeMax) status = 'fast';
    else if (s >= band.min) status = 'onPace';
    else status = 'slow';
  }
  var eta = null;
  if (status === 'onPace' && toGo != null && toGo > 0 && !mismatch) {
    var weeks = toGo / Math.abs(rate);
    eta = [round(weeks * (1 - PROGRESS.etaSpread), 1), round(weeks * (1 + PROGRESS.etaSpread), 1)];
  }
  return { current: current, rate: rate, n: r.n, span: r.span, from: r.from, remaining: remaining, status: status, mismatch: mismatch, etaWeeks: eta };
}

/** The ETA weeks counted from `today` (the viewer's ISO date) as the first day of their months, or null. */
export function etaMonths(today, weeks) {
  if (!Array.isArray(weeks) || typeof today !== 'string' || !ISO_RE.test(today)) return null;
  var t = dayNum(today);
  return weeks.map(function (w) { return isoOf(t + Math.ceil(w * DAYS_PER_WEEK)).slice(0, 8) + '01'; });
}

/** What web/src/client/lib-globals.ts publishes as the page's HC_PROG: PROGRESS, the module's constants and
 * these functions (bundled from this very module), so the page's rate,
 * status and ETA are the lib's. A plain descriptor: lib/nutrition never imports lib/format
 * (data/nutrition/generate.mjs loads this folder on its own). */
export const CLIENT = {
  consts: { PROGRESS },
  hidden: { DAYS_PER_WEEK, DIR, MS_PER_DAY, ISO_RE },
  fns: { fin, round, dayNum, isoOf, rollPoints, weeklyRate, weightProgress, etaMonths },
};
