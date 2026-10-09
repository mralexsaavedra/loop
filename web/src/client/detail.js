/* Detail sheet: a tap on any card opens its metric full-screen (phones) or as a large centred panel
 * (desktop): header (metric, latest value + date, personal band / target), a W / M / 6M / 1Y
 * range switch with the period's average + a delta pill vs the previous period of the same length, a chart (daily points or bars, the 7-day average line, the personal band; a
 * missing day is a gap, never 0), a Monday-first month calendar coloured by state tokens against that
 * band / target, and the picked day's detail underneath.
 *
 * Classic script (is:inline, no module scope). Reads DETAIL (lib/detail/detail.mjs) + I18N_DETAIL, both
 * baked by components/DetailSheet.astro, and the shared helpers of util.js (window.HC). Openers are any
 * element with data-detail="<metric>" [data-date="<iso>"] (HC.detailAttrs writes them): one delegated
 * click / keydown listener, so the card renderers never wire handlers. The view ends at the VIEWER's
 * today (Date.now(), never baked), or at the data's own asOf when that is stale or ahead of the clock.
 *
 * The header never contradicts the card it opens from. The three dial views (sleep, recovery,
 * load-<m>) are laid out by client/deepdive.js (inlined right before this script): "‹ TODAY ⓘ", the
 * hero ring = the dial's own baked arcs, an insight card with the dial's captions; weight /
 * energy = the cards' 7-day rolling average (baked `roll`), and a daily total's newest day, when it is
 * the viewer's today, is "today, in progress" (neutral colour, never compared). Band colours are static
 * (the current range) except recovery, which is scored per day; the sheet says which.
 *
 * Modal contract: role="dialog" + aria-modal on #detail, the page behind is `inert` + aria-hidden, focus
 * moves to the close button, Tab stays inside, Esc / the close button / a tap on the backdrop close it,
 * and focus returns to the opener (no opener, e.g. a deep link: the visible tab's heading). History:
 * opening pushes #detail/<metric>[/<date>] so browser Back closes it; a page opened with that hash opens
 * the view (deep link; the metric must be an own key of DETAIL and the copy, a bad date falls back and
 * the URL follows). The entry underneath is the open tab's hash (#nutricion, core.js), so Back lands
 * there; closing a deep-linked sheet (no entry of ours) rewrites the URL to that tab hash
 * (window.HCNav.hash(), core.js shows the deep link's host tab underneath). A re-open while the close's history.back() is in flight waits for its popstate
 * before writing history. Every view renders inside a try/catch with a message fallback; no NaN is ever
 * printed (non-finite values render as a dash). A day tap re-renders only the calendar + day panel.
 *
 * Registered views: another script (inlined BEFORE this one) may add window.HCViews[<key>] =
 * {title(), render() -> {head, body}} (client/profile.js adds `profile`). An opener with
 * data-detail="<key>" then opens that view in this same modal (focus, inert, Esc, Back), with the deep
 * link #<key> instead of #detail/<metric>; a view that throws gets the same message fallback.
 */
(function () {
  var host = document.getElementById('detail');
  var T = typeof I18N_DETAIL === 'undefined' ? null : I18N_DETAIL;
  if (!host || !T) return;
  var D = typeof DETAIL === 'undefined' || !DETAIL ? { asOf: null, metrics: {}, sessions: [] } : DETAIL;
  var esc = HC.esc, format = HC.format, isoDate = HC.isoDate, parseIso = HC.parseIso, shiftIso = HC.shiftIso;
  // W / M / 6M / 1Y (days); a range longer than the data is clamped to the metric's first day
  var RANGES = [7, 30, 182, 365];
  // lower bounds of HR zones 1-5, % of max HR (lib/training/hr-zones.cjs ZONE_CUTS)
  var ZONE_CUTS = [50, 60, 70, 80, 90];
  var RANGE_KEY = { 7: 'w', 30: 'm', 182: 'm6', 365: 'y' };
  // a delta below this share (or below DELTA_FLAT_REC sd for recovery) is "about the same": neutral
  var DELTA_FLAT = 0.01, DELTA_FLAT_REC = 0.05;
  // chart geometry (SVG user units): width, height, inner padding
  var CW = 320, CH = 140, CPAD = 8;
  // a 7-day average needs at least 3 days with data (same floor as the recovery trend)
  var ROLL_DAYS = 7, ROLL_MIN = 3;
  // overnight signals: their day detail is the whole night (sleep, bed / wake, the night's signals)
  var NIGHT_KEYS = ['sleep', 'recovery', 'hrv', 'rhr', 'respiratory', 'wristTemp'];
  var HASH_RE = /^#detail\/([A-Za-z-]+)(?:\/(\d{4}-\d{2}-\d{2}))?$/;
  // a registered view (window.HCViews, e.g. the profile sheet of client/profile.js) deep-links as #<key>
  var VIEW_HASH_RE = /^#([a-z][a-z-]*)$/;
  // registered after page load (client/food-*.js once GET /api/food/products answers, client/journal.js
  // once GET /api/journal/settings answers)
  var ASYNC_VIEWS = ['food-add', 'journal'];
  // daily totals whose newest day fills up during the day (the extract's "so far" value)
  var PARTIAL_KINDS = ['total', 'nscore'];
  // kinds whose missing recent days mean stale data (a sparse reading or a rest day is not staleness)
  var STALE_KINDS = ['signal', 'sleep', 'recovery', 'total'];
  // the Tab trap's stops, in document order: buttons, folds, a radio group's checked radio and form
  // fields (a registered view may hold a small form, e.g. the food log's add sheet)
  var TRAP = 'button:not([disabled]), summary, input[type="radio"]:checked, input:not([type="radio"]):not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
  var state = null;
  var opener = null;
  // true between close()'s history.back() and its popstate: history must not be written meanwhile
  var pendingBack = false;
  // the 7-day line per (metric, range): computed once, reused by every re-render of that view
  var lineCache = {};

  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-labelledby', 'dt-title');

  /* ---------- data access ---------- */
  function dayDiff(a, b) {
    return Math.round((parseIso(b) - parseIso(a)) / HC.MS_PER_DAY);
  }
  function own(o, k) {
    return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  }
  // views registered by other scripts before this one: {<key>: {title(): string, render(): {head, body}}}
  function viewOf(key) {
    var all = typeof window !== 'undefined' && window.HCViews && typeof window.HCViews === 'object' ? window.HCViews : null;
    var v = own(all, key) ? all[key] : null;
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
  // the dashed target line: a baked target (sleep), else the owner's target weight on the weight view
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
    // energy bank (0-100): the recovery dial's thirds, high >= 67, middle 34-66, low < 34
    if (m.kind === 'bank') return v >= 67 ? 'good' : v >= 34 ? 'mid' : 'bad';
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

  /* ---------- header ---------- */
  function bandText(key, m) {
    var B = T.bands, u = unitOf(key), d = Math.min(m.dec + 1, 2);
    var fill = function (b, dec) { return { lo: fmtM(m, b.lo, dec), hi: fmtM(m, b.hi, dec), median: fmtM(m, b.median, dec), unit: u }; };
    var out = [];
    var tg = targetOf(key, m);
    if ((m.kind === 'sleep' || key === 'weight') && tg != null) out.push(format(B.target, { value: fmtM(m, tg, 1), unit: u }));
    if ((m.kind === 'signal' || m.kind === 'sleep') && m.band) out.push(format(B.monitor, fill(m.band, d)));
    if (m.kind === 'total' && m.band) out.push(format(B.iqr, fill(m.band, m.dec)));
    if (m.kind === 'load') out.push(m.typical != null ? format(B.typical, { value: fmt(m.typical, 0) }) : B.noTypical);
    if (m.kind === 'strain' && B.strain) out.push(B.strain);
    if (m.kind === 'stress' && B.stress) out.push(B.stress);
    if (m.kind === 'bank' && B.bank) out.push(B.bank);
    if (m.kind === 'nscore' && B.nscore) out.push(B.nscore);
    if (m.kind === 'recovery') out.push(format(B.recovery, { cut: fmt(m.cut, 1), cutTrend: fmt(m.cutTrend != null ? m.cutTrend : m.cut, 1) }));
    if (m.kind === 'sparse') out.push(format(B.sparse, { n: m.v.filter(function (x) { return x != null; }).length }));
    if (m.windowDays != null) out.push(format(B.window, { days: m.windowDays }));
    // bands are the CURRENT range (as of the newest day); recovery is scored against each day's own baseline
    if (m.kind === 'recovery') out.push(B.perDayNote);
    else if (m.band && (m.kind === 'signal' || m.kind === 'sleep' || m.kind === 'total')) out.push(B.staticNote);
    return out.map(function (s) { return '<div class="dt-band-txt">' + esc(s) + '</div>'; }).join('');
  }
  function head(key, inner) {
    return HC.sheetHead({ title: titleOf(key), back: (T.deep && T.deep.back) || T.close }) + (inner ? '<div class="dt-titles">' + inner + '</div>' : '');
  }
  // a metric's sheet = the trend view: "‹ TREND VIEW" (the metric stays the dialog's label for screen
  // readers), then the metric picker pill
  // `info`: the latest value + the band / target words, collapsed under ⓘ (the same toggle as the dial
  // pages' notes): the window's average leads the view, the chart labels the newest value
  function trendHead(key, info) {
    var R = T.trend, I = T.deep && T.deep.info;
    return HC.sheetHead({ title: R.title, sr: titleOf(key), back: (T.deep && T.deep.back) || T.close, info: info && I ? { controls: 'dd-info', label: I } : null }) +
      (info && I ? '<div class="dd-info dt-info" id="dd-info" hidden>' + info + '</div>' : '') + pickerHtml(key);
  }
  // the metrics a trend view can switch to: every baked metric with copy, except the dial pages
  // (sleep, recovery, strain, load-<m>: their own deep-dive layout, reached from the dials), + the
  // nutrition score the page scores (client/nutri-score.js) when it has a scored day
  function trendKeys() {
    return Object.keys(D.metrics).concat(['nutrition']).filter(function (k) { return own(T.metrics, k) && !!metric(k) && !deep(k); });
  }
  // a native <select> dressed as a pill with a ⌄ (keyboard, screen readers and the phone's own picker
  // for free); a change re-opens the sheet on that metric (the 'change' listener below)
  function pickerHtml(key) {
    var keys = trendKeys();
    if (keys.length < 2) return '';
    return '<label class="dt-metric"><span class="sr-only">' + esc(T.trend.metric) + '</span><select class="dt-metric-sel sel" data-dt-pick="metric">' +
      keys.map(function (k) { return '<option value="' + esc(k) + '"' + (k === key ? ' selected' : '') + '>' + esc(titleOf(k)) + '</option>'; }).join('') +
      '</select><span class="chev sel-chev" aria-hidden="true">›</span></label>';
  }
  function noneHtml(txt) {
    return '<div class="dt-latest"><span class="dt-none">' + esc(txt) + '</span></div>';
  }
  function subsHtml(subs) {
    return (subs || []).map(function (x) { return '<div class="dt-sub' + (x.cls ? ' ' + esc(x.cls) : '') + '">' + esc(x.text) + '</div>'; }).join('');
  }
  // big number + unit (+ a word) + when, then optional secondary lines [{cls, text}]
  function bigHtml(num, st, unit, when, word, subs) {
    return '<div class="dt-latest"><b class="dt-num dt-c-' + esc(st) + '">' + esc(num) + '</b>' + (unit ? '<small>' + esc(unit) + '</small>' : '') +
      (word ? '<span class="dt-word dt-c-' + esc(st) + '">' + esc(word) + '</span>' : '') +
      (when ? '<span class="dt-when">' + esc(when) + '</span>' : '') + '</div>' + subsHtml(subs);
  }
  // weight / energy: the card's 7-day rolling average (a partial today never sets it)
  function rollLatest(key, m, end) {
    var d = lastDataDate(m, end);
    if (!d) return noneHtml(T.noData);
    var u = unitOf(key), partial = isPartial(m, d);
    var ref = null;
    for (var k = Math.min(m.roll.length - 1, dayDiff(m.start, partial ? shiftIso(d, -1) : d)); k >= 0; k--) {
      if (typeof m.roll[k] === 'number' && isFinite(m.roll[k])) { ref = shiftIso(m.start, k); break; }
    }
    var subs = [];
    if (key === 'weight' && m.latest && isoDate(m.latest.date)) subs.push({ text: format(T.latestReading, { value: fmt(m.latest.value, m.dec), unit: u, date: HC.fmtDate(m.latest.date) }) });
    else if (partial) subs.push({ cls: 'dt-c-partial', text: format(T.latestDaySoFar, { value: fmt(valueOf(m, d), m.dec), unit: u }) });
    else subs.push({ text: format(T.latestDay, { value: fmt(valueOf(m, d), m.dec), unit: u, date: HC.fmtDate(d) }) });
    if (key === 'energy' && at(m.watch, m, d) != null) subs.push({ text: T.rideNote });
    if (!ref) return noneHtml(T.noData) + subsHtml(subs);
    return bigHtml(fmt(at(m.roll, m, ref), m.dec), 'normal', u, format(T.roll7Lbl, { date: HC.fmtDate(ref) }), '', subs);
  }
  // the dial views (sleep, recovery, load-<m>) lay their top out in client/deepdive.js
  function latestHtml(key, m, end) {
    if (Array.isArray(m.roll) && (key === 'weight' || key === 'energy')) return rollLatest(key, m, end);
    var d = lastDataDate(m, end);
    if (!d) return noneHtml(T.noData);
    var v = valueOf(m, d);
    if (m.kind === 'workouts' && v === 0) return bigHtml(T.restDay, 'rest', '', HC.fmtDate(d), '', []);
    var partial = isPartial(m, d), num = fmtM(m, v, m.dec);
    // a series clamped to a reference range (fitness age: lo / hi): a value at a bound = that age or beyond
    if (typeof m.lo === 'number' && v <= m.lo) num = '≤ ' + fmt(m.lo, 0);
    else if (typeof m.hi === 'number' && v >= m.hi) num = '≥ ' + fmt(m.hi, 0);
    return bigHtml(num, stateOn(m, d, v), unitOf(key), partial ? T.todaySoFar : format(T.latestLbl, { date: HC.fmtDate(d) }), '', []);
  }
  // the metric's own newest day is > STALE_DAYS before the view end: say so
  function metricStaleHtml(m, end) {
    if (STALE_KINDS.indexOf(m.kind) === -1) return '';
    var d = lastDataDate(m, end);
    if (!d || dayDiff(d, end) <= HC.STALE_DAYS) return '';
    return '<p class="dt-stale dt-mstale">' + esc(format(T.metricStale, { date: HC.fmtDate(d) })) + '</p>';
  }

  /* ---------- range switch + the period's average ---------- */
  function rangeHtml(range) {
    return '<div class="dt-range" role="group" aria-label="' + esc(T.rangeLabel) + '">' + RANGES.map(function (r) {
      var k = RANGE_KEY[r];
      return '<button type="button" data-dt-act="range" data-range="' + r + '" aria-pressed="' + (r === range ? 'true' : 'false') + '" aria-label="' + esc(T.rangesLong[k]) + '">' + esc(T.ranges[k]) + '</button>';
    }).join('') + '</div>';
  }
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
  // one plain sentence under the pill: the window's average vs the previous window's (no judgement:
  // the pill's colour carries good / bad)
  function sentenceOf(key, m, st, range) {
    var S = T.trend.sent, k = RANGE_KEY[range], dec = m.kind === 'sleep' ? 1 : m.dec, u = unitOf(key);
    // a real change (not flat) that rounds to the same number gets one more decimal, so "lower than"
    // never sits next to two equal numbers
    if (st.delta != null && !st.flat && fmtM(m, st.avg, dec) === fmtM(m, st.prev, dec)) dec = Math.min(dec + 1, 3);
    var show = function (v) { return m.kind === 'recovery' ? signed(v, 1) + ' ' + u : m.kind === 'sleep' ? HC.hours(v) : valUnit(v, dec, u); };
    var vars = { metric: titleOf(key), span: T.trend.span[k], prevSpan: T.trend.prevSpan[k], avg: st.avg == null ? '' : show(st.avg), prev: st.prev == null ? '' : show(st.prev) };
    if (st.avg == null) return format(S.none, vars);
    if (st.delta == null) return format(S.only, vars);
    // h:mm has no decimal to add: two windows that print the same clock read "about the same"
    var same = st.flat || (st.prev != null && vars.avg === vars.prev);
    return format(same ? S.flat : st.delta > 0 ? S.up : S.down, vars);
  }
  function trendHtml(key, m, st, range) {
    var R = T.trend, dec = m.kind === 'sleep' ? 1 : m.dec;
    var avg = m.kind === 'recovery' ? signed(st.avg, 1) : fmtM(m, st.avg, dec);
    var pill = '';
    if (st.delta != null) {
      var arrow = st.flat ? '•' : st.delta > 0 ? '▲' : '▼';
      var amount = m.kind === 'recovery' ? signed(st.delta, 1) + ' ' + unitOf(key) : (st.pct == null ? '—' : HC.pct(Math.abs(st.pct)));
      pill = '<span class="dt-pill dt-pill-' + esc(HC.trendTone(st.flat ? 'flat' : 'up', st.tone)) + '">' + esc(arrow + ' ' + amount + ' ' + R.vs[RANGE_KEY[range]]) + '</span>';
    } else if (st.avg != null) {
      pill = '<span class="dt-pill dt-pill-none">' + esc(st.clamped ? format(R.since, { date: HC.fmtDate(st.from) }) : R.noPrev) + '</span>';
    }
    return '<div class="dt-trend"><span class="dt-trend-lbl">' + esc(R.avg) + '</span>' +
      '<div class="dt-trend-row"><b class="dt-trend-num">' + esc(st.avg == null ? '—' : avg) + '</b>' + (st.avg != null && unitOf(key) ? '<small>' + esc(unitOf(key)) + '</small>' : '') + '</div>' +
      (pill ? '<div class="dt-trend-pill">' + pill + '</div>' : '') + '<p class="dt-trend-txt">' + esc(sentenceOf(key, m, st, range)) + '</p></div>';
  }
  // the trend window: `shift` whole windows back from the view end (‹ › stepping; 0 = ends today)
  function windowEnd(m, end, range, shift) {
    return shiftIso(end, -(shift || 0) * range);
  }
  // ‹ 23 Sep – 29 Sep, 26 ›: back while the previous window still reaches the data, forward until today
  function winHtml(m, from, to, range, shift) {
    var R = T.trend, back = shiftIso(to, -range) >= m.start;
    var lbl = format(R.win, { from: HC.fmtDate(from, { weekday: false }), to: HC.fmtDate(to, { weekday: false }), yy: to.slice(2, 4) });
    return '<div class="dt-win" role="group" aria-label="' + esc(R.winAria) + '">' +
      '<button type="button" class="nav-btn" data-dt-act="win" data-wdir="-1" aria-label="' + esc(R.prevWin) + '"' + (back ? '' : ' disabled') + '><span class="chev" aria-hidden="true">‹</span></button>' +
      '<span class="dt-win-lbl">' + esc(lbl) + '</span>' +
      '<button type="button" class="nav-btn" data-dt-act="win" data-wdir="1" aria-label="' + esc(R.nextWin) + '"' + (shift > 0 ? '' : ' disabled') + '><span class="chev" aria-hidden="true">›</span></button></div>';
  }
  function periodHtml(key, m, end, range, shift) {
    var to = windowEnd(m, end, range, shift);
    return '<div class="dt-period">' + rangeHtml(range) + winHtml(m, windowFrom(m, to, range), to, range, shift) +
      trendHtml(key, m, periodStats(m, to, range), range) + '</div>';
  }

  /* ---------- chart ---------- */
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
  // x of a day's slot in the chart, from the geometry of the chart last drawn
  function selX(sel) {
    var g = state.geo;
    var i = g && sel ? dayDiff(g.from, sel) : -1;
    return g && i >= 0 && i < g.n ? CPAD + g.slot * i : null;
  }
  // three evenly spaced round values around [lo, hi] (bars: from 0), for the chart's Y axis
  function yTicks(lo, hi, bars) {
    var span = (bars ? hi : hi - lo) || 1, raw = span / 2;
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), step = 10 * p;
    [1, 2, 2.5, 5].some(function (k) { if (k * p >= raw) { step = k * p; return true; } return false; });
    var mid = bars ? step : Math.round((lo + hi) / 2 / step) * step;
    return [mid - step, mid, mid + step].map(function (t) { return Math.round(t * 1000) / 1000; });
  }
  // a points chart longer than this (6M, 1Y) shows only the out-of-range days as dots
  var THIN_DAYS = 60;
  // inside the shaded zone: recovery's day cut (|v| < cut, the calendar's "at baseline"), else the band
  function inRange(m, v) {
    if (m.kind === 'recovery') return Math.abs(v) < m.cut;
    return !m.band || (v >= m.band.lo && v <= m.band.hi);
  }
  // W (7 days): bars with their value on top and a weekday + day label under each, like the dial
  // pages' weekly cards (recovery keeps its points: its scale is signed around the baseline)
  var WEEK_BARS = 7;
  function chartHtml(key, m, from, to, sel) {
    var n = dayDiff(from, to) + 1;
    var week = n <= WEEK_BARS && m.kind !== 'recovery';
    var bars = week || m.kind === 'total' || m.kind === 'workouts' || m.kind === 'load' || m.kind === 'strain';
    var days = [], vals = [];
    for (var i = 0; i < n; i++) {
      var iso = shiftIso(from, i), v = valueOf(m, iso);
      days.push({ iso: iso, v: v });
      if (v != null) vals.push(v);
    }
    // the week's bars stand alone: no 7-day line over seven days
    var line = week ? [] : lineFor(key, m, from, n);
    // the recovery zone is the 7-day TREND band (the line); the daily points carry the day band
    var zc = m.kind === 'recovery' ? (m.cutTrend != null ? m.cutTrend : m.cut) : null;
    var ext = vals.concat(line.filter(function (x) { return x != null; }));
    var tg = targetOf(key, m);
    if (m.band) ext.push(m.band.lo, m.band.hi);
    if (tg != null) ext.push(tg);
    if (m.typical != null) ext.push(m.typical);
    if (zc != null) ext.push(zc, -zc);
    var lo = bars ? 0 : Math.min.apply(null, ext.length ? ext : [0]);
    var hi = Math.max.apply(null, ext.length ? ext : [1]);
    // 3 Y ticks on round numbers (step 1 / 2 / 2.5 / 5 × 10^k); the range widens to cover them, plus
    // 12 % headroom, so the outermost (out-of-range) days never sit on the chart's edge (bars: 8 %, and
    // a week's bars 18 % for the value labels on top)
    var tk = yTicks(lo, hi, bars);
    lo = Math.min(lo, tk[0]);
    hi = Math.max(hi, tk[2]);
    if (!bars) { var pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad; } else hi = hi * (week ? 1.18 : 1.08) || 1;
    var slot = (CW - 2 * CPAD) / n;
    var x = function (i) { return CPAD + slot * (i + 0.5); };
    var y = function (v) { return CPAD + (CH - 2 * CPAD) * (1 - (v - lo) / (hi - lo)); };
    var f = function (v) { return v.toFixed(1); };
    var pctX = function (i) { return (x(i) / CW * 100).toFixed(1) + '%'; };
    var pctY = function (v) { return (y(v) / CH * 100).toFixed(1) + '%'; };
    var out = ['<svg class="dt-chart" viewBox="0 0 ' + CW + ' ' + CH + '" role="img" aria-label="' +
      esc(format(T.chartAria, { title: titleOf(key), from: HC.fmtDate(from), to: HC.fmtDate(to) })) + '">'];
    var hline = function (cls, v) { out.push('<line class="' + cls + '" x1="0" x2="' + CW + '" y1="' + f(y(v)) + '" y2="' + f(y(v)) + '"/>'); };
    var zone = function (a, b) { out.push('<rect class="dt-band" x="0" width="' + CW + '" y="' + f(y(b)) + '" height="' + f(Math.max(0, y(a) - y(b))) + '"/>'); };
    tk.slice().reverse().forEach(function (t) { hline('dt-grid', t); });
    if (zc != null) { zone(-zc, zc); hline('dt-med', 0); }
    else if (m.band) { zone(m.band.lo, m.band.hi); hline('dt-med', m.band.median); }
    if (tg != null) hline('dt-target', tg);
    if (m.typical != null) hline('dt-target', m.typical);
    // the selected day's slot: always drawn (hidden outside the range) so a day tap only moves it
    state.geo = { from: from, n: n, slot: slot };
    var sx = selX(sel);
    out.push('<rect class="dt-sel" x="' + f(sx == null ? 0 : sx) + '" y="0" width="' + f(slot) + '" height="' + CH + '"' + (sx == null ? ' visibility="hidden"' : '') + '/>');
    var bw = Math.max(0.6, slot * (week ? 0.42 : 0.7)), r = n > 120 ? 1.3 : n > 45 ? 1.8 : 2.4;
    var dec = m.kind === 'sleep' ? 1 : m.dec, labels = [];
    // a long window (6M / 1Y) of points: only the days OUT of the range get a dot, the 7-day line
    // carries the rest, so the dots never saturate the chart
    var thin = !bars && n > THIN_DAYS && (m.kind === 'recovery' || !!m.band);
    var drawn = [];
    days.forEach(function (d, i) {
      if (d.v == null || (thin && inRange(m, d.v))) return;
      var st = stateOn(m, d.iso, d.v);
      if (drawn.indexOf(st) < 0 && !(bars && d.v <= 0)) drawn.push(st);
      if (bars) {
        if (week) labels.push('<span class="dt-bv" style="left:' + pctX(i) + ';top:' + pctY(Math.max(0, d.v)) + '">' + esc(fmtM(m, d.v, dec)) + '</span>');
        if (d.v <= 0) return;
        out.push('<rect class="dt-bar dt-s-' + st + '" x="' + f(x(i) - bw / 2) + '" y="' + f(y(d.v)) + '" width="' + f(bw) + '" height="' + f(Math.max(0.5, y(0) - y(d.v))) + '"/>');
      } else {
        out.push('<circle class="dt-pt dt-s-' + st + '" cx="' + f(x(i)) + '" cy="' + f(y(d.v)) + '" r="' + r + '"/>');
      }
    });
    // the 7-day line breaks where the average is undefined, so a gap never reads as a trend; a sparse
    // series (weigh-ins days apart) joins its rolling points, which exist only on reading days
    var path = '', pen = false, join = m.kind === 'sparse';
    line.forEach(function (v, i) {
      if (v == null) { if (!join) pen = false; return; }
      path += (pen ? ' L' : ' M') + f(x(i)) + ',' + f(y(v));
      pen = true;
    });
    if (path) out.push('<path class="dt-line" d="' + path.trim() + '"/>');
    // the window's newest value, labelled (a week's bars already carry every value): a ring on it
    // and its number above
    if (!week) {
      for (var j = days.length - 1; j >= 0; j--) {
        if (days[j].v == null) continue;
        var ly = bars ? Math.max(0, days[j].v) : days[j].v;
        out.push('<circle class="dt-last" cx="' + f(x(j)) + '" cy="' + f(y(ly)) + '" r="3.2"/>');
        labels.push('<span class="dt-lastv" style="left:' + pctX(j) + ';top:' + pctY(ly) + '">' + esc(fmtM(m, days[j].v, dec)) + '</span>');
        break;
      }
    }
    out.push('</svg>');
    var key2 = drawn.length ? ['<span class="dt-k dt-k-pts ' + (thin ? 'dt-k-out' : 'dt-k-daily') + '">' + keyMarks(m, drawn, bars) + esc(thin ? T.chartKey.outside : T.chartKey.daily) + '</span>'] : [];
    if (line.some(function (v) { return v != null; })) key2.push('<span class="dt-k dt-k-line">' + esc(T.chartKey.roll7) + '</span>');
    if (tg != null) key2.push('<span class="dt-k dt-k-target">' + esc(T.chartKey.target) + '</span>');
    if (m.typical != null) key2.push('<span class="dt-k dt-k-target">' + esc(T.chartKey.typical) + '</span>');
    // the shaded band is named once, top-right of the chart
    var band = zc != null ? T.trend.baseline : m.band ? T.trend.typical : '';
    var tdec = tk[1] - tk[0] < 0.1 ? 2 : tk[1] - tk[0] < 1 ? 1 : 0;
    var yax = '<div class="dt-yax" aria-hidden="true">' + tk.slice().reverse().map(function (t) {
      return '<span style="top:' + (y(t) / CH * 100).toFixed(1) + '%">' + esc(fmtM(m, t, tdec)) + '</span>';
    }).join('') + '</div>';
    var N = typeof I18N_DATE !== 'undefined' && I18N_DATE ? I18N_DATE.weekdays : null;
    var axis = week && N
      ? '<div class="dt-wdays" aria-hidden="true">' + days.map(function (d, i) {
        return '<span style="left:' + pctX(i) + '">' + esc(N[HC.weekdayIndex(d.iso)]) + '<b>' + esc(String(parseIso(d.iso).getDate())) + '</b></span>';
      }).join('') + '</div>'
      : '<div class="dt-ax"><span>' + esc(HC.fmtDate(from)) + '</span><span>' + esc(HC.fmtDate(to)) + '</span></div>';
    return '<figure class="dt-fig">' + (band ? '<div class="dt-fig-top"><span class="dt-typ">' + esc(band) + '</span></div>' : '') +
      '<div class="dt-plot"><div class="dt-svg">' + out.join('') + (labels.length ? '<div class="dt-labels" aria-hidden="true">' + labels.join('') + '</div>' : '') + '</div>' + yax + '</div>' +
      axis + '<figcaption class="dt-keys">' + key2.join('') + '</figcaption></figure>';
  }

  /* ---------- the window's days by range ---------- */
  // one stacked bar of the window's days with data, by calendar state (the legend's order and colours),
  // + a count per state ("6x"); "Learn more" opens the ⓘ notes. Training volume (four shades of one
  // colour), sparse readings and a metric without a band have no states worth counting: nothing.
  var BRK_SKIP = ['workouts', 'load', 'strain', 'sparse'];
  function breakdownHtml(m, from, to) {
    var items = BRK_SKIP.indexOf(m.kind) === -1 ? legendItems(m) : [];
    if (items.length < 2) return '';
    var n = {}, tot = 0, B = T.trend.brk;
    items.forEach(function (it) { n[it[0]] = 0; });
    for (var d = from; d <= to; d = shiftIso(d, 1)) {
      var v = valueOf(m, d), st = v == null ? 'none' : stateOn(m, d, v);
      if (!own(n, st)) continue; // no data, today in progress
      n[st]++;
      tot++;
    }
    if (!tot) return '';
    var bar = items.filter(function (it) { return n[it[0]] > 0; }).map(function (it) {
      return '<i class="dt-s-' + it[0] + '" style="width:' + (Math.round((1000 * n[it[0]]) / tot) / 10) + '%"></i>';
    }).join('');
    return '<section class="dt-brk" aria-label="' + esc(B.title) + '"><div class="dt-brk-top"><h3 class="dt-brk-t">' + esc(B.title) + '</h3>' +
      HC.cta(B.learn, ' data-dt-act="learn"') + '</div>' +
      '<div class="dt-brk-bar" aria-hidden="true">' + bar + '</div><ul class="dt-brk-leg">' + items.map(function (it) {
        return '<li data-st="' + it[0] + '"><span class="dt-sw dt-s-' + it[0] + '" aria-hidden="true"></span>' + esc(it[1]) + '<b>' + esc(format(B.count, { n: n[it[0]] })) + '</b></li>';
      }).join('') + '</ul></section>';
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
  // the chart key's daily swatch: one mark per state the window actually drew, in the legend's order,
  // with the chart marks' own state classes — so "Daily" shows the dots' colours, never a stand-in blue
  function keyMarks(m, drawn, bars) {
    var order = legendItems(m).map(function (it) { return it[0]; });
    var rank = function (st) { var i = order.indexOf(st); return i < 0 ? order.length : i; };
    var sts = drawn.slice().sort(function (a, b) { return rank(a) - rank(b); }), w = 10 * sts.length;
    return '<svg class="dt-k-sw" viewBox="0 0 ' + w + ' 10" width="' + w + '" height="10" aria-hidden="true">' + sts.map(function (st, i) {
      return bars ? '<rect class="dt-kd dt-s-' + esc(st) + '" x="' + (10 * i + 1) + '" y="1" width="8" height="8" rx="2"/>'
        : '<circle class="dt-kd dt-s-' + esc(st) + '" cx="' + (10 * i + 5) + '" cy="5" r="4"/>';
    }).join('') + '</svg>';
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
  function legendHtml(m) {
    var items = legendItems(m).concat([['none', T.legend.none]]);
    return '<div class="dt-legend">' + items.map(function (it) {
      return '<span class="dt-leg"><span class="dt-sw dt-s-' + it[0] + '" aria-hidden="true"></span>' + esc(it[1]) + '</span>';
    }).join('') + '</div>';
  }
  function calendarHtml(key, m, month, sel, end) {
    var first = monthOf(m.start), last = monthOf(end);
    var N = typeof I18N_DATE !== 'undefined' && I18N_DATE ? I18N_DATE.weekdaysMin : ['1', '2', '3', '4', '5', '6', '7'];
    var out = ['<div class="dt-cal-head"><button type="button" class="nav-btn" data-dt-act="month" data-dir="-1" aria-label="' + esc(T.prevMonth) + '"' + (month <= first ? ' disabled' : '') + '><span class="chev" aria-hidden="true">‹</span></button>' +
      '<h3 class="dt-month">' + esc(HC.fmtMonth(month)) + '</h3>' +
      '<button type="button" class="nav-btn" data-dt-act="month" data-dir="1" aria-label="' + esc(T.nextMonth) + '"' + (month >= last ? ' disabled' : '') + '><span class="chev" aria-hidden="true">›</span></button></div>'];
    out.push('<div class="dt-cal" role="group" aria-label="' + esc(format(T.calAria, { title: titleOf(key), month: HC.fmtMonth(month) })) + '">');
    N.forEach(function (w) { out.push('<span class="dt-wd">' + esc(w) + '</span>'); });
    var lead = HC.weekdayIndex(month);
    for (var b = 0; b < lead; b++) out.push('<span class="dt-blank"></span>');
    var next = addMonths(month, 1);
    for (var d = month; d < next; d = shiftIso(d, 1)) {
      var day = String(parseIso(d).getDate());
      if (d > end || d < m.start) { out.push('<span class="dt-day dt-out">' + day + '</span>'); continue; }
      var v = valueOf(m, d), st = stateOn(m, d, v);
      // the nutrition score's today while it is being logged: no score yet (v null), still a partial
      // mark ("in progress"), never "No data"
      var run = v == null && m.kind === 'nscore' && own(m.days, d) && m.days[d] && m.days[d].partial && T.day.ns;
      if (run) st = 'partial';
      var lbl = HC.fmtDate(d) + ': ' + (run ? T.day.ns.inProgress : v == null ? T.noData : (m.kind === 'recovery' ? signed(v, 1) : fmtM(m, v, m.dec)) + (unitOf(key) ? ' ' + unitOf(key) : '')) +
        (st === 'partial' && !run ? ' (' + T.todaySoFar + ')' : '');
      out.push('<button type="button" class="dt-day dt-s-' + st + '" data-dt-act="day" data-date="' + d + '" aria-pressed="' + (d === sel ? 'true' : 'false') + '" aria-label="' + esc(lbl) + '">' + day + '</button>');
    }
    out.push('</div>');
    return out.join('') + legendHtml(m);
  }

  /* ---------- day detail ---------- */
  function row(lbl, val, sub) {
    return '<div class="dt-row"><span class="dt-row-lbl">' + esc(lbl) + '</span><b class="dt-row-val">' + esc(val) + '</b>' + (sub ? '<small class="dt-row-sub">' + esc(sub) + '</small>' : '') + '</div>';
  }
  // that night's stage hours + efficiency (DETAIL sleep arrays), else the no-stages note
  function stagesDayHtml(sl, iso) {
    var get = function (k) { return sl && Array.isArray(sl[k]) ? at(sl[k], sl, iso) : null; };
    var rem = get('rem'), deep = get('deep'), core = get('core'), eff = get('eff');
    var out = '';
    if (rem != null && deep != null && core != null) {
      var awake = get('awake');
      out += row(T.day.stagesLbl, format(T.day.stages, { rem: HC.hours(rem), deep: HC.hours(deep), core: HC.hours(core), awake: HC.hours(awake) }));
    }
    if (eff != null) out += row(T.day.eff, HC.pct(eff));
    return out || '<p class="dt-note">' + esc(T.day.stagesNote) + '</p>';
  }
  function nightHtml(key, m, iso) {
    var out = [];
    var main = valueOf(m, iso);
    if (main == null) out.push('<p class="dt-nodata">' + esc(T.day.noData) + '</p>');
    var sl = metric('sleep');
    if (sl) {
      var h = at(sl.v, sl, iso);
      out.push(row(T.day.asleep, HC.hours(h), h != null && sl.target != null ? format(T.day.vsTarget, { delta: HC.hours(h - sl.target, true), target: HC.hours(sl.target) }) : ''));
      var bed = at(sl.bed, sl, iso), wake = at(sl.wake, sl, iso);
      if (bed != null || wake != null) out.push(row(T.day.bedWake, clock(bed) + '–' + clock(wake)));
    }
    var rec = metric('recovery');
    if (rec) {
      var rv = at(rec.v, rec, iso);
      if (rv != null) out.push(row(titleOf('recovery'), format(T.day.recValue, { value: signed(rv, 1), band: T.day.bands[rv >= rec.cut ? 'above' : rv <= -rec.cut ? 'below' : 'at'] })));
    }
    ['hrv', 'rhr', 'respiratory', 'wristTemp'].forEach(function (k) {
      var mk = metric(k);
      if (!mk) return;
      var v = at(mk.v, mk, iso);
      if (v != null || k === key) out.push(row(titleOf(k), valUnit(v, mk.dec, unitOf(k))));
    });
    if (key === 'sleep') out.push(stagesDayHtml(sl, iso));
    return out.join('');
  }
  // a stress day: its average (0-3) + band, and the minutes per band when the day is in the baked
  // SCORES.stress days (the last 14); older days have the average only
  function stressDayHtml(key, m, iso) {
    var v = valueOf(m, iso), P = T.deep && T.deep.stress;
    if (v == null || !P) return '<p class="dt-nodata">' + esc(T.day.noData) + '</p>';
    var band = dayState(m, v).slice(1), d = null;
    var S = stressMetric() ? SCORES.stress : null;
    ((S && S.days) || []).forEach(function (x) { if (x && x.date === iso) d = x; });
    var sub = d && d.mins ? ['low', 'medium', 'high'].map(function (b) { return P.bands[b] + ' ' + HC.duration(d.mins[b], P.units); }).join(' · ') : '';
    return row(P.avgLbl, fmt(v, 1) + ' · ' + (P.bands[band] || ''), sub);
  }
  // an energy day: its latest level + band, and the start and low when the day is baked
  function energyDayHtml(key, m, iso) {
    var v = valueOf(m, iso), P = T.deep && T.deep.energy;
    if (v == null || !P) return '<p class="dt-nodata">' + esc(T.day.noData) + '</p>';
    var S = energyMetric() ? SCORES.energy : null, d = null;
    ((S && S.days) || []).forEach(function (x) { if (x && x.date === iso && x.now) d = x; });
    var b = dayState(m, v);
    var sub = d ? format(P.daySub, { start: d.start, wake: d.wake, min: d.min.lv }) : '';
    return row(P.dayLbl, fmt(v, 0) + ' · ' + (P.bands[b === 'good' ? 'hi' : b === 'mid' ? 'mid' : 'lo'] || ''), sub);
  }
  // the nutrition score's day: the score + each component's eaten / target and points ("85 / 100 pts"),
  // then why the day may read short (a macro missing, a main meal unlogged, an assumed rest day). Today
  // is still filling up: "in progress" instead of a score, eaten / target without points.
  function nscoreDayHtml(m, iso) {
    var r = m.days && own(m.days, iso) ? m.days[iso] : null, P = T.day.ns;
    if (!r || !P) return '<p class="dt-nodata">' + esc(T.day.noData) + '</p>';
    var out = [r.partial ? row(P.score, P.inProgress, P.inProgressSub) : row(P.score, HC.pct(r.score), '')];
    ['k', 'p', 'f'].forEach(function (c) {
      var x = r.parts[c], u = c === 'k' ? 'kcal' : 'g';
      out.push(x ? row(P[c], (x.min ? '≥ ' : '') + fmt(x.v, 0) + ' / ' + fmt(x.t, 0) + ' ' + u, r.partial ? '' : format(P.pts, { pts: x.pts })) : row(P[c], '—', P.unknown));
    });
    if (r.inc) out.push('<p class="dt-note">' + esc(P.inc) + '</p>');
    if (!r.meals) out.push('<p class="dt-note">' + esc(P.meals) + '</p>');
    if (r.assumed) out.push('<p class="dt-note">' + esc(P.assumed) + '</p>');
    return out.join('');
  }
  function totalHtml(key, m, iso) {
    var v = valueOf(m, iso);
    if (v == null) return '<p class="dt-nodata">' + esc(T.day.noData) + '</p>';
    var u = unitOf(key);
    // today's total is still filling up: labelled, never compared with the median
    var sub = isPartial(m, iso) ? T.todaySoFar
      : m.band && m.band.median > 0 ? format(T.day.vsMedian, { pct: pct(Math.round(100 * (v / m.band.median - 1))), median: fmt(m.band.median, m.dec), unit: u }) : '';
    var out = [row(key === 'energy' ? T.day.total : titleOf(key), valUnit(v, m.dec, u), sub)];
    if (key === 'energy') {
      // a power-meter ride day: the Watch value + the correction (lib/health/ride-energy.mjs)
      var w = at(m.watch, m, iso);
      out.push(row(T.day.active, valUnit(at(m.active, m, iso), 0, u), w != null ? format(T.day.activeWatch, { watch: fmt(w, 0) }) : ''));
      out.push(row(T.day.basal, valUnit(at(m.basal, m, iso), 0, u)));
      if (w != null) out.push('<p class="dt-note">' + esc(T.rideNote) + '</p>');
      else if (at(m.uncov, m, iso) != null) out.push('<p class="dt-note">' + esc(T.rideUncovered) + '</p>');
    }
    return out.join('');
  }
  function sparseHtml(key, m, iso) {
    var v = valueOf(m, iso);
    if (v == null) return '<p class="dt-nodata">' + esc(T.day.noData) + '</p>';
    var prev = null;
    for (var i = dayDiff(m.start, iso) - 1; i >= 0; i--) if (m.v[i] != null) { prev = shiftIso(m.start, i); break; }
    var u = unitOf(key);
    var sub = prev ? format(T.day.vsPrev, { delta: signed(v - valueOf(m, prev), m.dec), unit: u, date: HC.fmtDate(prev) }) : T.day.firstReading;
    return row(titleOf(key), valUnit(v, m.dec, u), sub);
  }
  function sessionHtml(s) {
    var D2 = T.day, parts = [HC.duration(s.min)];
    if (s.km != null) parts.push(format(D2.km, { n: fmt(s.km, s.km < 10 ? 2 : 1) }));
    if (s.el != null) parts.push(format(D2.elev, { n: fmt(s.el, 0) }));
    if (s.hr != null) parts.push(format(D2.hr, { n: fmt(s.hr, 0) }));
    if (s.re != null) parts.push(format(D2.re, { n: fmt(s.re, 0) }));
    if (s.n > 1) parts.push(format(D2.parts, { n: s.n }));
    var mod = T.modalities[s.m] || s.m, type = T.types[s.t] || String(s.t || '').replace(/([a-z])([A-Z])/g, '$1 $2');
    return '<li class="dt-sess"><b class="dt-sess-name">' + esc(mod + (type && type !== mod ? ' · ' + type : '')) + '</b>' +
      '<span class="dt-sess-meta">' + esc(parts.join(' · ')) + '</span>' + zonesHtml(s) +
      (s.src ? '<small class="dt-sess-src">' + esc(format(D2.source, { src: s.src })) + '</small>' : '') + '</li>';
  }
  // seconds -> "m:ss" / "h:mm:ss"
  function mss(sec) {
    var t = Math.max(0, Math.round(sec)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return h ? h + ':' + pad(m) + ':' + pad(x) : m + ':' + pad(x);
  }
  // the bpm range of zone i for a max HR (lower bound inclusive: bpm >= cut % of max, exact)
  function zoneBpm(i, max) {
    var Z = T.day.zones, lo = function (k) { return Math.ceil((ZONE_CUTS[k] * max) / 100); };
    if (i === 0) return format(Z.below, { n: lo(0) });
    if (i === 5) return format(Z.above, { n: lo(4) });
    return format(Z.range, { lo: lo(i - 1), hi: lo(i) - 1 });
  }
  // the session's time in HR zone 5…0 (DETAIL sessions `z`, seconds) as the reference's rows: name,
  // bpm range, % of the zoned time, duration and a bar in the zone's colour; + avg / max HR and an ⓘ fold (the page fonts carry no ⓘ glyph: HC.infoSvg)
  // with the model and the max HR used. No `z` -> nothing.
  function zonesHtml(s) {
    var Z = T.day.zones, z = s.z;
    if (!Z || !z || z.length !== 6) return '';
    var tot = 0;
    for (var i = 0; i < 6; i++) tot += z[i] > 0 ? z[i] : 0;
    if (!(tot > 0)) return '';
    var zm = D.zoneMax && D.zoneMax.hr > 0 ? D.zoneMax : null;
    var hr = s.hr != null && s.hx != null ? format(Z.hrSummary, { avg: fmt(s.hr, 0), max: fmt(s.hx, 0) })
      : s.hr != null ? format(Z.hrAvg, { avg: fmt(s.hr, 0) }) : s.hx != null ? format(Z.hrMax, { max: fmt(s.hx, 0) }) : '';
    var rows = [];
    for (var k = 5; k >= 0; k--) {
      var sec = z[k] > 0 ? z[k] : 0, p = Math.round((100 * sec) / tot);
      rows.push('<li class="dt-zone dt-z' + k + '"><span class="dt-zname">' + esc(format(Z.zone, { n: k })) + '</span>' +
        (zm ? '<span class="dt-zbpm">' + esc(zoneBpm(k, zm.hr)) + '</span>' : '') +
        '<span class="dt-zpct">' + HC.pct(p) + '</span><span class="dt-zdur">' + mss(sec) + '</span>' +
        '<span class="dt-zbar"><i style="width:' + p + '%"></i></span></li>');
    }
    var note = zm ? format(Z.note, { max: fmt(zm.hr, 0), src: Z.src[zm.src] || '' }).replace(' ()', '') : Z.noteNoMax;
    return '<div class="dt-zones" role="group" aria-label="' + esc(Z.title) + '">' +
      '<p class="dt-zhead"><b>' + esc(Z.title) + '</b>' + (hr ? '<span>' + esc(hr) + '</span>' : '') + '</p>' +
      '<ol class="dt-zlist">' + rows.join('') + '</ol>' +
      '<details class="dt-zinfo"><summary>' + (HC.infoSvg || '') + '<span>' + esc(Z.info) + '</span></summary><p>' + esc(note) + '</p></details></div>';
  }
  function workoutsHtml(key, m, iso) {
    var list = sessionsOn(iso, modOf(key));
    var out = [];
    if (m.kind === 'load' || m.kind === 'strain') {
      var v = valueOf(m, iso);
      if (v == null && list.length && m.kind === 'load') out.push('<p class="dt-nodata">' + esc(T.day.noEffort) + '</p>');
      else if (v != null && v > 0) out.push(row(titleOf(key), valUnit(v, m.kind === 'strain' ? 1 : 0, unitOf(key))));
    }
    if (!list.length) out.push('<p class="dt-nodata">' + esc(T.day.rest) + '</p>');
    else out.push('<ul class="dt-sessions">' + list.map(sessionHtml).join('') + '</ul>');
    if (list.some(function (x) { return x.m === 'run'; })) out.push(runDynHtml(iso));
    return out.join('');
  }
  // the watch running dynamics of that day (HEALTH.running, client/health.js's run rows, one merged
  // row per date): power, ground contact time, vertical oscillation, stride. The Entreno run row does
  // not print them (they wrapped to 2-3 lines at 390 px), so the day it opens is where they live.
  function runDynHtml(iso) {
    var H = typeof HEALTH === 'undefined' || !HEALTH ? null : HEALTH;
    var rows = H && H.running && H.running.sessions ? H.running.sessions : [];
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].date === iso) { r = rows[i]; break; }
    var Y = T.day.dyn;
    if (!r || !Y) return '';
    var out = [];
    if (r.power != null) out.push(format(Y.power, { n: fmt(r.power, 0) }));
    if (r.gct != null) out.push(format(Y.gct, { n: fmt(r.gct, 0) }));
    if (r.vosc != null) out.push(format(Y.osc, { n: fmt(r.vosc, 1) }));
    if (r.stride != null) out.push(format(Y.stride, { n: fmt(r.stride, 2) }));
    return out.length ? '<p class="dt-sub dt-dyn">' + esc(Y.label + ': ' + out.join(' · ')) + '</p>' : '';
  }
  function dayHtml(key, m, iso) {
    var body = m.kind === 'workouts' || m.kind === 'load' || m.kind === 'strain' ? workoutsHtml(key, m, iso)
      : m.kind === 'total' ? totalHtml(key, m, iso)
      : m.kind === 'stress' ? stressDayHtml(key, m, iso)
      : m.kind === 'bank' ? energyDayHtml(key, m, iso)
      : m.kind === 'nscore' ? nscoreDayHtml(m, iso)
      : m.kind === 'sparse' ? sparseHtml(key, m, iso)
      : NIGHT_KEYS.indexOf(key) !== -1 ? nightHtml(key, m, iso)
      : totalHtml(key, m, iso); // a daytime signal (walking HR): the value vs its personal median
    return '<section class="dt-dayd" aria-live="polite"><h3 class="dt-day-h">' + esc(format(T.day.heading, { date: HC.fmtDate(iso) })) + '</h3>' + body + '</section>';
  }

  /* ---------- dial deep-dive pages (client/deepdive.js) ---------- */
  // the sheet's own helpers, handed to deepdive.js so the dial pages read the same rules and copy
  var X = {
    T: T, D: D, at: at, valueOf: valueOf, lastDataDate: lastDataDate, dayDiff: dayDiff, modOf: modOf,
    fmt: fmt, fmtM: fmtM, signed: signed, signedM: signedM, pct: pct, clock: clock, unitOf: unitOf, titleOf: titleOf, bandText: bandText,
    metric: metric, dayState: dayState,
  };
  function deep(key) {
    var H = typeof window !== 'undefined' ? window.HCDeep : null;
    return !!H && typeof H.isDial === 'function' && H.isDial(key) && !!T.deep;
  }
  // the History fold's state for this page session (sessionStorage when the frame allows it)
  var HIST_KEY = 'hc-dd-hist';
  var histOpen = (function () {
    try { return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(HIST_KEY) === '1'; } catch (e) { return false; }
  })();
  // the fold opens / closes in place (no re-render): only the block and the button change
  function toggleHist(btn) {
    var box = q('#dd-hist');
    if (!box) return;
    var open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    box.hidden = !open;
    histOpen = open;
    if (state) state.hist = open;
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(HIST_KEY, open ? '1' : '0'); } catch (e) { /* a frame without storage: this page load only */ }
  }
  // ⓘ: the deep-dive's long notes, collapsed by default; only the block and the button change
  function toggleInfo(btn) {
    var box = q('#dd-info');
    if (!box) return;
    var open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    box.hidden = !open;
  }
  // "Learn more" under the breakdown bar: the ⓘ notes open (never closed by it) and come into view
  function learnMore() {
    var btn = q('.sh-info'), box = q('#dd-info');
    if (btn && box && box.hidden) toggleInfo(btn);
    if (box && typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' });
    if (btn && typeof btn.focus === 'function') btn.focus();
  }
  // "View trend →": down to the history chart (the W / M / 6M / 1Y switch); focus follows to the
  // pressed range button so keyboard users land there too
  function toTrend() {
    var el = q('.dt-period');
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
    var b = q('.dt-range [aria-pressed="true"]');
    if (b && typeof b.focus === 'function') b.focus();
  }

  /* ---------- view ---------- */
  function viewHtml() {
    var key = state.key, vw = viewOf(key);
    if (vw) {
      var r = vw.render() || {};
      return head(key, r.head || '') + '<div class="dt-body">' + (r.body || '') + '</div>';
    }
    var m = metric(key);
    if (!m) return head(key) + '<div class="dt-body"><p class="dt-empty">' + esc(T.empty) + '</p></div>';
    var ve = viewEnd(), end = ve.end;
    var sel = state.date && state.date >= m.start && state.date <= end ? state.date : lastDataDate(m, end);
    if (!state.month) state.month = monthOf(sel || end);
    var lo = monthOf(m.start), hiM = monthOf(end);
    if (state.month < lo) state.month = lo;
    if (state.month > hiM) state.month = hiM;
    if (windowEnd(m, end, state.range, state.shift) < m.start) state.shift = 0;
    var to = windowEnd(m, end, state.range, state.shift), from = windowFrom(m, to, state.range);
    state.sel = sel;
    state.view = { key: key, m: m, end: end };
    // the day the sheet was opened on (a dial on a stepped-to day, a day tap): the strain page follows it
    X.sel = state.date && state.date <= end ? state.date : null;
    var dd = deep(key) ? window.HCDeep.render(key, m, end, X) : null;
    return (dd ? dd.head : trendHead(key, '<div class="dt-titles">' + latestHtml(key, m, end) + bandText(key, m) + '</div>')) +
      '<div class="dt-body">' + (dd ? dd.top : '') +
      (ve.stale ? '<p class="dt-stale">' + esc(format(T.staleNote, { date: HC.fmtDate(end) })) + '</p>' : '') +
      metricStaleHtml(m, end) +
      periodHtml(key, m, end, state.range, state.shift) + chartHtml(key, m, from, to, sel) + breakdownHtml(m, from, to) +
      foldHtml(!!dd, '<div data-dt-part="cal">' + calendarHtml(key, m, state.month, sel, end) + '</div>' +
      '<div data-dt-part="day">' + dayPart(key, m, sel) + '</div>') + '</div>';
  }
  // a deep-dive page folds its month calendar + day panel behind one "History" row, so the page reads
  // like the reference (dial, contributors, insight, weekly bars, trend); collapsed by default, open
  // after a dated open (the day it was opened for is in there) and remembered for the session
  function foldHtml(fold, inner) {
    if (!fold) return inner;
    var F = T.deep.hist, open = histOpen || !!state.hist;
    return '<section class="dd-hist"><button type="button" class="dd-fold" data-dt-act="hist" aria-expanded="' + open + '" aria-controls="dd-hist">' +
      '<span class="dd-fold-t">' + esc(F.title) + '</span><span class="dd-fold-s">' + esc(F.sub) + '</span>' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg></button>' +
      '<div class="dd-hist-b" id="dd-hist"' + (open ? '' : ' hidden') + '>' + inner + '</div></section>';
  }
  function dayPart(key, m, sel) {
    return sel ? dayHtml(key, m, sel) : '<p class="dt-note">' + esc(T.day.pick) + '</p>';
  }
  // a day tap: only the calendar (selection) and the day panel change, and the chart's selection
  // rect moves; the chart itself is not rebuilt. Falls back to a full render when a part is missing.
  function renderDay() {
    var v = state.view, cal = q('[data-dt-part="cal"]'), day = q('[data-dt-part="day"]');
    if (!v || !cal || !day) { render(); return; }
    try {
      var sel = state.date && state.date >= v.m.start && state.date <= v.end ? state.date : state.sel;
      state.sel = sel;
      cal.innerHTML = calendarHtml(v.key, v.m, state.month, sel, v.end);
      day.innerHTML = dayPart(v.key, v.m, sel);
      var rect = q('.dt-sel'), sx = selX(sel);
      if (rect && rect.setAttribute) {
        rect.setAttribute('x', (sx == null ? 0 : sx).toFixed(1));
        if (sx == null) rect.setAttribute('visibility', 'hidden'); else if (rect.removeAttribute) rect.removeAttribute('visibility');
      }
    } catch (e) {
      render();
    }
  }
  function render() {
    var html;
    try {
      html = viewHtml();
    } catch (e) {
      html = head(state.key) + '<div class="dt-body"><p class="dt-empty">' + esc(T.viewError) + '</p></div>';
    }
    host.innerHTML = '<div class="dt-panel">' + html + '</div>';
  }

  /* ---------- open / close / history ---------- */
  function isOpen() {
    return !!state && !host.hidden;
  }
  function hashOf() {
    if (viewOf(state.key)) return '#' + state.key;
    return '#detail/' + state.key + (state.date ? '/' + state.date : '');
  }
  // true when the history entry was written; a sandboxed frame may refuse it (the view still works,
  // only Back / deep links do not), and then closing must never call history.back()
  function setHash(push) {
    try {
      if (push) history.pushState({ hcDetail: true }, '', hashOf());
      else history.replaceState({ hcDetail: true }, '', hashOf());
      return true;
    } catch (e) {
      return false;
    }
  }
  function q(sel) {
    return host.querySelector ? host.querySelector(sel) : null;
  }
  // focus a control of the sheet; a control that a re-render removed or disabled hands focus to the
  // close button, so focus never falls out of the dialog
  function focusEl(sel) {
    var el = q(sel);
    if (!el || el.disabled || typeof el.focus !== 'function') el = q('[data-dt-act="close"]');
    if (el && typeof el.focus === 'function') el.focus();
  }
  // no opener to return to (a deep link, a forward navigation): the visible tab's heading
  function focusHome() {
    var panels = document.querySelectorAll ? document.querySelectorAll('.tab-panel') : [];
    for (var i = 0; i < panels.length; i++) {
      if (panels[i].hidden) continue;
      var h = (panels[i].querySelector && panels[i].querySelector('h1, h2')) || panels[i];
      if (h.setAttribute && !(h.hasAttribute && h.hasAttribute('tabindex'))) h.setAttribute('tabindex', '-1');
      if (typeof h.focus === 'function') h.focus();
      return;
    }
  }
  // the page behind: inert (+ aria-hidden as the fallback where inert is unsupported), scroll locked
  function lockPage(on) {
    var wrap = document.querySelector ? document.querySelector('.wrap') : null;
    if (wrap) {
      if (on) { wrap.setAttribute('inert', ''); wrap.setAttribute('aria-hidden', 'true'); }
      else { wrap.removeAttribute('inert'); wrap.removeAttribute('aria-hidden'); }
    }
    var root = document.documentElement;
    if (root && root.classList) root.classList[on ? 'add' : 'remove']('dt-lock');
  }
  // opts: opener (focus returns there), push (false = do not write history), pushed (the entry is
  // ours), syncUrl (rewrite the hash when the asked date is not the day shown), focus (a selector of the
  // view's control to focus instead of the close button, e.g. the profile sheet's goal radio)
  function open(key, date, opts) {
    opts = opts || {};
    var wasOpen = isOpen();
    if (!wasOpen) opener = opts.opener || null;
    var asked = date == null || date === '' ? null : String(date);
    state = { key: key, date: isoDate(date), range: RANGES.indexOf(opts.range) !== -1 ? opts.range : RANGES[1], shift: 0, month: null, pushed: wasOpen ? state.pushed : !!opts.pushed, sel: null, view: null, geo: null };
    // a dated open shows its day: the History fold of a deep-dive page starts open
    state.hist = !!state.date;
    // while a close's Back is in flight, history is left alone: its popstate gives this sheet an entry
    if (opts.push !== false && !pendingBack) {
      var written = setHash(!wasOpen);
      if (!wasOpen) state.pushed = written;
    }
    try {
      render();
      host.hidden = false;
      lockPage(true);
    } catch (e) {
      hide();
      return;
    }
    if (opts.syncUrl && asked && asked !== state.sel && !pendingBack) {
      state.date = state.sel;
      setHash(false);
    }
    focusEl(opts.focus || '[data-dt-act="close"]');
    if (opts.focus) scrollTo(opts.focus);
    // a dated dial page (a run / ride / timeline row): the day it was opened for sits below the hero,
    // the insight and the chart, so the sheet starts at that day's panel
    else if (state.date && deep(key)) scrollTo('[data-dt-part="day"]', 'start');
  }
  function scrollTo(sel, block) {
    var el = q(sel);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: block || 'nearest' });
  }
  function hide() {
    if (!state) return;
    host.hidden = true;
    host.innerHTML = '';
    lockPage(false);
    var o = opener;
    state = null;
    opener = null;
    if (o && typeof o.focus === 'function' && o.isConnected !== false) o.focus();
    else focusHome();
  }
  function close() {
    if (!isOpen()) return;
    var pushed = state.pushed;
    hide();
    if (pendingBack) return; // the Back in flight already leaves this page's entry
    if (pushed) {
      pendingBack = true;
      try { history.back(); } catch (e) { pendingBack = false; }
      return;
    }
    // a deep-linked sheet (no entry of ours): the URL goes back to the tab underneath (core.js)
    try { history.replaceState(null, '', location.pathname + location.search + tabHash()); } catch (e) { /* see setHash */ }
  }
  function tabHash() {
    var nav = typeof window !== 'undefined' ? window.HCNav : null;
    try {
      return nav && typeof nav.hash === 'function' ? String(nav.hash() || '') : '';
    } catch (e) {
      return '';
    }
  }
  function fromHash() {
    var hash = (typeof location !== 'undefined' && location.hash) || '';
    var vm = VIEW_HASH_RE.exec(hash);
    if (vm) return viewOf(vm[1]) ? { key: vm[1], date: null } : null;
    var mm = HASH_RE.exec(hash);
    // own keys only (no "constructor" / "toString"), and only a metric the page has data for
    if (!mm || !own(T.metrics, mm[1]) || !metric(mm[1])) return null;
    return { key: mm[1], date: mm[2] || null };
  }
  function act(el) {
    var a = el.getAttribute('data-dt-act');
    if (a === 'close') { close(); return; }
    if (a === 'day') {
      state.date = isoDate(el.getAttribute('data-date'));
      if (!pendingBack) setHash(false);
      renderDay();
      focusEl('[data-date="' + state.date + '"]');
      return;
    }
    if (a === 'info') { toggleInfo(el); return; }
    if (a === 'hist') { toggleHist(el); return; }
    if (a === 'learn') { learnMore(); return; }
    if (a === 'trend') { toTrend(); return; }
    var focusSel = null;
    if (a === 'range') {
      var r = +el.getAttribute('data-range');
      state.range = RANGES.indexOf(r) !== -1 ? r : RANGES[1];
      state.shift = 0;
      focusSel = '[data-range="' + state.range + '"]';
    } else if (a === 'win') {
      var wd = +el.getAttribute('data-wdir') || 0;
      state.shift = Math.max(0, (state.shift || 0) - wd);
      focusSel = '[data-wdir="' + wd + '"]';
    } else if (a === 'month') {
      var dir = +el.getAttribute('data-dir') || 0;
      state.month = addMonths(state.month, dir);
      focusSel = '[data-dir="' + dir + '"]';
    } else return;
    render();
    focusEl(focusSel);
  }
  // a Tab stop the browser can really focus: not disabled, not hidden, not inside a [hidden] block,
  // a closed <details> body or a disabled fieldset
  function focusable(el) {
    if (!el || el.disabled || el.hidden) return false;
    if (!el.closest) return true;
    if (el.closest('[hidden]') || el.closest('fieldset[disabled]')) return false;
    var d = el.closest('details');
    return !d || d.open || (el.tagName === 'SUMMARY' && el.parentElement === d);
  }
  // a control inside a card (a link, a button, a summary…) keeps its own job: only a tap on the card
  // itself or its plain content opens the sheet
  var CONTROL_TAGS = ['A', 'BUTTON', 'SUMMARY', 'INPUT', 'SELECT', 'TEXTAREA'];
  function isControl(el) {
    return CONTROL_TAGS.indexOf(String(el.tagName || '').toUpperCase()) !== -1 || (!!el.getAttribute && el.getAttribute('role') === 'button');
  }
  function openerOf(t) {
    var o = t && t.closest ? t.closest('[data-detail]') : null;
    if (!o) return null;
    for (var el = t; el && el !== o; el = el.parentElement) if (isControl(el)) return null;
    return o;
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) return;
    if (isOpen() && t === host) { close(); return; }
    var a = t.closest ? t.closest('[data-dt-act]') : null;
    if (a && isOpen()) { act(a); return; }
    var o = openerOf(t);
    if (o) {
      if (e.preventDefault) e.preventDefault();
      open(o.getAttribute('data-detail'), o.getAttribute('data-date'), { opener: o });
    }
  });
  // the trend view's metric picker: the sheet re-opens on the picked metric (same range, URL replaced)
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !isOpen() || !t.getAttribute || t.getAttribute('data-dt-pick') !== 'metric') return;
    var k = String(t.value || '');
    if (trendKeys().indexOf(k) === -1 || k === state.key) return;
    open(k, null, { range: state.range, focus: '[data-dt-pick="metric"]' });
  });
  document.addEventListener('keydown', function (e) {
    if (isOpen()) {
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab' && host.querySelectorAll) {
        var f = Array.prototype.slice.call(host.querySelectorAll(TRAP)).filter(focusable);
        if (!f.length) return;
        var i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
      }
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var o = openerOf(e.target);
    if (!o) return;
    e.preventDefault();
    open(o.getAttribute('data-detail'), o.getAttribute('data-date'), { opener: o });
  });
  window.addEventListener('popstate', function () {
    if (pendingBack) {
      // the Back of a close: a sheet opened meanwhile gets its own history entry now
      pendingBack = false;
      if (isOpen()) state.pushed = setHash(true);
      return;
    }
    var h = fromHash();
    if (h) open(h.key, h.date, { push: false, pushed: !!(history.state && history.state.hcDetail), syncUrl: true });
    else if (isOpen()) hide();
  });

  window.HCDetail = {
    // opts.focus: a control of the view to focus (the goal chip opens the profile sheet on its goal);
    // opts.opener: where focus returns on close (default: the focused element)
    open: function (key, date, opts) {
      open(key, date, { opener: (opts && opts.opener) || document.activeElement || null, focus: opts && typeof opts.focus === 'string' ? opts.focus : null });
    },
    close: close,
    state: function () { return state; },
    dayState: dayState,
    periodStats: function (key, end, days) { var m = metric(key); return m ? periodStats(m, end, days) : null; },
  };

  var initial = fromHash();
  if (initial) open(initial.key, initial.date, { push: false, syncUrl: true });
  if (!isOpen()) {
    // a deep link that opened nothing (unknown metric, no data, bad date, a view this page lacks):
    // the URL becomes the tab underneath, never a hash that names a sheet nobody sees
    try {
      if (staleDeepHash()) history.replaceState(null, '', location.pathname + location.search + tabHash());
    } catch (e) { /* see setHash */ }
  }
  // views that register AFTER this script runs (the food add sheet waits for the food API): their
  // hash is left alone at load, a later answer may still make it meaningful
  function staleDeepHash() {
    var hash = (typeof location !== 'undefined' && location.hash) || '';
    if (/^#detail(\/|$)/.test(hash)) return true;
    var vm = VIEW_HASH_RE.exec(hash);
    var viewTab = typeof NAV !== 'undefined' && NAV && NAV.viewTab;
    return !!vm && own(viewTab, vm[1]) && ASYNC_VIEWS.indexOf(vm[1]) === -1;
  }
})();
