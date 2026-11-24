import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOnboarding } from './onboarding.mjs';

/** @typedef {import('./onboarding.mjs').OnboardingProfile} OnboardingProfile */

/** @param {number} kcal @param {number} p @param {number} f */
const cells = (kcal, p, f) => ({
  rest: { kcal, p, f }, gym: { kcal: kcal + 350, p, f }, hybrid: { kcal: kcal + 500, p, f }, indoor: { kcal: kcal + 550, p, f },
  run: { kcal: kcal + 600, p, f }, bike: { kcal: kcal + 850, p, f }, bikeLong: { kcal: kcal + 1450, p, f },
});
// a profile saved before the hybrid / indoor / run day types (S6): four cells per goal
/** @param {number} kcal @param {number} p @param {number} f */
const oldCells = (kcal, p, f) => ({ rest: { kcal, p, f }, gym: { kcal: kcal + 350, p, f }, bike: { kcal: kcal + 850, p, f }, bikeLong: { kcal: kcal + 1450, p, f } });
const DOC = Object.freeze({
  name: 'Ana', sex: 'female', birthdate: '1997-05-20', heightCm: 165, weightKg: 60, activity: 'light',
  goals: ['maintain', 'cut', 'bulk'],
  targets: { maintain: cells(1800, 108, 48), cut: cells(1550, 120, 48), bulk: cells(1950, 108, 48) },
  updatedAt: '2030-01-10T10:00:00.000Z',
});

test('normalizeOnboarding keeps a well-formed document (the GET /food/profile body)', () => {
  assert.deepEqual(normalizeOnboarding({ profile: DOC }), { ...DOC });
});

test('S6 normalizeOnboarding: an OLD 4-cell profile is accepted, each missing hybrid / indoor / run cell back-filled from that goal\'s gym cell', () => {
  const old = { ...DOC, targets: { maintain: oldCells(1800, 108, 48), cut: oldCells(1550, 120, 48), bulk: oldCells(1950, 108, 48) } };
  const out = /** @type {OnboardingProfile} */ (normalizeOnboarding({ profile: old }));
  for (const g of /** @type {const} */ (['maintain', 'cut', 'bulk'])) {
    for (const d of /** @type {const} */ (['hybrid', 'indoor', 'run'])) assert.deepEqual(out.targets[g][d], old.targets[g].gym, `${g}.${d}`);
    for (const d of /** @type {const} */ (['rest', 'gym', 'bike', 'bikeLong'])) assert.deepEqual(out.targets[g][d], old.targets[g][d], `${g}.${d}`);
  }
  // a partly new profile keeps its own new cells
  const mixed = { ...old, targets: { ...old.targets, cut: { ...old.targets.cut, run: { kcal: 2400, p: 120, f: 48 } } } };
  assert.deepEqual(/** @type {OnboardingProfile} */ (normalizeOnboarding({ profile: mixed })).targets.cut.run, { kcal: 2400, p: 120, f: 48 });
  assert.deepEqual(/** @type {OnboardingProfile} */ (normalizeOnboarding({ profile: mixed })).targets.cut.hybrid, old.targets.cut.gym);
  // a missing rest / gym / bike / bikeLong cell is still an error
  for (const d of /** @type {const} */ (['rest', 'gym', 'bike', 'bikeLong'])) {
    const { [d]: _gone, ...rest } = old.targets.cut;
    assert.throws(() => normalizeOnboarding({ profile: { ...old, targets: { ...old.targets, cut: rest } } }), new RegExp(`targets\\.cut\\.${d}`), d);
  }
  // a malformed new cell is not back-filled over
  assert.throws(() => normalizeOnboarding({ profile: { ...old, targets: { ...old.targets, cut: { ...old.targets.cut, run: { kcal: 'x', p: 1, f: 1 } } } } }), /targets\.cut\.run/);
});

test('normalizeOnboarding: null = the wizard was never completed', () => {
  assert.equal(normalizeOnboarding({ profile: null }), null);
});

test('normalizeOnboarding: name is optional', () => {
  const { name, ...rest } = DOC;
  assert.deepEqual(normalizeOnboarding({ profile: rest }), { ...rest });
});

test('normalizeOnboarding throws on a malformed document (never half-writes a file)', () => {
  /** @param {Record<string, unknown>} patch */
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
  assert.deepEqual(/** @type {OnboardingProfile} */ (normalizeOnboarding({ profile: { ...DOC, sports } })).sports, sports);
  assert.equal('sports' in /** @type {OnboardingProfile} */ (normalizeOnboarding({ profile: DOC })), false);
  for (const bad of ['running', [{ sport: 'golf', minutes: 45, perWeek: 3 }], [{ sport: 'running', minutes: 5, perWeek: 3 }],
    [{ sport: 'running', minutes: 45, perWeek: 3, extra: 1 }]]) {
    assert.throws(() => normalizeOnboarding({ profile: { ...DOC, sports: bad } }), /sports/, JSON.stringify(bad));
  }
});

// activity levels, sports, day types and bounds reach the service GENERATED (scripts/gen-profile-rules.test.mjs);
// its goals come from food-calc.js SETTINGS_GOALS (generated from lib/nutrition/foodlog.mjs), which must name the same goals
test('foodlog SETTINGS_GOALS (the service\'s goal list) names the same goals as targets GOALS', async () => {
  const { GOALS } = await import('../nutrition/targets.mjs');
  const { SETTINGS_GOALS } = await import('../nutrition/foodlog.mjs');
  assert.deepEqual([...SETTINGS_GOALS], [...GOALS]);
});

test('SERVER: the profile vocabularies and bounds come from the nutrition lib', async () => {
  const { SERVER } = await import('./onboarding.mjs');
  const E = await import('../nutrition/energy.mjs');
  const { DAY_TYPES } = await import('../nutrition/targets.mjs');
  assert.equal(SERVER.consts.PROFILE_SEX, E.SEXES);
  assert.deepEqual(SERVER.consts.PROFILE_ACTIVITY, Object.keys(E.NEAT));
  assert.deepEqual(SERVER.consts.PROFILE_SPORTS, Object.keys(E.SPORTS));
  assert.equal(SERVER.consts.PROFILE_DAY_TYPES, DAY_TYPES);
  const { FILL_FROM_GYM } = await import('../nutrition/targets.mjs');
  assert.equal(SERVER.consts.PROFILE_FILL_FROM_GYM, FILL_FROM_GYM);
  assert.deepEqual(FILL_FROM_GYM, ['hybrid', 'indoor', 'run']);
  assert.deepEqual(SERVER.consts.PROFILE_LIMITS, {
    age: E.AGE_RANGE, heightCm: E.HEIGHT_CM_RANGE, weightKg: E.WEIGHT_KG_RANGE,
    sportMinutes: E.SPORT_MINUTES, sportPerWeek: E.SPORT_PER_WEEK,
  });
});

test('normalizeOnboarding: height and weight within the page wizard bounds (120-230 cm, 30-250 kg)', () => {
  /** @param {Record<string, unknown>} patch */
  const bad = (patch) => assert.throws(() => normalizeOnboarding({ profile: { ...DOC, ...patch } }), /onboarding/);
  bad({ heightCm: 0 });
  bad({ heightCm: 119 });
  bad({ heightCm: 231 });
  bad({ weightKg: -5 });
  bad({ weightKg: 29 });
  bad({ weightKg: 251 });
  assert.equal(/** @type {OnboardingProfile} */ (normalizeOnboarding({ profile: { ...DOC, heightCm: 120, weightKg: 30 } })).heightCm, 120);
  assert.equal(/** @type {OnboardingProfile} */ (normalizeOnboarding({ profile: { ...DOC, heightCm: 230, weightKg: 250 } })).weightKg, 250);
  bad({ birthdate: '2030-02-31' });
});
