/* Unit tests for lib/load/inputs.mjs — loadInputs({repoRoot, dataMode}), the
 * single file-loading entry point the future Astro build will use (astro-
 * plan-web slice 2). New code: NOT extracted from the legacy generators
 * (which each have their own bespoke, hardcoded-path loading) — this is the
 * shared loader design's Data Flow diagram puts before the pure lib/*
 * transforms. Uses a synthetic fixture repo, not the real personal data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadInputs } from './inputs.mjs';

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
  // — CLAUDE.md: "the Hoy tab is optional and source-agnostic".
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
