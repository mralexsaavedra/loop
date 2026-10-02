/* Weight progress vs the nutrition goal — the reference web/src/client/progress.js ports (the page has
 * the baked DETAIL.metrics.weight and decides everything on the viewer's clock; a parity test runs both
 * over PROGRESS_CASES). Shown in Nutrición ("Progreso") and as one line in the profile sheet.
 *
 * Method (stated on screen): the series is the weight card's 7-day rolling average (DETAIL `roll`, one
 * value per weigh-in day); the rate is the least-squares slope of those averages over the last
 * `windowDays` (28) days ending at the newest one, in kg/week. It needs >= `minReadings` averages
 * spanning >= `minSpanDays` days, else "few data". The series mixes scales, so it is a TREND, never a
 * precise number.
 *
 * Status vs the goal (analysis/methodology.md: a healthy change is 0.25–0.5 kg/week, never more than
 * 1 % of bodyweight per week): cut / bulk -> `onPace` (0.25–0.5 kg/week the goal's way), `slow` (less,
 * a flat trend included), `fast` (over 0.5 kg/week or over 1 % of the current average), `wrong` (more
 * than `flatKg` the other way), `reached` (a target within `reachedKg`); maintain -> `steady` (within
 * ±0.25), `drift`, `fast`. `mismatch` = the target lies on the other side of the goal (a cut with a
 * target above the current average). The ETA (weeks to go at 0.5 … 0.25 kg/week) exists only on pace
 * towards the target. Pure: no I/O. */

export const PROGRESS = Object.freeze({
  windowDays: 28,
  minReadings: 8,
  minSpanDays: 21,
  paceMin: 0.25, // kg/week
  paceMax: 0.5,
  maxPctWeek: 1, // % of bodyweight per week
  flatKg: 0.1, // kg/week: a smaller move is noise, never "the wrong way"
  reachedKg: 0.5, // a 7-day average this close to the target has reached it
  staleDays: 14, // the newest weigh-in older than this: no status (the page says so)
});
const DIR = { cut: -1, bulk: 1, maintain: 0 };
const MS_PER_DAY = 86400000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function fin(v) {
  return typeof v === 'number' && isFinite(v);
}
function round(v, dec) {
  var f = Math.pow(10, dec);
  return Math.round(v * f + (v >= 0 ? 1e-9 : -1e-9)) / f;
}
function dayNum(iso) {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / MS_PER_DAY;
}
function isoOf(n) {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** DETAIL.metrics.weight ({start, roll}) -> [{date, kg}] of the days with a 7-day average, oldest first. */
export function rollPoints(m) {
  if (!m || typeof m.start !== 'string' || !ISO_RE.test(m.start) || !Array.isArray(m.roll)) return [];
  var s = dayNum(m.start), out = [];
  m.roll.forEach(function (v, i) { if (fin(v)) out.push({ date: isoOf(s + i), kg: v }); });
  return out;
}

/** The slope of the points of the last windowDays ending at the newest: {rate (kg/week) | null, n, span, from}. */
export function weeklyRate(points) {
  if (!points || !points.length) return { rate: null, n: 0, span: 0, from: null };
  var end = dayNum(points[points.length - 1].date);
  var win = points.filter(function (p) { return dayNum(p.date) > end - PROGRESS.windowDays; });
  var x0 = dayNum(win[0].date), span = end - x0;
  var out = { rate: null, n: win.length, span: span, from: win[0].date };
  if (win.length < PROGRESS.minReadings || span < PROGRESS.minSpanDays) return out;
  var mx = 0, my = 0;
  win.forEach(function (p) { mx += dayNum(p.date) - x0; my += p.kg; });
  mx /= win.length;
  my /= win.length;
  var sxy = 0, sxx = 0;
  win.forEach(function (p) {
    var dx = dayNum(p.date) - x0 - mx;
    sxy += dx * (p.kg - my);
    sxx += dx * dx;
  });
  out.rate = sxx > 0 ? (sxy / sxx) * 7 : null;
  return out;
}

/** m = DETAIL.metrics.weight, opts = {goal, target (kg | null)} -> null without any 7-day average, else
 * {current: {date, kg}, rate (kg/week, 2 decimals) | null, n, span, from, remaining (target − current,
 * 1 decimal) | null, status, mismatch, etaWeeks: [fast, slow] | null}. */
export function weightProgress(m, opts) {
  var o = opts || {};
  var pts = rollPoints(m);
  if (!pts.length) return null;
  var last = pts[pts.length - 1];
  var current = { date: last.date, kg: round(last.kg, 1) };
  var r = weeklyRate(pts);
  var dir = o.goal in DIR ? DIR[o.goal] : 0;
  var target = fin(o.target) ? o.target : null;
  var remaining = target != null ? round(target - current.kg, 1) : null;
  var toGo = remaining != null ? remaining * dir : null;
  var mismatch = dir !== 0 && toGo != null && toGo < 0 && Math.abs(remaining) > PROGRESS.reachedKg;
  var rate = r.rate != null ? round(r.rate, 2) : null;
  var status;
  if (dir !== 0 && remaining != null && Math.abs(remaining) <= PROGRESS.reachedKg) status = 'reached';
  else if (rate == null) status = 'fewData';
  else {
    var safeMax = Math.min(PROGRESS.paceMax, (current.kg * PROGRESS.maxPctWeek) / 100);
    if (dir === 0) status = Math.abs(rate) > safeMax ? 'fast' : Math.abs(rate) < PROGRESS.paceMin ? 'steady' : 'drift';
    else {
      var s = rate * dir;
      if (s < -PROGRESS.flatKg) status = 'wrong';
      else if (s > safeMax) status = 'fast';
      else if (s >= PROGRESS.paceMin) status = 'onPace';
      else status = 'slow';
    }
  }
  var eta = null;
  if (status === 'onPace' && toGo != null && toGo > 0 && !mismatch) {
    eta = [round(toGo / PROGRESS.paceMax, 1), round(toGo / PROGRESS.paceMin, 1)];
  }
  return { current: current, rate: rate, n: r.n, span: r.span, from: r.from, remaining: remaining, status: status, mismatch: mismatch, etaWeeks: eta };
}

/** The ETA weeks counted from `today` (the viewer's ISO date) as the first day of their months, or null. */
export function etaMonths(today, weeks) {
  if (!Array.isArray(weeks) || typeof today !== 'string' || !ISO_RE.test(today)) return null;
  var t = dayNum(today);
  return weeks.map(function (w) { return isoOf(t + Math.ceil(w * 7)).slice(0, 8) + '01'; });
}

// shared fixture: web/src/client/progress.test.mjs runs the port over these
function series(start, days, kgAt, every) {
  var roll = [];
  for (var i = 0; i < days; i++) roll.push(i % (every || 1) === 0 || i === days - 1 ? round(kgAt(i), 1) : null);
  return { kind: 'sparse', dec: 1, start: start, v: roll.slice(), roll: roll };
}
var CUT = series('2030-01-01', 41, function (i) { return 80 - (0.35 / 7) * i; });
var CUT_SPARSE = series('2030-01-01', 41, function (i) { return 80 - (0.3 / 7) * i; }, 3);
export const PROGRESS_CASES = Object.freeze([
  { name: 'cut on pace towards a target', metric: CUT, opts: { goal: 'cut', target: 75 }, expect: weightProgressExpect(CUT, 'cut', 75) },
  { name: 'cut, no target', metric: CUT, opts: { goal: 'cut', target: null }, expect: weightProgressExpect(CUT, 'cut', null) },
  { name: 'bulk with a falling trend: the wrong way', metric: CUT, opts: { goal: 'bulk', target: 85 }, expect: weightProgressExpect(CUT, 'bulk', 85) },
  { name: 'maintain while losing 0.35 kg/week: drifting', metric: CUT, opts: { goal: 'maintain', target: null }, expect: weightProgressExpect(CUT, 'maintain', null) },
  { name: 'target reached', metric: CUT, opts: { goal: 'cut', target: 78.2 }, expect: weightProgressExpect(CUT, 'cut', 78.2) },
  { name: 'target on the other side of a cut', metric: CUT, opts: { goal: 'cut', target: 83 }, expect: weightProgressExpect(CUT, 'cut', 83) },
  { name: 'weigh-ins every third day still give a rate', metric: CUT_SPARSE, opts: { goal: 'cut', target: 74 }, expect: weightProgressExpect(CUT_SPARSE, 'cut', 74) },
  { name: 'few readings', metric: series('2030-01-01', 9, function () { return 80; }), opts: { goal: 'cut', target: 75 }, expect: weightProgressExpect(series('2030-01-01', 9, function () { return 80; }), 'cut', 75) },
  { name: 'no weight data', metric: { start: '2030-01-01', v: [null], roll: [null] }, opts: { goal: 'cut', target: 75 }, expect: null },
]);
// the cases' expectations are the reference's own output, frozen as JSON (the parity test compares the port)
function weightProgressExpect(m, goal, target) {
  return JSON.parse(JSON.stringify(weightProgress(m, { goal: goal, target: target })));
}
