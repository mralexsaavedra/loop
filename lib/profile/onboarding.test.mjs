import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOnboarding } from './onboarding.mjs';

const cells = (kcal, p, f) => ({ rest: { kcal, p, f }, gym: { kcal: kcal + 350, p, f }, bike: { kcal: kcal + 850, p, f }, bikeLong: { kcal: kcal + 1450, p, f } });
const DOC = Object.freeze({
  name: 'Ana', sex: 'female', birthdate: '1997-05-20', heightCm: 165, weightKg: 60, activity: 'light',
  goals: ['maintain', 'cut', 'bulk'],
  targets: { maintain: cells(1800, 108, 48), cut: cells(1550, 120, 48), bulk: cells(1950, 108, 48) },
  updatedAt: '2030-01-10T10:00:00.000Z',
});

test('normalizeOnboarding keeps a well-formed document (the GET /food/profile body)', () => {
  assert.deepEqual(normalizeOnboarding({ profile: DOC }), { ...DOC });
});

test('normalizeOnboarding: null = the wizard was never completed', () => {
  assert.equal(normalizeOnboarding({ profile: null }), null);
});

test('normalizeOnboarding: name is optional', () => {
  const { name, ...rest } = DOC;
  assert.deepEqual(normalizeOnboarding({ profile: rest }), { ...rest });
});

test('normalizeOnboarding throws on a malformed document (never half-writes a file)', () => {
  const bad = (patch) => assert.throws(() => normalizeOnboarding({ profile: { ...DOC, ...patch } }), /onboarding/);
  assert.throws(() => normalizeOnboarding({}), /onboarding/);
  bad({ sex: 'x' });
  bad({ birthdate: '1997-13-01' });
  bad({ heightCm: 'tall' });
  bad({ activity: 'pro' });
  bad({ goals: [] });
  bad({ goals: ['shred'] });
  bad({ targets: { ...DOC.targets, cut: undefined } });
  bad({ targets: { ...DOC.targets, bulk: { ...DOC.targets.bulk, gym: { kcal: '2300', p: 108, f: 48 } } } });
  bad({ extra: true });
});
