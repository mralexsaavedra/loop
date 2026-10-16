/* HC_DATA_DIR end to end at the build's composition root (web/src/env.mjs resolveEnv + web/src/bakes.mjs
 * computeBakes, the code path the page runs): a personal build reads its plan, training, profile, onboarding,
 * extract and food log from the data root (lib/paths.mjs; <clone>/loop-data by default), never from the clone's
 * pre-data-root files, while
 * ingredients.json and the example mode keep reading the tracked repo files. SYNTHETIC inputs only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEnv } from '../src/env.mjs';
import { computeBakes } from '../src/bakes.mjs';
import { toCsv } from '../../data/nutrition/sync-foodlog.mjs';

const REPO_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const seed = (rel) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
const put = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
};

/** A throwaway clone (tracked seeds + DECOY legacy personal files) and a data root in the new layout. */
function fixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-data-root-repo-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-data-root-'));
  for (const rel of ['data/nutrition/ingredients.json', 'data/nutrition/plan-data.example.json', 'data/training/training-data.example.json', 'profile/profile.example.json']) {
    put(path.join(repo, rel), fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
  }
  const plan = seed('data/nutrition/plan-data.example.json');
  // decoys at the old paths: a build that still reads them shows locale en / name Legacy / weight 99
  put(path.join(repo, 'data/nutrition/plan-data.json'), { ...plan, locale: 'en' });
  put(path.join(repo, 'profile/profile.json'), { name: 'Legacy Person' });
  put(path.join(repo, 'data/apple-health/extract/weight.csv'), 'date,value,source\n2030-01-01,99,Legacy\n');
  // the data root
  put(path.join(data, 'cache/plan.json'), { ...plan, locale: 'es' });
  put(path.join(data, 'cache/training.json'), { days: { '2030-01-02': { focus: 'Data root day', blocks: [{ title: 't', lines: ['l'] }] } } });
  put(path.join(data, 'cache/profile.json'), { name: 'Data Root', birthdate: '1990-01-01' });
  put(path.join(data, 'extract/weight.csv'), 'date,value,source\n2030-01-03,71.5,Scale\n');
  put(path.join(data, 'foodlog/foodlog-daily.csv'), toCsv([{ date: '2030-01-03', k: 2100, p: 120, c: 200, f: 60, n: 4, missing: { p: false, c: false, f: false }, groups: { breakfast: 1, lunch: 1, dinner: 1, addon: 1 } }]));
  return { repo, data, cleanup: () => { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } };
}

test('personal build with HC_DATA_DIR: plan, training, profile, extract and food log come from the data root', () => {
  const f = fixture();
  try {
    const env = resolveEnv({ HC_REPO_ROOT: f.repo, DATA_MODE: 'personal', HC_DATA_DIR: f.data });
    assert.equal(env.locale, 'es', 'cache/plan.json, not data/nutrition/plan-data.json');
    assert.equal(env.extractDir, path.join(f.data, 'extract'));
    assert.deepEqual(Object.keys(env.training.days), ['2030-01-02'], 'cache/training.json');
    assert.ok(env.ingredients && Object.keys(env.ingredients).length > 10, 'ingredients.json stays the tracked repo file');
    const bakes = computeBakes(env);
    assert.equal(bakes.profile.name, 'Data Root', 'cache/profile.json, not profile/profile.json');
    assert.deepEqual(bakes.profile.weight, { kg: 71.5, date: '2030-01-03' }, 'extract/weight.csv of the data root');
    assert.equal(bakes.intake.log.asOf, '2030-01-03', 'foodlog/foodlog-daily.csv of the data root');
    assert.equal(bakes.intake.log.days[0].k, 2100);
  } finally {
    f.cleanup();
  }
});

test('without HC_DATA_DIR: the clone\'s loop-data/ (the default data root), never the old paths (the decoys)', () => {
  const f = fixture();
  try {
    fs.cpSync(f.data, path.join(f.repo, 'loop-data'), { recursive: true });
    put(path.join(f.repo, 'loop-data', 'cache', 'profile.json'), { name: 'Default Root', birthdate: '1990-01-01' });
    const env = resolveEnv({ HC_REPO_ROOT: f.repo, DATA_MODE: 'personal' });
    assert.equal(env.locale, 'es');
    assert.equal(env.extractDir, path.join(f.repo, 'loop-data', 'extract'));
    const bakes = computeBakes(env);
    assert.equal(bakes.profile.name, 'Default Root');
    assert.equal(bakes.profile.weight.kg, 71.5);
    assert.equal(bakes.intake.log.asOf, '2030-01-03');
  } finally {
    f.cleanup();
  }
});

test('example mode ignores HC_DATA_DIR: the tracked seeds, never the data root', () => {
  const f = fixture();
  try {
    const env = resolveEnv({ HC_REPO_ROOT: f.repo, DATA_MODE: 'example', HC_DATA_DIR: f.data });
    assert.notEqual(env.extractDir, path.join(f.data, 'extract'));
    assert.equal(env.plan.locale, seed('data/nutrition/plan-data.example.json').locale);
    assert.notEqual(computeBakes(env).profile.name, 'Data Root');
  } finally {
    f.cleanup();
  }
});
