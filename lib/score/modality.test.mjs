import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCORE_MODALITIES, scoreModality } from './modality.mjs';
import { modalityGroup } from '../training/dashboard.mjs';

test('SCORE_MODALITIES lists the four buckets in display order', () => {
  assert.deepEqual(SCORE_MODALITIES, ['gym', 'run', 'bike', 'other']);
});

test('scoreModality maps workout types to gym/run/bike/other', () => {
  const table = {
    HighIntensityIntervalTraining: 'gym',
    CrossTraining: 'gym',
    TraditionalStrengthTraining: 'gym',
    FunctionalStrengthTraining: 'gym',
    WeightTraining: 'gym',
    Other: 'gym',
    Running: 'run',
    TrailRunning: 'run',
    Cycling: 'bike',
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

test('Home gym bucket intentionally diverges from Entrenos modalityGroup (pinned)', () => {
  // Watch-labelled HIIT is the usual gym work: Entrenos calls it hiit, Home calls it gym.
  assert.equal(modalityGroup('HighIntensityIntervalTraining'), 'hiit');
  assert.equal(scoreModality('HighIntensityIntervalTraining'), 'gym');
  // Entrenos splits strength out; Home folds it into gym.
  assert.equal(modalityGroup('TraditionalStrengthTraining'), 'strength');
  assert.equal(scoreModality('TraditionalStrengthTraining'), 'gym');
  // Unknown types are "other" on both tabs (never shown as Gym, never scored).
  assert.equal(modalityGroup('Tennis'), 'other');
  assert.equal(scoreModality('Tennis'), 'other');
});
