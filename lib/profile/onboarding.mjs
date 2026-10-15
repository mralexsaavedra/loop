/* The in-page onboarding document (GET /food/profile on the LAN ingest service, sql/011_profile.sql):
 * the profile a user entered without an AI coach and the nutrition targets they accepted. The host sync
 * (scripts/sync-onboarding.mjs) writes it to data/profile/onboarding.json; the build reads it there.
 * normalizeOnboarding is the SHAPE check both share (the service validates its own copy of the rules); the
 * build bounds the targets with lib/nutrition/energy.mjs checkTargets before using them. Pure: no I/O. */

import { DAY_TYPES, GOALS } from '../nutrition/targets.mjs';
import { NEAT, SPORTS, validatePerson } from '../nutrition/energy.mjs';
import { isIsoDate } from '../date.mjs';

export const ONBOARDING_JSON = 'onboarding.json';

const KEYS = ['name', 'sex', 'birthdate', 'heightCm', 'weightKg', 'activity', 'sports', 'goals', 'targets', 'updatedAt'];
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fail = (what) => { throw new Error(`unexpected onboarding document: ${what}`); };
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** The optional sports list (lib/nutrition/energy.mjs SPORTS): one {sport, minutes, perWeek} per sport. */
function normalizeSports(v) {
  if (!Array.isArray(v)) fail('sports');
  const seen = new Set();
  return v.map((s) => {
    if (!isObj(s) || Object.keys(s).some((k) => !['sport', 'minutes', 'perWeek'].includes(k))) fail('sports');
    if (!Object.hasOwn(SPORTS, s.sport) || seen.has(s.sport) || !isInt(s.minutes, 15, 600) || !isInt(s.perWeek, 1, 14)) fail('sports');
    seen.add(s.sport);
    return { sport: s.sport, minutes: s.minutes, perWeek: s.perWeek };
  });
}

/** The `{profile}` body reduced to a checked document, or null when the wizard was never completed; throws
 * when malformed (the sync then keeps the previous file). */
export function normalizeOnboarding(body) {
  if (!isObj(body) || !('profile' in body)) fail('expected {profile: ...}');
  const p = body.profile;
  if (p === null) return null;
  if (!isObj(p)) fail('profile');
  for (const k of Object.keys(p)) if (!KEYS.includes(k)) fail(k);
  if (p.name != null && (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60)) fail('name');
  if (p.sex !== 'male' && p.sex !== 'female') fail('sex');
  if (!isIsoDate(p.birthdate)) fail('birthdate');
  // height and weight within the page wizard's own bounds (lib/nutrition/energy.mjs validatePerson, the
  // function the page runs): only those two fields are judged here, the other probe values are valid
  const bounds = validatePerson({ sex: 'female', age: 30, heightCm: p.heightCm, weightKg: p.weightKg, activity: 'light' });
  if (!isNum(p.heightCm) || bounds.includes('heightCm')) fail('heightCm');
  if (!isNum(p.weightKg) || bounds.includes('weightKg')) fail('weightKg');
  if (!Object.hasOwn(NEAT, p.activity)) fail('activity');
  const sports = p.sports === undefined ? undefined : normalizeSports(p.sports);
  if (!Array.isArray(p.goals) || !p.goals.length || !p.goals.every((g) => GOALS.includes(g)) || new Set(p.goals).size !== p.goals.length) fail('goals');
  if (!isObj(p.targets)) fail('targets');
  const targets = {};
  for (const g of GOALS) {
    if (!isObj(p.targets[g])) fail(`targets.${g}`);
    targets[g] = {};
    for (const d of DAY_TYPES) {
      const c = p.targets[g][d];
      if (!isObj(c) || !isNum(c.kcal) || !isNum(c.p) || !isNum(c.f)) fail(`targets.${g}.${d}`);
      targets[g][d] = { kcal: c.kcal, p: c.p, f: c.f };
    }
  }
  if (p.updatedAt != null && (typeof p.updatedAt !== 'string' || Number.isNaN(Date.parse(p.updatedAt)))) fail('updatedAt');
  const out = {};
  if (p.name != null) out.name = p.name.trim();
  Object.assign(out, {
    sex: p.sex, birthdate: p.birthdate, heightCm: p.heightCm, weightKg: p.weightKg, activity: p.activity,
    goals: [...p.goals], targets,
  });
  if (sports) out.sports = sports;
  if (p.updatedAt != null) out.updatedAt = p.updatedAt;
  return out;
}
