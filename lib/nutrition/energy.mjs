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

const round50 = (x) => Math.round(x / 50) * 50;

/** Whole years between an ISO birthdate and an ISO date. */
export function ageOn(birthdate, today) {
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export function bmi(weightKg, heightCm) {
  return weightKg / (heightCm / 100) ** 2;
}

export function bmrMifflin({ sex, age, heightCm, weightKg }) {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

/** Unrounded maintenance kcal per day type. */
function maintenance(person) {
  const base = bmrMifflin(person) * NEAT[person.activity];
  const out = {};
  for (const d of DAY_TYPES) out[d] = base + (EXERCISE[d].met - 1) * person.weightKg * EXERCISE[d].hours;
  return out;
}

/** Wizard input problems: the names of the fields out of range (empty = valid). */
export function validatePerson({ sex, age, heightCm, weightKg, activity }) {
  const bad = [];
  if (sex !== 'male' && sex !== 'female') bad.push('sex');
  if (!(Number.isFinite(age) && age >= 18 && age <= 100)) bad.push('age');
  if (!(Number.isFinite(heightCm) && heightCm >= 120 && heightCm <= 230)) bad.push('heightCm');
  if (!(Number.isFinite(weightKg) && weightKg >= 30 && weightKg <= 250)) bad.push('weightKg');
  if (!Object.hasOwn(NEAT, activity)) bad.push('activity');
  return bad;
}

/** `{ targets: { goal: { dayType: { kcal, p, f } } }, flags }`; flag `floor` = a cell was raised to the floor. */
export function computeTargets(person) {
  const m = maintenance(person);
  const floor = FLOOR_KCAL[person.sex];
  const fat = Math.round(FAT_G_KG * person.weightKg);
  const flags = [];
  const targets = {};
  for (const g of GOALS) {
    targets[g] = {};
    const p = Math.round(PROTEIN_G_KG[g] * person.weightKg);
    for (const d of DAY_TYPES) {
      const factor = g === 'cut' && d === 'bikeLong' ? 1 : GOAL_FACTOR[g];
      let kcal = round50(m[d] * factor);
      if (kcal < floor) { kcal = floor; if (!flags.includes('floor')) flags.push('floor'); }
      targets[g][d] = { kcal, p, f: fat };
    }
  }
  return { targets, flags };
}

/** Safety screen before any number is shown. `numbers: false` = show none and refer to a professional;
 * `goals` = the goals the wizard may offer; `flags` = why (minor, pregnancy, medical, eating, bmiLow, bmiHigh). */
export function screenPerson({ age, pregnant, medical, eatingRisk, heightCm, weightKg }) {
  if (age < 18) return { numbers: false, goals: [], flags: ['minor'] };
  if (pregnant) return { numbers: false, goals: [], flags: ['pregnancy'] };
  if (medical) return { numbers: true, goals: ['maintain'], flags: ['medical'] };
  if (eatingRisk) return { numbers: true, goals: ['maintain'], flags: ['eating'] };
  const b = bmi(weightKg, heightCm);
  if (b < BMI_LOW) return { numbers: true, goals: ['maintain', 'bulk'], flags: ['bmiLow'] };
  if (b >= BMI_HIGH) return { numbers: true, goals: [...GOALS], flags: ['bmiHigh'] };
  return { numbers: true, goals: [...GOALS], flags: [] };
}

/** Target-weight problems: `targetBmiLow` (would end below BMI 18.5), `targetDirection` (a cut that does not go
 * down / a bulk that does not go up). A missing target or the maintain goal has nothing to check. */
export function checkTargetWeight({ heightCm, weightKg, goal, targetWeightKg }) {
  if (targetWeightKg == null || goal === 'maintain') return [];
  const out = [];
  if (bmi(targetWeightKg, heightCm) < BMI_LOW) out.push('targetBmiLow');
  if ((goal === 'cut' && targetWeightKg >= weightKg) || (goal === 'bulk' && targetWeightKg <= weightKg)) out.push('targetDirection');
  return out;
}

/** Bounds for edited targets, against this person's computed maintenance. `errors` block saving (kcalFloor,
 * deficitMax, surplusMax, rateMax, proteinMin, proteinMax, fatMin); `warnings` only inform (proteinRange,
 * fatRange, carbsRange — carbs are checked where energy is not cut on purpose: every goal but the cut, and the
 * long ride in a cut). Each item is `{ goal, day, code }`, in goal / day-type order. */
export function checkTargets(targets, person) {
  const m = maintenance(person);
  const kg = person.weightKg;
  const floor = FLOOR_KCAL[person.sex];
  const errors = [];
  const warnings = [];
  for (const g of GOALS) {
    for (const d of DAY_TYPES) {
      const t = targets[g][d];
      const at = (code) => ({ goal: g, day: d, code });
      const pkg = t.p / kg;
      const fkg = t.f / kg;
      if (t.kcal < floor) errors.push(at('kcalFloor'));
      const deficit = m[d] - t.kcal;
      if (deficit > MAX_DEFICIT * m[d]) errors.push(at('deficitMax'));
      if (-deficit > MAX_SURPLUS * m[d]) errors.push(at('surplusMax'));
      if (deficit > 0 && (deficit * 7) / KCAL_PER_KG > MAX_LOSS_PER_WEEK * kg) errors.push(at('rateMax'));
      if (pkg < PROTEIN_HARD[0]) errors.push(at('proteinMin'));
      if (pkg > PROTEIN_HARD[1]) errors.push(at('proteinMax'));
      if (fkg < FAT_MIN) errors.push(at('fatMin'));
      if (pkg < PROTEIN_SOFT[0] || pkg > PROTEIN_SOFT[1]) warnings.push(at('proteinRange'));
      if (fkg > FAT_SOFT_MAX) warnings.push(at('fatRange'));
      if (g !== 'cut' || d === 'bikeLong') {
        const ckg = carbsOf(t) / kg;
        const [lo, hi] = CARBS_G_KG[d];
        if (ckg < lo || ckg > hi) warnings.push(at('carbsRange'));
      }
    }
  }
  return { errors, warnings };
}
