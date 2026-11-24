/* Unit tests for lib/load/inputs.mjs — loadInputs({repoRoot, dataMode}), the page build's single
 * file-loading entry point. Uses a synthetic fixture repo, not the real personal data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadInputs } from './inputs.mjs';
import { computeTargets } from '../nutrition/energy.mjs';

function fixtureRepo({ withPersonal = true, withExtract = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-fixture-'));
  fs.mkdirSync(path.join(root, 'data', 'nutrition'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data', 'training'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'ingredients.json'), JSON.stringify({ ingredients: { egg: { per: 100, k: 155, p: 13, c: 1.1, g: 11, unit: 'ud' } } }));
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'plan-data.example.json'), JSON.stringify({ locale: 'en', data: {}, extras: {} }));
  fs.writeFileSync(path.join(root, 'data', 'training', 'training-data.example.json'), JSON.stringify({ days: {} }));
  if (withPersonal) {
    fs.mkdirSync(path.join(root, 'loop-data', 'cache'), { recursive: true });
    fs.writeFileSync(path.join(root, 'loop-data', 'cache', 'plan.json'), JSON.stringify({ locale: 'es', data: {}, extras: {} }));
    fs.writeFileSync(path.join(root, 'loop-data', 'cache', 'training.json'), JSON.stringify({ days: {} }));
  }
  if (withExtract) {
    fs.mkdirSync(path.join(root, 'loop-data', 'extract'), { recursive: true });
  }
  return root;
}

test('loadInputs(personal) reads the personal plan/training files and resolves an existing extract dir', () => {
  const root = fixtureRepo({ withPersonal: true, withExtract: true });
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal' });
    assert.ok(inputs.ingredients.egg, 'ingredients.json always loaded regardless of mode');
    assert.equal(inputs.plan.locale, 'es', 'personal mode reads loop-data/cache/plan.json');
    assert.ok(inputs.extractDir, 'extract dir exists -> resolved path, not null');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs(personal) resolves extractDir to null when the extract dir is absent', () => {
  const root = fixtureRepo({ withPersonal: true, withExtract: false });
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal' });
    assert.equal(inputs.extractDir, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs(example) reads the .example seeds and never the personal extract dir (null without demo data)', () => {
  const root = fixtureRepo({ withPersonal: true, withExtract: true }); // personal + extract present but unused
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'example' });
    assert.equal(inputs.plan.locale, 'en', 'example mode reads plan-data.example.json, not the personal file');
    assert.equal(inputs.extractDir, null, 'example mode never uses the personal extract dir');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs(example) resolves extractDir to the tracked synthetic data/demo/extract when present', () => {
  const root = fixtureRepo({ withPersonal: false, withExtract: true });
  try {
    fs.mkdirSync(path.join(root, 'data', 'demo', 'extract'), { recursive: true });
    const inputs = loadInputs({ repoRoot: root, dataMode: 'example' });
    assert.equal(inputs.extractDir, path.join(root, 'data', 'demo', 'extract'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs(personal) without a plan document builds with the example plan and ONE warning line', () => {
  const root = fixtureRepo({ withPersonal: false });
  /** @type {string[]} */
  const warns = [];
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal', warn: (w) => warns.push(w) });
    assert.equal(inputs.plan.locale, 'en', 'plan-data.example.json');
    assert.equal(warns.length, 1);
    assert.match(warns[0], /^WARNING: no plan document \(loop-data\/cache\/plan\.json\): building with the example plan \(data\/nutrition\/plan-data\.example\.json\)/);
    assert.match(warns[0], /npm run documents -- push plan/);
    assert.ok(!warns[0].includes('\n'), 'one line');
    assert.ok(inputs.paths, 'still a personal build (the personal extract, profile and food log)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs(personal) without a plan document still takes the targets from the onboarding', () => {
  const root = fixtureRepo({ withPersonal: false });
  const doc = onboardingDoc();
  fs.mkdirSync(path.join(root, 'loop-data', 'profile'), { recursive: true });
  fs.writeFileSync(path.join(root, 'loop-data', 'profile', 'onboarding.json'), JSON.stringify(doc));
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal', today: '2026-10-14', warn: () => {} });
    assert.deepEqual(inputs.plan.targets.byGoal, doc.targets);
    assert.equal(/** @type {NonNullable<typeof inputs.onboarding>} */ (inputs.onboarding).sex, 'female');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs(personal) without a plan document AND without the example seed throws a clear error naming both', () => {
  const root = fixtureRepo({ withPersonal: false });
  fs.rmSync(path.join(root, 'data', 'nutrition', 'plan-data.example.json'));
  try {
    assert.throws(
      () => loadInputs({ repoRoot: root, dataMode: 'personal', warn: () => {} }),
      (/** @type {NodeJS.ErrnoException} */ err) => err.code === 'HC_MISSING_INPUT' && /plan-data\.example\.json not found/.test(err.message) && /loop-data\/cache\/plan\.json/.test(err.message),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs(personal) treats a missing training-data.json as OPTIONAL: no throw, training.days = {}', () => {
  // plan-data.json present (required), training-data.json deliberately absent
  // — docs/training.md: "The Hoy section is optional and source-agnostic".
  const root = fixtureRepo({ withPersonal: true, withExtract: false });
  fs.rmSync(path.join(root, 'loop-data', 'cache', 'training.json'));
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal' });
    assert.deepEqual(inputs.training, { days: {} }, 'degrades to the same empty shape Hoy/Entrenos already render as a rest/unprogrammed day');
    assert.ok(inputs.plan, 'the rest of the inputs still load normally');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs(example) still requires training-data.example.json (it ships tracked, never optional)', () => {
  const root = fixtureRepo({ withPersonal: false });
  fs.rmSync(path.join(root, 'data', 'training', 'training-data.example.json'));
  try {
    assert.throws(() => loadInputs({ repoRoot: root, dataMode: 'example' }), /training-data\.example\.json/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The in-page onboarding (loop-data/profile/onboarding.json, scripts/sync-onboarding.mjs): its accepted targets
// replace the plan's targets.byGoal when they pass lib/nutrition/energy.mjs checkTargets.
const PERSON = { sex: 'female', heightCm: 165, weightKg: 60, activity: 'light' };
function onboardingDoc(patch = {}) {
  const { targets } = computeTargets({ ...PERSON, age: 29 });
  return { name: 'Ana', birthdate: '1997-05-20', ...PERSON, goals: ['maintain', 'cut', 'bulk'], targets, updatedAt: '2026-10-14T08:00:00.000Z', ...patch };
}
/** @param {string | object} doc a profile document, or raw file text */
function withOnboarding(doc) {
  const root = fixtureRepo({ withPersonal: true });
  fs.mkdirSync(path.join(root, 'loop-data', 'profile'), { recursive: true });
  fs.writeFileSync(path.join(root, 'loop-data', 'profile', 'onboarding.json'), typeof doc === 'string' ? doc : JSON.stringify(doc));
  return root;
}

test('loadInputs(personal): a completed onboarding replaces plan.targets.byGoal and is returned', () => {
  const doc = onboardingDoc();
  const root = withOnboarding(doc);
  /** @type {string[]} */
  const warns = [];
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal', today: '2026-10-14', warn: (w) => warns.push(w) });
    assert.deepEqual(inputs.plan.targets.byGoal, doc.targets);
    assert.equal(inputs.plan.locale, 'es', 'the rest of the plan is untouched');
    assert.equal(/** @type {NonNullable<typeof inputs.onboarding>} */ (inputs.onboarding).sex, 'female');
    assert.deepEqual(warns, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs: the safety bounds use the onboarding sports (a 5 h weekly ride is not a +15 % surplus)', () => {
  const sports = [{ sport: 'cycling', minutes: 300, perWeek: 1 }];
  const { targets } = computeTargets({ ...PERSON, age: 29, sports });
  const doc = onboardingDoc({ sports, targets });
  const root = withOnboarding(doc);
  /** @type {string[]} */
  const warns = [];
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal', today: '2026-10-14', warn: (w) => warns.push(w) });
    assert.deepEqual(warns, []);
    assert.deepEqual(inputs.plan.targets.byGoal, targets);
    assert.deepEqual(/** @type {NonNullable<typeof inputs.onboarding>} */ (inputs.onboarding).sports, sports);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('S6 loadInputs: an OLD 4-cell onboarding (saved before hybrid / indoor / run) is kept, its new cells from the gym cell', () => {
  const { targets } = computeTargets({ ...PERSON, age: 29 });
  /** @type {Record<string, Pick<(typeof targets)[keyof typeof targets], 'rest' | 'gym' | 'bike' | 'bikeLong'>>} */
  const old = {};
  for (const g of /** @type {(keyof typeof targets)[]} */ (Object.keys(targets))) old[g] = { rest: targets[g].rest, gym: targets[g].gym, bike: targets[g].bike, bikeLong: targets[g].bikeLong };
  // a cut gym cell far below the run day's maintenance: judged against its own day type only, never the copies
  old.cut.gym = { ...old.cut.gym, kcal: targets.cut.gym.kcal - 50 };
  const root = withOnboarding(onboardingDoc({ targets: old }));
  /** @type {string[]} */
  const warns = [];
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal', today: '2026-10-14', warn: (w) => warns.push(w) });
    assert.deepEqual(warns, []);
    assert.notEqual(inputs.onboarding, null, 'the old profile is not dropped');
    for (const g of Object.keys(old)) {
      for (const d of ['hybrid', 'indoor', 'run']) assert.deepEqual(inputs.plan.targets.byGoal[g][d], old[g].gym, `${g}.${d}`);
      assert.deepEqual(inputs.plan.targets.byGoal[g].bike, old[g].bike);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('S6 loadInputs: an OLD runner profile, as the previous wizard computed it (running 50 min = the short gym day), is kept', () => {
  // the numbers lib/nutrition/energy.mjs computeTargets gave before run had its own day type (v1.7.0)
  /** @param {number} kcal @param {number} p */
  const c = (kcal, p) => ({ kcal, p, f: 64 });
  const targets = {
    maintain: { rest: c(2300, 144), gym: c(2800, 144), bike: c(3250, 144), bikeLong: c(3950, 144) },
    cut: { rest: c(1950, 160), gym: c(2400, 160), bike: c(2750, 160), bikeLong: c(3950, 160) },
    bulk: { rest: c(2500, 144), gym: c(3100, 144), bike: c(3550, 144), bikeLong: c(4350, 144) },
  };
  const runner = { sex: 'male', heightCm: 180, weightKg: 80, activity: 'light', sports: [{ sport: 'running', minutes: 50, perWeek: 4 }] };
  const root = withOnboarding({ name: 'Leo', birthdate: '1991-01-01', ...runner, goals: ['maintain', 'cut', 'bulk'], targets, updatedAt: '2026-10-14T08:00:00.000Z' });
  /** @type {string[]} */
  const warns = [];
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal', today: '2026-11-24', warn: (w) => warns.push(w) });
    assert.deepEqual(warns, []);
    assert.notEqual(inputs.onboarding, null, 'judged by the rules it was saved under, not dropped');
    assert.deepEqual(inputs.plan.targets.byGoal.bulk.run, targets.bulk.gym);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs: a stored new cell outside the safety bounds still drops the onboarding (previous behaviour)', () => {
  const { targets } = computeTargets({ ...PERSON, age: 29 });
  const bad = JSON.parse(JSON.stringify(targets));
  bad.cut.run.kcal = 900;
  const root = withOnboarding(onboardingDoc({ targets: bad }));
  /** @type {string[]} */
  const warns = [];
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal', today: '2026-10-14', warn: (w) => warns.push(w) });
    assert.equal(inputs.onboarding, null);
    assert.match(warns.join('\n'), /cut\/run: kcalFloor/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs: no onboarding file -> onboarding null and the plan as written (the single-install behaviour)', () => {
  const root = fixtureRepo({ withPersonal: true });
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal', today: '2026-10-14' });
    assert.equal(inputs.onboarding, null);
    assert.equal(inputs.plan.targets, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs(example) never reads onboarding.json', () => {
  const root = withOnboarding(onboardingDoc());
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'example', today: '2026-10-14' });
    assert.equal(inputs.onboarding, null);
    assert.equal(inputs.plan.targets, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs: targets outside the safety bounds, or a malformed file, are ignored with a warning (never fail the build)', () => {
  const doc = onboardingDoc();
  doc.targets.cut.rest.kcal = 900; // below the 1200 kcal floor
  for (const content of [doc, '{not json', { ...onboardingDoc(), sex: 'x' }]) {
    const root = withOnboarding(content);
    /** @type {string[]} */
    const warns = [];
    try {
      const inputs = loadInputs({ repoRoot: root, dataMode: 'personal', today: '2026-10-14', warn: (w) => warns.push(w) });
      assert.equal(inputs.plan.targets, undefined, 'the plan keeps its own targets');
      assert.equal(inputs.onboarding, null);
      assert.equal(warns.length, 1);
      assert.match(warns[0], /WARNING: .*onboarding\.json/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
