import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseRe } from '../health/read.mjs';
import { isJunk, dayTotals, modalitySeries, buildLoadInputs, JUNK_MAX_MIN } from './series.mjs';

// helper: a row for the load model
const row = (date, type, dur, re) => ({ date, type, dur, re, hrAvg: null, kj: null });

test('parseRe: blank/absent is null, 0 and 1 are genuine values', () => {
  assert.equal(parseRe(''), null);
  assert.equal(parseRe(undefined), null);
  assert.equal(parseRe(null), null);
  assert.equal(parseRe('abc'), null);
  assert.equal(parseRe('0'), 0);
  assert.equal(parseRe('1'), 1);
  assert.equal(parseRe('87'), 87);
});

test('isJunk boundaries: short AND negligible effort (dur <= 10, re null or <= 2)', () => {
  assert.equal(JUNK_MAX_MIN, 11);
  assert.equal(isJunk({ dur: 11, re: 0 }), true, '11|0 is junk (the <= boundary)');
  assert.equal(isJunk({ dur: 10.42, re: 0 }), true, 'a 10.42 min zero-effort fragment is junk (real durations are unrounded)');
  assert.equal(isJunk({ dur: 10, re: 0 }), true);
  assert.equal(isJunk({ dur: 12, re: 27 }), false, '12|27 is a genuine sprint block');
  assert.equal(isJunk({ dur: 34, re: 3 }), false, '34|3 survives on the duration arm');
  assert.equal(isJunk({ dur: 7, re: 1 }), true);
  assert.equal(isJunk({ dur: 5, re: null }), true, 'short and unscored is junk');
  assert.equal(isJunk({ dur: 11.5, re: 0 }), false, '11.5 min is past the duration arm');
  assert.equal(isJunk({ dur: 12.03, re: null }), false, 'an unscored 12 min row is kept (and counted unscored)');
  assert.equal(isJunk({ dur: 3, re: 40 }), false, 'short but hard is kept (effort arm)');
  assert.equal(isJunk({ dur: 10, re: 2 }), true, 're <= 2 is inclusive');
  assert.equal(isJunk({ dur: 10, re: 3 }), false, 'the effort arm protects a short but hard block');
});

test('dayTotals: dur <= 0 rows are invalid, never scored, and counted', () => {
  const t = dayTotals([row('2026-09-01', 'Running', 0, 50), row('2026-09-01', 'Running', -5, 50), row('2026-09-01', 'Running', 30, 40)]);
  assert.equal(t.invalid, 2);
  assert.equal(t.byModality.run, 40);
});

test('dayTotals: re = 0 is scored (re != null), not unscored', () => {
  const t = dayTotals([row('2026-09-01', 'Cycling', 60, 0)]);
  assert.equal(t.scored, 1);
  assert.equal(t.unscored, 0);
  assert.equal(t.byModality.bike, 0);
});

test('dayTotals: two non-junk runs SUM (60 + 40 = 100), run + gym stay separate', () => {
  const t = dayTotals([
    row('2026-09-01', 'Running', 40, 60), row('2026-09-01', 'Running', 30, 40),
    row('2026-09-01', 'HighIntensityIntervalTraining', 45, 40),
  ]);
  assert.equal(t.byModality.run, 100);
  assert.equal(t.byModality.gym, 40);
  assert.equal('total' in t.byModality, false, 'no combined figure exists');
  assert.equal(Object.keys(t.byModality).includes('other'), false, 'other is never scored');
});

test('dayTotals: no `collapsed` counter exists any more', () => {
  const t = dayTotals([row('2026-09-01', 'Running', 30, 40)]);
  assert.equal('collapsed' in t, false);
});

// the 7 pinned real-shape fixtures (rev-3 acceptance): min|RE
const FIXTURES = [
  ['2026-09-16', 'gym', 'HighIntensityIntervalTraining', [[7, 1], [91, 29]], 29],
  ['2026-09-15', 'bike', 'Cycling', [[5, 0], [143, 100]], 100],
  ['2026-08-22', 'run', 'Running', [[10.42, 0], [47, 146]], 146],
  ['2026-08-25', 'run', 'Running', [[20, 56], [38, 50]], 106],
  ['2026-08-20', 'run', 'Running', [[12, 27], [54, 57]], 84],
  ['2026-07-29', 'run', 'Running', [[19, 42], [16, 52]], 94],
  ['2026-06-29', 'gym', 'HighIntensityIntervalTraining', [[34, 3], [12, 17], [21, 48]], 68],
];
for (const [date, mod, type, parts, want] of FIXTURES) {
  test(`pinned day total ${date} ${mod} = ${want}`, () => {
    const t = dayTotals(parts.map(([d, r]) => row(date, type, d, r)));
    assert.equal(t.byModality[mod], want);
  });
}

// The fixtures above mostly carry RE 0, so removing the junk filter would leave their totals
// unchanged. These rows have RE 1-2: without the filter the total would be higher.
test('the junk filter is load-bearing: a short RE 1-2 row beside a real session changes the total if kept', () => {
  const rows = [row('2026-09-01', 'HighIntensityIntervalTraining', 6, 2), row('2026-09-01', 'HighIntensityIntervalTraining', 5, 1), row('2026-09-01', 'HighIntensityIntervalTraining', 91, 29)];
  const naive = rows.reduce((s, r) => s + r.re, 0);
  const t = dayTotals(rows);
  assert.equal(naive, 32);
  assert.equal(t.byModality.gym, 29);
  assert.notEqual(t.byModality.gym, naive, 'a removed filter would make this fail');
  assert.equal(t.droppedJunk, 2);
});

test('a 10.42 min RE 0 fragment is dropped and counted, in the scored modalities and in `other`', () => {
  const t = dayTotals([row('2026-08-22', 'Running', 10.42, 0), row('2026-08-22', 'Running', 47, 146)]);
  assert.equal(t.droppedJunk, 1);
  assert.equal(t.scored, 1);
  const o = dayTotals([row('2026-08-22', 'Tennis', 10.42, 0), row('2026-08-22', 'Tennis', 60, 20)]);
  assert.equal(o.droppedJunk, 1);
  assert.deepEqual(o.other, { minutes: 60, re: 20, sessions: 1 }, 'the dropped fragment adds no minutes or sessions');
});

test('modalitySeries coverage over a real-shaped stretch: fragment dropped, counts corrected', () => {
  const s = modalitySeries([
    row('2026-08-20', 'Running', 54, 57),
    row('2026-08-22', 'Running', 10.42, 0), row('2026-08-22', 'Running', 47, 146),
    row('2026-08-23', 'Tennis', 10.42, 0), row('2026-08-23', 'Tennis', 60, 20),
  ]);
  assert.equal(s.coverage.droppedJunk, 2);
  assert.equal(s.coverage.scored, 3);
  assert.deepEqual([s.other.minutes, s.other.sessions], [60, 1]);
});

test('anti-regression: a two-part session sums both parts (106), never the max-RE row (56)', () => {
  const t = dayTotals([row('2026-08-25', 'Running', 20, 56), row('2026-08-25', 'Running', 38, 50)]);
  assert.notEqual(t.byModality.run, 56);
  assert.equal(t.byModality.run, 106);
});

test('dayTotals counts dropped junk and keeps the real session', () => {
  const t = dayTotals([row('2026-09-16', 'HighIntensityIntervalTraining', 7, 1), row('2026-09-16', 'HighIntensityIntervalTraining', 91, 29)]);
  assert.equal(t.droppedJunk, 1);
  assert.equal(t.scored, 1);
});

test('dayTotals: a long ride with no RE is unscored, load 0, never duration-derived', () => {
  const t = dayTotals([row('2026-09-19', 'Cycling', 211, null)]);
  assert.equal(t.unscored, 1);
  assert.equal(t.byModality.bike, 0);
});

test('dayTotals: `other` modality keeps raw minutes/RE/sessions and is never in byModality', () => {
  const t = dayTotals([row('2026-09-01', 'Tennis', 60, 25), row('2026-09-01', 'Walking', 30, null)]);
  assert.deepEqual(t.other, { minutes: 90, re: 25, sessions: 2 });
});

test('modalitySeries: derived reEpoch, asOf = max date, zero-filled daily series, nothing before the epoch', () => {
  const rows = [
    row('2026-05-01', 'Running', 40, null), // pre-epoch: unscored, no load
    row('2026-06-01', 'Running', 40, 50),
    row('2026-06-04', 'Running', 40, 30),
    row('2026-06-04', 'HighIntensityIntervalTraining', 40, 20),
  ];
  const s = modalitySeries(rows);
  assert.equal(s.reEpoch, '2026-06-01');
  assert.equal(s.asOf, '2026-06-04');
  assert.deepEqual(s.byModality.run, [
    { date: '2026-06-01', load: 50 }, { date: '2026-06-02', load: 0 },
    { date: '2026-06-03', load: 0 }, { date: '2026-06-04', load: 30 },
  ]);
  assert.equal(s.byModality.gym[3].load, 20);
  assert.equal(s.byModality.bike.length, 4, 'every scored modality spans the same window');
  assert.equal(s.coverage.preEpoch, 1, 'pre-epoch rows are counted apart, not as in-era unscored');
  assert.equal(s.coverage.unscored, 0);
  assert.equal(s.coverage.scored, 3);
  assert.equal('collapsed' in s.coverage, false);
});

test('modalitySeries: no row with an RE means no epoch and no series', () => {
  const s = modalitySeries([row('2026-06-01', 'Running', 40, null)]);
  assert.equal(s.reEpoch, null);
  assert.equal(s.asOf, '2026-06-01');
  assert.deepEqual(s.byModality.run, []);
});

test('modalitySeries: a junk-only day contributes load 0 (excluded later from p90 and the 8-day gate)', () => {
  const s = modalitySeries([row('2026-06-01', 'Running', 40, 50), row('2026-06-02', 'Running', 8, 1)]);
  assert.equal(s.byModality.run[1].load, 0);
  assert.equal(s.coverage.droppedJunk, 1);
});

test('modalitySeries: unscored in-era rows are counted (coverage.unscored)', () => {
  const s = modalitySeries([row('2026-06-01', 'Running', 40, 50), row('2026-06-03', 'Cycling', 211, null)]);
  assert.equal(s.coverage.unscored, 1);
  assert.equal(s.byModality.bike.every((d) => d.load === 0), true);
});

test('modalitySeries: `other` covers the trailing 28 days ending asOf', () => {
  const s = modalitySeries([
    row('2026-06-01', 'Running', 40, 50),
    row('2026-06-02', 'Tennis', 60, 25),
    row('2026-08-01', 'Running', 40, 50),
    row('2026-08-02', 'Tennis', 30, 5),
  ]);
  assert.deepEqual(s.other, { minutes: 30, re: 5, sessions: 1, windowDays: 28 });
});

test('buildLoadInputs reads workouts.csv (11-col, 9-col and mixed) without throwing; null when absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-series-'));
  try {
    assert.equal(buildLoadInputs(dir), null);
    assert.equal(buildLoadInputs(null), null);
    fs.writeFileSync(path.join(dir, 'workouts.csv'), [
      'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules',
      '2026-06-01,Running,40,,140,,165,Watch,5',
      '2026-06-02,Running,40,,140,,165,Strava API,5,87,',
    ].join('\n') + '\n');
    const s = buildLoadInputs(dir);
    assert.equal(s.reEpoch, '2026-06-02');
    assert.equal(s.byModality.run[0].load, 87);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ---- today first: per-modality session days, with unscored rows kept visible ---- */
test('dayTotals: counts valid non-junk rows and unscored rows PER MODALITY', () => {
  const t = dayTotals([
    row('2026-09-01', 'Running', 40, null), row('2026-09-01', 'Running', 30, 20),
    row('2026-09-01', 'Cycling', 60, null), row('2026-09-01', 'Running', 5, null), // junk
  ]);
  assert.deepEqual(t.rowsBy, { gym: 0, run: 2, bike: 1 });
  assert.deepEqual(t.unscoredBy, { gym: 0, run: 1, bike: 1 });
});

test('modalitySeries: `days` lists only dates with rows in that modality: summed RE + unscored count', () => {
  const s = modalitySeries([
    row('2026-06-01', 'Running', 40, 50),
    row('2026-06-03', 'Running', 40, null),
    row('2026-06-04', 'Running', 40, 30), row('2026-06-04', 'Running', 20, null),
  ]);
  assert.deepEqual(s.days.run, [
    { date: '2026-06-01', re: 50, unscored: 0 },
    { date: '2026-06-03', re: 0, unscored: 1 },
    { date: '2026-06-04', re: 30, unscored: 1 },
  ]);
  assert.deepEqual(s.days.gym, []);
  assert.deepEqual(modalitySeries([]).days, { gym: [], run: [], bike: [] });
});
