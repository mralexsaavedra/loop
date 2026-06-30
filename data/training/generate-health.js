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

/* ---------- body composition ---------- */
// Pure: weight + bodyfat series ([{date,value,source}] | null) -> baked body section.
function aggBody(w, bf) {
  if (!w && !bf) return { hasData: false };
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

  if (bf) {
    // compare WITHIN one scale: keep only the most-recent source's readings.
    const recentSource = bf[bf.length - 1].source;
    const same = bf.filter(r => r.source === recentSource);
    const latest = same[same.length - 1];
    out.bodyfat = {
      latest: round(latest.value, 1),
      latestDate: latest.date,
      source: recentSource,
      points: same.length,
      delta: same.length > 1 ? round(latest.value - same[0].value, 1) : null,
      spark: spark(same.map(r => ({ date: r.date, value: r.value })), 1),
    };
  }
  return out;
}
function buildBody() { return aggBody(readSeries('weight.csv'), readSeries('bodyfat.csv')); }

/* ---------- energy: expenditure (live) + balance (only if intake was logged enough) ----------
 * Honesty: intake logging in this dataset is sparse and abandoned, so a real deficit/surplus
 * usually can't be computed. We ALWAYS show expenditure (well-populated) and only add the
 * balance block when enough intake days exist in the recent logged window. Otherwise the page
 * says intake is insufficient and points to the nutritionist history for proven targets. */
const DIET_MIN_KCAL = 800;   // exclude partial / abandoned log days
const BASAL_LO = 1200, BASAL_HI = 2800; // sane resting-energy band (drops absent + double-count days)
const BALANCE_WINDOW = 90;   // days of logging to summarize (the recent cut, not 3 years)
const BALANCE_MIN_DAYS = 7;  // below this, intake is too sparse to claim a balance
// Pure: active + basal + dietary series -> baked energy section (expenditure always; balance if logged enough).
function aggEnergy(act, basal, diet) {
  if (!act || !basal) return { hasData: false };

  // TDEE per day = active + basal, only on days with a plausible basal reading (watch had data).
  const aMap = {}; act.forEach(r => { aMap[r.date] = r.value; });
  const tdee = basal
    .filter(r => r.value >= BASAL_LO && r.value <= BASAL_HI)
    .map(r => ({ date: r.date, value: r.value + (aMap[r.date] || 0) }));
  if (tdee.length < 14) return { hasData: false };

  const roll = rollAvg(tdee, 7);
  const last30 = lastDays(tdee, 30);
  const out = {
    hasData: true,
    tdeeAvg: Math.round(last30.reduce((s, r) => s + r.value, 0) / last30.length),
    tdeeDays: last30.length,
    spark: spark(lastDays(roll, 90), 0),
    balance: null,
  };

  // balance only when intake was actually logged enough in its last window
  const intake = (diet || []).filter(r => r.value >= DIET_MIN_KCAL);
  out.intakeDays = intake.length;
  if (intake.length) {
    const lastLogged = intake[intake.length - 1].date;
    const tMap = {}; tdee.forEach(r => { tMap[r.date] = r.value; });
    const paired = intake
      .filter(r => dayDiff(r.date, lastLogged) <= BALANCE_WINDOW && tMap[r.date] != null)
      .map(r => ({ date: r.date, intake: r.value, tdee: tMap[r.date] }));
    out.lastIntake = lastLogged;
    out.balanceDays = paired.length;
    if (paired.length >= BALANCE_MIN_DAYS) {
      const avg = (k) => Math.round(paired.reduce((s, x) => s + x[k], 0) / paired.length);
      const intakeAvg = avg('intake'), tdeeAvg = avg('tdee');
      out.balance = {
        from: paired[0].date, to: paired[paired.length - 1].date, days: paired.length,
        intakeAvg, tdeeAvg, net: intakeAvg - tdeeAvg, // negative = deficit
      };
    }
  }
  return out;
}
function buildEnergy() {
  return aggEnergy(readSeries('active-energy-daily.csv'), readSeries('basal-energy-daily.csv'), readSeries('dietary-daily.csv'));
}

/* ---------- recovery ---------- */
// Pure: rhr + hrv + vo2max + sleep series -> baked recovery section.
function aggRecovery(rhr, hrv, vo2, sleep) {
  if (!rhr && !hrv && !vo2 && !sleep) return { hasData: false };
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
    out.sleep = {
      avg: last30.length ? round(last30.reduce((s, r) => s + r.value, 0) / last30.length, 1) : null,
      nights: last30.length,
      latestDate: sleep[sleep.length - 1].date,
      spark: spark(rollAvg(lastDays(sleep, 90), 7), 1),
    };
  }
  return out;
}
function buildRecovery() {
  return aggRecovery(readSeries('rhr.csv'), readSeries('hrv.csv'), readSeries('vo2max.csv'), readSeries('sleep-daily.csv'));
}

/* ---------- assemble + bake ---------- */
function buildHealth() {
  return { body: buildBody(), energy: buildEnergy(), recovery: buildRecovery() };
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
  readSeries, byDayMean, rollAvg, lastDays, downsample, valueDaysAgo, spark,
  aggBody, aggEnergy, aggRecovery, buildBody, buildEnergy, buildRecovery,
  buildHealth, healthBlock, buildHtml,
};
