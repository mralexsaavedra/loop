/* Per-modality acute/chronic load trend + within-modality relative score (whoop-daily).
 * Pure functions over [{date, load}] daily series (zero-filled, ending at asOf). No clock. */
import { buildLoadInputs } from './series.mjs';

export const LAMBDA_ACUTE = 2 / (7 + 1);
export const LAMBDA_CHRONIC = 2 / (42 + 1);
export const MIN_DAYS_SINCE_EPOCH = 28;
export const MIN_NONZERO_DAYS = 8;
export const MIN_CHRONIC = 1;
export const P90_WINDOW_DAYS = 90;
const SPARK_DAYS = 28;

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const round = (v, d = 2) => { const k = 10 ** d; return Math.round(v * k) / k; };

/**
 * E(d) = l*L(d) + (1-l)*E(d-1), with E(-1) = seed. The default seed is the mean of the first
 * min(7, n) values, so the first days are not dragged toward zero. Returns E for every day.
 */
export function ewma(values, lambda, seed) {
  if (!values.length) return [];
  let e = seed != null ? seed : mean(values.slice(0, Math.min(7, values.length)));
  return values.map((v) => { e = lambda * v + (1 - lambda) * e; return e; });
}

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
  if (pct >= 30) return 'ramping';
  if (pct >= 10) return 'above';
  if (pct >= -9) return 'steady';
  if (pct >= -30) return 'below';
  return 'detraining';
}

const gated = (extra = {}) => ({ ok: false, reason: 'baselineBuilding', acute: null, chronic: null, trendPct: null, band: null, ...extra });

/** days: [{date, load}] from RE_EPOCH to asOf. */
export function loadTrend(days) {
  const n = days.length;
  const values = days.map((d) => d.load);
  const nonZero = values.filter((v) => v > 0).length;
  if (!n) return gated({ days: 0 });
  const acute = ewma(values, LAMBDA_ACUTE)[n - 1];
  const chronic = ewma(values, LAMBDA_CHRONIC)[n - 1];
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

export function relScore(load, p90) {
  if (p90 == null || !(p90 > 0)) return null;
  return Math.min(100, Math.max(0, Math.round((100 * load) / p90)));
}

/** modalitySeries() output -> JSON-safe load block. */
export function loadFromSeries(series) {
  const modalities = ['gym', 'run', 'bike'].map((key) => {
    const days = series.byModality[key] || [];
    const load = days.length ? days[days.length - 1].load : 0;
    const { p90, n } = p90Window(days);
    const trend = loadTrend(days);
    const acuteSeries = ewma(days.map((d) => d.load), LAMBDA_ACUTE).slice(-SPARK_DAYS).map((v) => round(v, 1));
    const tail = days.slice(-SPARK_DAYS);
    return {
      key,
      load: round(load, 1),
      relScore: relScore(load, p90),
      p90: p90 != null ? round(p90, 1) : null,
      n,
      trend,
      spark: { v: acuteSeries, from: tail.length ? tail[0].date : null, to: tail.length ? tail[tail.length - 1].date : null },
    };
  });
  return { asOf: series.asOf, reEpoch: series.reEpoch, modalities, other: series.other, coverage: series.coverage };
}

export function buildLoad(extractDir) {
  const series = buildLoadInputs(extractDir);
  return series ? loadFromSeries(series) : null;
}
