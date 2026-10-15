import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  NEAT, EXERCISE, SPORTS, referenceKg, ageOn, dayTypeOfMinutes, exerciseFor, usedDayTypes, bmi, bmrMifflin, computeTargets, screenPerson, checkTargetWeight, checkTargets, validatePerson,
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

// Sports (the onboarding asks which sports a person does): each session maps to a day type by its length, and the
// day type's exercise becomes the time-weighted MET and the average session of the sports mapped to it.
test('SPORTS: the catalog and its Compendium METs', () => {
  assert.deepEqual({ ...SPORTS }, { strength: 6, running: 9, cycling: 7, swimming: 7, hybrid: 8, team: 7, yoga: 3, other: 5 });
});

test('dayTypeOfMinutes: short < 75 min <= long < 150 min <= very long', () => {
  assert.equal(dayTypeOfMinutes(15), 'gym');
  assert.equal(dayTypeOfMinutes(74), 'gym');
  assert.equal(dayTypeOfMinutes(75), 'bike');
  assert.equal(dayTypeOfMinutes(149), 'bike');
  assert.equal(dayTypeOfMinutes(150), 'bikeLong');
});

test('exerciseFor: no sports = the default table; each used day type gets its sports, the rest keep the default', () => {
  assert.equal(exerciseFor(undefined), EXERCISE);
  assert.equal(exerciseFor([]), EXERCISE);
  const ex = exerciseFor([
    { sport: 'running', minutes: 45, perWeek: 2 },
    { sport: 'strength', minutes: 60, perWeek: 3 },
    { sport: 'cycling', minutes: 180, perWeek: 1 },
  ]);
  // short: (9 x 90 + 6 x 180) / 270 min = 7 MET; 270 min over 5 sessions = 0.9 h
  assert.deepEqual(ex.gym, { met: 7, hours: 0.9 });
  assert.deepEqual(ex.bikeLong, { met: 7, hours: 3 });
  assert.deepEqual(ex.bike, EXERCISE.bike, 'unused: default');
  assert.deepEqual(ex.rest, EXERCISE.rest);
});

test('usedDayTypes: rest plus the day types the sports reach, in day-type order; no sports = all four', () => {
  assert.deepEqual(usedDayTypes(undefined), DAY_TYPES);
  assert.deepEqual(usedDayTypes([{ sport: 'yoga', minutes: 60, perWeek: 3 }]), ['rest', 'gym']);
  assert.deepEqual(usedDayTypes([{ sport: 'cycling', minutes: 200, perWeek: 1 }, { sport: 'running', minutes: 90, perWeek: 2 }]), ['rest', 'bike', 'bikeLong']);
});

test('computeTargets: sports set the exercise; without sports the numbers are unchanged', () => {
  assert.deepEqual(computeTargets({ ...A, sports: [] }), computeTargets(A));
  // 1648.75 x 1.3 = 2143.4 + (3 - 1) x 70 kg x 1 h = 2283.4 -> 2300
  const t = computeTargets({ ...A, sports: [{ sport: 'yoga', minutes: 60, perWeek: 3 }] }).targets;
  assert.equal(t.maintain.gym.kcal, 2300);
  assert.equal(t.maintain.rest.kcal, computeTargets(A).targets.maintain.rest.kcal);
});

test('checkTargets: bounds use the same sports-based maintenance', () => {
  const p = { ...A, sports: [{ sport: 'yoga', minutes: 60, perWeek: 3 }] };
  assert.deepEqual(checkTargets(computeTargets(p).targets, p).errors, []);
  // the default bulk gym day (2493 x 1.1 -> 2750 kcal) is over +15 % of the yoga day (2283)
  assert.ok(checkTargets(computeTargets(A).targets, p).errors.some((e) => e.goal === 'bulk' && e.day === 'gym' && e.code === 'surplusMax'));
});

test('validatePerson: sports are optional; a bad list is flagged', () => {
  assert.deepEqual(validatePerson({ ...A, sports: [{ sport: 'running', minutes: 45, perWeek: 3 }] }), []);
  const bad = (sports) => assert.deepEqual(validatePerson({ ...A, sports }), ['sports'], JSON.stringify(sports));
  bad('running');
  bad([{ sport: 'golf', minutes: 60, perWeek: 1 }]);
  bad([{ sport: 'running', minutes: 10, perWeek: 1 }]);
  bad([{ sport: 'running', minutes: 601, perWeek: 1 }]);
  bad([{ sport: 'running', minutes: 45, perWeek: 0 }]);
  bad([{ sport: 'running', minutes: 45, perWeek: 15 }]);
  bad([{ sport: 'running', minutes: 45.5, perWeek: 2 }]);
  bad([{ sport: 'running', minutes: 45, perWeek: 2 }, { sport: 'running', minutes: 90, perWeek: 1 }]);
});

// Protein and fat follow a REFERENCE weight: the current weight up to BMI 25, above it the weight at BMI 25
// (fat-free mass, not fat, drives protein needs). Fat never drops below 0.5 g per kg of CURRENT weight.
const HEAVY = Object.freeze({ sex: 'male', age: 40, heightCm: 175, weightKg: 120, activity: 'light' }); // BMI 39.2
const TALL = Object.freeze({ sex: 'female', age: 29, heightCm: 185, weightKg: 88, activity: 'sedentary' }); // BMI 25.7

test('referenceKg: the current weight up to BMI 25, the BMI-25 weight above it', () => {
  assert.equal(referenceKg(A), 70, 'BMI 22.9: unchanged');
  assert.equal(referenceKg({ heightCm: 200, weightKg: 100 }), 100, 'exactly BMI 25: unchanged');
  assert.equal(referenceKg(HEAVY), 76.56, '25 x 1.75^2, to 10 g');
  assert.equal(referenceKg(TALL), 85.56, '25 x 1.85^2, to 10 g');
});

test('computeTargets: protein and fat on the reference weight; a normal BMI is unchanged', () => {
  const a = computeTargets(A).targets;
  assert.equal(a.cut.rest.p, 140, '2.0 x 70');
  assert.equal(a.maintain.rest.f, 56, '0.8 x 70');
  const h = computeTargets(HEAVY).targets;
  assert.equal(h.cut.gym.p, 153, '2.0 x 76.6, not 240');
  assert.equal(h.maintain.rest.p, 138, '1.8 x 76.6');
  assert.equal(h.cut.rest.f, 61, 'max(0.8 x 76.6, 0.5 x 120)');
  const t = computeTargets(TALL).targets;
  assert.deepEqual([t.cut.rest.p, t.cut.rest.f], [171, 68]);
});

test('computeTargets: the fat floor is 0.5 g per kg of CURRENT weight', () => {
  // 150 kg at 160 cm: BMI-25 weight 64 kg; 0.8 x 64 = 51.2 < 0.5 x 150 = 75
  assert.equal(computeTargets({ sex: 'female', age: 45, heightCm: 160, weightKg: 150, activity: 'sedentary' }).targets.cut.rest.f, 75);
});

test('checkTargets: computed targets of a high-BMI person pass; protein bounds use the reference weight, the fat floor the current weight', () => {
  const t = computeTargets(HEAVY).targets;
  const res = checkTargets(t, HEAVY);
  assert.deepEqual(res.errors, []);
  assert.equal(res.warnings.filter((w) => w.code === 'proteinRange').length, 0, '153 g / 76.6 kg = 2.0 g/kg');
  const low = JSON.parse(JSON.stringify(t));
  low.maintain.rest.f = 55; // 0.46 g per current kg
  assert.ok(checkTargets(low, HEAVY).errors.some((e) => e.goal === 'maintain' && e.day === 'rest' && e.code === 'fatMin'));
  const high = JSON.parse(JSON.stringify(t));
  high.maintain.rest.p = 200; // 2.6 g per reference kg (1.7 per current kg)
  assert.ok(checkTargets(high, HEAVY).errors.some((e) => e.goal === 'maintain' && e.day === 'rest' && e.code === 'proteinMax'));
});

test('dayTypeOfMinutes uses the day type detector\'s thresholds (daytype.mjs DETECT), one source of truth', async () => {
  const { DETECT } = await import('./daytype.mjs');
  assert.equal(dayTypeOfMinutes(DETECT.bikeMin - 1), 'gym');
  assert.equal(dayTypeOfMinutes(DETECT.bikeMin), 'bike');
  assert.equal(dayTypeOfMinutes(DETECT.bikeLongMin - 1), 'bike');
  assert.equal(dayTypeOfMinutes(DETECT.bikeLongMin), 'bikeLong');
  assert.doesNotMatch(fs.readFileSync(new URL('./energy.mjs', import.meta.url), 'utf8'), /LONG_MIN = \d/, 'no literal copy');
});

test('checkTargets: a day raised to the sex floor is never rejected as a surplus (the elderly small woman)', () => {
  var p = { sex: 'female', age: 80, heightCm: 150, weightKg: 40, activity: 'sedentary' };
  var out = computeTargets(p);
  assert.equal(out.targets.maintain.rest.kcal, 1200, 'the rest day sits on the floor');
  assert.deepEqual(checkTargets(out.targets, p).errors, []);
});

test('checkTargets: the computed targets pass their own hard bounds for every valid person and offered goal (grid)', () => {
  var bad = [];
  for (var sex of ['female', 'male']) {
    for (var age = 18; age <= 90; age += 8) {
      for (var heightCm = 140; heightCm <= 210; heightCm += 10) {
        for (var weightKg = 35; weightKg <= 200; weightKg += 15) {
          for (var activity of Object.keys(NEAT)) {
            var p = { sex, age, heightCm, weightKg, activity };
            // only the goals the safety screen offers this person (a BMI < 18.5 never gets the cut)
            var offered = screenPerson(p).goals;
            assert.deepEqual(offered.length > 0, true);
            var errs = checkTargets(computeTargets(p).targets, p).errors.filter((e) => offered.includes(e.goal));
            if (errs.length) bad.push(JSON.stringify(p) + ' ' + errs.map((e) => e.goal + '/' + e.day + ':' + e.code).join(','));
          }
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], bad.length + ' people get unsatisfiable targets');
});

test('computeTargets: the fat floor (0.5 g/kg of current weight) is rounded UP, never below it (BMI > 40, decimal weight)', () => {
  var p = { sex: 'male', age: 40, heightCm: 175, weightKg: 130.8, activity: 'light' };
  var out = computeTargets(p);
  assert.equal(out.targets.maintain.rest.f, 66, 'ceil(0.5 * 130.8) = 66, not round() = 65');
  assert.deepEqual(checkTargets(out.targets, p).errors, []);
});

test('checkTargets: computed targets pass their own hard bounds for decimal weights too (grid subsample)', () => {
  var bad = [];
  for (var sex of ['female', 'male']) {
    for (var age of [18, 45, 80]) {
      for (var heightCm = 140; heightCm <= 210; heightCm += 14) {
        for (var w10 = 350; w10 <= 2000; w10 += 7) { // 0.7 kg steps cover every tenth over a 7-kg span
          var weightKg = w10 / 10;
          for (var activity of ['sedentary', 'light']) {
            var p = { sex, age, heightCm, weightKg, activity };
            var offered = screenPerson(p).goals;
            var errs = checkTargets(computeTargets(p).targets, p).errors.filter((e) => offered.includes(e.goal));
            if (errs.length) bad.push(JSON.stringify(p) + ' ' + errs.map((e) => e.goal + '/' + e.day + ':' + e.code).join(','));
          }
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], bad.length + ' people get unsatisfiable targets');
});
