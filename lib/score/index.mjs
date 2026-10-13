/* Single lib-level entry point for the Home tab: recovery (last night + trend) + per-modality load +
 * advice + the health monitor + tonight's bedtime + last night's sleep scores + day strain + the heart-rate stress estimate + the energy bank + the fitness age + the per-day history behind the day stepping (latest overnight signals vs their personal band, always baked: its
 * cards render their own empty state, independently of hasData).
 * The result is JSON-safe and carries no build-time "now": only the data's own asOf dates, so
 * staleness ("days ago") is computed client-side and consecutive builds are byte-identical. */
import { recoveryFrom } from './recovery.mjs';
import { loadFrom } from './load.mjs';
import { advise } from './advice.mjs';
import { monitorFrom } from './monitor.mjs';
import { timelineFrom } from './timeline.mjs';
import { tonightFrom } from './tonight.mjs';
import { sleepScoreFrom } from './sleep.mjs';
import { daysFrom } from './days.mjs';
import { strainFrom } from './strain.mjs';
import { stressFrom } from './stress.mjs';
import { energyFrom } from './energy.mjs';
import { journalFrom } from '../journal/bake.mjs';
import { fitnessAgeFrom } from './fitness-age.mjs';
import { readExtract } from '../extract/read.mjs';

// the strain bake without its full-year history (that lives in DETAIL.metrics.strain)
function strainBake(inputs) {
  const r = strainFrom(inputs);
  if (!r) return null;
  const { all, ...rest } = r;
  return rest;
}

/** The SCORES bake from lib/extract/read.mjs readExtract inputs (pure: no fs, no clock).
 * opts.sex = the profile's sex ('male' | 'female' | null): the fitness-age reference curve. */
export function buildScoresFrom(inputs, { sex = null } = {}) {
  const recovery = recoveryFrom(inputs);
  const load = loadFrom(inputs);
  const monitor = monitorFrom(inputs);
  // today's timeline (sleep + workouts of the last days) renders its own empty state, like the monitor
  const timeline = timelineFrom(inputs);
  // tonight's recommended bedtime (usual wake − the sleep target); null hides the card
  const tonight = tonightFrom(inputs);
  // last night's sleep performance / efficiency / consistency / stages; null hides them
  const sleep = sleepScoreFrom(inputs);
  // the last DAY_HISTORY_DAYS days as the dials / monitor tiles saw them (Inicio's day stepping)
  const days = daysFrom(inputs);
  // day strain 0-21 (lib/score/strain.mjs): {ok: false, reason} or null = Inicio keeps the load dial
  const strain = strainBake(inputs);
  // the HR-only stress estimate per waking hour (lib/score/stress.mjs): null = Inicio keeps the HRV tile
  const stress = stressFrom(inputs);
  // the intraday energy bank (lib/score/energy.mjs): OUR model from the recovery %, stress and strain bakes
  const energy = energyFrom(inputs, { stress, days, strain });
  // the behaviour journal (lib/journal/bake.mjs): its behaviour list for the LAN sheet
  const journal = journalFrom(inputs);
  // Salud's fitness age (lib/score/fitness-age.mjs): {ok: false, reason} when sex / VO2max is missing
  const fitnessAge = fitnessAgeFrom(inputs, { sex });
  if (!recovery && !load) return { hasData: false, asOf: null, reEpoch: null, recovery: null, load: null, advice: null, monitor, timeline, tonight, sleep, days, strain, stress, energy, journal, fitnessAge };
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
    energy,
    journal,
    fitnessAge,
  };
}

/** buildScoresFrom over one directory: a temporary shim for the per-directory callers (tests, scripts);
 * read-at-edge E3 removes it. The page reads once in web/src/bakes.mjs. */
export function buildScores(extractDir, opts) {
  return buildScoresFrom(readExtract(extractDir), opts);
}
