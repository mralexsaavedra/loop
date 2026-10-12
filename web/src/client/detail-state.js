/* Detail sheet, the data and state helpers (no DOM). detail-state.js (this file) -> detail-chart.js
 * (the trend chart) -> detail.js (the sheet shell: header, period, calendar, day panel, open / close,
 * history, deep links, the public window.HCDetail). Classic scripts (is:inline), inlined in that order
 * right after deepdive.js (web/src/client/manifest.mjs).
 *
 * window.HCDetailState(T, D) builds one set of helpers over the sheet's copy (I18N_DETAIL) and data
 * (DETAIL, or detail.js's empty stand-in): the series access (a missing day is null, never 0), the
 * view's end day, the W / M / 6M / 1Y windows and their averages + delta (periodStats), the 7-day line
 * per view (cached per instance), the value formatting (no NaN is ever printed: a dash) and the colour
 * state of a day (dayState, the legend's items). detail.js calls it once and hands the result on to
 * detail-chart.js and client/deepdive.js; detail-state.test.mjs runs the helpers in a vm. Reads
 * window.HC (util.js), HC_BAND (lib/score/recovery.mjs) and, at call time, SCORES / window.HCNutriScore
 * / window.HCSettings for the metrics they own. */
window.HCDetailState = function (T, D) {
  var isoDate = HC.isoDate, parseIso = HC.parseIso, shiftIso = HC.shiftIso;
  // W / M / 6M / 1Y (days); a range longer than the data is clamped to the metric's first day
  var RANGES = [7, 30, 182, 365];
  var RANGE_KEY = { 7: 'w', 30: 'm', 182: 'm6', 365: 'y' };
  // a delta below this share (or below DELTA_FLAT_REC sd for recovery) is "about the same": neutral
  var DELTA_FLAT = 0.01, DELTA_FLAT_REC = 0.05;
  // a 7-day average needs at least 3 days with data (same floor as the recovery trend)
  var ROLL_DAYS = 7, ROLL_MIN = 3;
  // daily totals whose newest day fills up during the day (the extract's "so far" value)
  var PARTIAL_KINDS = ['total', 'nscore'];
  // the 7-day line per (metric, range): computed once, reused by every re-render of that view
  var lineCache = {};

  /* ---------- data access ---------- */
  function dayDiff(a, b) {
    return Math.round((parseIso(b) - parseIso(a)) / HC.MS_PER_DAY);
  }
  function own(o, k) {
    return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  }
  // views registered by other scripts before detail.js: {<key>: {title(): string, render(): {head, body}}}
  function viewOf(key) {
    var v = HC.view(key);
    return v && typeof v.render === 'function' ? v : null;
  }
  function metric(key) {
    var m = own(D.metrics, key) ? D.metrics[key] : key === 'stress' ? stressMetric() : key === 'energy-bank' ? energyMetric() : key === 'nutrition' ? nutritionMetric() : null;
    return m && isoDate(m.start) ? m : null;
  }
  // the stress page's trend series is not in DETAIL: SCORES.stress.metric (lib/score/stress.mjs, the
  // day averages from the first scored day, in the DETAIL metric shape) is its only bake
  function stressMetric() {
    var S = typeof SCORES !== 'undefined' && SCORES ? SCORES.stress : null;
    return S && S.ok && S.metric && Array.isArray(S.metric.v) ? S.metric : null;
  }
  // the energy page's trend (each day's latest level): SCORES.energy.metric (lib/score/energy.mjs)
  function energyMetric() {
    var S = typeof SCORES !== 'undefined' && SCORES ? SCORES.energy : null;
    return S && S.ok && S.metric && Array.isArray(S.metric.v) ? S.metric : null;
  }
  // the nutrition score is scored at VIEW time (the current goal × each day's type): client/nutri-score.js
  function nutritionMetric() {
    var S = typeof window !== 'undefined' ? window.HCNutriScore : null;
    var m = S && typeof S.metric === 'function' ? S.metric() : null;
    return m && Array.isArray(m.v) ? m : null;
  }
  function at(arr, m, iso) {
    if (!arr || !Array.isArray(arr)) return null;
    var i = dayDiff(m.start, iso);
    var v = i >= 0 && i < arr.length ? arr[i] : null;
    return typeof v === 'number' && isFinite(v) ? v : null;
  }
  function valueOf(m, iso) {
    if (!Array.isArray(m.v)) throw new Error('bad series');
    return at(m.v, m, iso);
  }
  // newest day <= end with a value (for training time a rest day, 0, counts: it is a known day)
  function lastDataDate(m, end) {
    for (var i = Math.min(m.v.length - 1, dayDiff(m.start, end)); i >= 0; i--) {
      if (typeof m.v[i] === 'number' && isFinite(m.v[i])) return shiftIso(m.start, i);
    }
    return null;
  }
  // a daily total's day that is the viewer's today: still filling up
  function isPartial(m, iso) {
    return PARTIAL_KINDS.indexOf(m.kind) !== -1 && !!iso && iso === HC.todayIso();
  }
  // the colour state of a day, with today's partial total neutral
  function stateOn(m, iso, v) {
    return v != null && isPartial(m, iso) ? 'partial' : dayState(m, v);
  }
  // the view's last day: the viewer's today, or the data's asOf when stale / ahead of the clock
  function viewEnd() {
    var today = HC.todayIso(), asOf = isoDate(D.asOf);
    if (!asOf) return { end: today, stale: false };
    var age = HC.daysOld(asOf);
    if (age > HC.STALE_DAYS) return { end: asOf, stale: true };
    return { end: age < 0 ? asOf : today, stale: false };
  }
  // the dashed target line: a baked target (sleep), else the user's target weight on the weight view
  // (client/settings.js, LAN page only; nothing without it)
  function targetOf(key, m) {
    if (m.target != null) return m.target;
    if (key !== 'weight') return null;
    var S = typeof window !== 'undefined' ? window.HCSettings : null;
    var v = S && typeof S.ready === 'function' && S.ready() && typeof S.targetWeight === 'function' ? S.targetWeight() : null;
    return typeof v === 'number' && isFinite(v) ? v : null;
  }
  function roll7(m, iso) {
    var s = 0, n = 0;
    for (var k = 0; k < ROLL_DAYS; k++) {
      var v = at(m.v, m, shiftIso(iso, -k));
      if (v != null) { s += v; n++; }
    }
    return n >= ROLL_MIN ? s / n : null;
  }
  function sessionsOn(iso, mod) {
    return (D.sessions || []).filter(function (x) { return x.d === iso && (!mod || x.m === mod); });
  }
  function modOf(key) {
    return key.indexOf('load-') === 0 ? key.slice(5) : null;
  }

  /* ---------- formatting ---------- */
  function fmt(v, dec) {
    return v == null || !isFinite(v) ? '—' : HC.num(v, dec, false);
  }
  function signed(v, dec) {
    return v == null || !isFinite(v) ? '—' : HC.num(v, dec, true);
  }
  function pct(v) {
    return HC.pct(v, true);
  }
  // a value of metric m: sleep hours as h:mm (no unit), anything else fixed decimals
  function fmtM(m, v, dec) {
    return m && m.kind === 'sleep' ? HC.hours(v) : fmt(v, dec);
  }
  function signedM(m, v, dec) {
    return m && m.kind === 'sleep' ? HC.hours(v, true) : signed(v, dec);
  }
  function clock(h) {
    if (h == null || !isFinite(h)) return '—';
    h = ((h % 24) + 24) % 24;
    var H = Math.floor(h), M = Math.round((h - H) * 60);
    if (M === 60) { M = 0; H = (H + 1) % 24; }
    return String(H).padStart(2, '0') + ':' + String(M).padStart(2, '0');
  }
  // the unit shown next to a value; hours (sleep) read as h:mm and carry none
  function unitOf(key) {
    var u = (own(T.metrics, key) && T.metrics[key].unit) || '';
    return u === 'h' ? '' : u;
  }
  function titleOf(key) {
    var vw = viewOf(key);
    if (vw) return (typeof vw.title === 'function' && vw.title()) || key;
    return (own(T.metrics, key) && T.metrics[key].title) || key;
  }
  function valUnit(v, dec, unit) {
    return v == null ? '—' : fmt(v, dec) + (unit ? ' ' + unit : '');
  }

  /* ---------- state colours (tokens via .dt-s-<state>) ---------- */
  function level(v, cuts) {
    var l = 0;
    (cuts || []).forEach(function (c) { if (v >= c) l++; });
    return l;
  }
  // value -> state word: good / bad / watch / normal (vs the personal band, by the signal's good
  // direction), hi / lo (a neutral total), good / mid / bad (sleep vs target and band), l1..l4 / rest
  // (training volume), measured (a sparse reading), none (no data)
  function dayState(m, v) {
    if (v == null || !isFinite(v)) return 'none';
    if (m.kind === 'workouts' || m.kind === 'load' || m.kind === 'strain') return v > 0 ? 'l' + Math.max(1, level(v, m.levels)) : 'rest';
    if (m.kind === 'sparse') return 'measured';
    // stress (0-3): its own three bands, low < 1, medium 1-2, high >= 2 (lib/score/stress.mjs)
    if (m.kind === 'stress') return v >= 2 ? 'shigh' : v >= 1 ? 'smedium' : 'slow';
    // energy bank (0-100): the recovery dial's thirds (HC_BAND.pctBand, lib/score/recovery.mjs)
    if (m.kind === 'bank') return { good: 'good', mid: 'mid', low: 'bad' }[HC_BAND.pctBand(v)] || 'bad';
    // nutrition score (0-100): its own bands (m.bands, lib/nutrition/score.mjs NSCORE.bands)
    if (m.kind === 'nscore') return v >= m.bands.good ? 'good' : v >= m.bands.mid ? 'mid' : 'bad';
    if (m.kind === 'recovery') return v >= m.cut ? 'good' : v <= -m.cut ? 'bad' : 'normal';
    if (m.kind === 'sleep') {
      if (m.target != null && v >= m.target) return 'good';
      return m.band && v < m.band.lo ? 'bad' : 'mid';
    }
    var b = m.band;
    if (!b) return 'normal';
    var side = v > b.hi ? 1 : v < b.lo ? -1 : 0;
    if (!side) return 'normal';
    if (m.dir === 0) return m.kind === 'total' ? (side > 0 ? 'hi' : 'lo') : 'watch';
    return side === m.dir ? 'good' : 'bad';
  }
  // [state, label] per calendar state of a metric (the legend's order), without "no data"
  function legendItems(m) {
    var L = T.legend, items;
    if (m.kind === 'workouts' || m.kind === 'load' || m.kind === 'strain') items = [['l1', ''], ['l2', ''], ['l3', ''], ['l4', L.levels]];
    else if (m.kind === 'sparse') items = [['measured', L.measured]];
    else if (m.kind === 'stress') items = [['slow', L.stressLow], ['smedium', L.stressMedium], ['shigh', L.stressHigh]];
    else if (m.kind === 'bank') items = [['good', L.energyHigh], ['mid', L.energyMid], ['bad', L.energyLow]];
    else if (m.kind === 'nscore') items = [['good', L.nsGood], ['mid', L.nsMid], ['bad', L.nsLow]];
    else if (m.kind === 'recovery') items = [['good', L.recAbove], ['normal', L.recAt], ['bad', L.recBelow]];
    else if (m.kind === 'sleep') items = [['good', L.sleepGood], ['mid', L.sleepMid], ['bad', L.sleepBad]];
    else if (!m.band) items = [['normal', L.measured]];
    else if (m.dir === 0 && m.kind === 'total') items = [['hi', L.hi], ['normal', L.normal], ['lo', L.lo]];
    else if (m.dir === 0) items = [['normal', L.normal], ['watch', L.watch]];
    else items = [['good', L.good], ['normal', L.normal], ['bad', L.bad]];
    return items;
  }

  /* ---------- the trend windows and their average ---------- */
  // the first day of a `days`-long window ending at `end`, clamped to the metric's first day
  function windowFrom(m, end, days) {
    var from = shiftIso(end, -(days - 1));
    return from < m.start ? m.start : from;
  }
  function meanOf(m, from, to) {
    var s = 0, n = 0;
    for (var d = from; d <= to; d = shiftIso(d, 1)) {
      var v = at(m.v, m, d);
      if (v == null || isPartial(m, d)) continue; // a total still filling up today never counts
      s += v;
      n++;
    }
    return { avg: n ? s / n : null, n: n };
  }
  // The trend view's numbers for one window (pure; exposed as HCDetail.periodStats): the mean of the
  // days with data in [end − days + 1, end] (clamped to the data's first day) and, when the previous
  // window of the same length lies wholly inside the data and holds data, the delta vs its mean —
  // absolute for recovery (sd units around 0), else a percentage. tone: good / bad by the metric's
  // good direction, normal when about the same or the metric has none.
  function periodStats(m, end, days) {
    var from = windowFrom(m, end, days), clamped = from !== shiftIso(end, -(days - 1));
    var cur = meanOf(m, from, end);
    var out = { from: from, to: end, clamped: clamped, avg: cur.avg, n: cur.n, prev: null, delta: null, pct: null, flat: true, tone: 'normal' };
    var pFrom = shiftIso(from, -days), pTo = shiftIso(from, -1);
    if (cur.avg == null || clamped || pTo < m.start) return out;
    // a previous window that starts before the data still compares when at least half its days hold
    // data (a 6-month view on 7 months of data); wholly inside the data, any day with data is enough
    var partial = pFrom < m.start;
    var prev = meanOf(m, partial ? m.start : pFrom, pTo);
    if (prev.avg == null || (partial && prev.n < Math.ceil(days / 2))) return out;
    out.prev = prev.avg;
    out.delta = cur.avg - prev.avg;
    var flat;
    if (m.kind === 'recovery') flat = Math.abs(out.delta) < DELTA_FLAT_REC;
    else {
      out.pct = prev.avg ? 100 * out.delta / Math.abs(prev.avg) : null;
      flat = out.pct == null || Math.abs(out.pct) < 100 * DELTA_FLAT;
    }
    out.flat = flat;
    if (!flat && m.dir) out.tone = (out.delta > 0) === (m.dir > 0) ? 'good' : 'bad';
    return out;
  }
  // the trend window: `shift` whole windows back from the view end (‹ › stepping; 0 = ends today)
  function windowEnd(m, end, range, shift) {
    return shiftIso(end, -(shift || 0) * range);
  }
  // the 7-day line of one view: recovery = each day's baked trend, weight / energy = the card's baked
  // rolling average, other dense series = roll7; sparse readings without a baked line have none.
  // Cached per (metric, range): a re-render of the same view never recomputes it.
  function lineFor(key, m, from, n) {
    var ck = key + '|' + from + '|' + n;
    if (own(lineCache, ck)) return lineCache[ck];
    var line = [];
    for (var i = 0; i < n; i++) {
      var iso = shiftIso(from, i);
      if (m.kind === 'recovery') line.push(at(m.t7, m, iso));
      else if (Array.isArray(m.roll)) line.push(at(m.roll, m, iso));
      else if (m.kind === 'sparse') line.push(null);
      else line.push(roll7(m, iso));
    }
    lineCache[ck] = line;
    return line;
  }

  /* ---------- month calendar ---------- */
  function monthOf(iso) {
    return iso.slice(0, 8) + '01';
  }
  function addMonths(first, k) {
    var d = parseIso(first);
    d.setMonth(d.getMonth() + k, 1);
    return HC.isoOf(d);
  }

  return {
    T: T, D: D, RANGES: RANGES, RANGE_KEY: RANGE_KEY,
    dayDiff: dayDiff, own: own, viewOf: viewOf, metric: metric, stressMetric: stressMetric, energyMetric: energyMetric, at: at,
    valueOf: valueOf, lastDataDate: lastDataDate, isPartial: isPartial, stateOn: stateOn, viewEnd: viewEnd, targetOf: targetOf,
    roll7: roll7, sessionsOn: sessionsOn, modOf: modOf,
    fmt: fmt, signed: signed, pct: pct, fmtM: fmtM, signedM: signedM, clock: clock, unitOf: unitOf, titleOf: titleOf, valUnit: valUnit,
    dayState: dayState, legendItems: legendItems,
    windowFrom: windowFrom, meanOf: meanOf, periodStats: periodStats, windowEnd: windowEnd, lineFor: lineFor,
    monthOf: monthOf, addMonths: addMonths,
  };
};
