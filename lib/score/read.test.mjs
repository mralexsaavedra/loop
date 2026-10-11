/* lib/score/read.mjs: the score readers (hr-hourly.csv, workout-zones.csv) and the build* wrappers
 * over temp extracts. SYNTHETIC values only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readHrHourly, buildStrain, readHrHours, buildStress, readActivities, buildEnergy } from './read.mjs';

const D = '2030-01-10';

test('readHrHourly / buildStrain read hr-hourly.csv + workout-zones.csv; a missing hour file -> null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strain-'));
  try {
    assert.equal(buildStrain(dir), null);
    fs.writeFileSync(path.join(dir, 'hr-hourly.csv'), 'date,hour_start,avg,max,min,n,covered_min,act_min,hist,source\n' +
      '2030-01-01,2030-01-01T09:00:00+01:00,80.0,100,60,12,55.0,0.0,60:300 100:600,Shortcut\nbad\n');
    assert.deepEqual(readHrHourly(dir), [{ date: '2030-01-01', cov: 55, hist: new Map([[60, 300], [100, 600]]) }]);
    assert.deepEqual(buildStrain(dir), { ok: false, reason: 'noMaxHr', asOf: '2030-01-01', n: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readHrHours + buildStress: hr-hourly.csv rows -> hours; no file -> null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stress-'));
  try {
    assert.equal(buildStress(dir), null);
    fs.writeFileSync(path.join(dir, 'hr-hourly.csv'), 'date,hour_start,avg,max,min,n,covered_min,act_min,hist,source\n' +
      '2030-01-02,2030-01-02T10:00:00+01:00,70.5,80,60,12,60.0,10.0,70:3000,W\nbad\n');
    const rows = readHrHours(dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].start, '2030-01-02T10:00:00+01:00');
    assert.equal(rows[0].avg, 70.5);
    assert.equal(rows[0].act, 10);
    assert.equal(rows[0].hist.get(70), 3000);
    assert.deepEqual(buildStress(dir), { ok: false, reason: 'noMaxHr', asOf: '2030-01-02' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readActivities: workout-zones.csv start + elapsed_s; rows without them are skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-'));
  try {
    assert.equal(readActivities(dir), null);
    fs.writeFileSync(path.join(dir, 'workout-zones.csv'),
      'date,activity_id,type,max_hr,max_hr_source,hr_avg,hr_max,z0_s,z1_s,z2_s,z3_s,z4_s,z5_s,source,start,elapsed_s\n' +
      `${D},1,Running,190,profile,150,170,0,0,600,1200,600,0,S,${D}T18:00:00+01:00,2400\n` +
      `${D},2,Running,190,profile,150,170,0,0,600,1200,600,0,S,,\n`);
    const a = readActivities(dir);
    assert.equal(a.length, 1);
    assert.equal(a[0].elapsed, 2400);
    assert.deepEqual(a[0].z, [0, 0, 600, 1200, 600, 0]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no extract dir: every reader and wrapper returns null', () => {
  for (const f of [readHrHourly, buildStrain, readHrHours, buildStress, readActivities, buildEnergy]) assert.equal(f(null), null, f.name);
});
