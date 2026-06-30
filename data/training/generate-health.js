#!/usr/bin/env node
/* Generator for the "Health" tab of the plan artifact.
 *
 * Surfaces the body & recovery series that Apple Health already extracts but that
 * had no home in the artifact. One tab, three stacked sections:
 *   - Body composition : weight (rolling-avg trend) + body fat (single recent scale)
 *   - Energy balance   : HISTORICAL intake vs expenditure over the last logged cut
 *   - Recovery         : resting HR, HRV, VO2max, sleep
 *
 * Source: ../apple-health/extract/*.csv (GITIGNORED, OPTIONAL). Every series is
 * optional — a fresh clone with no export renders the empty state instead of failing,
 * exactly like the workouts dashboard (GEN:DASHBOARD).
 *
 * The result is baked into plan-web.html as `var HEALTH = {...}` inside the GEN:HEALTH
 * region (the artifact is a frozen, self-contained snapshot — no fetch). The page
 * renders client-side.
 *
 * Run:   node data/training/generate-health.js          (writes plan-web.html)
 *        node data/training/generate-health.js --check   (validate only, no write)
 *
 * NEVER hand-edit the GEN:HEALTH block — edit the export / extract and regenerate.
 *
 * DATA HONESTY (see CLAUDE.md / methodology) — baked into the on-screen captions:
 *   - weight mixes scales/apps (source column) -> trend uses a 7-day rolling average and
 *     says so; the latest number comes from the most recent reading.
 *   - body fat is bioimpedance (±3-5%) and only comparable WITHIN one scale -> the trend
 *     uses the most recent dominant source only, never mixes two different scales/apps.
 *   - recent daily energy is incomplete (watch not worn all day -> low active/basal), so
 *     expenditure is a multi-day average, never a single day.
 *   - dietary logging stopped (last full day well before today) -> the energy-balance
 *     section is explicitly HISTORICAL, anchored to the last logged window, not "now".
 *   - HRV has several readings per day -> averaged per day before trending.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const EXTRACT = path.join(DIR, '..', 'apple-health', 'extract');
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- CSV helpers ---------- */
// Read a "date,value[,source]" CSV -> [{date, value, source}] sorted by date. null if absent.
function readSeries(name, valueCol = 1) {
  const p = path.join(EXTRACT, name);
  if (!fs.existsSync(p)) return null;
  const rows = fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).filter(Boolean)
    .map(l => {
      const c = l.split(',');
      return { date: c[0], value: parseFloat(c[valueCol]), source: c[2] || '' };
    })
    .filter(r => ISO.test(r.date) && isFinite(r.value));
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows.length ? rows : null;
}

// Generic CSV reader: parse a file into rows of {date, ...mapped fields}, dropping bad dates.
// `fields` maps an output key to a column index; null when the file is absent or empty.
function readTable(name, fields) {
  const p = path.join(EXTRACT, name);
  if (!fs.existsSync(p)) return null;
  const num = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
  const rows = fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).filter(Boolean)
    .map(l => {
      const c = l.split(',');
      const o = { date: c[0] };
      for (const [k, i] of Object.entries(fields)) o[k] = num(c[i]);
      return o;
    })
    .filter(r => ISO.test(r.date));
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows.length ? rows : null;
}
// dietary-daily.csv: date,kcal,protein_g,carbs_g,fat_g -> [{date, value:kcal, p, c, g}]
function readDietary() {
  const rows = readTable('dietary-daily.csv', { value: 1, p: 2, c: 3, g: 4 });
  return rows && rows.filter(r => isFinite(r.value));
}
// running-daily.csv: date,speed_kmh,power_w,gct_ms,vosc_cm,stride_m,samples
function readRunning() { return readTable('running-daily.csv', { speed: 1, power: 2, gct: 3, vosc: 4, stride: 5 }); }
// sleep-daily.csv: date,asleep_hours,source,bedtime,waketime -> [{date, value:hours, bedtime, waketime}]
function readSleep() {
  const rows = readTable('sleep-daily.csv', { value: 1, bedtime: 3, waketime: 4 });
  return rows && rows.filter(r => isFinite(r.value));
}

const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const round = (n, d = 1) => { const f = 10 ** d; return Math.round(n * f) / f; };

// Collapse multiple rows per day to the daily mean -> [{date, value}] sorted.
function byDayMean(rows) {
  const m = {};
  rows.forEach(r => { (m[r.date] = m[r.date] || []).push(r.value); });
  return Object.keys(m).sort().map(d => ({ date: d, value: m[d].reduce((a, b) => a + b, 0) / m[d].length }));
}

// Centered-trailing rolling average (window in days, by index) over [{date,value}].
function rollAvg(points, win) {
  return points.map((p, i) => {
    const from = Math.max(0, i - win + 1);
    const slice = points.slice(from, i + 1);
    return { date: p.date, value: slice.reduce((s, q) => s + q.value, 0) / slice.length };
  });
}

// Keep only points within the last `days` of the series' own latest date.
function lastDays(points, days) {
  if (!points.length) return [];
  const last = points[points.length - 1].date;
  return points.filter(p => dayDiff(p.date, last) <= days);
}

// Downsample to at most `max` evenly-spaced points (keeps first & last) for a small sparkline.
function downsample(points, max) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

// Value of the rolling series closest to `daysAgo` before its latest point.
function valueDaysAgo(points, daysAgo) {
  if (!points.length) return null;
  const last = points[points.length - 1].date;
  let best = null, bestGap = Infinity;
  for (const p of points) {
    const gap = Math.abs(dayDiff(p.date, last) - daysAgo);
    if (gap < bestGap) { bestGap = gap; best = p; }
  }
  return best ? best.value : null;
}

// Compact sparkline payload: rounded values + endpoint dates. Empty -> null.
function spark(points, decimals = 1) {
  if (points.length < 2) return null;
  const ds = downsample(points, 80);
  return { v: ds.map(p => round(p.value, decimals)), from: ds[0].date, to: ds[ds.length - 1].date };
}

/* ---------- stats + formatting helpers ---------- */
const meanOf = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const stdev = (xs) => { if (xs.length < 2) return 0; const m = meanOf(xs); return Math.sqrt(meanOf(xs.map(x => (x - m) ** 2))); };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
// night hours: shift after-midnight bedtimes (<12 -> +24) so 23:30 and 00:30 are 1h apart, not 23.
const wrapNight = (h) => (h < 12 ? h + 24 : h);
// decimal hour -> "HH:MM" (wraps >24 back into the day)
const clockStr = (h) => { h = ((h % 24) + 24) % 24; const H = Math.floor(h); let M = Math.round((h - H) * 60); let HH = H; if (M === 60) { M = 0; HH = (H + 1) % 24; } return String(HH).padStart(2, '0') + ':' + String(M).padStart(2, '0'); };
// decimal minutes/km -> "m:ss /km"
const paceStr = (min) => { const m = Math.floor(min); const s = Math.round((min - m) * 60); return (s === 60 ? (m + 1) + ':00' : m + ':' + String(s).padStart(2, '0')); };

// Generic daily-total trend (steps/exercise/distance/flights): 30-day average, Δ vs the prior
// 30 days (robust to a partial latest day), 7-day rolling sparkline. null when too sparse.
function dailyTrend(series, { floor = 0, dec = 0 } = {}) {
  if (!series || !series.length) return null;
  const daily = (floor ? series.filter(r => r.value >= floor) : series).map(r => ({ date: r.date, value: r.value }));
  if (daily.length < 7) return null;
  const roll = rollAvg(daily, 7);
  const last = daily[daily.length - 1].date;
  const last30 = lastDays(daily, 30);
  const prior30 = daily.filter(r => { const g = dayDiff(r.date, last); return g > 30 && g <= 60; });
  return {
    avg30: round(meanOf(last30.map(r => r.value)), dec),
    days30: last30.length,
    d30: prior30.length ? round(meanOf(last30.map(r => r.value)) - meanOf(prior30.map(r => r.value)), dec) : null,
    spark: spark(lastDays(roll, 90), dec),
  };
}

// Sparse signal trend (resting/walking HR, respiratory, wrist temp): daily mean -> latest +
// Δ vs ~30 days ago (rolling) + sparkline. null when absent.
function signalTrend(series, dec = 1) {
  if (!series || !series.length) return null;
  const daily = byDayMean(series);
  const roll = rollAvg(daily, 7);
  return {
    latest: round(daily[daily.length - 1].value, dec),
    latestDate: daily[daily.length - 1].date,
    d30: valueDaysAgo(roll, 30) != null ? round(roll[roll.length - 1].value - valueDaysAgo(roll, 30), dec) : null,
    spark: spark(lastDays(roll, 90), dec),
  };
}

/* ---------- body composition ---------- */
// Pure: weight + bodyfat + lean-mass series ([{date,value,source}] | null) -> baked body section.
function aggBody(w, bf, lean) {
  if (!w && !bf && !lean) return { hasData: false };
  const out = { hasData: true };

  if (w) {
    const daily = byDayMean(w);
    const roll = rollAvg(daily, 7);
    const latest = w[w.length - 1];
    out.weight = {
      latest: round(latest.value, 1),
      latestDate: latest.date,
      source: latest.source,
      sources: new Set(w.map(r => r.source)).size,
      d30: valueDaysAgo(roll, 30) != null ? round(roll[roll.length - 1].value - valueDaysAgo(roll, 30), 1) : null,
      d90: valueDaysAgo(roll, 90) != null ? round(roll[roll.length - 1].value - valueDaysAgo(roll, 90), 1) : null,
      spark: spark(lastDays(roll, 180), 1),
    };
  }

  if (bf) out.bodyfat = sparseBodyMetric(bf);
  if (lean) out.lean = sparseBodyMetric(lean);
  return out;
}
// Bioimpedance body metric (body fat, lean mass): compare WITHIN one scale only, and over a
// RECENT window. The source tag alone is not enough — the same app re-tags an old scale's
// readings, so a multi-year delta can straddle a scale switch (e.g. 22.8%→14.7% overnight). The
// window keeps Δ + sparkline to recent, comparable readings instead of celebrating that artifact.
const BODYCOMP_WINDOW = 150; // days
function sparseBodyMetric(series) {
  const recentSource = series[series.length - 1].source;
  const same = series.filter(r => r.source === recentSource);
  const latest = same[same.length - 1];
  const win = same.filter(r => dayDiff(r.date, latest.date) <= BODYCOMP_WINDOW);
  return {
    latest: round(latest.value, 1),
    latestDate: latest.date,
    source: recentSource,
    points: same.length,
    windowPoints: win.length,
    delta: win.length > 1 ? round(latest.value - win[0].value, 1) : null,
    spark: spark(win.map(r => ({ date: r.date, value: r.value })), 1),
  };
}
function buildBody() { return aggBody(readSeries('weight.csv'), readSeries('bodyfat.csv'), readSeries('leanmass.csv')); }

/* ---------- energy: expenditure (live) + balance (only if intake was logged enough) ----------
 * Honesty: intake logging in this dataset is sparse and abandoned, so a real deficit/surplus
 * usually can't be computed. We ALWAYS show expenditure (well-populated) and only add the
 * balance block when enough intake days exist in the recent logged window. Otherwise the page
 * says intake is insufficient and points to the nutritionist history for proven targets. */
const DIET_MIN_KCAL = 800;   // exclude partial / abandoned log days
const BASAL_LO = 1200, BASAL_HI = 2800; // sane resting-energy band (drops absent + double-count days)
const BALANCE_WINDOW = 90;   // days of logging to summarize (the recent cut, not 3 years)
const BALANCE_MIN_DAYS = 7;  // below this, intake is too sparse to claim a balance
// Pure: active + basal + dietary series -> baked energy section. Expenditure when the watch has
// enough days; balance + macro split only when intake was logged enough. Diet rows are
// [{date, value:kcal, p, c, g}]; macros surface only on days that logged them.
function aggEnergy(act, basal, diet) {
  if (!act || !basal) return { hasData: false };

  const aMap = {}; act.forEach(r => { aMap[r.date] = r.value; });
  const tdee = basal
    .filter(r => r.value >= BASAL_LO && r.value <= BASAL_HI)
    .map(r => ({ date: r.date, value: r.value + (aMap[r.date] || 0) }));
  if (tdee.length < 14) return { hasData: false };

  const roll = rollAvg(tdee, 7);
  const last30 = lastDays(tdee, 30);
  const out = {
    hasData: true,
    tdeeAvg: Math.round(meanOf(last30.map(r => r.value))),
    tdeeDays: last30.length,
    spark: spark(lastDays(roll, 90), 0),
    balance: null,
  };

  const intake = (diet || []).filter(r => r.value >= DIET_MIN_KCAL);
  out.intakeDays = intake.length;
  if (intake.length) {
    const lastLogged = intake[intake.length - 1].date;
    const tMap = {}; tdee.forEach(r => { tMap[r.date] = r.value; });
    const paired = intake
      .filter(r => dayDiff(r.date, lastLogged) <= BALANCE_WINDOW && tMap[r.date] != null)
      .map(r => ({ date: r.date, intake: r.value, p: r.p, c: r.c, g: r.g, tdee: tMap[r.date] }));
    out.lastIntake = lastLogged;
    out.balanceDays = paired.length;
    if (paired.length >= BALANCE_MIN_DAYS) {
      const avg = (k) => Math.round(meanOf(paired.map(x => x[k])));
      const intakeAvg = avg('intake'), tdeeAvg = avg('tdee');
      out.balance = {
        from: paired[0].date, to: paired[paired.length - 1].date, days: paired.length,
        intakeAvg, tdeeAvg, net: intakeAvg - tdeeAvg, // negative = deficit
      };
      // macro split over the logged days that recorded macros (Atwater % of kcal)
      const macroRows = paired.filter(x => x.p != null && x.c != null && x.g != null);
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
const avg2 = (rows, k) => Math.round(meanOf(rows.map(x => x[k])));
function buildEnergy() {
  return aggEnergy(readSeries('active-energy-daily.csv'), readSeries('basal-energy-daily.csv'), readDietary());
}

/* ---------- activity (NEAT + movement) ----------
 * Steps (NEAT), exercise minutes, distance, flights climbed. Each is a daily total -> 30-day
 * average + Δ vs the prior 30 days. Steps are deduped max-per-device by extract.js; near-zero
 * step/distance days (device not carried) are dropped as missing data, not low-movement days. */
const STEP_FLOOR = 200;   // steps below this = device left at home, not a real low-NEAT day
const DIST_FLOOR = 0.1;   // km; same idea for distance
function aggActivity(steps, exercise, distance, flights) {
  const out = { hasData: false };
  const add = (key, t) => { if (t) { out[key] = t; out.hasData = true; } };
  add('steps', dailyTrend(steps, { floor: STEP_FLOOR, dec: 0 }));
  add('exercise', dailyTrend(exercise, { dec: 0 }));
  add('distance', dailyTrend(distance, { floor: DIST_FLOOR, dec: 1 }));
  add('flights', dailyTrend(flights, { dec: 0 }));
  return out.hasData ? out : { hasData: false };
}
function buildActivity() {
  return aggActivity(
    readSeries('steps-daily.csv'), readSeries('exercise-minutes-daily.csv'),
    readSeries('distance-daily.csv'), readSeries('flights-daily.csv'),
  );
}

/* ---------- running performance ----------
 * RunningSpeed/Power/form are recorded only DURING outdoor runs with the watch, so coverage is
 * SPARSE (a handful of sessions, not a daily series). We therefore show the most recent sessions
 * as a readout, NOT a trend — and say how many sessions exist. pace = 60 / speed(km/h). */
const RUN_MIN_KMH = 5;  // drop sub-5 km/h rows (walking / GPS garbage) — these aren't runs
function aggRunning(rows) {
  if (!rows || !rows.length) return { hasData: false };
  const runs = rows.filter(r => r.speed != null && r.speed >= RUN_MIN_KMH);
  if (!runs.length) return { hasData: false };
  const sessions = runs.slice(-8).reverse().map(r => ({
    date: r.date,
    pace: paceStr(60 / r.speed),
    speed: round(r.speed, 1),
    power: r.power != null ? Math.round(r.power) : null,
    gct: r.gct != null ? Math.round(r.gct) : null,
    vosc: r.vosc != null ? round(r.vosc, 1) : null,
    stride: r.stride != null ? round(r.stride, 2) : null,
  }));
  return { hasData: true, count: runs.length, sessions };
}
function buildRunning() { return aggRunning(readRunning()); }

/* ---------- recovery ---------- */
const SLEEP_TARGET = 7.5;  // baseline.md: target 7.5–8 h; the highest-leverage recovery lever
// Pure: rhr + hrv + vo2max + sleep + respiratory + wrist-temp + walking-HR -> baked recovery section.
// sleep is [{date, value:hours, bedtime, waketime}] -> duration + consistency + bedtime regularity.
function aggRecovery(rhr, hrv, vo2, sleep, respiratory, wristTemp, walkingHr) {
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
    const daily = byDayMean(hrv); // several readings/day -> daily mean
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
      spark: spark(vo2.map(r => ({ date: r.date, value: r.value })), 1),
    };
  }
  if (sleep) {
    const last30 = lastDays(sleep, 30);
    const dur = last30.map(r => r.value);
    out.sleep = {
      avg: dur.length ? round(meanOf(dur), 1) : null,
      nights: dur.length,
      latestDate: sleep[sleep.length - 1].date,
      spark: spark(rollAvg(lastDays(sleep, 90), 7), 1),
      target: SLEEP_TARGET,
      pctTarget: dur.length ? Math.round(100 * dur.filter(h => h >= SLEEP_TARGET).length / dur.length) : null,
      sd: dur.length >= 2 ? round(stdev(dur), 1) : null, // night-to-night duration consistency
    };
    // bedtime / wake-time regularity (only nights with a clock; wrap after-midnight bedtimes)
    const bt = last30.filter(r => r.bedtime != null).map(r => wrapNight(r.bedtime));
    if (bt.length >= 7) { out.sleep.bedtime = clockStr(median(bt)); out.sleep.bedtimeSd = Math.round(stdev(bt) * 60); }
    const wt = last30.filter(r => r.waketime != null).map(r => r.waketime);
    if (wt.length >= 7) { out.sleep.wake = clockStr(median(wt)); out.sleep.wakeSd = Math.round(stdev(wt) * 60); }
  }
  // additional recovery signals (good direction noted on-screen): respiratory rate, wrist temp, walking HR
  const resp = signalTrend(respiratory, 1); if (resp) out.respiratory = resp;
  const temp = signalTrend(wristTemp, 2); if (temp) out.wristTemp = temp;
  const whr = signalTrend(walkingHr, 0); if (whr) out.walkingHr = whr;
  return out;
}
function buildRecovery() {
  return aggRecovery(
    readSeries('rhr.csv'), readSeries('hrv.csv'), readSeries('vo2max.csv'), readSleep(),
    readSeries('respiratory-daily.csv'), readSeries('wristTemp.csv'), readSeries('walking-hr-daily.csv'),
  );
}

/* ---------- assemble + bake ---------- */
function buildHealth() {
  return {
    body: buildBody(), activity: buildActivity(), energy: buildEnergy(),
    running: buildRunning(), recovery: buildRecovery(),
  };
}

function healthBlock() {
  return [
    '    /* GEN:HEALTH START — generated from apple-health extract CSVs by generate-health.js. DO NOT EDIT BY HAND. */',
    '    var HEALTH = ' + JSON.stringify(buildHealth()) + ';',
    '    /* GEN:HEALTH END */',
  ].join('\n');
}

const htmlPath = path.join(DIR, '..', 'nutrition', 'plan-web.html');
/* Pure: replace the GEN:HEALTH region in plan-web.html, return new text. Throws (not
   process.exit) on a missing marker so callers/tests can handle it. */
function buildHtml(html) {
  const re = /[ \t]*\/\* GEN:HEALTH START[\s\S]*?\/\* GEN:HEALTH END \*\//;
  if (!re.test(html)) throw new Error('GEN:HEALTH markers not found in plan-web.html');
  return html.replace(re, healthBlock());
}

function main() {
  fs.writeFileSync(htmlPath, buildHtml(fs.readFileSync(htmlPath, 'utf8')));
  const h = buildHealth();
  const on = Object.keys(h).filter(k => h[k].hasData);
  console.log('Generated: plan-web.html (GEN:HEALTH) — sections with data: ' + (on.length ? on.join(', ') : 'none (no extract CSVs)'));
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const h = buildHealth();
    console.log('Validation OK: HEALTH built — ' + Object.keys(h).map(k => k + '=' + (h[k].hasData ? 'data' : 'empty')).join(', '));
  } else main();
}

module.exports = {
  readSeries, readTable, readDietary, readRunning, readSleep,
  byDayMean, rollAvg, lastDays, downsample, valueDaysAgo, spark,
  meanOf, stdev, median, wrapNight, clockStr, paceStr, dailyTrend, signalTrend,
  aggBody, aggActivity, aggRunning, aggEnergy, aggRecovery,
  buildBody, buildActivity, buildRunning, buildEnergy, buildRecovery,
  buildHealth, healthBlock, buildHtml,
};
