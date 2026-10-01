/* Tests for extract.js against SYNTHETIC export.xml files: the script is copied (with samples.js)
 * into a temp dir and run as a child process, exactly like the owner runs it. No personal data. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const NBSP = ' ';
const WATCH = `Apple${NBSP}Watch de Demo`;

function runExtract(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-test-'));
  for (const f of ['extract.js', 'samples.js']) fs.copyFileSync(path.join(__dirname, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'export.xml'), ['<HealthData locale="en_GB">', ...lines, '</HealthData>', ''].join('\n'));
  execFileSync(process.execPath, [path.join(dir, 'extract.js')], { stdio: 'ignore' });
  const out = path.join(dir, 'extract');
  const read = f => fs.readFileSync(path.join(out, f), 'utf8');
  return { read, meta: JSON.parse(read('_meta.json')), cleanup: () => fs.rmSync(dir, { recursive: true }) };
}
const rec = (type, src, start, value, extra = '') =>
  `<Record type="HKQuantityTypeIdentifier${type}" sourceName="${src}" unit="kcal" startDate="${start}" endDate="${start}" value="${value}"${extra}/>`;

test('energy: only Apple Watch sources are summed (a scale\'s estimated BMR no longer doubles basal)', () => {
  const x = runExtract([
    rec('BasalEnergyBurned', WATCH, '2030-01-02 08:00:00 +0100', 900),
    rec('BasalEnergyBurned', WATCH, '2030-01-02 20:00:00 +0100', 900),
    rec('BasalEnergyBurned', 'RENPHO', '2030-01-02 07:30:00 +0100', 1750), // weigh-in day BMR estimate
    rec('ActiveEnergyBurned', WATCH, '2030-01-02 10:00:00 +0100', 400),
    rec('ActiveEnergyBurned', 'Apple Watch de Demo', '2030-01-02 11:00:00 +0100', 100), // plain space too
    rec('ActiveEnergyBurned', 'iPhone de Demo', '2030-01-02 12:00:00 +0100', 250),
    // a day with energy from non-Watch sources only -> missing (no row), never a phone/scale guess
    rec('BasalEnergyBurned', 'RENPHO', '2030-01-03 07:30:00 +0100', 1750),
    rec('ActiveEnergyBurned', 'iPhone de Demo', '2030-01-03 12:00:00 +0100', 300),
    rec('StepCount', 'iPhone de Demo', '2030-01-04 12:00:00 +0100', 10), // later date, so 01-03 is not the last day
  ]);
  try {
    assert.equal(x.read('basal-energy-daily.csv'), 'date,kcal\n2030-01-02,1800\n');
    assert.equal(x.read('active-energy-daily.csv'), 'date,kcal\n2030-01-02,500\n');
  } finally { x.cleanup(); }
});

test('energy: an export with NO Apple Watch energy at all keeps every source (a phone-only user)', () => {
  const x = runExtract([
    rec('ActiveEnergyBurned', 'iPhone de Demo', '2030-01-02 12:00:00 +0100', 250),
    rec('ActiveEnergyBurned', 'iPhone de Demo', '2030-01-02 18:00:00 +0100', 50),
    rec('StepCount', 'iPhone de Demo', '2030-01-03 12:00:00 +0100', 10),
  ]);
  try {
    assert.equal(x.read('active-energy-daily.csv'), 'date,kcal\n2030-01-02,300\n');
    assert.equal(x.meta.energySources, 'all');
  } finally { x.cleanup(); }
});

test('the export\'s last date is recorded and dropped from the DAILY TOTAL series (a partial day)', () => {
  const x = runExtract([
    '<ExportDate value="2030-01-03 08:12:00 +0100"/>',
    rec('StepCount', WATCH, '2030-01-02 12:00:00 +0100', 9000),
    rec('StepCount', WATCH, '2030-01-03 07:00:00 +0100', 971),
    rec('ActiveEnergyBurned', WATCH, '2030-01-02 12:00:00 +0100', 600),
    rec('ActiveEnergyBurned', WATCH, '2030-01-03 07:00:00 +0100', 103),
    rec('BasalEnergyBurned', WATCH, '2030-01-02 12:00:00 +0100', 1800),
    rec('BasalEnergyBurned', WATCH, '2030-01-03 07:00:00 +0100', 918),
    rec('AppleExerciseTime', WATCH, '2030-01-02 12:00:00 +0100', 40),
    rec('AppleExerciseTime', WATCH, '2030-01-03 07:00:00 +0100', 1),
    rec('DistanceWalkingRunning', WATCH, '2030-01-02 12:00:00 +0100', 6.1),
    rec('DistanceWalkingRunning', WATCH, '2030-01-03 07:00:00 +0100', 0.76),
    rec('FlightsClimbed', WATCH, '2030-01-02 12:00:00 +0100', 8),
    rec('FlightsClimbed', WATCH, '2030-01-03 07:00:00 +0100', 1),
    rec('DietaryEnergyConsumed', 'Food App', '2030-01-02 12:00:00 +0100', 2200),
    rec('DietaryEnergyConsumed', 'Food App', '2030-01-03 07:00:00 +0100', 300),
    rec('RestingHeartRate', WATCH, '2030-01-03 07:00:00 +0100', 50), // a point series keeps its row
    rec('RespiratoryRate', WATCH, '2030-01-03 03:00:00 +0100', 14), // a daily MEAN keeps its row
  ]);
  try {
    assert.equal(x.meta.exportLastDate, '2030-01-03');
    assert.equal(x.read('steps-daily.csv'), `date,steps,source\n2030-01-02,9000,${WATCH}\n`);
    assert.equal(x.read('active-energy-daily.csv'), 'date,kcal\n2030-01-02,600\n');
    assert.equal(x.read('basal-energy-daily.csv'), 'date,kcal\n2030-01-02,1800\n');
    assert.equal(x.read('exercise-minutes-daily.csv'), 'date,minutes\n2030-01-02,40\n');
    assert.equal(x.read('distance-daily.csv'), 'date,km\n2030-01-02,6.10\n');
    assert.equal(x.read('flights-daily.csv'), 'date,flights\n2030-01-02,8\n');
    assert.equal(x.read('dietary-daily.csv'), 'date,kcal,protein_g,carbs_g,fat_g\n2030-01-02,2200,0.0,0.0,0.0\n');
    assert.match(x.read('rhr.csv'), /^2030-01-03,50,/m);
    assert.match(x.read('respiratory-daily.csv'), /^2030-01-03,14\.0$/m);
  } finally { x.cleanup(); }
});

test('without an <ExportDate>, the last date is the newest record date', () => {
  const x = runExtract([
    rec('StepCount', WATCH, '2030-01-02 12:00:00 +0100', 9000),
    rec('StepCount', WATCH, '2030-01-05 07:00:00 +0100', 500),
  ]);
  try {
    assert.equal(x.meta.exportLastDate, '2030-01-05');
    assert.equal(x.read('steps-daily.csv'), `date,steps,source\n2030-01-02,9000,${WATCH}\n`);
  } finally { x.cleanup(); }
});

test('extract.js uses the same anchored Apple Watch regex as lib/training/sessions.mjs', async () => {
  const { SOURCE_PRECEDENCE } = await import('../../lib/training/sessions.mjs');
  const { APPLE_WATCH_RE } = require('./samples.js');
  const watch = SOURCE_PRECEDENCE.find(p => p.name === 'Apple Watch').re;
  assert.equal(APPLE_WATCH_RE.source, watch.source);
  assert.equal(APPLE_WATCH_RE.flags, watch.flags);
  assert.ok(APPLE_WATCH_RE.test(WATCH) && !APPLE_WATCH_RE.test('My Apple Watch') && !APPLE_WATCH_RE.test('RENPHO'));
});
