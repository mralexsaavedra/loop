/* Unit tests for lib/training/program.mjs — pure programmed-session
 * validation + shared meta, extracted from data/training/generate-training.js
 * (astro-plan-web migration, slice 2). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProgram, trainingMeta } from './program.mjs';

function fixtureTraining() {
  return {
    program: 'Test Block',
    coach: 'Test Coach',
    source: 'test-app',
    days: {
      '2026-06-22': { kind: 'gym', focus: 'Upper body', blocks: [{ title: 'A1', lines: ["3x8 bench 60kg's"] }] },
      '2026-06-24': { focus: 'Easy run', blocks: [{ label: 'Warm-up', title: 'Jog', lines: ['10 min easy'] }] },
    },
  };
}

test('validateProgram passes on a well-formed program', () => {
  assert.equal(validateProgram(fixtureTraining()).ok, true);
});

test('validateProgram rejects a non-ISO day key and an empty blocks array', () => {
  const bad = { days: { 'not-a-date': { focus: 'x', blocks: [] } } };
  assert.throws(() => validateProgram(bad), /validation failed/);
});

test('validateProgram requires a top-level "days" object', () => {
  assert.throws(() => validateProgram({}), /must contain a top-level "days" object/);
});

test('trainingMeta computes program/coach/source/first/last/count from a training object (used by the Astro Bake globals)', () => {
  const meta = trainingMeta(fixtureTraining());
  assert.deepEqual(meta, {
    program: 'Test Block',
    coach: 'Test Coach',
    source: 'test-app',
    first: '2026-06-22',
    last: '2026-06-24',
    count: 2,
  });
});

test('trainingMeta defaults program/coach/source to empty strings when absent', () => {
  const meta = trainingMeta({ days: { '2026-01-01': { focus: 'x', blocks: [{ title: 'A', lines: ['l'] }] } } });
  assert.deepEqual(meta, { program: '', coach: '', source: '', first: '2026-01-01', last: '2026-01-01', count: 1 });
});

test('trainingMeta on an empty days object yields empty first/last and count 0', () => {
  const meta = trainingMeta({ days: {} });
  assert.deepEqual(meta, { program: '', coach: '', source: '', first: '', last: '', count: 0 });
});

test('validateProgram accepts a bike session with an optional durationMin (it feeds the nutrition day type)', () => {
  const t = fixtureTraining();
  t.days['2026-06-27'] = { kind: 'bike', durationMin: 180, focus: 'Long ride', blocks: [{ title: 'Z2', lines: ['3 h easy'] }] };
  assert.equal(validateProgram(t).ok, true);
  t.days['2026-06-28'] = { kind: 'bike', durationMin: 'long', focus: 'x', blocks: [{ title: 'Z2', lines: ['x'] }] };
  assert.throws(() => validateProgram(t), /durationMin must be a positive number of minutes/);
});
