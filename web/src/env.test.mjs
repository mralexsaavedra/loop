/* Unit tests for web/src/env.mjs — resolveEnv(), the build-time env contract: the module's own
 * resolution rules. */
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
  fs.mkdirSync(path.join(root, 'loop-data', 'cache'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'ingredients.json'), JSON.stringify({ ingredients: {} }));
  fs.writeFileSync(path.join(root, 'loop-data', 'cache', 'plan.json'), JSON.stringify({ locale: 'es' }));
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'plan-data.example.json'), JSON.stringify({ locale: 'en' }));
  fs.writeFileSync(path.join(root, 'loop-data', 'cache', 'training.json'), JSON.stringify({ days: {} }));
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

/* The page language (docs/plan-page.md "Locale"): an explicit LOCALE / --locale (developer and test override) >
 * the language chosen on the page (settings.json locale, synced from GET /food/settings) > HC_LOCALE (the server's
 * env, docker/.env) > plan.locale > 'en'. The settings file is personal: the example build never reads it. */
function withSettings(root, body, dataDir = path.join(root, 'loop-data')) {
  fs.mkdirSync(path.join(dataDir, 'profile'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'profile', 'settings.json'), typeof body === 'string' ? body : JSON.stringify(body));
}

test('resolveEnv: the language chosen on the page (settings.json locale) wins over HC_LOCALE and plan.locale', () => {
  const root = fixtureRepo();
  try {
    withSettings(root, { goal: 'cut', targetWeightKg: null, locale: 'en', updatedAt: null, fetchedAt: '2030-01-01T00:00:00.000Z' });
    assert.equal(resolveEnv({ HC_REPO_ROOT: root }).locale, 'en', 'over plan.locale es');
    assert.equal(resolveEnv({ HC_REPO_ROOT: root, HC_LOCALE: 'es' }).locale, 'en', 'over HC_LOCALE');
    assert.equal(resolveEnv({ HC_REPO_ROOT: root, HC_LOCALE: 'es', LOCALE: 'es' }).locale, 'es', 'an explicit LOCALE still wins');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveEnv: HC_LOCALE wins over plan.locale when no language is set on the page', () => {
  const root = fixtureRepo();
  try {
    assert.equal(resolveEnv({ HC_REPO_ROOT: root, HC_LOCALE: 'en' }).locale, 'en', 'no settings.json');
    withSettings(root, { goal: 'cut', targetWeightKg: null, locale: null });
    assert.equal(resolveEnv({ HC_REPO_ROOT: root, HC_LOCALE: 'en' }).locale, 'en', 'locale null = not chosen');
    assert.equal(resolveEnv({ HC_REPO_ROOT: root }).locale, 'es', 'no HC_LOCALE: plan.locale as before');
    assert.equal(resolveEnv({ HC_REPO_ROOT: root, HC_LOCALE: 'fr' }).locale, 'es', 'an unknown HC_LOCALE is ignored');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveEnv: a malformed settings.json or an unknown locale in it is ignored (falls back), never fails the build', () => {
  const root = fixtureRepo();
  try {
    withSettings(root, '{not json');
    assert.equal(resolveEnv({ HC_REPO_ROOT: root }).locale, 'es');
    withSettings(root, { locale: 'fr' });
    assert.equal(resolveEnv({ HC_REPO_ROOT: root, HC_LOCALE: 'en' }).locale, 'en');
    withSettings(root, ['en']);
    assert.equal(resolveEnv({ HC_REPO_ROOT: root }).locale, 'es');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveEnv: container mode (HC_DATA_DIR) reads <HC_DATA_DIR>/profile/settings.json', () => {
  const root = fixtureRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-env-data-'));
  try {
    fs.mkdirSync(path.join(dataDir, 'cache'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'cache', 'plan.json'), JSON.stringify({ locale: 'en' }));
    withSettings(root, { locale: 'en' }); // the clone's loop-data: not the data root here, never read
    assert.equal(resolveEnv({ HC_REPO_ROOT: root, HC_DATA_DIR: dataDir }).locale, 'en', 'plan.locale of the data root');
    withSettings(root, { locale: 'es' }, dataDir);
    assert.equal(resolveEnv({ HC_REPO_ROOT: root, HC_DATA_DIR: dataDir, HC_LOCALE: 'en' }).locale, 'es');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('resolveEnv: the example build never reads the personal settings.json; HC_LOCALE still applies', () => {
  const root = fixtureRepo();
  try {
    withSettings(root, { locale: 'es' });
    assert.equal(resolveEnv({ HC_REPO_ROOT: root, DATA_MODE: 'example' }).locale, 'en');
    assert.equal(resolveEnv({ HC_REPO_ROOT: root, DATA_MODE: 'example', HC_LOCALE: 'es' }).locale, 'es');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('PAGE_LOCALES: es and en', async () => {
  const { PAGE_LOCALES } = await import('./env.mjs');
  assert.deepEqual([...PAGE_LOCALES], ['es', 'en']);
});
