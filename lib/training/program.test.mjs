/* Unit tests for lib/training/program.mjs — pure programmed-session validation
 * + legacy JS-literal serialization, extracted from
 * data/training/generate-training.js (astro-plan-web migration, slice 2). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProgram, trainingBlock, trainingMeta } from './program.mjs';

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

test('trainingBlock bakes every programmed day plus the meta object', () => {
  const block = trainingBlock(fixtureTraining());
  assert.match(block, /var TRAINING = \{/);
  assert.match(block, /var TRAINING_META = \{/);
  assert.ok(block.includes("'2026-06-22'"));
  assert.ok(block.includes("'2026-06-24'"));
  assert.match(block, /program:'Test Block'/);
  assert.match(block, /coach:'Test Coach'/);
});

test('trainingBlock escapes single quotes so the baked block stays valid JS', () => {
  const block = trainingBlock(fixtureTraining());
  assert.doesNotThrow(() => new Function(block + '\nreturn TRAINING;'), 'baked block must be valid JS');
  // the fixture line intentionally carries a raw apostrophe (60kg's)
  assert.match(block, /60kg\\'s/);
});

test('trainingMeta computes program/coach/source/first/last/count from a training object (used by both the legacy JS-literal serializer and the Astro Bake globals)', () => {
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
