/* Recovery as a smoothed TREND in MAD units. There is no 0-100 score anywhere.
 *
 * Per component (hrv, rhr, sleep duration, sleep consistency): daily value -> z against a robust
 * median/MAD baseline (42 days ending asOf-1), winsorized and clamped to +-3, direction-signed so
 * positive always means "better than your baseline". The daily composite C(d) is the weighted
 * mean over the components available that day, in MAD units. Displayed value = trend7, the mean
 * of C over the 7 days ending asOf; delta7 compares it with the week before. Every window anchors
 * to asOf (newest input date), never to the build clock.
 *
 * Today first: `today` is the composite of the asOf day alone (last night's sleep + that day's HRV /
 * resting HR) against the SAME baseline, so the headline reads "how you woke up" while trend7 stays
 * the context. A single day is ~2.4x noisier than the 7-day mean, so its band is cut at
 * DAY_BAND_CUTOFF (same false-flip rate as BAND_CUTOFF on the trend, see below). It is only reported
 * when the components present that day carry at least MIN_WEIGHT and include HRV or resting HR (the
 * same rule the whole block is gated on); a sleep-only day is too thin and yields today = null (the
 * page then says there is no data for last night and shows the trend instead). `today.sleep` says
 * whether that day has a sleep-duration reading, so the page only calls it "last night" when it
 * does. `trendDir` is the direction word of the 7-day trend: delta7 (this week's trend7 minus last
 * week's) cut at TREND_DIR_CUTOFF.
 *
 * Baseline/scoring overlap (deliberate): the baseline window ends the day before asOf, so it
 * contains most of the 7 days being scored. A real shift in the final week therefore pulls the
 * median/MAD slightly toward itself and the reported trend is a little SMALLER than against a
 * baseline that excluded the week. Accepted: it only ever damps (a false "you are below baseline"
 * is worse than a slightly late one), it keeps every window anchored to one asOf, and a
 * non-overlapping baseline would need a second full window of history before the card can show.
 */
import { readSeries, readSleep } from '../health/read.mjs';
import { median, wrapNight, meanOf, addDays, roundTo } from '../health/stats.mjs';

// Weights follow signal reliability: HRV is the most responsive marker of recovery, resting HR and
// sleep duration next, sleep regularity is a weak, noisy modifier.
export const WEIGHTS = { hrv: 0.4, rhr: 0.25, sleepDur: 0.25, sleepCons: 0.1 };
// A trend within half a MAD of baseline is indistinguishable from day-to-day noise. Measured spread
// of the smoothed series (rolling, 90 days): sigma_d ~ 0.78 and sigma_7 ~ 0.33 (in-sample over the
// same window: 0.86 / 0.24), i.e. ~1.5 sigma_7, so ~88% of days read "at baseline". Re-derive with
// measureSigma(). Widen this only if sigma_7 exceeds 0.45.
export const BAND_CUTOFF = 0.5;
// The spreads quoted above (owner's data, measureSigma() with days = 90): sd of the daily composite
// and of the 7-day trend. They turn BAND_CUTOFF into the two cuts below.
export const MEASURED_SIGMA = { daily: 0.782, trend7: 0.328 };
// Last night alone: the same number of sigmas as BAND_CUTOFF on the trend (0.5 / 0.328 ~ 1.5 sigma),
// so a single day flips band as rarely as the trend does: 0.5 x 0.782 / 0.328 = 1.19 -> 1.2.
export const DAY_BAND_CUTOFF = Math.round(10 * BAND_CUTOFF * MEASURED_SIGMA.daily / MEASURED_SIGMA.trend7) / 10;
// trendDir compares two NON-overlapping 7-day means: their difference has sd sqrt(2) x sigma_7
// (~0.46), so the same 1.5 sigma cut is BAND_CUTOFF x sqrt(2) = 0.707 -> 0.7.
export const TREND_DIR_CUTOFF = Math.round(10 * BAND_CUTOFF * Math.SQRT2) / 10;
// Six weeks: long enough to average out a hard block, short enough to follow a slow seasonal drift.
export const BASELINE_DAYS = 42;
// Fewer than two weeks of a signal and its median/MAD is a guess.
export const MIN_BASELINE_DAYS = 14;
// Below 60% of the total weight the composite is mostly one or two signals: show nothing instead.
export const MIN_WEIGHT = 0.6;
// Half of the 14 days the sparkline covers: fewer and the trend is built on gaps.
export const MIN_COMPOSITE_DAYS = 7;
// A "7-day trend" built from fewer than 3 days is not a trend.
export const MIN_WINDOW_DAYS = 3;
// Beyond 3 MADs a day is an outlier, not information; capping keeps one bad night from owning the week.
export const Z_CLAMP = 3;
const WINSOR_K = 3;
// Two weeks of smoothed composite: the sparkline length on the card.
const RECOVERY_SPARK_DAYS = 14;
// A trend window is 7 days; the first sparkline point needs 6 more days before it.
const TREND_DAYS = 7;
// Scales MAD to the standard deviation of a normal distribution, so "1 MAD unit" ~ "1 sd".
const MAD_TO_SD = 1.4826;
// Floating-point slack when comparing a summed weight against MIN_WEIGHT (0.25 + 0.25 + 0.1 must equal 0.6).
const EPS = 1e-9;
// Confidence: "high" needs nearly all the weight present today and a full month of baseline.
const HIGH_CONFIDENCE_WEIGHT = 0.9;
const HIGH_CONFIDENCE_BASELINE_DAYS = 28;
const ORDER = ['hrv', 'rhr', 'sleepDur', 'sleepCons'];

// Per component: `dir` = which way is better; `lo`/`hi` = physiological plausibility clamp applied
// to each raw sample (a 230 ms SDNN spike or a 1 bpm dropout is a sensor artefact); `floor` = the
// smallest MAD we will divide by, so a very stable series cannot turn a tiny wobble into a huge z
// (hrv is in ln space, hence 0.05 = ~5%; rhr 1 bpm; sleep 0.4 h = 24 min; regularity 10 min).
const DEFS = {
  hrv: { unit: 'ms', dir: 1, floor: 0.05, lo: 5, hi: 200, dec: 1 },
  rhr: { unit: 'bpm', dir: -1, floor: 1.0, lo: 30, hi: 110, dec: 1 },
  sleepDur: { unit: 'h', dir: 1, floor: 0.4, lo: 2, hi: 14, dec: 2 },
  sleepCons: { unit: 'min', dir: -1, floor: 10, lo: 0, hi: 300, dec: 0 },
};

const round = roundTo;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Per-day median of per-sample-clamped values. rows: [{date, value}] -> [{date, value}] sorted. */
export function dailyRobust(rows, { lo, hi }) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r || !r.date || !Number.isFinite(r.value)) continue;
    if (!by.has(r.date)) by.set(r.date, []);
    by.get(r.date).push(clamp(r.value, lo, hi));
  }
  return [...by.keys()].sort().map((date) => ({ date, value: median(by.get(date)) }));
}

/** The ONE per-day series of a recovery signal (key 'hrv' | 'rhr' | 'sleepDur'): per-sample
 * plausibility clamp, then the day median. Shared by Inicio (recovery, monitor) and Salud, so every
 * tab shows the same number for the same day. */
export function dailySignal(key, rows) {
  return dailyRobust(rows, DEFS[key]);
}

export function winsorize(values, med, mad, k) {
  return values.map((v) => clamp(v, med - k * mad, med + k * mad));
}

/** median, floored MAD_TO_SD*MAD, n. */
export function robustBaseline(values, madFloor) {
  const med = median(values);
  const mad = Math.max(MAD_TO_SD * median(values.map((v) => Math.abs(v - med))), madFloor);
  return { median: med, mad, n: values.length };
}

/** components: {key: zDir|null|undefined}; weighted mean over the present ones, renormalised. */
export function composite(components, weights) {
  let num = 0;
  let den = 0;
  for (const [k, z] of Object.entries(components || {})) {
    if (z == null || !Number.isFinite(z) || weights[k] == null) continue;
    num += weights[k] * z;
    den += weights[k];
  }
  return den > 0 ? num / den : null;
}

/** series: [{date, value}] -> {value, n}: mean over the 7 days ending asOf (null under 3 days). */
export function trend7(series, asOf) {
  const from = addDays(asOf, -(TREND_DAYS - 1));
  const vals = (series || []).filter((r) => r.date >= from && r.date <= asOf && r.value != null).map((r) => r.value);
  return { value: vals.length >= MIN_WINDOW_DAYS ? meanOf(vals) : null, n: vals.length };
}

export function recoveryBand(v) {
  if (v >= BAND_CUTOFF) return 'above';
  if (v <= -BAND_CUTOFF) return 'below';
  return 'at';
}

/** Band of a SINGLE day's composite, cut at +-DAY_BAND_CUTOFF. */
export function dayBand(v) {
  if (v >= DAY_BAND_CUTOFF) return 'above';
  if (v <= -DAY_BAND_CUTOFF) return 'below';
  return 'at';
}

/** Direction of the 7-day trend from delta7, cut at +-TREND_DIR_CUTOFF: 'up' | 'steady' | 'down' | null. */
export function trendDir(delta7) {
  if (delta7 == null || !Number.isFinite(delta7)) return null;
  if (delta7 >= TREND_DIR_CUTOFF) return 'up';
  if (delta7 <= -TREND_DIR_CUTOFF) return 'down';
  return 'steady';
}

const gatedShape = (asOf) => ({
  asOf, gated: true, reason: 'insufficient', band: null, trend7: null, delta7: null, today: null, trendDir: null,
  confidence: { weight: 0, minBaselineDays: 0, level: 'low' }, driver: null, missing: [...ORDER], components: [],
  spark: { v: [], from: null, to: null },
});

/** Pure: {hrv, rhr, sleep} row arrays -> the recovery block.
 * opts.debug (object) receives the daily composite series as `debug.composite`; opts.historyDays
 * widens the scored window (default: sparkline + first trend window) so that series can be as
 * long as needed for offline sigma measurement. The returned block never depends on either. */
export function recoveryFromInputs({ hrv, rhr, sleep } = {}, { debug, historyDays } = {}) {
  const dailies = {
    hrv: dailyRobust(hrv, DEFS.hrv),
    rhr: dailyRobust(rhr, DEFS.rhr),
    sleepDur: dailyRobust((sleep || []).map((s) => ({ date: s.date, value: s.value })), DEFS.sleepDur),
  };
  const allDates = [...dailies.hrv, ...dailies.rhr, ...dailies.sleepDur, ...(sleep || [])].map((r) => r.date).filter(Boolean);
  if (!allDates.length) return gatedShape(null);
  const asOf = allDates.reduce((a, b) => (b > a ? b : a));
  const winFrom = addDays(asOf, -BASELINE_DAYS);
  const winTo = addDays(asOf, -1);
  const inWin = (d) => d >= winFrom && d <= winTo;

  // sleep consistency: deviation of bed/wake from their own baseline medians, after wrapNight
  const bw = new Map();
  for (const s of sleep || []) {
    if (s && s.date && Number.isFinite(s.bedtime) && Number.isFinite(s.waketime)) bw.set(s.date, { bed: wrapNight(s.bedtime), wake: s.waketime });
  }
  const winBW = [...bw.entries()].filter(([d]) => inWin(d)).map(([, v]) => v);
  const cons = [];
  if (winBW.length) {
    const medBed = median(winBW.map((v) => v.bed));
    const medWake = median(winBW.map((v) => v.wake));
    for (const d of [...bw.keys()].sort()) {
      const v = bw.get(d);
      cons.push({ date: d, value: clamp(((Math.abs(v.bed - medBed) + Math.abs(v.wake - medWake)) / 2) * 60, DEFS.sleepCons.lo, DEFS.sleepCons.hi) });
    }
  }
  dailies.sleepCons = cons;

  const sparkFrom = addDays(asOf, -(RECOVERY_SPARK_DAYS - 1));
  const zFrom = addDays(asOf, -Math.max(historyDays || 0, RECOVERY_SPARK_DAYS + TREND_DAYS - 1) + 1);
  const comps = {};
  const dropped = [];
  for (const key of ORDER) {
    const def = DEFS[key];
    const space = (v) => (key === 'hrv' ? Math.log(v) : v);
    const rows = dailies[key].map((r) => ({ date: r.date, raw: r.value, v: space(r.value) }));
    const base = rows.filter((r) => inWin(r.date)).map((r) => r.v);
    if (base.length < MIN_BASELINE_DAYS) { dropped.push(key); continue; }
    const b = robustBaseline(base, def.floor);
    const zs = rows.filter((r) => r.date >= zFrom && r.date <= asOf).map((r) => {
      const w = winsorize([r.v], b.median, b.mad, WINSOR_K)[0];
      return { date: r.date, value: def.dir * clamp((w - b.median) / b.mad, -Z_CLAMP, Z_CLAMP) };
    });
    const t = trend7(zs, asOf);
    if (t.value == null) { dropped.push(key); continue; }
    comps[key] = { key, def, rows, zs, b, t };
  }

  const used = ORDER.filter((k) => comps[k]);
  const availWeight = used.reduce((s, k) => s + WEIGHTS[k], 0);
  if (availWeight < MIN_WEIGHT - EPS || !(comps.hrv || comps.rhr)) return gatedShape(asOf);

  // daily composite over the components present that day
  const zByDate = new Map();
  for (const k of used) for (const z of comps[k].zs) {
    if (!zByDate.has(z.date)) zByDate.set(z.date, {});
    zByDate.get(z.date)[k] = z.value;
  }
  const comp = [...zByDate.keys()].sort().map((date) => ({ date, value: composite(zByDate.get(date), WEIGHTS) })).filter((r) => r.value != null);
  if (debug) debug.composite = comp;
  const compDays = comp.filter((r) => r.date >= sparkFrom && r.date <= asOf).length;
  const cur = trend7(comp, asOf).value;
  if (compDays < MIN_COMPOSITE_DAYS || cur == null) return gatedShape(asOf);
  const prev = trend7(comp, addDays(asOf, -TREND_DAYS)).value;

  const components = used.map((k) => {
    const c = comps[k];
    const prevC = trend7(c.zs, addDays(asOf, -TREND_DAYS)).value;
    const native = (v) => (k === 'hrv' ? Math.exp(v) : v);
    return {
      key: k,
      unit: c.def.unit,
      dir: c.def.dir,
      trend7: round(c.t.value, 2),
      delta7: prevC != null ? round(c.t.value - prevC, 2) : null,
      band: recoveryBand(c.t.value),
      baseline: round(native(c.b.median), c.def.dec),
      mad: round(k === 'hrv' ? native(c.b.median) * c.b.mad : c.b.mad, 2),
      n: c.b.n,
      daily: c.rows.filter((r) => r.date >= sparkFrom && r.date <= asOf).map((r) => ({ date: r.date, value: round(r.raw, c.def.dec) })),
    };
  });

  const present = used.filter((k) => comps[k].rows.some((r) => r.date === asOf));
  const weight = round(present.reduce((s, k) => s + WEIGHTS[k], 0), 4);
  const minBaselineDays = Math.min(...used.map((k) => comps[k].b.n));
  const level = weight >= HIGH_CONFIDENCE_WEIGHT && minBaselineDays >= HIGH_CONFIDENCE_BASELINE_DAYS ? 'high' : weight >= MIN_WEIGHT - EPS ? 'medium' : 'low';
  // last night alone: same composite, but only when the day itself carries enough of the weight
  const todayRow = comp.find((r) => r.date === asOf);
  const todayOk = todayRow && weight >= MIN_WEIGHT - EPS && (present.includes('hrv') || present.includes('rhr'));
  const today = todayOk ? { date: asOf, value: round(todayRow.value, 2), band: dayBand(todayRow.value), sleep: present.includes('sleepDur') } : null;
  const worst = components.reduce((a, c) => (a == null || c.trend7 < a.trend7 ? c : a), null);

  const spark = [];
  for (let i = 0; i < RECOVERY_SPARK_DAYS; i++) {
    const t = trend7(comp, addDays(sparkFrom, i)).value;
    spark.push(t != null ? round(t, 2) : null);
  }

  return {
    asOf,
    gated: false,
    reason: null,
    band: recoveryBand(cur),
    trend7: round(cur, 2),
    delta7: prev != null ? round(cur - prev, 2) : null,
    today,
    trendDir: trendDir(prev != null ? round(cur - prev, 2) : null),
    confidence: { weight, minBaselineDays, level },
    driver: worst && worst.trend7 < 0 ? worst.key : null,
    missing: ORDER.filter((k) => !present.includes(k)),
    components,
    spark: { v: spark, from: sparkFrom, to: asOf },
  };
}

export function buildRecovery2(extractDir) {
  if (!extractDir) return null;
  const hrv = readSeries(extractDir, 'hrv.csv');
  const rhr = readSeries(extractDir, 'rhr.csv');
  const sleep = readSleep(extractDir);
  if (!hrv && !rhr && !sleep) return null;
  return recoveryFromInputs({ hrv: hrv || [], rhr: rhr || [], sleep: sleep || [] });
}

const sd = (a) => {
  if (a.length < 2) return null;
  const m = meanOf(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

/**
 * Re-derives the spread that justifies BAND_CUTOFF. Rolling and out-of-sample: for each of the last
 * `days` days t the inputs are cut at t (the baseline then ends at t-1), and we record that day's
 * composite C(t) and the 7-day trend visible on t. sigmaD = sd of C, sigma7 = sd of the trends.
 * The figure quoted at BAND_CUTOFF (0.78 / 0.33) was measured with days = 90.
 */
export function measureSigma({ hrv, rhr, sleep } = {}, { days = 90 } = {}) {
  const all = [...(hrv || []), ...(rhr || []), ...(sleep || [])].map((r) => r.date).filter(Boolean);
  if (!all.length) return { days, sigmaD: null, sigma7: null, nD: 0, n7: 0, band: BAND_CUTOFF };
  const asOf = all.reduce((a, b) => (b > a ? b : a));
  const cut = (rows, t) => (rows || []).filter((r) => r.date <= t);
  const c = [];
  const t7 = [];
  for (let i = 0; i < days; i++) {
    const t = addDays(asOf, -i);
    const debug = {};
    const r = recoveryFromInputs({ hrv: cut(hrv, t), rhr: cut(rhr, t), sleep: cut(sleep, t) }, { debug });
    if (r.gated) continue;
    const last = debug.composite[debug.composite.length - 1];
    if (last && last.date === t) c.push(last.value);
    t7.push(r.trend7);
  }
  const r3 = (v) => (v == null ? null : round(v, 3));
  return { days, sigmaD: r3(sd(c)), sigma7: r3(sd(t7)), nD: c.length, n7: t7.length, band: BAND_CUTOFF };
}
