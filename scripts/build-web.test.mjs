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
import { checkTraining } from './build-web.mjs';

function fixtureRepo({ trainingDays } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-buildweb-check-'));
  fs.mkdirSync(path.join(root, 'data', 'nutrition'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data', 'training'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'ingredients.json'), JSON.stringify({ ingredients: { egg: { per: 100, k: 155, p: 13, c: 1.1, g: 11, unit: 'ud' } } }));
  fs.writeFileSync(path.join(root, 'data', 'nutrition', 'plan-data.json'), JSON.stringify({ locale: 'es', data: {}, extras: {} }));
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
