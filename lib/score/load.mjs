/* Per-modality acute/chronic load trend + within-modality relative score.
 * Pure functions over [{date, load}] daily series (zero-filled, ending at asOf). No clock. */
import { modalitySeries } from './series.mjs';
import { trainingThrough } from '../training/through.mjs';
import { meanOf, roundTo } from '../health/stats.mjs';
import { addDays } from '../date.mjs';

// Standard EWMA span form l = 2 / (N + 1): a 7-day "acute" and a 42-day "chronic" span (one week
// vs six weeks, the usual training-load convention).
export const LAMBDA_ACUTE = 2 / (7 + 1);
export const LAMBDA_CHRONIC = 2 / (42 + 1);
// The chronic EWMA needs roughly four weeks of history before its ratio to the acute one means anything.
const MIN_DAYS_SINCE_EPOCH = 28;
// A percentile or a ratio over fewer active days is dominated by one session.
const MIN_NONZERO_DAYS = 8;
// Below 1 RE/day the ratio acute/chronic explodes on noise.
const MIN_CHRONIC = 1;
// Roughly a quarter: long enough for a stable p90, short enough to follow a change of block.
const P90_WINDOW_DAYS = 90;
// Today first: the asOf day's RE is compared with a TYPICAL training day of the same modality =
// the median of the non-zero days in the chronic window (the 42 days before asOf; asOf itself is
// excluded so today never sets its own reference). Fewer than 6 such days (one a week) and the
// median hangs on a handful of sessions: no "normal" is stated.
export const TYPICAL_WINDOW_DAYS = 42;
export const MIN_TYPICAL_DAYS = 6;
// The client picks the VIEWER's today (never baked) from the session days of the last two weeks, so
// the build stays byte-identical; the typical day stays a build-time value (window ends before asOf).
export const RECENT_DAYS = 14;
// Four weeks of the smoothed acute load is enough shape for a card-sized sparkline.
const LOAD_SPARK_DAYS = 28;
// The EWMA is seeded with the mean of the first week so the opening days are not dragged toward
// zero; a week also averages out one rest day.
const SEED_DAYS = 7;

// Trend bands, in whole percent of acute vs chronic. ONE source of truth: the advice rules
// import these, so "ramping" / "easing" mean the same thing on the card and in the sentence.
export const RAMPING_PCT = 30; // >= this: ramping
export const ABOVE_PCT = 10; // >= this: above usual
export const EASING_PCT = -10; // <= this: below usual (advice: "easing")
// < this: well below usual. Deliberately NOT called "detraining": a lower RE week is often a planned
// deload, a trip or sessions without effort data, and the data cannot tell fitness loss apart.
export const WELL_BELOW_PCT = -30;
// The acute window (7 days): sessions without effort data inside it are noted on the modality.
export const ACUTE_DAYS = 7;

const round = (v, d = 2) => roundTo(v, d);

/**
 * E(d) = l*L(d) + (1-l)*E(d-1), with E(-1) = seed. The default seed is the mean of the first
 * min(7, n) non-null values, so the first days are not dragged toward zero. A null L(d) is MISSING
 * (a session without effort data): E carries forward unchanged, with no decay — treating it as 0
 * would read a training day as rest. Returns E for every day.
 */
export function ewma(values, lambda, seed) {
  if (!values.length) return [];
  const head = values.slice(0, Math.min(SEED_DAYS, values.length)).filter((v) => v != null);
  let e = seed != null ? seed : head.length ? meanOf(head) : 0;
  return values.map((v) => { if (v != null) e = lambda * v + (1 - lambda) * e; return e; });
}

// daily series -> EWMA input: an unscored session day is missing (null), everything else its load
const ewmaInput = (days) => days.map((d) => (d.unscored ? null : d.load));

/** p in [0, 1], linear interpolation between order statistics. */
export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = p * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function trendBand(pct) {
  if (pct >= RAMPING_PCT) return 'ramping';
  if (pct >= ABOVE_PCT) return 'above';
  if (pct > EASING_PCT) return 'steady';
  if (pct >= WELL_BELOW_PCT) return 'below';
  return 'wellBelow';
}

const gated = (extra = {}) => ({ ok: false, reason: 'baselineBuilding', acute: null, chronic: null, trendPct: null, band: null, ...extra });

/** days: [{date, load}] from RE_EPOCH to asOf. */
export function loadTrend(days) {
  const n = days.length;
  const values = days.map((d) => d.load);
  const nonZero = values.filter((v) => v > 0).length;
  if (!n) return gated({ days: 0 });
  const acute = ewma(ewmaInput(days), LAMBDA_ACUTE)[n - 1];
  const chronic = ewma(ewmaInput(days), LAMBDA_CHRONIC)[n - 1];
  const base = { acute: round(acute), chronic: round(chronic), days: n };
  if (n - 1 < MIN_DAYS_SINCE_EPOCH || nonZero < MIN_NONZERO_DAYS || chronic < MIN_CHRONIC) {
    return gated(base);
  }
  const trendPct = Math.round(100 * (acute / chronic - 1)) || 0; // || 0 normalises -0
  return { ...base, ok: true, reason: null, trendPct, band: trendBand(trendPct) };
}

/** 90th percentile of NON-ZERO loads in the trailing 90 days; null when < 8 such days. */
export function p90Window(days) {
  const nz = days.slice(-P90_WINDOW_DAYS).map((d) => d.load).filter((v) => v > 0);
  if (nz.length < MIN_NONZERO_DAYS) return { p90: null, n: nz.length };
  return { p90: percentile(nz, 0.9), n: nz.length };
}

/** Median RE of the non-zero days in the TYPICAL_WINDOW_DAYS before the last (asOf) day. */
export function typicalDay(days) {
  const nz = days.slice(-(TYPICAL_WINDOW_DAYS + 1), -1).map((d) => d.load).filter((v) => v > 0);
  if (nz.length < MIN_TYPICAL_DAYS) return { value: null, n: nz.length };
  return { value: round(percentile(nz, 0.5), 1), n: nz.length };
}

export function relScore(load, p90) {
  if (p90 == null || !(p90 > 0)) return null;
  return Math.min(100, Math.max(0, Math.round((100 * load) / p90)));
}

/** Session days of one modality -> the last RECENT_DAYS ending asOf + the last day with RE > 0. */
function recentSessions(sessions, asOf) {
  const from = asOf ? addDays(asOf, -(RECENT_DAYS - 1)) : null;
  const recent = sessions.filter((d) => from && d.date >= from && d.date <= asOf).map((d) => ({ date: d.date, re: round(d.re, 1), unscored: d.unscored }));
  const scored = sessions.filter((d) => d.re > 0);
  const lastS = scored.length ? scored[scored.length - 1] : null;
  return { recent, last: lastS ? { date: lastS.date, re: round(lastS.re, 1) } : null };
}

/** modalitySeries() output -> JSON-safe load block. */
export function loadFromSeries(series) {
  const modalities = ['gym', 'run', 'bike'].map((key) => {
    const days = series.byModality[key] || [];
    const { recent, last } = recentSessions((series.days && series.days[key]) || [], series.asOf);
    const load = days.length ? days[days.length - 1].load : 0;
    const { p90, n } = p90Window(days);
    const trend = loadTrend(days);
    const acuteSeries = ewma(ewmaInput(days), LAMBDA_ACUTE).slice(-LOAD_SPARK_DAYS).map((v) => round(v, 1));
    // session days of the acute window whose rows (or some of them) carry no RE: the trend cannot
    // see their effort, so the page says how many there are
    const acuteFrom = series.asOf ? addDays(series.asOf, -(ACUTE_DAYS - 1)) : null;
    const unscoredAcute = ((series.days && series.days[key]) || []).filter((d) => acuteFrom && d.date >= acuteFrom && d.unscored > 0).length;
    const tail = days.slice(-LOAD_SPARK_DAYS);
    return {
      key,
      load: round(load, 1),
      typical: typicalDay(days),
      recent,
      last,
      relScore: relScore(load, p90),
      p90: p90 != null ? round(p90, 1) : null,
      n,
      trend,
      unscoredAcute,
      spark: { v: acuteSeries, from: tail.length ? tail[0].date : null, to: tail.length ? tail[tail.length - 1].date : null },
    };
  });
  return { asOf: series.asOf, reEpoch: series.reEpoch, modalities, other: series.other, coverage: series.coverage };
}

/** The pure core over lib/extract/read.mjs readExtract inputs (lib/score/index.mjs buildScoresFrom). */
export function loadFrom(inputs = {}) {
  const { workoutLoad } = inputs;
  const series = workoutLoad ? modalitySeries(workoutLoad, { through: trainingThrough(inputs) }) : null;
  return series ? loadFromSeries(series) : null;
}
