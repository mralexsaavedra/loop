/* Detail views bake (DETAIL): compact daily series of the last DETAIL_DAYS (365) days per metric, for
 * the full-screen detail sheet a tap on any card opens (web/src/client/detail.ts). One shared global:
 * metrics keyed by name, each an ISO `start` + a `v` array (one slot per calendar day, null = no
 * data that day, never 0), rounded to the card's precision.
 *
 * Every series comes from the SAME readers and rules as its card, so the sheet and the card never
 * disagree: HRV / resting HR / respiratory / wrist temp / sleep / walking HR = the day median of the
 * plausible samples (lib/score/monitor.mjs signalDaily, partial newest HRV day dropped) with the monitor's
 * personal band; fitness age = each VO2max day mean (vo2maxDaily, the card's own series) through
 * lib/score/fitness-age.mjs (only with the profile's sex); steps / exercise / distance / flights
 * = the extract's max-per-device daily totals with the Salud floors (a near-zero step day = device not
 * carried = missing); energy = basal (sane band) + active (power-meter ride days corrected, lib/health/ride-energy.mjs), like the expenditure card (a day missing
 * either part is missing), with the card's 7-day rolling line; weight = day means + the Salud card's
 * calendar 7-day rolling average and its latest raw reading; body fat / lean mass = the most recent
 * scale only, inside the card's BODYCOMP_WINDOW; workouts = the shared same-day rule (lib/training/sessions.mjs
 * DISPLAY_RULE for the session list and minutes, the load rule for Relative Effort per modality);
 * recovery = the composite the dial showed each morning (recoveryFromInputs with the inputs cut at that
 * day, so an old day is scored against the baseline it had then, not today's) + the dial's own headline
 * (`head`); load carries the dial's gate and last scored session, so the sheet header says what the
 * dial says; strain = lib/score/strain.mjs's day strain (one calibration K for every day), only when
 * it is calibrated (else the Inicio dial stays the load dial and there is no strain view).
 *
 * Anchored to the newest data date (asOf), never the build clock: builds stay byte-identical and the
 * client decides the viewer's today. */
import { byDayMean, rollAvg, roundTo } from '../stats.mjs';
import { addDays, dayDiff } from '../date.mjs';
import { sleepPerformance, sleepEfficiency } from '../score/sleep.mjs';
import { SLEEP_TARGET, BASAL_LO, BASAL_HI, STEP_FLOOR, DIST_FLOOR, BODYCOMP_WINDOW } from '../health/aggregate.mjs';
import { signalDaily, monitorDef, signalBand } from '../score/monitor.mjs';
import { recoveryFromInputs, DAY_BAND_CUTOFF, BAND_CUTOFF, BASELINE_DAYS, sleepConsistency } from '../score/recovery.mjs';
import { modalitySeries } from '../score/series.mjs';
import { trainingThrough } from '../training/through.mjs';
import { typicalDay, percentile, loadFromSeries } from '../score/training-load.mjs';
import { scoreModality, isGymModality, LOAD_MODALITIES, byModality, byPhysical } from '../training/modality.mjs';
import { mergeSameDay, DISPLAY_RULE, sourceRank, SOURCE_PRECEDENCE } from '../training/sessions.mjs';
import { LEVEL_MIN } from '../training/activity.mjs';
import { strainFromInputs, zoneMinutes } from '../score/strain.mjs';
import { healthspanFrom } from '../score/healthspan.mjs';
import { fitnessAge, FITNESS_AGE_REF, vo2maxDaily } from '../score/fitness-age.mjs';

// One year of history: long enough for a season, small enough to bake into the page (~20 series).
export const DETAIL_DAYS = 365;
// Daily totals are judged against the middle half of the user's own days over roughly a quarter:
// long enough to be stable, short enough to follow a change of routine.
export const TOTAL_BAND_DAYS = 90;
// Fewer logged days than two weeks and the quartiles hang on a handful of days.
const MIN_BAND_DAYS = 14;
// Recovery needs its 42-day baseline plus the 14 + 6 days of trend before the scored day, and
// completeDay() looks 42 days back: 70 days of input are enough to reproduce any one morning.
const RECOVERY_LOOKBACK_DAYS = BASELINE_DAYS + 28;
// Walking HR has no monitor card: its band uses resting HR's MAD floor (1 bpm) and decimals.

export const DETAIL_KEYS = Object.freeze([
  'sleep', 'recovery', 'hrv', 'rhr', 'respiratory', 'wristTemp', 'walkingHr', 'vo2max', 'fitnessAge',
  'steps', 'exercise', 'distance', 'flights', 'energy', 'weight', 'bodyfat', 'lean', 'waist',
  'workouts', 'load-strength', 'load-hybrid', 'load-run', 'load-bike', 'strain', 'zones13', 'zones45', 'gymTime',
]);
// Sheet metrics the PAGE computes at view time (never baked in DETAIL) that still have a host tab:
// nutrition = the nutrition score (client/nutri-score.ts; its targets follow the viewer's current goal)
export const VIEW_METRICS = Object.freeze(['nutrition']);
// Day strain calendar shades: the reference's bands (light < 10, moderate 10-14, high 14-18, all out
// 18-21) on OUR 0-21 scale (lib/score/strain.mjs: 18 = the user's 95th-percentile day)
const STRAIN_LEVELS = Object.freeze([0.1, 10, 14, 18]);
// Load calendar shades at half / one / one and a half typical training days: the same typical day
// (typicalDay, median RE of the last 6 weeks) the load dial places at its arc midpoint (2x = arc end).
const LOAD_LEVEL_RATIOS = [0.5, 1, 1.5];

/** @typedef {import('../stats.mjs').Point} Point */
/** @typedef {import('../health/read.mjs').SeriesRow} SeriesRow */
/** @typedef {import('../health/read.mjs').SleepRow} SleepRow */
/** @typedef {import('../health/ride-energy.mjs').ActiveEnergyRow} ActiveEnergyRow */
/** @typedef {import('../score/recovery.mjs').Reading} Reading */
/** @typedef {import('../training/read.mjs').ZoneRow} ZoneRow */
/** @typedef {import('../score/read.mjs').HrHourlyRow} HrHourlyRow */
/** A readWorkouts() row: a workouts.csv session with its type.
 * @typedef {import('../health/read.mjs').SessionRow & {type: string}} Workout */
/** The parsed inputs detailFromInputs reads (any may be absent).
 * @typedef {{sleep?: SleepRow[] | null, hrv?: Reading[] | null, rhr?: Reading[] | null, respiratory?: Reading[] | null,
 *   wristTemp?: Reading[] | null, walkingHr?: Reading[] | null, vo2max?: SeriesRow[] | null, steps?: Point[] | null,
 *   exercise?: Point[] | null, distance?: Point[] | null, flights?: Point[] | null, active?: ActiveEnergyRow[] | null,
 *   basal?: Point[] | null, weight?: SeriesRow[] | null, bodyfat?: SeriesRow[] | null, lean?: SeriesRow[] | null,
 *   waist?: SeriesRow[] | null, workouts?: Workout[] | null, zones?: ZoneRow[] | null, hrHourly?: HrHourlyRow[] | null,
 *   through?: string | null, sex?: string | null}} DetailInputs */
/** One day of the energy series: total = basal + active; `watch` = the raw Watch value of a power-ride day,
 * `uncov` = 1 on an uncovered power-ride day.
 * @typedef {{date: string, value: number, active: number, basal: number, watch: number | undefined, uncov: 1 | null}} EnergyDay */
/** Every daily series the sheet charts (dailySeries).
 * @typedef {{respiratory: Point[], rhr: Point[], hrv: Point[], wristTemp: Point[], walkingHr: Point[], sleep: Point[],
 *   vo2max: Point[], steps: Point[], exercise: Point[], distance: Point[], flights: Point[], energy: EnergyDay[],
 *   weight: Point[], bodyfat: Point[], lean: Point[], waist: Point[]}} DailySeries */
/** A dense series: an ISO `start` and one slot per day (null = no data).
 * @typedef {{start: string, v: (number | null)[]}} Dense */

/** @param {ReadonlyArray<{date: string}> | null | undefined} daily @returns {string | null} */
const lastDate = (daily) => (daily && daily.length ? daily[daily.length - 1].date : null);

/** Sorted [{date, value}] -> {start, v}: one slot per day from the first date >= `from` to the last,
 * null where a day has no value; null when nothing falls inside the window. */
/** @param {ReadonlyArray<{date: string, value?: number | null}> | null | undefined} daily @param {string} from
 * @param {number} dec @returns {Dense | null} */
export function denseSeries(daily, from, dec) {
  const rows = (daily || []).filter((r) => r.date >= from && Number.isFinite(r.value));
  if (!rows.length) return null;
  const start = rows[0].date;
  /** @type {(number | null)[]} */
  const v = new Array(dayDiff(start, rows[rows.length - 1].date) + 1).fill(null);
  for (const r of rows) v[dayDiff(start, r.date)] = roundTo(/** @type {number} */ (r.value), dec);
  return { start, v };
}

// a companion array (bedtime, active energy…) aligned with a dense series' start and length
/**
 * @param {Dense} dense @param {ReadonlyArray<{date: string} & Record<string, unknown>> | null | undefined} rows
 * @param {string} key @param {number} dec @returns {(number | null)[]} */
function alignedTo(dense, rows, key, dec) {
  /** @type {(number | null)[]} */
  const v = new Array(dense.v.length).fill(null);
  for (const r of rows || []) {
    const i = dayDiff(dense.start, r.date);
    if (i >= 0 && i < v.length && Number.isFinite(r[key])) v[i] = roundTo(/** @type {number} */ (r[key]), dec);
  }
  return v;
}

/** Daily totals -> {lo, median, hi} = p25 / p50 / p75 of the TOTAL_BAND_DAYS days before the newest
 * one (the newest day is often partial, so it never sets its own band); null under 14 days. */
/** @param {Point[] | null | undefined} daily @param {number} dec */
export function quartileBand(daily, dec) {
  const last = lastDate(daily);
  if (!last) return null;
  // (a non-null last date means a non-empty series; percentile is null only for an empty list)
  const vals = /** @type {Point[]} */ (daily).filter((r) => { const g = dayDiff(r.date, last); return g >= 1 && g <= TOTAL_BAND_DAYS; }).map((r) => r.value);
  if (vals.length < MIN_BAND_DAYS) return null;
  const pct = (/** @type {number} */ p) => /** @type {number} */ (percentile(vals, p));
  return { lo: roundTo(pct(0.25), dec), median: roundTo(pct(0.5), dec), hi: roundTo(pct(0.75), dec) };
}

/** A session's source for display: the precedence family ("Apple Watch de …" -> "Apple Watch", both
 * Strava rows -> "Strava"), so a device owner's name never reaches the page; other apps keep theirs. */
/** @param {unknown} src @returns {string} */
export function sessionSource(src) {
  const s = typeof src === 'string' ? src.trim() : '';
  const rank = sourceRank(s);
  if (rank >= SOURCE_PRECEDENCE.length) return s;
  return SOURCE_PRECEDENCE[rank].name === 'Strava API' ? 'Strava' : SOURCE_PRECEDENCE[rank].name;
}

/** @param {Workout[]} rows @param {'dist' | 'elev' | 're'} k @returns {number | null} */
const sumOrNull = (rows, k) => rows.reduce((/** @type {number | null} */ acc, r) => (r[k] == null ? acc : (acc ?? 0) + /** @type {number} */ (r[k])), null);

/** One baked session of a day detail (sessionsFromRows); null fields are left out.
 * @typedef {{d: string, m: string, t: string, min: number, km?: number, el?: number, hr?: number, re?: number,
 *   n: number, src: string, z?: number[], hx?: number}} DetailSession */

/** workout-zones.csv rows -> Map(date|modality -> {z: seconds per zone summed, hx: highest max HR}). */
/** @param {ZoneRow[] | null | undefined} zones */
function zonesByDay(zones) {
  /** @type {Map<string, {z: number[], hx: number | null}>} */
  const by = new Map();
  for (const r of zones || []) {
    const k = r.date + '|' + scoreModality(r.type);
    const g = by.get(k) || { z: [0, 0, 0, 0, 0, 0], hx: null };
    // zonesFromLines keeps only rows whose six zones are all numbers
    r.z.forEach((x, i) => { g.z[i] += /** @type {number} */ (x); });
    if (r.hrMax != null && (g.hx == null || r.hrMax > g.hx)) g.hx = r.hrMax;
    by.set(k, g);
  }
  return by;
}

/** readWorkouts() rows -> the sessions a day detail lists: one per date + modality (strength /
 * hybrid / run / bike / other) after the shared DISPLAY rule, fragments summed (minutes, km, elevation, RE),
 * avg HR weighted by the minutes of the fragments that carry it; null fields are left out. With
 * `zones` (readWorkoutZones): `z` = seconds in HR zone 0-5 of that day's Strava activities of the
 * same modality (summed; absent when none or all zero) and `hx` = their highest max HR. */
/** @param {Workout[] | null | undefined} rows @param {string} from @param {ZoneRow[] | null} [zones]
 * @returns {DetailSession[]} */
export function sessionsFromRows(rows, from, zones = null) {
  const zb = zonesByDay(zones);
  return mergeSameDay(rows, byModality, { ...DISPLAY_RULE, dedupeKey: byPhysical })
    .filter((g) => g.date >= from)
    .map(({ date, key, rows: day }) => {
      const longest = day.reduce((a, r) => (r.dur > a.dur ? r : a), day[0]);
      const withHr = day.filter((r) => r.hrAvg != null);
      const hrDur = withHr.reduce((a, r) => a + r.dur, 0);
      const km = sumOrNull(day, 'dist');
      const el = sumOrNull(day, 'elev');
      const re = sumOrNull(day, 're');
      // n / src are set below (after the optional keys: the baked key order)
      const s = /** @type {DetailSession} */ ({ d: date, m: key, t: longest.type, min: Math.round(day.reduce((a, r) => a + r.dur, 0)) });
      if (km != null && km > 0) s.km = roundTo(km, 2);
      if (el != null) s.el = Math.round(el);
      if (hrDur > 0) s.hr = Math.round(withHr.reduce((a, r) => a + /** @type {number} */ (r.hrAvg) * r.dur, 0) / hrDur);
      if (re != null) s.re = Math.round(re);
      s.n = day.length;
      s.src = [...new Set(day.map((r) => sessionSource(r.source)))].filter(Boolean).join(' + ');
      const zz = zb.get(date + '|' + key);
      if (zz && zz.z.some((x) => x > 0)) {
        s.z = zz.z.map(Math.round);
        if (zz.hx != null) s.hx = Math.round(zz.hx);
      }
      return s;
    });
}

/** Recovery for every day of [from, to]: the composite recoveryFromInputs gave as "last night" with
 * the inputs cut at that day (its own baseline), and that day's 7-day trend. A day that was not a
 * complete night (or is gated) is null. null when no day has either. */
/** @param {{hrv?: Reading[], rhr?: Reading[], sleep?: SleepRow[]}} inputs @param {string} from @param {string} to */
export function rollingRecovery({ hrv = [], rhr = [], sleep = [] } = {}, from, to) {
  const all = [...hrv, ...rhr, ...sleep].map((r) => r.date).filter(Boolean).sort();
  if (!all.length) return null;
  const first = all[0] > from ? all[0] : from;
  const n = dayDiff(first, to) + 1;
  if (n <= 0) return null;
  /** @type {(number | null)[]} */
  const v = new Array(n).fill(null);
  /** @type {(number | null)[]} */
  const t7 = new Array(n).fill(null);
  /** @template {{date: string}} T @param {T[]} rows @param {string} lo @param {string} t @returns {T[]} */
  const win = (rows, lo, t) => rows.filter((r) => r.date >= lo && r.date <= t);
  for (let i = 0; i < n; i++) {
    const t = addDays(first, i);
    const lo = addDays(t, -RECOVERY_LOOKBACK_DAYS);
    const r = recoveryFromInputs({ hrv: win(hrv, lo, t), rhr: win(rhr, lo, t), sleep: win(sleep, lo, t) });
    if (r.gated || r.asOf !== t) continue;
    if (r.today && r.today.date === t) v[i] = r.today.value;
    t7[i] = r.trend7;
  }
  if (v.every((x) => x == null) && t7.every((x) => x == null)) return null;
  return { start: first, v, t7 };
}

/** The recovery dial's headline (web/src/view/dial.mjs recoveryDial, without geometry) from the SAME
 * recoveryFromInputs result: last night's composite cut at DAY_BAND_CUTOFF (mode "today"), else the
 * 7-day trend (mode "trend"); the trend always rides along. null when gated. */
/** @param {ReturnType<typeof recoveryFromInputs> | null | undefined} R */
function recoveryHead(R) {
  if (!R || R.gated || !Number.isFinite(R.trend7)) return null;
  const today = R.today && Number.isFinite(R.today.value) ? R.today : null;
  const trend = { value: R.trend7, band: R.band, dir: R.trendDir || null };
  if (!today) return { mode: 'trend', date: null, value: R.trend7, band: R.band, sleep: null, trend };
  return { mode: 'today', date: today.date, value: today.value, band: today.band, sleep: today.sleep !== false, trend };
}

/** The load dial's gate for one loadFromSeries modality: null (scored) | the trend's reason | 'fewDays'. */
/** @typedef {ReturnType<typeof loadFromSeries>['modalities'][number]} LoadModality */
/** @param {LoadModality} mod */
function loadGate(mod) {
  const t = /** @type {Partial<import('../score/training-load.mjs').LoadTrend>} */ (mod.trend || {});
  if (!t.ok || !Number.isFinite(t.trendPct)) return t.reason || 'baselineBuilding';
  // (a null typical value compares false, as `null > 0`)
  return mod.typical && /** @type {number} */ (mod.typical.value) > 0 ? null : 'fewDays';
}

/**
 * @param {Record<string, DetailMetric>} out @param {string} key @param {{kind: string, dir: number, dec: number} & Record<string, unknown>} meta
 * @param {Dense | null} dense @param {Record<string, unknown>} [extra] */
const put = (out, key, meta, dense, extra = {}) => { if (dense) out[key] = { ...meta, ...dense, ...extra }; };
/** @template {object} T @param {T} o @returns {T} (its null / undefined fields dropped) */
const clean = (o) => /** @type {any} */ (Object.fromEntries(Object.entries(o).filter(([, x]) => x != null)));

/** @template T @param {T[] | null | undefined} a @returns {T[] | null} */
const arrOf = (a) => (Array.isArray(a) && a.length ? a : null);

/** Every daily series the sheet charts, from the readExtract inputs (missing input = []). */
/** @param {DetailInputs} I @returns {DailySeries} */
function dailySeries(I) {
  const arr = arrOf;
  /** @type {Partial<DailySeries>} */
  const daily = {};
  for (const k of /** @type {const} */ (['respiratory', 'rhr', 'hrv', 'wristTemp', 'walkingHr'])) daily[k] = arr(I[k]) ? signalDaily(k, I[k]) : [];
  daily.sleep = arr(I.sleep) ? signalDaily('sleep', /** @type {SleepRow[]} */ (I.sleep).map((s) => ({ date: s.date, value: s.value }))) : [];
  daily.vo2max = arr(I.vo2max) ? vo2maxDaily(I.vo2max) : [];
  /** @param {Point[] | null | undefined} rows @param {number} [floor] @returns {Point[]} */
  const total = (rows, floor = 0) => (arr(rows) ? byDayMean(/** @type {Point[]} */ (rows)).filter((r) => r.value >= floor) : []);
  daily.steps = total(I.steps, STEP_FLOOR);
  daily.exercise = total(I.exercise);
  daily.distance = total(I.distance, DIST_FLOOR);
  daily.flights = total(I.flights);
  const act = new Map(total(I.active).map((r) => [r.date, r.value]));
  /** @param {string} d (a day with active energy: basal is filtered on act.has) */
  const actOf = (d) => /** @type {number} */ (act.get(d));
  // a day missing active OR basal energy is missing, never basal alone (same rule as aggEnergy)
  const basal = total(I.basal).filter((r) => r.value >= BASAL_LO && r.value <= BASAL_HI && act.has(r.date));
  // a power-meter ride day carries the raw Watch value aside (lib/health/ride-energy.mjs)
  const watch = new Map((arr(I.active) || []).filter((r) => r.watch != null).map((r) => [r.date, r.watch]));
  // ...and a power-ride day the hourly Watch data did not cover is flagged (uncov = 1)
  const uncov = new Set((arr(I.active) || []).filter((r) => r.uncovered).map((r) => r.date));
  daily.energy = basal.map((r) => ({ date: r.date, value: r.value + actOf(r.date), active: actOf(r.date), basal: r.value, watch: watch.get(r.date), uncov: uncov.has(r.date) ? 1 : null }));
  daily.weight = arr(I.weight) ? byDayMean(/** @type {SeriesRow[]} */ (I.weight)) : [];
  // bioimpedance: the latest scale only, and only its last BODYCOMP_WINDOW days (the Salud card's
  // window: the source tag alone does not isolate a scale switch)
  /** @param {SeriesRow[] | null | undefined} rows @returns {Point[]} */
  const latestSource = (rows) => {
    if (!arr(rows)) return [];
    const src = /** @type {SeriesRow[]} */ (rows)[/** @type {SeriesRow[]} */ (rows).length - 1].source;
    const same = byDayMean(/** @type {SeriesRow[]} */ (rows).filter((r) => r.source === src));
    // non-empty (it holds the newest row), so its last date is a string
    const newest = /** @type {string} */ (lastDate(same));
    return same.filter((r) => dayDiff(r.date, newest) < BODYCOMP_WINDOW);
  };
  daily.bodyfat = latestSource(I.bodyfat);
  daily.lean = latestSource(I.lean);
  daily.waist = arr(I.waist) ? byDayMean(/** @type {SeriesRow[]} */ (I.waist)) : [];
  return /** @type {DailySeries} */ (daily);
}

/** The sleep metric: hours per night with bed / wake, performance, efficiency, consistency and the stage
 * hours (a stage array no night has, older extracts, is left out); null without a night in the window. */
/** @param {DetailInputs} I @param {DailySeries} daily @param {string} from @param {string} asOf */
function sleepMetric(I, daily, from, asOf) {
  const sleepDense = denseSeries(daily.sleep, from, 2);
  if (!sleepDense) return null;
  // a sleep night in the window means I.sleep has rows
  const sleepRows = /** @type {SleepRow[]} */ (I.sleep);
  const rows = sleepRows.filter((s) => s.date >= sleepDense.start);
  // per night (lib/score/sleep.mjs): performance % of the target, efficiency %, consistency minutes
  const perNight = rows.map((r) => ({ date: r.date, perf: sleepPerformance(r.value, SLEEP_TARGET), eff: sleepEfficiency(r.value, r.inbed) }));
  const cons = sleepConsistency(sleepRows, asOf).filter((c) => c.date >= sleepDense.start);
  /** @param {(number | null)[]} a */
  const some = (a) => (a.some((x) => x != null) ? a : null);
  const st = Object.fromEntries(['rem', 'deep', 'core', 'awake', 'inbed'].map((k) => [k, some(alignedTo(sleepDense, rows, k, 2))]));
  return clean({ kind: 'sleep', dir: 1, dec: 2, target: SLEEP_TARGET, band: signalBand(daily.sleep, monitorDef('sleep')), ...sleepDense,
    bed: alignedTo(sleepDense, rows, 'bedtime', 2), wake: alignedTo(sleepDense, rows, 'waketime', 2),
    perf: some(alignedTo(sleepDense, perNight, 'perf', 0)), eff: some(alignedTo(sleepDense, perNight, 'eff', 0)),
    cons: some(alignedTo(sleepDense, cons, 'value', 0)), ...st,
    // 1 = an estimated (in-bed-only) night; left out when no night in the window is one
    est: some(alignedTo(sleepDense, rows.map((r) => ({ date: r.date, est: r.estimated ? 1 : null })), 'est', 0)) });
}

/** Total energy per day with its active / basal split, the 7-day mean and, when any day has them, the raw
 * Watch value of a power-meter ride day and the uncovered flag; null without a day in the window. */
/** @param {DailySeries} daily @param {string} from */
function energyMetric(daily, from) {
  const eDense = denseSeries(daily.energy, from, 0);
  if (!eDense) return null;
  /** @type {DetailMetric} */
  const out = clean({ kind: 'total', dir: 0, dec: 0, band: quartileBand(daily.energy, 0), ...eDense,
    active: alignedTo(eDense, daily.energy, 'active', 0), basal: alignedTo(eDense, daily.energy, 'basal', 0),
    roll: alignedTo(eDense, rollAvg(daily.energy, 7), 'value', 0) });
  const w = alignedTo(eDense, daily.energy, 'watch', 0);
  if (w.some((x) => x != null)) out.watch = w;
  const u = alignedTo(eDense, daily.energy, 'uncov', 0);
  if (u.some((x) => x != null)) out.uncov = u;
  return out;
}

/** Session minutes per day; a day without a session between the first session and asOf (the newest data of
 * any kind) is rest: 0 minutes, not missing data (the client stops at the viewer's today). */
/** @param {Map<string, number>} minutes @param {string} from @param {string} asOf */
function workoutsMetric(minutes, from, asOf) {
  if (!minutes.size) return null;
  const dense = denseSeries([...minutes.keys()].sort().map((d) => ({ date: d, value: minutes.get(d) })), from, 0);
  if (!dense) return null;
  const v = new Array(dayDiff(dense.start, asOf) + 1).fill(0);
  dense.v.forEach((x, i) => { if (x != null) v[i] = x; });
  return { kind: 'workouts', dir: 0, dec: 0, levels: [...LEVEL_MIN], start: dense.start, v };
}

/** Gym minutes per day (strength + hybrid: weights, HIIT, functional, other), from the same-day merged
 * sessions; a day without a gym session between the first one and asOf is 0, not missing. */
/** @param {{date: string, rows: Workout[]}[]} groups @param {string} from @param {string} asOf */
function gymMetric(groups, from, asOf) {
  /** @type {Map<string, number>} */
  const min = new Map();
  for (const g of groups) {
    const gym = g.rows.filter((r) => isGymModality(scoreModality(r.type)));
    if (gym.length) min.set(g.date, (min.get(g.date) || 0) + gym.reduce((a, r) => a + r.dur, 0));
  }
  if (!min.size) return null;
  const dense = denseSeries([...min.keys()].sort().map((d) => ({ date: d, value: min.get(d) })), from, 0);
  if (!dense) return null;
  const v = new Array(dayDiff(dense.start, asOf) + 1).fill(0);
  dense.v.forEach((x, i) => { if (x != null) v[i] = x; });
  return { kind: 'total', dir: 1, dec: 0, week: true, start: dense.start, v };
}

/** One load metric per modality with sessions in the window (lib/score/training-load.mjs, the Inicio dial's own). */
/** @param {NonNullable<ReturnType<typeof modalitySeries>>} load @param {string} from @param {Record<string, DetailMetric>} metrics */
function loadMetrics(load, from, metrics) {
  const dial = new Map(loadFromSeries(load).modalities.map((x) => [x.key, x]));
  for (const m of LOAD_MODALITIES) {
    const days = load.byModality[m] || [];
    const inWin = days.filter((d) => d.date >= from);
    if (!inWin.length || !days.some((d) => d.load > 0 || d.unscored)) continue;
    const typical = typicalDay(days).value;
    // calendar shades: any RE, then half / one / one and a half typical days (one shade without a typical day)
    const levels = typical != null ? [1, ...LOAD_LEVEL_RATIOS.map((r) => roundTo(r * typical, 1))] : [1];
    // loadFromSeries scores every LOAD_MODALITIES key
    const mod = /** @type {LoadModality} */ (dial.get(m));
    metrics['load-' + m] = { kind: 'load', dir: 0, dec: 1, typical, levels, gate: loadGate(mod), last: mod.last,
      start: inWin[0].date, v: inWin.map((d) => (d.unscored ? null : roundTo(d.load, 1))) };
  }
}

/** One DETAIL metric: an ISO `start` + one `v` slot per calendar day (null = no data), its kind, direction
 * (1 = higher is better, -1 = lower, 0 = neither) and decimals, plus what its kind adds (a band, levels, a
 * rolling line, the dial's gate…).
 * @typedef {{kind: string, dir: number, dec: number, start: string, v: (number | null)[]} & Record<string, any>} DetailMetric */
/** The DETAIL bake: `asOf` is null (and `metrics` empty) without any data; `habits` / `zoneMax` only when known.
 * @typedef {{asOf: string | null, days: number, metrics: Record<string, DetailMetric>,
 *   sessions: ReturnType<typeof sessionsFromRows>, habits?: ReturnType<typeof healthspanFrom>,
 *   zoneMax?: {hr: number, src: string | null}}} DetailBake */

/** Parsed inputs (any may be absent) -> the DETAIL bake.
 * @param {DetailInputs} [I]
 * @returns {DetailBake} */
export function detailFromInputs(I = {}) {
  const arr = arrOf;
  const daily = dailySeries(I);
  const workouts = /** @type {Workout[]} */ (arr(I.workouts) || []);
  const groups = mergeSameDay(workouts, byModality, { ...DISPLAY_RULE, dedupeKey: byPhysical });
  /** @type {Map<string, number>} */
  const minutes = new Map();
  for (const g of groups) minutes.set(g.date, (minutes.get(g.date) || 0) + g.rows.reduce((a, r) => a + r.dur, 0));
  const load = workouts.length ? modalitySeries(workouts, { through: I.through || null }) : null;

  const lasts = /** @type {string[]} */ ([...Object.values(daily).map(lastDate), groups.length ? groups[groups.length - 1].date : null,
    ...[I.hrv, I.rhr, I.sleep].map((a) => (a && arr(a) ? a.map((r) => r.date).sort().pop() : null))].filter(Boolean)).sort();
  if (!lasts.length) return { asOf: null, days: DETAIL_DAYS, metrics: {}, sessions: [] };
  const asOf = lasts[lasts.length - 1];
  const from = addDays(asOf, -(DETAIL_DAYS - 1));

  /** @type {Record<string, DetailMetric>} */
  const metrics = {};
  /** @param {keyof DailySeries} key @param {number} dir @param {number} dec @param {unknown} band */
  const sig = (key, dir, dec, band) => put(metrics, key, clean({ kind: 'signal', dir, dec, band }), denseSeries(daily[key], from, dec));
  const sleep = sleepMetric(I, daily, from, asOf);
  if (sleep) metrics.sleep = sleep;
  const rec = rollingRecovery({ hrv: arr(I.hrv) || [], rhr: arr(I.rhr) || [], sleep: arr(I.sleep) || [] }, from, asOf);
  if (rec) {
    const head = recoveryHead(recoveryFromInputs({ hrv: arr(I.hrv) || [], rhr: arr(I.rhr) || [], sleep: arr(I.sleep) || [] }));
    metrics.recovery = clean({ kind: 'recovery', dir: 1, dec: 2, cut: DAY_BAND_CUTOFF, cutTrend: BAND_CUTOFF, head, ...rec });
  }
  for (const [k, dir] of /** @type {['hrv' | 'rhr' | 'respiratory' | 'wristTemp', number][]} */ ([['hrv', 1], ['rhr', -1], ['respiratory', 0], ['wristTemp', 0]])) sig(k, dir, monitorDef(k).dec, signalBand(daily[k], monitorDef(k)));
  sig('walkingHr', -1, 0, signalBand(daily.walkingHr, monitorDef('walkingHr')));
  put(metrics, 'vo2max', { kind: 'sparse', dir: 1, dec: 1 }, denseSeries(daily.vo2max, from, 1));
  // fitness age (lib/score/fitness-age.mjs) of each VO2max day, only with the profile's sex; lo / hi =
  // the clamp bounds of the reference curve (a value there means "that age or beyond")
  const ref = /** @type {Record<string, number[][] | undefined>} */ (FITNESS_AGE_REF)[/** @type {string} */ (I.sex)];
  if (ref) {
    const ages = daily.vo2max.map((r) => ({ date: r.date, value: (fitnessAge(r.value, I.sex) || {}).age }));
    put(metrics, 'fitnessAge', { kind: 'sparse', dir: -1, dec: 1, lo: ref[0][0], hi: ref[ref.length - 1][0] }, denseSeries(ages, from, 1));
  }
  for (const [k, dec] of /** @type {['steps' | 'exercise' | 'distance' | 'flights', number][]} */ ([['steps', 0], ['exercise', 0], ['distance', 1], ['flights', 0]])) {
    put(metrics, k, clean({ kind: 'total', dir: 1, dec, band: quartileBand(daily[k], dec) }), denseSeries(daily[k], from, dec));
  }
  const energy = energyMetric(daily, from);
  if (energy) metrics.energy = energy;
  const wDense = denseSeries(daily.weight, from, 1);
  if (wDense) {
    const weight = /** @type {SeriesRow[]} */ (I.weight); // a weight day in the window: rows exist
    const raw = weight[weight.length - 1];
    metrics.weight = { kind: 'sparse', dir: 0, dec: 1, ...wDense, roll: alignedTo(wDense, rollAvg(daily.weight, 7), 'value', 1),
      latest: { date: raw.date, value: roundTo(raw.value, 1) } };
  }
  for (const k of /** @type {const} */ (['bodyfat', 'lean'])) put(metrics, k, { kind: 'sparse', dir: 0, dec: 1, windowDays: BODYCOMP_WINDOW }, denseSeries(daily[k], from, 1));
  put(metrics, 'waist', { kind: 'sparse', dir: 0, dec: 1 }, denseSeries(daily.waist, from, 1));
  const wk = workoutsMetric(minutes, from, asOf);
  if (wk) metrics.workouts = wk;
  if (load && load.reEpoch) loadMetrics(load, from, metrics);
  const zones = arr(I.zones) || null;
  // day strain 0-21: the same bake as the Inicio dial (one K for every day), days with all-day HR only
  const st = arr(I.hrHourly) ? strainFromInputs({ hourly: I.hrHourly, zones }) : null;
  if (st && st.ok) put(metrics, 'strain', { kind: 'strain', dir: 0, dec: 1, levels: [...STRAIN_LEVELS] }, denseSeries(st.all, from, 1));
  // weekly metrics (`week`: My dashboard shows their 7-day total): minutes in HR zones 1-3 / 4-5 per day
  // with all-day HR (lib/score/strain.mjs zoneMinutes), and gym minutes per day
  const zm = arr(I.hrHourly) ? zoneMinutes({ hourly: I.hrHourly, zones }) : null;
  if (zm && zm.length) {
    put(metrics, 'zones13', { kind: 'total', dir: 1, dec: 0, week: true }, denseSeries(zm.map((d) => ({ date: d.date, value: d.z13 })), from, 0));
    put(metrics, 'zones45', { kind: 'total', dir: 1, dec: 0, week: true }, denseSeries(zm.map((d) => ({ date: d.date, value: d.z45 })), from, 0));
  }
  const gym = gymMetric(groups, from, asOf);
  if (gym) metrics.gymTime = gym;
  /** @type {DetailBake} */
  const out = { asOf, days: DETAIL_DAYS, metrics, sessions: sessionsFromRows(workouts, from, zones) };
  // Salud's healthspan habits (lib/score/healthspan.mjs): the last 28 full days of each habit
  const habits = healthspanFrom({
    sleep: arr(I.sleep), steps: daily.steps, rhr: daily.rhr, cons: sleepConsistency(arr(I.sleep) || []),
    zoneDays: zm ? zm.map((d) => ({ date: d.date, z: d.z })) : null, workouts, asOf,
  });
  if (habits) out.habits = habits;
  // the max HR the zones were cut with (every row of one sync shares it) and its source, for the ⓘ
  // zonesFromLines keeps only rows with maxHr > 0
  if (zones) out.zoneMax = { hr: /** @type {number} */ (zones[zones.length - 1].maxHr), src: zones[zones.length - 1].maxSrc };
  return out;
}

/** readExtract inputs -> the DETAIL bake: a thin mapper onto detailFromInputs. opts.sex = the profile's sex
 * ('male' | 'female' | null): the fitness-age series needs it.
 * @param {import('../health/aggregate.mjs').HealthInputs & {workouts: Workout[] | null, zones: ZoneRow[] | null,
 *   hrHourly: HrHourlyRow[] | null}} I
 * @param {{sex?: string | null}} [opts]
 * @returns {DetailBake} */
export function detailFrom(I, { sex = null } = {}) {
  const s = I.series;
  return detailFromInputs({
    sleep: I.sleep, hrv: s.hrv, rhr: s.rhr, respiratory: s.respiratory,
    wristTemp: s.wristTemp, walkingHr: s.walkingHr, vo2max: s.vo2max,
    steps: s.steps, exercise: s.exercise, distance: s.distance, flights: s.flights,
    active: I.activeEnergy, basal: s.basal,
    weight: s.weight, bodyfat: s.bodyfat, lean: s.leanmass, waist: s.waist,
    workouts: I.workouts, zones: I.zones, hrHourly: I.hrHourly,
    // the load series runs through the rest days, like the Scores' (lib/training/through.mjs)
    through: trainingThrough(I),
    sex,
  });
}
