/* Starting nutrition targets computed from a person (the in-page onboarding, for users without an AI coach).
 *
 * Method (analysis/methodology.md §1-§3 + "Safety bounds", reviewed by the nutrition coach):
 * - BMR: Mifflin-St Jeor.
 * - A day = BMR x NEAT (activity outside training) + the NET exercise of its day type, (MET - 1) x kg x hours
 *   (the BMR already pays the first MET). The exercise is EXERCISE, or the person's own sports (exerciseFor). One base for every day type, so exercise is never counted twice.
 * - Goals: maintain = that TDEE; cut = -15 % on rest / gym / bike days, the long ride kept at maintenance
 *   (fuel the long sessions); bulk = +10 %. kcal rounded to the nearest 50.
 * - Protein 2.0 g/kg in a cut, 1.8 otherwise; fat 0.8 g/kg; carbs the remainder (carbsOf in targets.mjs). The kg are a
 *   REFERENCE weight (referenceKg): the current weight up to BMI 25, above it the weight at BMI 25 — fat-free mass,
 *   not fat, drives protein needs, so a high body weight no longer inflates protein and fat and starves carbs. Fat
 *   never drops below 0.5 g per kg of CURRENT weight (hormonal floor, analysis/methodology.md).
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

// The sports a person can pick (the onboarding), with round Compendium METs: strength training ~6, running ~9
// (about 10 km/h), road cycling ~7, swimming laps ~7, HYROX / CrossFit-style circuits ~8, team sports ~7,
// yoga / pilates ~3, anything else ~5. A session maps to a day type by its length (dayTypeOfMinutes), so the four
// internal day types read as rest / short / long / very long for everyone.
export const SPORTS = Object.freeze({ strength: 6, running: 9, cycling: 7, swimming: 7, hybrid: 8, team: 7, yoga: 3, other: 5 });
const SPORT_MINUTES = Object.freeze([15, 600]);
const SPORT_PER_WEEK = Object.freeze([1, 14]);
const LONG_MIN = 75; // lib/nutrition/daytype.mjs DETECT.bikeMin
const VERY_LONG_MIN = 150; // DETECT.bikeLongMin

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
const BMI_REF = 25; // above it, protein and fat follow the weight at this BMI
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

/** The weight protein and fat are set on: the current weight up to BMI 25, the weight at BMI 25 above it. */
export function referenceKg(person) {
  var atRef = Math.round(BMI_REF * Math.pow(person.heightCm / 100, 2) * 100) / 100; // to 10 g, no float noise
  return person.weightKg > atRef ? atRef : person.weightKg;
}

export function bmrMifflin(person) {
  return 10 * person.weightKg + 6.25 * person.heightCm - 5 * person.age + (person.sex === 'male' ? 5 : -161);
}

/** The day type a session of this length fills: short (gym) < 75 min <= long (bike) < 150 min <= very long. */
export function dayTypeOfMinutes(minutes) {
  return minutes < LONG_MIN ? 'gym' : minutes < VERY_LONG_MIN ? 'bike' : 'bikeLong';
}

function isInt(v, lo, hi) {
  return typeof v === 'number' && Math.floor(v) === v && v >= lo && v <= hi;
}

/** A well-formed sports list: `[{ sport, minutes, perWeek }]`, one entry per sport (empty is fine). */
function validSports(sports) {
  if (!Array.isArray(sports)) return false;
  var seen = {};
  for (var i = 0; i < sports.length; i++) {
    var s = sports[i];
    if (s == null || typeof s !== 'object' || !Object.prototype.hasOwnProperty.call(SPORTS, s.sport) || seen[s.sport]) return false;
    if (!isInt(s.minutes, SPORT_MINUTES[0], SPORT_MINUTES[1]) || !isInt(s.perWeek, SPORT_PER_WEEK[0], SPORT_PER_WEEK[1])) return false;
    seen[s.sport] = true;
  }
  return true;
}

/** The exercise table for a person's sports: each day type their sessions reach gets the time-weighted MET and
 * the average session length of those sessions; day types they never reach keep EXERCISE (no sports = EXERCISE). */
export function exerciseFor(sports) {
  if (!sports || !sports.length) return EXERCISE;
  var acc = {};
  for (var i = 0; i < sports.length; i++) {
    var s = sports[i];
    var d = dayTypeOfMinutes(s.minutes);
    var a = acc[d] || (acc[d] = { metMin: 0, min: 0, n: 0 });
    a.metMin += SPORTS[s.sport] * s.minutes * s.perWeek;
    a.min += s.minutes * s.perWeek;
    a.n += s.perWeek;
  }
  var out = {};
  for (var j = 0; j < DAY_TYPES.length; j++) {
    var k = DAY_TYPES[j];
    var b = acc[k];
    out[k] = b ? { met: Math.round((b.metMin / b.min) * 10) / 10, hours: Math.round((b.min / b.n / 60) * 100) / 100 } : EXERCISE[k];
  }
  return out;
}

/** The day types this person's week has: rest plus the ones their sports reach, in day-type order (no sports =
 * all four, the plan's default). */
export function usedDayTypes(sports) {
  if (!sports || !sports.length) return DAY_TYPES;
  var hit = { rest: true };
  for (var i = 0; i < sports.length; i++) hit[dayTypeOfMinutes(sports[i].minutes)] = true;
  return DAY_TYPES.filter(function (d) { return hit[d]; });
}

/** Unrounded maintenance kcal per day type. */
function maintenance(person) {
  var base = bmrMifflin(person) * NEAT[person.activity];
  var ex = exerciseFor(person.sports);
  var out = {};
  for (var i = 0; i < DAY_TYPES.length; i++) {
    var d = DAY_TYPES[i];
    out[d] = base + (ex[d].met - 1) * person.weightKg * ex[d].hours;
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
  if (person.sports !== undefined && !validSports(person.sports)) bad.push('sports');
  return bad;
}

/** `{ targets: { goal: { dayType: { kcal, p, f } } }, flags }`; flag `floor` = a cell was raised to the floor. */
export function computeTargets(person) {
  var m = maintenance(person);
  var floor = FLOOR_KCAL[person.sex];
  var ref = referenceKg(person);
  var fat = Math.round(Math.max(FAT_G_KG * ref, FAT_MIN * person.weightKg));
  var flags = [];
  var targets = {};
  for (var gi = 0; gi < GOALS.length; gi++) {
    var g = GOALS[gi];
    targets[g] = {};
    var p = Math.round(PROTEIN_G_KG[g] * ref);
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
  var ref = referenceKg(person);
  var floor = FLOOR_KCAL[person.sex];
  var errors = [];
  var warnings = [];
  for (var gi = 0; gi < GOALS.length; gi++) {
    var g = GOALS[gi];
    for (var di = 0; di < DAY_TYPES.length; di++) {
      var d = DAY_TYPES[di];
      var t = targets[g][d];
      var pkg = t.p / ref; // protein, fat range and carbs per REFERENCE kg; the fat floor per current kg
      var fkg = t.f / ref;
      var deficit = m[d] - t.kcal;
      if (t.kcal < floor) errors.push({ goal: g, day: d, code: 'kcalFloor' });
      if (deficit > MAX_DEFICIT * m[d]) errors.push({ goal: g, day: d, code: 'deficitMax' });
      if (-deficit > MAX_SURPLUS * m[d]) errors.push({ goal: g, day: d, code: 'surplusMax' });
      if (deficit > 0 && (deficit * 7) / KCAL_PER_KG > MAX_LOSS_PER_WEEK * kg) errors.push({ goal: g, day: d, code: 'rateMax' });
      if (pkg < PROTEIN_HARD[0]) errors.push({ goal: g, day: d, code: 'proteinMin' });
      if (pkg > PROTEIN_HARD[1]) errors.push({ goal: g, day: d, code: 'proteinMax' });
      if (t.f / kg < FAT_MIN) errors.push({ goal: g, day: d, code: 'fatMin' });
      if (pkg < PROTEIN_SOFT[0] || pkg > PROTEIN_SOFT[1]) warnings.push({ goal: g, day: d, code: 'proteinRange' });
      if (fkg > FAT_SOFT_MAX) warnings.push({ goal: g, day: d, code: 'fatRange' });
      if (g !== 'cut' || d === 'bikeLong') {
        var ckg = carbsOf(t) / ref;
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
  consts: { NEAT, EXERCISE, SPORTS },
  hidden: {
    DAY_TYPES, GOALS, GOAL_FACTOR, PROTEIN_G_KG, FAT_G_KG, FLOOR_KCAL, MAX_DEFICIT, MAX_SURPLUS, MAX_LOSS_PER_WEEK,
    KCAL_PER_KG, PROTEIN_HARD, PROTEIN_SOFT, FAT_MIN, FAT_SOFT_MAX, CARBS_G_KG, BMI_LOW, BMI_HIGH, BMI_REF,
    SPORT_MINUTES, SPORT_PER_WEEK, LONG_MIN, VERY_LONG_MIN,
  },
  fns: { round50, ageOn, bmi, referenceKg, bmrMifflin, dayTypeOfMinutes, isInt, validSports, exerciseFor, usedDayTypes, maintenance, inRange, validatePerson, computeTargets, screenPerson, checkTargetWeight, checkTargets, carbsOf },
};
