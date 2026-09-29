/* Recovery as a smoothed TREND in MAD units (whoop-daily, design rev 3). No 0-100 score anywhere.
 *
 * Per component (hrv, rhr, sleep duration, sleep consistency): daily value -> z against a robust
 * median/MAD baseline (42 days ending asOf-1), winsorized and clamped to +-3, direction-signed so
 * positive always means "better than your baseline". The daily composite C(d) is the weighted
 * mean over the components available that day, in MAD units. Displayed value = trend7, the mean
 * of C over the 7 days ending asOf; delta7 compares it with the week before. Every window anchors
 * to asOf (newest input date), never to the build clock.
 */
import { readSeries, readSleep } from '../health/read.mjs';
import { median, wrapNight } from '../health/stats.mjs';
import { addDays } from './series.mjs';

export const WEIGHTS = { hrv: 0.4, rhr: 0.25, sleepDur: 0.25, sleepCons: 0.1 };
export const BAND_CUTOFF = 0.5; // widened to 0.65 only if the measured sigma_7 demands it (slice 6)
export const BASELINE_DAYS = 42;
export const MIN_BASELINE_DAYS = 14;
export const MIN_WEIGHT = 0.6;
export const MIN_COMPOSITE_DAYS = 7; // composite days required in the trailing 14
export const MIN_WINDOW_DAYS = 3; // days needed inside a 7-day trend window
const Z_CLAMP = 3;
const WINSOR_K = 3;
const SPARK_DAYS = 14;
const ORDER = ['hrv', 'rhr', 'sleepDur', 'sleepCons'];

const DEFS = {
  hrv: { unit: 'ms', dir: 1, floor: 0.05, lo: 5, hi: 200, dec: 1 },
  rhr: { unit: 'bpm', dir: -1, floor: 1.0, lo: 30, hi: 110, dec: 1 },
  sleepDur: { unit: 'h', dir: 1, floor: 0.4, lo: 2, hi: 14, dec: 2 },
  sleepCons: { unit: 'min', dir: -1, floor: 10, lo: 0, hi: 300, dec: 0 },
};

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const round = (v, d) => { const k = 10 ** d; return Math.round(v * k) / k; };
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

export function winsorize(values, med, mad, k) {
  return values.map((v) => clamp(v, med - k * mad, med + k * mad));
}

/** median, floored 1.4826*MAD, n. */
export function robustBaseline(values, madFloor) {
  const med = median(values);
  const mad = Math.max(1.4826 * median(values.map((v) => Math.abs(v - med))), madFloor);
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
  const from = addDays(asOf, -6);
  const vals = (series || []).filter((r) => r.date >= from && r.date <= asOf && r.value != null).map((r) => r.value);
  return { value: vals.length >= MIN_WINDOW_DAYS ? mean(vals) : null, n: vals.length };
}

export function recoveryBand(v) {
  if (v >= BAND_CUTOFF) return 'above';
  if (v <= -BAND_CUTOFF) return 'below';
  return 'at';
}

const gatedShape = (asOf) => ({
  asOf, gated: true, reason: 'insufficient', band: null, trend7: null, delta7: null,
  confidence: { weight: 0, minBaselineDays: 0, level: 'low' }, driver: null, missing: [...ORDER], components: [],
  spark: { v: [], from: null, to: null },
});

/** Pure: {hrv, rhr, sleep} row arrays -> the recovery block. */
export function recoveryFromInputs({ hrv, rhr, sleep } = {}) {
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

  const sparkFrom = addDays(asOf, -(SPARK_DAYS - 1));
  const zFrom = addDays(sparkFrom, -6);
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
  if (availWeight < MIN_WEIGHT - 1e-9 || !(comps.hrv || comps.rhr)) return gatedShape(asOf);

  // daily composite over the components present that day
  const zByDate = new Map();
  for (const k of used) for (const z of comps[k].zs) {
    if (!zByDate.has(z.date)) zByDate.set(z.date, {});
    zByDate.get(z.date)[k] = z.value;
  }
  const comp = [...zByDate.keys()].sort().map((date) => ({ date, value: composite(zByDate.get(date), WEIGHTS) })).filter((r) => r.value != null);
  const compDays = comp.filter((r) => r.date >= sparkFrom && r.date <= asOf).length;
  const cur = trend7(comp, asOf).value;
  if (compDays < MIN_COMPOSITE_DAYS || cur == null) return gatedShape(asOf);
  const prev = trend7(comp, addDays(asOf, -7)).value;

  const components = used.map((k) => {
    const c = comps[k];
    const prevC = trend7(c.zs, addDays(asOf, -7)).value;
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
  const level = weight >= 0.9 && minBaselineDays >= 28 ? 'high' : weight >= MIN_WEIGHT - 1e-9 ? 'medium' : 'low';
  const worst = components.reduce((a, c) => (a == null || c.trend7 < a.trend7 ? c : a), null);

  const spark = [];
  for (let i = 0; i < SPARK_DAYS; i++) {
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
