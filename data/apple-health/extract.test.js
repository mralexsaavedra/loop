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

const PHONE = 'iPhone de Demo';
const later = d => rec('StepCount', PHONE, `${d} 12:00:00 +0100`, 10); // a later date, so the tested day is not the (partial) last one

test('energy: Apple Watch + iPhone on the same day -> the Watch only (never a sum)', () => {
  const x = runExtract([
    rec('ActiveEnergyBurned', WATCH, '2030-01-02 10:00:00 +0100', 400),
    rec('ActiveEnergyBurned', WATCH, '2030-01-02 11:00:00 +0100', 100),
    rec('ActiveEnergyBurned', PHONE, '2030-01-02 12:00:00 +0100', 250),
    rec('BasalEnergyBurned', WATCH, '2030-01-02 08:00:00 +0100', 1700),
    rec('BasalEnergyBurned', PHONE, '2030-01-02 08:00:00 +0100', 1650),
    later('2030-01-03'),
  ]);
  try {
    assert.equal(x.read('active-energy-daily.csv'), 'date,kcal\n2030-01-02,500\n');
    assert.equal(x.read('basal-energy-daily.csv'), 'date,kcal\n2030-01-02,1700\n');
    assert.deepEqual(x.meta.energySources, { active: { 'Apple Watch': 1 }, basal: { 'Apple Watch': 1 } });
  } finally { x.cleanup(); }
});

test('energy: a wrist wearable app (Zepp) beats the iPhone; the iPhone beats a scale; excluded-only days have no row', () => {
  const x = runExtract([
    // pre-Watch history: Zepp + iPhone -> Zepp
    rec('ActiveEnergyBurned', 'Zepp', '2030-01-02 10:00:00 +0100', 380),
    rec('ActiveEnergyBurned', PHONE, '2030-01-02 12:00:00 +0100', 210),
    rec('ActiveEnergyBurned', 'Hevy', '2030-01-02 18:00:00 +0100', 150), // a training app: never used
    // iPhone + RENPHO basal -> iPhone (the scale's BMR estimate is ignored)
    rec('BasalEnergyBurned', PHONE, '2030-01-02 08:00:00 +0100', 1600),
    rec('BasalEnergyBurned', 'RENPHO Health', '2030-01-02 07:30:00 +0100', 1750),
    // RENPHO-only basal, Hevy-only active -> no row
    rec('BasalEnergyBurned', 'RENPHO Health', '2030-01-03 07:30:00 +0100', 1750),
    rec('ActiveEnergyBurned', 'Hevy', '2030-01-03 18:00:00 +0100', 150),
    // phone-only day (no wearable) -> the iPhone
    rec('ActiveEnergyBurned', PHONE, '2030-01-04 12:00:00 +0100', 300),
    rec('ActiveEnergyBurned', PHONE, '2030-01-04 18:00:00 +0100', 50),
    later('2030-01-05'),
  ]);
  try {
    assert.equal(x.read('active-energy-daily.csv'), 'date,kcal\n2030-01-02,380\n2030-01-04,350\n');
    assert.equal(x.read('basal-energy-daily.csv'), 'date,kcal\n2030-01-02,1600\n');
    assert.deepEqual(x.meta.energySources, { active: { Zepp: 1, iPhone: 1 }, basal: { iPhone: 1 } });
  } finally { x.cleanup(); }
});

test('energy: two sources of the same rank on one day -> the larger total, never a sum', () => {
  const x = runExtract([
    rec('ActiveEnergyBurned', 'Zepp', '2030-01-02 10:00:00 +0100', 300),
    rec('ActiveEnergyBurned', 'Mi Fit', '2030-01-02 10:00:00 +0100', 320),
    later('2030-01-03'),
  ]);
  try {
    assert.equal(x.read('active-energy-daily.csv'), 'date,kcal\n2030-01-02,320\n');
    assert.deepEqual(x.meta.energySources.active, { 'Mi Fit': 1 });
  } finally { x.cleanup(); }
});

test('energySource: precedence Apple Watch (NBSP-safe, anchored) > wrist wearable apps > iPhone > excluded', () => {
  const { energySource } = require('./samples.js');
  assert.deepEqual(energySource(WATCH), { rank: 0, family: 'Apple Watch' });
  assert.deepEqual(energySource('Apple Watch de Demo'), { rank: 0, family: 'Apple Watch' });
  for (const w of ['Zepp', 'Zepp Life', 'Mi Fit', 'Mi Fitness', 'Garmin Connect', 'Polar Flow', 'Fitbit', 'Huawei Health', 'Amazfit']) {
    assert.equal(energySource(w)?.rank, 1, w);
  }
  assert.deepEqual(energySource('iPhone de Demo'), { rank: 2, family: 'iPhone' });
  for (const s of ['RENPHO Health', 'OKOK', 'Withings', 'Health Mate', 'Hevy', 'Nike Run Club', 'Nike Training',
    'Strava', 'YAZIO', 'Merge', 'Training', 'ROXFIT', 'My Apple Watch', 'My iPhone', '', undefined]) {
    assert.equal(energySource(s), null, String(s));
  }
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
