/* Tests for the training ("Hoy") tab generator. Zero dependencies — Node's
 * built-in runner:  node --test  (from repo root) or  npm test.
 * Importing generate-training.js does NOT write files (I/O is guarded by require.main). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const gen = require('./generate-training.js');

const { TRAIN, validate, buildHtml, trainingBlock, dashboardBlock, parseWorkouts, aggregateDashboard, modalityGroup, weekStart } = gen;
const htmlPath = path.join(__dirname, '..', 'nutrition', 'plan-web.html');

test('validate() passes on the real training-data.json', () => {
  assert.equal(validate().ok, true);
});

test('program metadata serializes (data-agnostic — no owner identity hardcoded here)', () => {
  // The owner's real coach/partner facts live in profile/about-me.md + memory, NOT in this
  // tracked test, so the suite stays green on a fresh clone running the example program.
  const block = trainingBlock();
  assert.match(block, /program:'/);
  assert.match(block, /coach:'/);
  assert.match(block, /source:'/);
});

test('every day key is an ISO date with at least one block', () => {
  for (const [date, day] of Object.entries(TRAIN.days)) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/, date + ' should be ISO');
    assert.ok(Array.isArray(day.blocks) && day.blocks.length, date + ' needs blocks');
  }
});

test('trainingBlock() bakes every programmed day + the meta object', () => {
  const block = trainingBlock();
  const dates = Object.keys(TRAIN.days).sort();
  assert.ok(dates.length, 'there should be at least one programmed day');
  for (const d of dates) assert.ok(block.includes("'" + d + "'"), 'day must be baked: ' + d);
  assert.match(block, /var TRAINING = \{/);
  assert.match(block, /var TRAINING_META = \{/);
});

test('trainingBlock() escapes single quotes safely', () => {
  // Lines use feet/inch marks ('') heavily; the JS string output must stay valid.
  const block = trainingBlock();
  assert.doesNotThrow(() => new Function(block + '\nreturn TRAINING;'), 'baked block must be valid JS');
});

test('buildHtml replaces the GEN:TRAINING region and is idempotent', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const once = buildHtml(html);
  const firstDate = Object.keys(TRAIN.days).sort()[0];
  assert.ok(once.includes("'" + firstDate + "'"), 'generated HTML must contain the program');
  assert.equal(buildHtml(once), once, 're-running buildHtml on its own output must be a no-op');
});

test('buildHtml throws when GEN:TRAINING markers are missing', () => {
  assert.throws(() => buildHtml('<html>no markers here</html>'), /GEN:TRAINING markers not found/);
});

test('generator fails clearly when training-data.json is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'train-no-data-'));
  try {
    fs.copyFileSync(path.join(__dirname, 'generate-training.js'), path.join(dir, 'generate-training.js'));
    assert.throws(
      () => execFileSync(process.execPath, ['generate-training.js', '--check'], { cwd: dir, stdio: 'pipe' }),
      /training-data\.json not found/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------- dashboard (executed workouts) ---------- */

test('modalityGroup maps Apple types to strength / hiit / run / other', () => {
  assert.equal(modalityGroup('Running'), 'run');
  assert.equal(modalityGroup('Cycling'), 'other');
  assert.equal(modalityGroup('Rowing'), 'other');
  assert.equal(modalityGroup('TraditionalStrengthTraining'), 'strength');
  assert.equal(modalityGroup('FunctionalStrengthTraining'), 'strength');
  assert.equal(modalityGroup('HighIntensityIntervalTraining'), 'hiit');
  assert.equal(modalityGroup('CrossTraining'), 'hiit');
  assert.equal(modalityGroup('Other'), 'hiit'); // Watch's generic gym label -> conditioning bucket
});

test('weekStart returns the Monday of the week (June 2026 weeks start on Mondays)', () => {
  assert.equal(weekStart('2026-06-24'), '2026-06-22'); // Wed -> Mon
  assert.equal(weekStart('2026-06-22'), '2026-06-22'); // Mon -> itself
});

test('parseWorkouts captures per-workout HR (avg/max), null when blank', () => {
  const rows = parseWorkouts(
    'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source\n' +
    '2026-06-24,HighIntensityIntervalTraining,20,150,135,90,178,Apple Watch\n' +
    '2026-06-23,TraditionalStrengthTraining,60,300,,,,Strava\n', // old row, no HR
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].hrAvg, 135);
  assert.equal(rows[0].hrMax, 178);
  assert.equal(rows[1].hrAvg, null, 'blank HR -> null, never 0');
  assert.equal(rows[1].hrMax, null);
});

test('aggregateDashboard adds duration-weighted avg HR + peak per modality and overall, ignoring HR-less rows', () => {
  const d = aggregateDashboard([
    { date: '2026-06-24', type: 'HighIntensityIntervalTraining', dur: 10, hrAvg: 120, hrMax: 150 },
    { date: '2026-06-24', type: 'HighIntensityIntervalTraining', dur: 30, hrAvg: 140, hrMax: 180 },
    { date: '2026-06-22', type: 'Running', dur: 30, hrAvg: 150, hrMax: 175 },
    { date: '2026-06-15', type: 'TraditionalStrengthTraining', dur: 40, hrAvg: null, hrMax: null }, // no HR -> excluded
  ]);
  const hiit = d.modality.find(m => m.key === 'hiit');
  // duration-weighted: (120*10 + 140*30) / 40 = 135
  assert.equal(hiit.avgHr, 135, 'weighted by minutes, not a flat mean');
  assert.equal(hiit.peakHr, 180);
  const strength = d.modality.find(m => m.key === 'strength');
  assert.equal(strength.avgHr, null, 'no HR-tagged sessions -> null, not 0');
  // overall intensity: (120*10 + 140*30 + 150*30) / 70 = 141.4 -> 141
  assert.equal(d.intensity.avgHr, 141);
  assert.equal(d.intensity.peakHr, 180);
  assert.equal(d.intensity.withHr, 3, '3 of 4 sessions carry HR');
  assert.equal(d.intensity.total, 4);
});

test('parseWorkouts skips the header and bad rows', () => {
  const rows = parseWorkouts('date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source\n2026-06-24,Running,30,,,,,Watch\nbad-line');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { date: '2026-06-24', type: 'Running', dur: 30, hrAvg: null, hrMax: null });
});

test('aggregateDashboard counts DISTINCT days and groups minutes by modality', () => {
  const d = aggregateDashboard([
    { date: '2026-06-24', type: 'TraditionalStrengthTraining', dur: 60 },
    { date: '2026-06-24', type: 'HighIntensityIntervalTraining', dur: 20 }, // same day = fragmented session
    { date: '2026-06-22', type: 'Running', dur: 30 },
    { date: '2026-06-15', type: 'Cycling', dur: 40 },
  ]);
  assert.equal(d.hasData, true);
  assert.equal(d.asOf, '2026-06-24');
  assert.equal(d.weeklyMin.length, 12, 'always 12 weekly slots');
  // fragmentation: two rows on 2026-06-24 collapse to ONE training day
  assert.equal(d.recent.sessions, 3, 'distinct days, not raw rows');
  const by = k => d.modality.find(m => m.key === k);
  assert.equal(by('strength').min, 60, 'TraditionalStrengthTraining -> strength');
  assert.equal(by('hiit').min, 20, 'HIIT keeps its own bucket');
  assert.equal(by('run').min, 30);
  // emitted sorted by minutes desc: strength(60) > other(40) > run(30) > hiit(20)
  assert.deepEqual(d.modality.map(m => m.key), ['strength', 'other', 'run', 'hiit']);
});

test('aggregateDashboard degrades gracefully with no rows', () => {
  assert.deepEqual(aggregateDashboard([]), { hasData: false });
});

test('dashboardBlock emits a valid JS DASH object', () => {
  const block = dashboardBlock();
  assert.match(block, /var DASH = /);
  assert.doesNotThrow(() => new Function(block + '\nreturn DASH;'), 'baked DASH must be valid JS');
});

test('buildHtml replaces BOTH GEN regions and stays idempotent', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const once = buildHtml(html);
  assert.match(once, /GEN:DASHBOARD START/);
  assert.match(once, /var DASH = /);
  assert.equal(buildHtml(once), once, 're-running buildHtml must be a no-op');
});

test('validate() rejects a malformed program (bad date / empty blocks)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'train-bad-'));
  try {
    fs.copyFileSync(path.join(__dirname, 'generate-training.js'), path.join(dir, 'generate-training.js'));
    fs.writeFileSync(path.join(dir, 'training-data.json'), JSON.stringify({ days: { 'not-a-date': { focus: 'x', blocks: [] } } }));
    assert.throws(
      () => execFileSync(process.execPath, ['generate-training.js', '--check'], { cwd: dir, stdio: 'pipe' }),
      /validation failed/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
