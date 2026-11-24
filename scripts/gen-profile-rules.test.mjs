/* The ingest service's src/profile-rules.js is GENERATED from lib/profile/onboarding.mjs: the committed file
 * must be exactly what the generator writes now (a lib change without `npm run gen:profile-rules` fails here). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { profileRulesSource, PROFILE_RULES_PATH, PROFILE_RULES_HEADER } from './gen-profile-rules.mjs';
import { NEAT, SPORTS, SPORT_MINUTES, SPORT_PER_WEEK, AGE_RANGE, HEIGHT_CM_RANGE, WEIGHT_KG_RANGE } from '../lib/nutrition/energy.mjs';
import { DAY_TYPES } from '../lib/nutrition/targets.mjs';
import * as S from '../services/loop-ingest/src/profile-rules.js';

const committed = readFileSync(PROFILE_RULES_PATH, 'utf8');

test('profile-rules.js starts with the GENERATED header', () => {
  assert.ok(committed.startsWith('/* ' + PROFILE_RULES_HEADER), 'services/loop-ingest/src/profile-rules.js is not generated: run `npm run gen:profile-rules`');
});

test('profile-rules.js is current: regenerating it from the lib gives the committed bytes', () => {
  assert.ok(committed === profileRulesSource(), 'services/loop-ingest/src/profile-rules.js is out of date: run `npm run gen:profile-rules`');
});

test('the generator is deterministic', () => {
  assert.equal(profileRulesSource(), profileRulesSource());
});

test('the service module exports exactly the lib vocabularies and bounds, deep-frozen', () => {
  assert.deepEqual(Object.keys(S).sort(), ['PROFILE_ACTIVITY', 'PROFILE_DAY_TYPES', 'PROFILE_FILL_FROM_GYM', 'PROFILE_LIMITS', 'PROFILE_SEX', 'PROFILE_SPORTS']);
  assert.deepEqual(S.PROFILE_SEX, ['male', 'female']);
  assert.deepEqual(S.PROFILE_ACTIVITY, Object.keys(NEAT));
  assert.deepEqual(S.PROFILE_SPORTS, Object.keys(SPORTS));
  assert.deepEqual(S.PROFILE_DAY_TYPES, [...DAY_TYPES]);
  assert.deepEqual(S.PROFILE_LIMITS, {
    age: [...AGE_RANGE], heightCm: [...HEIGHT_CM_RANGE], weightKg: [...WEIGHT_KG_RANGE],
    sportMinutes: [...SPORT_MINUTES], sportPerWeek: [...SPORT_PER_WEEK],
  });
  assert.ok(Object.isFrozen(S.PROFILE_LIMITS) && Object.isFrozen(S.PROFILE_LIMITS.age) && Object.isFrozen(S.PROFILE_SPORTS));
});

// --check on a stale file (exit 1, nothing written) is the shared writeGenerated step, tested in
// scripts/gen-food-calc.test.mjs
test('gen-profile-rules: --help prints the usage, an unknown flag exits 2, --check exits 0 when current and writes nothing', async () => {
  const { spawnSync } = await import('node:child_process');
  const { statSync } = await import('node:fs');
  const script = fileURLToPath(new URL('./gen-profile-rules.mjs', import.meta.url));
  const before = statSync(PROFILE_RULES_PATH).mtimeMs;
  const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: npm run gen:profile-rules/);
  for (const args of [['--chek'], ['stray']]) {
    const r = run(args);
    assert.equal(r.status, 2, String(args));
    assert.match(r.stderr, /^ERROR: /);
  }
  assert.equal(run(['--check']).status, 0);
  assert.equal(statSync(PROFILE_RULES_PATH).mtimeMs, before);
});
