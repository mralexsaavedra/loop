/* Food log adherence ("Constancia", LAN page only) — the reference web/src/client/adherence.js ports (a
 * parity test runs both over ADHERENCE_CASES). Input: the per-day summaries of GET /food/log/summary
 * (lib/nutrition/foodlog.mjs daySummaries: {date, k, p, c, f, n, missing, groups}) and, per date, that
 * day's MEALS target (client/nutri-day.js HCNutri.targetFor: the CURRENT goal × that day's detected day
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

export const ADHERENCE = Object.freeze({
  windows: Object.freeze([7, 14, 28]), // days ending at the viewer's today (the 3-segment switch)
  stripDays: 28, // the strip's cells
  required: Object.freeze(['breakfast', 'lunch', 'dinner']),
  onBand: 0.1,
  proteinShare: 0.9,
  reloadMs: 300, // the page's summary re-read after adds / deletes, debounced
});

function fin(v) {
  return typeof v === 'number' && isFinite(v);
}

/** >= 1 entry in every required group. */
export function isComplete(day) {
  var g = day && day.groups;
  if (!g) return false;
  return ADHERENCE.required.every(function (k) { return fin(g[k]) && g[k] >= 1; });
}

/** One day's state: none (no entry) | partial (logged, not complete) | unknown (complete, no target) |
 * assumed (complete, a rest day assumed from sleep alone) |
 * under | on | over (complete, kcal vs the target's kcal). */
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

/** dates = the window's ISO days (oldest first), days = summaries (any order), targets = {date: {k, p} |
 * null} -> {days, logged, complete, compared, unknown, meanK, meanTarget, proteinHit, proteinMin,
 * proteinUnknown, states: [{date, state}]}; meanK / meanTarget = whole kcal, null without compared days. */
export function adherence(dates, days, targets) {
  var byDate = {};
  (days || []).forEach(function (d) { if (d && typeof d.date === 'string') byDate[d.date] = d; });
  var T = targets || {};
  var out = { days: 0, logged: 0, complete: 0, compared: 0, unknown: 0, assumed: 0, meanK: null, meanTarget: null, proteinHit: 0, proteinMin: 0, proteinUnknown: 0, states: [] };
  var sumK = 0, sumT = 0;
  (dates || []).forEach(function (date) {
    var d = byDate[date] || null, t = T[date] || null;
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

// shared fixture: web/src/client/adherence.test.mjs runs the port over these
var G3 = { breakfast: 1, lunch: 1, dinner: 1, addon: 0 };
function D(date, k, p, groups, minP) {
  return { date: date, k: k, p: p, c: null, f: null, n: 3, missing: { p: !!minP, c: true, f: true }, groups: groups || G3 };
}
var DATES = ['2030-01-04', '2030-01-05', '2030-01-06', '2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10'];
export const ADHERENCE_CASES = Object.freeze([
  { name: 'nothing logged', dates: DATES, days: [], targets: {}, expect: { days: 7, logged: 0, complete: 0, compared: 0, unknown: 0, assumed: 0, meanK: null, meanTarget: null, proteinHit: 0, proteinMin: 0, proteinUnknown: 0, states: DATES.map(function (d) { return { date: d, state: 'none' }; }) } },
  {
    name: 'complete, partial, unknown type and every kcal state',
    dates: DATES,
    days: [
      D('2030-01-04', 2000, 140), D('2030-01-05', 2500, 120), D('2030-01-06', 2950, 160, null, true),
      D('2030-01-07', 900, 40, { breakfast: 1, lunch: 1, dinner: 0, addon: 2 }), D('2030-01-08', 2400, null), D('2030-01-09', 2300, 150),
      D('2030-01-10', 1500, 90),
    ],
    targets: { '2030-01-04': { k: 2500, p: 150 }, '2030-01-05': { k: 2500, p: 150 }, '2030-01-06': { k: 2600, p: 150 }, '2030-01-07': { k: 2500, p: 150 }, '2030-01-08': { k: 2500, p: 150 }, '2030-01-09': null, '2030-01-10': { k: 2500, p: 150, inferred: true } },
    expect: {
      days: 7, logged: 7, complete: 6, compared: 4, unknown: 1, assumed: 1, meanK: 2463, meanTarget: 2525, proteinHit: 2, proteinMin: 1, proteinUnknown: 1,
      states: [
        { date: '2030-01-04', state: 'under' }, { date: '2030-01-05', state: 'on' }, { date: '2030-01-06', state: 'over' }, { date: '2030-01-07', state: 'partial' },
        { date: '2030-01-08', state: 'on' }, { date: '2030-01-09', state: 'unknown' }, { date: '2030-01-10', state: 'assumed' },
      ],
    },
  },
]);
