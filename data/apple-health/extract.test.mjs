/* Tests for extract.mjs against SYNTHETIC export.xml files: the script runs as a child process, exactly
 * like the user runs it, on a temp dir (EXTRACT_DIR: its export.xml in, its extract/ out). No personal data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { energySource, APPLE_WATCH_RE } from '../../lib/extract/samples.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NBSP = ' ';
const WATCH = `Apple${NBSP}Watch de Demo`;

function runExtract(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-test-'));
  fs.writeFileSync(path.join(dir, 'export.xml'), ['<HealthData locale="en_GB">', ...lines, '</HealthData>', ''].join('\n'));
  execFileSync(process.execPath, [path.join(__dirname, 'extract.mjs')], { stdio: 'ignore', env: { ...process.env, EXTRACT_DIR: dir } });
  const out = path.join(dir, 'extract');
  const read = f => fs.readFileSync(path.join(out, f), 'utf8');
  return { read, files: fs.readdirSync(out), meta: JSON.parse(read('_meta.json')), cleanup: () => fs.rmSync(dir, { recursive: true }) };
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

test('extract.mjs uses the same anchored Apple Watch regex as lib/training/sessions.mjs', async () => {
  const { SOURCE_PRECEDENCE } = await import('../../lib/training/sessions.mjs');
  const watch = SOURCE_PRECEDENCE.find(p => p.name === 'Apple Watch').re;
  assert.equal(APPLE_WATCH_RE.source, watch.source);
  assert.equal(APPLE_WATCH_RE.flags, watch.flags);
  assert.ok(APPLE_WATCH_RE.test(WATCH) && !APPLE_WATCH_RE.test('My Apple Watch') && !APPLE_WATCH_RE.test('RENPHO'));
});

test('importing extract.mjs runs nothing (isMain guard); run without an export.xml it exits 1 and writes nothing', async () => {
  const mod = await import('./extract.mjs');
  assert.equal(typeof mod.main, 'function');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-none-'));
  try {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'extract.mjs')], { encoding: 'utf8', env: { ...process.env, EXTRACT_DIR: dir } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /export\.xml not found/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every extract file is written atomically (sync-common writeAtomic): no direct write, no temp file left', () => {
  const src = fs.readFileSync(path.join(__dirname, 'extract.mjs'), 'utf8');
  assert.doesNotMatch(src, /\bwriteFileSync\(/);
  const x = runExtract([rec('StepCount', PHONE, '2030-01-01 12:00:00 +0100', 10), later('2030-01-02')]);
  try {
    assert.ok(x.files.includes('_meta.json') && x.files.includes('steps-daily.csv'), x.files.join());
    assert.deepEqual(x.files.filter((f) => f.endsWith('.tmp')), []);
  } finally {
    x.cleanup();
  }
});

test('source names: commas never shift columns and XML entities are decoded (same cell as the Shortcut path)', () => {
  const x = runExtract([
    rec('BodyMass', 'Alex, Watch', '2030-01-02 07:00:00 +0100', 70.5),
    rec('BodyMass', 'Scale, Kitchen &amp; Co', '2030-01-02 08:00:00 +0100', 70.4),
    rec('StepCount', 'Alex, Watch', '2030-01-02 12:00:00 +0100', 9000),
    '<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Scale, Kitchen &amp; Co" startDate="2030-01-01 23:00:00 +0100" endDate="2030-01-02 07:00:00 +0100" value="HKCategoryValueSleepAnalysisAsleepCore"/>',
    '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" sourceName="Alex, Watch" startDate="2030-01-02 18:00:00 +0100" endDate="2030-01-02 18:30:00 +0100">',
    '</Workout>',
    later('2030-01-03'),
  ]);
  try {
    assert.equal(x.read('weight.csv'), 'date,value,source\n2030-01-02,70.5,Alex  Watch\n2030-01-02,70.4,Scale  Kitchen & Co\n');
    assert.match(x.read('steps-daily.csv'), /\n2030-01-02,9000,Alex {2}Watch\n/);
    const sleep = x.read('sleep-daily.csv').split('\n')[1].split(',');
    assert.equal(sleep.length, 11);
    assert.equal(sleep[2], 'Scale  Kitchen & Co');
    const w = x.read('workouts.csv').split('\n')[1].split(',');
    assert.equal(w.length, 12);
    assert.equal(w[7], 'Alex  Watch');
  } finally { x.cleanup(); }
});

test('strict CLI: --help prints the usage (exit 0), an unknown flag or a stray argument exits 2 before any write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-cli-'));
  try {
    fs.writeFileSync(path.join(dir, 'export.xml'), '<HealthData>\n</HealthData>\n');
    const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'extract.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, EXTRACT_DIR: dir } });
    const help = run('--help');
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^Usage: node data\/apple-health\/extract\.mjs/);
    for (const args of [['--bogus'], ['export.xml']]) {
      const r = run(...args);
      assert.equal(r.status, 2, args.join(' '));
      assert.match(r.stderr, /^ERROR: /);
      assert.match(r.stderr, /Usage: /);
    }
    assert.deepEqual(fs.readdirSync(dir), ['export.xml'], 'no extract/ was written');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- failure paths: a truncated or unreadable export never replaces a good extract; writes hold the lock ----

function goodExtractDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-fail-'));
  fs.writeFileSync(path.join(dir, 'export.xml'), ['<HealthData locale="en_GB">', later('2030-01-02'), later('2030-01-03'), '</HealthData>', ''].join('\n'));
  const run = () => spawnSync(process.execPath, [path.join(__dirname, 'extract.mjs')], { encoding: 'utf8', env: { ...process.env, EXTRACT_DIR: dir } });
  assert.equal(run().status, 0);
  const out = path.join(dir, 'extract');
  const snapshot = () => Object.fromEntries(fs.readdirSync(out).sort().map((f) => [f, fs.readFileSync(path.join(out, f), 'utf8')]));
  return { dir, out, run, snapshot, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a truncated export (no </HealthData>) exits 1 with one ERROR line and keeps the previous extract', () => {
  const x = goodExtractDir();
  try {
    const before = x.snapshot();
    fs.writeFileSync(path.join(x.dir, 'export.xml'), ['<HealthData locale="en_GB">', later('2030-01-02'), ''].join('\n'));
    const r = x.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^ERROR: .*<\/HealthData>/);
    assert.deepEqual(x.snapshot(), before, 'the good extract is untouched');
  } finally { x.cleanup(); }
});

test('an unreadable export (a read error mid-stream) exits 1 with one ERROR line and writes nothing', () => {
  const x = goodExtractDir();
  try {
    const before = x.snapshot();
    fs.rmSync(path.join(x.dir, 'export.xml'));
    fs.mkdirSync(path.join(x.dir, 'export.xml')); // exists, but reading it fails (EISDIR)
    const r = x.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^ERROR: /);
    assert.deepEqual(x.snapshot(), before);
  } finally { x.cleanup(); }
});

test('the writes run under the _meta.json lock the syncs share: a held fresh lock -> exit 1, nothing written', () => {
  const x = goodExtractDir();
  try {
    const before = x.snapshot();
    fs.writeFileSync(path.join(x.out, '_meta.json.lock'), String(process.pid)); // a live holder, not stale
    const r = x.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^ERROR: could not acquire lock/);
    fs.rmSync(path.join(x.out, '_meta.json.lock'));
    assert.deepEqual(x.snapshot(), before);
  } finally { x.cleanup(); }
});

// ---- non-Watch wearables (Mi Fitness shapes) vs an Apple Watch: SYNTHETIC values ----------------
// Shapes observed on a real Mi Fitness export: sleep = InBed records only (whole nights + many 0.3-1 h
// afternoon fragments); heart rate = hour BUCKETS (every record spans one clock hour, start hh:00:00,
// several records per hour), no RestingHeartRate, no HRV.
const sleepRec = (src, start, end, value) =>
  `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="${src}" sourceVersion="1" creationDate="${end}" startDate="${start}" endDate="${end}" value="HKCategoryValueSleepAnalysis${value}"/>`;
const hrRec = (src, start, end, bpm) =>
  `<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="${src}" sourceVersion="1" unit="count/min" creationDate="${end}" startDate="${start}" endDate="${end}" value="${bpm}"/>`;
const rhrRec = (src, start, bpm) =>
  `<Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="${src}" unit="count/min" startDate="${start}" endDate="${start}" value="${bpm}"/>`;

// An Apple Watch user: staged asleep night + the iPhone's InBed bedtime, a Watch-off night with only the
// iPhone's InBed, heart-rate samples every few minutes at night, a measured resting HR on one day only.
const WATCH_FIXTURE = [
  sleepRec(PHONE, '2030-01-01 22:45:00 +0100', '2030-01-02 07:20:00 +0100', 'InBed'),
  sleepRec(WATCH, '2030-01-01 23:00:00 +0100', '2030-01-02 03:00:00 +0100', 'AsleepCore'),
  sleepRec(WATCH, '2030-01-02 03:00:00 +0100', '2030-01-02 03:20:00 +0100', 'Awake'),
  sleepRec(WATCH, '2030-01-02 03:20:00 +0100', '2030-01-02 05:00:00 +0100', 'AsleepDeep'),
  sleepRec(WATCH, '2030-01-02 05:00:00 +0100', '2030-01-02 07:00:00 +0100', 'AsleepREM'),
  sleepRec(PHONE, '2030-01-02 23:00:00 +0100', '2030-01-03 07:00:00 +0100', 'InBed'), // Watch off this night
  ...Array.from({ length: 84 }, (_, i) => {
    const m = i * 5, hh = String(Math.floor(m / 60)).padStart(2, '0'), mm = String(m % 60).padStart(2, '0');
    return [hrRec(WATCH, `2030-01-02 ${hh}:${mm}:00 +0100`, `2030-01-02 ${hh}:${mm}:00 +0100`, 50 + (i % 7)),
      hrRec(WATCH, `2030-01-03 ${hh}:${mm}:00 +0100`, `2030-01-03 ${hh}:${mm}:00 +0100`, 52 + (i % 5))];
  }).flat(),
  rhrRec(WATCH, '2030-01-02 09:00:00 +0100', 51),
  later('2030-01-04'),
];

test('an Apple Watch export is unchanged: sleep = the asleep night only (no in-bed estimate), rhr = the measured value only', () => {
  const x = runExtract(WATCH_FIXTURE);
  try {
    assert.equal(x.read('sleep-daily.csv'),
      'date,asleep_hours,source,bedtime,waketime,rem_h,deep_h,core_h,unspec_h,awake_h,inbed_h\n' +
      `2030-01-02,7.67,${WATCH},23,7,2.00,1.67,4.00,0.00,0.33,8.58\n`);
    assert.equal(x.read('rhr.csv'), `date,value,source\n2030-01-02,51,${WATCH}\n`);
    assert.equal(x.read('hrv.csv'), 'date,value,source\n');
  } finally { x.cleanup(); }
});

// A Mi Fitness user: two in-bed nights (one split by a short gap), afternoon fragments, a 1 h
// late-morning fragment on a day without a night.
const MIF = 'Mi Fitness';
const MIF_SLEEP = [
  sleepRec(MIF, '2030-01-01 23:40:00 +0100', '2030-01-02 03:10:00 +0100', 'InBed'),
  sleepRec(MIF, '2030-01-02 03:30:00 +0100', '2030-01-02 07:40:00 +0100', 'InBed'),
  sleepRec(MIF, '2030-01-02 15:10:00 +0100', '2030-01-02 15:55:00 +0100', 'InBed'),
  sleepRec(MIF, '2030-01-02 16:30:00 +0100', '2030-01-02 17:05:00 +0100', 'InBed'),
  sleepRec(MIF, '2030-01-03 00:15:00 +0100', '2030-01-03 08:45:00 +0100', 'InBed'),
  sleepRec(MIF, '2030-01-04 10:50:00 +0100', '2030-01-04 11:50:00 +0100', 'InBed'),
  sleepRec(PHONE, '2030-01-02 23:00:00 +0100', '2030-01-03 07:00:00 +0100', 'InBed'),
];

test('a Mi Fitness export: in-bed-only nights become ESTIMATED sleep rows ("Mi Fitness (in bed)", stage columns blank); fragments are not nights', () => {
  const x = runExtract([...MIF_SLEEP, later('2030-01-05')]);
  try {
    assert.equal(x.read('sleep-daily.csv'),
      'date,asleep_hours,source,bedtime,waketime,rem_h,deep_h,core_h,unspec_h,awake_h,inbed_h\n' +
      '2030-01-02,7.67,Mi Fitness (in bed),23.67,7.67,,,,,,\n' +
      '2030-01-03,8.50,Mi Fitness (in bed),0.25,8.75,,,,,,\n');
  } finally { x.cleanup(); }
});

test('a Mi Fitness export: resting HR is DERIVED from the night\'s hour-bucket heart rate ("Mi Fitness (derived)"); a measured value wins its date', () => {
  const hour = (date, hh, bpms) => bpms.map(b => hrRec(MIF, `${date} ${hh}:00:00 +0100`, `${date} ${String(+hh + 1).padStart(2, '0')}:00:00 +0100`, b));
  const night = (date, low) => [
    ...hour(date, '00', [64, 62, 63, 65, 61]),
    ...hour(date, '02', [low, low + 1, low - 1, low, low + 2]),
    ...hour(date, '05', [60, 59, 61, 60]),
    ...hour(date, '14', [48, 48, 48, 48]), // a daytime low: never the resting value
  ];
  const x = runExtract([
    ...night('2030-01-02', 54), ...night('2030-01-03', 56), ...night('2030-01-04', 58),
    rhrRec('Some Ring', '2030-01-04 09:00:00 +0100', 57), // measured: wins its date
    ...hour('2030-01-05', '01', [55, 55, 55, 55]), // one night hour only: too thin
    later('2030-01-06'),
  ]);
  try {
    assert.equal(x.read('rhr.csv'), 'date,value,source\n' +
      '2030-01-02,54.4,Mi Fitness (derived)\n2030-01-03,56.4,Mi Fitness (derived)\n2030-01-04,57,Some Ring\n');
    assert.equal(x.meta.rows.rhr, 3);
    assert.equal(x.meta.rows.rhr_derived, 2);
    assert.equal(x.read('hrv.csv'), 'date,value,source\n');
  } finally { x.cleanup(); }
});

test('HC_DATA_DIR: export.xml read from <data root>/files/import (HC_FILES_DIR moves it), the extract written to <data root>/extract; EXTRACT_DIR still wins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-data-root-'));
  const xml = ['<HealthData locale="en_GB">', later('2030-01-02'), later('2030-01-03'), '</HealthData>', ''].join('\n');
  const env = (extra) => { const e = { ...process.env }; delete e.EXTRACT_DIR; delete e.HC_FILES_DIR; return { ...e, ...extra }; };
  try {
    fs.mkdirSync(path.join(root, 'files', 'import'), { recursive: true });
    fs.writeFileSync(path.join(root, 'files', 'import', 'export.xml'), xml);
    const r = spawnSync(process.execPath, [path.join(__dirname, 'extract.mjs')], { encoding: 'utf8', env: env({ HC_DATA_DIR: root }) });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(root, 'extract', '_meta.json')));
    // HC_FILES_DIR: the export is looked for in <files>/import, so a data root without it reports that path
    const owner = path.join(root, 'owner');
    const miss = spawnSync(process.execPath, [path.join(__dirname, 'extract.mjs')], { encoding: 'utf8', env: env({ HC_DATA_DIR: root, HC_FILES_DIR: owner }) });
    assert.equal(miss.status, 1);
    assert.ok(miss.stderr.includes(path.join(owner, 'import', 'export.xml')), miss.stderr);
    // EXTRACT_DIR (the test hook) wins over the data root
    const own = path.join(root, 'own');
    fs.mkdirSync(own);
    fs.writeFileSync(path.join(own, 'export.xml'), xml);
    fs.rmSync(path.join(root, 'extract'), { recursive: true });
    const hook = spawnSync(process.execPath, [path.join(__dirname, 'extract.mjs')], { encoding: 'utf8', env: env({ HC_DATA_DIR: root, EXTRACT_DIR: own }) });
    assert.equal(hook.status, 0, hook.stderr);
    assert.ok(fs.existsSync(path.join(own, 'extract', '_meta.json')));
    assert.equal(fs.existsSync(path.join(root, 'extract')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--source <file> reads that export instead of <files>/import/export.xml (scripts/import-health.mjs passes its work file); output byte-identical to the default path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-source-'));
  const xml = ['<HealthData locale="en_GB">', later('2030-01-02'), later('2030-01-03'), '</HealthData>', ''].join('\n');
  const env = (extra) => { const e = { ...process.env }; delete e.EXTRACT_DIR; delete e.HC_FILES_DIR; return { ...e, ...extra }; };
  const snapshot = (dir) => Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
  try {
    fs.mkdirSync(path.join(root, 'a', 'files', 'import'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a', 'files', 'import', 'export.xml'), xml);
    assert.equal(spawnSync(process.execPath, [path.join(__dirname, 'extract.mjs')], { encoding: 'utf8', env: env({ HC_DATA_DIR: path.join(root, 'a') }) }).status, 0);
    const work = path.join(root, 'work', 'export.xml.123.tmp');
    fs.mkdirSync(path.dirname(work));
    fs.writeFileSync(work, xml);
    const r = spawnSync(process.execPath, [path.join(__dirname, 'extract.mjs'), '--source', work], { encoding: 'utf8', env: env({ HC_DATA_DIR: path.join(root, 'b') }) });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(snapshot(path.join(root, 'b', 'extract')), snapshot(path.join(root, 'a', 'extract')));
    const miss = spawnSync(process.execPath, [path.join(__dirname, 'extract.mjs'), '--source', path.join(root, 'nope.xml')], { encoding: 'utf8', env: env({ HC_DATA_DIR: path.join(root, 'c') }) });
    assert.equal(miss.status, 1);
    assert.ok(miss.stderr.includes(path.join(root, 'nope.xml')), miss.stderr);
    assert.equal(fs.existsSync(path.join(root, 'c', 'extract')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
