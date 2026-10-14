/* The in-page onboarding document (GET /food/profile on the LAN ingest service, sql/011_profile.sql):
 * the profile a user entered without an AI coach and the nutrition targets they accepted. The host sync
 * (data/profile/sync-onboarding.mjs) writes it to data/profile/onboarding.json; the build reads it there.
 * normalizeOnboarding is the shape check both share (the service validates its own copy of the rules;
 * the bounds of the targets are lib/nutrition/energy.mjs checkTargets). Pure: no I/O. */

import { DAY_TYPES, GOALS } from '../nutrition/targets.mjs';
import { NEAT } from '../nutrition/energy.mjs';

export const ONBOARDING_JSON = 'onboarding.json';

const KEYS = ['name', 'sex', 'birthdate', 'heightCm', 'weightKg', 'activity', 'goals', 'targets', 'updatedAt'];
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fail = (what) => { throw new Error(`unexpected onboarding document: ${what}`); };

function realDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === v;
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
  if (!realDate(p.birthdate)) fail('birthdate');
  if (!isNum(p.heightCm)) fail('heightCm');
  if (!isNum(p.weightKg)) fail('weightKg');
  if (!Object.hasOwn(NEAT, p.activity)) fail('activity');
  if (!Array.isArray(p.goals) || !p.goals.length || !p.goals.every((g) => GOALS.includes(g))) fail('goals');
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
  if (p.updatedAt != null) out.updatedAt = p.updatedAt;
  return out;
}
