/* scripts/make-demo-data.mjs — synthetic demo extract for the example build. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeDemoData, prng, DEMO_DIR, DEMO_DEFAULTS } from './make-demo-data.mjs';
import { buildScores } from '../lib/score/index.mjs';
import { buildHealth } from '../lib/health/aggregate.mjs';
import { buildIntake } from '../lib/nutrition/intake.mjs';
import { buildDials } from '../web/src/view/dial.mjs';

const require = createRequire(import.meta.url);
const { READING_HEADER, SLEEP_HEADER, WORKOUTS_HEADER } = require('../data/apple-health/samples.js');

function withDemoDir(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-extract-'));
  try {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('prng() is deterministic per seed', () => {
  const a = prng(7), b = prng(7), c = prng(8);
  const seqA = [a(), a(), a()];
  assert.deepEqual(seqA, [b(), b(), b()]);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
});

test('makeDemoData() is deterministic: same options -> identical bytes; another seed -> different data', () => {
  assert.deepEqual(makeDemoData(), makeDemoData());
  assert.notDeepEqual(makeDemoData({ seed: 1 })['hrv.csv'], makeDemoData()['hrv.csv']);
});

test('the tracked data/demo/extract files are exactly the generator output (re-run the script after changing it)', () => {
  const files = makeDemoData();
  assert.deepEqual(fs.readdirSync(DEMO_DIR).filter((f) => f.endsWith('.csv')).sort(), Object.keys(files).sort());
  for (const [name, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(DEMO_DIR, name), 'utf8'), text, `${name} drifted from the generator`);
  }
});

test('demo CSVs use the exact extract schemas, cover the window, and are tagged as demo data', () => {
  const files = makeDemoData();
  const head = (f) => files[f].split('\n')[0];
  for (const f of ['hrv.csv', 'rhr.csv', 'vo2max.csv', 'weight.csv', 'bodyfat.csv', 'leanmass.csv', 'waist.csv', 'wristTemp.csv']) assert.equal(head(f), READING_HEADER, f);
  assert.equal(head('sleep-daily.csv'), SLEEP_HEADER);
  assert.equal(head('workouts.csv'), WORKOUTS_HEADER);
  assert.equal(head('dietary-daily.csv'), 'date,kcal,protein_g,carbs_g,fat_g');
  const rows = (f) => files[f].trim().split('\n').slice(1);
  assert.equal(rows('sleep-daily.csv').length, DEMO_DEFAULTS.days);
  assert.equal(rows('sleep-daily.csv').at(-1).slice(0, 10), DEMO_DEFAULTS.end);
  for (const f of ['weight.csv', 'hrv.csv', 'workouts.csv', 'steps-daily.csv']) {
    for (const r of rows(f)) assert.match(r, /,Demo [A-Z][a-z]+(,|$)/, `${f} row not demo-tagged: ${r}`);
  }
  for (const r of rows('workouts.csv')) assert.equal(r.split(',').length, 12);
  // every demo night carries plausible stage columns: REM + deep + core = asleep, in bed >= asleep
  for (const r of rows('sleep-daily.csv')) {
    const c = r.split(',').map(Number);
    assert.equal(c.length, 11, r);
    assert.ok(Math.abs(c[5] + c[6] + c[7] - c[1]) < 0.03, `stages sum to asleep: ${r}`);
    assert.ok(c[6] > 0 && c[5] > 0 && c[10] >= c[1], r);
  }
});

test('the demo extract populates every Inicio dial and every Salud section', () => withDemoDir(makeDemoData(), (dir) => {
  const scores = buildScores(dir);
  assert.equal(scores.recovery.gated, false, 'recovery is ungated');
  assert.deepEqual(scores.load.modalities.map((m) => [m.key, m.trend.ok]), [['gym', true], ['run', true], ['bike', true]]);
  const health = buildHealth(dir);
  for (const k of ['body', 'activity', 'energy', 'running', 'cycling', 'recovery', 'loadRecovery']) assert.equal(health[k].hasData, true, k);
  assert.ok(health.body.waist && health.body.bodyfat && health.body.lean);
  assert.ok(health.energy.balance && health.energy.macros, 'enough logged intake days for balance + macro split');
  const dials = buildDials(scores, health);
  assert.deepEqual([dials.sleep.state, dials.recovery.state, dials.load.state], ['ok', 'ok', 'ok']);
  const intake = buildIntake(dir, { train: { k: 2500, p: 170, c: 260, g: 70 }, rest: { k: 2100, p: 160, c: 200, g: 70 } });
  assert.equal(intake.latest.date, DEMO_DEFAULTS.end, 'intake logged on the last demo day');
}));

test('demo workout-zones.csv: one Demo Strava row per Strava run / ride, the reader schema, zones ~ the duration', async () => {
  const { readWorkoutZones, ZONES_CSV } = await import('../lib/training/zones.mjs');
  const files = makeDemoData();
  const strava = files['workouts.csv'].trim().split('\n').slice(1).filter((l) => l.includes(',Demo Strava,'));
  const rows = withDemoDir(files, readWorkoutZones);
  assert.equal(files[ZONES_CSV].trim().split('\n').length - 1, strava.length);
  assert.equal(rows.length, strava.length);
  for (const [i, r] of rows.entries()) {
    const dur = parseFloat(strava[i].split(',')[2]) * 60;
    const sum = r.z.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - dur * 0.97) <= 6, `zones ~ 97 % of the duration on ${r.date}`);
    assert.equal(r.maxSrc, 'observed');
  }
  for (const l of files[ZONES_CSV].trim().split('\n').slice(1)) assert.match(l, /,Demo Strava,\d{4}-\d{2}-\d{2}T18:00:00\+02:00,\d+$/);
});
