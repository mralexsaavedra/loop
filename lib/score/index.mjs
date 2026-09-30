/* Single lib-level entry point for the Home tab: recovery (last night + trend) + per-modality load +
 * advice + the health monitor (latest overnight signals vs their personal band, always baked: its
 * cards render their own empty state, independently of hasData).
 * The result is JSON-safe and carries no build-time "now": only the data's own asOf dates, so
 * staleness ("days ago") is computed client-side and consecutive builds are byte-identical. */
import { buildRecovery2 } from './recovery.mjs';
import { buildLoad } from './load.mjs';
import { advise } from './advice.mjs';
import { buildMonitor } from './monitor.mjs';
import { buildTimeline } from './timeline.mjs';

export function buildScores(extractDir) {
  const recovery = buildRecovery2(extractDir);
  const load = buildLoad(extractDir);
  const monitor = buildMonitor(extractDir);
  // today's timeline (sleep + workouts of the last days) renders its own empty state, like the monitor
  const timeline = buildTimeline(extractDir);
  if (!recovery && !load) return { hasData: false, asOf: null, reEpoch: null, recovery: null, load: null, advice: null, monitor, timeline };
  const dates = [recovery && recovery.asOf, load && load.asOf].filter(Boolean).sort();
  return {
    hasData: true,
    asOf: dates.length ? dates[dates.length - 1] : null,
    reEpoch: load ? load.reEpoch : null,
    recovery,
    load,
    advice: advise({ recovery, load }),
    monitor,
    timeline,
  };
}
