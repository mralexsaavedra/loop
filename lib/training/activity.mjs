/* Entreno's 30-day activity calendar + cumulative training time (this 30 days vs the previous 30),
 * from workouts.csv with the dashboard's rules (lib/training/dashboard.mjs): DURATION not kcal,
 * DISTINCT DAYS not raw rows (the Watch fragments one session into several records), the
 * dashboard's modality buckets (Watch auto-labels: hiit is displayed as "Gym").
 *
 * Only the last BAKE_DAYS days ending at the newest workout are baked, one entry per active day —
 * no build-time "now", so builds stay byte-identical. The client (web/src/client/training-activity.js)
 * ends both windows at the VIEWER's today (or at asOf when the data is stale). */
import fs from 'node:fs';
import path from 'node:path';
import { parseWorkouts, modalityGroup, MODALITIES } from './dashboard.mjs';
import { addDays } from '../health/stats.mjs';

export const WINDOW_DAYS = 30;
// two windows (60 days) + the 3 days a viewer may be ahead of the data before it counts as stale
export const BAKE_DAYS = 2 * WINDOW_DAYS + 3;

/** parseWorkouts() rows -> { hasData, asOf, days: [{date, min, top, mods}] } (oldest first). */
export function activityFromRows(rows) {
  const valid = (rows || []).filter((x) => x && x.dur > 0);
  if (!valid.length) return { hasData: false };
  const asOf = valid.map((x) => x.date).sort().pop();
  const from = addDays(asOf, -(BAKE_DAYS - 1));
  const byDate = new Map();
  for (const x of valid) {
    if (x.date < from || x.date > asOf) continue;
    const mods = byDate.get(x.date) || {};
    const k = modalityGroup(x.type);
    mods[k] = (mods[k] || 0) + x.dur;
    byDate.set(x.date, mods);
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

export function buildActivity(extractDir) {
  if (!extractDir) return { hasData: false };
  const p = path.join(extractDir, 'workouts.csv');
  if (!fs.existsSync(p)) return { hasData: false };
  return activityFromRows(parseWorkouts(fs.readFileSync(p, 'utf8')));
}
