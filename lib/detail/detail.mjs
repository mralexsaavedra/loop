/* Detail views bake (DETAIL): compact daily series of the last DETAIL_DAYS (365) days per metric, for
 * the full-screen detail sheet a tap on any card opens (web/src/client/detail.js). One shared global:
 * metrics keyed by name, each an ISO `start` + a `v` array (one slot per calendar day, null = no
 * data that day, never 0), rounded to the card's precision.
 *
 * Every series comes from the SAME readers and rules as its card, so the sheet and the card never
 * disagree: HRV / resting HR / respiratory / wrist temp / sleep = the monitor's clamped day median
 * (lib/score/monitor.mjs monitorDaily, partial newest HRV day dropped) with the monitor's personal band;
 * walking HR = day mean (signalTrend) with the same kind of band; fitness age = each VO2max day mean
 * through lib/score/fitness-age.mjs (only with the profile's sex); steps / exercise / distance / flights
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
import { byDayMean, rollAvg, addDays, roundTo } from '../health/stats.mjs';
import { sleepPerformance, sleepEfficiency } from '../score/sleep.mjs';
import { SLEEP_TARGET, BASAL_LO, BASAL_HI, STEP_FLOOR, DIST_FLOOR, BODYCOMP_WINDOW } from '../health/aggregate.mjs';
import { monitorDaily, monitorDef, signalBand } from '../score/monitor.mjs';
import { recoveryFromInputs, DAY_BAND_CUTOFF, BAND_CUTOFF, BASELINE_DAYS, sleepConsistency } from '../score/recovery.mjs';
import { modalitySeries } from '../score/series.mjs';
import { typicalDay, percentile, loadFromSeries } from '../score/load.mjs';
import { scoreModality } from '../score/modality.mjs';
import { mergeSameDay, DISPLAY_RULE, sourceRank, SOURCE_PRECEDENCE } from '../training/sessions.mjs';
import { LEVEL_MIN } from '../training/activity.mjs';
import { strainFromInputs } from '../score/strain.mjs';
import { fitnessAge, FITNESS_AGE_REF } from '../score/fitness-age.mjs';

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
const WALKING_HR_DEF = Object.freeze({ floor: 1, dec: 0 });

export const DETAIL_KEYS = Object.freeze([
  'sleep', 'recovery', 'hrv', 'rhr', 'respiratory', 'wristTemp', 'walkingHr', 'vo2max', 'fitnessAge',
  'steps', 'exercise', 'distance', 'flights', 'energy', 'weight', 'bodyfat', 'lean', 'waist',
  'workouts', 'load-gym', 'load-run', 'load-bike', 'strain',
]);
// Sheet metrics the PAGE computes at view time (never baked in DETAIL) that still have a host tab:
// nutrition = the nutrition score (client/nutri-score.js; its targets follow the viewer's current goal)
export const VIEW_METRICS = Object.freeze(['nutrition']);
// Day strain calendar shades: the reference's bands (light < 10, moderate 10-14, high 14-18, all out
// 18-21) on OUR 0-21 scale (lib/score/strain.mjs: 18 = the user's 95th-percentile day)
export const STRAIN_LEVELS = Object.freeze([0.1, 10, 14, 18]);
const LOAD_MODALITIES = ['gym', 'run', 'bike'];
// Load calendar shades at half / one / one and a half typical training days: the same typical day
// (typicalDay, median RE of the last 6 weeks) the load dial places at its arc midpoint (2x = arc end).
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

/** workout-zones.csv rows -> Map(date|modality -> {z: seconds per zone summed, hx: highest max HR}). */
function zonesByDay(zones) {
  const by = new Map();
  for (const r of zones || []) {
    const k = r.date + '|' + scoreModality(r.type);
    const g = by.get(k) || { z: [0, 0, 0, 0, 0, 0], hx: null };
    r.z.forEach((x, i) => { g.z[i] += x; });
    if (r.hrMax != null && (g.hx == null || r.hrMax > g.hx)) g.hx = r.hrMax;
    by.set(k, g);
  }
  return by;
}

/** readWorkouts() rows -> the sessions a day detail lists: one per date + modality (Inicio's gym /
 * run / bike / other) after the shared DISPLAY rule, fragments summed (minutes, km, elevation, RE),
 * avg HR weighted by the minutes of the fragments that carry it; null fields are left out. With
 * `zones` (readWorkoutZones): `z` = seconds in HR zone 0-5 of that day's Strava activities of the
 * same modality (summed; absent when none or all zero) and `hx` = their highest max HR. */
export function sessionsFromRows(rows, from, zones = null) {
  const zb = zonesByDay(zones);
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

/** The recovery dial's headline (web/src/view/dial.mjs recoveryDial, without geometry) from the SAME
 * recoveryFromInputs result: last night's composite cut at DAY_BAND_CUTOFF (mode "today"), else the
 * 7-day trend (mode "trend"); the trend always rides along. null when gated. */
export function recoveryHead(R) {
  if (!R || R.gated || !Number.isFinite(R.trend7)) return null;
  const today = R.today && Number.isFinite(R.today.value) ? R.today : null;
  const trend = { value: R.trend7, band: R.band, dir: R.trendDir || null };
  if (!today) return { mode: 'trend', date: null, value: R.trend7, band: R.band, sleep: null, trend };
  return { mode: 'today', date: today.date, value: today.value, band: today.band, sleep: today.sleep !== false, trend };
}

/** The load dial's gate for one loadFromSeries modality: null (scored) | the trend's reason | 'fewDays'. */
function loadGate(mod) {
  const t = mod.trend || {};
  if (!t.ok || !Number.isFinite(t.trendPct)) return t.reason || 'baselineBuilding';
  return mod.typical && mod.typical.value > 0 ? null : 'fewDays';
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
  // a day missing active OR basal energy is missing, never basal alone (same rule as aggEnergy)
  const basal = total(I.basal).filter((r) => r.value >= BASAL_LO && r.value <= BASAL_HI && act.has(r.date));
  // a power-meter ride day carries the raw Watch value aside (lib/health/ride-energy.mjs)
  const watch = new Map((arr(I.active) || []).filter((r) => r.watch != null).map((r) => [r.date, r.watch]));
  // ...and a power-ride day the hourly Watch data did not cover is flagged (uncov = 1)
  const uncov = new Set((arr(I.active) || []).filter((r) => r.uncovered).map((r) => r.date));
  daily.energy = basal.map((r) => ({ date: r.date, value: r.value + act.get(r.date), active: act.get(r.date), basal: r.value, watch: watch.get(r.date), uncov: uncov.has(r.date) ? 1 : null }));
  daily.weight = arr(I.weight) ? byDayMean(I.weight) : [];
  // bioimpedance: the latest scale only, and only its last BODYCOMP_WINDOW days (the Salud card's
  // window: the source tag alone does not isolate a scale switch)
  const latestSource = (rows) => {
    if (!arr(rows)) return [];
    const src = rows[rows.length - 1].source;
    const same = byDayMean(rows.filter((r) => r.source === src));
    const newest = lastDate(same);
    return same.filter((r) => dayDiff(r.date, newest) < BODYCOMP_WINDOW);
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
    // per night (lib/score/sleep.mjs): performance % of the target, efficiency %, consistency minutes
    // and the stage hours; a stage array no night has (older extracts) is left out
    const perNight = rows.map((r) => ({ date: r.date, perf: sleepPerformance(r.value, SLEEP_TARGET), eff: sleepEfficiency(r.value, r.inbed) }));
    const cons = sleepConsistency(I.sleep, asOf).filter((c) => c.date >= sleepDense.start);
    const some = (a) => (a.some((x) => x != null) ? a : null);
    const st = Object.fromEntries(['rem', 'deep', 'core', 'awake', 'inbed'].map((k) => [k, some(alignedTo(sleepDense, rows, k, 2))]));
    metrics.sleep = clean({ kind: 'sleep', dir: 1, dec: 2, target: SLEEP_TARGET, band: signalBand(daily.sleep, monitorDef('sleep')), ...sleepDense,
      bed: alignedTo(sleepDense, rows, 'bedtime', 2), wake: alignedTo(sleepDense, rows, 'waketime', 2),
      perf: some(alignedTo(sleepDense, perNight, 'perf', 0)), eff: some(alignedTo(sleepDense, perNight, 'eff', 0)),
      cons: some(alignedTo(sleepDense, cons, 'value', 0)), ...st });
  }
  const rec = rollingRecovery({ hrv: arr(I.hrv) || [], rhr: arr(I.rhr) || [], sleep: arr(I.sleep) || [] }, from, asOf);
  if (rec) {
    const head = recoveryHead(recoveryFromInputs({ hrv: arr(I.hrv) || [], rhr: arr(I.rhr) || [], sleep: arr(I.sleep) || [] }));
    metrics.recovery = clean({ kind: 'recovery', dir: 1, dec: 2, cut: DAY_BAND_CUTOFF, cutTrend: BAND_CUTOFF, head, ...rec });
  }
  for (const [k, dir] of [['hrv', 1], ['rhr', -1], ['respiratory', 0], ['wristTemp', 0]]) sig(k, dir, monitorDef(k).dec, signalBand(daily[k], monitorDef(k)));
  sig('walkingHr', -1, 0, signalBand(daily.walkingHr, WALKING_HR_DEF));
  put(metrics, 'vo2max', { kind: 'sparse', dir: 1, dec: 1 }, denseSeries(daily.vo2max, from, 1));
  // fitness age (lib/score/fitness-age.mjs) of each VO2max day, only with the profile's sex; lo / hi =
  // the clamp bounds of the reference curve (a value there means "that age or beyond")
  const ref = FITNESS_AGE_REF[I.sex];
  if (ref) {
    const ages = daily.vo2max.map((r) => ({ date: r.date, value: (fitnessAge(r.value, I.sex) || {}).age }));
    put(metrics, 'fitnessAge', { kind: 'sparse', dir: -1, dec: 1, lo: ref[0][0], hi: ref[ref.length - 1][0] }, denseSeries(ages, from, 1));
  }
  for (const [k, dec] of [['steps', 0], ['exercise', 0], ['distance', 1], ['flights', 0]]) {
    put(metrics, k, clean({ kind: 'total', dir: 1, dec, band: quartileBand(daily[k], dec) }), denseSeries(daily[k], from, dec));
  }
  const eDense = denseSeries(daily.energy, from, 0);
  if (eDense) {
    metrics.energy = clean({ kind: 'total', dir: 0, dec: 0, band: quartileBand(daily.energy, 0), ...eDense,
      active: alignedTo(eDense, daily.energy, 'active', 0), basal: alignedTo(eDense, daily.energy, 'basal', 0),
      roll: alignedTo(eDense, rollAvg(daily.energy, 7), 'value', 0) });
    const w = alignedTo(eDense, daily.energy, 'watch', 0);
    if (w.some((x) => x != null)) metrics.energy.watch = w;
    const u = alignedTo(eDense, daily.energy, 'uncov', 0);
    if (u.some((x) => x != null)) metrics.energy.uncov = u;
  }
  const wDense = denseSeries(daily.weight, from, 1);
  if (wDense) {
    const raw = I.weight[I.weight.length - 1];
    metrics.weight = { kind: 'sparse', dir: 0, dec: 1, ...wDense, roll: alignedTo(wDense, rollAvg(daily.weight, 7), 'value', 1),
      latest: { date: raw.date, value: roundTo(raw.value, 1) } };
  }
  for (const k of ['bodyfat', 'lean']) put(metrics, k, { kind: 'sparse', dir: 0, dec: 1, windowDays: BODYCOMP_WINDOW }, denseSeries(daily[k], from, 1));
  put(metrics, 'waist', { kind: 'sparse', dir: 0, dec: 1 }, denseSeries(daily.waist, from, 1));

  if (minutes.size) {
    // a day without a session between the first session and asOf (the newest data of any kind) is
    // rest: 0 minutes, not missing data; the client stops at the viewer's today
    const dense = denseSeries([...minutes.keys()].sort().map((d) => ({ date: d, value: minutes.get(d) })), from, 0);
    if (dense) {
      const v = new Array(dayDiff(dense.start, asOf) + 1).fill(0);
      dense.v.forEach((x, i) => { if (x != null) v[i] = x; });
      metrics.workouts = { kind: 'workouts', dir: 0, dec: 0, levels: [...LEVEL_MIN], start: dense.start, v };
    }
  }
  if (load && load.reEpoch) {
    const dial = new Map(loadFromSeries(load).modalities.map((x) => [x.key, x]));
    for (const m of LOAD_MODALITIES) {
      const days = load.byModality[m] || [];
      const inWin = days.filter((d) => d.date >= from);
      if (!inWin.length || !days.some((d) => d.load > 0 || d.unscored)) continue;
      const typical = typicalDay(days).value;
      // calendar shades: any RE, then half / one / one and a half typical days (one shade without a typical day)
      const levels = typical != null ? [1, ...LOAD_LEVEL_RATIOS.map((r) => roundTo(r * typical, 1))] : [1];
      const mod = dial.get(m);
      metrics['load-' + m] = { kind: 'load', dir: 0, dec: 1, typical, levels, gate: loadGate(mod), last: mod.last,
        start: inWin[0].date, v: inWin.map((d) => (d.unscored ? null : roundTo(d.load, 1))) };
    }
  }
  const zones = arr(I.zones) || null;
  // day strain 0-21: the same bake as the Inicio dial (one K for every day), days with all-day HR only
  const st = arr(I.hrHourly) ? strainFromInputs({ hourly: I.hrHourly, zones }) : null;
  if (st && st.ok) put(metrics, 'strain', { kind: 'strain', dir: 0, dec: 1, levels: [...STRAIN_LEVELS] }, denseSeries(st.all, from, 1));
  const out = { asOf, days: DETAIL_DAYS, metrics, sessions: sessionsFromRows(workouts, from, zones) };
  // the max HR the zones were cut with (every row of one sync shares it) and its source, for the ⓘ
  if (zones) out.zoneMax = { hr: zones[zones.length - 1].maxHr, src: zones[zones.length - 1].maxSrc };
  return out;
}

/** readExtract inputs -> the DETAIL bake: a thin mapper onto detailFromInputs. opts.sex = the profile's sex
 * ('male' | 'female' | null): the fitness-age series needs it. */
export function detailFrom(I, { sex = null } = {}) {
  const s = I.series;
  return detailFromInputs({
    sleep: I.sleep, hrv: s.hrv, rhr: s.rhr, respiratory: s.respiratory,
    wristTemp: s.wristTemp, walkingHr: s.walkingHr, vo2max: s.vo2max,
    steps: s.steps, exercise: s.exercise, distance: s.distance, flights: s.flights,
    active: I.activeEnergy, basal: s.basal,
    weight: s.weight, bodyfat: s.bodyfat, lean: s.leanmass, waist: s.waist,
    workouts: I.workouts, zones: I.zones, hrHourly: I.hrHourly,
    sex,
  });
}
