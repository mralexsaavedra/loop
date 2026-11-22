/**
 * The bodies of PUT /food/settings and PUT /food/profile (routes in food.js). The settings live in their own
 * optional migration group (sql/007_settings.sql + 013), the profile in its own (sql/011, sql/012: profile-db.js).
 *
 * The profile's vocabularies and person bounds come from profile-rules.js, GENERATED from
 * lib/profile/onboarding.mjs (the service is built from its own directory and cannot import lib/). The target
 * cells keep coarse bounds only: the host sync and the build re-check them against lib/nutrition/energy.mjs.
 */
import { FOOD_LIMITS as L, SETTINGS_GOALS } from './food-calc.js'
import { PROFILE_SEX, PROFILE_ACTIVITY, PROFILE_SPORTS, PROFILE_DAY_TYPES, PROFILE_LIMITS } from './profile-rules.js'
import { bad, strictKeys, str, number, oneOf } from './validate.js'

// the page languages (GET / PUT /food/settings `locale`, sql/013_settings_locale.sql CHECK, web/src/env.mjs)
export const SETTINGS_LOCALES = Object.freeze(['es', 'en'])

/** {goal?, targetWeightKg?, locale?}: at least one key; the goal is one of the plan goals, the target weight a
 * number of kg (1 decimal) within FOOD_LIMITS, or null to clear it; the locale (the page language the build uses)
 * es or en, or null to clear it. Only the keys sent are changed. */
export function validateSettings (body) {
  strictKeys(body, ['goal', 'targetWeightKg', 'locale'])
  const out = {}
  if ('goal' in body) out.goal = oneOf(body.goal, 'goal', SETTINGS_GOALS)
  if ('targetWeightKg' in body) {
    out.targetWeightKg = body.targetWeightKg === null
      ? null
      : number(body.targetWeightKg, 'targetWeightKg', { min: L.targetWeightMin, max: L.targetWeightMax })
  }
  if ('locale' in body) out.locale = body.locale === null ? null : oneOf(body.locale, 'locale', SETTINGS_LOCALES)
  if (!Object.keys(out).length) bad('body')
  return out
}

/** The optional sports list: [{sport, minutes, perWeek}] within PROFILE_LIMITS, one entry per sport; any fault = 'sports'. */
function profileSports (v) {
  const ok = (/** @type {unknown} */ x, /** @type {readonly number[]} */ [lo, hi]) => Number.isInteger(x) && Number(x) >= lo && Number(x) <= hi
  if (!Array.isArray(v) || v.length > PROFILE_SPORTS.length) bad('sports')
  const seen = new Set()
  return v.map((s) => {
    if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).some((k) => !['sport', 'minutes', 'perWeek'].includes(k))) bad('sports')
    if (!PROFILE_SPORTS.includes(s.sport) || seen.has(s.sport) || !ok(s.minutes, PROFILE_LIMITS.sportMinutes) || !ok(s.perWeek, PROFILE_LIMITS.sportPerWeek)) bad('sports')
    seen.add(s.sport)
    return { sport: s.sport, minutes: s.minutes, perWeek: s.perWeek }
  })
}

/** A real YYYY-MM-DD calendar date from 1900 on (validDate is for log dates, 2000-2100), else null. */
function birthDate (v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const [y, m, d] = v.split('-').map(Number)
  return y >= 1900 && new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === v ? v : null
}

/** Whole years from an ISO birthdate to the instant `nowMs` (UTC calendar). */
function ageAt (birthdate, nowMs) {
  const [by, bm, bd] = birthdate.split('-').map(Number)
  const t = new Date(nowMs)
  const ty = t.getUTCFullYear(); const tm = t.getUTCMonth() + 1; const td = t.getUTCDate()
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0)
}

/** The whole onboarding document: {name?, sex, birthdate (adult), heightCm, weightKg, activity, sports?, goals (the
 * goals the safety screen allowed), targets {goal: {dayType: {kcal, p, f}}} (all twelve cells)}. */
export function validateProfile (body, nowMs = Date.now()) {
  strictKeys(body, ['name', 'sex', 'birthdate', 'heightCm', 'weightKg', 'activity', 'sports', 'goals', 'targets'])
  const out = {}
  const name = str(body.name, 'name', 60, true)
  if (name !== null) out.name = name
  out.sex = oneOf(body.sex, 'sex', PROFILE_SEX)
  out.birthdate = birthDate(body.birthdate) ?? bad('birthdate')
  const age = ageAt(out.birthdate, nowMs)
  if (age < PROFILE_LIMITS.age[0] || age > PROFILE_LIMITS.age[1]) bad('birthdate')
  out.heightCm = number(body.heightCm, 'heightCm', { min: PROFILE_LIMITS.heightCm[0], max: PROFILE_LIMITS.heightCm[1] })
  out.weightKg = number(body.weightKg, 'weightKg', { min: PROFILE_LIMITS.weightKg[0], max: PROFILE_LIMITS.weightKg[1] })
  out.activity = oneOf(body.activity, 'activity', PROFILE_ACTIVITY)
  if (body.sports !== undefined) out.sports = profileSports(body.sports)
  if (!Array.isArray(body.goals) || !body.goals.length || new Set(body.goals).size !== body.goals.length) bad('goals')
  for (const g of body.goals) oneOf(g, 'goals', SETTINGS_GOALS)
  out.goals = [...body.goals]
  strictKeys(body.targets, SETTINGS_GOALS, 'targets.')
  out.targets = {}
  for (const g of SETTINGS_GOALS) {
    strictKeys(body.targets[g], PROFILE_DAY_TYPES, `targets.${g}.`)
    out.targets[g] = {}
    for (const d of PROFILE_DAY_TYPES) {
      const at = `targets.${g}.${d}`
      const c = body.targets[g][d]
      strictKeys(c, ['kcal', 'p', 'f'], `${at}.`)
      out.targets[g][d] = {
        kcal: number(c.kcal, `${at}.kcal`, { min: 800, max: 6000, integer: true }),
        p: number(c.p, `${at}.p`, { min: 20, max: 400, integer: true }),
        f: number(c.f, `${at}.f`, { min: 10, max: 300, integer: true })
      }
    }
  }
  return out
}
