/* Inicio "today" timeline (Whoop's day-activities list, honest version): per day, last night's sleep
 * (sleep-daily.csv, dated the wake-up day) and that day's workouts (workouts.csv) with modality,
 * duration and Relative Effort when the source recorded it.
 *
 * Bakes only the last TIMELINE_DAYS dates ending at the newest data date (no build-time "now"), so
 * builds stay byte-identical; the client (web/src/client/timeline.js) picks the VIEWER's today.
 * Workouts follow the ONE same-day rule (lib/training/sessions.mjs) with its DISPLAY_RULE (it lists
 * sessions, so only stubs are dropped, not short unscored sessions), one source
 * per date + modality (Strava over the Watch copy), same-day rows of one modality merged (the Watch
 * fragments a session, so a real two-a-day is indistinguishable).
 * Modalities are Home's (gym / run / bike / other, lib/score/modality.mjs). */
import { readWorkoutLoad, readSleep } from '../health/read.mjs';
import { addDays } from '../health/stats.mjs';
import { SCORE_MODALITIES, scoreModality } from './modality.mjs';
import { mergeSameDay, DISPLAY_RULE } from '../training/sessions.mjs';

// Today plus a little slack: the viewer may open the page a day or two after the build, or be a
// timezone behind the data; older days are Salud / Entreno material.
export const TIMELINE_DAYS = 3;

const EMPTY = Object.freeze({ asOf: null, days: [] });

/** workouts: readWorkoutLoad() rows, sleep: readSleep() rows -> { asOf, days: [{date, sleep, items}] }. */
export function timelineFromInputs(workouts, sleep) {
  const groups = mergeSameDay(workouts, (r) => scoreModality(r.type), DISPLAY_RULE);
  const sl = (sleep || []).filter((r) => r && Number.isFinite(r.value) && r.value > 0);
  const dates = [...groups.map((g) => g.date), ...sl.map((r) => r.date)].sort();
  if (!dates.length) return { ...EMPTY };
  const asOf = dates[dates.length - 1];
  const from = addDays(asOf, -(TIMELINE_DAYS - 1));
  const inWin = (d) => d >= from && d <= asOf;
  const days = [...new Set(dates.filter(inWin))].sort().map((date) => {
    const night = sl.filter((r) => r.date === date);
    const byMod = new Map();
    for (const g of groups.filter((x) => x.date === date)) {
      const acc = { modality: g.key, dur: 0, re: null, sessions: g.rows.length };
      for (const r of g.rows) {
        acc.dur += r.dur;
        if (r.re != null) acc.re = (acc.re ?? 0) + r.re;
      }
      byMod.set(g.key, acc);
    }
    const items = SCORE_MODALITIES.filter((m) => byMod.has(m)).map((m) => {
      const it = byMod.get(m);
      return { modality: m, dur: Math.round(it.dur), re: it.re == null ? null : Math.round(it.re), sessions: it.sessions };
    });
    return { date, sleep: night.length ? Math.round(night[night.length - 1].value * 10) / 10 : null, items };
  });
  return { asOf, days };
}

export function buildTimeline(extractDir) {
  if (!extractDir) return { ...EMPTY };
  return timelineFromInputs(readWorkoutLoad(extractDir), readSleep(extractDir));
}
