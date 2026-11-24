import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCORE_MODALITIES, scoreModality, physicalModality, isGymModality, byModality, byPhysical } from './modality.mjs';
import { modalityGroup } from '../training/dashboard.mjs';

test('SCORE_MODALITIES lists the buckets in display order', () => {
  assert.deepEqual(SCORE_MODALITIES, ['strength', 'hybrid', 'run', 'bike', 'other']);
});

test('scoreModality maps workout types to strength/hybrid/run/bike/other', () => {
  const table = {
    TraditionalStrengthTraining: 'strength',
    FunctionalStrengthTraining: 'strength',
    WeightTraining: 'strength',
    HighIntensityIntervalTraining: 'hybrid',
    CrossTraining: 'hybrid',
    Other: 'hybrid',
    Running: 'run',
    TrailRunning: 'run',
    Cycling: 'bike',
    IndoorCycling: 'bike',
    Walking: 'other',
    Hiking: 'other',
    Tennis: 'other',
    Rowing: 'other',
    Swimming: 'other',
    Pilates: 'other',
    Yoga: 'other',
    Elliptical: 'other',
    '': 'other',
  };
  for (const [type, want] of Object.entries(table)) assert.equal(scoreModality(type), want, type);
});

test('scoreModality does not treat substrings of unrelated types as gym ("Other" is an exact label)', () => {
  assert.equal(scoreModality('MixedOtherCardio'), 'other');
});

test('scoreModality tolerates null/undefined types', () => {
  assert.equal(scoreModality(undefined), 'other');
  assert.equal(scoreModality(null), 'other');
});

test('physicalModality folds strength and hybrid into one gym family (the same-day dedupe key)', () => {
  assert.equal(physicalModality('TraditionalStrengthTraining'), 'gym');
  assert.equal(physicalModality('HighIntensityIntervalTraining'), 'gym');
  assert.equal(physicalModality('Other'), 'gym');
  assert.equal(physicalModality('IndoorCycling'), 'bike');
  assert.equal(physicalModality('Running'), 'run');
  assert.equal(physicalModality('Tennis'), 'other');
  assert.equal(isGymModality('strength'), true);
  assert.equal(isGymModality('hybrid'), true);
  assert.equal(isGymModality('run'), false);
  assert.equal(byModality({ type: 'WeightTraining' }), 'strength');
  assert.equal(byPhysical({ type: 'WeightTraining' }), 'gym');
});

test('Entreno modalityGroup and Home scoreModality use the same buckets', () => {
  for (const t of ['HighIntensityIntervalTraining', 'TraditionalStrengthTraining', 'Other', 'Cycling', 'IndoorCycling', 'Running', 'Tennis', '']) {
    assert.equal(modalityGroup(t), scoreModality(t), t);
  }
});
