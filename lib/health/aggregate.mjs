/* Pure per-section health aggregators + healthFrom(inputs). The agg* functions take already-parsed series
 * (no I/O); healthFrom maps the lib/extract/read.mjs readExtract inputs onto them (the page's path:
 * web/src/bakes.mjs computeBakes reads the extract once). Absent inputs (readExtract(null), a fresh clone
 * with no Apple Health export) give every section's empty state.
 */
import {
  byDayMean, rollAvg, lastDays, valueDaysAgo, spark, meanOf, stdev, robustSd, median,
  wrapNight, clockStr, paceStr, dailyTrend, signalTrend, avg30Of, d30Of,
} from './stats.mjs';
import { mergeSameDay, DISPLAY_RULE } from '../training/sessions.mjs';
import { scoreModality } from '../score/modality.mjs';
import { trainingThrough } from '../training/through.mjs';
import { dailySignal, completeDay } from '../score/recovery.mjs';
import { vo2maxDaily } from '../score/fitness-age.mjs';
import { stageShares, sleepEfficiency, SLEEP_TARGET } from '../score/sleep.mjs';
import { dayDiff, addDays, weekStart } from '../date.mjs';

const round = (n, d = 1) => { const f = 10 ** d; return Math.round(n * f) / f; };

/* ---------- body composition ---------- */
// Pure: weight + bodyfat + lean-mass + waist series ([{date,value,source}] | null) -> baked body section.
export function aggBody(w, bf, lean, waist) {
  if (!w && !bf && !lean && !waist) return { hasData: false };
  const out = { hasData: true };

  if (w) {
    const daily = byDayMean(w);
    const roll = rollAvg(daily, 7);
    const latest = w[w.length - 1];
    out.weight = {
      latest: round(latest.value, 1),
      latestDate: latest.date,
      source: latest.source,
      sources: new Set(w.map((r) => r.source)).size,
      d30: valueDaysAgo(roll, 30) != null ? round(roll[roll.length - 1].value - valueDaysAgo(roll, 30), 1) : null,
      d90: valueDaysAgo(roll, 90) != null ? round(roll[roll.length - 1].value - valueDaysAgo(roll, 90), 1) : null,
      spark: spark(lastDays(roll, 180), 1),
    };
  }

  if (bf) out.bodyfat = sparseBodyMetric(bf);
  if (lean) out.lean = sparseBodyMetric(lean);
  if (waist) out.waist = sparseMeasurement(waist);
  return out;
}
// A manual tape measurement (waist): taken every few weeks, so every reading is a point (no
// rolling average) and the change is simply latest vs the first reading. A tape has no scale
// artefact, so readings from any source are comparable.
function sparseMeasurement(series) {
  const first = series[0], latest = series[series.length - 1];
  return {
    latest: round(latest.value, 1),
    latestDate: latest.date,
    firstDate: first.date,
    points: series.length,
    delta: series.length > 1 ? round(latest.value - first.value, 1) : null,
    spark: spark(series.map((r) => ({ date: r.date, value: r.value })), 1),
  };
}
// Bioimpedance body metric (body fat, lean mass): compare WITHIN one scale only, and over a
// RECENT window (the source tag alone isn't enough — the same app re-tags an old scale's
// readings, so a multi-year delta can straddle a scale switch).
export const BODYCOMP_WINDOW = 150; // days, counting the latest reading's day (strict <, same as lastDays)
function sparseBodyMetric(series) {
  const recentSource = series[series.length - 1].source;
  const same = series.filter((r) => r.source === recentSource);
  const latest = same[same.length - 1];
  const win = same.filter((r) => dayDiff(r.date, latest.date) < BODYCOMP_WINDOW);
  return {
    latest: round(latest.value, 1),
    latestDate: latest.date,
    source: recentSource,
    points: same.length,
    windowPoints: win.length,
    windowDays: BODYCOMP_WINDOW,
    delta: win.length > 1 ? round(latest.value - win[0].value, 1) : null,
    spark: spark(win.map((r) => ({ date: r.date, value: r.value })), 1),
  };
}

/* ---------- energy: expenditure (live) + balance (only if intake was logged enough) ---------- */
const DIET_MIN_KCAL = 800;
export const BASAL_LO = 1200, BASAL_HI = 2800;
const BALANCE_WINDOW = 90;
const BALANCE_MIN_DAYS = 7;
// Intake logged longer ago than this is abandoned: comparing it with today's expenditure would
// present an old balance as the current one, so the page says intake cannot be scored instead.
const INTAKE_MAX_AGE_DAYS = 14;
const avg2 = (rows, k) => Math.round(meanOf(rows.map((x) => x[k])));
// Pure: active + basal + dietary series -> baked energy section.
export function aggEnergy(act, basal, diet) {
  if (!act || !basal) return { hasData: false };

  const aMap = {}; act.forEach((r) => { aMap[r.date] = r.value; });
  // days whose active energy was corrected by a power-meter ride (lib/health/ride-energy.mjs)
  const corrected = new Set(act.filter((r) => r.watch != null).map((r) => r.date));
  // power-ride days the hourly Watch data did not cover: kept at the Watch value, flagged
  const uncovered = new Set(act.filter((r) => r.uncovered).map((r) => r.date));
  // a day needs BOTH parts: basal alone is not that day's expenditure (the detail sheet uses the same rule)
  const tdee = basal
    .filter((r) => r.value >= BASAL_LO && r.value <= BASAL_HI && aMap[r.date] != null)
    .map((r) => ({ date: r.date, value: r.value + aMap[r.date] }));
  if (tdee.length < 14) return { hasData: false };

  const roll = rollAvg(tdee, 7);
  const last30 = lastDays(tdee, 30);
  const out = {
    hasData: true,
    tdeeLatest: Math.round(tdee[tdee.length - 1].value),
    tdeeLatestDate: tdee[tdee.length - 1].date,
    tdeeAvg: Math.round(meanOf(last30.map((r) => r.value))),
    tdeeDays: last30.length,
    latestCorrected: corrected.has(tdee[tdee.length - 1].date),
    correctedDays: last30.filter((r) => corrected.has(r.date)).length,
    latestUncovered: uncovered.has(tdee[tdee.length - 1].date),
    uncoveredDays: last30.filter((r) => uncovered.has(r.date)).length,
    spark: spark(lastDays(roll, 90), 0),
    balance: null,
  };

  const intake = (diet || []).filter((r) => r.value >= DIET_MIN_KCAL);
  out.intakeDays = intake.length;
  if (intake.length) {
    const lastLogged = intake[intake.length - 1].date;
    // the window is anchored to the newest EXPENDITURE day (the "now" of this section), not to the
    // last logged meal, and intake must still be current (logged within INTAKE_MAX_AGE_DAYS)
    const anchor = out.tdeeLatestDate;
    const current = dayDiff(lastLogged, anchor) <= INTAKE_MAX_AGE_DAYS;
    const tMap = {}; tdee.forEach((r) => { tMap[r.date] = r.value; });
    const paired = intake
      .filter((r) => { const g = dayDiff(r.date, anchor); return g >= 0 && g < BALANCE_WINDOW && tMap[r.date] != null; })
      .map((r) => ({ date: r.date, intake: r.value, p: r.p, c: r.c, g: r.g, tdee: tMap[r.date] }));
    out.lastIntake = lastLogged;
    out.balanceDays = current ? paired.length : 0;
    if (current && paired.length >= BALANCE_MIN_DAYS) {
      const avg = (k) => Math.round(meanOf(paired.map((x) => x[k])));
      const intakeAvg = avg('intake'), tdeeAvg = avg('tdee');
      out.balance = {
        from: paired[0].date, to: paired[paired.length - 1].date, days: paired.length,
        intakeAvg, tdeeAvg, net: intakeAvg - tdeeAvg,
      };
      const macroRows = paired.filter((x) => x.p != null && x.c != null && x.g != null);
      if (macroRows.length) {
        const p = avg2(macroRows, 'p'), c = avg2(macroRows, 'c'), g = avg2(macroRows, 'g');
        const kc = p * 4 + c * 4 + g * 9 || 1;
        out.macros = {
          days: macroRows.length, p, c, g,
          pPct: Math.round(100 * p * 4 / kc), cPct: Math.round(100 * c * 4 / kc), gPct: Math.round(100 * g * 9 / kc),
        };
      }
    }
  }
  return out;
}

/* ---------- activity (NEAT + movement) ---------- */
export const STEP_FLOOR = 200;
export const DIST_FLOOR = 0.1;
export function aggActivity(steps, exercise, distance, flights) {
  const out = { hasData: false };
  const add = (key, t) => { if (t) { out[key] = t; out.hasData = true; } };
  add('steps', dailyTrend(steps, { floor: STEP_FLOOR, dec: 0 }));
  add('exercise', dailyTrend(exercise, { dec: 0 }));
  add('distance', dailyTrend(distance, { floor: DIST_FLOOR, dec: 1 }));
  add('flights', dailyTrend(flights, { dec: 0 }));
  return out.hasData ? out : { hasData: false };
}

// Row budget shared by the running and cycling tables, so run and bike carry equal visual weight.
const RECENT_SESSIONS_SHOWN = 8;

const hmm = (min) => { const m = Math.round(min); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); };
// Sum a field over same-day fragments: null only when no fragment recorded it (0 stays 0).
const sumOrNull = (rows, k) => rows.reduce((acc, r) => (r[k] == null ? acc : (acc ?? 0) + r[k]), null);
// The Watch fragments one session into several records, so the rows of a date merge into ONE
// session (ride or run) under the shared same-day rule (lib/training/sessions.mjs, DISPLAY_RULE:
// stubs dropped, one source when a Watch and a Strava copy of the session coexist): durations /
// distance / kJ / elevation / RE add up, avg HR is weighted by the duration of the fragments that
// carry HR. `sessions` are rows of ONE type family. Returns merged sessions sorted oldest-first.
const ONE_FAMILY = () => 'session';
function mergeSessionDays(sessions) {
  return mergeSameDay(sessions, ONE_FAMILY, DISPLAY_RULE).map(({ date, rows: day }) => {
    const withHr = day.filter((r) => r.hrAvg != null);
    const hrDur = withHr.reduce((a, r) => a + r.dur, 0);
    return {
      date,
      dur: day.reduce((a, r) => a + r.dur, 0),
      dist: sumOrNull(day, 'dist'),
      hrAvg: hrDur > 0 ? withHr.reduce((a, r) => a + r.hrAvg * r.dur, 0) / hrDur : null,
      re: sumOrNull(day, 're'),
      kj: sumOrNull(day, 'kj'),
      elev: sumOrNull(day, 'elev'),
    };
  });
}
// The table fields a merged run and a merged ride share (a blank stays null, never 0).
function baseSession(r) {
  return {
    date: r.date,
    dist: r.dist != null && r.dist > 0 ? round(r.dist, 2) : null,
    time: hmm(r.dur),
    hrAvg: r.hrAvg != null ? Math.round(r.hrAvg) : null,
    re: r.re != null ? Math.round(r.re) : null,
    elev: r.elev != null ? Math.round(r.elev) : null,
  };
}
// Pure: readRides() rows -> newest-first recent rides + count of distinct ride days. Distance /
// elevation / RE / kJ are shown only when the source recorded them (an indoor ride has no GPS;
// only Strava rows carry elevation, RE and kJ) — a blank is never filled with 0.
export function aggCycling(rows) {
  const rides = mergeSessionDays(rows);
  if (!rides.length) return { hasData: false };
  const sessions = rides.slice(-RECENT_SESSIONS_SHOWN).reverse().map((r) => ({
    ...baseSession(r),
    kj: r.kj != null ? Math.round(r.kj) : null,
  }));
  return { hasData: true, count: rides.length, sessions };
}

/* ---------- running (recent runs, same table model as cycling) ---------- */
// Running-dynamics days below this speed are walks / GPS garbage and are not joined.
const RUN_MIN_KMH = 5;
// Pure: readRuns() rows (workouts.csv Running rows: Watch export + Strava API) merged per day like
// the rides, LEFT-joined by date with the watch running dynamics of running-daily.csv (power, GCT,
// vertical oscillation, stride — export.xml only, so a Strava-only run shows dashes there). A
// dynamics-only day never adds a run. Pace = time / distance, null without a distance (treadmill).
export function aggRunning(rows, dynRows) {
  const runs = mergeSessionDays(rows);
  if (!runs.length) return { hasData: false };
  const dyn = new Map((dynRows || []).filter((r) => r && r.speed != null && r.speed >= RUN_MIN_KMH).map((r) => [r.date, r]));
  const sessions = runs.slice(-RECENT_SESSIONS_SHOWN).reverse().map((r) => {
    const d = dyn.get(r.date) || {};
    const dist = r.dist != null && r.dist > 0 ? r.dist : null;
    return {
      ...baseSession(r),
      pace: dist != null ? paceStr(r.dur / dist) : null,
      power: d.power != null ? Math.round(d.power) : null,
      gct: d.gct != null ? Math.round(d.gct) : null,
      vosc: d.vosc != null ? round(d.vosc, 1) : null,
      stride: d.stride != null ? round(d.stride, 2) : null,
    };
  });
  return { hasData: true, count: runs.length, sessions };
}

// A daily series' headline: the newest value (whole) with its date, avg30 / d30 at `dec` decimals and the
// 90-day sparkline of its 7-day rolling mean.
function dailyHeadline(daily, dec) {
  const roll = rollAvg(daily, 7);
  return {
    latest: Math.round(daily[daily.length - 1].value),
    latestDate: daily[daily.length - 1].date,
    avg30: avg30Of(daily, dec),
    d30: d30Of(roll, dec),
    spark: spark(lastDays(roll, 90), dec),
  };
}

// The sleep card: the newest night vs the last 30 (mean, nights at target, spread), bedtime / wake time with
// their regularity, and the stages of the newest staged night.
function sleepSummary(sleep) {
  const last30 = lastDays(sleep, 30);
  const dur = last30.map((r) => r.value);
  const out = {
    latest: round(sleep[sleep.length - 1].value, 1),
    avg: dur.length ? round(meanOf(dur), 1) : null,
    nights: dur.length,
    latestDate: sleep[sleep.length - 1].date,
    spark: spark(rollAvg(lastDays(sleep, 90), 7), 1),
    target: SLEEP_TARGET,
    pctTarget: dur.length ? Math.round(100 * dur.filter((h) => h >= SLEEP_TARGET).length / dur.length) : null,
    sd: dur.length >= 2 ? round(stdev(dur), 1) : null,
  };
  const bt = last30.filter((r) => r.bedtime != null).map((r) => wrapNight(r.bedtime));
  // regularity = ROBUST spread (MAD-scaled) around the median, in minutes: one odd night (a late
  // party, a sensor glitch) must not read as an irregular month
  if (bt.length >= 7) { out.bedtime = clockStr(median(bt)); out.bedtimeSd = Math.round(robustSd(bt) * 60); }
  const wt = last30.filter((r) => r.waketime != null).map((r) => r.waketime);
  if (wt.length >= 7) { out.wake = clockStr(median(wt)); out.wakeSd = Math.round(robustSd(wt) * 60); }
  const stages = stageSummary(last30);
  if (stages) out.stages = stages;
  return out;
}

// The newest staged night (hours, % of asleep, efficiency) vs the means of the staged nights among the last
// 30 (lib/score/sleep.mjs formulas); null when no night has stages.
function stageSummary(last30) {
  const staged = last30.filter((r) => stageShares(r));
  if (!staged.length) return null;
  const n = staged[staged.length - 1];
  const mean = (k) => { const xs = staged.map((r) => r[k]).filter(Number.isFinite); return xs.length ? round(meanOf(xs), 1) : null; };
  const effs = staged.map((r) => sleepEfficiency(r.value, r.inbed)).filter(Number.isFinite);
  return {
    date: n.date, rem: round(n.rem, 1), deep: round(n.deep, 1), core: round(n.core, 1), awake: Number.isFinite(n.awake) ? round(n.awake, 1) : null,
    eff: sleepEfficiency(n.value, n.inbed), shares: stageShares(n),
    avg: { rem: mean('rem'), deep: mean('deep'), core: mean('core'), awake: mean('awake'), eff: effs.length ? Math.round(meanOf(effs)) : null },
    nights: staged.length,
  };
}

/* ---------- recovery ---------- */
// the stated sleep target (defined in lib/score/sleep.mjs), re-exported for the existing importers
export { SLEEP_TARGET };
// Pure: rhr + hrv + vo2max + sleep + respiratory + wrist-temp + walking-HR -> baked recovery section.
export function aggRecovery(inputs = {}) {
  // An empty array is an absent series. HRV / resting HR are absent too when no sample yields a daily
  // value (dailySignal drops undated / non-numeric samples): their card shows its empty state
  // instead of the build throwing on daily[daily.length - 1].
  const some = (a) => (Array.isArray(a) && a.length ? a : null);
  const rhrDaily = some(inputs.rhr) && some(dailySignal('rhr', inputs.rhr));
  const hrvDaily = some(inputs.hrv) && some(dailySignal('hrv', inputs.hrv));
  const rhr = rhrDaily && inputs.rhr, hrv = hrvDaily && inputs.hrv;
  // VO2max: the one per-day series of the fitness age card and the detail sheet (day mean, vo2maxDaily)
  const vo2 = some(inputs.vo2) && some(vo2maxDaily(inputs.vo2)), sleep = some(inputs.sleep);
  const respiratory = some(inputs.respiratory), wristTemp = some(inputs.wristTemp), walkingHr = some(inputs.walkingHr);
  if (!rhr && !hrv && !vo2 && !sleep && !respiratory && !wristTemp && !walkingHr) return { hasData: false };
  const out = { hasData: true };

  // Today first: every headline is the NEWEST value with its date; avg30 (mean of the daily values
  // over the last 30 days) and the Δ are the context line; sparklines stay 7-day rolling.
  // HRV and resting HR use the SAME daily series as Inicio (score/recovery.mjs dailySignal:
  // implausible samples dropped, then the day median), so both tabs show one number for one day — a mean of
  // all samples lets one sensor spike or a duplicate row move the headline.
  if (rhr) out.rhr = dailyHeadline(rhrDaily, 1);
  if (hrv) {
    // headline = the newest COMPLETE day, like the Inicio monitor (a partial day is skipped)
    let daily = hrvDaily;
    const ok = completeDay(hrv, daily[daily.length - 1].date);
    while (daily.length > 1 && !ok(daily[daily.length - 1].date)) daily = daily.slice(0, -1);
    out.hrv = dailyHeadline(daily, 0);
  }
  if (vo2) {
    out.vo2max = {
      latest: round(vo2[vo2.length - 1].value, 1),
      latestDate: vo2[vo2.length - 1].date,
      first: round(vo2[0].value, 1),
      firstDate: vo2[0].date,
      spark: spark(vo2.map((r) => ({ date: r.date, value: r.value })), 1),
    };
  }
  if (sleep) out.sleep = sleepSummary(sleep);
  const resp = signalTrend(respiratory, 1); if (resp) out.respiratory = resp;
  const temp = signalTrend(wristTemp, 2); if (temp) out.wristTemp = temp;
  const whr = signalTrend(walkingHr, 0); if (whr) out.walkingHr = whr;
  return out;
}

/* ---------- load vs recovery (cross-tab synthesis) ---------- */
const LR_WEEKS = 12;
// Pure: workouts (readWorkoutLoad rows) + hrv + rhr series -> weekly load aligned with weekly recovery
// means. Rows follow the ONE same-day rule with the LOAD defaults (lib/training/sessions.mjs: junk
// dropped, a Watch copy of a Strava session counted once), keyed by Inicio's modality; "other"
// (walks, hikes, unknown sports) is not training load and is left out. Only COMPLETE Monday-Sunday
// weeks are compared: the week holding asOf is dropped unless asOf is its Sunday, and so is a
// leading week that starts before the first workout (both would read as artificially easy weeks).
// `through` (lib/training/through.mjs): the Watch's newest day; rest days up to it count, so the last
// session's week closes by the calendar instead of waiting for the next session
export function aggLoadRecovery(workouts, hrv, rhr, { through = null } = {}) {
  const merged = mergeSameDay(workouts || [], (w) => scoreModality(w.type))
    .filter((g) => g.key !== 'other')
    .flatMap((g) => g.rows);
  const hw = merged.filter((w) => w.hrAvg != null && w.dur > 0);
  if (!hw.length || (!hrv && !rhr)) return { hasData: false };
  const dates = merged.map((w) => w.date).sort();
  const lastSession = dates[dates.length - 1];
  const asOf = through && through > lastSession ? through : lastSession;
  const firstDate = dates[0];
  // the last complete week: asOf's own week only when asOf is its Sunday
  const lastWeek = addDays(weekStart(asOf), addDays(weekStart(asOf), 6) === asOf ? 0 : -7);
  const wk = {};
  for (let i = LR_WEEKS - 1; i >= 0; i--) {
    const k = addDays(lastWeek, -7 * i);
    if (k >= firstDate) wk[k] = { load: 0 };
  }
  if (!Object.keys(wk).length) return { hasData: false };
  hw.forEach((w) => { const k = weekStart(w.date); if (wk[k]) wk[k].load += w.dur * w.hrAvg / 100; });
  const weeklyMean = (s, key) => {
    const out = {}; if (!s) return out;
    const acc = {}; dailySignal(key, s).forEach((p) => { const k = weekStart(p.date); if (wk[k]) (acc[k] = acc[k] || []).push(p.value); });
    Object.keys(acc).forEach((k) => { out[k] = meanOf(acc[k]); }); return out;
  };
  const hrvW = weeklyMean(hrv, 'hrv'), rhrW = weeklyMean(rhr, 'rhr');
  const series = Object.keys(wk).sort().map((k) => ({
    w: k, load: Math.round(wk[k].load),
    hrv: hrvW[k] != null ? Math.round(hrvW[k]) : null,
    rhr: rhrW[k] != null ? round(rhrW[k], 1) : null,
  }));
  let split = null;
  const active = series.filter((s) => s.load > 0);
  if (active.length >= 4) {
    const med = median(active.map((s) => s.load));
    const high = active.filter((s) => s.load >= med), low = active.filter((s) => s.load < med);
    const m = (arr, k) => { const v = arr.map((s) => s[k]).filter((x) => x != null); return v.length ? round(meanOf(v), 1) : null; };
    split = { hrvHigh: m(high, 'hrv'), hrvLow: m(low, 'hrv'), rhrHigh: m(high, 'rhr'), rhrLow: m(low, 'rhr') };
  }
  return { hasData: true, weeks: series.length, series, split };
}

/* ---------- assemble ---------- */
/** readExtract inputs -> the baked HEALTH object (every section's agg* over the inputs, in page key order). */
export function healthFrom(I) {
  const s = I.series;
  return {
    body: aggBody(s.weight, s.bodyfat, s.leanmass, s.waist),
    activity: aggActivity(s.steps, s.exercise, s.distance, s.flights),
    // active energy = the Watch day totals, corrected on power-meter ride days (ride-energy.mjs)
    energy: aggEnergy(I.activeEnergy, s.basal, I.dietary),
    running: aggRunning(I.runs, I.running),
    cycling: aggCycling(I.rides),
    recovery: aggRecovery({
      rhr: s.rhr, hrv: s.hrv, vo2: s.vo2max, sleep: I.sleep,
      respiratory: s.respiratory, wristTemp: s.wristTemp, walkingHr: s.walkingHr,
    }),
    loadRecovery: aggLoadRecovery(I.workoutLoad, s.hrv, s.rhr, { through: trainingThrough(I) }),
  };
}
