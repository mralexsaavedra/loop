/* Nutrition score — a day's 0-100 adherence to the viewer's OWN targets (Inicio "My day" card +
 * Nutrición; web/src/client/lib-globals.ts publishes these very functions as the page's HC_NSCORE, which
 * web/src/client/nutri-score.ts runs — no copy; NSCORE_CASES test both). Our own transparent formula, stated in ⓘ and docs/nutrition-food-log.md:
 *
 *   kcal    (weight 0.4): 100 within ±10 % of the target (Constancia's "on target" band,
 *                         ADHERENCE.onBand), linear to 0 at ±35 %;
 *   protein (weight 0.4): 100 at >= 90 % of the target (Constancia's protein-day share,
 *                         ADHERENCE.proteinShare), linear to 0 at 50 %; more is never penalised;
 *   fat     (weight 0.2): 100 between 60 % and 110 % of the target, linear to 0 at 160 % above and
 *                         30 % below;
 *   score = the weighted sum of the components, rounded.
 *
 * ONE definition with Constancia (lib/nutrition/adherence.mjs): the kcal and protein full-credit lines
 * are its constants, and a protein MINIMUM (an entry without protein) that already reaches full credit
 * counts, as there. The target is that day's MEALS target (client: HCNutri.targetFor = the current goal
 * × that day's detected day type, the same one Constancia and the intake rings use; fat = its `g`).
 *
 * A component whose macro is unknown or only a minimum (missing_macros) is LEFT OUT and the others
 * re-weighted (the day is flagged `inc`); a day with no log or no target has NO score (never 0); the
 * viewer's today is `partial` ("so far"), never a final score, and never counts in an average. Days
 * missing a main meal (`meals` false) or whose rest type was only assumed from sleep (`assumed`) are
 * scored but flagged. Pure: the build-time CSV reader (buildFoodlogBake) is lib/nutrition/read.mjs. */
import { ADHERENCE } from './adherence.mjs';
import { addDays, isIsoDate } from '../date.mjs';
import { fin } from './num.mjs';

/** A food log day as the score reads it (foodlog.mjs daySummaries, or a parseFoodlogRows row): kcal, protein and fat
 * eaten (null = unknown), the entry count, the macros that are only a minimum, the entries per Registrar group.
 * @typedef {{ date: string, k: number | null, p: number | null, f: number | null, n: number,
 *   missing?: { p?: boolean, f?: boolean }, groups?: Record<string, number> }} ScoreDay */
/** That day's MEALS target: kcal, protein and fat (g); inferred = a rest day assumed from sleep alone.
 * @typedef {{ k: number | null, p?: number | null, g?: number | null, inferred?: boolean }} MealsTarget */
/** One component of a day's score: eaten v and target t (both known whenever the part exists: the points need them),
 * its rounded points, min = the eaten value is only a minimum.
 * @typedef {{ v: number | null, t: number | null | undefined, pts: number, min?: boolean }} ScorePart */
/** nutritionScore's answer (see there). meals / assumed are always set: optional here only so the page's own,
 * narrower DayScore (web/src/client/nutri-score.ts) stays comparable with scoreSeries' answer.
 * @typedef {{ score: number, parts: { k: ScorePart | null, p: ScorePart | null, f: ScorePart | null }, inc: boolean,
 *   partial: boolean, meals?: boolean, assumed?: boolean }} DayScore */

export const NSCORE = Object.freeze({
  weights: Object.freeze({ k: 0.4, p: 0.4, f: 0.2 }),
  kcal: Object.freeze({ full: ADHERENCE.onBand, zero: 0.35 }),
  protein: Object.freeze({ full: ADHERENCE.proteinShare, zero: 0.5 }),
  fat: Object.freeze({ lo: 0.6, hi: 1.1, zeroLo: 0.3, zeroHi: 1.6 }),
  bands: Object.freeze({ good: 85, mid: 60 }),
  days: 90, // the baked food log window (days ending at the newest logged day)
  avgDays: 7, // the cards' average: final scores of the last 7 days
});

/** @param {number} x @returns {number} */
function clamp100(x) {
  return Math.max(0, Math.min(100, x));
}
// eaten / target to 6 decimals, so a value exactly on a band edge (2200 of 2000) lands on it, not a
// float hair outside
/** @param {unknown} v @param {unknown} t @returns {number | null} */
function ratio(v, t) {
  return fin(v) && fin(t) && t > 0 ? Math.round((v / t) * 1e6) / 1e6 : null;
}
// points to one decimal (the score rounds the weighted sum of these)
/** @param {number} x @returns {number} */
function pts1(x) {
  return Math.round(x * 10) / 10;
}

/** kcal eaten vs target -> 0-100 (null when either is unknown).
 * @param {number | null | undefined} k @param {number | null | undefined} t @returns {number | null} */
export function kcalPoints(k, t) {
  var r = ratio(k, t), K = NSCORE.kcal;
  if (r == null) return null;
  var d = Math.round(Math.abs(r - 1) * 1e6) / 1e6;
  return d <= K.full ? 100 : pts1(clamp100((100 * (K.zero - d)) / (K.zero - K.full)));
}
/** protein eaten vs target -> 0-100.
 * @param {number | null | undefined} p @param {number | null | undefined} t @returns {number | null} */
export function proteinPoints(p, t) {
  var r = ratio(p, t), P = NSCORE.protein;
  if (r == null) return null;
  return r >= P.full ? 100 : pts1(clamp100((100 * (r - P.zero)) / (P.full - P.zero)));
}
/** fat eaten vs target -> 0-100.
 * @param {number | null | undefined} f @param {number | null | undefined} t @returns {number | null} */
export function fatPoints(f, t) {
  var r = ratio(f, t), F = NSCORE.fat;
  if (r == null) return null;
  if (r > F.hi) return pts1(clamp100((100 * (F.zeroHi - r)) / (F.zeroHi - F.hi)));
  if (r < F.lo) return pts1(clamp100((100 * (r - F.zeroLo)) / (F.lo - F.zeroLo)));
  return 100;
}

/** good >= 85, mid 60-84, low < 60 (null without a score).
 * @param {unknown} s @returns {'good' | 'mid' | 'low' | null} */
export function scoreBand(s) {
  if (!fin(s)) return null;
  return s >= NSCORE.bands.good ? 'good' : s >= NSCORE.bands.mid ? 'mid' : 'low';
}

/** @param {ScoreDay | null | undefined} day @returns {boolean} */
function hasMeals(day) {
  var g = day && day.groups;
  // the callback runs only when g is set (a var is not narrowed inside a closure)
  return !!g && ADHERENCE.required.every(function (k) { return fin(/** @type {Record<string, number>} */ (g)[k]) && /** @type {Record<string, number>} */ (g)[k] >= 1; });
}

/** day = a food log day {date, k, p, f, n, missing: {p, f}, groups}, target = {k, p, g, inferred?} | null,
 * opts.today = the viewer's ISO today -> null | {score, parts: {k, p, f}, inc, partial, meals, assumed};
 * a part = {v, t, pts (rounded), min?} or null when left out.
 * @param {ScoreDay | null | undefined} day @param {MealsTarget | null | undefined} target
 * @param {{ today?: string | null }} [opts] @returns {DayScore | null} */
export function nutritionScore(day, target, opts) {
  if (!day || !(day.n > 0) || !target || !fin(target.k) || !(target.k > 0)) return null;
  var miss = day.missing || {};
  var parts = /** @type {DayScore['parts']} */ ({ k: null, p: null, f: null });
  var raw = /** @type {{ k?: number, p?: number, f?: number }} */ ({});
  var kp = kcalPoints(day.k, target.k);
  if (kp != null) { raw.k = kp; parts.k = { v: day.k, t: target.k, pts: Math.round(kp) }; }
  var pp = proteinPoints(day.p, target.p);
  // a protein minimum counts only once it already reaches full credit (Constancia's rule)
  if (pp != null && (!miss.p || pp === 100)) {
    raw.p = pp;
    parts.p = { v: day.p, t: target.p, pts: Math.round(pp) };
    if (miss.p) parts.p.min = true;
  }
  var fp = fatPoints(day.f, target.g);
  if (fp != null && !miss.f) { raw.f = fp; parts.f = { v: day.f, t: target.g, pts: Math.round(fp) }; }
  var sw = 0, sum = 0;
  /** @type {('k' | 'p' | 'f')[]} */ (['k', 'p', 'f']).forEach(function (c) {
    if (raw[c] == null) return;
    sw += NSCORE.weights[c];
    sum += NSCORE.weights[c] * raw[c];
  });
  if (!(sw > 0)) return null;
  return {
    // an unknown macro (flagged, or a blank cell the sync did not flag) makes the day incomplete
    score: Math.round(sum / sw), parts: parts, inc: !!(miss.p || miss.f || !fin(day.p) || !fin(day.f)),
    partial: !!(opts && opts.today && day.date === opts.today), meals: hasMeals(day), assumed: !!target.inferred,
  };
}

/** dates (ISO, oldest first), days (any order), targets {date: target | null}, today -> {days: {date:
 * result}, avg, n}: avg = the mean of the FINAL scores among the last NSCORE.avgDays dates (a partial
 * today never counts), whole number, null without one.
 * @param {readonly string[] | null | undefined} dates @param {readonly (ScoreDay | null)[] | null | undefined} days
 * @param {Record<string, MealsTarget | null> | null | undefined} targets @param {string | null} [today]
 * @returns {{ days: Record<string, DayScore>, avg: number | null, n: number }} */
export function scoreSeries(dates, days, targets, today) {
  var by = /** @type {Record<string, ScoreDay>} */ ({}), T = targets || {};
  var out = /** @type {{ days: Record<string, DayScore>, avg: number | null, n: number }} */ ({ days: {}, avg: null, n: 0 });
  (days || []).forEach(function (d) { if (d && typeof d.date === 'string') by[d.date] = d; });
  (dates || []).forEach(function (date) {
    var r = nutritionScore(by[date] || null, T[date] || null, { today: today });
    if (r) out.days[date] = r;
  });
  var s = 0;
  (dates || []).slice(-NSCORE.avgDays).forEach(function (date) {
    var r = out.days[date];
    if (!r || r.partial) return;
    s += r.score;
    out.n++;
  });
  if (out.n) out.avg = Math.round(s / out.n);
  return out;
}

/** What web/src/client/lib-globals.ts publishes as the page's HC_NSCORE: THESE functions, so the page
 * scores exactly like the lib. A plain descriptor: lib/nutrition never imports lib/format. */
export const CLIENT = {
  consts: { NSCORE },
  hidden: { ADHERENCE },
  fns: { fin, clamp100, ratio, pts1, kcalPoints, proteinPoints, fatPoints, scoreBand, hasMeals, nutritionScore, scoreSeries },
};

/* ---------- build time: the food log snapshot the page bakes (INTAKE.log) ---------- */
export const FOODLOG_FILE = 'foodlog-daily.csv';
export const FOODLOG_HEADER = 'date,kcal,protein_g,carbs_g,fat_g,entries,breakfast,lunch,dinner,addon,missing_macros';

/** The sync's CSV (data/nutrition/sync-foodlog.mjs; LF or CRLF) -> {days, skipped}: days in the summary
 * shape the score reads ({date, k, p, f, n, missing: {p, f}, groups: {breakfast, lunch, dinner}});
 * skipped = rows dropped for an impossible date, no kcal or no entries; a foreign / empty file -> none.
 * A blank macro cell counts as missing even when missing_macros does not list it.
 * @param {string | null | undefined} text @returns {{ days: ScoreDay[], skipped: number }} */
export function parseFoodlogRows(text) {
  var lines = String(text || '').split(/\r?\n/).filter(Boolean);
  if (lines[0] !== FOODLOG_HEADER) return { days: [], skipped: 0 };
  var num = function (/** @type {string | undefined} */ v) { return v === '' || v == null ? null : fin(+v) ? +v : null; };
  var days = /** @type {ScoreDay[]} */ ([]), skipped = 0;
  lines.slice(1).forEach(function (l) {
    var c = l.split(','), miss = (c[10] || '').split(';');
    var d = {
      date: c[0], k: num(c[1]), p: num(c[2]), f: num(c[4]), n: num(c[5]) || 0,
      missing: { p: miss.indexOf('protein') !== -1, f: miss.indexOf('fat') !== -1 },
      groups: { breakfast: num(c[6]) || 0, lunch: num(c[7]) || 0, dinner: num(c[8]) || 0 },
    };
    if (d.p == null) d.missing.p = true;
    if (d.f == null) d.missing.f = true;
    if (isIsoDate(d.date) && fin(d.k) && d.n > 0) days.push(d); else skipped++;
  });
  return { days: days, skipped: skipped };
}
/** parseFoodlogRows' days alone. @param {string | null | undefined} text @returns {ScoreDay[]} */
export function parseFoodlogCsv(text) {
  return parseFoodlogRows(text).days;
}


/** The last NSCORE.days days ending at the newest logged day (only data dates: byte-identical builds).
 * @param {readonly ScoreDay[] | null | undefined} days @returns {{ asOf: string | null, days: ScoreDay[] }} */
export function foodlogBake(days) {
  var sorted = (days || []).filter(function (d) { return d && isIsoDate(d.date); }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  if (!sorted.length) return { asOf: null, days: [] };
  var asOf = sorted[sorted.length - 1].date, from = addDays(asOf, -(NSCORE.days - 1));
  return { asOf: asOf, days: sorted.filter(function (d) { return d.date >= from; }) };
}
