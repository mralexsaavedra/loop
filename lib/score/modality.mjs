/* Home-tab modality mapping. Load is tracked PER MODALITY and never summed
 * across them: RE/min differs ~4x (run vs gym/bike), so a combined figure would bury gym weeks.
 *
 * This mapper deliberately DIVERGES from training/dashboard.modalityGroup (Entrenos keeps its
 * 5 buckets): Home folds every Watch gym-ish label into `gym`, and sends unknown types to
 * `other`, which is displayed raw and never scored. The divergence is pinned by test.
 */
export const SCORE_MODALITIES = ['gym', 'run', 'bike', 'other'];

// Exact HealthKit-style labels. "Other" must be an exact match: an unanchored /Other/ would
// swallow unrelated types. WeightTraining (rare: a couple of sessions) is the same physical
// category as the Watch's strength labels, so it lives here too.
const GYM_TYPES = new Set([
  'HighIntensityIntervalTraining', 'CrossTraining', 'TraditionalStrengthTraining',
  'FunctionalStrengthTraining', 'WeightTraining', 'Other',
]);

export function scoreModality(type) {
  const t = type == null ? '' : String(type);
  if (/Running/i.test(t)) return 'run';
  if (/Cycling/i.test(t)) return 'bike';
  if (GYM_TYPES.has(t)) return 'gym';
  return 'other';
}
