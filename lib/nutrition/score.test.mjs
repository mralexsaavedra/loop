/* lib/nutrition/score.mjs — the daily nutrition score (the reference web/src/client/nutri-score.js ports). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  NSCORE, NSCORE_CASES, kcalPoints, proteinPoints, fatPoints, nutritionScore, scoreBand, scoreSeries,
  parseFoodlogCsv, foodlogBake, foodlogFile, buildFoodlogBake,
} from './score.mjs';
import { ADHERENCE } from './adherence.mjs';

const G3 = { breakfast: 1, lunch: 1, dinner: 1 };
const day = (o) => ({ date: '2030-01-10', k: 2000, p: 150, f: 70, n: 3, missing: { p: false, f: false }, groups: G3, ...o });
const T = { k: 2000, p: 150, g: 70 };

test('constants: weights 0.4 / 0.4 / 0.2; the kcal and protein full-credit lines ARE Constancia\'s (one definition)', () => {
  assert.deepEqual({ ...NSCORE.weights }, { k: 0.4, p: 0.4, f: 0.2 });
  assert.equal(NSCORE.kcal.full, ADHERENCE.onBand, 'kcal: full credit inside Constancia\'s ±10 % "on target" band');
  assert.equal(NSCORE.kcal.zero, 0.35);
  assert.equal(NSCORE.protein.full, ADHERENCE.proteinShare, 'protein: full credit at Constancia\'s protein-day share');
  assert.equal(NSCORE.protein.zero, 0.5);
  assert.deepEqual({ ...NSCORE.fat }, { lo: 0.6, hi: 1.1, zeroLo: 0.3, zeroHi: 1.6 });
  assert.deepEqual({ ...NSCORE.bands }, { good: 85, mid: 60 });
  assert.equal(NSCORE.days, 90);
  assert.equal(NSCORE.avgDays, 7);
  assert.ok(Object.isFrozen(NSCORE));
});

test('kcalPoints: 100 within ±10 %, linear to 0 at ±35 %, symmetric', () => {
  assert.equal(kcalPoints(2000, 2000), 100);
  assert.equal(kcalPoints(2200, 2000), 100);
  assert.equal(kcalPoints(1800, 2000), 100);
  assert.equal(kcalPoints(2500, 2000), 40); // 25 % over: (0.35 - 0.25) / 0.25
  assert.equal(kcalPoints(1500, 2000), 40);
  assert.equal(kcalPoints(2450, 2000), 50);
  assert.equal(kcalPoints(2700, 2000), 0);
  assert.equal(kcalPoints(500, 2000), 0);
  assert.equal(kcalPoints(null, 2000), null);
  assert.equal(kcalPoints(2000, 0), null);
});

test('proteinPoints: 100 at >= 90 % of the target, linear to 0 at 50 %', () => {
  assert.equal(proteinPoints(150, 150), 100);
  assert.equal(proteinPoints(135, 150), 100);
  assert.equal(proteinPoints(105, 150), 50); // 70 %: (0.7 - 0.5) / 0.4
  assert.equal(proteinPoints(75, 150), 0);
  assert.equal(proteinPoints(30, 150), 0);
  assert.equal(proteinPoints(400, 150), 100, 'more protein than the target is never penalised');
  assert.equal(proteinPoints(null, 150), null);
});

test('fatPoints: 100 between 60 % and 110 %, linear to 0 at 160 % above and 30 % below', () => {
  assert.equal(fatPoints(70, 70), 100);
  assert.equal(fatPoints(42, 70), 100);
  assert.equal(fatPoints(77, 70), 100);
  assert.equal(fatPoints(94.5, 70), 50); // 135 %
  assert.equal(fatPoints(112, 70), 0);
  assert.equal(fatPoints(31.5, 70), 50); // 45 %
  assert.equal(fatPoints(21, 70), 0);
  assert.equal(fatPoints(null, 70), null);
});

test('nutritionScore: the weighted sum, rounded; each component keeps eaten / target / points', () => {
  const r = nutritionScore(day({ k: 2500, p: 105, f: 94.5 }), T);
  // 0.4 * 40 + 0.4 * 50 + 0.2 * 50 = 46
  assert.equal(r.score, 46);
  assert.deepEqual(r.parts.k, { v: 2500, t: 2000, pts: 40 });
  assert.deepEqual(r.parts.p, { v: 105, t: 150, pts: 50 });
  assert.deepEqual(r.parts.f, { v: 94.5, t: 70, pts: 50 });
  assert.equal(r.inc, false);
  assert.equal(r.meals, true);
  assert.equal(nutritionScore(day(), T).score, 100);
});

test('nutritionScore: no log, no entries or no target -> null (never 0)', () => {
  assert.equal(nutritionScore(null, T), null);
  assert.equal(nutritionScore(day({ n: 0 }), T), null);
  assert.equal(nutritionScore(day(), null), null);
  assert.equal(nutritionScore(day(), { k: 0, p: 150, g: 70 }), null);
});

test('missing macros: the component is left out and the rest re-weighted, flagged incomplete', () => {
  // fat unknown: (0.4 * 40 + 0.4 * 50) / 0.8 = 45
  const a = nutritionScore(day({ k: 2500, p: 105, f: 10, missing: { p: false, f: true } }), T);
  assert.equal(a.score, 45);
  assert.equal(a.parts.f, null);
  assert.equal(a.inc, true);
  // protein a MINIMUM below full credit: left out (it could be anything above)
  const b = nutritionScore(day({ k: 2500, p: 105, f: 94.5, missing: { p: true, f: false } }), T);
  assert.equal(b.parts.p, null);
  assert.equal(b.score, Math.round((0.4 * 40 + 0.2 * 50) / 0.6));
  assert.equal(b.inc, true);
  // a protein minimum that already reaches full credit counts (Constancia's protein-day rule)
  const c = nutritionScore(day({ p: 140, missing: { p: true, f: false } }), T);
  assert.deepEqual(c.parts.p, { v: 140, t: 150, pts: 100, min: true });
  assert.equal(c.score, 100);
  assert.equal(c.inc, true);
  // no value at all
  const d = nutritionScore(day({ p: null, f: null, missing: { p: true, f: true } }), T);
  assert.equal(d.score, 100, 'kcal alone, on target');
  assert.equal(d.parts.p, null);
});

test('today is partial ("so far"); incomplete meals and an assumed rest day are flagged, still scored', () => {
  assert.equal(nutritionScore(day(), T, { today: '2030-01-10' }).partial, true);
  assert.equal(nutritionScore(day(), T, { today: '2030-01-11' }).partial, false);
  const m = nutritionScore(day({ groups: { breakfast: 1, lunch: 0, dinner: 1 } }), T);
  assert.equal(m.meals, false);
  assert.equal(nutritionScore(day(), { ...T, inferred: true }).assumed, true);
});

test('scoreBand: good >= 85, mid 60-84, low < 60', () => {
  assert.equal(scoreBand(85), 'good');
  assert.equal(scoreBand(84), 'mid');
  assert.equal(scoreBand(60), 'mid');
  assert.equal(scoreBand(59), 'low');
  assert.equal(scoreBand(null), null);
});

test('scoreSeries: per day + the 7-day average of FINAL scores (today so far never counts)', () => {
  const dates = ['2030-01-04', '2030-01-05', '2030-01-06', '2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10'];
  const days = [day({ date: '2030-01-04' }), day({ date: '2030-01-06', k: 2500, p: 105, f: 94.5 }), day({ date: '2030-01-10', k: 500 })];
  const targets = Object.fromEntries(dates.map((d) => [d, T]));
  const s = scoreSeries(dates, days, targets, '2030-01-10');
  assert.equal(s.days['2030-01-05'], undefined, 'no log -> no score');
  assert.equal(s.days['2030-01-04'].score, 100);
  assert.equal(s.days['2030-01-10'].partial, true);
  assert.equal(s.avg, 73); // (100 + 46) / 2
  assert.equal(s.n, 2);
  assert.equal(scoreSeries(dates, [], targets, '2030-01-10').avg, null);
});

test('NSCORE_CASES: the shared fixture the client port runs', () => {
  for (const c of NSCORE_CASES) assert.deepEqual(nutritionScore(c.day, c.target, { today: c.today }), c.expect, c.name);
});

test('parseFoodlogCsv: the sync\'s rows; blank macros null, missing_macros as flags; foreign files -> []', () => {
  const text = 'date,kcal,protein_g,carbs_g,fat_g,entries,breakfast,lunch,dinner,addon,missing_macros\n' +
    '2030-01-02,2383,122.8,281.7,87.7,20,8,3,6,3,\n2030-01-03,1208,,150.5,22.5,15,5,3,0,7,protein;fat\n';
  assert.deepEqual(parseFoodlogCsv(text), [
    { date: '2030-01-02', k: 2383, p: 122.8, f: 87.7, n: 20, missing: { p: false, f: false }, groups: { breakfast: 8, lunch: 3, dinner: 6 } },
    { date: '2030-01-03', k: 1208, p: null, f: 22.5, n: 15, missing: { p: true, f: true }, groups: { breakfast: 5, lunch: 3, dinner: 0 } },
  ]);
  assert.deepEqual(parseFoodlogCsv('date,value\n2030-01-01,1\n'), []);
  assert.deepEqual(parseFoodlogCsv(''), []);
});

test('foodlogBake: the last 90 days ending at the newest LOGGED day (no build clock), oldest first', () => {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(day({ date: new Date(Date.UTC(2030, 0, 1 + i)).toISOString().slice(0, 10) }));
  const b = foodlogBake(rows);
  assert.equal(b.asOf, '2030-04-10');
  assert.equal(b.days.length, 90);
  assert.equal(b.days[0].date, '2030-01-11');
  assert.deepEqual(foodlogBake([]), { asOf: null, days: [] });
});

test('foodlogFile / buildFoodlogBake: personal = data/nutrition, example = the demo extract; absent -> empty', () => {
  assert.equal(foodlogFile({ repoRoot: '/r', dataMode: 'personal', extractDir: '/x' }), path.join('/r', 'data', 'nutrition', 'foodlog-daily.csv'));
  assert.equal(foodlogFile({ repoRoot: '/r', dataMode: 'example', extractDir: '/x' }), path.join('/x', 'foodlog-daily.csv'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nscore-'));
  assert.deepEqual(buildFoodlogBake({ repoRoot: dir, dataMode: 'example', extractDir: dir }), { asOf: null, days: [] });
  fs.writeFileSync(path.join(dir, 'foodlog-daily.csv'), 'date,kcal,protein_g,carbs_g,fat_g,entries,breakfast,lunch,dinner,addon,missing_macros\n2030-01-02,2000,150,200,70,3,1,1,1,0,\n');
  assert.equal(buildFoodlogBake({ repoRoot: dir, dataMode: 'example', extractDir: dir }).asOf, '2030-01-02');
  fs.rmSync(dir, { recursive: true });
});
