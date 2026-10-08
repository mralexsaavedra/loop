/* Single lib-level entry point for the Home tab: recovery (last night + trend) + per-modality load +
 * advice + the health monitor + tonight's bedtime + last night's sleep scores + day strain + the heart-rate stress estimate + the fitness age + the per-day history behind the day stepping (latest overnight signals vs their personal band, always baked: its
 * cards render their own empty state, independently of hasData).
 * The result is JSON-safe and carries no build-time "now": only the data's own asOf dates, so
 * staleness ("days ago") is computed client-side and consecutive builds are byte-identical. */
import { buildRecovery2 } from './recovery.mjs';
import { buildLoad } from './load.mjs';
import { advise } from './advice.mjs';
import { buildMonitor } from './monitor.mjs';
import { buildTimeline } from './timeline.mjs';
import { buildTonight } from './tonight.mjs';
import { buildSleepScore } from './sleep.mjs';
import { buildDays } from './days.mjs';
import { buildStrain } from './strain.mjs';
import { buildStress } from './stress.mjs';
import { journalBake } from '../journal/bake.mjs';
import { buildFitnessAge } from './fitness-age.mjs';

// the strain bake without its full-year history (that lives in DETAIL.metrics.strain)
function strainBake(extractDir) {
  const r = buildStrain(extractDir);
  if (!r) return null;
  const { all, ...rest } = r;
  return rest;
}

/** opts.sex = the profile's sex ('male' | 'female' | null): the fitness-age reference curve. */
export function buildScores(extractDir, { sex = null } = {}) {
  const recovery = buildRecovery2(extractDir);
  const load = buildLoad(extractDir);
  const monitor = buildMonitor(extractDir);
  // today's timeline (sleep + workouts of the last days) renders its own empty state, like the monitor
  const timeline = buildTimeline(extractDir);
  // tonight's recommended bedtime (usual wake − the sleep target); null hides the card
  const tonight = buildTonight(extractDir);
  // last night's sleep performance / efficiency / consistency / stages; null hides them
  const sleep = buildSleepScore(extractDir);
  // the last DAY_HISTORY_DAYS days as the dials / monitor tiles saw them (Inicio's day stepping)
  const days = buildDays(extractDir);
  // day strain 0-21 (lib/score/strain.mjs): {ok: false, reason} or null = Inicio keeps the load dial
  const strain = strainBake(extractDir);
  // the HR-only stress estimate per waking hour (lib/score/stress.mjs): null = Inicio keeps the HRV tile
  const stress = buildStress(extractDir);
  // the behaviour journal (lib/journal/bake.mjs): its behaviour list for the LAN sheet
  const journal = journalBake(extractDir);
  // Salud's fitness age (lib/score/fitness-age.mjs): {ok: false, reason} when sex / VO2max is missing
  const fitnessAge = buildFitnessAge(extractDir, { sex });
  if (!recovery && !load) return { hasData: false, asOf: null, reEpoch: null, recovery: null, load: null, advice: null, monitor, timeline, tonight, sleep, days, strain, stress, journal, fitnessAge };
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
    tonight,
    sleep,
    days,
    strain,
    stress,
    journal,
    fitnessAge,
  };
}
