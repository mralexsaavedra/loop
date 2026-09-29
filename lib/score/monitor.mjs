/* Health monitor (Inicio, under the dials): the LATEST value of five overnight signals, each read
 * against the owner's own normal range. No score and no percentage: a value is Normal / High / Low
 * relative to a personal band, or "building baseline" while there is too little history.
 *
 * Per signal: samples are clamped to a plausible range and collapsed to one value per day (the day
 * median, recovery.mjs dailyRobust). Latest = the newest day. Band = median +- BAND_K x scaled MAD
 * (recovery.mjs robustBaseline, MAD x 1.4826 so 1 MAD ~ 1 sd, floored per signal) over the
 * BASELINE_DAYS (42) days BEFORE the latest one, so a value never widens its own band. Fewer than
 * MIN_BASELINE_DAYS (14) baseline days -> status 'building', no band. 1.5 sd leaves ~13% of normal
 * days outside the band on a normal distribution: loose enough that "High"/"Low" is worth a look,
 * tight enough to catch a real overnight shift.
 *
 * Tone (what the colour means) follows each signal's good direction: HRV high = good, resting HR
 * high = bad, short sleep = bad. Respiratory rate and sleeping wrist temperature are CHANGE signals
 * (a shift either way is what matters, e.g. the start of an illness), so out-of-band is 'watch',
 * never good or bad. Anchored to the data's own dates, never the build clock.
 */
import { readSeries, readSleep } from '../health/read.mjs';
import { addDays, roundTo } from '../health/stats.mjs';
import { dailyRobust, robustBaseline, BASELINE_DAYS, MIN_BASELINE_DAYS } from './recovery.mjs';

export const MONITOR_KEYS = ['respiratory', 'rhr', 'hrv', 'wristTemp', 'sleep'];
export const BAND_K = 1.5;
// The bar spans +-3 MAD around the median (the same clamp the recovery z uses), widened to the value.
const BAR_MAD = 3;

// dir: 1 = higher is better, -1 = lower is better, 0 = change signal. lo/hi: plausibility clamp per
// sample. floor: smallest MAD divided by, so a very stable series cannot flag a trivial wobble
// (respiratory 0.3 br/min, resting HR 1 bpm, HRV 3 ms, wrist temp 0.1 C, sleep 0.4 h = 24 min).
const DEFS = {
  respiratory: { unit: 'br/min', dec: 1, dir: 0, lo: 5, hi: 40, floor: 0.3 },
  rhr: { unit: 'bpm', dec: 0, dir: -1, lo: 30, hi: 110, floor: 1 },
  hrv: { unit: 'ms', dec: 0, dir: 1, lo: 5, hi: 200, floor: 3 },
  wristTemp: { unit: '°C', dec: 2, dir: 0, lo: 30, hi: 42, floor: 0.1 },
  sleep: { unit: 'h', dec: 1, dir: 1, lo: 2, hi: 14, floor: 0.4 },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function tone(status, dir) {
  if (status !== 'high' && status !== 'low') return 'normal';
  if (dir === 0) return 'watch';
  return (status === 'high') === (dir > 0) ? 'good' : 'bad';
}

/** key + [{date, value}] -> one monitor card. */
export function monitorCard(key, rows) {
  const def = DEFS[key];
  const daily = dailyRobust(rows, def);
  if (!daily.length) return { key, state: 'none' };
  const latest = daily[daily.length - 1];
  const from = addDays(latest.date, -BASELINE_DAYS);
  const base = daily.filter((r) => r.date >= from && r.date < latest.date).map((r) => r.value);
  const card = { key, state: 'ok', unit: def.unit, dec: def.dec, value: roundTo(latest.value, def.dec), date: latest.date, n: base.length };
  if (base.length < MIN_BASELINE_DAYS) return { ...card, status: 'building', tone: 'normal', band: null, bar: null };

  const b = robustBaseline(base, def.floor);
  const lo = b.median - BAND_K * b.mad;
  const hi = b.median + BAND_K * b.mad;
  const status = latest.value > hi ? 'high' : latest.value < lo ? 'low' : 'normal';
  const min = Math.min(b.median - BAR_MAD * b.mad, latest.value);
  const max = Math.max(b.median + BAR_MAD * b.mad, latest.value);
  const frac = (v) => roundTo(clamp01((v - min) / (max - min)), 3);
  const d = def.dec + 1;
  return {
    ...card,
    status,
    tone: tone(status, def.dir),
    band: { lo: roundTo(lo, d), median: roundTo(b.median, d), hi: roundTo(hi, d) },
    bar: { lo: frac(lo), hi: frac(hi), v: frac(latest.value) },
  };
}

/** {respiratory, rhr, hrv, wristTemp, sleep} row arrays (any may be null) -> {asOf, cards}. */
export function monitorFromInputs(inputs = {}) {
  const cards = MONITOR_KEYS.map((k) => monitorCard(k, inputs[k]));
  const dates = cards.filter((c) => c.state === 'ok').map((c) => c.date).sort();
  return { asOf: dates.length ? dates[dates.length - 1] : null, cards };
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
