/* Detail views bake (DETAIL): compact daily series of the last DETAIL_DAYS (365) days per metric, for
 * the full-screen detail sheet a tap on any card opens (web/src/client/detail.js). One shared global:
 * metrics keyed by name, each an ISO `start` + a `v` array (one slot per calendar day, null = no
 * data that day, never 0), rounded to the card's precision.
 *
 * Every series comes from the SAME readers and rules as its card, so the sheet and the card never
 * disagree: HRV / resting HR / respiratory / wrist temp / sleep = the monitor's clamped day median
 * (lib/score/monitor.mjs monitorDaily, partial newest HRV day dropped) with the monitor's personal band;
 * walking HR = day mean (signalTrend) with the same kind of band; steps / exercise / distance / flights
 * = the extract's max-per-device daily totals with the Salud floors (a near-zero step day = device not
 * carried = missing); energy = basal (sane band) + active, like the expenditure card; body fat / lean
 * mass = the most recent scale only; workouts = the shared same-day rule (lib/training/sessions.mjs
 * DISPLAY_RULE for the session list and minutes, the load rule for Relative Effort per modality);
 * recovery = the composite the dial showed each morning (recoveryFromInputs with the inputs cut at that
 * day, so an old day is scored against the baseline it had then, not today's).
 *
 * Anchored to the newest data date (asOf), never the build clock: builds stay byte-identical and the
 * client decides the viewer's today. */
import { readSeries, readSleep, readWorkouts } from '../health/read.mjs';
import { byDayMean, addDays, roundTo } from '../health/stats.mjs';
import { SLEEP_TARGET, BASAL_LO, BASAL_HI, STEP_FLOOR, DIST_FLOOR } from '../health/aggregate.mjs';
import { monitorDaily, monitorDef, signalBand } from '../score/monitor.mjs';
import { recoveryFromInputs, DAY_BAND_CUTOFF, BAND_CUTOFF, BASELINE_DAYS } from '../score/recovery.mjs';
import { modalitySeries } from '../score/series.mjs';
import { typicalDay, percentile } from '../score/load.mjs';
import { scoreModality } from '../score/modality.mjs';
import { mergeSameDay, DISPLAY_RULE, sourceRank, SOURCE_PRECEDENCE } from '../training/sessions.mjs';
import { LEVEL_MIN } from '../training/activity.mjs';

// One year of history: long enough for a season, small enough to bake into the page (~20 series).
export const DETAIL_DAYS = 365;
// Daily totals are judged against the middle half of the owner's own days over roughly a quarter:
// long enough to be stable, short enough to follow a change of routine.
export const TOTAL_BAND_DAYS = 90;
// Fewer logged days than two weeks and the quartiles hang on a handful of days.
const MIN_BAND_DAYS = 14;
// Recovery needs its 42-day baseline plus the 14 + 6 days of trend before the scored day, and
// completeDay() looks 42 days back: 70 days of input are enough to reproduce any one morning.
const RECOVERY_LOOKBACK_DAYS = BASELINE_DAYS + 28;
// Walking HR has no monitor card: its band uses resting HR's MAD floor (1 bpm) and decimals.
const WALKING_HR_DEF = Object.freeze({ floor: 1, dec: 0 });

export const DETAIL_KEYS = Object.freeze([
  'sleep', 'recovery', 'hrv', 'rhr', 'respiratory', 'wristTemp', 'walkingHr', 'vo2max',
  'steps', 'exercise', 'distance', 'flights', 'energy', 'weight', 'bodyfat', 'lean', 'waist',
  'workouts', 'load-gym', 'load-run', 'load-bike',
]);
const LOAD_MODALITIES = ['gym', 'run', 'bike'];
// Load calendar shades relative to the modality's typical training day (the load dial's midpoint).
const LOAD_LEVEL_RATIOS = [0.5, 1, 1.5];

const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const lastDate = (daily) => (daily && daily.length ? daily[daily.length - 1].date : null);

/** Sorted [{date, value}] -> {start, v}: one slot per day from the first date >= `from` to the last,
 * null where a day has no value; null when nothing falls inside the window. */
export function denseSeries(daily, from, dec) {
  const rows = (daily || []).filter((r) => r.date >= from && Number.isFinite(r.value));
  if (!rows.length) return null;
  const start = rows[0].date;
  const v = new Array(dayDiff(start, rows[rows.length - 1].date) + 1).fill(null);
  for (const r of rows) v[dayDiff(start, r.date)] = roundTo(r.value, dec);
  return { start, v };
}

// a companion array (bedtime, active energy…) aligned with a dense series' start and length
function alignedTo(dense, rows, key, dec) {
  const v = new Array(dense.v.length).fill(null);
  for (const r of rows || []) {
    const i = dayDiff(dense.start, r.date);
    if (i >= 0 && i < v.length && Number.isFinite(r[key])) v[i] = roundTo(r[key], dec);
  }
  return v;
}

/** Daily totals -> {lo, median, hi} = p25 / p50 / p75 of the TOTAL_BAND_DAYS days before the newest
 * one (the newest day is often partial, so it never sets its own band); null under 14 days. */
export function quartileBand(daily, dec) {
  const last = lastDate(daily);
  if (!last) return null;
  const vals = daily.filter((r) => { const g = dayDiff(r.date, last); return g >= 1 && g <= TOTAL_BAND_DAYS; }).map((r) => r.value);
  if (vals.length < MIN_BAND_DAYS) return null;
  return { lo: roundTo(percentile(vals, 0.25), dec), median: roundTo(percentile(vals, 0.5), dec), hi: roundTo(percentile(vals, 0.75), dec) };
}

/** A session's source for display: the precedence family ("Apple Watch de …" -> "Apple Watch", both
 * Strava rows -> "Strava"), so a device owner's name never reaches the page; other apps keep theirs. */
export function sessionSource(src) {
  const s = typeof src === 'string' ? src.trim() : '';
  const rank = sourceRank(s);
  if (rank >= SOURCE_PRECEDENCE.length) return s;
  return SOURCE_PRECEDENCE[rank].name === 'Strava API' ? 'Strava' : SOURCE_PRECEDENCE[rank].name;
}

const sumOrNull = (rows, k) => rows.reduce((acc, r) => (r[k] == null ? acc : (acc ?? 0) + r[k]), null);

/** readWorkouts() rows -> the sessions a day detail lists: one per date + modality (Inicio's gym /
 * run / bike / other) after the shared DISPLAY rule, fragments summed (minutes, km, elevation, RE),
 * avg HR weighted by the minutes of the fragments that carry it; null fields are left out. */
export function sessionsFromRows(rows, from) {
  return mergeSameDay(rows, (r) => scoreModality(r.type), DISPLAY_RULE)
    .filter((g) => g.date >= from)
    .map(({ date, key, rows: day }) => {
      const longest = day.reduce((a, r) => (r.dur > a.dur ? r : a), day[0]);
      const withHr = day.filter((r) => r.hrAvg != null);
      const hrDur = withHr.reduce((a, r) => a + r.dur, 0);
      const km = sumOrNull(day, 'dist');
      const el = sumOrNull(day, 'elev');
      const re = sumOrNull(day, 're');
      const s = { d: date, m: key, t: longest.type, min: Math.round(day.reduce((a, r) => a + r.dur, 0)) };
      if (km != null && km > 0) s.km = roundTo(km, 2);
      if (el != null) s.el = Math.round(el);
      if (hrDur > 0) s.hr = Math.round(withHr.reduce((a, r) => a + r.hrAvg * r.dur, 0) / hrDur);
      if (re != null) s.re = Math.round(re);
      s.n = day.length;
      s.src = [...new Set(day.map((r) => sessionSource(r.source)))].filter(Boolean).join(' + ');
      return s;
    });
}

/** Recovery for every day of [from, to]: the composite recoveryFromInputs gave as "last night" with
 * the inputs cut at that day (its own baseline), and that day's 7-day trend. A day that was not a
 * complete night (or is gated) is null. null when no day has either. */
export function rollingRecovery({ hrv = [], rhr = [], sleep = [] } = {}, from, to) {
  const all = [...hrv, ...rhr, ...sleep].map((r) => r.date).filter(Boolean).sort();
  if (!all.length) return null;
  const first = all[0] > from ? all[0] : from;
  const n = dayDiff(first, to) + 1;
  if (n <= 0) return null;
  const v = new Array(n).fill(null);
  const t7 = new Array(n).fill(null);
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

const put = (out, key, meta, dense, extra = {}) => { if (dense) out[key] = { ...meta, ...dense, ...extra }; };
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x != null));

/** Parsed inputs (any may be absent) -> the DETAIL bake. */
export function detailFromInputs(I = {}) {
  const arr = (a) => (Array.isArray(a) && a.length ? a : null);
  const daily = {};
  for (const k of ['respiratory', 'rhr', 'hrv', 'wristTemp']) daily[k] = arr(I[k]) ? monitorDaily(k, I[k]) : [];
  daily.sleep = arr(I.sleep) ? monitorDaily('sleep', I.sleep.map((s) => ({ date: s.date, value: s.value }))) : [];
  daily.walkingHr = arr(I.walkingHr) ? byDayMean(I.walkingHr) : [];
  daily.vo2max = arr(I.vo2max) ? byDayMean(I.vo2max) : [];
  const total = (rows, floor = 0) => (arr(rows) ? byDayMean(rows).filter((r) => r.value >= floor) : []);
  daily.steps = total(I.steps, STEP_FLOOR);
  daily.exercise = total(I.exercise);
  daily.distance = total(I.distance, DIST_FLOOR);
  daily.flights = total(I.flights);
  const act = new Map(total(I.active).map((r) => [r.date, r.value]));
  const basal = total(I.basal).filter((r) => r.value >= BASAL_LO && r.value <= BASAL_HI);
  daily.energy = basal.map((r) => ({ date: r.date, value: r.value + (act.get(r.date) || 0), active: act.get(r.date) ?? null, basal: r.value }));
  daily.weight = arr(I.weight) ? byDayMean(I.weight) : [];
  const latestSource = (rows) => {
    if (!arr(rows)) return [];
    const src = rows[rows.length - 1].source;
    return byDayMean(rows.filter((r) => r.source === src));
  };
  daily.bodyfat = latestSource(I.bodyfat);
  daily.lean = latestSource(I.lean);
  daily.waist = arr(I.waist) ? byDayMean(I.waist) : [];

  const workouts = arr(I.workouts) || [];
  const groups = mergeSameDay(workouts, (r) => scoreModality(r.type), DISPLAY_RULE);
  const minutes = new Map();
  for (const g of groups) minutes.set(g.date, (minutes.get(g.date) || 0) + g.rows.reduce((a, r) => a + r.dur, 0));
  const load = workouts.length ? modalitySeries(workouts) : null;

  const lasts = [...Object.values(daily).map(lastDate), groups.length ? groups[groups.length - 1].date : null,
    ...[I.hrv, I.rhr, I.sleep].map((a) => (arr(a) ? a.map((r) => r.date).sort().pop() : null))].filter(Boolean).sort();
  if (!lasts.length) return { asOf: null, days: DETAIL_DAYS, metrics: {}, sessions: [] };
  const asOf = lasts[lasts.length - 1];
  const from = addDays(asOf, -(DETAIL_DAYS - 1));

  const metrics = {};
  const sig = (key, dir, dec, band) => put(metrics, key, clean({ kind: 'signal', dir, dec, band }), denseSeries(daily[key], from, dec));
  const sleepDense = denseSeries(daily.sleep, from, 2);
  if (sleepDense) {
    const rows = I.sleep.filter((s) => s.date >= sleepDense.start);
    metrics.sleep = clean({ kind: 'sleep', dir: 1, dec: 2, target: SLEEP_TARGET, band: signalBand(daily.sleep, monitorDef('sleep')), ...sleepDense,
      bed: alignedTo(sleepDense, rows, 'bedtime', 2), wake: alignedTo(sleepDense, rows, 'waketime', 2) });
  }
  const rec = rollingRecovery({ hrv: arr(I.hrv) || [], rhr: arr(I.rhr) || [], sleep: arr(I.sleep) || [] }, from, asOf);
  if (rec) metrics.recovery = { kind: 'recovery', dir: 1, dec: 2, cut: DAY_BAND_CUTOFF, cutTrend: BAND_CUTOFF, ...rec };
  for (const [k, dir] of [['hrv', 1], ['rhr', -1], ['respiratory', 0], ['wristTemp', 0]]) sig(k, dir, monitorDef(k).dec, signalBand(daily[k], monitorDef(k)));
  sig('walkingHr', -1, 0, signalBand(daily.walkingHr, WALKING_HR_DEF));
  put(metrics, 'vo2max', { kind: 'sparse', dir: 1, dec: 1 }, denseSeries(daily.vo2max, from, 1));
  for (const [k, dec] of [['steps', 0], ['exercise', 0], ['distance', 1], ['flights', 0]]) {
    put(metrics, k, clean({ kind: 'total', dir: 1, dec, band: quartileBand(daily[k], dec) }), denseSeries(daily[k], from, dec));
  }
  const eDense = denseSeries(daily.energy, from, 0);
  if (eDense) {
    metrics.energy = clean({ kind: 'total', dir: 0, dec: 0, band: quartileBand(daily.energy, 0), ...eDense,
      active: alignedTo(eDense, daily.energy, 'active', 0), basal: alignedTo(eDense, daily.energy, 'basal', 0) });
  }
  for (const k of ['weight', 'bodyfat', 'lean', 'waist']) put(metrics, k, { kind: 'sparse', dir: 0, dec: 1 }, denseSeries(daily[k], from, 1));

  if (minutes.size) {
    // a day between two session days had no session: 0 minutes (rest), not missing data
    const dense = denseSeries([...minutes.keys()].sort().map((d) => ({ date: d, value: minutes.get(d) })), from, 0);
    if (dense) metrics.workouts = { kind: 'workouts', dir: 0, dec: 0, levels: [...LEVEL_MIN], ...dense, v: dense.v.map((x) => x ?? 0) };
  }
  if (load && load.reEpoch) {
    for (const m of LOAD_MODALITIES) {
      const days = load.byModality[m] || [];
      const inWin = days.filter((d) => d.date >= from);
      if (!inWin.length || !days.some((d) => d.load > 0 || d.unscored)) continue;
      const typical = typicalDay(days).value;
      // calendar shades: any RE, then half / one / one and a half typical days (one shade without a typical day)
      const levels = typical != null ? [1, ...LOAD_LEVEL_RATIOS.map((r) => roundTo(r * typical, 1))] : [1];
      metrics['load-' + m] = { kind: 'load', dir: 0, dec: 1, typical, levels, start: inWin[0].date, v: inWin.map((d) => (d.unscored ? null : roundTo(d.load, 1))) };
    }
  }
  return { asOf, days: DETAIL_DAYS, metrics, sessions: sessionsFromRows(workouts, from) };
}

export function buildDetail(extractDir) {
  if (!extractDir) return detailFromInputs({});
  const s = (name) => readSeries(extractDir, name);
  return detailFromInputs({
    sleep: readSleep(extractDir), hrv: s('hrv.csv'), rhr: s('rhr.csv'), respiratory: s('respiratory-daily.csv'),
    wristTemp: s('wristTemp.csv'), walkingHr: s('walking-hr-daily.csv'), vo2max: s('vo2max.csv'),
    steps: s('steps-daily.csv'), exercise: s('exercise-minutes-daily.csv'), distance: s('distance-daily.csv'), flights: s('flights-daily.csv'),
    active: s('active-energy-daily.csv'), basal: s('basal-energy-daily.csv'),
    weight: s('weight.csv'), bodyfat: s('bodyfat.csv'), lean: s('leanmass.csv'), waist: s('waist.csv'),
    workouts: readWorkouts(extractDir),
  });
}
