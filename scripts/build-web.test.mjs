/* Unit tests for scripts/build-web.mjs's `--check` mode (astro-plan-web
 * slice 7 cutover). `--check` validates the programmed training data for a
 * given mode WITHOUT invoking the Astro build (fast, no astro binary
 * needed) — it replaces the training validation the retired
 * data/training/generate-training.js --check used to provide. Nutrition
 * validation stays in `node data/nutrition/generate.mjs --check` (npm run
 * check chains both). Uses a synthetic fixture repo, never the real
 * personal data — same pattern as lib/load/inputs.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkTraining, inputErrorLine, resolveLocale, sweepStaleStaging } from './build-web.mjs';

function fixtureRepo({ trainingDays, personalLocale = 'es', withTraining = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-buildweb-check-'));
  fs.mkdirSync(path.join(root, 'data', 'nutrition'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data', 'training'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'ingredients.json'), JSON.stringify({ ingredients: { egg: { per: 100, k: 155, p: 13, c: 1.1, g: 11, unit: 'ud' } } }));
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'plan-data.json'), JSON.stringify({ locale: personalLocale, data: {}, extras: {} }));
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'plan-data.example.json'), JSON.stringify({ locale: 'en', data: {}, extras: {} }));
  if (withTraining) fs.writeFileSync(path.join(root, 'data', 'training', 'training-data.json'), JSON.stringify({ days: trainingDays ?? {} }));
  fs.writeFileSync(path.join(root, 'data', 'training', 'training-data.example.json'), JSON.stringify({ days: {} }));
  return root;
}

const wellFormedDay = {
  '2026-01-05': { kind: 'gym', focus: 'Upper body', blocks: [{ title: 'Bench', lines: ['5x5 @ 60kg'] }] },
};

test('checkTraining(personal) passes on a well-formed program', () => {
  const root = fixtureRepo({ trainingDays: wellFormedDay });
  try {
    const res = checkTraining({ repoRoot: root, mode: 'personal' });
    assert.equal(res.ok, true, 'a well-formed training-data.json must validate OK');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkTraining(personal) throws with a clear message on a malformed program (bad ISO date key)', () => {
  const root = fixtureRepo({ trainingDays: { 'not-a-date': { kind: 'gym', focus: 'x', blocks: [{ title: 't', lines: ['l'] }] } } });
  try {
    assert.throws(
      () => checkTraining({ repoRoot: root, mode: 'personal' }),
      /not-a-date.*not an ISO date/s,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkTraining(personal) skips validation and reports ok when training-data.json is simply ABSENT (optional, not malformed)', () => {
  const root = fixtureRepo({ withTraining: false });
  try {
    const res = checkTraining({ repoRoot: root, mode: 'personal' });
    assert.equal(res.ok, true);
    assert.equal(res.skipped, true, 'must be distinguishable from an actually-validated program');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkTraining(personal) still throws when training-data.json EXISTS but is malformed/empty (absent != empty)', () => {
  const root = fixtureRepo({ trainingDays: {} }); // file present, {days:{}} — a real validation error, not "absent"
  try {
    assert.throws(() => checkTraining({ repoRoot: root, mode: 'personal' }), /"days" is empty/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkTraining(example) validates the tracked training-data.example.json, not the personal file', () => {
  const root = fixtureRepo({ trainingDays: { 'not-a-date': {} } }); // personal file is broken on purpose
  try {
    // example mode's training-data.example.json (days: {}) is well-formed-but-empty,
    // which validateProgram rejects with "days is empty" — proves example mode reads
    // the example seed, not the broken personal file above.
    assert.throws(
      () => checkTraining({ repoRoot: root, mode: 'example' }),
      /"days" is empty/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* resolveLocale — design contract: env > plan.locale > 'en' (web/src/env.mjs's
 * resolveEnv). Regression guard: build-web.mjs used to compute its own
 * locale default independently of plan.locale (`mode === 'example' ? 'en' :
 * 'es'`), which forced es for EVERY personal build regardless of what the
 * plan itself declared, making plan.locale dead through the CLI path. */
test('resolveLocale: personal mode with no explicit locale follows plan.locale, not a hardcoded default', () => {
  const root = fixtureRepo({ personalLocale: 'en' });
  try {
    assert.equal(resolveLocale({ repoRoot: root, mode: 'personal', explicitLocale: null }), 'en');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveLocale: an explicit locale (CLI --locale or LOCALE env) wins over plan.locale', () => {
  const root = fixtureRepo({ personalLocale: 'en' });
  try {
    assert.equal(resolveLocale({ repoRoot: root, mode: 'personal', explicitLocale: 'es' }), 'es');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a missing plan-data.json (fresh clone, seeds not copied) becomes ONE readable line, not a stack trace', () => {
  const root = fixtureRepo();
  fs.rmSync(path.join(root, 'data', 'nutrition', 'plan-data.json'));
  try {
    let err;
    try { resolveLocale({ repoRoot: root, mode: 'personal', explicitLocale: null }); } catch (e) { err = e; }
    assert.ok(err, 'resolveLocale throws without plan-data.json');
    const line = inputErrorLine(err);
    assert.match(line, /^build-web: .*plan-data\.json not found\. Copy plan-data\.example\.json -> plan-data\.json/);
    assert.ok(!line.includes('\n'), 'one line');
    assert.equal(inputErrorLine(new Error('something else')), null, 'any other error is not swallowed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveLocale: example mode defaults to en when plan-data.example.json has no locale override', () => {
  const root = fixtureRepo();
  try {
    assert.equal(resolveLocale({ repoRoot: root, mode: 'example', explicitLocale: null }), 'en');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* sweepStaleStaging — guards against .staging-<mode>-<pid> dirs left behind
 * by a crashed/killed previous build accumulating forever (a clean run
 * always renames its own staging dir away before exiting, so anything else
 * found here MIGHT be an orphan — but might also be a genuinely in-flight
 * concurrent build, so mtime age alone is not enough: only remove a dir
 * whose OWNING PID IS NO LONGER ALIVE (process.kill(pid,0) -> ESRCH) AND is
 * older than a safety threshold. A dead-but-recent dir is kept for one
 * grace period in case its process is still mid-flush. */
const DEAD_PID = 999999999; // exceeds Linux's pid_max (4194304) — guaranteed no such process
function makeStagingDir(dir, name, { ageMs = 0 } = {}) {
  const p = path.join(dir, name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'marker'), 'x');
  const mtime = new Date(Date.now() - ageMs);
  fs.utimesSync(p, mtime, mtime);
  return p;
}

test('sweepStaleStaging removes a dir whose owning PID is dead AND older than the safety threshold', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-sweep-'));
  try {
    const orphan = makeStagingDir(dir, `.staging-personal-${DEAD_PID}`, { ageMs: 11 * 60_000 });
    const current = path.join(dir, `.staging-personal-${process.pid}`); // not created yet — this run's own
    const swept = sweepStaleStaging({ dir, currentStagingDir: current });
    assert.deepEqual(swept, [orphan]);
    assert.equal(fs.existsSync(orphan), false, 'a dead+old orphan must be removed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sweepStaleStaging NEVER removes a dir whose owning PID is still alive, no matter how old', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-sweep-'));
  try {
    // Uses THIS test process's own pid as the "owner" — guaranteed alive.
    const live = makeStagingDir(dir, `.staging-personal-${process.pid}`, { ageMs: 60 * 60_000 });
    const current = path.join(dir, `.staging-example-${DEAD_PID}`);
    const swept = sweepStaleStaging({ dir, currentStagingDir: current });
    assert.deepEqual(swept, [], 'a live-owned dir must never be swept, regardless of age');
    assert.equal(fs.existsSync(live), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sweepStaleStaging keeps a dir whose owning PID is dead but too RECENT (grace period)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-sweep-'));
  try {
    const recent = makeStagingDir(dir, `.staging-personal-${DEAD_PID}`, { ageMs: 5_000 }); // dead pid, 5s old
    const current = path.join(dir, `.staging-example-${DEAD_PID + 1}`);
    const swept = sweepStaleStaging({ dir, currentStagingDir: current, maxAgeMs: 10 * 60_000 });
    assert.deepEqual(swept, [], 'dead but younger than the safety threshold must be kept');
    assert.equal(fs.existsSync(recent), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sweepStaleStaging never removes the current run\'s own staging dir, even if it already exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-sweep-'));
  try {
    const current = makeStagingDir(dir, `.staging-personal-${process.pid}`, { ageMs: 60 * 60_000 });
    const swept = sweepStaleStaging({ dir, currentStagingDir: current });
    assert.deepEqual(swept, []);
    assert.equal(fs.existsSync(current), true, 'must never remove its own staging dir');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sweepStaleStaging treats a dir whose name has no parseable PID as unknown/alive — never removes it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-sweep-'));
  try {
    const weird = makeStagingDir(dir, '.staging-not-a-pid', { ageMs: 60 * 60_000 });
    const current = path.join(dir, `.staging-example-${DEAD_PID}`);
    const swept = sweepStaleStaging({ dir, currentStagingDir: current });
    assert.deepEqual(swept, [], 'an unparseable name must be treated conservatively, never removed');
    assert.equal(fs.existsSync(weird), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sweepStaleStaging is a no-op when the directory does not exist yet', () => {
  const missing = path.join(os.tmpdir(), 'hc-sweep-does-not-exist-' + process.pid);
  assert.deepEqual(sweepStaleStaging({ dir: missing, currentStagingDir: path.join(missing, '.staging-x') }), []);
});

test('reportProfileCheck: a malformed profile.json fails --check with the reason; absent / valid pass', async () => {
  const { reportProfileCheck } = await import('./build-web.mjs');
  const out = [];
  const io = { log: (m) => out.push(['log', m]), error: (m) => out.push(['error', m]) };
  assert.equal(reportProfileCheck({ ok: false, skipped: false, error: 'x/profile.json — profile.json is invalid:\n  - heightCm must be a number' }, 'personal', io), 1);
  assert.equal(out[0][0], 'error');
  assert.match(out[0][1], /ERROR: .*heightCm must be a number/s);
  assert.equal(reportProfileCheck({ ok: true, skipped: true, error: null }, 'personal', io), 0);
  assert.equal(reportProfileCheck({ ok: true, skipped: false, error: null }, 'example', io), 0);
  assert.match(out[2][1], /profile\.json OK \(mode=example\)/);
  const src = fs.readFileSync(new URL('./build-web.mjs', import.meta.url), 'utf8');
  assert.match(src, /process\.exitCode = reportProfileCheck\(checkManualProfile\(/, '--check wires the strict profile check');
});
