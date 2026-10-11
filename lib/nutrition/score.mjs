/* Nutrition score — a day's 0-100 adherence to the viewer's OWN targets (Inicio "My day" card +
 * Nutrición; clientSource() emits these very functions as the page's HC_NSCORE, which
 * web/src/client/nutri-score.js runs — no copy; NSCORE_CASES test both). Our own transparent formula, stated in ⓘ and docs/nutrition-food-log.md:
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
 * scored but flagged. Pure except the build-time CSV reader at the end. */
import fs from 'node:fs';
import path from 'node:path';
import { ADHERENCE } from './adherence.mjs';
import { classicGlobal } from '../format/numbers.mjs';

export const NSCORE = Object.freeze({
  weights: Object.freeze({ k: 0.4, p: 0.4, f: 0.2 }),
  kcal: Object.freeze({ full: ADHERENCE.onBand, zero: 0.35 }),
  protein: Object.freeze({ full: ADHERENCE.proteinShare, zero: 0.5 }),
  fat: Object.freeze({ lo: 0.6, hi: 1.1, zeroLo: 0.3, zeroHi: 1.6 }),
  bands: Object.freeze({ good: 85, mid: 60 }),
  days: 90, // the baked food log window (days ending at the newest logged day)
  avgDays: 7, // the cards' average: final scores of the last 7 days
});

function fin(v) {
  return typeof v === 'number' && isFinite(v);
}
function clamp100(x) {
  return Math.max(0, Math.min(100, x));
}
// eaten / target to 6 decimals, so a value exactly on a band edge (2200 of 2000) lands on it, not a
// float hair outside
function ratio(v, t) {
  return fin(v) && fin(t) && t > 0 ? Math.round((v / t) * 1e6) / 1e6 : null;
}
// points to one decimal (the score rounds the weighted sum of these)
function pts1(x) {
  return Math.round(x * 10) / 10;
}

/** kcal eaten vs target -> 0-100 (null when either is unknown). */
export function kcalPoints(k, t) {
  var r = ratio(k, t), K = NSCORE.kcal;
  if (r == null) return null;
  var d = Math.round(Math.abs(r - 1) * 1e6) / 1e6;
  return d <= K.full ? 100 : pts1(clamp100((100 * (K.zero - d)) / (K.zero - K.full)));
}
/** protein eaten vs target -> 0-100. */
export function proteinPoints(p, t) {
  var r = ratio(p, t), P = NSCORE.protein;
  if (r == null) return null;
  return r >= P.full ? 100 : pts1(clamp100((100 * (r - P.zero)) / (P.full - P.zero)));
}
/** fat eaten vs target -> 0-100. */
export function fatPoints(f, t) {
  var r = ratio(f, t), F = NSCORE.fat;
  if (r == null) return null;
  if (r > F.hi) return pts1(clamp100((100 * (F.zeroHi - r)) / (F.zeroHi - F.hi)));
  if (r < F.lo) return pts1(clamp100((100 * (r - F.zeroLo)) / (F.lo - F.zeroLo)));
  return 100;
}

/** good >= 85, mid 60-84, low < 60 (null without a score). */
export function scoreBand(s) {
  if (!fin(s)) return null;
  return s >= NSCORE.bands.good ? 'good' : s >= NSCORE.bands.mid ? 'mid' : 'low';
}

function hasMeals(day) {
  var g = day && day.groups;
  return !!g && ADHERENCE.required.every(function (k) { return fin(g[k]) && g[k] >= 1; });
}

/** day = a food log day {date, k, p, f, n, missing: {p, f}, groups}, target = {k, p, g, inferred?} | null,
 * opts.today = the viewer's ISO today -> null | {score, parts: {k, p, f}, inc, partial, meals, assumed};
 * a part = {v, t, pts (rounded), min?} or null when left out. */
export function nutritionScore(day, target, opts) {
  if (!day || !(day.n > 0) || !target || !fin(target.k) || !(target.k > 0)) return null;
  var miss = day.missing || {};
  var parts = { k: null, p: null, f: null };
  var raw = {};
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
  ['k', 'p', 'f'].forEach(function (c) {
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
 * today never counts), whole number, null without one. */
export function scoreSeries(dates, days, targets, today) {
  var by = {}, T = targets || {}, out = { days: {}, avg: null, n: 0 };
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

/** The classic-script twin for web/src/client/nutri-score.js: `var HC_NSCORE` built from THESE
 * functions' own source (lib/format/numbers.mjs classicGlobal), so the page scores exactly like the lib. */
export function clientSource() {
  return classicGlobal('HC_NSCORE', {
    consts: { NSCORE },
    hidden: { ADHERENCE },
    fns: { fin, clamp100, ratio, pts1, kcalPoints, proteinPoints, fatPoints, scoreBand, hasMeals, nutritionScore, scoreSeries },
  });
}

// shared fixture: the HC_NSCORE tests (web/src/client/nutri-score.test.mjs, the built page) run the emitted source over these
var TG = { k: 2000, p: 150, g: 70 };
function D(o) {
  var d = { date: '2030-01-10', k: 2000, p: 150, f: 70, n: 3, missing: { p: false, f: false }, groups: { breakfast: 1, lunch: 1, dinner: 1 } };
  Object.keys(o || {}).forEach(function (k) { d[k] = o[k]; });
  return d;
}
export const NSCORE_CASES = Object.freeze([
  { name: 'on every target', day: D(), target: TG, today: '2030-01-11', expect: { score: 100, parts: { k: { v: 2000, t: 2000, pts: 100 }, p: { v: 150, t: 150, pts: 100 }, f: { v: 70, t: 70, pts: 100 } }, inc: false, partial: false, meals: true, assumed: false } },
  { name: 'every component part way', day: D({ k: 2500, p: 105, f: 94.5 }), target: TG, today: '2030-01-11', expect: { score: 46, parts: { k: { v: 2500, t: 2000, pts: 40 }, p: { v: 105, t: 150, pts: 50 }, f: { v: 94.5, t: 70, pts: 50 } }, inc: false, partial: false, meals: true, assumed: false } },
  { name: 'low fat, under-eaten, today so far', day: D({ k: 1300, p: 60, f: 15 }), target: TG, today: '2030-01-10', expect: { score: 0, parts: { k: { v: 1300, t: 2000, pts: 0 }, p: { v: 60, t: 150, pts: 0 }, f: { v: 15, t: 70, pts: 0 } }, inc: false, partial: true, meals: true, assumed: false } },
  { name: 'fat unknown, protein a minimum that reaches the target', day: D({ k: 2300, p: 140, f: 5, missing: { p: true, f: true } }), target: TG, today: '2030-01-11', expect: { score: 90, parts: { k: { v: 2300, t: 2000, pts: 80 }, p: { v: 140, t: 150, pts: 100, min: true }, f: null }, inc: true, partial: false, meals: true, assumed: false } },
  { name: 'protein a minimum below full credit, no dinner, assumed rest day', day: D({ p: 90, missing: { p: true, f: false }, groups: { breakfast: 1, lunch: 2, dinner: 0 } }), target: { k: 2000, p: 150, g: 70, inferred: true }, today: '2030-01-11', expect: { score: 100, parts: { k: { v: 2000, t: 2000, pts: 100 }, p: null, f: { v: 70, t: 70, pts: 100 } }, inc: true, partial: false, meals: false, assumed: true } },
  { name: 'band edges: kcal +10 % exactly, protein 90 % exactly, fat 110 % exactly', day: D({ k: 2200, p: 135, f: 77 }), target: TG, today: '2030-01-11', expect: { score: 100, parts: { k: { v: 2200, t: 2000, pts: 100 }, p: { v: 135, t: 150, pts: 100 }, f: { v: 77, t: 70, pts: 100 } }, inc: false, partial: false, meals: true, assumed: false } },
  { name: 'zero edges: kcal -35 %, protein 50 %, fat 160 %', day: D({ k: 1300, p: 75, f: 112 }), target: TG, today: '2030-01-11', expect: { score: 0, parts: { k: { v: 1300, t: 2000, pts: 0 }, p: { v: 75, t: 150, pts: 0 }, f: { v: 112, t: 70, pts: 0 } }, inc: false, partial: false, meals: true, assumed: false } },
  { name: 'fat 30 % below and a blank protein the sync did not flag', day: D({ p: null, f: 21 }), target: TG, today: '2030-01-11', expect: { score: 67, parts: { k: { v: 2000, t: 2000, pts: 100 }, p: null, f: { v: 21, t: 70, pts: 0 } }, inc: true, partial: false, meals: true, assumed: false } },
  { name: 'no entries', day: D({ n: 0 }), target: TG, today: '2030-01-11', expect: null },
  { name: 'no target', day: D(), target: null, today: '2030-01-11', expect: null },
]);

/* ---------- build time: the food log snapshot the page bakes (INTAKE.log) ---------- */
export const FOODLOG_FILE = 'foodlog-daily.csv';
export const FOODLOG_HEADER = 'date,kcal,protein_g,carbs_g,fat_g,entries,breakfast,lunch,dinner,addon,missing_macros';

/** A real calendar date (2030-02-31 and 2030-13-45 are not). */
function isIsoDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  var t = Date.parse(v + 'T00:00:00Z');
  return fin(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** The sync's CSV (data/nutrition/sync-foodlog.js; LF or CRLF) -> {days, skipped}: days in the summary
 * shape the score reads ({date, k, p, f, n, missing: {p, f}, groups: {breakfast, lunch, dinner}});
 * skipped = rows dropped for an impossible date, no kcal or no entries; a foreign / empty file -> none.
 * A blank macro cell counts as missing even when missing_macros does not list it. */
export function parseFoodlogRows(text) {
  var lines = String(text || '').split(/\r?\n/).filter(Boolean);
  if (lines[0] !== FOODLOG_HEADER) return { days: [], skipped: 0 };
  var num = function (v) { return v === '' || v == null ? null : fin(+v) ? +v : null; };
  var days = [], skipped = 0;
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
export function parseFoodlogCsv(text) {
  return parseFoodlogRows(text).days;
}

const shift = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** The last NSCORE.days days ending at the newest logged day (only data dates: byte-identical builds). */
export function foodlogBake(days) {
  var sorted = (days || []).filter(function (d) { return d && isIsoDate(d.date); }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  if (!sorted.length) return { asOf: null, days: [] };
  var asOf = sorted[sorted.length - 1].date, from = shift(asOf, -(NSCORE.days - 1));
  return { asOf: asOf, days: sorted.filter(function (d) { return d.date >= from; }) };
}

/** Where the build reads the food log: the synced snapshot (personal) or the demo extract (example). */
export function foodlogFile({ repoRoot, dataMode, extractDir }) {
  return dataMode === 'example' ? path.join(extractDir || '', FOODLOG_FILE) : path.join(repoRoot, 'data', 'nutrition', FOODLOG_FILE);
}

/** env -> the bake; rows it could not read are skipped and reported once through `warn` (never thrown). */
export function buildFoodlogBake(env, { warn = console.warn } = {}) {
  var file = foodlogFile(env);
  var text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { text = ''; }
  var r = parseFoodlogRows(text);
  if (r.skipped) warn('nutrition score: skipped ' + r.skipped + ' row(s) of ' + path.basename(file) + ' (bad date, no kcal or no entries)');
  return foodlogBake(r.days);
}
