/* Recovery as a smoothed TREND in MAD units, plus last night as a 0-100 % RANK (today.pct).
 *
 * Per component (hrv, rhr, sleep duration, sleep consistency): daily value -> z against a robust
 * median/MAD baseline (42 days ending asOf-1), winsorized and clamped to +-3, direction-signed so
 * positive always means "better than your baseline". The daily composite C(d) is the weighted
 * mean over the components available that day, in MAD units. Displayed value = trend7, the mean
 * of C over the 7 days ending asOf; delta7 compares it with the week before. Every window anchors
 * to asOf (newest input date), never to the build clock.
 *
 * Today first: `today` is the composite of ONE day (last night's sleep + that day's resting HR / HRV)
 * against the SAME baseline: the newest COMPLETE day among asOf and the MAX_TODAY_FALLBACK_DAYS
 * before it. A day is complete with a sleep-duration reading AND a resting-HR value AND, when HRV is
 * a scored component (the user has an HRV baseline), an HRV day with enough samples (completeDay),
 * plus at least MIN_WEIGHT of the weight. A user without Watch HRV is therefore scored on sleep +
 * resting HR (0.25 + 0.25 + 0.1 = MIN_WEIGHT, renormalised by `composite`), flagged `noHrv` (and
 * `rhrDerived` when that resting HR is derived from heart rate, partialFlags); resting HR alone stays
 * gated. A partial newest day falls back to the previous complete one, which the page labels by
 * its date (the partial day stays in the trend), so the headline reads "how you woke up" while trend7
 * stays the context. No complete day in that short window yields today = null: the page then shows
 * the trend with a "no recent complete night" note, never a stale night as the headline. A single day
 * is ~2.4x noisier than the 7-day mean, so its band is cut at DAY_BAND_CUTOFF (same false-flip rate
 * as BAND_CUTOFF on the trend, see below). `today.sleep` is always true now (sleep is required) and
 * is kept for the page's label logic. `trendDir` is the direction word of the 7-day trend: delta7
 * (this week's trend7 minus last week's) cut at TREND_DIR_CUTOFF.
 *
 * Headline as a percentage (today.pct): the rank of that night's composite among the composites of
 * the PCT_WINDOW_DAYS days before it (empirical CDF: the share of prior days with a lower composite,
 * ties counted half, rounded to an integer 0-100). Prior days are scored against the SAME baseline
 * as the night, so the rank compares like with like, and only days carrying MIN_WEIGHT count. It is
 * a transparent mapping of the same composite, not a new metric: 85 % = better than ~85 % of your
 * last 90 days. Under MIN_PCT_DAYS prior days pct is null and the page keeps the SD value + dayBand.
 * Bands (pctBand): good >= PCT_GOOD, low <= PCT_LOW, mid between (thirds of your own distribution).
 *
 * Baseline/scoring overlap (deliberate): the baseline window ends the day before asOf, so it
 * contains most of the 7 days being scored. A real shift in the final week therefore pulls the
 * median/MAD slightly toward itself and the reported trend is a little SMALLER than against a
 * baseline that excluded the week. Accepted: it only ever damps (a false "you are below baseline"
 * is worse than a slightly late one), it keeps every window anchored to one asOf, and a
 * non-overlapping baseline would need a second full window of history before the card can show.
 */
import { median, wrapNight, meanOf, roundTo } from '../health/stats.mjs';
import { addDays } from '../date.mjs';
import { classicGlobal } from '../format/numbers.mjs';
import { isDerivedReading } from '../extract/samples.mjs';

// Weights follow signal reliability: HRV is the most responsive marker of recovery, resting HR and
// sleep duration next, sleep regularity is a weak, noisy modifier.
export const WEIGHTS = { hrv: 0.4, rhr: 0.25, sleepDur: 0.25, sleepCons: 0.1 };
// A trend within half a MAD of baseline is indistinguishable from day-to-day noise. Measured spread
// of the smoothed series (rolling, 90 days): sigma_d ~ 0.78 and sigma_7 ~ 0.33 (in-sample over the
// same window: 0.86 / 0.24), i.e. ~1.5 sigma_7, so ~88% of days read "at baseline". Re-derive with
// measureSigma(). Widen this only if sigma_7 exceeds 0.45.
export const BAND_CUTOFF = 0.5;
// The spreads quoted above: sd of the daily composite and of the 7-day trend, measured once with
// measureSigma(days = 90) on ~90 days of ONE user's data, and shipped as a POPULATION DEFAULT for everyone.
// The composite is already z-scored per user against that user's own 42-day baseline (BASELINE_DAYS), so
// the bands of the trend do not depend on it; only DAY_BAND_CUTOFF (and the sigma talk of TREND_DIR_CUTOFF)
// does. To re-derive it on an install's own extract, run measureSigma() over readExtract's hrv / rhr / sleep
// (the one-line command is in docs/home-tab.md, "Headline (`today`) and last night") and compare sigmaD /
// sigma7 with these; there is no per-user calibration.
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
const MIN_WEIGHT = 0.6;
// Half of the 14 days the sparkline covers: fewer and the trend is built on gaps.
const MIN_COMPOSITE_DAYS = 7;
// A "7-day trend" built from fewer than 3 days is not a trend.
const MIN_WINDOW_DAYS = 3;
// Beyond 3 MADs a day is an outlier, not information; capping keeps one bad night from owning the week.
export const Z_CLAMP = 3;
const WINSOR_K = 3;
// Two weeks of smoothed composite: the sparkline length on the card.
const RECOVERY_SPARK_DAYS = 14;
// A trend window is 7 days; the first sparkline point needs 6 more days before it.
const TREND_DAYS = 7;
// Scales MAD to the standard deviation of a normal distribution, so "1 MAD unit" ~ "1 sd".
const MAD_TO_SD = 1.4826;
// The percentage headline: rank within the previous 90 days, needs three weeks of prior composites.
export const PCT_WINDOW_DAYS = 90;
export const MIN_PCT_DAYS = 21;
// Thirds of the user's own distribution: top third green, bottom third red.
export const PCT_GOOD = 67;
export const PCT_LOW = 33;
// Floating-point slack when comparing a summed weight against MIN_WEIGHT (0.25 + 0.25 + 0.1 must equal 0.6).
const EPS = 1e-9;
// Confidence: "high" needs nearly all the weight present today and a full month of baseline.
const HIGH_CONFIDENCE_WEIGHT = 0.9;
const HIGH_CONFIDENCE_BASELINE_DAYS = 28;
const ORDER = ['hrv', 'rhr', 'sleepDur', 'sleepCons'];
// Completeness of a day's HRV: the newest day is often still in progress (or synced mid-day) and
// carries only a few samples, so its median is noisy. A day is complete with at least
// max(min(MIN_DAY_SAMPLES, usual), MIN_DAY_FRACTION x usual) samples, usual = the median per-day
// sample count over the baseline window. The floor is capped at the usual count, so a period whose
// normal is 1-2 samples a day is not declared incomplete wholesale.
const MIN_DAY_SAMPLES = 3;
const MIN_DAY_FRACTION = 0.5;
// The headline may show a night at most this many days before asOf: an older one is not "how you
// woke up" any more, so the page shows the trend with a "no recent complete night" note instead.
export const MAX_TODAY_FALLBACK_DAYS = 2;

// Per component: `dir` = which way is better; `lo`/`hi` = physiological plausibility range of each raw
// sample: a sample outside it (a 230 ms SDNN spike, a 1 bpm dropout) is a sensor artefact and is dropped; `floor` = the
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

/** Per-day median of the plausible samples: a sample outside [lo, hi] is an artefact and is dropped (never
 * clamped: a clamped 1 bpm dropout would read as a real 30 bpm day); a day with no plausible sample is absent.
 * rows: [{date, value}] -> [{date, value}] sorted. */
export function dailyRobust(rows, { lo, hi }) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r || !r.date || !Number.isFinite(r.value) || r.value < lo || r.value > hi) continue;
    if (!by.has(r.date)) by.set(r.date, []);
    by.get(r.date).push(r.value);
  }
  return [...by.keys()].sort().map((date) => ({ date, value: median(by.get(date)) }));
}

/** Raw HRV samples [{date, value}] + anchor date -> (date) => whether that day has enough samples to
 * be scored as a whole day (see MIN_DAY_SAMPLES). Only PLAUSIBLE samples count (inside the plausibility
 * range `plaus`, default HRV's: an artefact is not a sample), and identical rows (same date, time
 * when present, and value: a sample written twice, e.g. by the export and by the Shortcut) count
 * once. The usual count comes from the BASELINE_DAYS before the anchor; with no history any sample
 * makes a day complete. */
export function completeDay(rows, anchor, plaus = DEFS.hrv) {
  const seen = new Set();
  const counts = new Map();
  for (const r of rows || []) {
    if (!r || !r.date || !Number.isFinite(r.value) || r.value < plaus.lo || r.value > plaus.hi) continue;
    // Only a timestamped row can be recognised as a repeat of the same sample. readSeries sets no
    // `t`, so without one every in-range row is a distinct sample (equal values are common).
    if (r.t != null && r.t !== '') {
      const id = r.date + '|' + r.t + '|' + r.value;
      if (seen.has(id)) continue;
      seen.add(id);
    }
    counts.set(r.date, (counts.get(r.date) || 0) + 1);
  }
  const from = addDays(anchor, -BASELINE_DAYS);
  const base = [...counts].filter(([d]) => d >= from && d < anchor).map(([, n]) => n);
  const usual = base.length ? median(base) : 0;
  const need = usual ? Math.max(Math.min(MIN_DAY_SAMPLES, usual), MIN_DAY_FRACTION * usual) : 1;
  return (d) => (counts.get(d) || 0) >= need;
}

/** The ONE per-day series of a recovery signal (key 'hrv' | 'rhr' | 'sleepDur'): implausible samples
 * dropped, then the day median. Shared by Inicio (recovery, monitor) and Salud, so every
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
/** The band of a value AS SHOWN (rounded to the 2 decimals the bake keeps), against `cut` (default the
 * trend's BAND_CUTOFF; DAY_BAND_CUTOFF for last night): an unrounded 0.4996 shown as "0.50" must read
 * "above", like the number the user sees. */
export function shownBand(v, cut = BAND_CUTOFF) {
  const r = round(v, 2);
  if (r >= cut) return 'above';
  if (r <= -cut) return 'below';
  return 'at';
}

export function dayBand(v) {
  if (v >= DAY_BAND_CUTOFF) return 'above';
  if (v <= -DAY_BAND_CUTOFF) return 'below';
  return 'at';
}

/** Rank of `value` among `priors` as an integer 0-100: share of priors below it, ties counted half.
 * null when the value is not finite or fewer than MIN_PCT_DAYS finite priors exist. */
export function percentileRank(value, priors) {
  const xs = (priors || []).filter((x) => Number.isFinite(x));
  if (!Number.isFinite(value) || xs.length < MIN_PCT_DAYS) return null;
  let below = 0;
  let ties = 0;
  for (const x of xs) {
    if (x < value) below++;
    else if (x === value) ties++;
  }
  return Math.round((100 * (below + ties / 2)) / xs.length);
}

/** Band of a percentage: 'good' (>= PCT_GOOD) | 'mid' | 'low' (<= PCT_LOW); null for no value. */
export function pctBand(p) {
  if (p == null || !Number.isFinite(p)) return null;
  if (p >= PCT_GOOD) return 'good';
  if (p <= PCT_LOW) return 'low';
  return 'mid';
}

/** The classic-script twin for the inline page scripts: `var HC_BAND = {…}` built from THESE thresholds
 * and pctBand's own source (web/layouts/Plan.astro inlines it with HC_FMT, before util.js), so every
 * client 0-100 band (the recovery % colour, the energy bank) cuts exactly where the lib does. */
export function clientSource() {
  return classicGlobal('HC_BAND', { consts: { PCT_GOOD, PCT_LOW }, fns: { pctBand } });
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

/** Sleep consistency per night (minutes, clamped to DEFS.sleepCons): the mean of |bedtime − median|
 * and |wake − median|, the medians over the BASELINE_DAYS nights before `asOf` (bedtime after
 * wrapNight, so 23:50 and 00:10 are 20 min apart). The recovery input sleepCons and the sleep
 * deep-dive's consistency row. rows: readSleep() rows; asOf defaults to the newest night. */
export function sleepConsistency(sleep, asOf) {
  const bw = new Map();
  for (const s of sleep || []) {
    if (s && s.date && Number.isFinite(s.bedtime) && Number.isFinite(s.waketime)) bw.set(s.date, { bed: wrapNight(s.bedtime), wake: s.waketime });
  }
  if (!bw.size) return [];
  const to = asOf || [...bw.keys()].sort().pop();
  const winFrom = addDays(to, -BASELINE_DAYS), winTo = addDays(to, -1);
  const winBW = [...bw.entries()].filter(([d]) => d >= winFrom && d <= winTo).map(([, v]) => v);
  if (!winBW.length) return [];
  const medBed = median(winBW.map((v) => v.bed));
  const medWake = median(winBW.map((v) => v.wake));
  return [...bw.keys()].sort().map((d) => {
    const v = bw.get(d);
    return { date: d, value: clamp(((Math.abs(v.bed - medBed) + Math.abs(v.wake - medWake)) / 2) * 60, DEFS.sleepCons.lo, DEFS.sleepCons.hi) };
  });
}

/** Each component's robust z-scores against its own BASELINE_DAYS baseline (the window before asOf), back to
 * zFrom; a component without MIN_BASELINE_DAYS of baseline or without a 7-day trend at asOf is left out. */
function scoreComponents(dailies, asOf, zFrom) {
  const winFrom = addDays(asOf, -BASELINE_DAYS);
  const winTo = addDays(asOf, -1);
  const comps = {};
  for (const key of ORDER) {
    const def = DEFS[key];
    const space = (v) => (key === 'hrv' ? Math.log(v) : v);
    const rows = dailies[key].map((r) => ({ date: r.date, raw: r.value, v: space(r.value) }));
    const base = rows.filter((r) => r.date >= winFrom && r.date <= winTo).map((r) => r.v);
    if (base.length < MIN_BASELINE_DAYS) continue;
    const b = robustBaseline(base, def.floor);
    const zs = rows.filter((r) => r.date >= zFrom && r.date <= asOf).map((r) => {
      const w = winsorize([r.v], b.median, b.mad, WINSOR_K)[0];
      return { date: r.date, value: def.dir * clamp((w - b.median) / b.mad, -Z_CLAMP, Z_CLAMP) };
    });
    const t = trend7(zs, asOf);
    if (t.value == null) continue;
    comps[key] = { key, def, rows, zs, b, t };
  }
  return comps;
}

/** The daily composite over the components present that day: {zByDate: date -> {key: z}, comp: [{date, value}]}. */
function dailyComposite(used, comps) {
  const zByDate = new Map();
  for (const k of used) for (const z of comps[k].zs) {
    if (!zByDate.has(z.date)) zByDate.set(z.date, {});
    zByDate.get(z.date)[k] = z.value;
  }
  const comp = [...zByDate.keys()].sort().map((date) => ({ date, value: composite(zByDate.get(date), WEIGHTS) })).filter((r) => r.value != null);
  return { zByDate, comp };
}

/** The per-component block: 7-day trend and its change, band, baseline (native units), spread and the daily values. */
function componentSummaries(used, comps, asOf, sparkFrom) {
  return used.map((k) => {
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
}

/** "Last night" = the newest COMPLETE day among asOf and the MAX_TODAY_FALLBACK_DAYS before it (see the
 * header): {day (null when none), present, weight}. A partial newest day is never presented as last night; the
 * page labels an older day by its date. Complete = sleep duration AND resting HR (written once the night is
 * over, so its absence marks a day still in progress) AND, only when HRV is a scored component, an HRV day
 * with enough samples. Without a complete day, present / weight are asOf's own. */
function lastNight(hrv, used, comps, asOf) {
  const hrvComplete = completeDay(hrv, asOf);
  const dayInfo = (d) => {
    const present = used.filter((k) => comps[k].rows.some((r) => r.date === d) && (k !== 'hrv' || hrvComplete(d)));
    return { date: d, present, weight: round(present.reduce((s, k) => s + WEIGHTS[k], 0), 4) };
  };
  const hrvRequired = used.includes('hrv');
  const scorable = (x) => x.weight >= MIN_WEIGHT - EPS && x.present.includes('sleepDur') && x.present.includes('rhr') &&
    (!hrvRequired || x.present.includes('hrv'));
  let day = null;
  for (let i = 0; i <= MAX_TODAY_FALLBACK_DAYS && !day; i++) {
    const x = dayInfo(addDays(asOf, -i));
    if (scorable(x)) day = x;
  }
  const { present, weight } = day || dayInfo(asOf);
  return { day, present, weight };
}

/** Last night's score, scored against the same baseline over the components present that day, with its rank
 * among the PCT_WINDOW_DAYS before it (same baseline, days with MIN_WEIGHT only); null without a complete day. */
function nightScore(day, present, zByDate, comp) {
  if (!day) return null;
  const zDay = Object.fromEntries(present.map((k) => [k, (zByDate.get(day.date) || {})[k]]));
  const todayValue = composite(zDay, WEIGHTS);
  if (todayValue == null) return null;
  const pctFrom = addDays(day.date, -PCT_WINDOW_DAYS);
  const dayWeight = (zs) => Object.keys(zs).reduce((s, k) => s + WEIGHTS[k], 0);
  const priors = comp.filter((r) => r.date >= pctFrom && r.date < day.date && dayWeight(zByDate.get(r.date)) >= MIN_WEIGHT - EPS).map((r) => r.value);
  const pct = percentileRank(todayValue, priors);
  return {
    date: day.date, value: round(todayValue, 2), band: shownBand(todayValue, DAY_BAND_CUTOFF), sleep: present.includes('sleepDur'),
    pct, pctBand: pctBand(pct), pctDays: priors.length,
  };
}

/** Pure: {hrv, rhr, sleep} row arrays -> the recovery block.
 * opts.debug (object) receives the daily composite series as `debug.composite`; opts.historyDays
 * widens the scored window (default: sparkline + first trend window) so that series can be as
 * long as needed for offline sigma measurement. The returned block never depends on either.
 * @param {{hrv?: any, rhr?: any, sleep?: any}} [inputs]
 * @param {{debug?: Record<string, any>, historyDays?: number}} [opts]
 */
export function recoveryFromInputs({ hrv, rhr, sleep } = {}, { debug, historyDays } = {}) {
  const dailies = {
    hrv: dailyRobust(hrv, DEFS.hrv),
    rhr: dailyRobust(rhr, DEFS.rhr),
    sleepDur: dailyRobust((sleep || []).map((s) => ({ date: s.date, value: s.value })), DEFS.sleepDur),
  };
  const allDates = [...dailies.hrv, ...dailies.rhr, ...dailies.sleepDur, ...(sleep || [])].map((r) => r.date).filter(Boolean);
  if (!allDates.length) return gatedShape(null);
  const asOf = allDates.reduce((a, b) => (b > a ? b : a));
  dailies.sleepCons = sleepConsistency(sleep, asOf);

  const sparkFrom = addDays(asOf, -(RECOVERY_SPARK_DAYS - 1));
  // z back far enough for the sparkline's first trend window AND the percentile window before the
  // oldest night the headline may fall back to
  const zDays = Math.max(historyDays || 0, RECOVERY_SPARK_DAYS + TREND_DAYS - 1, PCT_WINDOW_DAYS + MAX_TODAY_FALLBACK_DAYS + 1);
  const comps = scoreComponents(dailies, asOf, addDays(asOf, -zDays + 1));
  const used = ORDER.filter((k) => comps[k]);
  const availWeight = used.reduce((s, k) => s + WEIGHTS[k], 0);
  if (availWeight < MIN_WEIGHT - EPS || !(comps.hrv || comps.rhr)) return gatedShape(asOf);

  const { zByDate, comp } = dailyComposite(used, comps);
  if (debug) debug.composite = comp;
  const compDays = comp.filter((r) => r.date >= sparkFrom && r.date <= asOf).length;
  const cur = trend7(comp, asOf).value;
  if (compDays < MIN_COMPOSITE_DAYS || cur == null) return gatedShape(asOf);
  const prev = trend7(comp, addDays(asOf, -TREND_DAYS)).value;
  const components = componentSummaries(used, comps, asOf, sparkFrom);

  const { day, present, weight } = lastNight(hrv, used, comps, asOf);
  const minBaselineDays = Math.min(...used.map((k) => comps[k].b.n));
  const level = weight >= HIGH_CONFIDENCE_WEIGHT && minBaselineDays >= HIGH_CONFIDENCE_BASELINE_DAYS ? 'high' : weight >= MIN_WEIGHT - EPS ? 'medium' : 'low';
  const today = nightScore(day, present, zByDate, comp);
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
    band: shownBand(cur),
    trend7: round(cur, 2),
    delta7: prev != null ? round(cur - prev, 2) : null,
    today,
    trendDir: trendDir(prev != null ? round(cur - prev, 2) : null),
    confidence: { weight, minBaselineDays, level },
    // the weakest component is named only when it is itself below baseline (a component a hair under
    // zero is noise, and naming it would blame a signal that is fine)
    driver: worst && worst.trend7 <= -BAND_CUTOFF ? worst.key : null,
    missing: ORDER.filter((k) => !present.includes(k)),
    components,
    spark: { v: spark, from: sparkFrom, to: asOf },
    ...partialFlags(comps, rhr, day ? day.date : asOf),
  };
}

/** The explicit partial-score flags (each key only when true, so a Watch user's block is unchanged):
 * noHrv = HRV is not a scored component (a device without HRV, e.g. Mi Fitness, or under
 * MIN_BASELINE_DAYS of it): the composite is the weighted mean over resting HR + sleep, renormalised;
 * rhrDerived = every resting-HR reading of the scored day is derived from heart rate
 * (lib/extract/samples.mjs derivedRestingHr, source "<app> (derived)"). */
function partialFlags(comps, rhr, date) {
  const out = {};
  if (!comps.hrv) out.noHrv = true;
  const dayRhr = (rhr || []).filter((r) => r && r.date === date);
  if (dayRhr.length && dayRhr.every((r) => isDerivedReading(r.source))) out.rhrDerived = true;
  return out;
}

/** The pure core over lib/extract/read.mjs readExtract inputs (lib/score/index.mjs buildScoresFrom).; null when hrv, rhr and sleep are all absent
 * @param {{series?: Record<string, any>, sleep?: any}} [inputs] */
export function recoveryFrom({ series = {}, sleep = null } = {}) {
  const { hrv = null, rhr = null } = series;
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
 * @param {{hrv?: any, rhr?: any, sleep?: any}} [inputs]
 * @param {{days?: number}} [opts]
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
