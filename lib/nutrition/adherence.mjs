/* Food log adherence ("Constancia", LAN page only). The page runs THESE functions: web/src/client/lib-globals.ts
 * publishes them as the page global HC_ADH (first in web/src/client/manifest.mjs, before util.ts), which
 * web/src/client/adherence.ts reads; a test runs HC_ADH over ADHERENCE_CASES against the module. Input: the per-day summaries of GET /food/log/summary
 * (lib/nutrition/foodlog.mjs daySummaries: {date, k, p, c, f, n, missing, groups}) and, per date, that
 * day's MEALS target (client/nutri-day.ts HCNutri.targetFor: the CURRENT goal × that day's detected day
 * type; null when the day type cannot be told).
 *
 * Rules (stated on screen): a day is LOGGED with >= 1 entry and COMPLETE with >= 1 entry in each of
 * breakfast, lunch and dinner (`required`); averages and target hits are computed ONLY over complete
 * days that have a target ("compared"); a complete day without a target is counted apart (`unknown`), and so
 * is one whose rest type was only ASSUMED from sleep (`target.inferred`: `assumed`).
 * kcal: on target within ±`onBand` (10 %), else under / over. Protein: a hit = >= `proteinShare` (90 %)
 * of the target; a day whose protein is a minimum (an entry without it) still counts as a hit when the
 * minimum reaches it, and is flagged (`proteinMin`). A macro no entry states (p null) is never 0: it is
 * not a hit and is counted in `proteinUnknown`. Pure: no I/O. */

import { fin } from './num.mjs';

/** A food log day as Constancia reads it (foodlog.mjs daySummaries): kcal and protein eaten (null = unknown), the entry
 * count, protein only a minimum, the entries per Registrar group.
 * @typedef {{ date: string, k: number | null, p: number | null, n: number, missing?: { p?: boolean },
 *   groups?: Record<string, number> }} AdherenceDay */
/** That day's MEALS target (lib/nutrition/nutri-score.mjs MealsTarget).
 * @typedef {import('./nutri-score.mjs').MealsTarget} MealsTarget */

export const ADHERENCE = Object.freeze({
  windows: Object.freeze([7, 14, 28]), // days ending at the viewer's today (the 3-segment switch)
  stripDays: 28, // the strip's cells
  required: Object.freeze(['breakfast', 'lunch', 'dinner']),
  onBand: 0.1,
  proteinShare: 0.9,
  reloadMs: 300, // the page's summary re-read after adds / deletes, debounced
});


/** >= 1 entry in every required group.
 * @param {Pick<AdherenceDay, 'groups'> | null | undefined} day @returns {boolean} */
export function isComplete(day) {
  var g = day && day.groups;
  if (!g) return false;
  // the callback runs only when g is set (a var is not narrowed inside a closure)
  return ADHERENCE.required.every(function (k) { return fin(/** @type {Record<string, number>} */ (g)[k]) && /** @type {Record<string, number>} */ (g)[k] >= 1; });
}

/** One day's state: none (no entry) | partial (logged, not complete) | unknown (complete, no target) |
 * assumed (complete, a rest day assumed from sleep alone) |
 * under | on | over (complete, kcal vs the target's kcal).
 * @param {AdherenceDay | null | undefined} day @param {MealsTarget | null | undefined} target @returns {string} */
export function dayState(day, target) {
  if (!day || !(day.n > 0)) return 'none';
  if (!isComplete(day)) return 'partial';
  if (!target || !fin(target.k) || !(target.k > 0) || !fin(day.k)) return 'unknown';
  // a rest day assumed from sleep alone (no session, nothing programmed): never compared
  if (target.inferred) return 'assumed';
  var r = day.k / target.k;
  if (r < 1 - ADHERENCE.onBand) return 'under';
  if (r > 1 + ADHERENCE.onBand) return 'over';
  return 'on';
}

/** adherence()'s result: day counts per state, the compared days' mean kcal vs target (null without any), protein hits.
 * @typedef {{days: number, logged: number, complete: number, compared: number, unknown: number, assumed: number,
 *   meanK: number | null, meanTarget: number | null, proteinHit: number, proteinMin: number, proteinUnknown: number,
 *   states: {date: string, state: string}[]}} AdherenceResult */

/** dates = the window's ISO days (oldest first), days = summaries (any order), targets = {date: {k, p} |
 * null} -> {days, logged, complete, compared, unknown, meanK, meanTarget, proteinHit, proteinMin,
 * proteinUnknown, states: [{date, state}]}; meanK / meanTarget = whole kcal, null without compared days.
 * @param {readonly string[] | null | undefined} dates @param {readonly (AdherenceDay | null)[] | null | undefined} days
 * @param {Record<string, MealsTarget | null> | null | undefined} targets @returns {AdherenceResult} */
export function adherence(dates, days, targets) {
  var byDate = /** @type {Record<string, AdherenceDay>} */ ({});
  (days || []).forEach(function (d) { if (d && typeof d.date === 'string') byDate[d.date] = d; });
  var T = targets || {};
  var out = /** @type {AdherenceResult} */ ({ days: 0, logged: 0, complete: 0, compared: 0, unknown: 0, assumed: 0, meanK: null, meanTarget: null, proteinHit: 0, proteinMin: 0, proteinUnknown: 0, states: [] });
  var sumK = 0, sumT = 0;
  (dates || []).forEach(function (date) {
    // typed as the compared day they are where they are read: dayState returns before that when either (or its kcal) is missing
    var d = /** @type {AdherenceDay & { k: number }} */ (byDate[date] || null), t = /** @type {MealsTarget & { k: number }} */ (T[date] || null);
    var st = dayState(d, t);
    out.days++;
    out.states.push({ date: date, state: st });
    if (st === 'none') return;
    out.logged++;
    if (st === 'partial') return;
    out.complete++;
    if (st === 'unknown') { out.unknown++; return; }
  if (st === 'assumed') { out.assumed++; return; }
    out.compared++;
    sumK += d.k;
    sumT += t.k;
    if (!fin(d.p)) { out.proteinUnknown++; return; }
    var hit = fin(t.p) && t.p > 0 && d.p >= ADHERENCE.proteinShare * t.p;
    if (hit) out.proteinHit++;
    if (d.missing && d.missing.p) out.proteinMin++;
  });
  if (out.compared) {
    out.meanK = Math.round(sumK / out.compared);
    out.meanTarget = Math.round(sumT / out.compared);
  }
  return out;
}

/** What web/src/client/lib-globals.ts publishes as the page's HC_ADH: ADHERENCE and these functions
 * (bundled from this very module), so the page counts and compares days exactly
 * like the lib. A plain descriptor: lib/nutrition never imports lib/format (data/nutrition/generate.mjs
 * loads this folder on its own). */
export const CLIENT = { consts: { ADHERENCE }, hidden: {}, fns: { fin, isComplete, dayState, adherence } };
