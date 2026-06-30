/* Tests for the health ("Salud") tab generator. Zero dependencies — Node's built-in
 * runner:  node --test  (from repo root) or  npm test.
 * The aggregators are PURE (take parsed series, no disk), so these stay deterministic and
 * green on a fresh clone with no Apple Health export. buildHtml is tested against the real
 * plan-web.html, which always exists. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const gen = require('./generate-health.js');

const {
  byDayMean, rollAvg, lastDays, downsample, valueDaysAgo, spark,
  stdev, median, wrapNight, clockStr, paceStr,
  aggBody, aggActivity, aggRunning, aggEnergy, aggRecovery, aggLoadRecovery, healthBlock, buildHtml,
} = gen;
const htmlPath = path.join(__dirname, '..', 'nutrition', 'plan-web.html');

// helper: build a daily series of N consecutive days ending at `end`, value from fn(i).
// All-UTC (parse with Z, setUTCDate, toISOString) so the date math never shifts a day
// under a non-UTC test runner — the generator reads CSV date strings verbatim, so it is
// immune to this; only this synthetic-date helper has to be careful.
function series(end, n, fn, source = 's') {
  const out = [];
  const base = new Date(end + 'T00:00:00Z');
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base); d.setUTCDate(d.getUTCDate() - i);
    out.push({ date: d.toISOString().slice(0, 10), value: fn(n - 1 - i), source });
  }
  return out;
}

/* ---------- pure helpers ---------- */

test('byDayMean collapses multiple readings per day to the daily mean', () => {
  const m = byDayMean([
    { date: '2026-06-25', value: 100 },
    { date: '2026-06-25', value: 50 }, // HRV-style: several readings same day
    { date: '2026-06-24', value: 80 },
  ]);
  assert.deepEqual(m, [{ date: '2026-06-24', value: 80 }, { date: '2026-06-25', value: 75 }]);
});

test('rollAvg is a trailing average over the window', () => {
  const pts = [10, 20, 30, 40].map((v, i) => ({ date: '2026-06-0' + (i + 1), value: v }));
  const r = rollAvg(pts, 2);
  assert.deepEqual(r.map(p => p.value), [10, 15, 25, 35]); // each = mean of itself + prev
});

test('lastDays windows by the series own latest date, not today', () => {
  const pts = series('2020-01-31', 31, () => 1); // an old series
  assert.equal(lastDays(pts, 10).length, 11); // last 10 days inclusive = 11 points
});

test('downsample keeps endpoints and caps the length', () => {
  const pts = series('2026-06-30', 200, i => i);
  const ds = downsample(pts, 80);
  assert.equal(ds.length, 80);
  assert.equal(ds[0].value, 0);
  assert.equal(ds[ds.length - 1].value, 199);
});

test('valueDaysAgo finds the point closest to N days before the latest', () => {
  const pts = series('2026-06-30', 60, i => i); // value i on day i
  assert.equal(valueDaysAgo(pts, 30), 29); // ~30 days before the last (value 59) -> value 29
});

test('spark returns rounded values + endpoint dates, null below 2 points', () => {
  const sp = spark(series('2026-06-30', 5, i => i + 0.123), 1);
  assert.equal(sp.from, '2026-06-26');
  assert.equal(sp.to, '2026-06-30');
  assert.deepEqual(sp.v, [0.1, 1.1, 2.1, 3.1, 4.1]);
  assert.equal(spark([{ date: '2026-06-30', value: 1 }]), null);
});

/* ---------- body composition ---------- */

test('aggBody trends weight and compares body fat WITHIN one scale only', () => {
  const w = series('2026-06-30', 40, i => 80 - i * 0.1, 'scale-a');
  // bodyfat from two scales — only the most-recent source must be used
  const bf = [
    { date: '2024-01-01', value: 24, source: 'scale-b' },
    { date: '2026-05-01', value: 18, source: 'scale-a' },
    { date: '2026-06-01', value: 16, source: 'scale-a' },
  ];
  const out = aggBody(w, bf);
  assert.equal(out.hasData, true);
  assert.equal(out.bodyfat.source, 'scale-a');
  assert.equal(out.bodyfat.points, 2, 'scale-b reading excluded — never mix scales');
  assert.equal(out.bodyfat.delta, -2, '16 - 18, within scale-a only (not vs the 24 on scale-b)');
  assert.equal(out.weight.latest, 76.1);
});

test('aggBody returns empty state when neither series exists', () => {
  assert.deepEqual(aggBody(null, null), { hasData: false });
});

/* ---------- energy (honesty: expenditure always, balance only if logged enough) ---------- */

test('aggEnergy shows expenditure but withholds the balance when intake is too sparse', () => {
  const act = series('2026-06-30', 60, () => 600);
  const basal = series('2026-06-30', 60, () => 1800);
  const diet = [ // only 3 logged days in the window -> below BALANCE_MIN_DAYS
    { date: '2026-06-28', value: 2000 }, { date: '2026-06-29', value: 2100 }, { date: '2026-06-30', value: 1900 },
  ];
  const out = aggEnergy(act, basal, diet);
  assert.equal(out.hasData, true);
  assert.equal(out.tdeeAvg, 2400, 'active 600 + basal 1800');
  assert.equal(out.balance, null, 'too few intake days to claim a deficit');
  assert.equal(out.balanceDays, 3);
});

test('aggEnergy computes the historical balance once enough intake days exist', () => {
  const act = series('2026-06-30', 60, () => 500);
  const basal = series('2026-06-30', 60, () => 1700);
  const diet = series('2026-06-30', 20, () => 1800); // 20 logged days, all >= DIET_MIN_KCAL
  const out = aggEnergy(act, basal, diet);
  assert.ok(out.balance, 'balance should be present');
  assert.equal(out.balance.intakeAvg, 1800);
  assert.equal(out.balance.tdeeAvg, 2200);
  assert.equal(out.balance.net, -400, 'negative = deficit');
});

test('aggEnergy drops implausible basal readings (double-counts / no-wear)', () => {
  const act = series('2026-06-30', 30, () => 500);
  const basal = series('2026-06-30', 30, () => 1800);
  basal[basal.length - 1].value = 3625; // a known double-count spike must be excluded
  const out = aggEnergy(act, basal, null);
  assert.equal(out.hasData, true);
  assert.equal(out.tdeeAvg, 2300, 'spike day excluded, so avg stays at 500+1800');
});

test('aggEnergy returns empty state without expenditure series', () => {
  assert.deepEqual(aggEnergy(null, null, null), { hasData: false });
});

test('aggEnergy surfaces the macro split when intake logged protein/carb/fat', () => {
  const act = series('2026-06-30', 60, () => 500);
  const basal = series('2026-06-30', 60, () => 1700);
  // 20 logged days with macros: 150 p / 200 c / 60 g -> 1400+800+540... use round values
  const diet = series('2026-06-30', 20, () => 2000).map(r => ({ ...r, p: 150, c: 200, g: 67 }));
  const out = aggEnergy(act, basal, diet);
  assert.ok(out.macros, 'macro block present when macros logged');
  assert.equal(out.macros.p, 150);
  assert.equal(out.macros.pPct + out.macros.cPct + out.macros.gPct, 100, 'macro %s sum to 100');
});

/* ---------- activity (NEAT + movement) ---------- */

test('aggActivity trends steps and drops no-wear days from the NEAT average', () => {
  const steps = series('2026-06-30', 40, () => 10000);
  steps[steps.length - 1].value = 0;   // device left at home -> not a real low-NEAT day
  steps[steps.length - 2].value = 50;
  const out = aggActivity(steps, null, null, null);
  assert.equal(out.hasData, true);
  assert.equal(out.steps.avg30, 10000, 'no-wear days excluded, average stays clean');
  assert.ok(out.steps.days30 >= 30);
});

test('aggActivity surfaces exercise/distance/flights independently', () => {
  const ex = series('2026-06-30', 40, () => 45);
  const dist = series('2026-06-30', 40, () => 8.2);
  const out = aggActivity(null, ex, dist, null);
  assert.equal(out.hasData, true);
  assert.equal(out.exercise.avg30, 45);
  assert.equal(out.distance.avg30, 8.2, 'distance keeps 1 decimal');
});

test('aggActivity returns empty state when no series exist', () => {
  assert.deepEqual(aggActivity(null, null, null, null), { hasData: false });
});

/* ---------- running performance (sparse sessions, not a trend) ---------- */

test('aggRunning shows recent sessions newest-first with pace from speed', () => {
  const rows = [
    { date: '2026-05-02', speed: 11.69, power: 269, gct: 235, vosc: 10.3, stride: 1.20 },
    { date: '2026-06-22', speed: 10.0, power: 240, gct: 250, vosc: 10.0, stride: 1.10 },
    { date: '2026-06-25', speed: 3.0, power: null, gct: null, vosc: null, stride: null }, // a walk -> dropped
  ];
  const out = aggRunning(rows);
  assert.equal(out.hasData, true);
  assert.equal(out.count, 2, 'sub-5 km/h walk excluded');
  assert.equal(out.sessions[0].date, '2026-06-22', 'newest first');
  assert.equal(out.sessions[0].pace, '6:00', '10 km/h -> 6:00 /km');
  assert.equal(out.sessions[1].pace, '5:08', '11.69 km/h -> 5:08 /km');
});

test('aggRunning returns empty state with no runs', () => {
  assert.deepEqual(aggRunning(null), { hasData: false });
  assert.deepEqual(aggRunning([{ date: '2026-06-25', speed: 4 }]), { hasData: false });
});

/* ---------- recovery ---------- */

test('aggRecovery averages HRV per day and exposes the good-direction trends', () => {
  const rhr = series('2026-06-30', 60, i => 50 - i * 0.05, 'Watch');
  const hrv = series('2026-06-30', 60, () => 60).concat([{ date: '2026-06-30', value: 100, source: 'Watch' }]);
  const vo2 = series('2026-06-30', 10, i => 40 + i, 'Watch');
  const sleep = series('2026-06-30', 40, () => 7, 'Watch');
  const out = aggRecovery(rhr, hrv, vo2, sleep);
  assert.equal(out.hasData, true);
  assert.equal(out.vo2max.first, 40);
  assert.equal(out.vo2max.latest, 49);
  assert.equal(out.sleep.nights, 31, 'last 30 days inclusive');
  assert.ok(out.rhr.spark && out.hrv.spark, 'trends render');
});

test('aggRecovery scores sleep consistency, target adherence and bedtime regularity', () => {
  // 40 nights: 7.5h on even days, 6.5h on odd -> avg 7.0, half hit the 7.5 target
  const sleep = series('2026-06-30', 40, i => (i % 2 ? 6.5 : 7.5), 'Watch')
    .map((r, i) => ({ ...r, bedtime: 23.5 + (i % 2 ? 0.5 : 0), waketime: 7 }));
  const out = aggRecovery(null, null, null, sleep);
  assert.equal(out.sleep.target, 7.5);
  assert.ok(out.sleep.pctTarget >= 45 && out.sleep.pctTarget <= 55, 'about half the nights hit 7.5h');
  assert.ok(out.sleep.sd > 0, 'duration varies -> non-zero consistency sd');
  assert.ok(out.sleep.bedtime, 'median bedtime computed');
  assert.equal(typeof out.sleep.bedtimeSd, 'number', 'bedtime regularity in minutes');
});

test('aggRecovery surfaces respiratory / wrist-temp / walking-HR signals', () => {
  const resp = series('2026-06-30', 40, () => 16, 'Watch');
  const temp = series('2026-06-30', 30, () => 35.8, 'Watch');
  const whr = series('2026-06-30', 30, () => 70, 'Watch');
  const out = aggRecovery(null, null, null, null, resp, temp, whr);
  assert.equal(out.hasData, true);
  assert.equal(out.respiratory.latest, 16);
  assert.equal(out.wristTemp.latest, 35.8);
  assert.equal(out.walkingHr.latest, 70);
});

test('aggRecovery returns empty state when no recovery series exist', () => {
  assert.deepEqual(aggRecovery(null, null, null, null), { hasData: false });
});

/* ---------- load vs recovery (cross-tab) ---------- */

test('aggLoadRecovery builds weekly HR-weighted load aligned to recovery, ignoring HR-less sessions', () => {
  const workouts = [
    { date: '2026-06-24', dur: 30, hrAvg: 140 },  // Wed -> week 2026-06-22; 30*140/100 = 42
    { date: '2026-06-25', dur: 20, hrAvg: 150 },  // same week;            20*150/100 = 30 -> 72
    { date: '2026-06-26', dur: 60, hrAvg: null },  // no HR -> excluded from load
  ];
  const hrv = series('2026-06-28', 14, () => 60);
  const rhr = series('2026-06-28', 14, () => 48);
  const out = aggLoadRecovery(workouts, hrv, rhr);
  assert.equal(out.hasData, true);
  assert.equal(out.weeks, 12);
  assert.equal(out.series.length, 12, 'always 12 weekly slots');
  const wk = out.series.find(s => s.w === '2026-06-22');
  assert.equal(wk.load, 72, 'Σ(min × avgHR)/100, HR-less session excluded');
  assert.equal(wk.hrv, 60);
  assert.equal(wk.rhr, 48);
});

test('aggLoadRecovery needs HR-tagged workouts AND at least one recovery marker', () => {
  const hrv = series('2026-06-28', 14, () => 60);
  assert.deepEqual(aggLoadRecovery(null, hrv, null), { hasData: false });
  assert.deepEqual(aggLoadRecovery([{ date: '2026-06-24', dur: 30, hrAvg: null }], hrv, null), { hasData: false });
  assert.deepEqual(aggLoadRecovery([{ date: '2026-06-24', dur: 30, hrAvg: 140 }], null, null), { hasData: false });
});

test('aggLoadRecovery splits high- vs low-load weeks for an honest recovery read', () => {
  const workouts = [
    { date: '2026-06-03', dur: 60, hrAvg: 150 }, // week 06-01, load 90 (heavy)
    { date: '2026-06-10', dur: 30, hrAvg: 100 }, // week 06-08, load 30 (light)
    { date: '2026-06-17', dur: 60, hrAvg: 150 }, // week 06-15, load 90 (heavy)
    { date: '2026-06-24', dur: 30, hrAvg: 100 }, // week 06-22, load 30 (light)
  ];
  // HRV lower in the heavy weeks, higher in the light weeks (one reading per week)
  const hrv = [
    { date: '2026-06-03', value: 50 }, { date: '2026-06-10', value: 70 },
    { date: '2026-06-17', value: 52 }, { date: '2026-06-24', value: 72 },
  ];
  const out = aggLoadRecovery(workouts, hrv, null);
  assert.equal(out.split.hrvHigh, 51, 'mean HRV in heavy weeks');
  assert.equal(out.split.hrvLow, 71, 'mean HRV in light weeks');
  assert.ok(out.split.hrvHigh < out.split.hrvLow, 'heavier load weeks show lower HRV');
  assert.equal(out.split.rhrHigh, null, 'no RHR series -> null, never fabricated');
});

/* ---------- formatting helpers ---------- */

test('paceStr converts decimal minutes/km to m:ss', () => {
  assert.equal(paceStr(5 + 8 / 60), '5:08');
  assert.equal(paceStr(6), '6:00');
  assert.equal(paceStr(4.999), '5:00', 'rolls 59.94s up to the next minute');
});

test('clockStr + wrapNight handle after-midnight bedtimes', () => {
  assert.equal(clockStr(23.5), '23:30');
  assert.equal(wrapNight(0.5), 24.5, 'after-midnight shifted onto the night scale');
  assert.equal(clockStr(24.5), '00:30', 'and wraps back for display');
});

test('stdev + median are correct', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(stdev([2, 2, 2]), 0);
});

/* ---------- baking / HTML wiring ---------- */

test('healthBlock emits a valid JS HEALTH object', () => {
  const block = healthBlock();
  assert.match(block, /var HEALTH = /);
  assert.doesNotThrow(() => new Function(block + '\nreturn HEALTH;'), 'baked HEALTH must be valid JS');
});

test('buildHtml replaces the GEN:HEALTH region and is idempotent', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const once = buildHtml(html);
  assert.match(once, /GEN:HEALTH START/);
  assert.match(once, /var HEALTH = /);
  assert.equal(buildHtml(once), once, 're-running buildHtml on its own output must be a no-op');
});

test('buildHtml throws when GEN:HEALTH markers are missing', () => {
  assert.throws(() => buildHtml('<html>no markers</html>'), /GEN:HEALTH markers not found/);
});
