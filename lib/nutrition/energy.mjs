/* Starting nutrition targets computed from a person (the in-page onboarding, for users without an AI coach).
 *
 * Method (analysis/methodology.md §1-§3 + "Safety bounds", reviewed by the nutrition coach):
 * - BMR: Mifflin-St Jeor.
 * - A day = BMR x NEAT (activity outside training) + the NET exercise of its day type, (MET - 1) x kg x hours
 *   (the BMR already pays the first MET). One base for every day type, so exercise is never counted twice.
 * - Goals: maintain = that TDEE; cut = -15 % on rest / gym / bike days, the long ride kept at maintenance
 *   (fuel the long sessions); bulk = +10 %. kcal rounded to the nearest 50.
 * - Protein 2.0 g/kg in a cut, 1.8 otherwise; fat 0.8 g/kg; carbs the remainder (carbsOf in targets.mjs).
 * - Floors: never below 1500 kcal (men) / 1200 kcal (women).
 * Output has the plan's `targets.byGoal` shape ({ goal: { dayType: { kcal, p, f } } }), so it can replace it.
 * A ±10 % estimate: recalibrate with the 7-day weight trend after 2-3 weeks. Pure: no I/O. */

import { DAY_TYPES, GOALS, carbsOf } from './targets.mjs';

export const NEAT = Object.freeze({ sedentary: 1.2, light: 1.3, active: 1.4 });

// Typical session per day type (lib/nutrition/targets.mjs: gym ~1 h, ride ~2 h, long ride > 2.5 h).
// METs are round values from the Compendium of Physical Activities (vigorous gym / run ~6, moderate road ride ~7).
export const EXERCISE = Object.freeze({
  rest: Object.freeze({ met: 1, hours: 0 }),
  gym: Object.freeze({ met: 6, hours: 1 }),
  bike: Object.freeze({ met: 7, hours: 2 }),
  bikeLong: Object.freeze({ met: 7, hours: 3.5 }),
});

const GOAL_FACTOR = Object.freeze({ maintain: 1, cut: 0.85, bulk: 1.1 });
const PROTEIN_G_KG = Object.freeze({ maintain: 1.8, cut: 2.0, bulk: 1.8 });
const FAT_G_KG = 0.8;
const FLOOR_KCAL = Object.freeze({ male: 1500, female: 1200 });

// Hard bounds (errors) and soft ranges (warnings) for an edited target.
const MAX_DEFICIT = 0.20;
const MAX_SURPLUS = 0.15;
const MAX_LOSS_PER_WEEK = 0.01; // share of body weight
const KCAL_PER_KG = 7700;
const PROTEIN_HARD = Object.freeze([1.2, 2.4]);
const PROTEIN_SOFT = Object.freeze([1.6, 2.2]);
const FAT_MIN = 0.5;
const FAT_SOFT_MAX = 1.0;
const CARBS_G_KG = Object.freeze({ rest: [3, 5], gym: [5, 7], bike: [6, 10], bikeLong: [8, 12] });

const BMI_LOW = 18.5;
const BMI_HIGH = 35;

function round50(x) {
  return Math.round(x / 50) * 50;
}

/** Whole years between an ISO birthdate and an ISO date. */
export function ageOn(birthdate, today) {
  var b = birthdate.split('-').map(Number);
  var t = today.split('-').map(Number);
  return t[0] - b[0] - (t[1] < b[1] || (t[1] === b[1] && t[2] < b[2]) ? 1 : 0);
}

export function bmi(weightKg, heightCm) {
  return weightKg / Math.pow(heightCm / 100, 2);
}

export function bmrMifflin(person) {
  return 10 * person.weightKg + 6.25 * person.heightCm - 5 * person.age + (person.sex === 'male' ? 5 : -161);
}

/** Unrounded maintenance kcal per day type. */
function maintenance(person) {
  var base = bmrMifflin(person) * NEAT[person.activity];
  var out = {};
  for (var i = 0; i < DAY_TYPES.length; i++) {
    var d = DAY_TYPES[i];
    out[d] = base + (EXERCISE[d].met - 1) * person.weightKg * EXERCISE[d].hours;
  }
  return out;
}

function inRange(v, lo, hi) {
  return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
}

/** Wizard input problems: the names of the fields out of range (empty = valid). */
export function validatePerson(person) {
  var bad = [];
  if (person.sex !== 'male' && person.sex !== 'female') bad.push('sex');
  if (!inRange(person.age, 18, 100)) bad.push('age');
  if (!inRange(person.heightCm, 120, 230)) bad.push('heightCm');
  if (!inRange(person.weightKg, 30, 250)) bad.push('weightKg');
  if (!Object.prototype.hasOwnProperty.call(NEAT, person.activity)) bad.push('activity');
  return bad;
}

/** `{ targets: { goal: { dayType: { kcal, p, f } } }, flags }`; flag `floor` = a cell was raised to the floor. */
export function computeTargets(person) {
  var m = maintenance(person);
  var floor = FLOOR_KCAL[person.sex];
  var fat = Math.round(FAT_G_KG * person.weightKg);
  var flags = [];
  var targets = {};
  for (var gi = 0; gi < GOALS.length; gi++) {
    var g = GOALS[gi];
    targets[g] = {};
    var p = Math.round(PROTEIN_G_KG[g] * person.weightKg);
    for (var di = 0; di < DAY_TYPES.length; di++) {
      var d = DAY_TYPES[di];
      var factor = g === 'cut' && d === 'bikeLong' ? 1 : GOAL_FACTOR[g];
      var kcal = round50(m[d] * factor);
      if (kcal < floor) { kcal = floor; if (flags.indexOf('floor') < 0) flags.push('floor'); }
      targets[g][d] = { kcal: kcal, p: p, f: fat };
    }
  }
  return { targets: targets, flags: flags };
}

/** Safety screen before any number is shown. `numbers: false` = show none and refer to a professional;
 * `goals` = the goals the wizard may offer; `flags` = why (minor, pregnancy, medical, eating, bmiLow, bmiHigh). */
export function screenPerson(a) {
  if (a.age < 18) return { numbers: false, goals: [], flags: ['minor'] };
  if (a.pregnant) return { numbers: false, goals: [], flags: ['pregnancy'] };
  if (a.medical) return { numbers: true, goals: ['maintain'], flags: ['medical'] };
  if (a.eatingRisk) return { numbers: true, goals: ['maintain'], flags: ['eating'] };
  var b = bmi(a.weightKg, a.heightCm);
  if (b < BMI_LOW) return { numbers: true, goals: ['maintain', 'bulk'], flags: ['bmiLow'] };
  if (b >= BMI_HIGH) return { numbers: true, goals: GOALS.slice(), flags: ['bmiHigh'] };
  return { numbers: true, goals: GOALS.slice(), flags: [] };
}

/** Target-weight problems: `targetBmiLow` (would end below BMI 18.5), `targetDirection` (a cut that does not go
 * down / a bulk that does not go up). A missing target or the maintain goal has nothing to check. */
export function checkTargetWeight(a) {
  if (a.targetWeightKg == null || a.goal === 'maintain') return [];
  var out = [];
  if (bmi(a.targetWeightKg, a.heightCm) < BMI_LOW) out.push('targetBmiLow');
  if ((a.goal === 'cut' && a.targetWeightKg >= a.weightKg) || (a.goal === 'bulk' && a.targetWeightKg <= a.weightKg)) out.push('targetDirection');
  return out;
}

/** Bounds for edited targets, against this person's computed maintenance. `errors` block saving (kcalFloor,
 * deficitMax, surplusMax, rateMax, proteinMin, proteinMax, fatMin); `warnings` only inform (proteinRange,
 * fatRange, carbsRange — carbs are checked where energy is not cut on purpose: every goal but the cut, and the
 * long ride in a cut). Each item is `{ goal, day, code }`, in goal / day-type order. */
export function checkTargets(targets, person) {
  var m = maintenance(person);
  var kg = person.weightKg;
  var floor = FLOOR_KCAL[person.sex];
  var errors = [];
  var warnings = [];
  for (var gi = 0; gi < GOALS.length; gi++) {
    var g = GOALS[gi];
    for (var di = 0; di < DAY_TYPES.length; di++) {
      var d = DAY_TYPES[di];
      var t = targets[g][d];
      var pkg = t.p / kg;
      var fkg = t.f / kg;
      var deficit = m[d] - t.kcal;
      if (t.kcal < floor) errors.push({ goal: g, day: d, code: 'kcalFloor' });
      if (deficit > MAX_DEFICIT * m[d]) errors.push({ goal: g, day: d, code: 'deficitMax' });
      if (-deficit > MAX_SURPLUS * m[d]) errors.push({ goal: g, day: d, code: 'surplusMax' });
      if (deficit > 0 && (deficit * 7) / KCAL_PER_KG > MAX_LOSS_PER_WEEK * kg) errors.push({ goal: g, day: d, code: 'rateMax' });
      if (pkg < PROTEIN_HARD[0]) errors.push({ goal: g, day: d, code: 'proteinMin' });
      if (pkg > PROTEIN_HARD[1]) errors.push({ goal: g, day: d, code: 'proteinMax' });
      if (fkg < FAT_MIN) errors.push({ goal: g, day: d, code: 'fatMin' });
      if (pkg < PROTEIN_SOFT[0] || pkg > PROTEIN_SOFT[1]) warnings.push({ goal: g, day: d, code: 'proteinRange' });
      if (fkg > FAT_SOFT_MAX) warnings.push({ goal: g, day: d, code: 'fatRange' });
      if (g !== 'cut' || d === 'bikeLong') {
        var ckg = carbsOf(t) / kg;
        var r = CARBS_G_KG[d];
        if (ckg < r[0] || ckg > r[1]) warnings.push({ goal: g, day: d, code: 'carbsRange' });
      }
    }
  }
  return { errors: errors, warnings: warnings };
}

/** What lib/nutrition/client.mjs emits as the page's `var HC_ENERGY` (the in-page onboarding,
 * web/src/client/onboarding.js): this module's own function source (classicGlobal), so the wizard's numbers
 * and bounds are the build's. */
export const CLIENT = {
  consts: { NEAT, EXERCISE },
  hidden: {
    DAY_TYPES, GOALS, GOAL_FACTOR, PROTEIN_G_KG, FAT_G_KG, FLOOR_KCAL, MAX_DEFICIT, MAX_SURPLUS, MAX_LOSS_PER_WEEK,
    KCAL_PER_KG, PROTEIN_HARD, PROTEIN_SOFT, FAT_MIN, FAT_SOFT_MAX, CARBS_G_KG, BMI_LOW, BMI_HIGH,
  },
  fns: { round50, ageOn, bmi, bmrMifflin, maintenance, inRange, validatePerson, computeTargets, screenPerson, checkTargetWeight, checkTargets, carbsOf },
};
