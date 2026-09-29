/* Entreno's 30-day activity calendar + cumulative training time (this 30 days vs the previous 30),
 * from workouts.csv with the dashboard's rules (lib/training/dashboard.mjs): DURATION not kcal,
 * DISTINCT DAYS not raw rows (the Watch fragments one session into several records), the
 * dashboard's modality buckets (Watch auto-labels: hiit is displayed as "Gym"). Same-day rows follow
 * the ONE shared rule (lib/training/sessions.mjs): junk stubs are dropped (a 2-min accidental start
 * never colours a rest day) and a Watch + Strava pair of one bucket counts once (Strava).
 *
 * Only the last BAKE_DAYS days ending at the newest workout are baked, one entry per active day —
 * no build-time "now", so builds stay byte-identical. The client (web/src/client/training-activity.js)
 * ends both windows at the VIEWER's today (or at asOf when the data is stale). */
import fs from 'node:fs';
import path from 'node:path';
import { parseWorkouts, modalityGroup, MODALITIES } from './dashboard.mjs';
import { addDays } from '../health/stats.mjs';
import { mergeSameDay } from './sessions.mjs';

export const WINDOW_DAYS = 30;
// calendar colour levels by total minutes: >= 1, 30, 60, 90 (a "session" is ~45-75 min)
export const LEVEL_MIN = Object.freeze([1, 30, 60, 90]);
// two windows (60 days) + the 3 days a viewer may be ahead of the data before it counts as stale
export const BAKE_DAYS = 2 * WINDOW_DAYS + 3;

/** parseWorkouts() rows -> { hasData, asOf, days: [{date, min, top, mods}] } (oldest first). */
export function activityFromRows(rows) {
  const groups = mergeSameDay(rows, (x) => modalityGroup(x.type));
  if (!groups.length) return { hasData: false };
  const asOf = groups[groups.length - 1].date;
  const from = addDays(asOf, -(BAKE_DAYS - 1));
  const byDate = new Map();
  for (const g of groups) {
    if (g.date < from) continue;
    const mods = byDate.get(g.date) || {};
    mods[g.key] = g.rows.reduce((a, x) => a + x.dur, 0);
    byDate.set(g.date, mods);
  }
  const days = [...byDate.keys()].sort().map((date) => {
    const raw = byDate.get(date);
    const mods = {};
    let min = 0, top = null;
    for (const k of MODALITIES) {
      if (!(k in raw)) continue;
      mods[k] = Math.round(raw[k]);
      min += raw[k];
      if (top == null || raw[k] > raw[top]) top = k;
    }
    return { date, min: Math.round(min), top, mods };
  });
  return { hasData: true, asOf, days };
}

/** The baked ACTIVITY global: the data plus the client's constants (never client literals). */
export function activityBake(activity) {
  return { ...activity, windowDays: WINDOW_DAYS, levelMin: [...LEVEL_MIN] };
}

export function buildActivity(extractDir) {
  if (!extractDir) return { hasData: false };
  const p = path.join(extractDir, 'workouts.csv');
  if (!fs.existsSync(p)) return { hasData: false };
  return activityFromRows(parseWorkouts(fs.readFileSync(p, 'utf8')));
}
