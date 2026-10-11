/* The journal's page bake (SCORES.journal, lib/score/index.mjs). docs/journal.md.
 *
 *   groups / behaviors / limits  the behaviour list the sheet renders (lib/journal/journal.mjs)
 *   recent                       journaled dates of the RECENT_DAYS days ending at the newest journal
 *                                day: the My journal card's checks when the page has no journal API
 *   insights                     null, or {asOf, from, days, rows}: behaviorInsights over the journal
 *                                days of the INSIGHT_DAYS ending at asOf (the newest journal day)
 *
 * Input: <extractDir>/journal-daily.csv (scripts/sync-journal.mjs; the demo generator for the example
 * build), read by lib/journal/read.mjs (readJournal, journalBake); this module is pure over the parsed
 * rows (journalFromInputs). The next-morning recovery = the recovery dial's percentile (recoveryFromInputs today.pct, the
 * night's composite ranked among the 90 days before it) with the inputs cut at that morning, exactly as
 * the dial showed it that day (lib/score/days.mjs does the same cut); a morning that was not a complete
 * night, or has too few prior days for a percentile, has no score and its journal day counts on
 * neither side. JSON-safe, only data dates (no build-time "now"): builds stay byte-identical. */
import { JOURNAL_GROUPS, JOURNAL_BEHAVIORS, JOURNAL_LIMITS, behaviorInsights, isJournaled, nextIso } from './journal.mjs';
import { recoveryFromInputs } from '../score/recovery.mjs';
import { addDays } from '../health/stats.mjs';

export const JOURNAL_FILE = 'journal-daily.csv';
export const RECENT_DAYS = 14;
export const INSIGHT_DAYS = 90;

const upTo = (rows, t) => (rows || []).filter((r) => r && r.date && r.date <= t);

/** {wakeDate: pct 0-100} for the given mornings, scored as the dial scored them on that morning. */
export function morningRecovery({ hrv = [], rhr = [], sleep = [] } = {}, mornings) {
  const out = {};
  for (const t of mornings) {
    const r = recoveryFromInputs({ hrv: upTo(hrv, t), rhr: upTo(rhr, t), sleep: upTo(sleep, t) });
    if (r && !r.gated && r.today && r.today.date === t && Number.isFinite(r.today.pct)) out[t] = r.today.pct;
  }
  return out;
}

/** Parsed inputs {journal (parseJournalCsv rows), hrv, rhr, sleep} -> the SCORES.journal bake. */
export function journalFromInputs({ journal = [], hrv = [], rhr = [], sleep = [] } = {}) {
  const base = { groups: JOURNAL_GROUPS, behaviors: JOURNAL_BEHAVIORS, limits: JOURNAL_LIMITS, recent: [], insights: null };
  const days = (journal || []).filter(isJournaled);
  if (!days.length) return base;
  const asOf = days[days.length - 1].date;
  const recentFrom = addDays(asOf, -(RECENT_DAYS - 1));
  const from = addDays(asOf, -(INSIGHT_DAYS - 1));
  const win = days.filter((d) => d.date >= from);
  const inputs = { hrv: hrv || [], rhr: rhr || [], sleep: sleep || [] };
  const rec = morningRecovery(inputs, win.map((d) => nextIso(d.date)));
  return {
    ...base,
    recent: days.filter((d) => d.date >= recentFrom).map((d) => d.date),
    insights: { asOf, from, days: win.length, rows: behaviorInsights(win, rec) },
  };
}
