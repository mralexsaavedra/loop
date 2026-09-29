import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildScores } from './index.mjs';
import { buildHealth, buildLoadRecovery } from '../health/aggregate.mjs';
import { readWorkoutLoad } from '../health/read.mjs';

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ASOF = '2026-09-29';
const wig = (i) => ((i * 7) % 5) - 2;

// A disposable extract dir (os.tmpdir only). `withRe` decides whether workouts carry RE columns.
function fixture({ withRe = true, days = 49 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-index-'));
  const ds = Array.from({ length: days }, (_, i) => addDays(ASOF, i - (days - 1)));
  const w = (name, header, rows) => fs.writeFileSync(path.join(dir, name), header + '\n' + rows.join('\n') + '\n');
  w('hrv.csv', 'date,value,source', ds.map((d, i) => `${d},${60 + wig(i)},Watch`));
  w('rhr.csv', 'date,value,source', ds.map((d, i) => `${d},${50 + wig(i) * 0.5},Watch`));
  w('sleep-daily.csv', 'date,asleep_hours,source,bedtime,waketime', ds.map((d, i) => `${d},${7.5 + wig(i) * 0.2},Watch,${23 + wig(i) * 0.1},${7 + wig(i) * 0.1}`));
  const header = withRe
    ? 'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules'
    : 'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km';
  const rows = [];
  ds.forEach((d, i) => {
    if (i % 2 === 0) rows.push(`${d},Running,40,,140,,165,${withRe ? 'Strava API' : 'Watch'},5${withRe ? `,${50 + (i % 7)},` : ''}`);
    if (i % 3 === 0) rows.push(`${d},HighIntensityIntervalTraining,45,,130,,160,${withRe ? 'Strava API' : 'Watch'},${withRe ? `,${30 + (i % 5)},` : ''}`);
  });
  w('workouts.csv', header, rows);
  return dir;
}
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

test('buildScores returns the baked shape: hasData, asOf, reEpoch, recovery, load, advice', () => {
  const dir = fixture();
  try {
    const s = buildScores(dir);
    assert.equal(s.hasData, true);
    assert.equal(s.asOf, ASOF);
    assert.equal(typeof s.reEpoch, 'string');
    assert.equal(s.recovery.gated, false);
    assert.deepEqual(s.load.modalities.map((m) => m.key), ['gym', 'run', 'bike']);
    assert.ok(s.advice === null || typeof s.advice.key === 'string');
    assert.deepEqual(s.monitor.cards.map((c) => c.key), ['respiratory', 'rhr', 'hrv', 'wristTemp', 'sleep'], 'health monitor baked alongside');
    assert.equal(s.monitor.cards.find((c) => c.key === 'hrv').state, 'ok');
    JSON.stringify(s);
  } finally { rm(dir); }
});

test('buildScores is empty (never throws) for a null dir, an empty dir, and absent CSVs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-empty-'));
  try {
    for (const d of [null, undefined, dir]) {
      const s = buildScores(d);
      const { monitor, timeline, ...rest } = s;
      assert.deepEqual(rest, { hasData: false, asOf: null, reEpoch: null, recovery: null, load: null, advice: null });
      assert.deepEqual(timeline, { asOf: null, days: [] }, 'the timeline is baked empty');
      assert.equal(monitor.asOf, null);
      assert.ok(monitor.cards.every((c) => c.state === 'none'), 'the monitor still has its five (empty) cards');
    }
  } finally { rm(dir); }
});

test('insufficient recovery bakes no advice', () => {
  const dir = fixture({ days: 10 });
  try {
    const s = buildScores(dir);
    assert.equal(s.recovery.gated, true);
    assert.equal(s.advice, null);
  } finally { rm(dir); }
});

test('the baked JSON carries no today-relative values: identical output on any build date', () => {
  const dir = fixture();
  try {
    const at = (iso) => {
      mock.timers.enable({ apis: ['Date'], now: new Date(iso) });
      try { return JSON.stringify(buildScores(dir)); } finally { mock.timers.reset(); }
    };
    assert.equal(at('2026-09-30T06:00:00Z'), at('2029-02-03T20:00:00Z'));
  } finally { rm(dir); }
});

test('Home and Salud read the same row source: every workouts.csv row reaches the Home coverage', () => {
  const dir = fixture();
  try {
    const rows = readWorkoutLoad(dir);
    const c = buildScores(dir).load.coverage;
    assert.equal(c.scored + c.unscored + c.invalid + c.droppedJunk + c.superseded + c.preEpoch, rows.length);
  } finally { rm(dir); }
});

test('Salud is unaffected by the RE columns: same HR index with and without relative_effort', () => {
  const a = fixture({ withRe: true });
  const b = fixture({ withRe: false });
  try {
    assert.deepEqual(buildLoadRecovery(a), buildLoadRecovery(b));
    assert.deepEqual(buildHealth(a).loadRecovery ?? null, buildHealth(b).loadRecovery ?? null);
  } finally { rm(a); rm(b); }
});
