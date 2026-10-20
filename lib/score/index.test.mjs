import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScoresFrom } from './index.mjs';
import { readExtract, deepFreeze } from '../extract/read.mjs';
import { strainFrom } from './strain.mjs';
import { stressFrom } from './stress.mjs';
import { energyFrom } from './energy.mjs';
import { recoveryFrom } from './recovery.mjs';
import { loadFrom } from './load.mjs';
import { healthFrom, aggLoadRecovery } from '../health/aggregate.mjs';
import { workoutLoadFromCells, workoutsFromCells, ridesFromCells, runsFromCells } from '../health/read.mjs';
import { hrHourlyFromCells, hrHoursFromCells, activitiesFromLines } from './read.mjs';
import { zonesFromLines } from '../training/read.mjs';
import { trainingRowsFromCells } from '../training/dashboard.mjs';
import { FIXTURES, GOLDEN_NOW, canonical } from '../../scripts/golden-bake.mjs';
import { addDays } from '../date.mjs';

const ASOF = '2026-09-29';
const wig = (i) => ((i * 7) % 5) - 2;
const EMPTY = readExtract(null);
const SLEEP_COLS = { rem: null, deep: null, core: null, unspec: null, awake: null, inbed: null };

// Synthetic readExtract inputs (no files): hrv / rhr / sleep rows in the readers' shape, and workouts.csv
// lines projected by the same pure functions readExtract uses. `withRe` decides whether workouts carry RE columns.
function fixture({ withRe = true, days = 49, extra = {} } = {}) {
  const ds = Array.from({ length: days }, (_, i) => addDays(ASOF, i - (days - 1)));
  const hrv = ds.map((date, i) => ({ date, value: 60 + wig(i), source: 'Watch' }));
  const rhr = ds.map((date, i) => ({ date, value: 50 + wig(i) * 0.5, source: 'Watch' }));
  const sleep = ds.map((date, i) => ({ date, value: 7.5 + wig(i) * 0.2, bedtime: 23 + wig(i) * 0.1, waketime: 7 + wig(i) * 0.1, ...SLEEP_COLS }));
  const lines = [];
  ds.forEach((d, i) => {
    if (i % 2 === 0) lines.push(`${d},Running,40,,140,,165,${withRe ? 'Strava API' : 'Watch'},5${withRe ? `,${50 + (i % 7)},` : ''}`);
    if (i % 3 === 0) lines.push(`${d},HighIntensityIntervalTraining,45,,130,,160,${withRe ? 'Strava API' : 'Watch'},${withRe ? `,${30 + (i % 5)},` : ''}`);
  });
  const cells = lines.map((l) => l.split(','));
  return deepFreeze({
    ...EMPTY, series: { ...EMPTY.series, hrv, rhr }, sleep,
    workoutLoad: workoutLoadFromCells(cells), workouts: workoutsFromCells(cells), rides: ridesFromCells(cells),
    runs: runsFromCells(cells), trainingRows: trainingRowsFromCells(cells), ...extra,
  });
}

test('buildScoresFrom returns the baked shape: hasData, asOf, reEpoch, recovery, load, advice', () => {
  const s = buildScoresFrom(fixture());
  assert.equal(s.hasData, true);
  assert.equal(s.asOf, ASOF);
  assert.equal(typeof s.reEpoch, 'string');
  assert.equal(s.recovery.gated, false);
  assert.deepEqual(s.load.modalities.map((m) => m.key), ['gym', 'run', 'bike']);
  assert.ok(s.advice === null || typeof s.advice.key === 'string');
  assert.deepEqual(s.monitor.cards.map((c) => c.key), ['respiratory', 'rhr', 'hrv', 'wristTemp', 'sleep'], 'health monitor baked alongside');
  assert.equal(s.monitor.cards.find((c) => c.key === 'hrv').state, 'ok');
  assert.equal(s.sleep.last.date, ASOF, 'sleep scores baked alongside (lib/score/sleep.mjs)');
  assert.equal(s.sleep.need, 7.5);
  JSON.stringify(s);
});

test('buildScoresFrom is empty (never throws) over the all-null readExtract inputs (null dir, empty dir, absent CSVs)', () => {
  // readExtract gives this same shape for null, undefined, an empty and a missing dir (lib/extract/read.test.mjs)
  const s = buildScoresFrom(EMPTY);
  const { monitor, timeline, tonight, sleep, days, strain, stress, energy, journal, fitnessAge, ...rest } = s;
  assert.deepEqual(fitnessAge, { ok: false, reason: 'no-sex' }, 'no profile sex: the fitness age shows its reason');
  assert.equal(journal.behaviors.length, 18, 'the journal behaviour list is always baked (no profile sex: no period question)');
  assert.equal(days, null, 'no overnight data: no day-stepping history');
  assert.equal(stress, null, 'no hr-hourly.csv: no stress estimate (tile 2 stays HRV)');
  assert.equal(strain, null, 'no hr-hourly.csv: no day strain (the load dial stays)');
  assert.equal(energy, null, 'no hr-hourly.csv: no energy bank (the card is hidden)');
  assert.equal(tonight, null, 'no sleep data: no bedtime, the card is hidden');
  assert.equal(sleep, null, 'no sleep data: no sleep scores');
  assert.deepEqual(rest, { hasData: false, asOf: null, reEpoch: null, recovery: null, load: null, advice: null });
  assert.deepEqual(timeline, { asOf: null, days: [] }, 'the timeline is baked empty');
  assert.equal(monitor.asOf, null);
  assert.ok(monitor.cards.every((c) => c.state === 'none'), 'the monitor still has its five (empty) cards');
});

test('insufficient recovery bakes no advice', () => {
  const s = buildScoresFrom(fixture({ days: 10 }));
  assert.equal(s.recovery.gated, true);
  assert.equal(s.advice, null);
});

test('the baked JSON carries no today-relative values: identical output on any build date', () => {
  const inputs = fixture();
  const at = (iso) => {
    mock.timers.enable({ apis: ['Date'], now: new Date(iso) });
    try { return JSON.stringify(buildScoresFrom(inputs)); } finally { mock.timers.reset(); }
  };
  assert.equal(at('2026-09-30T06:00:00Z'), at('2029-02-03T20:00:00Z'));
});

test('Home and Salud read the same row source: every workouts.csv row reaches the Home coverage', () => {
  const inputs = fixture();
  const c = buildScoresFrom(inputs).load.coverage;
  assert.equal(c.scored + c.unscored + c.invalid + c.droppedJunk + c.superseded + c.preEpoch, inputs.workoutLoad.length);
});

test('Salud is unaffected by the RE columns: same HR index with and without relative_effort', () => {
  const a = fixture({ withRe: true });
  const b = fixture({ withRe: false });
  const lr = (x) => aggLoadRecovery(x.workoutLoad, x.series.hrv, x.series.rhr);
  assert.deepEqual(lr(a), lr(b));
  assert.equal(lr(a).hasData, true);
  assert.deepEqual(healthFrom(a).loadRecovery, healthFrom(b).loadRecovery);
});

test('buildScoresFrom bakes day strain from hr-hourly.csv + workout-zones.csv, without the full-year history', () => {
  const ds = Array.from({ length: 20 }, (_, i) => addDays(ASOF, i - 19));
  // the readExtract projections of the two files (hr-hourly cells: header dropped; zone lines: header kept)
  const hrCells = ds.map((d, i) => `${d},${d}T09:00:00+02:00,100,110,90,12,700,0,${100 + i}:3600,Shortcut`.split(','));
  const zoneLines = ['date,activity_id,type,max_hr,max_hr_source,hr_avg,hr_max,z0_s,z1_s,z2_s,z3_s,z4_s,z5_s,source,start,elapsed_s',
    `${ASOF},1,Running,190,observed,150,170,0,0,0,600,0,0,Strava API,${ASOF}T18:00:00+02:00,600`];
  const s = buildScoresFrom(fixture({ extra: {
    hrHourly: hrHourlyFromCells(hrCells), hrHours: hrHoursFromCells(hrCells),
    zones: zonesFromLines(zoneLines), activities: activitiesFromLines(zoneLines),
  } }));
  assert.equal(s.strain.ok, true);
  assert.equal(s.strain.asOf, ASOF);
  assert.equal(s.strain.all, undefined);
  assert.equal(s.strain.days[s.strain.days.length - 1].acts[0].m, 'run');
  // the stress estimate reads the same hours (one waking hour a day: under MIN_HOURS, no value)
  assert.equal(s.stress.ok, true);
  assert.equal(s.stress.asOf, ASOF);
  assert.equal(s.stress.days[s.stress.days.length - 1].avg, null);
});

/* ---------- the pure cores over readExtract inputs (lib/extract/read.mjs) ---------- */

const DEMO = path.join(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))), 'data', 'demo', 'extract');

// Golden-backed parity: the pure core alone, over readExtract, reproduces the committed bake goldens' `scores`
// (web/test/fixtures/bake-golden.{example,null}.json, written by computeBakes from main's code) under the
// golden's fixed clock + UTC — independent of how the page wires it, and on deep-frozen inputs.
function underGoldenClock(fn) {
  const tz = process.env.TZ;
  process.env.TZ = 'UTC';
  mock.timers.enable({ apis: ['Date'], now: new Date(GOLDEN_NOW) });
  try { return fn(); } finally {
    mock.timers.reset();
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
}

test('buildScoresFrom over the frozen readExtract inputs equals the committed golden scores (demo and null extract)', () => {
  for (const [kind, dir] of [['example', DEMO], ['null', null]]) {
    const golden = JSON.parse(fs.readFileSync(FIXTURES[kind], 'utf8'));
    const inputs = readExtract(dir);
    assert.ok(Object.isFrozen(inputs.series), 'readExtract deep-freezes: a core mutating its inputs would throw here');
    const s = underGoldenClock(() => buildScoresFrom(inputs, { sex: golden.profile.sex ?? null }));
    assert.deepEqual(canonical(s), golden.scores, kind);
  }
});

test('strain / stress / energy short-circuit to null without hr-hourly.csv, whatever else is present', () => {
  const x = readExtract(DEMO);
  const noHr = { ...x, hrHourly: null, hrHours: null };
  assert.equal(strainFrom(noHr), null);
  assert.equal(stressFrom(noHr), null);
  assert.equal(energyFrom(noHr, { stress: stressFrom(x), days: null, strain: null }), null);
  assert.notEqual(strainFrom(x), null);
  assert.notEqual(stressFrom(x), null);
  assert.equal(strainFrom({}), null);
});

test('recoveryFrom is null only when hrv, rhr and sleep are all absent; loadFrom null without workouts', () => {
  const x = readExtract(DEMO);
  assert.equal(recoveryFrom({ series: { hrv: null, rhr: null }, sleep: null }), null);
  assert.equal(recoveryFrom({}), null);
  assert.notEqual(recoveryFrom({ series: { hrv: x.series.hrv, rhr: null }, sleep: null }), null);
  assert.equal(loadFrom({ workoutLoad: null }), null);
  assert.notEqual(loadFrom(x), null);
});

