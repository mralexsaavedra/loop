import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEAT, EXERCISE, ageOn, bmi, bmrMifflin, computeTargets, screenPerson, checkTargetWeight, checkTargets, validatePerson,
} from './energy.mjs';
import { DAY_TYPES, GOALS } from './targets.mjs';

// Reference adult (hand-computed): BMR = 10*70 + 6.25*175 - 5*30 + 5 = 1648.75; x1.3 = 2143.4 kcal/day before
// exercise; net exercise (MET - 1) x 70 kg x h: gym 6 x 1 h = 350, bike 7 x 2 h = 840, long ride 7 x 3.5 h = 1470.
const A = Object.freeze({ sex: 'male', age: 30, heightCm: 175, weightKg: 70, activity: 'light' });

test('bmrMifflin: Mifflin-St Jeor for both sexes', () => {
  assert.equal(bmrMifflin(A), 1648.75);
  assert.equal(bmrMifflin({ sex: 'female', age: 25, heightCm: 160, weightKg: 50 }), 1214);
});

test('ageOn: whole years on a date; bmi: kg / m²', () => {
  assert.equal(ageOn('1995-02-17', '2026-10-14'), 31);
  assert.equal(ageOn('1995-10-15', '2026-10-14'), 30, 'birthday tomorrow');
  assert.equal(ageOn('1995-10-14', '2026-10-14'), 31, 'birthday today');
  assert.equal(Math.round(bmi(70, 175) * 10) / 10, 22.9);
});

test('NEAT levels and exercise assumptions are the documented ones', () => {
  assert.deepEqual({ ...NEAT }, { sedentary: 1.2, light: 1.3, active: 1.4 });
  assert.deepEqual(EXERCISE.rest, { met: 1, hours: 0 });
  assert.deepEqual(EXERCISE.gym, { met: 6, hours: 1 });
  assert.deepEqual(EXERCISE.bike, { met: 7, hours: 2 });
  assert.deepEqual(EXERCISE.bikeLong, { met: 7, hours: 3.5 });
});

test('computeTargets: the reference adult, every goal and day type (kcal to the nearest 50)', () => {
  const { targets, flags } = computeTargets(A);
  assert.deepEqual(flags, []);
  const kcal = (g) => DAY_TYPES.map((d) => targets[g][d].kcal);
  assert.deepEqual(kcal('maintain'), [2150, 2500, 3000, 3600]);
  assert.deepEqual(kcal('cut'), [1800, 2100, 2550, 3600], '-15 % except the long ride, kept at maintenance');
  assert.deepEqual(kcal('bulk'), [2350, 2750, 3300, 3950], '+10 %');
  for (const d of DAY_TYPES) {
    assert.equal(targets.cut[d].p, 140, 'protein 2.0 g/kg in a cut');
    assert.equal(targets.maintain[d].p, 126, 'protein 1.8 g/kg otherwise');
    assert.equal(targets.bulk[d].p, 126);
    for (const g of GOALS) assert.equal(targets[g][d].f, 56, 'fat 0.8 g/kg');
  }
});

test('computeTargets: the computed targets pass their own hard bounds', () => {
  const { targets } = computeTargets(A);
  assert.deepEqual(checkTargets(targets, A).errors, []);
});

test('computeTargets: no target below the floor (1200 kcal women / 1500 men), flagged', () => {
  const small = { sex: 'female', age: 50, heightCm: 150, weightKg: 45, activity: 'sedentary' };
  const { targets, flags } = computeTargets(small);
  for (const g of GOALS) for (const d of DAY_TYPES) assert.ok(targets[g][d].kcal >= 1200, `${g}/${d} ${targets[g][d].kcal}`);
  assert.equal(targets.cut.rest.kcal, 1200);
  assert.ok(flags.includes('floor'));
});

test('screenPerson: no numbers under 18 or in pregnancy / lactation', () => {
  const base = { age: 30, heightCm: 175, weightKg: 70 };
  assert.deepEqual(screenPerson({ ...base, age: 17 }), { numbers: false, goals: [], flags: ['minor'] });
  assert.deepEqual(screenPerson({ ...base, pregnant: true }), { numbers: false, goals: [], flags: ['pregnancy'] });
});

test('screenPerson: illness / medication or an eating-risk answer allows maintenance only, with a referral flag', () => {
  const base = { age: 30, heightCm: 175, weightKg: 70 };
  assert.deepEqual(screenPerson({ ...base, medical: true }), { numbers: true, goals: ['maintain'], flags: ['medical'] });
  assert.deepEqual(screenPerson({ ...base, eatingRisk: true }), { numbers: true, goals: ['maintain'], flags: ['eating'] });
});

test('screenPerson: BMI < 18.5 removes the cut; BMI >= 35 keeps every goal with a supervision note', () => {
  assert.deepEqual(screenPerson({ age: 30, heightCm: 175, weightKg: 55 }), { numbers: true, goals: ['maintain', 'bulk'], flags: ['bmiLow'] });
  assert.deepEqual(screenPerson({ age: 30, heightCm: 175, weightKg: 110 }), { numbers: true, goals: ['maintain', 'cut', 'bulk'], flags: ['bmiHigh'] });
  assert.deepEqual(screenPerson({ age: 30, heightCm: 175, weightKg: 70 }), { numbers: true, goals: ['maintain', 'cut', 'bulk'], flags: [] });
});

test('checkTargetWeight: refuses a target BMI < 18.5 and a target on the wrong side of the goal', () => {
  const p = { heightCm: 175, weightKg: 70 };
  assert.deepEqual(checkTargetWeight({ ...p, goal: 'cut', targetWeightKg: 66 }), []);
  assert.deepEqual(checkTargetWeight({ ...p, goal: 'cut', targetWeightKg: 55 }), ['targetBmiLow']);
  assert.deepEqual(checkTargetWeight({ ...p, goal: 'cut', targetWeightKg: 72 }), ['targetDirection']);
  assert.deepEqual(checkTargetWeight({ ...p, goal: 'bulk', targetWeightKg: 68 }), ['targetDirection']);
  assert.deepEqual(checkTargetWeight({ ...p, goal: 'maintain', targetWeightKg: null }), []);
});

test('checkTargets: hard bounds on an edited cell', () => {
  const { targets } = computeTargets(A);
  const edit = (g, d, patch) => {
    const t = JSON.parse(JSON.stringify(targets));
    Object.assign(t[g][d], patch);
    return checkTargets(t, A).errors.map((e) => `${e.goal}/${e.day}:${e.code}`);
  };
  assert.deepEqual(edit('cut', 'rest', { kcal: 1450 }), ['cut/rest:kcalFloor', 'cut/rest:deficitMax']);
  assert.deepEqual(edit('cut', 'rest', { kcal: 1650 }), ['cut/rest:deficitMax'], '23 % below maintenance');
  assert.deepEqual(edit('bulk', 'rest', { kcal: 2550 }), ['bulk/rest:surplusMax'], '19 % above maintenance');
  assert.deepEqual(edit('maintain', 'gym', { p: 175 }), ['maintain/gym:proteinMax'], '2.5 g/kg');
  assert.deepEqual(edit('maintain', 'gym', { p: 80 }), ['maintain/gym:proteinMin'], '1.14 g/kg');
  assert.deepEqual(edit('maintain', 'gym', { f: 30 }), ['maintain/gym:fatMin'], '0.43 g/kg');
});

test('checkTargets: soft warnings (protein / fat range; carbs only where energy is at maintenance or above)', () => {
  const { targets } = computeTargets(A);
  assert.deepEqual(checkTargets(targets, A).warnings, [], 'the computed defaults raise no warning');
  const t = JSON.parse(JSON.stringify(targets));
  t.maintain.rest.p = 161; // 2.3 g/kg
  t.maintain.rest.f = 74; // 1.06 g/kg (carbs stay at 3.0 g/kg)
  t.maintain.bikeLong.kcal = 2900; // carbs (2900 - 504 - 504) / 4 = 473 g = 6.8 g/kg < 8
  const w = checkTargets(t, A).warnings.map((e) => `${e.goal}/${e.day}:${e.code}`);
  assert.deepEqual(w, ['maintain/rest:proteinRange', 'maintain/rest:fatRange', 'maintain/bikeLong:carbsRange']);
});

test('validatePerson: adult ranges for the wizard inputs', () => {
  assert.deepEqual(validatePerson(A), []);
  assert.deepEqual(validatePerson({ ...A, sex: 'x', heightCm: 90, weightKg: 400, activity: 'pro' }), ['sex', 'heightCm', 'weightKg', 'activity']);
});
