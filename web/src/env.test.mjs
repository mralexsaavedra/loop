/* Unit tests for web/src/env.mjs — resolveEnv(), the build-time env contract
 * (astro-plan-web slice 2). Not yet wired into any Astro page/build-web.mjs
 * (that lands when a page actually consumes plan/training/health data,
 * slice 3+) — this only exercises the module's own resolution contract. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveEnv } from './env.mjs';

function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-env-fixture-'));
  fs.mkdirSync(path.join(root, 'data', 'nutrition'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data', 'training'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'ingredients.json'), JSON.stringify({ ingredients: {} }));
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'plan-data.json'), JSON.stringify({ locale: 'es' }));
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'plan-data.example.json'), JSON.stringify({ locale: 'en' }));
  fs.writeFileSync(path.join(root, 'data', 'training', 'training-data.json'), JSON.stringify({ days: {} }));
  fs.writeFileSync(path.join(root, 'data', 'training', 'training-data.example.json'), JSON.stringify({ days: {} }));
  return root;
}

test('resolveEnv throws when HC_REPO_ROOT is unset', () => {
  assert.throws(() => resolveEnv({}), /HC_REPO_ROOT is required/);
});

test('resolveEnv defaults to DATA_MODE=personal and reads locale from plan.locale when LOCALE is unset', () => {
  const root = fixtureRepo();
  try {
    const env = resolveEnv({ HC_REPO_ROOT: root });
    assert.equal(env.dataMode, 'personal');
    assert.equal(env.locale, 'es', 'falls back to plan.locale when LOCALE env var is unset');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveEnv: an explicit LOCALE env var wins over plan.locale', () => {
  const root = fixtureRepo();
  try {
    const env = resolveEnv({ HC_REPO_ROOT: root, LOCALE: 'en' });
    assert.equal(env.locale, 'en');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveEnv: DATA_MODE=example reads the example plan and defaults locale to en when plan.locale is missing/unrecognized', () => {
  const root = fixtureRepo();
  try {
    const env = resolveEnv({ HC_REPO_ROOT: root, DATA_MODE: 'example' });
    assert.equal(env.dataMode, 'example');
    assert.equal(env.locale, 'en');
    assert.equal(env.plan.locale, 'en');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
