/* Unit tests for lib/health/stats.mjs — pure stats/formatting helpers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  byDayMean, rollAvg, lastDays, downsample, valueDaysAgo, spark,
  meanOf, stdev, robustSd, median, wrapNight, roundTo, clockStr, paceStr, dailyTrend, signalTrend, avg30Of, d30Of,
} from './stats.mjs';

// helper: build a daily series of N consecutive days ending at `end`, value from fn(i). All-UTC.
function series(end, n, fn, source = 's') {
  const out = [];
  const base = new Date(end + 'T00:00:00Z');
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base); d.setUTCDate(d.getUTCDate() - i);
    out.push({ date: d.toISOString().slice(0, 10), value: fn(n - 1 - i), source });
  }
  return out;
}

test('byDayMean collapses multiple readings per day to the daily mean', () => {
  const m = byDayMean([
    { date: '2026-06-25', value: 100 },
    { date: '2026-06-25', value: 50 },
    { date: '2026-06-24', value: 80 },
  ]);
  assert.deepEqual(m, [{ date: '2026-06-24', value: 80 }, { date: '2026-06-25', value: 75 }]);
});

test('rollAvg is a trailing average over the window', () => {
  const pts = [10, 20, 30, 40].map((v, i) => ({ date: '2026-06-0' + (i + 1), value: v }));
  const r = rollAvg(pts, 2);
  assert.deepEqual(r.map((p) => p.value), [10, 15, 25, 35]);
});

test('lastDays windows by the series own latest date, not today: N days = N calendar days', () => {
  const pts = series('2020-01-31', 31, () => 1);
  assert.equal(lastDays(pts, 10).length, 10);
  assert.equal(lastDays(pts, 10)[0].date, '2020-01-22');
  assert.equal(lastDays(pts, 30).length, 30);
});

test('downsample keeps endpoints and caps the length', () => {
  const pts = series('2026-06-30', 200, (i) => i);
  const ds = downsample(pts, 80);
  assert.equal(ds.length, 80);
  assert.equal(ds[0].value, 0);
  assert.equal(ds[ds.length - 1].value, 199);
});

test('valueDaysAgo finds the point closest to N days before the latest', () => {
  const pts = series('2026-06-30', 60, (i) => i);
  assert.equal(valueDaysAgo(pts, 30), 29);
});

test('spark returns rounded values + endpoint dates, null below 2 points', () => {
  const sp = spark(series('2026-06-30', 5, (i) => i + 0.123), 1);
  assert.equal(sp.from, '2026-06-26');
  assert.equal(sp.to, '2026-06-30');
  assert.deepEqual(sp.v, [0.1, 1.1, 2.1, 3.1, 4.1]);
  assert.equal(spark([{ date: '2026-06-30', value: 1 }]), null);
});

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

test('meanOf averages a plain array of numbers', () => {
  assert.equal(meanOf([1, 2, 3]), 2);
});

test('dailyTrend needs at least 7 days and computes avg30/d30/spark', () => {
  assert.equal(dailyTrend([{ date: '2026-06-30', value: 1 }]), null, 'too sparse -> null');
  const s = series('2026-06-30', 40, () => 100);
  const t = dailyTrend(s, { dec: 0 });
  assert.equal(t.avg30, 100);
  assert.equal(t.days30, 30, 'the 30 days ending the day before the latest');
});

test('dailyTrend drops values below the floor (no-wear days)', () => {
  const s = series('2026-06-30', 40, () => 10000);
  s[s.length - 1].value = 0; // device left at home
  const t = dailyTrend(s, { floor: 200, dec: 0 });
  assert.equal(t.avg30, 10000, 'floored-out day excluded from the average');
});

test('signalTrend reports latest + Δ30 + sparkline for a sparse daily signal', () => {
  const s = series('2026-06-30', 40, (i) => 50 + i * 0.1);
  const t = signalTrend(s, 1);
  assert.equal(t.latestDate, '2026-06-30');
  assert.ok(t.d30 > 0, 'an upward series should show a positive 30-day delta');
});

test('roundTo rounds to a fixed number of decimals', () => {
  assert.equal(roundTo(1.005 * 1000, 0), 1005);
  assert.equal(roundTo(2.345, 1), 2.3);
  assert.equal(roundTo(7.25, 0), 7);
});

/* ---- today first: the latest value (and its date) leads, the 30-day mean is context ---- */
test('dailyTrend also reports the latest (floored) day and its date next to avg30', () => {
  const s = series('2026-06-30', 40, (i) => 100 + i);
  s[s.length - 1].value = 0; // device left at home on the newest day: not the headline
  const t = dailyTrend(s, { floor: 50, dec: 0 });
  assert.equal(t.latest, 138);
  assert.equal(t.latestDate, '2026-06-29');
  assert.equal(typeof t.avg30, 'number');
});

test('signalTrend also reports avg30 = mean of the daily values over the last 30 days', () => {
  const s = series('2026-06-30', 40, (i) => (i < 9 ? 10 : 20));
  const t = signalTrend(s, 1);
  assert.equal(t.latest, 20);
  assert.equal(t.avg30, 20, 'only the last 31 days (all 20) count');
});

test('dailyTrend: avg30 and its delta end the day BEFORE the latest, so a partial latest day never drags the mean', () => {
  const s = series('2026-06-30', 70, () => 10000);
  s[s.length - 1].value = 1500; // today, still in progress
  const t = dailyTrend(s, { floor: 200, dec: 0 });
  assert.equal(t.latest, 1500);
  assert.equal(t.avg30, 10000);
  assert.equal(t.d30, 0);
});

test('avg30Of / d30Of: mean of the daily values over the last 30 days; rolling change vs ~30 days ago; null-safe', () => {
  const daily = series('2026-06-30', 40, (i) => (i < 9 ? 10 : 20));
  assert.equal(avg30Of(daily, 1), 20);
  assert.equal(avg30Of([], 1), null);
  const up = series('2026-06-30', 40, (i) => i);
  assert.equal(d30Of(up, 0), 30);
  assert.equal(d30Of([], 0), null);
});

test('robustSd: MAD scaled to a normal sd; a few wild values barely move it (unlike stdev)', () => {
  assert.equal(robustSd([]), null);
  assert.equal(robustSd([5]), 0);
  const clean = [23, 23.5, 24, 23.5, 23, 24, 23.5];
  const dirty = clean.concat([18.3, 18.4]);
  assert.ok(Math.abs(robustSd(clean) - 1.4826 * 0.5) < 1e-9);
  assert.ok(robustSd(dirty) < 1, 'two outliers do not blow up the spread');
  assert.ok(stdev(dirty) > 2, 'while the plain sd does');
});

test('rollAvg is a CALENDAR window: sparse readings weeks apart are not averaged together', () => {
  const pts = [
    { date: '2026-01-01', value: 80 },
    { date: '2026-02-15', value: 78 },
    { date: '2026-02-18', value: 77 },
    { date: '2026-04-10', value: 75 },
  ];
  const r = rollAvg(pts, 7);
  assert.deepEqual(r.map((p) => p.value), [80, 78, 77.5, 75], 'only readings in (d-7, d] share a mean');
});

test('valueDaysAgo: null when the nearest point is more than 7 days from the target', () => {
  const pts = [{ date: '2026-01-01', value: 1 }, { date: '2026-03-01', value: 2 }];
  assert.equal(valueDaysAgo(pts, 30), null, 'no reading within a week of 30 days ago');
  const near = [{ date: '2026-01-25', value: 1 }, { date: '2026-03-01', value: 2 }];
  assert.equal(valueDaysAgo(near, 30), 1, '35 days ago is 5 days from the target: close enough');
});
