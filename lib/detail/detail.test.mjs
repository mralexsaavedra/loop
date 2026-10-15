/* Detail views bake (lib/detail/detail.mjs): compact daily series for the last 365 days per metric,
 * built with the SAME readers / rules as the cards (clamped day median, max-per-device totals,
 * latest-source body composition, the shared same-day workout rule). Synthetic series only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DETAIL_DAYS, TOTAL_BAND_DAYS, denseSeries, quartileBand, sessionSource, sessionsFromRows, rollingRecovery,
  detailFromInputs, DETAIL_KEYS, detailFrom,
} from './detail.mjs';
import { fileURLToPath } from 'node:url';
import { readExtract } from '../extract/read.mjs';
import { monitorCard } from '../score/monitor.mjs';
import { recoveryFromInputs, DAY_BAND_CUTOFF, BAND_CUTOFF } from '../score/recovery.mjs';
import { modalitySeries } from '../score/series.mjs';
import { typicalDay, loadFromSeries } from '../score/load.mjs';
import { aggEnergy, BODYCOMP_WINDOW } from '../health/aggregate.mjs';
import { LEVEL_MIN } from '../training/activity.mjs';
import { addDays } from '../date.mjs';

const AS_OF = '2026-09-29';
const wig = (i) => ((i * 7) % 5) - 2; // -2..2, deterministic
const series = (n, fn, asOf = AS_OF) => Array.from({ length: n }, (_, i) => ({ date: addDays(asOf, i - (n - 1)), ...fn(i) }));

test('denseSeries: one slot per calendar day from the first dated value (>= from) to the last, null for missing, rounded', () => {
  const daily = [{ date: '2026-09-01', value: 1.234 }, { date: '2026-09-03', value: 2 }, { date: '2026-08-01', value: 9 }].sort((a, b) => (a.date < b.date ? -1 : 1));
  assert.deepEqual(denseSeries(daily, '2026-08-15', 1), { start: '2026-09-01', v: [1.2, null, 2] });
  assert.equal(denseSeries([], '2026-08-15', 1), null);
  assert.equal(denseSeries(daily.slice(0, 1), '2026-08-15', 1), null, 'nothing inside the window');
});

test('quartileBand: the middle half (p25..p75) + median of the 90 days BEFORE the latest (a partial day never sets its own band), null under 14 days', () => {
  assert.equal(TOTAL_BAND_DAYS, 90);
  const daily = series(100, (i) => ({ value: i < 99 ? 1000 * (1 + (i % 4)) : 99999 }));
  const b = quartileBand(daily, 0);
  assert.deepEqual(b, { lo: 2000, median: 2500, hi: 3000 });
  assert.equal(quartileBand(daily.slice(-10), 0), null);
});

test('sessionSource: the precedence family (device owner names stripped), any other app keeps its name', () => {
  assert.equal(sessionSource('Apple Watch de Someone'), 'Apple Watch');
  assert.equal(sessionSource('Strava API'), 'Strava');
  assert.equal(sessionSource('Strava'), 'Strava');
  assert.equal(sessionSource('Hevy'), 'Hevy');
  assert.equal(sessionSource(''), '');
});

test('sessionsFromRows: one entry per date + modality after the shared DISPLAY rule (stubs dropped, the Strava copy wins), fields summed, HR weighted', () => {
  const rows = [
    { date: '2026-09-20', type: 'Cycling', dur: 60, dist: 20, hrAvg: 140, re: 50, kj: 600, elev: 200, source: 'Strava API' },
    { date: '2026-09-20', type: 'Cycling', dur: 62, dist: null, hrAvg: 138, re: null, kj: null, elev: null, source: 'Apple Watch de X' }, // copy
    { date: '2026-09-21', type: 'HighIntensityIntervalTraining', dur: 30, dist: null, hrAvg: 150, re: null, kj: null, elev: null, source: 'Apple Watch de X' },
    { date: '2026-09-21', type: 'HighIntensityIntervalTraining', dur: 10, dist: null, hrAvg: 120, re: null, kj: null, elev: null, source: 'Apple Watch de X' },
    { date: '2026-09-21', type: 'Walking', dur: 2, dist: 0.1, hrAvg: null, re: null, kj: null, elev: null, source: 'Apple Watch de X' }, // stub
    { date: '2026-08-01', type: 'Running', dur: 30, dist: 5, hrAvg: 150, re: 40, kj: null, elev: 10, source: 'Strava API' }, // before `from`
  ];
  const out = sessionsFromRows(rows, '2026-09-01');
  assert.deepEqual(out, [
    { d: '2026-09-20', m: 'bike', t: 'Cycling', min: 60, km: 20, el: 200, hr: 140, re: 50, n: 1, src: 'Strava' },
    { d: '2026-09-21', m: 'gym', t: 'HighIntensityIntervalTraining', min: 40, hr: 143, n: 2, src: 'Apple Watch' },
  ]);
});

test('sessionsFromRows: HR zones (workout-zones.csv) attach per date + modality, summed, with the max HR seen; none -> no z', () => {
  const rows = [
    { date: '2026-09-20', type: 'Cycling', dur: 60, dist: 20, hrAvg: 140, re: 50, kj: 600, elev: 200, source: 'Strava API' },
    { date: '2026-09-21', type: 'Running', dur: 30, dist: 5, hrAvg: 150, re: 40, kj: null, elev: 10, source: 'Strava API' },
    { date: '2026-09-22', type: 'TraditionalStrengthTraining', dur: 50, dist: null, hrAvg: 120, re: 30, kj: null, elev: null, source: 'Apple Watch de X' },
  ];
  const zones = [
    { date: '2026-09-20', id: '1', type: 'Cycling', maxHr: 190, maxSrc: 'observed', hrAvg: 140, hrMax: 171, z: [60, 600, 1200, 900, 300, 0] },
    { date: '2026-09-20', id: '2', type: 'Cycling', maxHr: 190, maxSrc: 'observed', hrAvg: 120, hrMax: 150, z: [0, 100, 0, 0, 0, 0] },
    { date: '2026-09-21', id: '3', type: 'Running', maxHr: 190, maxSrc: 'observed', hrAvg: 150, hrMax: null, z: [0, 0, 0, 0, 0, 0] },
    { date: '2026-08-01', id: '4', type: 'Running', maxHr: 190, maxSrc: 'observed', hrAvg: 150, hrMax: 180, z: [1, 1, 1, 1, 1, 1] },
  ];
  const out = sessionsFromRows(rows, '2026-09-01', zones);
  assert.deepEqual(out[0].z, [60, 700, 1200, 900, 300, 0]);
  assert.equal(out[0].hx, 171);
  assert.equal(out[1].z, undefined, 'all-zero zones = no zones');
  assert.equal(out[2].z, undefined, 'no zones row for the gym session');
  assert.deepEqual(sessionsFromRows(rows, '2026-09-01'), sessionsFromRows(rows, '2026-09-01', null));
});

test('detailFromInputs: zoneMax = the max HR (and its source) the newest zones row was cut with; absent without zones', () => {
  const workouts = [{ date: '2026-09-20', type: 'Running', dur: 30, dist: 5, hrAvg: 150, re: 40, kj: null, elev: null, source: 'Strava API' }];
  const zones = [{ date: '2026-09-20', id: '1', type: 'Running', maxHr: 188, maxSrc: 'profile', hrAvg: 150, hrMax: 170, z: [0, 0, 600, 1200, 0, 0] }];
  const d = detailFromInputs({ workouts, zones });
  assert.deepEqual(d.zoneMax, { hr: 188, src: 'profile' });
  assert.deepEqual(d.sessions[0].z, [0, 0, 600, 1200, 0, 0]);
  assert.equal(detailFromInputs({ workouts }).zoneMax, undefined);
});

test('rollingRecovery: each day = the composite the dial showed THAT morning (inputs cut at the day, its own baseline); t7 = that day\'s 7-day trend', () => {
  const n = 80;
  const hrv = series(n, (i) => ({ value: 60 + wig(i) * 2 }));
  const rhr = series(n, (i) => ({ value: 50 + wig(i) * 0.5 }));
  const sleep = series(n, (i) => ({ value: 7.5 + wig(i) * 0.2, bedtime: 23, waketime: 7 }));
  const from = addDays(AS_OF, -20);
  const r = rollingRecovery({ hrv, rhr, sleep }, from, AS_OF);
  assert.equal(r.start, from);
  assert.equal(r.v.length, 21);
  const today = recoveryFromInputs({ hrv, rhr, sleep });
  assert.equal(r.v[20], today.today.value, 'the newest day equals the dial');
  assert.equal(r.t7[20], today.trend7);
  const cut = (rows, t) => rows.filter((x) => x.date <= t);
  const t = addDays(AS_OF, -10);
  const then = recoveryFromInputs({ hrv: cut(hrv, t), rhr: cut(rhr, t), sleep: cut(sleep, t) });
  assert.equal(r.v[10], then.today.value, 'an older day is scored against the baseline it had then');
  // a day with no data at all is a gap, never 0
  const gap = rollingRecovery({ hrv: hrv.filter((x) => x.date !== t), rhr: rhr.filter((x) => x.date !== t), sleep: sleep.filter((x) => x.date !== t) }, from, AS_OF);
  assert.equal(gap.v[10], null);
  assert.equal(rollingRecovery({ hrv: [], rhr: [], sleep: [] }, from, AS_OF), null);
});

function fullInputs() {
  const n = 400;
  return {
    sleep: series(n, (i) => ({ value: i === n - 3 ? NaN : 7 + wig(i) * 0.3, bedtime: 23 + wig(i) * 0.1, waketime: 7,
      rem: 1.55 + wig(i) * 0.11, deep: 1.05 + wig(i) * 0.07, core: 4.4 + wig(i) * 0.13, unspec: 0, awake: 0.35 + wig(i) * 0.03, inbed: 7.8 + wig(i) * 0.3 })).filter((r) => Number.isFinite(r.value)),
    hrv: series(n, (i) => ({ value: 55 + wig(i) * 3 })).flatMap((r) => [r, { ...r, value: r.value + 1 }, { ...r, value: r.value - 1 }]),
    rhr: series(n, (i) => ({ value: 52 + wig(i) })),
    respiratory: series(n, (i) => ({ value: 14.5 + wig(i) * 0.2 })),
    wristTemp: series(n, (i) => ({ value: 35.8 + wig(i) * 0.1 })),
    walkingHr: series(n, (i) => ({ value: 95 + wig(i) })),
    vo2max: series(n, (i) => ({ value: 45 + (i % 30 === 0 ? 1 : 0) })).filter((_, i) => i % 30 === 0),
    steps: series(n, (i) => ({ value: i === n - 5 ? 50 : 8000 + wig(i) * 1000 })),
    exercise: series(n, (i) => ({ value: 30 + wig(i) * 5 })),
    distance: series(n, (i) => ({ value: 6 + wig(i) * 0.5 })),
    flights: series(n, (i) => ({ value: 10 + wig(i) })),
    active: series(n, (i) => ({ value: 600 + wig(i) * 50 })),
    basal: series(n, (i) => ({ value: i === n - 2 ? 5000 : 1700 })),
    weight: series(n, (i) => ({ value: 80 + wig(i) * 0.2, source: 'Scale' })).filter((_, i) => i % 3 === 0),
    bodyfat: [...series(n, (i) => ({ value: 18 + wig(i) * 0.1, source: i < 300 ? 'Old' : 'New' })).filter((_, i) => i % 7 === 0)],
    lean: null,
    waist: [{ date: addDays(AS_OF, -40), value: 85, source: 'Tape' }, { date: addDays(AS_OF, -5), value: 84.2, source: 'Tape' }],
    workouts: series(n, (i) => ({ type: i % 3 === 0 ? 'Running' : i % 3 === 1 ? 'HighIntensityIntervalTraining' : 'Cycling', dur: 45, dist: i % 3 === 1 ? null : 8, hrAvg: 140, re: i % 5 === 0 ? null : 40 + wig(i) * 5, kj: null, elev: null, source: 'Strava API' }))
      .filter((_, i) => i % 2 === 0),
    // the last 30 days: one 12-hour block of Watch heart rate a day + a run every third day
    hrHourly: series(30, (i) => ({ cov: 720, hist: new Map([[100 + (i % 7), 1800 + (i % 5) * 300]]) })),
    zones: series(30, () => ({ type: 'Running', maxHr: 190, maxSrc: 'observed', z: [0, 0, 0, 1200, 0, 0] })).filter((_, i) => i % 3 === 0),
    sex: 'male',
  };
}

test('detailFromInputs: every metric is a 365-day window ending at the newest data date, keyed by metric, with its kind, direction and decimals', () => {
  assert.equal(DETAIL_DAYS, 365);
  const D = detailFromInputs(fullInputs());
  assert.equal(D.asOf, AS_OF);
  assert.equal(D.days, DETAIL_DAYS);
  const from = addDays(AS_OF, -(DETAIL_DAYS - 1));
  for (const k of DETAIL_KEYS.filter((x) => x !== 'lean')) {
    const m = D.metrics[k];
    assert.ok(m, `metric ${k} baked`);
    assert.ok(m.start >= from, `${k} starts inside the window`);
    assert.ok(Array.isArray(m.v) && m.v.length <= DETAIL_DAYS, `${k} length`);
    assert.ok(m.v.every((x) => x === null || Number.isFinite(x)), `${k}: numbers or null, never NaN`);
    assert.ok(typeof m.kind === 'string' && [1, 0, -1].includes(m.dir) && Number.isInteger(m.dec), k);
  }
  assert.equal(D.metrics.lean, undefined, 'a metric with no data is simply absent (the view shows its empty state)');
  assert.deepEqual(DETAIL_KEYS, ['sleep', 'recovery', 'hrv', 'rhr', 'respiratory', 'wristTemp', 'walkingHr', 'vo2max', 'fitnessAge', 'steps', 'exercise', 'distance', 'flights', 'energy', 'weight', 'bodyfat', 'lean', 'waist', 'workouts', 'load-gym', 'load-run', 'load-bike', 'strain']);
});

test('fitness age: the VO2max day series through the sex-specific Loe 2013 curve (sparse, lower = better, clamp bounds baked)', () => {
  const I = fullInputs();
  const D = detailFromInputs(I);
  const m = D.metrics.fitnessAge, v = D.metrics.vo2max;
  assert.equal(m.kind, 'sparse');
  assert.equal(m.dir, -1);
  assert.equal(m.dec, 1);
  assert.equal(m.lo, 25);
  assert.equal(m.hi, 75);
  assert.equal(m.start, v.start);
  assert.equal(m.v.length, v.v.length);
  // male: 46 -> between 47.2 (45) and 42.6 (55): 45 + 1.2 / 4.6 * 10 = 47.6
  assert.ok(m.v.every((x, i) => (x === null) === (v.v[i] === null)), 'a fitness age exactly on the VO2max days');
  assert.ok(m.v.filter((x) => x !== null).every((x) => x === 47.6));
  const clamped = detailFromInputs({ ...I, vo2max: [{ date: AS_OF, value: 60, source: 'W' }] }).metrics.fitnessAge;
  assert.deepEqual(clamped.v, [25], 'above the 20-29 mean: the 25 bound (the page says ≤ 25)');
  assert.equal(detailFromInputs({ ...I, sex: null }).metrics.fitnessAge, undefined, 'no sex: no fitness age series');
});

test('signals reuse the monitor card series and band (same number for the same day), missing days are null', () => {
  const I = fullInputs();
  const D = detailFromInputs(I);
  for (const k of ['rhr', 'hrv', 'respiratory', 'wristTemp']) {
    const card = monitorCard(k, I[k]);
    const m = D.metrics[k];
    assert.deepEqual(m.band, card.band, `${k} band = the monitor card band`);
    assert.equal(m.v[m.v.length - 1], card.value, `${k} newest value = the card value`);
  }
  const s = D.metrics.sleep;
  assert.equal(s.target, 7.5);
  assert.deepEqual(s.band, monitorCard('sleep', I.sleep).band);
  assert.equal(s.v[s.v.length - 3], null, 'a night with no sleep row is a gap');
  assert.equal(s.bed.length, s.v.length);
  assert.equal(s.wake[s.wake.length - 1], 7);
  assert.equal(D.metrics.walkingHr.band.median, 95);
  assert.equal(D.metrics.vo2max.band, undefined, 'a sparse metric carries no band');
});

test('daily totals: card floors apply (a near-zero step day is missing), band = middle half of the prior 90 days; energy = basal (sane band) + active', () => {
  const D = detailFromInputs(fullInputs());
  const st = D.metrics.steps;
  assert.equal(st.v[st.v.length - 5], null, 'below the 200-step floor: device not carried');
  assert.deepEqual(Object.keys(st.band), ['lo', 'median', 'hi']);
  const e = D.metrics.energy;
  assert.equal(e.v[e.v.length - 2], null, 'implausible basal reading dropped, like the Salud card');
  assert.equal(e.active.length, e.v.length);
  assert.equal(e.v[e.v.length - 1], e.active[e.active.length - 1] + e.basal[e.basal.length - 1]);
});

test('body composition: body fat uses the most recent source only; waist keeps every tape reading', () => {
  const D = detailFromInputs(fullInputs());
  const bf = D.metrics.bodyfat;
  assert.ok(bf.start >= addDays(AS_OF, -99), 'readings of the older scale are left out');
  assert.equal(D.metrics.waist.v.filter((x) => x != null).length, 2);
});

test('workouts + load: minutes per day after the display rule (0 = no session), RE per modality after the load rule (null = session without RE), typical = the card\'s typical day', () => {
  const I = fullInputs();
  const D = detailFromInputs(I);
  const w = D.metrics.workouts;
  assert.deepEqual(w.levels, [...LEVEL_MIN]);
  assert.equal(w.v[w.v.length - 2], 45);
  assert.equal(w.v[w.v.length - 3], 0, 'no session that day: 0 minutes (rest), not missing');
  assert.equal(w.v[w.v.length - 1], 0, 'asOf without a session: rest');
  const ser = modalitySeries(I.workouts);
  for (const m of ['gym', 'run', 'bike']) {
    const L = D.metrics['load-' + m];
    assert.equal(L.typical, typicalDay(ser.byModality[m]).value, `${m} typical day`);
    // calendar levels (any RE, half / one / one and a half typical days), like the minutes levels
    assert.deepEqual(L.levels, L.typical == null ? [1] : [1, Math.round(L.typical * 5) / 10, L.typical, Math.round(L.typical * 15) / 10]);
    const last = ser.byModality[m][ser.byModality[m].length - 1];
    assert.equal(L.v[L.v.length - 1], last.unscored ? null : last.load);
  }
  assert.ok(D.sessions.length > 0 && D.sessions.every((s) => s.d >= addDays(AS_OF, -(DETAIL_DAYS - 1))));
});

test('load levels scale with a known typical day', () => {
  const rows = series(60, () => ({ type: 'Running', dur: 40, hrAvg: 150, re: 40, source: 'Strava API' }));
  const L = detailFromInputs({ workouts: rows })['metrics']['load-run'];
  assert.equal(L.typical, 40);
  assert.deepEqual(L.levels, [1, 20, 40, 60]);
});

test('recovery: rolling composite with the day and trend cuts the dial uses', () => {
  const D = detailFromInputs(fullInputs());
  const r = D.metrics.recovery;
  assert.equal(r.cut, DAY_BAND_CUTOFF);
  assert.equal(r.cutTrend, BAND_CUTOFF);
  assert.equal(r.t7.length, r.v.length);
});

test('no build-time "now": the same inputs give the same bake; empty inputs give an empty bake', () => {
  assert.deepEqual(detailFromInputs(fullInputs()), detailFromInputs(fullInputs()));
  assert.deepEqual(detailFromInputs({}), { asOf: null, days: DETAIL_DAYS, metrics: {}, sessions: [] });
  assert.deepEqual(detailFrom(readExtract(null)), { asOf: null, days: DETAIL_DAYS, metrics: {}, sessions: [] });
});

test('size: a full year of every metric stays compact (< 90 KB of JSON)', () => {
  const size = JSON.stringify(detailFromInputs(fullInputs())).length;
  assert.ok(size < 90 * 1024, `DETAIL is ${size} bytes`);
});

// readExtract-shaped inputs (lib/extract/read.mjs): every key null but the given ones
const EMPTY = readExtract(null);
const withInputs = ({ series: s = {}, ...rest }) => ({ ...EMPTY, series: { ...EMPTY.series, ...s }, ...rest });
// readSleep rows: an old five-column night reads its stage columns as null
const OLD_NIGHT = { date: '2026-09-28', value: 7.25, bedtime: 23.5, waketime: 7, rem: null, deep: null, core: null, unspec: null, awake: null, inbed: null };

test('detailFrom maps the readExtract inputs onto the card readers\' series', () => {
  const steps = series(30, (i) => ({ value: 8000 + i, source: 'Watch' }));
  // an old five-column night, then one with the stage columns
  const sleep = [OLD_NIGHT, { date: '2026-09-29', value: 6.5, bedtime: 0.25, waketime: 6.75, rem: 1.4, deep: 0.9, core: 4.2, unspec: 0, awake: 0.25, inbed: 6.8 }];
  const D = detailFrom(withInputs({ series: { steps }, sleep }));
  assert.equal(D.asOf, AS_OF);
  assert.equal(D.metrics.steps.v.length, 30);
  const sl = D.metrics.sleep;
  assert.deepEqual(sl.v, [7.25, 6.5]);
  assert.deepEqual(sl.bed, [23.5, 0.25]);
  assert.deepEqual([sl.rem, sl.deep, sl.core, sl.awake, sl.inbed], [[null, 1.4], [null, 0.9], [null, 4.2], [null, 0.25], [null, 6.8]]);
  assert.deepEqual(sl.perf, [97, 87], 'performance = asleep / the target, per night (lib/score/sleep.mjs)');
  assert.deepEqual(sl.eff, [null, 96], 'efficiency only where in bed is known');
  assert.deepEqual(sl.cons, [0, 30], 'consistency minutes = recovery.mjs sleepConsistency');
});

test('sleep stage arrays are left out entirely when no night has stages (older extracts)', () => {
  const sl = detailFrom(withInputs({ sleep: [OLD_NIGHT] })).metrics.sleep;
  for (const k of ['rem', 'deep', 'core', 'awake', 'inbed', 'eff']) assert.equal(k in sl, false, k);
  assert.deepEqual(sl.perf, [97]);
});

/* ---------- consistency with the cards the sheet opens from ---------- */

test('recovery head = what the dial shows: last night\'s composite cut at DAY_BAND_CUTOFF, the 7-day trend as context (same recoveryFromInputs call)', () => {
  const I = fullInputs();
  const r = detailFromInputs(I).metrics.recovery;
  const R = recoveryFromInputs({ hrv: I.hrv, rhr: I.rhr, sleep: I.sleep });
  assert.ok(R.today, 'fixture has a complete last night');
  assert.deepEqual(r.head, {
    mode: 'today', date: R.today.date, value: R.today.value, band: R.today.band, sleep: R.today.sleep,
    trend: { value: R.trend7, band: R.band, dir: R.trendDir },
  });
  // no complete night: the dial falls back to the 7-day trend (mode "trend")
  const noNight = { ...I, rhr: I.rhr.filter((x) => x.date < addDays(AS_OF, -5)) };
  const R2 = recoveryFromInputs({ hrv: noNight.hrv, rhr: noNight.rhr, sleep: noNight.sleep });
  const h2 = detailFromInputs(noNight).metrics.recovery.head;
  if (!R2.gated && R2.trend7 != null && !R2.today) {
    assert.equal(h2.mode, 'trend');
    assert.equal(h2.value, R2.trend7);
    assert.equal(h2.band, R2.band);
  }
});

test('weight: a calendar 7-day rolling average aligned with the series (the Salud card spark), plus the card\'s latest raw reading', () => {
  const I = fullInputs();
  const w = detailFromInputs(I).metrics.weight;
  assert.equal(w.roll.length, w.v.length);
  const daily = [];
  for (let i = 0; i < w.v.length; i++) if (w.v[i] != null) daily.push({ i, date: addDays(w.start, i) });
  // calendar window (d-7, d]: weigh-ins every 3 days -> the newest point averages the readings of the last 7 days
  const last = daily[daily.length - 1];
  const inWin = I.weight.filter((r) => r.date > addDays(last.date, -7) && r.date <= last.date).map((r) => r.value);
  assert.equal(w.roll[last.i], Math.round(10 * inWin.reduce((a, b) => a + b, 0) / inWin.length) / 10);
  assert.equal(w.roll[last.i - 1], null, 'only days with a reading carry a rolling point (no invented days)');
  const raw = I.weight[I.weight.length - 1];
  assert.deepEqual(w.latest, { date: raw.date, value: Math.round(raw.value * 10) / 10 });
});

test('body fat / lean mass: only the latest scale AND only the card\'s BODYCOMP_WINDOW, so a scale-switch artefact never shows', () => {
  const I = fullInputs();
  const bf = detailFromInputs({ ...I, bodyfat: series(400, (i) => ({ value: 20, source: 'New' })).filter((_, i) => i % 7 === 0) }).metrics.bodyfat;
  const newest = addDays(bf.start, bf.v.length - 1);
  assert.ok(bf.start > addDays(newest, -BODYCOMP_WINDOW), 'nothing older than the window');
  assert.equal(bf.windowDays, BODYCOMP_WINDOW);
});

test('energy: a power-meter-corrected day keeps the Watch value aside (`watch`, null elsewhere); absent when nothing was corrected', () => {
  const I = fullInputs();
  const day = addDays(AS_OF, -3);
  const active = I.active.map((r) => (r.date === day ? { ...r, value: r.value + 800, watch: r.value } : r));
  const e = detailFromInputs({ ...I, active }).metrics.energy;
  const i = Math.round((Date.parse(day) - Date.parse(e.start)) / 864e5);
  const raw = I.active.find((r) => r.date === day).value;
  assert.equal(e.watch.length, e.v.length);
  assert.equal(e.watch[i], Math.round(raw));
  assert.equal(e.active[i], Math.round(raw + 800), 'the active part (and the total) use the corrected value');
  assert.equal(e.watch.filter((x) => x != null).length, 1);
  assert.equal(detailFromInputs(I).metrics.energy.watch, undefined);
});

test('energy: a power-ride day without hourly coverage is flagged (`uncov`, 1 / null); absent when none', () => {
  const I = fullInputs();
  const day = addDays(AS_OF, -4);
  const active = I.active.map((r) => (r.date === day ? { ...r, uncovered: true } : r));
  const e = detailFromInputs({ ...I, active }).metrics.energy;
  const i = Math.round((Date.parse(day) - Date.parse(e.start)) / 864e5);
  assert.equal(e.uncov.length, e.v.length);
  assert.equal(e.uncov[i], 1);
  assert.equal(e.uncov.filter((x) => x != null).length, 1);
  assert.equal(detailFromInputs(I).metrics.energy.uncov, undefined);
});

test('detailFrom(readExtract(dir)) uses the corrected active energy (rides.csv + hourly Watch buckets)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detail-ride-'));
  try {
    const days = Array.from({ length: 20 }, (_, i) => addDays(AS_OF, i - 19));
    fs.writeFileSync(path.join(dir, 'active-energy-daily.csv'), ['date,kcal', ...days.map((d) => `${d},500`), ''].join('\n'));
    fs.writeFileSync(path.join(dir, 'basal-energy-daily.csv'), ['date,kcal', ...days.map((d) => `${d},1700`), ''].join('\n'));
    fs.writeFileSync(path.join(dir, 'active-energy-hourly.csv'), ['date,hour_start,kcal,source',
      `${AS_OF},${AS_OF}T09:00:00+02:00,100,Shortcut`, `${AS_OF},${AS_OF}T10:00:00+02:00,100,Shortcut`, ''].join('\n'));
    fs.writeFileSync(path.join(dir, 'rides.csv'), ['date,start,elapsed_s,kilojoules,device_watts,source',
      `${AS_OF},${AS_OF}T09:00:00+02:00,7200,1000,true,Strava API`, ''].join('\n'));
    const e = detailFrom(readExtract(dir)).metrics.energy;
    assert.equal(e.v[e.v.length - 1], 1700 + 500 - 200 + 1000);
    assert.equal(e.watch[e.watch.length - 1], 500);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('energy: a day missing active OR basal energy is missing (null), never basal alone; roll = the card\'s 7-day rolling expenditure', () => {
  const I = fullInputs();
  const noActive = addDays(AS_OF, -10);
  const e = detailFromInputs({ ...I, active: I.active.filter((r) => r.date !== noActive) }).metrics.energy;
  const i = Math.round((Date.parse(noActive) - Date.parse(e.start)) / 864e5);
  assert.equal(e.v[i], null, 'no active energy that day: the total is unknown');
  assert.equal(e.roll.length, e.v.length);
  const card = aggEnergy(I.active.filter((r) => r.date !== noActive), I.basal, null);
  assert.equal(e.roll[e.roll.length - 1], card.spark.v[card.spark.v.length - 1], 'newest rolling point = the card sparkline end');
});

test('workouts: rest days are zero-filled from the first session to the data\'s asOf (after the last session = rest, not missing)', () => {
  const I = fullInputs();
  const lastSession = addDays(AS_OF, -4);
  const D = detailFromInputs({ ...I, workouts: I.workouts.filter((r) => r.date <= lastSession) });
  const w = D.metrics.workouts;
  assert.equal(addDays(w.start, w.v.length - 1), D.asOf, 'the series reaches asOf');
  assert.deepEqual(w.v.slice(-4), [0, 0, 0, 0]);
});

test('load: the dial\'s gate and last scored session ride along, so the sheet header says what the dial says', () => {
  const I = fullInputs();
  const D = detailFromInputs(I);
  const L = loadFromSeries(modalitySeries(I.workouts));
  for (const mod of L.modalities) {
    const m = D.metrics['load-' + mod.key];
    if (!m) continue;
    const gate = !mod.trend.ok || mod.trend.trendPct == null ? (mod.trend.reason || 'baselineBuilding') : mod.typical.value == null ? 'fewDays' : null;
    assert.equal(m.gate, gate, `${mod.key} gate`);
    assert.deepEqual(m.last, mod.last, `${mod.key} last scored session`);
    assert.equal(m.typical, mod.typical.value);
  }
});

test('detailFromInputs: strain = the day strain of every day with all-day heart rate, shaded at the reference bands', () => {
  const D = detailFromInputs(fullInputs());
  const m = D.metrics.strain;
  assert.equal(m.kind, 'strain');
  assert.deepEqual(m.levels, [0.1, 10, 14, 18]);
  assert.equal(m.start, addDays(AS_OF, -29));
  assert.ok(m.v.every((x) => x >= 0 && x <= 21));
  assert.equal(detailFromInputs({ ...fullInputs(), hrHourly: null }).metrics.strain, undefined, 'no hourly data: no strain view');
});

const DEMO = path.join(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))), 'data', 'demo', 'extract');

test('detailFrom maps every readExtract input onto detailFromInputs (each lands as its metric) on frozen inputs', () => {
  const d = detailFrom(readExtract(DEMO), { sex: 'male' });
  for (const k of ['sleep', 'recovery', 'hrv', 'rhr', 'respiratory', 'wristTemp', 'walkingHr', 'vo2max', 'fitnessAge',
    'steps', 'exercise', 'distance', 'flights', 'energy', 'weight', 'bodyfat', 'lean', 'waist', 'workouts']) {
    assert.ok(d.metrics[k], `metric ${k}`);
  }
  assert.ok(d.sessions.length > 0 && d.zoneMax, 'workouts + zones');
  assert.equal(detailFrom(readExtract(DEMO)).metrics.fitnessAge, undefined, 'no sex, no fitness age');
  assert.deepEqual(detailFrom(readExtract(null), { sex: 'male' }), detailFromInputs({}));
});

test('sleep metric: est = 1 on an estimated (in-bed-only) night, absent when no night in the window is one', () => {
  const I = fullInputs();
  assert.equal(detailFromInputs(I).metrics.sleep.est, undefined);
  const last = I.sleep[I.sleep.length - 1];
  const est = detailFromInputs({ ...I, sleep: [...I.sleep.slice(0, -1), { ...last, estimated: true }] }).metrics.sleep;
  assert.equal(est.est.length, est.v.length);
  assert.equal(est.est[est.est.length - 1], 1);
  assert.equal(est.est.filter((x) => x === 1).length, 1);
});
