/* Pure stats + formatting helpers for the health tab.
 * No I/O; every function takes parsed series ([{date,value}, ...]) or plain
 * numbers and returns a deterministic result.
 */

import { dayDiff } from '../date.mjs';

// round to a fixed number of decimals (JSON-stable output); the one rounding helper of lib/health
export const roundTo = (v, d = 0) => { const k = 10 ** d; return Math.round(v * k) / k; };

// Collapse multiple rows per day to the daily mean -> [{date, value}] sorted.
export function byDayMean(rows) {
  const m = {};
  rows.forEach((r) => { (m[r.date] = m[r.date] || []).push(r.value); });
  return Object.keys(m).sort().map((d) => ({ date: d, value: m[d].reduce((a, b) => a + b, 0) / m[d].length }));
}

// Trailing rolling average over a CALENDAR window of `win` days: each point averages the points
// dated in (d - win, d]. By calendar, not by row: for a sparse series (weigh-ins weeks apart) the
// last 7 ROWS can span months, which is not a 7-day average. Points must be sorted by date.
export function rollAvg(points, win) {
  let from = 0;
  return points.map((p, i) => {
    while (dayDiff(points[from].date, p.date) >= win) from++;
    const slice = points.slice(from, i + 1);
    return { date: p.date, value: slice.reduce((s, q) => s + q.value, 0) / slice.length };
  });
}

// Keep only points within the last `days` calendar days of the series' own latest date (the latest
// day included: lastDays(x, 30) spans 30 days, not 31).
export function lastDays(points, days) {
  if (!points.length) return [];
  const last = points[points.length - 1].date;
  return points.filter((p) => dayDiff(p.date, last) < days);
}

// Downsample to at most `max` evenly-spaced points (keeps first & last) for a small sparkline.
export function downsample(points, max) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

// A "30 days ago" comparison point further than this from its target is a different period.
const MAX_POINT_GAP_DAYS = 7;
// Value of the rolling series closest to `daysAgo` before its latest point; null when the nearest
// point is more than MAX_POINT_GAP_DAYS away from that target (no reading from then).
export function valueDaysAgo(points, daysAgo) {
  if (!points.length) return null;
  const last = points[points.length - 1].date;
  let best = null, bestGap = Infinity;
  for (const p of points) {
    const gap = Math.abs(dayDiff(p.date, last) - daysAgo);
    if (gap < bestGap) { bestGap = gap; best = p; }
  }
  return best && bestGap <= MAX_POINT_GAP_DAYS ? best.value : null;
}

// Compact sparkline payload: rounded values + endpoint dates. Empty -> null.
export function spark(points, decimals = 1) {
  if (points.length < 2) return null;
  const ds = downsample(points, 80);
  return { v: ds.map((p) => roundTo(p.value, decimals)), from: ds[0].date, to: ds[ds.length - 1].date };
}

/* ---------- stats + formatting helpers ---------- */
export const meanOf = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
export const stdev = (xs) => { if (xs.length < 2) return 0; const m = meanOf(xs); return Math.sqrt(meanOf(xs.map((x) => (x - m) ** 2))); };
export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
// Robust spread: 1.4826 x median absolute deviation (= the sd for normal data), so a few wild
// nights (a nap logged as sleep, a sensor glitch) cannot dominate it the way they dominate stdev.
export const robustSd = (xs) => { if (!xs.length) return null; const m = median(xs); return 1.4826 * median(xs.map((x) => Math.abs(x - m))); };
// night hours: shift after-midnight bedtimes (<12 -> +24) so 23:30 and 00:30 are 1h apart, not 23.
export const wrapNight = (h) => (h < 12 ? h + 24 : h);
// decimal hour -> "HH:MM" (wraps >24 back into the day)
export const clockStr = (h) => { h = ((h % 24) + 24) % 24; const H = Math.floor(h); let M = Math.round((h - H) * 60); let HH = H; if (M === 60) { M = 0; HH = (H + 1) % 24; } return String(HH).padStart(2, '0') + ':' + String(M).padStart(2, '0'); };
// decimal minutes/km -> "m:ss /km"
export const paceStr = (min) => { const m = Math.floor(min); const s = Math.round((min - m) * 60); return (s === 60 ? (m + 1) + ':00' : m + ':' + String(s).padStart(2, '0')); };

// Mean of the daily values over the last 30 days of the series (its own latest date). null if empty.
export function avg30Of(daily, dec = 1) {
  const w = lastDays(daily || [], 30);
  return w.length ? roundTo(meanOf(w.map((r) => r.value)), dec) : null;
}
// Change of a (rolling) series vs the point closest to 30 days before its latest. null if unknown.
export function d30Of(roll, dec = 1) {
  if (!roll || !roll.length) return null;
  const then = valueDaysAgo(roll, 30);
  return then != null ? roundTo(roll[roll.length - 1].value - then, dec) : null;
}

// Generic daily-total trend (steps/exercise/distance/flights): latest day + its date (the headline;
// the client labels a same-day value as "so far", since a daily total is partial until midnight),
// 30-day average and its Δ vs the prior 30 days, 7-day rolling sparkline. The average windows END THE
// DAY BEFORE the latest day: the build cannot know whether that day is complete (it is often today,
// mid-day), so it is shown as the headline and kept out of the mean. null when too sparse.
export function dailyTrend(series, { floor = 0, dec = 0 } = {}) {
  if (!series || !series.length) return null;
  const daily = (floor ? series.filter((r) => r.value >= floor) : series).map((r) => ({ date: r.date, value: r.value }));
  if (daily.length < 7) return null;
  const roll = rollAvg(daily, 7);
  const last = daily[daily.length - 1].date;
  const last30 = daily.filter((r) => { const g = dayDiff(r.date, last); return g >= 1 && g <= 30; });
  const prior30 = daily.filter((r) => { const g = dayDiff(r.date, last); return g > 30 && g <= 60; });
  if (!last30.length) return null;
  return {
    latest: roundTo(daily[daily.length - 1].value, dec),
    latestDate: last,
    avg30: roundTo(meanOf(last30.map((r) => r.value)), dec),
    days30: last30.length,
    d30: prior30.length ? roundTo(meanOf(last30.map((r) => r.value)) - meanOf(prior30.map((r) => r.value)), dec) : null,
    spark: spark(lastDays(roll, 90), dec),
  };
}

// Sparse signal trend (respiratory, wrist temp, walking HR): one value per day -> latest (headline)
// + 30-day mean and Δ vs ~30 days ago (rolling) as context + sparkline. null when absent. `toDaily`
// collapses the rows to that daily series (default the day mean; Salud passes the monitor's
// lib/score/monitor.mjs signalDaily, so its rows match the monitor and the detail sheet).
export function signalTrend(series, dec = 1, toDaily = byDayMean) {
  if (!series || !series.length) return null;
  const daily = toDaily(series);
  if (!daily.length) return null;
  const roll = rollAvg(daily, 7);
  return {
    latest: roundTo(daily[daily.length - 1].value, dec),
    latestDate: daily[daily.length - 1].date,
    avg30: avg30Of(daily, dec),
    d30: d30Of(roll, dec),
    spark: spark(lastDays(roll, 90), dec),
  };
}

