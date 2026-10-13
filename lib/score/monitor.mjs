/* Health monitor (Inicio, under the dials): the LATEST value of five overnight signals, each read
 * against the user's own normal range. No score and no percentage: a value is Normal / High / Low
 * relative to a personal band, or "building baseline" while there is too little history.
 *
 * Per signal: samples are clamped to a plausible range and collapsed to one value per day (the day
 * median, recovery.mjs dailyRobust). Latest = the newest day (for HRV the newest COMPLETE day: one with
 * enough samples, recovery.mjs completeDay; a partial day still in progress is skipped). Band = median +- BAND_K x scaled MAD
 * (recovery.mjs robustBaseline, MAD x 1.4826 so 1 MAD ~ 1 sd, floored per signal) over the
 * BASELINE_DAYS (42) days BEFORE the latest one, so a value never widens its own band. HRV is
 * right-skewed, so like recovery.mjs its band is computed in log space (asymmetric in ms). Fewer
 * than MIN_BASELINE_DAYS (14) baseline days -> status 'building', no band. BAND_K = 2 sd leaves ~5%
 * of normal days outside the band per card (two-sided, normal distribution); with five cards a
 * tighter band would flag something most mornings. The baseline hangs off the card's OWN latest
 * date; the client removes the tone of a card whose date is old (> 3 days), so a stale reading is
 * never presented as today's status.
 *
 * Tone (what the colour means) follows each signal's good direction: HRV high = good, resting HR
 * high = bad, short sleep = bad. Respiratory rate and sleeping wrist temperature are CHANGE signals
 * (a shift either way is what matters, e.g. the start of an illness), so out-of-band is 'watch',
 * never good or bad. Anchored to the data's own dates, never the build clock.
 */
import { readSeries, readSleep } from '../health/read.mjs';
import { addDays, roundTo } from '../health/stats.mjs';
import { dailyRobust, robustBaseline, completeDay, BASELINE_DAYS, MIN_BASELINE_DAYS, Z_CLAMP } from './recovery.mjs';

export const MONITOR_KEYS = ['respiratory', 'rhr', 'hrv', 'wristTemp', 'sleep'];
export const BAND_K = 2;
// The bar spans +-Z_CLAMP MAD around the median (the same clamp the recovery z uses), widened to
// include the value.

// dir: 1 = higher is better, -1 = lower is better, 0 = change signal. lo/hi: plausibility clamp per
// sample. floor: smallest MAD divided by, so a very stable series cannot flag a trivial wobble
// (respiratory 0.3 br/min, resting HR 1 bpm, HRV 0.05 in ln space = ~5% like recovery.mjs, wrist
// temp 0.1 C, sleep 0.4 h = 24 min). Display units live in the i18n dict (score-templates monitor.units).
const DEFS = {
  respiratory: { dec: 1, dir: 0, lo: 5, hi: 40, floor: 0.3 },
  rhr: { dec: 0, dir: -1, lo: 30, hi: 110, floor: 1 },
  // `complete`: the latest day must carry enough samples (recovery.mjs completeDay) — HRV is sampled
  // several times a day, so a day still in progress is a partial, noisy median
  hrv: { dec: 0, dir: 1, lo: 5, hi: 200, floor: 0.05, log: true, complete: true },
  wristTemp: { dec: 2, dir: 0, lo: 30, hi: 42, floor: 0.1 },
  sleep: { dec: 1, dir: 1, lo: 2, hi: 14, floor: 0.4 },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function tone(status, dir) {
  if (status !== 'high' && status !== 'low') return 'normal';
  if (dir === 0) return 'watch';
  return (status === 'high') === (dir > 0) ? 'good' : 'bad';
}

/** key + [{date, value}] -> the card's daily series: clamped day median; for HRV the partial newest
 * day(s) are dropped (they never enter the baseline). Also the series the detail views bake. */
export function monitorDaily(key, rows) {
  const def = DEFS[key];
  let daily = dailyRobust(rows, def);
  if (def.complete && daily.length) {
    // the latest COMPLETE day: a partial newest day is skipped (and never enters the baseline)
    const ok = completeDay(rows, daily[daily.length - 1].date);
    while (daily.length && !ok(daily[daily.length - 1].date)) daily = daily.slice(0, -1);
  }
  return daily;
}

// the baseline of the newest day: robust median / MAD (in `space`) over the BASELINE_DAYS before it
function baselineOf(daily, def) {
  const latest = daily[daily.length - 1];
  const from = addDays(latest.date, -BASELINE_DAYS);
  // every comparison happens in `space` (ln for HRV); reported numbers go back to native units
  const space = def.log ? Math.log : (v) => v;
  const native = def.log ? Math.exp : (v) => v;
  const base = daily.filter((r) => r.date >= from && r.date < latest.date).map((r) => space(r.value));
  const b = base.length >= MIN_BASELINE_DAYS ? robustBaseline(base, def.floor) : null;
  return { latest, space, native, n: base.length, b };
}

/** Daily series [{date, value}] + {floor, dec, log?} -> the personal band {lo, median, hi} of its
 * newest day (median +- BAND_K scaled MADs over the 42 days before it), or null under 14 days. The
 * monitor cards and the detail views share it, so both show one band for one signal. */
export function signalBand(daily, def) {
  if (!daily || !daily.length) return null;
  const { native, b } = baselineOf(daily, def);
  if (!b) return null;
  const d = def.dec + 1;
  return { lo: roundTo(native(b.median - BAND_K * b.mad), d), median: roundTo(native(b.median), d), hi: roundTo(native(b.median + BAND_K * b.mad), d) };
}

/** key + [{date, value}] -> one monitor card. */
export function monitorCard(key, rows) {
  const def = DEFS[key];
  const daily = monitorDaily(key, rows);
  if (!daily.length) return { key, state: 'none' };
  const { latest, space, n, b } = baselineOf(daily, def);
  const card = { key, state: 'ok', dec: def.dec, value: roundTo(latest.value, def.dec), date: latest.date, n };
  if (!b) return { ...card, status: 'building', tone: 'normal', band: null, bar: null };

  const v = space(latest.value);
  const lo = b.median - BAND_K * b.mad;
  const hi = b.median + BAND_K * b.mad;
  const status = v > hi ? 'high' : v < lo ? 'low' : 'normal';
  const min = Math.min(b.median - Z_CLAMP * b.mad, v);
  const max = Math.max(b.median + Z_CLAMP * b.mad, v);
  const frac = (x) => roundTo(clamp01((x - min) / (max - min)), 3);
  return {
    ...card,
    status,
    tone: tone(status, def.dir),
    band: signalBand(daily, def),
    bar: { lo: frac(lo), hi: frac(hi), v: frac(v) },
  };
}

/** The monitor's per-signal definition (plausibility clamp, MAD floor, decimals, direction). */
export function monitorDef(key) {
  return DEFS[key];
}

/** {respiratory, rhr, hrv, wristTemp, sleep} row arrays (any may be null) -> {asOf, cards}. */
export function monitorFromInputs(inputs = {}) {
  const cards = MONITOR_KEYS.map((k) => monitorCard(k, inputs[k]));
  const dates = cards.filter((c) => c.state === 'ok').map((c) => c.date).sort();
  return { asOf: dates.length ? dates[dates.length - 1] : null, cards };
}

/** The pure core over lib/extract/read.mjs readExtract inputs (lib/score/index.mjs buildScoresFrom).; sleep mapped to {date, value} */
export function monitorFrom({ series = {}, sleep = null } = {}) {
  return monitorFromInputs({
    respiratory: series.respiratory, rhr: series.rhr, hrv: series.hrv, wristTemp: series.wristTemp,
    sleep: sleep && sleep.map((s) => ({ date: s.date, value: s.value })),
  });
}

export function buildMonitor(extractDir) {
  const sleep = readSleep(extractDir);
  return monitorFromInputs({
    respiratory: readSeries(extractDir, 'respiratory-daily.csv'),
    rhr: readSeries(extractDir, 'rhr.csv'),
    hrv: readSeries(extractDir, 'hrv.csv'),
    wristTemp: readSeries(extractDir, 'wristTemp.csv'),
    sleep: sleep && sleep.map((s) => ({ date: s.date, value: s.value })),
  });
}
