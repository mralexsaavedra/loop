/* Energy bank (Inicio's "My day" card + its deep-dive): OUR OWN intraday 0-100 level, a transparent
 * model documented here and in analysis/methodology.md. It is NOT a validated physiological measure:
 * every place that shows it says "estimate".
 *
 * Per day (wake to the latest awake data hour, at most midnight):
 *   - start: at the wake time (sleep-daily.csv waketime of that date) at the morning's recovery %
 *     (lib/score/days.mjs: that day's recovery.today.pct, the % rank the recovery dial shows). No
 *     recovery % or no wake time -> no value that day.
 *   - then each awake clock hour with an hr-hourly.csv row (an hour at least half inside a night is
 *     not awake: the stress estimate's sleep rule, lib/score/stress.mjs sleepWindows), in order:
 *       baseline drain  -BASE_DRAIN (1.5)
 *       stress drain    -STRESS_DRAIN (1.5) x the hour's stress estimate (0-3) when the hour is scored
 *       load drain      -LOAD_DRAIN (30) x (1 - e^(-TRIMP_hour / K)): TRIMP and K are day strain's
 *                       (lib/score/strain.mjs: minutes x HR zone, K = p95 day / ln 7)
 *       recharge        +RECHARGE (1) when the hour is scored with stress < CALM_STRESS (0.5) and
 *                       no workout touches it
 *     and the level is clamped to 0-100 after every hour.
 *   - an hour with NO data between the wake hour and the latest one carries the level forward, no
 *     drain and no recharge (an unworn watch is not rest we can see).
 * The first awake hour = the clock hour the wake time rounds to (06:20 -> 06, 06:50 -> 07).
 * TRIMP of an hour = its Watch samples outside workouts (hr-hourly `hist`, as day strain) + each
 * Strava activity's TRIMP (workout-zones.csv) spread evenly over the clock hours its start +
 * elapsed_s window covers (the stream has no per-hour split). Local wall-clock times, offset ignored
 * (as the stress estimate and the sleep times).
 * The contributions summary adds up the nominal drains and recharges; with the 0-100 clamp they may
 * add up to more than the level moved.
 *
 * Pure over parsed rows (lib/score/read.mjs parses hr-hourly.csv + workout-zones.csv for
 * lib/extract/read.mjs readExtract; energyFrom scores those inputs); the bake carries no build-time "now", only data dates. */
import { hourlyLoad, activityLoad } from './strain.mjs';
import { sleepWindows, SLEEP_OVERLAP_MIN } from './stress.mjs';
import { RECENT_DAYS } from './training-load.mjs';
import { roundTo } from '../stats.mjs';
import { addDays } from '../date.mjs';

export const ENERGY = Object.freeze({
  MAX: 100,
  // an awake hour costs something even sitting still: 16 waking hours = -24
  BASE_DRAIN: 1.5,
  // per stress point (0-3): a whole hour at the top of the stress scale = -4.5
  STRESS_DRAIN: 1.5,
  // the most one hour of heart-rate load can take (a very hard hour approaches it)
  LOAD_DRAIN: 30,
  // a scored hour under this stress, outside workouts, is a calm hour
  CALM_STRESS: 0.5,
  RECHARGE: 1,
});
const C = ENERGY;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

/** @typedef {import('./read.mjs').HrHour} HrHour */
/** @typedef {import('./read.mjs').Activity} Activity */
/** @typedef {import('./recovery.mjs').SleepRow} SleepRow */
/** One awake data hour: its stress (null when unscored), TRIMP and whether a workout touched it.
 * @typedef {{st: number | null, trimp: number, wo: boolean}} AwakeHour */
/** The strain bake fields the bank reads (strain.mjs strainFromInputs). @typedef {{ok: boolean, K?: number | null, maxHr?: number | null}} StrainScale */
/** The day-stepping bake fields the bank reads (days.mjs daysFromInputs).
 * @typedef {{days: {date: string, rec: string | Record<string, unknown> | null}[]}} DaysBake */

/** @param {number} v */
const clamp = (v) => Math.max(0, Math.min(C.MAX, v));
/** @param {number} v */
const r1 = (v) => roundTo(v, 1);
/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');
// a local wall-clock stamp as minutes on one naive axis (the offset is ignored on purpose)
/** @param {unknown} stamp @returns {number | null} */
function naiveMin(stamp) {
  const m = STAMP.exec(String(stamp || ''));
  return m ? Date.parse(m[1] + 'T00:00:00Z') / 60000 + +m[2] * 60 + +m[3] : null;
}

/** @param {number} trimp @param {number} K */
export function loadDrain(trimp, K) {
  return K > 0 && trimp > 0 ? C.LOAD_DRAIN * (1 - Math.exp(-trimp / K)) : 0;
}

/** One awake data hour {st (stress | null), trimp, wo} from level lv -> {lv, base, stress, load, charge}.
 * @param {number} lv @param {AwakeHour} x @param {number} K */
export function stepHour(lv, x, K) {
  const base = C.BASE_DRAIN;
  const stress = x.st != null ? C.STRESS_DRAIN * x.st : 0;
  const load = loadDrain(x.trimp, K);
  const charge = x.st != null && x.st < C.CALM_STRESS && !x.wo ? C.RECHARGE : 0;
  return { lv: clamp(lv - base - stress - load + charge), base, stress, load, charge };
}

/** {start, wakeH, lastH, hours: Map(h -> {st, trimp, wo}), K} -> {hours: [{h, lv, st, ld, wo, gap}], min, sum}.
 * @param {{start: number, wakeH: number, lastH: number, hours: Map<number, AwakeHour>, K: number}} day */
export function simulateDay({ start, wakeH, lastH, hours, K }) {
  let lv = clamp(start);
  /** @type {{h: number, lv: number, st: number | null, ld: number, wo: boolean, gap: boolean}[]} */
  const out = [];
  /** @type {{base: number, stress: number, load: number, charge: number}} */
  const sum = { base: 0, stress: 0, load: 0, charge: 0 };
  /** @type {{h: number | null, lv: number}} */
  let min = { h: null, lv };
  for (let h = wakeH; h <= lastH; h++) {
    const x = hours.get(h);
    if (!x) {
      out.push({ h, lv, st: null, ld: 0, wo: false, gap: true });
      continue;
    }
    const s = stepHour(lv, x, K);
    lv = s.lv;
    for (const k of /** @type {(keyof typeof sum)[]} */ (Object.keys(sum))) sum[k] += s[k];
    out.push({ h, lv, st: x.st, ld: s.load, wo: !!x.wo, gap: false });
    if (lv < min.lv) min = { h, lv };
  }
  return { hours: out, min, sum };
}

/** @typedef {{from: number, to: number, load: number}} ActWindow */
/** Activities -> [{from, to (naive minutes), load (TRIMP)}].
 * @param {readonly Activity[] | null | undefined} acts @returns {ActWindow[]} */
export function actWindows(acts) {
  return /** @type {ActWindow[]} */ ((acts || []).map((a) => {
    const from = naiveMin(a.start);
    return from == null ? null : { from, to: from + a.elapsed / 60, load: activityLoad(a.z) };
  }).filter(Boolean));
}

/** hr-hourly rows -> Map("YYYY-MM-DDTHH" -> {trimp, wo}): the Watch load outside workouts + each
 * overlapping activity's even share.
 * @param {readonly HrHour[] | null | undefined} rows @param {ActWindow[]} wins @param {number | null | undefined} maxHr */
export function hourLoads(rows, wins, maxHr) {
  /** @type {Map<string, {trimp: number, wo: boolean}>} */
  const out = new Map();
  for (const r of rows || []) {
    const from = naiveMin(r.start);
    if (from == null) continue;
    let trimp = maxHr ? hourlyLoad(r.hist || new Map(), maxHr) : 0;
    let wo = r.act > 0;
    for (const w of wins) {
      const ov = Math.min(from + 60, w.to) - Math.max(from, w.from);
      if (ov <= 0) continue;
      wo = true;
      trimp += (w.load * ov) / (w.to - w.from);
    }
    out.set(String(r.start).slice(0, 13), { trimp, wo });
  }
  return out;
}

/** @param {number} dec */
function hhmm(dec) {
  const m = Math.round(dec * 60);
  return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
}

/** A day the bank cannot start (no recovery % or no wake time): no level.
 * @typedef {{date: string, reason: 'noRecovery' | 'noWake', now: null}} EnergyDayOff */
/** A simulated day: the start level at wake, the latest (`now`) and lowest levels, the drain / charge sums, the hours.
 * @typedef {{date: string, wake: string, start: number, now: {h: number | null, lv: number}, min: {h: number | null, lv: number},
 *   sum: {base: number, stress: number, load: number, charge: number},
 *   hours: {h: number, lv: number, st: number | null, ld: number, wo: boolean, gap?: true}[]}} EnergyDayOk */
/** @typedef {EnergyDayOff | EnergyDayOk} EnergyDay */
/** The energy bake: `metric` is null before the first valued day.
 * @typedef {{ok: true, asOf: string, K: number, maxHr: number | null, C: typeof ENERGY, days: EnergyDay[],
 *   metric: {kind: string, dir: number, dec: number, start: string, v: (number | null)[]} | null}} EnergyOk */
/** @typedef {{ok: false, reason: string, asOf: string}} EnergyOff */

/** @param {string} date
 * @param {{byDate: Map<string, HrHour[]>, loads: Map<string, {trimp: number, wo: boolean}>, windows: {from: number, to: number}[],
 *   wakeOf: Map<string, number>, pctOf: Map<string, number>, stressOf: Map<string, Map<number, number>>, K: number}} I
 * @returns {EnergyDay} */
function dayOf(date, I) {
  const { byDate, loads, windows, wakeOf, pctOf, stressOf, K } = I;
  const wake = wakeOf.get(date);
  const pct = pctOf.get(date);
  if (pct == null) return { date, reason: 'noRecovery', now: null };
  if (wake == null) return { date, reason: 'noWake', now: null };
  const wakeH = Math.round(wake);
  const st = stressOf.get(date) || new Map();
  /** @type {Map<number, AwakeHour>} */
  const hours = new Map();
  for (const r of byDate.get(date) || []) {
    const h = parseInt(r.start.slice(11, 13), 10);
    if (!(h >= wakeH)) continue;
    // hr-hourly rows carry a full stamp (read.mjs hrHoursFromCells), so this is never null
    const from = /** @type {number} */ (naiveMin(r.start));
    let asleep = 0;
    for (const w of windows) asleep += Math.max(0, Math.min(from + 60, w.to) - Math.max(from, w.from));
    if (asleep >= SLEEP_OVERLAP_MIN) continue;
    const L = loads.get(r.start.slice(0, 13)) || { trimp: 0, wo: false };
    hours.set(h, { st: st.has(h) ? /** @type {number} */ (st.get(h)) : null, trimp: L.trimp, wo: L.wo });
  }
  const lastH = hours.size ? Math.max(...hours.keys()) : wakeH - 1;
  const sim = simulateDay({ start: pct, wakeH, lastH, hours, K });
  const lastLv = sim.hours.length ? sim.hours[sim.hours.length - 1].lv : clamp(pct);
  return {
    date, wake: hhmm(wake), start: Math.round(clamp(pct)),
    now: { h: sim.hours.length ? lastH : null, lv: Math.round(lastLv) },
    // h stays null when no hour went below the start level (EnergyDayOk types it as a number)
    min: { h: sim.min.h, lv: Math.round(sim.min.lv) },
    sum: { base: r1(sim.sum.base), stress: r1(sim.sum.stress), load: r1(sim.sum.load), charge: r1(sim.sum.charge) },
    hours: sim.hours.map((x) => {
      /** @type {EnergyDayOk['hours'][number]} */
      const o = { h: x.h, lv: r1(x.lv), st: x.st, ld: r1(x.ld), wo: x.wo };
      if (x.gap) o.gap = true;
      return o;
    }),
  };
}

/** {hours (hr-hourly rows), acts, sleep, stress (SCORES.stress), days (SCORES.days), strain
 * (SCORES.strain)} -> null (no hourly data) | {ok: false, reason, asOf} | the energy bake: `days` =
 * the last RECENT_DAYS days with hourly data (Inicio's day stepping), `metric` = each day's latest
 * level as a dense series from the first valued day (the deep-dive's trend, the DETAIL metric shape).
 * @param {{hours: readonly HrHour[] | null | undefined, acts: readonly Activity[] | null | undefined,
 *   sleep: readonly SleepRow[] | null | undefined, stress: import('./stress.mjs').StressOk | import('./stress.mjs').StressOff | null | undefined,
 *   days: DaysBake | null | undefined, strain: StrainScale | null | undefined}} inputs
 * @returns {EnergyOk | EnergyOff | null} */
export function energyFromInputs({ hours, acts, sleep, stress, days, strain }) {
  if (!hours || !hours.length) return null;
  const dates = [...new Set(hours.map((h) => h.date))].sort();
  const asOf = dates[dates.length - 1];
  if (!strain || !strain.ok || !(/** @type {number} */ (strain.K) > 0)) return { ok: false, reason: 'noLoadScale', asOf };
  /** @type {Map<string, HrHour[]>} */
  const byDate = new Map();
  for (const h of hours) {
    if (!byDate.has(h.date)) byDate.set(h.date, []);
    /** @type {HrHour[]} */ (byDate.get(h.date)).push(h);
  }
  const wakeOf = new Map((sleep || []).filter((s) => s && ISO.test(s.date) && Number.isFinite(s.waketime) && /** @type {number} */ (s.waketime) < 23.5)
    .map((s) => [s.date, /** @type {number} */ (s.waketime)]));
  const pctOf = new Map(((days && days.days) || []).filter((d) => d && d.rec && typeof d.rec === 'object' && Number.isFinite(d.rec.pct))
    .map((d) => [d.date, /** @type {number} */ (/** @type {{pct: number}} */ (d.rec).pct)]));
  /** @type {Map<string, Map<number, number>>} */
  const stressOf = new Map();
  for (const d of (stress && stress.ok && stress.days) || []) {
    stressOf.set(d.date, new Map((d.hours || []).map((x) => [parseInt(x.t, 10), x.v])));
  }
  const I = {
    byDate, wakeOf, pctOf, stressOf, K: /** @type {number} */ (strain.K),
    loads: hourLoads(hours, actWindows(acts), strain.maxHr), windows: sleepWindows(sleep),
  };
  const from = addDays(asOf, -(RECENT_DAYS - 1));
  const out = dates.filter((d) => d >= from).map((d) => dayOf(d, I));
  const first = out.find((d) => d.now);
  /** @type {EnergyOk['metric']} */
  let metric = null;
  if (first) {
    const lv = new Map(out.filter((d) => d.now).map((d) => [d.date, /** @type {EnergyDayOk} */ (d).now.lv]));
    /** @type {(number | null)[]} */
    const v = [];
    for (let t = first.date; t <= asOf; t = addDays(t, 1)) v.push(lv.has(t) ? /** @type {number} */ (lv.get(t)) : null);
    metric = { kind: 'bank', dir: 0, dec: 0, start: first.date, v };
  }
  return { ok: true, asOf, K: /** @type {number} */ (strain.K), maxHr: strain.maxHr || null, C: { ...ENERGY }, days: out, metric };
}

/** The energy bank over lib/extract/read.mjs inputs plus the stress / days / strain bakes buildScoresFrom
 * already computed (nothing is scored twice); null without hr-hourly.csv.
 * @param {{hrHours?: readonly HrHour[] | null, activities?: readonly Activity[] | null, sleep?: readonly SleepRow[] | null}} [inputs]
 * @param {{stress?: Parameters<typeof energyFromInputs>[0]['stress'], days?: DaysBake | null, strain?: StrainScale | null}} [bakes]
 * @returns {EnergyOk | EnergyOff | null} */
export function energyFrom({ hrHours = null, activities = null, sleep = null } = {}, { stress = null, days = null, strain = null } = {}) {
  return hrHours ? energyFromInputs({ hours: hrHours, acts: activities, sleep, stress, days, strain }) : null;
}
