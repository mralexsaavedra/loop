/* Salud "Healthspan habits": the habits WHOOP folds into one "WHOOP age", kept apart and NEVER folded into
 * an age (that needs weights nobody publishes). Each habit = the last HABIT_DAYS full days (the days
 * before asOf, which is still filling up) against a published reference or the user's own baseline:
 *   - sleep: mean hours per night vs ≥ 7 h — Watson NF et al., "Recommended Amount of Sleep for a Healthy
 *     Adult: A Joint Consensus Statement of the AASM and SRS", J Clin Sleep Med 2015;11(6):591–592
 *     (https://pubmed.ncbi.nlm.nih.gov/25979105/): "7 or more hours per night on a regular basis".
 *   - activity: minutes per week vs 150–300 moderate (or 75–150 vigorous, i.e. vigorous counts double) —
 *     Bull FC et al., "WHO 2020 guidelines on physical activity and sedentary behaviour", Br J Sports Med
 *     2020;54:1451–1462 (https://pmc.ncbi.nlm.nih.gov/articles/PMC7719906/), Table 4. The WHO defines
 *     intensity in METs; heart-rate zones are an APPROXIMATION (stated on the page): zones 2–3 (60–80 % of
 *     max HR, lib/training/hr-zones.mjs) count as moderate, zones 4–5 (≥ 80 %) as vigorous, zone 1 not at
 *     all. Minutes from the all-day heart rate + each workout's zones (lib/score/strain.mjs zoneMinutes),
 *     scaled to a week over the days with all-day heart rate.
 *   - strength: days per week with a gym session vs ≥ 2 (same WHO Table 4: "muscle-strengthening
 *     activities ... on 2 or more days a week"). Gym = lib/training/modality.mjs isGymModality (strength +
 *     hybrid): hybrid sessions carry strength blocks, and a Watch copy may label weights as HIIT.
 *   - steps: mean per day vs the plateau of Paluch AE et al., "Daily steps and all-cause mortality: a
 *     meta-analysis of 15 international cohorts", Lancet Public Health 2022;7(3):e219–e228
 *     (https://pmc.ncbi.nlm.nih.gov/articles/PMC9289978/): 8000–10 000 under 60, 6000–8000 from 60 (the
 *     page picks the range by the profile's age).
 *   - resting HR and sleep regularity (minutes, lib/score/recovery.mjs sleepConsistency): no population
 *     reference fits a watch estimate, so the 28-day mean vs the mean of the BASE_DAYS before it.
 * VO2max lives on the page as the existing fitness age (lib/score/fitness-age.mjs) vs the real age.
 * Only the data's own dates are baked (no build-time "now"). */
import { addDays } from '../date.mjs';
import { scoreModality, isGymModality } from '../training/modality.mjs';

export const HABIT_DAYS = 28;
export const HABIT_REF = Object.freeze({
  sleepH: 7, actMin: 150, actMax: 300, vigFactor: 2, strengthDays: 2,
  steps: Object.freeze({ under60: Object.freeze([8000, 10000]), from60: Object.freeze([6000, 8000]) }), ageSplit: 60,
});
const MIN_DAYS = 14; // a habit needs half its window on record
const BASE_DAYS = 84, MIN_BASE = 28; // the own-baseline habits: the 12 weeks before the window
const GYM_LOOKBACK = 90; // a strength row only for someone with a gym session in the last 90 days

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const inWin = (rows, from, to) => (rows || []).filter((r) => r && r.date >= from && r.date <= to && isNum(r.value));
const mean = (rows) => rows.reduce((a, r) => a + r.value, 0) / rows.length;

function meanRow(rows, from, to, round) {
  const w = inWin(rows, from, to);
  return w.length >= MIN_DAYS ? { mean: round(mean(w)), n: w.length } : null;
}
// the window mean vs the mean of the BASE_DAYS before the window (null base under MIN_BASE days)
function vsBase(rows, from, to) {
  const w = inWin(rows, from, to);
  if (w.length < MIN_DAYS) return null;
  const b = inWin(rows, addDays(from, -BASE_DAYS), addDays(from, -1));
  return { now: r1(mean(w)), base: b.length >= MIN_BASE ? r1(mean(b)) : null, n: w.length };
}
function activityRow(zoneDays, from, to) {
  const w = (zoneDays || []).filter((d) => d && d.date >= from && d.date <= to && Array.isArray(d.z));
  if (w.length < MIN_DAYS) return null;
  const sum = (ks) => w.reduce((a, d) => a + ks.reduce((s, k) => s + (isNum(d.z[k]) ? d.z[k] : 0), 0), 0);
  const perWeek = (v) => Math.round((v / w.length) * 7);
  const mod = perWeek(sum([2, 3])), vig = perWeek(sum([4, 5]));
  return { mod, vig, eq: mod + HABIT_REF.vigFactor * vig, n: w.length };
}
function strengthRow(workouts, from, to, asOf) {
  const gym = (workouts || []).filter((r) => r && r.date && isGymModality(scoreModality(r.type)));
  if (!gym.some((r) => r.date >= addDays(asOf, -GYM_LOOKBACK) && r.date < asOf)) return null;
  const n = new Set(gym.filter((r) => r.date >= from && r.date <= to).map((r) => r.date)).size;
  return { days: n, perWeek: r2((n * 7) / HABIT_DAYS) };
}

/** {sleep, steps, rhr, cons: [{date, value}], zoneDays: [{date, z: [minutes per zone 0..5]}], workouts:
 * readWorkouts rows, asOf: the newest data date} -> null | {from, to, ref (HABIT_REF, so the page never
 * re-types a threshold), sleep, activity, strength, steps, rhr, cons} (each null when it lacks data).
 * @param {{sleep?: any[], steps?: any[], rhr?: any[], cons?: any[], zoneDays?: any[] | null, workouts?: any[], asOf?: string}} [inputs] */
export function healthspanFrom({ sleep, steps, rhr, cons, zoneDays, workouts, asOf } = {}) {
  if (!asOf) return null;
  const to = addDays(asOf, -1), from = addDays(asOf, -HABIT_DAYS);
  const out = {
    from, to, ref: HABIT_REF,
    sleep: meanRow(sleep, from, to, r2),
    activity: activityRow(zoneDays, from, to),
    strength: strengthRow(workouts, from, to, asOf),
    steps: meanRow(steps, from, to, Math.round),
    rhr: vsBase(rhr, from, to),
    cons: vsBase(cons, from, to),
  };
  return ['sleep', 'activity', 'strength', 'steps', 'rhr', 'cons'].some((k) => out[k]) ? out : null;
}
