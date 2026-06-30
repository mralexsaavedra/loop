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
  aggBody, aggEnergy, aggRecovery, healthBlock, buildHtml,
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

test('aggRecovery returns empty state when no recovery series exist', () => {
  assert.deepEqual(aggRecovery(null, null, null, null), { hasData: false });
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
