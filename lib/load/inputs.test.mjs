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
    fs.writeFileSync(path.join(root, 'data', 'nutrition', 'plan-data.json'), JSON.stringify({ locale: 'es', data: {}, extras: {} }));
    fs.writeFileSync(path.join(root, 'data', 'training', 'training-data.json'), JSON.stringify({ days: {} }));
  }
  if (withExtract) {
    fs.mkdirSync(path.join(root, 'data', 'apple-health', 'extract'), { recursive: true });
  }
  return root;
}

test('loadInputs(personal) reads the personal plan/training files and resolves an existing extract dir', () => {
  const root = fixtureRepo({ withPersonal: true, withExtract: true });
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal' });
    assert.ok(inputs.ingredients.egg, 'ingredients.json always loaded regardless of mode');
    assert.equal(inputs.plan.locale, 'es', 'personal mode reads plan-data.json');
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

test('loadInputs(personal) throws a clear error naming the missing file, hinting at DATA_MODE=example', () => {
  const root = fixtureRepo({ withPersonal: false });
  try {
    assert.throws(
      () => loadInputs({ repoRoot: root, dataMode: 'personal' }),
      /plan-data\.json.*DATA_MODE=example/s,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadInputs(personal) treats a missing training-data.json as OPTIONAL: no throw, training.days = {}', () => {
  // plan-data.json present (required), training-data.json deliberately absent
  // — docs/training.md: "The Hoy section is optional and source-agnostic".
  const root = fixtureRepo({ withPersonal: true, withExtract: false });
  fs.rmSync(path.join(root, 'data', 'training', 'training-data.json'));
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

// The in-page onboarding (data/profile/onboarding.json, scripts/sync-onboarding.mjs): its accepted targets
// replace the plan's targets.byGoal when they pass lib/nutrition/energy.mjs checkTargets.
const PERSON = { sex: 'female', heightCm: 165, weightKg: 60, activity: 'light' };
function onboardingDoc(patch = {}) {
  const { targets } = computeTargets({ ...PERSON, age: 29 });
  return { name: 'Ana', birthdate: '1997-05-20', ...PERSON, goals: ['maintain', 'cut', 'bulk'], targets, updatedAt: '2026-10-14T08:00:00.000Z', ...patch };
}
function withOnboarding(doc) {
  const root = fixtureRepo({ withPersonal: true });
  fs.mkdirSync(path.join(root, 'data', 'profile'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'profile', 'onboarding.json'), typeof doc === 'string' ? doc : JSON.stringify(doc));
  return root;
}

test('loadInputs(personal): a completed onboarding replaces plan.targets.byGoal and is returned', () => {
  const doc = onboardingDoc();
  const root = withOnboarding(doc);
  const warns = [];
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal', today: '2026-10-14', warn: (w) => warns.push(w) });
    assert.deepEqual(inputs.plan.targets.byGoal, doc.targets);
    assert.equal(inputs.plan.locale, 'es', 'the rest of the plan is untouched');
    assert.equal(inputs.onboarding.sex, 'female');
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
  const warns = [];
  try {
    const inputs = loadInputs({ repoRoot: root, dataMode: 'personal', today: '2026-10-14', warn: (w) => warns.push(w) });
    assert.deepEqual(warns, []);
    assert.deepEqual(inputs.plan.targets.byGoal, targets);
    assert.deepEqual(inputs.onboarding.sports, sports);
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
