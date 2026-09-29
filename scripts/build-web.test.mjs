/* Unit tests for scripts/build-web.mjs's `--check` mode (astro-plan-web
 * slice 7 cutover). `--check` validates the programmed training data for a
 * given mode WITHOUT invoking the Astro build (fast, no astro binary
 * needed) — it replaces the training validation the retired
 * data/training/generate-training.js --check used to provide. Nutrition
 * validation stays in `node data/nutrition/generate.js --check` (npm run
 * check chains both). Uses a synthetic fixture repo, never the real
 * personal data — same pattern as lib/load/inputs.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkTraining, resolveLocale, sweepStaleStaging } from './build-web.mjs';

function fixtureRepo({ trainingDays, personalLocale = 'es' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-buildweb-check-'));
  fs.mkdirSync(path.join(root, 'data', 'nutrition'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data', 'training'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'ingredients.json'), JSON.stringify({ ingredients: { egg: { per: 100, k: 155, p: 13, c: 1.1, g: 11, unit: 'ud' } } }));
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'plan-data.json'), JSON.stringify({ locale: personalLocale, data: {}, extras: {} }));
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'plan-data.example.json'), JSON.stringify({ locale: 'en', data: {}, extras: {} }));
  fs.writeFileSync(path.join(root, 'data', 'training', 'training-data.json'), JSON.stringify({ days: trainingDays ?? {} }));
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
 * found here is an orphan). */
function makeStagingDir(dir, name, { ageMs = 0 } = {}) {
  const p = path.join(dir, name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'marker'), 'x');
  const mtime = new Date(Date.now() - ageMs);
  fs.utimesSync(p, mtime, mtime);
  return p;
}

test('sweepStaleStaging removes orphaned .staging-* dirs older than the current run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-sweep-'));
  try {
    const orphan = makeStagingDir(dir, '.staging-personal-11111', { ageMs: 60_000 });
    const current = path.join(dir, '.staging-personal-22222'); // not created yet — this run's own
    const swept = sweepStaleStaging({ dir, currentStagingDir: current, buildStartTime: Date.now() });
    assert.deepEqual(swept, [orphan]);
    assert.equal(fs.existsSync(orphan), false, 'the orphaned staging dir must be removed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sweepStaleStaging never removes the current run\'s own staging dir, even if it already exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-sweep-'));
  try {
    const current = makeStagingDir(dir, '.staging-personal-33333', { ageMs: 60_000 });
    const swept = sweepStaleStaging({ dir, currentStagingDir: current, buildStartTime: Date.now() });
    assert.deepEqual(swept, []);
    assert.equal(fs.existsSync(current), true, 'must never remove its own staging dir');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sweepStaleStaging never removes a staging dir created AFTER buildStartTime (a genuinely concurrent build)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-sweep-'));
  try {
    const buildStartTime = Date.now() - 5000;
    const concurrent = makeStagingDir(dir, '.staging-example-44444', { ageMs: 0 }); // mtime = now, after buildStartTime
    const current = path.join(dir, '.staging-personal-55555');
    const swept = sweepStaleStaging({ dir, currentStagingDir: current, buildStartTime });
    assert.deepEqual(swept, []);
    assert.equal(fs.existsSync(concurrent), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sweepStaleStaging is a no-op when the directory does not exist yet', () => {
  const missing = path.join(os.tmpdir(), 'hc-sweep-does-not-exist-' + process.pid);
  assert.deepEqual(sweepStaleStaging({ dir: missing, currentStagingDir: path.join(missing, '.staging-x'), buildStartTime: Date.now() }), []);
});
