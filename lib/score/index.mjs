/* Single lib-level entry point for the Home tab: recovery trend + per-modality load + advice.
 * The result is JSON-safe and carries no build-time "now": only the data's own asOf dates, so
 * staleness ("days ago") is computed client-side and consecutive builds are byte-identical. */
import { buildRecovery2 } from './recovery.mjs';
import { buildLoad } from './load.mjs';
import { advise } from './advice.mjs';

export function buildScores(extractDir) {
  const recovery = buildRecovery2(extractDir);
  const load = buildLoad(extractDir);
  if (!recovery && !load) return { hasData: false, asOf: null, reEpoch: null, recovery: null, load: null, advice: null };
  const dates = [recovery && recovery.asOf, load && load.asOf].filter(Boolean).sort();
  return {
    hasData: true,
    asOf: dates.length ? dates[dates.length - 1] : null,
    reEpoch: load ? load.reEpoch : null,
    recovery,
    load,
    advice: advise({ recovery, load }),
  };
}
