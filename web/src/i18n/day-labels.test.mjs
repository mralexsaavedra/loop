import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalNutriText, shownDayTypes } from './day-labels.mjs';
import { es, en } from './nutri-templates.mjs';
import { SPORTS } from '../../../lib/nutrition/energy.mjs';
import { DAY_TYPES } from '../../../lib/nutrition/targets.mjs';

const SPORTS_A = [
  { sport: 'yoga', minutes: 60, perWeek: 3 },
  { sport: 'strength', minutes: 45, perWeek: 2 },
  { sport: 'running', minutes: 90, perWeek: 1 },
];

test('personalNutriText: no sports = the dictionary itself (the owner keeps gym / bike / long bike)', () => {
  assert.equal(personalNutriText(es, undefined, 'es'), es);
  assert.equal(personalNutriText(en, [], 'en'), en);
});

test('personalNutriText: each used day type is named after its sports (most frequent first) and their usual length', () => {
  const t = personalNutriText(es, SPORTS_A, 'es');
  assert.equal(t.dayShort.gym, 'Yoga / pilates · Fuerza');
  assert.equal(t.dayTypes.gym, 'Yoga / pilates · Fuerza ~55 min');
  assert.equal(t.dayShort.bike, 'Correr');
  assert.equal(t.dayTypes.bike, 'Correr ~1,5 h');
  assert.equal(t.dayShort.rest, es.dayShort.rest);
  assert.equal(t.dayTypes.bikeLong, es.dayTypes.bikeLong, 'unused: unchanged');
  assert.deepEqual(Object.keys(t.dayTypes), DAY_TYPES);
  const e = personalNutriText(en, [{ sport: 'cycling', minutes: 180, perWeek: 1 }, { sport: 'swimming', minutes: 40, perWeek: 2 }, { sport: 'team', minutes: 60, perWeek: 2 }, { sport: 'hybrid', minutes: 60, perWeek: 1 }], 'en');
  assert.equal(e.dayTypes.bikeLong, 'Cycling ~3 h');
  assert.equal(e.dayShort.gym, 'Swimming · Team sport +1', 'segment labels keep two names');
  assert.equal(e.dayTypes.gym, 'Swimming · Team sport · HYROX / CrossFit ~50 min');
});

test('personalNutriText: ride-only wording becomes sport-neutral; the input dictionary is not mutated', () => {
  const before = JSON.stringify(es);
  const t = personalNutriText(es, SPORTS_A, 'es');
  assert.equal(JSON.stringify(es), before);
  for (const d of ['gym', 'bike', 'bikeLong']) assert.equal(t.autoRaised[d], es.sportText.autoRaised);
  assert.equal(t.why.ride, es.sportText.rideWhy);
  assert.equal(t.why.workout, es.why.workout);
  assert.equal(t.fuel.durationLabel, es.sportText.durationLabel);
  assert.equal(t.fuel.inDay, es.sportText.inDay);
  assert.equal(t.fuel.disclaimer, es.fuel.disclaimer);
});

test('every sport has a name in both languages, and sportText has the same keys', () => {
  for (const dict of [es, en]) assert.deepEqual(Object.keys(dict.sportText.names), Object.keys(SPORTS));
  assert.deepEqual(Object.keys(es.sportText), Object.keys(en.sportText));
});

test('shownDayTypes: the day-type control shows only the days a person\'s week has (all four without sports)', () => {
  assert.deepEqual(shownDayTypes(DAY_TYPES, undefined), DAY_TYPES);
  assert.deepEqual(shownDayTypes(DAY_TYPES, [{ sport: 'yoga', minutes: 60, perWeek: 3 }]), ['rest', 'gym']);
  assert.deepEqual(shownDayTypes(DAY_TYPES, SPORTS_A), ['rest', 'gym', 'bike']);
});
