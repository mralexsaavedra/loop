/* The in-page onboarding document (GET /food/profile on the LAN ingest service, sql/011_profile.sql):
 * the profile a user entered without an AI coach and the nutrition targets they accepted. The host sync
 * (scripts/sync-onboarding.mjs) writes it to loop-data/profile/onboarding.json; the build reads it there.
 * normalizeOnboarding is the SHAPE check both share; the service validates the same vocabularies and bounds from
 * a GENERATED copy of SERVER below (scripts/gen-profile-rules.mjs writes services/loop-ingest/src/profile-rules.js).
 * The build bounds the targets with lib/nutrition/energy.mjs checkTargets before using them. Pure: no I/O. */

import { DAY_TYPES, GOALS, FILL_FROM_GYM } from '../nutrition/targets.mjs';
import { SEXES, NEAT, SPORTS, SPORT_MINUTES, SPORT_PER_WEEK, AGE_RANGE, HEIGHT_CM_RANGE, WEIGHT_KG_RANGE, validatePerson } from '../nutrition/energy.mjs';
import { isIsoDate } from '../date.mjs';

export const ONBOARDING_JSON = 'onboarding.json';

/** One sport the person does: minutes per session (SPORT_MINUTES) and sessions per week (SPORT_PER_WEEK).
 * @typedef {{ sport: string, minutes: number, perWeek: number }} SportSessions */
/** The daily target of one goal and day type: kcal, protein g, fat g (carbs follow from them).
 * @typedef {{ kcal: number, p: number, f: number }} TargetCell */
/** The checked onboarding document (normalizeOnboarding): the person, their sports and the accepted targets,
 * every goal x every day type (lib/nutrition/targets.mjs GOALS, DAY_TYPES; a profile saved before the
 * FILL_FROM_GYM day types gets them back-filled from its gym cell).
 * @typedef {{ name?: string, sex: 'male' | 'female', birthdate: string, heightCm: number, weightKg: number,
 *   activity: 'sedentary' | 'light' | 'active', sports?: SportSessions[], goals: string[],
 *   targets: Record<string, Record<string, TargetCell>>, updatedAt?: string }} OnboardingProfile */

/** What scripts/gen-profile-rules.mjs emits as the ingest service's src/profile-rules.js (the service is built
 * from its own directory and cannot import lib/): the profile document's vocabularies and inclusive [min, max]
 * bounds, taken from lib/nutrition/energy.mjs and lib/nutrition/targets.mjs, which stay authoritative. */
export const SERVER = {
  consts: {
    PROFILE_SEX: SEXES,
    PROFILE_ACTIVITY: Object.freeze(Object.keys(NEAT)),
    PROFILE_SPORTS: Object.freeze(Object.keys(SPORTS)),
    PROFILE_DAY_TYPES: DAY_TYPES,
    // a profile saved before these day types has no cell for them: each takes that goal's gym cell
    PROFILE_FILL_FROM_GYM: FILL_FROM_GYM,
    PROFILE_LIMITS: Object.freeze({
      age: AGE_RANGE, heightCm: HEIGHT_CM_RANGE, weightKg: WEIGHT_KG_RANGE,
      sportMinutes: SPORT_MINUTES, sportPerWeek: SPORT_PER_WEEK,
    }),
  },
};

const KEYS = ['name', 'sex', 'birthdate', 'heightCm', 'weightKg', 'activity', 'sports', 'goals', 'targets', 'updatedAt'];
const isObj = (/** @type {unknown} */ v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isNum = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v);
/** @type {(what: string) => never} */
const fail = (what) => { throw new Error(`unexpected onboarding document: ${what}`); };
/** @param {unknown} v @param {number} lo @param {number} hi */
const isInt = (v, lo, hi) => Number.isInteger(v) && /** @type {number} */ (v) >= lo && /** @type {number} */ (v) <= hi;

/** The optional sports list (lib/nutrition/energy.mjs SPORTS): one {sport, minutes, perWeek} per sport.
 * @param {any} v the body's `sports` (untrusted until checked)
 * @returns {SportSessions[]} */
function normalizeSports(v) {
  if (!Array.isArray(v)) fail('sports');
  /** @type {Set<string>} */
  const seen = new Set();
  return v.map((/** @type {any} */ s) => {
    if (!isObj(s) || Object.keys(s).some((k) => !['sport', 'minutes', 'perWeek'].includes(k))) fail('sports');
    if (!Object.hasOwn(SPORTS, s.sport) || seen.has(s.sport) || !isInt(s.minutes, SPORT_MINUTES[0], SPORT_MINUTES[1]) || !isInt(s.perWeek, SPORT_PER_WEEK[0], SPORT_PER_WEEK[1])) fail('sports');
    seen.add(s.sport);
    return { sport: s.sport, minutes: s.minutes, perWeek: s.perWeek };
  });
}

/** The `{profile}` body reduced to a checked document, or null when the wizard was never completed; throws
 * when malformed (the sync then keeps the previous file).
 * @param {any} body the parsed GET /food/profile answer (untrusted until checked) @returns {OnboardingProfile | null} */
export function normalizeOnboarding(body) {
  if (!isObj(body) || !('profile' in body)) fail('expected {profile: ...}');
  const p = body.profile;
  if (p === null) return null;
  if (!isObj(p)) fail('profile');
  for (const k of Object.keys(p)) if (!KEYS.includes(k)) fail(k);
  if (p.name != null && (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60)) fail('name');
  if (!SEXES.includes(p.sex)) fail('sex');
  if (!isIsoDate(p.birthdate)) fail('birthdate');
  // height and weight within the page wizard's own bounds (lib/nutrition/energy.mjs validatePerson, the
  // function the page runs): only those two fields are judged here, the other probe values are valid
  const bounds = validatePerson({ sex: 'female', age: 30, heightCm: p.heightCm, weightKg: p.weightKg, activity: 'light' });
  if (!isNum(p.heightCm) || bounds.includes('heightCm')) fail('heightCm');
  if (!isNum(p.weightKg) || bounds.includes('weightKg')) fail('weightKg');
  if (!Object.hasOwn(NEAT, p.activity)) fail('activity');
  const sports = p.sports === undefined ? undefined : normalizeSports(p.sports);
  if (!Array.isArray(p.goals) || !p.goals.length || !p.goals.every((/** @type {any} */ g) => GOALS.includes(g)) || new Set(p.goals).size !== p.goals.length) fail('goals');
  if (!isObj(p.targets)) fail('targets');
  /** @type {Record<string, Record<string, TargetCell>>} */
  const targets = {};
  for (const g of GOALS) {
    if (!isObj(p.targets[g])) fail(`targets.${g}`);
    targets[g] = {};
    for (const d of DAY_TYPES) {
      // a profile saved before hybrid / indoor / run: the missing cell is that goal's gym cell (checked before it)
      const c = p.targets[g][d] === undefined && FILL_FROM_GYM.includes(d) ? targets[g].gym : p.targets[g][d];
      if (!isObj(c) || !isNum(c.kcal) || !isNum(c.p) || !isNum(c.f)) fail(`targets.${g}.${d}`);
      targets[g][d] = { kcal: c.kcal, p: c.p, f: c.f };
    }
  }
  if (p.updatedAt != null && (typeof p.updatedAt !== 'string' || Number.isNaN(Date.parse(p.updatedAt)))) fail('updatedAt');
  /** @type {OnboardingProfile} */
  const out = /** @type {OnboardingProfile} */ ({});
  if (p.name != null) out.name = p.name.trim();
  Object.assign(out, {
    sex: p.sex, birthdate: p.birthdate, heightCm: p.heightCm, weightKg: p.weightKg, activity: p.activity,
    goals: [...p.goals], targets,
  });
  if (sports) out.sports = sports;
  if (p.updatedAt != null) out.updatedAt = p.updatedAt;
  return out;
}
