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
  bad({ goals: ['cut', 'cut'] });
  bad({ targets: { ...DOC.targets, cut: undefined } });
  bad({ targets: { ...DOC.targets, bulk: { ...DOC.targets.bulk, gym: { kcal: '2300', p: 108, f: 48 } } } });
  bad({ extra: true });
});

test('normalizeOnboarding: sports are optional and kept when well-formed', () => {
  const sports = [{ sport: 'running', minutes: 45, perWeek: 3 }, { sport: 'yoga', minutes: 60, perWeek: 1 }];
  assert.deepEqual(normalizeOnboarding({ profile: { ...DOC, sports } }).sports, sports);
  assert.equal('sports' in normalizeOnboarding({ profile: DOC }), false);
  for (const bad of ['running', [{ sport: 'golf', minutes: 45, perWeek: 3 }], [{ sport: 'running', minutes: 5, perWeek: 3 }],
    [{ sport: 'running', minutes: 45, perWeek: 3, extra: 1 }]]) {
    assert.throws(() => normalizeOnboarding({ profile: { ...DOC, sports: bad } }), /sports/, JSON.stringify(bad));
  }
});

test('the service validates the same vocabularies (activity levels, goals, sports) as the host', async () => {
  const { PROFILE_ACTIVITY, PROFILE_SPORTS } = await import('../../services/loop-ingest/src/food.js');
  const { NEAT, SPORTS } = await import('../nutrition/energy.mjs');
  assert.deepEqual([...PROFILE_SPORTS], Object.keys(SPORTS));
  const { GOALS } = await import('../nutrition/targets.mjs');
  const { SETTINGS_GOALS } = await import('../nutrition/foodlog.mjs');
  assert.deepEqual([...PROFILE_ACTIVITY], Object.keys(NEAT));
  assert.deepEqual([...SETTINGS_GOALS], [...GOALS]);
});

test('normalizeOnboarding: height and weight within the page wizard bounds (120-230 cm, 30-250 kg)', () => {
  const bad = (patch) => assert.throws(() => normalizeOnboarding({ profile: { ...DOC, ...patch } }), /onboarding/);
  bad({ heightCm: 0 });
  bad({ heightCm: 119 });
  bad({ heightCm: 231 });
  bad({ weightKg: -5 });
  bad({ weightKg: 29 });
  bad({ weightKg: 251 });
  assert.equal(normalizeOnboarding({ profile: { ...DOC, heightCm: 120, weightKg: 30 } }).heightCm, 120);
  assert.equal(normalizeOnboarding({ profile: { ...DOC, heightCm: 230, weightKg: 250 } }).weightKg, 250);
  bad({ birthdate: '2030-02-31' });
});
