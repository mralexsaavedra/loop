/* Training modality mapping, shared by Home (load, timeline, strain), the detail views and the
 * Entreno tab. Load is tracked PER MODALITY and never summed across them: RE/min differs ~4x
 * (run vs gym/bike), so a combined figure would bury gym weeks.
 *
 * Modalities: strength (weights: Hevy uploads WeightTraining to Strava), hybrid (HIIT / metcon:
 * the hybrid program's sessions), run, bike (outdoor and indoor rides) and other (walks, racket
 * sports, unknown types: shown raw, never scored).
 *
 * Same-day dedupe works on the PHYSICAL family (physicalModality: strength + hybrid = gym), because
 * a Watch copy of one gym session can carry a different label than its Strava copy (the Watch tags
 * weights as HIIT). Readers pass `dedupeKey: byPhysical` to mergeSameDay and key on byModality, so the
 * copy is dropped first and the surviving rows are then split: strength and HIIT of one day are two
 * sessions.
 */
export const SCORE_MODALITIES = ['strength', 'hybrid', 'run', 'bike', 'other'];

// Exact HealthKit-style labels. "Other" must be an exact match: an unanchored /Other/ would
// swallow unrelated types. "Other" is hybrid: it is the Watch's generic workout label, used for
// metcon sessions, and Strava's generic "Workout" maps to it. Strava's FALLBACK for an unknown
// sport is "Unmapped" (sync-strava.mjs), not "Other", so tennis & co. do not land here.
/** The modalities that carry a load (Home's load dial and its deep-dives): every one but `other`. */
export const LOAD_MODALITIES = SCORE_MODALITIES.filter((m) => m !== 'other');

const STRENGTH_TYPES = new Set(['TraditionalStrengthTraining', 'FunctionalStrengthTraining', 'WeightTraining']);
const HYBRID_TYPES = new Set(['HighIntensityIntervalTraining', 'CrossTraining', 'Other']);

export function scoreModality(type) {
  const t = type == null ? '' : String(type);
  if (/Running/i.test(t)) return 'run';
  if (/Cycling/i.test(t)) return 'bike'; // Cycling and IndoorCycling (trainer / virtual rides)
  if (STRENGTH_TYPES.has(t)) return 'strength';
  if (HYBRID_TYPES.has(t)) return 'hybrid';
  return 'other';
}

/** strength / hybrid -> true: the gym family (gym time, the healthspan strength habit, the dedupe key). */
export const isGymModality = (m) => m === 'strength' || m === 'hybrid';

/** The physical family of a workout type: gym / run / bike / other (the same-day dedupe key). */
export function physicalModality(type) {
  const m = scoreModality(type);
  return isGymModality(m) ? 'gym' : m;
}

/** mergeSameDay key functions over a workouts row ({type}). */
export const byModality = (r) => scoreModality(r.type);
export const byPhysical = (r) => physicalModality(r.type);
