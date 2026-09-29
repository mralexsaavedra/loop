/* Pure per-section health aggregators + buildHealth(extractDir) — extracted
 * verbatim from data/training/generate-health.js (astro-plan-web migration,
 * slice 2). The agg* functions take already-parsed series (no I/O); the
 * build* functions (incl. the single entry point buildHealth) take an
 * `extractDir` (path or null) and read via lib/health/read.mjs, so a
 * missing/null extractDir degrades to the same empty shape a fresh clone
 * with no Apple Health export already produced.
 */
import {
  readSeries, readDietary, readRunning, readRunDistByDate, readSleep, readWorkoutLoad, readRides,
} from './read.mjs';
import {
  byDayMean, rollAvg, lastDays, valueDaysAgo, spark, meanOf, stdev, median,
  wrapNight, clockStr, paceStr, dailyTrend, signalTrend,
} from './stats.mjs';

const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
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
const BODYCOMP_WINDOW = 150; // days
function sparseBodyMetric(series) {
  const recentSource = series[series.length - 1].source;
  const same = series.filter((r) => r.source === recentSource);
  const latest = same[same.length - 1];
  const win = same.filter((r) => dayDiff(r.date, latest.date) <= BODYCOMP_WINDOW);
  return {
    latest: round(latest.value, 1),
    latestDate: latest.date,
    source: recentSource,
    points: same.length,
    windowPoints: win.length,
    delta: win.length > 1 ? round(latest.value - win[0].value, 1) : null,
    spark: spark(win.map((r) => ({ date: r.date, value: r.value })), 1),
  };
}
export function buildBody(extractDir) {
  return aggBody(
    readSeries(extractDir, 'weight.csv'), readSeries(extractDir, 'bodyfat.csv'),
    readSeries(extractDir, 'leanmass.csv'), readSeries(extractDir, 'waist.csv'),
  );
}

/* ---------- energy: expenditure (live) + balance (only if intake was logged enough) ---------- */
const DIET_MIN_KCAL = 800;
const BASAL_LO = 1200, BASAL_HI = 2800;
const BALANCE_WINDOW = 90;
const BALANCE_MIN_DAYS = 7;
const avg2 = (rows, k) => Math.round(meanOf(rows.map((x) => x[k])));
// Pure: active + basal + dietary series -> baked energy section.
export function aggEnergy(act, basal, diet) {
  if (!act || !basal) return { hasData: false };

  const aMap = {}; act.forEach((r) => { aMap[r.date] = r.value; });
  const tdee = basal
    .filter((r) => r.value >= BASAL_LO && r.value <= BASAL_HI)
    .map((r) => ({ date: r.date, value: r.value + (aMap[r.date] || 0) }));
  if (tdee.length < 14) return { hasData: false };

  const roll = rollAvg(tdee, 7);
  const last30 = lastDays(tdee, 30);
  const out = {
    hasData: true,
    tdeeAvg: Math.round(meanOf(last30.map((r) => r.value))),
    tdeeDays: last30.length,
    spark: spark(lastDays(roll, 90), 0),
    balance: null,
  };

  const intake = (diet || []).filter((r) => r.value >= DIET_MIN_KCAL);
  out.intakeDays = intake.length;
  if (intake.length) {
    const lastLogged = intake[intake.length - 1].date;
    const tMap = {}; tdee.forEach((r) => { tMap[r.date] = r.value; });
    const paired = intake
      .filter((r) => dayDiff(r.date, lastLogged) <= BALANCE_WINDOW && tMap[r.date] != null)
      .map((r) => ({ date: r.date, intake: r.value, p: r.p, c: r.c, g: r.g, tdee: tMap[r.date] }));
    out.lastIntake = lastLogged;
    out.balanceDays = paired.length;
    if (paired.length >= BALANCE_MIN_DAYS) {
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
export function buildEnergy(extractDir) {
  return aggEnergy(readSeries(extractDir, 'active-energy-daily.csv'), readSeries(extractDir, 'basal-energy-daily.csv'), readDietary(extractDir));
}

/* ---------- activity (NEAT + movement) ---------- */
const STEP_FLOOR = 200;
const DIST_FLOOR = 0.1;
export function aggActivity(steps, exercise, distance, flights) {
  const out = { hasData: false };
  const add = (key, t) => { if (t) { out[key] = t; out.hasData = true; } };
  add('steps', dailyTrend(steps, { floor: STEP_FLOOR, dec: 0 }));
  add('exercise', dailyTrend(exercise, { dec: 0 }));
  add('distance', dailyTrend(distance, { floor: DIST_FLOOR, dec: 1 }));
  add('flights', dailyTrend(flights, { dec: 0 }));
  return out.hasData ? out : { hasData: false };
}
export function buildActivity(extractDir) {
  return aggActivity(
    readSeries(extractDir, 'steps-daily.csv'), readSeries(extractDir, 'exercise-minutes-daily.csv'),
    readSeries(extractDir, 'distance-daily.csv'), readSeries(extractDir, 'flights-daily.csv'),
  );
}

/* ---------- running performance (sparse sessions, not a trend) ---------- */
const RUN_MIN_KMH = 5;
export function aggRunning(rows, distByDate) {
  if (!rows || !rows.length) return { hasData: false };
  const runs = rows.filter((r) => r.speed != null && r.speed >= RUN_MIN_KMH);
  if (!runs.length) return { hasData: false };
  const dist = distByDate || {};
  const sessions = runs.slice(-8).reverse().map((r) => ({
    date: r.date,
    dist: dist[r.date] != null ? round(dist[r.date], 2) : null,
    pace: paceStr(60 / r.speed),
    speed: round(r.speed, 1),
    power: r.power != null ? Math.round(r.power) : null,
    gct: r.gct != null ? Math.round(r.gct) : null,
    vosc: r.vosc != null ? round(r.vosc, 1) : null,
    stride: r.stride != null ? round(r.stride, 2) : null,
  }));
  return { hasData: true, count: runs.length, sessions };
}
export function buildRunning(extractDir) { return aggRunning(readRunning(extractDir), readRunDistByDate(extractDir)); }

/* ---------- cycling (recent rides, the bike counterpart of running) ---------- */
// Same row budget as the running table, so run and bike carry equal visual weight.
const RIDES_SHOWN = 8;
const hmm = (min) => { const m = Math.round(min); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); };
// Pure: readRides() rows -> newest-first recent rides + total count. Distance / elevation / RE /
// kJ are shown only when the source recorded them (an indoor ride has no GPS; only Strava rows
// carry elevation, RE and kJ) — a blank is never filled with 0.
export function aggCycling(rows) {
  const rides = (rows || []).filter((r) => r && r.dur > 0);
  if (!rides.length) return { hasData: false };
  const sessions = rides.slice(-RIDES_SHOWN).reverse().map((r) => ({
    date: r.date,
    dist: r.dist != null && r.dist > 0 ? round(r.dist, 2) : null,
    time: hmm(r.dur),
    elev: r.elev != null ? Math.round(r.elev) : null,
    hrAvg: r.hrAvg != null ? Math.round(r.hrAvg) : null,
    re: r.re != null ? Math.round(r.re) : null,
    kj: r.kj != null ? Math.round(r.kj) : null,
  }));
  return { hasData: true, count: rides.length, sessions };
}
export function buildCycling(extractDir) { return aggCycling(readRides(extractDir)); }

/* ---------- recovery ---------- */
const SLEEP_TARGET = 7.5;
// Pure: rhr + hrv + vo2max + sleep + respiratory + wrist-temp + walking-HR -> baked recovery section.
export function aggRecovery({ rhr, hrv, vo2, sleep, respiratory, wristTemp, walkingHr } = {}) {
  if (!rhr && !hrv && !vo2 && !sleep && !respiratory && !wristTemp && !walkingHr) return { hasData: false };
  const out = { hasData: true };

  if (rhr) {
    const daily = byDayMean(rhr);
    const roll = rollAvg(daily, 7);
    out.rhr = {
      latest: Math.round(rhr[rhr.length - 1].value),
      latestDate: rhr[rhr.length - 1].date,
      d30: valueDaysAgo(roll, 30) != null ? round(roll[roll.length - 1].value - valueDaysAgo(roll, 30), 1) : null,
      spark: spark(lastDays(roll, 90), 1),
    };
  }
  if (hrv) {
    const daily = byDayMean(hrv);
    const roll = rollAvg(daily, 7);
    out.hrv = {
      latest: Math.round(roll[roll.length - 1].value),
      latestDate: daily[daily.length - 1].date,
      d30: valueDaysAgo(roll, 30) != null ? Math.round(roll[roll.length - 1].value - valueDaysAgo(roll, 30)) : null,
      spark: spark(lastDays(roll, 90), 0),
    };
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
  if (sleep) {
    const last30 = lastDays(sleep, 30);
    const dur = last30.map((r) => r.value);
    out.sleep = {
      avg: dur.length ? round(meanOf(dur), 1) : null,
      nights: dur.length,
      latestDate: sleep[sleep.length - 1].date,
      spark: spark(rollAvg(lastDays(sleep, 90), 7), 1),
      target: SLEEP_TARGET,
      pctTarget: dur.length ? Math.round(100 * dur.filter((h) => h >= SLEEP_TARGET).length / dur.length) : null,
      sd: dur.length >= 2 ? round(stdev(dur), 1) : null,
    };
    const bt = last30.filter((r) => r.bedtime != null).map((r) => wrapNight(r.bedtime));
    if (bt.length >= 7) { out.sleep.bedtime = clockStr(median(bt)); out.sleep.bedtimeSd = Math.round(stdev(bt) * 60); }
    const wt = last30.filter((r) => r.waketime != null).map((r) => r.waketime);
    if (wt.length >= 7) { out.sleep.wake = clockStr(median(wt)); out.sleep.wakeSd = Math.round(stdev(wt) * 60); }
  }
  const resp = signalTrend(respiratory, 1); if (resp) out.respiratory = resp;
  const temp = signalTrend(wristTemp, 2); if (temp) out.wristTemp = temp;
  const whr = signalTrend(walkingHr, 0); if (whr) out.walkingHr = whr;
  return out;
}
export function buildRecovery(extractDir) {
  return aggRecovery({
    rhr: readSeries(extractDir, 'rhr.csv'),
    hrv: readSeries(extractDir, 'hrv.csv'),
    vo2: readSeries(extractDir, 'vo2max.csv'),
    sleep: readSleep(extractDir),
    respiratory: readSeries(extractDir, 'respiratory-daily.csv'),
    wristTemp: readSeries(extractDir, 'wristTemp.csv'),
    walkingHr: readSeries(extractDir, 'walking-hr-daily.csv'),
  });
}

/* ---------- load vs recovery (cross-tab synthesis) ---------- */
const LR_WEEKS = 12;
const isoLocal = (dt) => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
export function weekStart(date) { const dt = new Date(date + 'T00:00:00'); dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); return isoLocal(dt); }
// Pure: HR-tagged workouts + hrv + rhr series -> weekly load aligned with weekly recovery means.
export function aggLoadRecovery(workouts, hrv, rhr) {
  const hw = (workouts || []).filter((w) => w.hrAvg != null && w.dur > 0);
  if (!hw.length || (!hrv && !rhr)) return { hasData: false };
  const asOf = hw.map((w) => w.date).sort()[hw.length - 1];
  const start = new Date(weekStart(asOf) + 'T00:00:00'); start.setDate(start.getDate() - 7 * (LR_WEEKS - 1));
  const wk = {};
  for (let i = 0; i < LR_WEEKS; i++) { const d = new Date(start); d.setDate(d.getDate() + 7 * i); wk[isoLocal(d)] = { load: 0 }; }
  hw.forEach((w) => { const k = weekStart(w.date); if (wk[k]) wk[k].load += w.dur * w.hrAvg / 100; });
  const weeklyMean = (s) => {
    const out = {}; if (!s) return out;
    const acc = {}; byDayMean(s).forEach((p) => { const k = weekStart(p.date); if (wk[k]) (acc[k] = acc[k] || []).push(p.value); });
    Object.keys(acc).forEach((k) => { out[k] = meanOf(acc[k]); }); return out;
  };
  const hrvW = weeklyMean(hrv), rhrW = weeklyMean(rhr);
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
  return { hasData: true, weeks: LR_WEEKS, series, split };
}
export function buildLoadRecovery(extractDir) { return aggLoadRecovery(readWorkoutLoad(extractDir), readSeries(extractDir, 'hrv.csv'), readSeries(extractDir, 'rhr.csv')); }

/* ---------- assemble ---------- */
export function buildHealth(extractDir) {
  return {
    body: buildBody(extractDir), activity: buildActivity(extractDir), energy: buildEnergy(extractDir),
    running: buildRunning(extractDir), cycling: buildCycling(extractDir), recovery: buildRecovery(extractDir), loadRecovery: buildLoadRecovery(extractDir),
  };
}
