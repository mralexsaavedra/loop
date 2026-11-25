/* Detail sheet: a tap on any card opens its metric full-screen (phones) or as a large centred panel
 * (desktop): header (metric, latest value + date, personal band / target), a W / M / 6M / 1Y
 * range switch with the period's average + a delta pill vs the previous period of the same length, a chart (daily points or bars, the 7-day average line, the personal band; a
 * missing day is a gap, never 0), a Monday-first month calendar coloured by state tokens against that
 * band / target, and the picked day's detail underneath.
 *
 * Module script (bundled into the page, docs/plan-page.md → Module scripts), the sheet's shell: detail-state.ts (the data / state
 * helpers, window.HCDetailState) and detail-chart.ts (the trend chart, window.HCDetailChart) are inlined
 * right before it. Reads DETAIL (lib/detail/detail.mjs) + I18N_DETAIL, both
 * baked by components/DetailSheet.astro, and the shared helpers of util.ts (window.HC). Openers are any
 * element with data-detail="<metric>" [data-date="<iso>"] (HC.detailAttrs writes them): one delegated
 * click / keydown listener, so the card renderers never wire handlers. The view ends at the VIEWER's
 * today (Date.now(), never baked), or at the data's own asOf when that is stale or ahead of the clock.
 *
 * The header never contradicts the card it opens from. The three dial views (sleep, recovery,
 * load-<m>) are laid out by client/deepdive.ts (inlined right before this script): "‹ TODAY ⓘ", the
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
 * the URL follows). The entry underneath is the open tab's hash (#nutricion, core.ts), so Back lands
 * there; closing a deep-linked sheet (no entry of ours) rewrites the URL to that tab hash
 * (window.HCNav.hash(), core.ts shows the deep link's host tab underneath). A re-open while the close's history.back() is in flight waits for its popstate
 * before writing history. Every view renders inside a try/catch with a message fallback; no NaN is ever
 * printed (non-finite values render as a dash). A day tap re-renders only the calendar + day panel.
 *
 * Registered views: another script (inlined BEFORE this one) may call HC.registerView(<key>,
 * {title(), render() -> {head, body, info?, bare?}}) (client/profile.ts adds `profile`; `bare` = no shared header,
 * the view draws its own with id="dt-title"); this reads them through
 * HC.view(<key>). An opener with
 * data-detail="<key>" then opens that view in this same modal (focus, inert, Esc, Back), with the deep
 * link #<key> instead of #detail/<metric>; a view that throws gets the same message fallback.
 */
import type { PageGlobals } from './page-globals';

// the page globals this script reads by bare name (baked by components/Bake.astro or an earlier script; manifest.mjs)
declare const HC: PageGlobals['HC'];
declare const DETAIL: PageGlobals['DETAIL'];
declare const HEALTH: PageGlobals['HEALTH'];
declare const I18N_DATE: PageGlobals['I18N_DATE'];
declare const I18N_DETAIL: PageGlobals['I18N_DETAIL'];
declare const NAV: PageGlobals['NAV'];
declare const SCORES: PageGlobals['SCORES'];

/** A baked DETAIL / SCORES / HEALTH piece or an I18N_DETAIL copy block (lib/detail/detail.mjs): untyped until those shapes get their own types. */
type Baked = any;
// the stress / energy bakes once stressMetric() / energyMetric() (client/detail-state.ts) found them ok
type StressOk = import('../../../lib/score/stress.mjs').StressOk;
type EnergyOk = import('../../../lib/score/energy-bank.mjs').EnergyOk;
/** A baked metric series (DETAIL.metrics[key], lib/detail/detail.mjs). */
type Metric = Baked;
/** One baked session (DETAIL.sessions, lib/detail/detail.mjs). */
type Session = Baked;
/** A window's stats (client/detail-state.ts periodStats). */
type PeriodStats = Baked;
/** The open sheet's state (window.HCDetail.state()). */
type DetailState = {
  key: string;
  date: string | null;
  range: number;
  shift: number;
  month: string | null;
  pushed: boolean;
  sel: string | null;
  view: { key: string; m: Metric; end: string } | null;
  geo: unknown;
  hist?: boolean;
};
/** open()'s options. */
type OpenOpts = { opener?: Element | null; range?: number; push?: boolean; pushed?: boolean; syncUrl?: boolean; focus?: string | null };
/** Where focus returns on close (an HTML or SVG card). */
type Opener = Element & Partial<HTMLOrSVGElement>;
/** A control of the sheet (a button, a field, a fold). */
type Ctl = HTMLElement & { disabled?: boolean };
/** #detail (the markup ships it; a test's fake DOM may lack the query methods, hence the guards). */
type DetailHost = Omit<HTMLElement, 'querySelector' | 'querySelectorAll'> & Partial<Pick<HTMLElement, 'querySelector' | 'querySelectorAll'>>;
/** A secondary line under the big number. */
type Sub = { cls?: string; text: string };

(function () {
  var host = document.getElementById('detail') as DetailHost | null;
  var T = (typeof I18N_DETAIL === 'undefined' ? null : I18N_DETAIL)!;
  if (!host || !T) return;
  var D: Omit<PageGlobals['DETAIL'], 'days'> = typeof DETAIL === 'undefined' || !DETAIL ? { asOf: null, metrics: {}, sessions: [] } : DETAIL;
  var esc = HC.esc, format = HC.format, isoDate = HC.isoDate, parseIso = HC.parseIso, shiftIso = HC.shiftIso;
  // lower bounds of HR zones 1-5, % of max HR (lib/training/hr-zones.mjs ZONE_CUTS)
  var ZONE_CUTS = [50, 60, 70, 80, 90];
  // overnight signals: their day detail is the whole night (sleep, bed / wake, the night's signals)
  var NIGHT_KEYS = ['sleep', 'recovery', 'hrv', 'rhr', 'respiratory', 'wristTemp'];
  var HASH_RE = /^#detail\/([A-Za-z-]+)(?:\/(\d{4}-\d{2}-\d{2}))?$/;
  // a registered view (window.HCViews, e.g. the profile sheet of client/profile.ts) deep-links as #<key>
  var VIEW_HASH_RE = /^#([a-z][a-z-]*)$/;
  // registered after page load (client/food-*.js once GET /api/food/products answers, client/journal.ts
  // once GET /api/journal/settings answers)
  var ASYNC_VIEWS = ['food-add', 'journal'];
  // kinds whose missing recent days mean stale data (a sparse reading or a rest day is not staleness)
  var STALE_KINDS = ['signal', 'sleep', 'recovery', 'total'];
  // the Tab trap's stops, in document order: buttons, folds, a radio group's checked radio and form
  // fields (a registered view may hold a small form, e.g. the food log's add sheet)
  var TRAP = 'button:not([disabled]), summary, input[type="radio"]:checked, input:not([type="radio"]):not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
  var state = null as DetailState | null;
  var opener = null as Opener | null;
  // true between close()'s history.back() and its popstate: history must not be written meanwhile
  var pendingBack = false;
  // the data / state helpers (client/detail-state.ts) over this sheet's copy and data
  var DS = window.HCDetailState(T, D);
  var RANGES = DS.RANGES, RANGE_KEY = DS.RANGE_KEY;
  var dayDiff = DS.dayDiff, own = DS.own, viewOf = DS.viewOf, metric = DS.metric, stressMetric = DS.stressMetric, energyMetric = DS.energyMetric;
  var at = DS.at, valueOf = DS.valueOf, lastDataDate = DS.lastDataDate, isPartial = DS.isPartial, stateOn = DS.stateOn, viewEnd = DS.viewEnd;
  var targetOf = DS.targetOf, sessionsOn = DS.sessionsOn, modOf = DS.modOf;
  var fmt = DS.fmt, signed = DS.signed, pct = DS.pct, fmtM = DS.fmtM, signedM = DS.signedM, clock = DS.clock, unitOf = DS.unitOf;
  var titleOf = DS.titleOf, valUnit = DS.valUnit, dayState = DS.dayState, legendItems = DS.legendItems;
  var windowFrom = DS.windowFrom, periodStats = DS.periodStats, windowEnd = DS.windowEnd;
  var monthOf = DS.monthOf, addMonths = DS.addMonths;
  // the trend chart + the window's breakdown bar (client/detail-chart.ts)
  var DC = window.HCDetailChart(T, DS);

  host!.setAttribute('role', 'dialog');
  host!.setAttribute('aria-modal', 'true');
  host!.setAttribute('aria-labelledby', 'dt-title');

  /* ---------- header ---------- */
  function bandText(key: string, m: Metric): string {
    var B = T.bands, u = unitOf(key), d = Math.min(m.dec + 1, 2);
    var fill = function (b: Baked, dec: number) { return { lo: fmtM(m, b.lo, dec), hi: fmtM(m, b.hi, dec), median: fmtM(m, b.median, dec), unit: u }; };
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
    if (m.kind === 'sparse') out.push(format(B.sparse, { n: m.v.filter(function (x: number | null) { return x != null; }).length }));
    if (m.windowDays != null) out.push(format(B.window, { days: m.windowDays }));
    // bands are the CURRENT range (as of the newest day); recovery is scored against each day's own baseline
    if (m.kind === 'recovery') out.push(B.perDayNote);
    else if (m.band && (m.kind === 'signal' || m.kind === 'sleep' || m.kind === 'total')) out.push(B.staticNote);
    return out.map(function (s) { return '<div class="dt-band-txt">' + esc(s) + '</div>'; }).join('');
  }
  // `info` (a registered view's render().info): its notes collapsed under the shared ⓘ (#dd-info)
  function head(key: string, inner?: string, info?: string): string {
    var I = info && T.deep && T.deep.info;
    return HC.sheetHead({ title: titleOf(key), back: (T.deep && T.deep.back) || T.close, info: I ? { controls: 'dd-info', label: I } : null }) +
      (I ? '<div class="dd-info dt-info" id="dd-info" hidden>' + info + '</div>' : '') + (inner ? '<div class="dt-titles">' + inner + '</div>' : '');
  }
  // a metric's sheet = the trend view: "‹ TREND VIEW" (the metric stays the dialog's label for screen
  // readers), then the metric picker pill
  // `info`: the latest value + the band / target words, collapsed under ⓘ (the same toggle as the dial
  // pages' notes): the window's average leads the view, the chart labels the newest value
  function trendHead(key: string, info: string): string {
    var R = T.trend, I = T.deep && T.deep.info;
    return HC.sheetHead({ title: R.title, sr: titleOf(key), back: (T.deep && T.deep.back) || T.close, info: info && I ? { controls: 'dd-info', label: I } : null }) +
      (info && I ? '<div class="dd-info dt-info" id="dd-info" hidden>' + info + '</div>' : '') + pickerHtml(key);
  }
  // the metrics a trend view can switch to: every baked metric with copy, except the dial pages
  // (sleep, recovery, strain, load-<m>: their own deep-dive layout, reached from the dials), + the
  // nutrition score the page scores (client/nutri-score.ts) when it has a scored day
  function trendKeys() {
    return Object.keys(D.metrics).concat(['nutrition']).filter(function (k) { return own(T.metrics, k) && !!metric(k) && !deep(k); });
  }
  // a native <select> dressed as a pill with a ⌄ (keyboard, screen readers and the phone's own picker
  // for free); a change re-opens the sheet on that metric (the 'change' listener below)
  function pickerHtml(key: string): string {
    var keys = trendKeys();
    if (keys.length < 2) return '';
    return '<label class="dt-metric"><span class="sr-only">' + esc(T.trend.metric) + '</span><select class="dt-metric-sel sel" data-dt-pick="metric">' +
      keys.map(function (k) { return '<option value="' + esc(k) + '"' + (k === key ? ' selected' : '') + '>' + esc(titleOf(k)) + '</option>'; }).join('') +
      '</select><span class="chev sel-chev" aria-hidden="true">›</span></label>';
  }
  function noneHtml(txt: string): string {
    return '<div class="dt-latest"><span class="dt-none">' + esc(txt) + '</span></div>';
  }
  function subsHtml(subs: Sub[]): string {
    return (subs || []).map(function (x: Sub) { return '<div class="dt-sub' + (x.cls ? ' ' + esc(x.cls) : '') + '">' + esc(x.text) + '</div>'; }).join('');
  }
  // big number + unit (+ a word) + when, then optional secondary lines [{cls, text}]
  function bigHtml(num: string, st: string, unit: string, when: string, word: string, subs: Sub[]): string {
    return '<div class="dt-latest"><b class="dt-num dt-c-' + esc(st) + '">' + esc(num) + '</b>' + (unit ? '<small>' + esc(unit) + '</small>' : '') +
      (word ? '<span class="dt-word dt-c-' + esc(st) + '">' + esc(word) + '</span>' : '') +
      (when ? '<span class="dt-when">' + esc(when) + '</span>' : '') + '</div>' + subsHtml(subs);
  }
  // weight / energy: the card's 7-day rolling average (a partial today never sets it)
  function rollLatest(key: string, m: Metric, end: string): string {
    var d = lastDataDate(m, end);
    if (!d) return noneHtml(T.noData);
    var u = unitOf(key), partial = isPartial(m, d);
    var ref = null as string | null;
    for (var k = Math.min(m.roll.length - 1, dayDiff(m.start, partial ? shiftIso(d, -1) : d)); k >= 0; k--) {
      if (typeof m.roll[k] === 'number' && isFinite(m.roll[k])) { ref = shiftIso(m.start, k); break; }
    }
    var subs: Sub[] = [];
    if (key === 'weight' && m.latest && isoDate(m.latest.date)) subs.push({ text: format(T.latestReading, { value: fmt(m.latest.value, m.dec), unit: u, date: HC.fmtDate(m.latest.date) }) });
    else if (partial) subs.push({ cls: 'dt-c-partial', text: format(T.latestDaySoFar, { value: fmt(valueOf(m, d), m.dec), unit: u }) });
    else subs.push({ text: format(T.latestDay, { value: fmt(valueOf(m, d), m.dec), unit: u, date: HC.fmtDate(d) }) });
    if (key === 'energy' && at(m.watch, m, d) != null) subs.push({ text: T.rideNote });
    if (!ref) return noneHtml(T.noData) + subsHtml(subs);
    return bigHtml(fmt(at(m.roll, m, ref), m.dec), 'normal', u, format(T.roll7Lbl, { date: HC.fmtDate(ref) }), '', subs);
  }
  // the dial views (sleep, recovery, load-<m>) lay their top out in client/deepdive.ts
  function latestHtml(key: string, m: Metric, end: string): string {
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
  function metricStaleHtml(m: Metric, end: string): string {
    if (STALE_KINDS.indexOf(m.kind) === -1) return '';
    var d = lastDataDate(m, end);
    if (!d || dayDiff(d, end) <= HC.STALE_DAYS) return '';
    return '<p class="dt-stale dt-mstale">' + esc(format(T.metricStale, { date: HC.fmtDate(d) })) + '</p>';
  }

  /* ---------- range switch + the period's average ---------- */
  function rangeHtml(range: number): string {
    return '<div class="dt-range" role="group" aria-label="' + esc(T.rangeLabel) + '">' + RANGES.map(function (r: number) {
      var k = RANGE_KEY[r];
      return '<button type="button" data-dt-act="range" data-range="' + r + '" aria-pressed="' + (r === range ? 'true' : 'false') + '" aria-label="' + esc(T.ranges[k] + ', ' + T.rangesLong[k]) + '">' + esc(T.ranges[k]) + '</button>';
    }).join('') + '</div>';
  }
  // one plain sentence under the pill: the window's average vs the previous window's (no judgement:
  // the pill's colour carries good / bad)
  function sentenceOf(key: string, m: Metric, st: PeriodStats, range: number): string {
    var S = T.trend.sent, k = RANGE_KEY[range], dec = m.kind === 'sleep' ? 1 : m.dec, u = unitOf(key);
    // a real change (not flat) that rounds to the same number gets one more decimal, so "lower than"
    // never sits next to two equal numbers
    if (st.delta != null && !st.flat && fmtM(m, st.avg, dec) === fmtM(m, st.prev, dec)) dec = Math.min(dec + 1, 3);
    var show = function (v: number) { return m.kind === 'recovery' ? signed(v, 1) + ' ' + u : m.kind === 'sleep' ? HC.hours(v) : valUnit(v, dec, u); };
    // a window clipped to the data's first day names that day ("since 19 Oct"), never "these 30 days"
    var span = st.clamped && T.trend.spanSince ? format(T.trend.spanSince, { date: HC.fmtDate(st.from, { weekday: false }) }) : T.trend.span[k];
    var vars = { metric: titleOf(key), span: span, prevSpan: T.trend.prevSpan[k], avg: st.avg == null ? '' : show(st.avg), prev: st.prev == null ? '' : show(st.prev) };
    // the nutrition score with only today logged: today never counts until it ends, so say that
    if (st.avg == null && S.todayPending && partialIn(m, st.from, st.to)) return format(S.todayPending, vars);
    if (st.avg == null) return format(S.none, vars);
    if (st.delta == null) return format(S.only, vars);
    // h:mm has no decimal to add: two windows that print the same clock read "about the same"
    var same = st.flat || (st.prev != null && vars.avg === vars.prev);
    return format(same ? S.flat : st.delta > 0 ? S.up : S.down, vars);
  }
  // a nutrition-score day still being logged (today) inside [from, to]
  function partialIn(m: Metric, from: string, to: string): boolean {
    if (m.kind !== 'nscore' || !m.days) return false;
    for (var d = from; d <= to; d = shiftIso(d, 1)) if (own(m.days, d) && m.days[d] && m.days[d].partial) return true;
    return false;
  }
  function trendHtml(key: string, m: Metric, st: PeriodStats, range: number): string {
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
  // ‹ 23 Sep – 29 Sep, 26 ›: back while the previous window still reaches the data, forward until today
  function winHtml(m: Metric, from: string, to: string, range: number, shift: number): string {
    var R = T.trend, back = shiftIso(to, -range) >= m.start;
    var lbl = format(R.win, { from: HC.fmtDate(from, { weekday: false }), to: HC.fmtDate(to, { weekday: false }), yy: to.slice(2, 4) });
    return '<div class="dt-win" role="group" aria-label="' + esc(R.winAria) + '">' +
      '<button type="button" class="nav-btn" data-dt-act="win" data-wdir="-1" aria-label="' + esc(R.prevWin) + '"' + (back ? '' : ' disabled') + '><span class="chev" aria-hidden="true">‹</span></button>' +
      '<span class="dt-win-lbl">' + esc(lbl) + '</span>' +
      '<button type="button" class="nav-btn" data-dt-act="win" data-wdir="1" aria-label="' + esc(R.nextWin) + '"' + (shift > 0 ? '' : ' disabled') + '><span class="chev" aria-hidden="true">›</span></button></div>';
  }
  function periodHtml(key: string, m: Metric, end: string, range: number, shift: number): string {
    var to = windowEnd(m, end, range, shift);
    return '<div class="dt-period">' + rangeHtml(range) + winHtml(m, windowFrom(m, to, range), to, range, shift) +
      trendHtml(key, m, periodStats(m, to, range), range) + '</div>';
  }

  /* ---------- month calendar ---------- */
  function legendHtml(m: Metric): string {
    var items = legendItems(m).concat([['none', T.legend.none]]);
    return '<div class="dt-legend">' + items.map(function (it: [string, string]) {
      return '<span class="dt-leg"><span class="dt-sw dt-s-' + it[0] + '" aria-hidden="true"></span>' + esc(it[1]) + '</span>';
    }).join('') + '</div>';
  }
  function calendarHtml(key: string, m: Metric, month: string, sel: string | null, end: string): string {
    var first = monthOf(m.start), last = monthOf(end);
    var N = typeof I18N_DATE !== 'undefined' && I18N_DATE ? I18N_DATE.weekdaysMin : ['1', '2', '3', '4', '5', '6', '7'];
    var out = ['<div class="dt-cal-head"><button type="button" class="nav-btn" data-dt-act="month" data-dir="-1" aria-label="' + esc(T.prevMonth) + '"' + (month <= first ? ' disabled' : '') + '><span class="chev" aria-hidden="true">‹</span></button>' +
      '<h3 class="dt-month">' + esc(HC.fmtMonth(month)) + '</h3>' +
      '<button type="button" class="nav-btn" data-dt-act="month" data-dir="1" aria-label="' + esc(T.nextMonth) + '"' + (month >= last ? ' disabled' : '') + '><span class="chev" aria-hidden="true">›</span></button></div>'];
    out.push('<div class="dt-cal" role="group" aria-label="' + esc(format(T.calAria, { title: titleOf(key), month: HC.fmtMonth(month) })) + '">');
    N.forEach(function (w: string) { out.push('<span class="dt-wd">' + esc(w) + '</span>'); });
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
  function row(lbl: string, val: string, sub?: string): string {
    return '<div class="dt-row"><span class="dt-row-lbl">' + esc(lbl) + '</span><b class="dt-row-val">' + esc(val) + '</b>' + (sub ? '<small class="dt-row-sub">' + esc(sub) + '</small>' : '') + '</div>';
  }
  // that night's stage hours + efficiency (DETAIL sleep arrays), else the no-stages note
  function stagesDayHtml(sl: Metric, iso: string): string {
    var get = function (k: string) { return sl && Array.isArray(sl[k]) ? at(sl[k], sl, iso) : null; };
    var rem = get('rem'), deep = get('deep'), core = get('core'), eff = get('eff');
    var out = '';
    if (rem != null && deep != null && core != null) {
      var awake = get('awake');
      out += row(T.day.stagesLbl, format(T.day.stages, { rem: HC.hours(rem), deep: HC.hours(deep), core: HC.hours(core), awake: HC.hours(awake) }));
    }
    if (eff != null) out += row(T.day.eff, HC.pct(eff));
    // an in-bed-only night (DETAIL sleep.est): its device writes no stages at all
    var est = sl && Array.isArray(sl.est) && at(sl.est, sl, iso) === 1 && T.day.stagesEstimated;
    return out || '<p class="dt-note">' + esc(est ? T.day.stagesEstimated : T.day.stagesNote) + '</p>';
  }
  function nightHtml(key: string, m: Metric, iso: string): string {
    var out = [];
    var main = valueOf(m, iso);
    if (main == null) out.push('<p class="dt-nodata">' + esc(T.day.noData) + '</p>');
    var sl = metric('sleep');
    if (sl) {
      var h = at(sl.v, sl, iso);
      out.push(row(T.day.asleep, HC.hours(h), h != null && sl.target != null ? format(T.day.vsTarget, { delta: HC.hours(h - sl.target, true), target: HC.hours(sl.target) }) : ''));
      // an in-bed-only night (DETAIL sleep.est): its hours are time in bed
      if (h != null && Array.isArray(sl.est) && at(sl.est, sl, iso) === 1) out.push('<p class="dt-note">' + esc(T.day.estimated) + '</p>');
      var bed = at(sl.bed, sl, iso), wake = at(sl.wake, sl, iso);
      if (bed != null || wake != null) out.push(row(T.day.bedWake, clock(bed) + '–' + clock(wake)));
    }
    var rec = metric('recovery');
    if (rec) {
      var rv = at(rec.v, rec, iso);
      if (rv != null) out.push(row(titleOf('recovery'), format(T.day.recValue, { value: signed(rv, 1), band: T.day.bands[rv >= rec.cut ? 'above' : rv <= -rec.cut ? 'below' : 'at'] })));
    }
    ['hrv', 'rhr', 'respiratory', 'wristTemp'].forEach(function (k: string) {
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
  function stressDayHtml(key: string, m: Metric, iso: string): string {
    var v = valueOf(m, iso), P = T.deep && T.deep.stress;
    if (v == null || !P) return '<p class="dt-nodata">' + esc(T.day.noData) + '</p>';
    var band = dayState(m, v).slice(1), d = null as Baked;
    var S = stressMetric() ? SCORES.stress as StressOk : null;
    ((S && S.days) || []).forEach(function (x: Baked) { if (x && x.date === iso) d = x; });
    var sub = d && d.mins ? ['low', 'medium', 'high'].map(function (b) { return P.bands[b] + ' ' + (HC.duration as (min: number | null | undefined, units?: unknown) => string)(d.mins[b], P.units); }).join(' · ') : '';
    return row(P.avgLbl, fmt(v, 1) + ' · ' + (P.bands[band] || ''), sub);
  }
  // an energy day: its latest level + band, and the start and low when the day is baked
  function energyDayHtml(key: string, m: Metric, iso: string): string {
    var v = valueOf(m, iso), P = T.deep && T.deep.energy;
    if (v == null || !P) return '<p class="dt-nodata">' + esc(T.day.noData) + '</p>';
    var S = energyMetric() ? SCORES.energy as EnergyOk : null, d = null as Baked;
    ((S && S.days) || []).forEach(function (x: Baked) { if (x && x.date === iso && x.now) d = x; });
    var b = dayState(m, v);
    var sub = d ? format(P.daySub, { start: d.start, wake: d.wake, min: d.min.lv }) : '';
    return row(P.dayLbl, fmt(v, 0) + ' · ' + (P.bands[b === 'good' ? 'hi' : b === 'mid' ? 'mid' : 'lo'] || ''), sub);
  }
  // the nutrition score's day: the score + each component's eaten / target and points ("85 / 100 pts"),
  // then why the day may read short (a macro missing, a main meal unlogged, an assumed rest day). Today
  // is still filling up: "in progress" instead of a score, eaten / target without points.
  function nscoreDayHtml(m: Metric, iso: string): string {
    var r = m.days && own(m.days, iso) ? m.days[iso] : null, P = T.day.ns;
    if (!r || !P) return '<p class="dt-nodata">' + esc(T.day.noData) + '</p>';
    var out = [r.partial ? row(P.score, P.inProgress, P.inProgressSub) : row(P.score, HC.pct(r.score), '')];
    ['k', 'p', 'f'].forEach(function (c: string) {
      var x = r.parts[c], u = c === 'k' ? 'kcal' : 'g';
      out.push(x ? row(P[c], (x.min ? '≥ ' : '') + fmt(x.v, 0) + ' / ' + fmt(x.t, 0) + ' ' + u, r.partial ? '' : format(P.pts, { pts: x.pts })) : row(P[c], '—', P.unknown));
    });
    if (r.inc) out.push('<p class="dt-note">' + esc(P.inc) + '</p>');
    if (!r.meals) out.push('<p class="dt-note">' + esc(P.meals) + '</p>');
    if (r.assumed) out.push('<p class="dt-note">' + esc(P.assumed) + '</p>');
    return out.join('');
  }
  function totalHtml(key: string, m: Metric, iso: string): string {
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
  function sparseHtml(key: string, m: Metric, iso: string): string {
    var v = valueOf(m, iso);
    if (v == null) return '<p class="dt-nodata">' + esc(T.day.noData) + '</p>';
    var prev = null as string | null;
    for (var i = dayDiff(m.start, iso) - 1; i >= 0; i--) if (m.v[i] != null) { prev = shiftIso(m.start, i); break; }
    var u = unitOf(key);
    var sub = prev ? format(T.day.vsPrev, { delta: signed(v - valueOf(m, prev), m.dec), unit: u, date: HC.fmtDate(prev) }) : T.day.firstReading;
    return row(titleOf(key), valUnit(v, m.dec, u), sub);
  }
  function sessionHtml(s: Session): string {
    var D2 = T.day, parts = [HC.duration(s.min)];
    if (s.km != null) parts.push(format(D2.km, { n: fmt(s.km, s.km < 10 ? 2 : 1) }));
    if (s.el != null) parts.push(format(D2.elev, { n: fmt(s.el, 0) }));
    if (s.hr != null) parts.push(format(D2.hr, { n: fmt(s.hr, 0) }));
    if (s.re != null) parts.push(format(D2.re, { n: fmt(s.re, 0) }));
    if (s.n > 1) parts.push(format(D2.parts, { n: s.n }));
    var mod = T.modalities[s.m] || s.m, type = T.types[s.t] || String(s.t || '').replace(/([a-z])([A-Z])/g, '$1 $2');
    return '<li class="dt-sess"><b class="dt-sess-name">' + esc(mod + (type && type !== mod ? ' · ' + type : '')) + '</b>' +
      '<span class="dt-sess-meta">' + esc(parts.join(' · ')) + '</span>' + planHtml(s) + zonesHtml(s) +
      (s.src ? '<small class="dt-sess-src">' + esc(format(D2.source, { src: s.src })) + '</small>' : '') + '</li>';
  }
  // a planned step's target (DETAIL sessions `pl`, lib/detail/detail.mjs planView): its range ("125–135 W", pace as
  // min/km fastest first, speed as km/h) or its zone ("HR zone 2"); '' without one
  function planTarget(st: Baked): string {
    var P = T.day.plan, t = st && st.t;
    if (!t || !own(P.range, t)) return '';
    if (st.lo != null && st.hi != null) {
      if (t === 'pace') return format(P.range.pace, { lo: mss(1000 / st.hi), hi: mss(1000 / st.lo) });
      if (t === 'speed') return format(P.range.speed, { lo: fmt(st.lo * 3.6, 1), hi: fmt(st.hi * 3.6, 1) });
      return format(P.range[t], { lo: fmt(st.lo, 0), hi: fmt(st.hi, 0) });
    }
    return st.z != null ? format(P.zone[t], { n: fmt(st.z, 0) }) : '';
  }
  // a step's planned time: whole minutes as "10 min", under a minute "45 s", else m:ss
  function stepTime(sec: number): string {
    var P = T.day.plan;
    if (sec % 60 === 0) return format(P.min, { n: sec / 60 });
    return sec < 60 ? format(P.sec, { n: sec }) : mss(sec);
  }
  // the compact step list: "warm-up 10 min · 2× (35 min 125–135 W · recovery 1:30) · cool-down 10 min"
  function planSteps(items: Baked[]): string {
    var P = T.day.plan;
    return (items || []).map(function (it: Baked) {
      if (it && it.x != null && Array.isArray(it.steps)) return format(P.repeat, { n: it.x, steps: planSteps(it.steps) });
      var kind = it && own(P.kinds, it.k) ? P.kinds[it.k] : '';
      return [kind, it && it.s != null ? stepTime(it.s) : '', planTarget(it)].filter(Boolean).join(' ');
    }).join(' · ');
  }
  // the main target: the active / interval step with the most planned time (repeats counted) that has a target
  function mainTarget(items: Baked[]): string {
    var best = '', most = -1;
    (function walk(list: Baked[], times: number) {
      (list || []).forEach(function (it: Baked) {
        if (it && it.x != null && Array.isArray(it.steps)) { walk(it.steps, times * it.x); return; }
        var tg = it && (it.k === 'active' || it.k === 'interval') ? planTarget(it) : '';
        var sec = it && it.s != null ? it.s * times : 0;
        if (tg && sec > most) { best = tg; most = sec; }
      });
    })(items, 1);
    return best;
  }
  // "Plan 1:30 · 125–135 W" vs "Done 1:00 · 118 W · NP 122 W · 132 bpm" + the compact steps. No `pl` -> nothing.
  function planHtml(s: Session): string {
    var P = T.day.plan, pl = s && s.pl;
    if (!P || !pl || !Array.isArray(pl.steps)) return '';
    var dn = pl.done || {};
    var plan = [pl.min != null ? HC.duration(pl.min) : '', mainTarget(pl.steps)].filter(Boolean).join(' · ') || '—';
    var done = [dn.min != null ? HC.duration(dn.min) : '', dn.w != null ? format(P.w, { n: fmt(dn.w, 0) }) : '',
      dn.np != null ? format(P.np, { n: fmt(dn.np, 0) }) : '', dn.hr != null ? format(P.hr, { n: fmt(dn.hr, 0) }) : ''].filter(Boolean).join(' · ') || '—';
    var steps = planSteps(pl.steps);
    // laid out by the zones block's own rules (.dt-zones column, .dt-zhead caps label + figures): no CSS of its own
    return '<div class="dt-zones dt-plan" role="group" aria-label="' + esc(P.title) + '">' +
      '<p class="dt-zhead"><b>' + esc(P.plan) + '</b><span>' + esc(plan) + '</span></p>' +
      '<p class="dt-zhead"><b>' + esc(P.done) + '</b><span>' + esc(done) + '</span></p>' +
      (steps ? '<p class="dt-zhead"><span>' + esc(steps.charAt(0).toUpperCase() + steps.slice(1)) + '</span></p>' : '') + '</div>';
  }
  // seconds -> "m:ss" / "h:mm:ss"
  function mss(sec: number): string {
    var t = Math.max(0, Math.round(sec)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
    var pad = function (n: number) { return (n < 10 ? '0' : '') + n; };
    return h ? h + ':' + pad(m) + ':' + pad(x) : m + ':' + pad(x);
  }
  // the bpm range of zone i for a max HR (lower bound inclusive: bpm >= cut % of max, exact)
  function zoneBpm(i: number, max: number): string {
    var Z = T.day.zones, lo = function (k: number) { return Math.ceil((ZONE_CUTS[k] * max) / 100); };
    if (i === 0) return format(Z.below, { n: lo(0) });
    if (i === 5) return format(Z.above, { n: lo(4) });
    return format(Z.range, { lo: lo(i - 1), hi: lo(i) - 1 });
  }
  // the session's time in HR zone 5…0 (DETAIL sessions `z`, seconds) as the reference's rows: name,
  // bpm range, % of the zoned time, duration and a bar in the zone's colour; + avg / max HR and an ⓘ fold (the page fonts carry no ⓘ glyph: HC.infoSvg)
  // with the model and the max HR used. No `z` -> nothing.
  function zonesHtml(s: Session): string {
    var Z = T.day.zones, z = s.z;
    if (!Z || !z || z.length !== 6) return '';
    var tot = 0;
    for (var i = 0; i < 6; i++) tot += z[i] > 0 ? z[i] : 0;
    if (!(tot > 0)) return '';
    var zm = D.zoneMax && D.zoneMax.hr > 0 ? D.zoneMax : null;
    var hr = s.hr != null && s.hx != null ? format(Z.hrSummary, { avg: fmt(s.hr, 0), max: fmt(s.hx, 0) })
      : s.hr != null ? format(Z.hrAvg, { avg: fmt(s.hr, 0) }) : s.hx != null ? format(Z.hrMax, { max: fmt(s.hx, 0) }) : '';
    var rows: string[] = [];
    for (var k = 5; k >= 0; k--) {
      var sec = z[k] > 0 ? z[k] : 0, p = Math.round((100 * sec) / tot);
      rows.push('<li class="dt-zone dt-z' + k + '"><span class="dt-zname">' + esc(format(Z.zone, { n: k })) + '</span>' +
        (zm ? '<span class="dt-zbpm">' + esc(zoneBpm(k, zm.hr)) + '</span>' : '') +
        '<span class="dt-zpct">' + HC.pct(p) + '</span><span class="dt-zdur">' + mss(sec) + '</span>' +
        '<span class="dt-zbar"><i style="width:' + p + '%"></i></span></li>');
    }
    var note = zm ? format(Z.note, { max: fmt(zm.hr, 0), src: Z.src[zm.src as string] || '' }).replace(' ()', '') : Z.noteNoMax;
    return '<div class="dt-zones" role="group" aria-label="' + esc(Z.title) + '">' +
      '<p class="dt-zhead"><b>' + esc(Z.title) + '</b>' + (hr ? '<span>' + esc(hr) + '</span>' : '') + '</p>' +
      '<ol class="dt-zlist">' + rows.join('') + '</ol>' +
      '<details class="dt-zinfo"><summary>' + (HC.infoSvg || '') + '<span>' + esc(Z.info) + '</span></summary><p>' + esc(note) + '</p></details></div>';
  }
  function workoutsHtml(key: string, m: Metric, iso: string): string {
    var list = sessionsOn(iso, modOf(key));
    var out = [];
    if (m.kind === 'load' || m.kind === 'strain') {
      var v = valueOf(m, iso);
      if (v == null && list.length && m.kind === 'load') out.push('<p class="dt-nodata">' + esc(T.day.noEffort) + '</p>');
      else if (v != null && v > 0) out.push(row(titleOf(key), valUnit(v, m.kind === 'strain' ? 1 : 0, unitOf(key))));
    }
    if (!list.length) out.push('<p class="dt-nodata">' + esc(T.day.rest) + '</p>');
    else out.push('<ul class="dt-sessions">' + list.map(sessionHtml).join('') + '</ul>');
    if (list.some(function (x: Session) { return x.m === 'run'; })) out.push(runDynHtml(iso));
    return out.join('');
  }
  // the watch running dynamics of that day (HEALTH.running, client/health.ts's run rows, one merged
  // row per date): power, ground contact time, vertical oscillation, stride. The Entreno run row does
  // not print them (they wrapped to 2-3 lines at 390 px), so the day it opens is where they live.
  function runDynHtml(iso: string): string {
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
  function dayHtml(key: string, m: Metric, iso: string): string {
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

  /* ---------- dial deep-dive pages (client/deepdive.ts) ---------- */
  // the sheet's own helpers, handed to deepdive.ts so the dial pages read the same rules and copy
  var X: { [k: string]: unknown; sel?: string | null } = {
    T: T, D: D, at: at, valueOf: valueOf, lastDataDate: lastDataDate, dayDiff: dayDiff, modOf: modOf,
    fmt: fmt, fmtM: fmtM, signed: signed, signedM: signedM, pct: pct, clock: clock, unitOf: unitOf, titleOf: titleOf, bandText: bandText,
    metric: metric, dayState: dayState,
  };
  function deep(key: string): boolean {
    var H = typeof window !== 'undefined' ? window.HCDeep : null;
    return !!H && typeof H.isDial === 'function' && H.isDial(key) && !!T.deep;
  }
  // the History fold's state for this page session (sessionStorage when the frame allows it)
  var HIST_KEY = 'hc-dd-hist';
  var histOpen = (function () {
    try { return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(HIST_KEY) === '1'; } catch (e) { return false; }
  })();
  // the fold opens / closes in place (no re-render): only the block and the button change
  function toggleHist(btn: Element): void {
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
  function toggleInfo(btn: Element): void {
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
    var key = state!.key, vw = viewOf(key);
    if (vw) {
      var r = vw.render() || {};
      // `bare`: the view draws its own header (and #dt-title), e.g. the onboarding's back + progress bar
      return (r.bare ? '' : head(key, r.head || '', r.info)) + '<div class="dt-body">' + (r.body || '') + '</div>';
    }
    var m = metric(key);
    if (!m) return head(key) + '<div class="dt-body"><p class="dt-empty">' + esc(emptyText(key)) + '</p></div>';
    var ve = viewEnd(), end = ve.end;
    var sel = state!.date && state!.date >= m.start && state!.date <= end ? state!.date : lastDataDate(m, end);
    if (!state!.month) state!.month = monthOf(sel || end);
    var lo = monthOf(m.start), hiM = monthOf(end);
    if (state!.month! < lo) state!.month = lo;
    if (state!.month! > hiM) state!.month = hiM;
    if (windowEnd(m, end, state!.range, state!.shift) < m.start) state!.shift = 0;
    var to = windowEnd(m, end, state!.range, state!.shift), from = windowFrom(m, to, state!.range);
    state!.sel = sel;
    state!.view = { key: key, m: m, end: end };
    // the day the sheet was opened on (a dial on a stepped-to day, a day tap): the strain page follows it
    X.sel = state!.date && state!.date <= end ? state!.date : null;
    var dd = deep(key) ? window.HCDeep.render(key, m, end, X) : null;
    return (dd ? dd.head : trendHead(key, '<div class="dt-titles">' + latestHtml(key, m, end) + bandText(key, m) + '</div>')) +
      '<div class="dt-body">' + (dd ? dd.top : '') +
      (ve.stale ? '<p class="dt-stale">' + esc(format(T.staleNote, { date: HC.fmtDate(end) })) + '</p>' : '') +
      metricStaleHtml(m, end) +
      periodHtml(key, m, end, state!.range, state!.shift) + DC.chartHtml(key, m, from, to, sel, state) + DC.breakdownHtml(m, from, to) +
      foldHtml(!!dd, '<div data-dt-part="cal">' + calendarHtml(key, m, state!.month!, sel, end) + '</div>' +
      '<div data-dt-part="day">' + dayPart(key, m, sel) + '</div>') + '</div>';
  }
  // a sheet without a series: gated recovery explains its gate (the Salud card's own text); a night
  // signal absent while the build holds other data was never written by the user's device; else the
  // generic "no data yet" (a fresh build before any sync)
  function emptyText(key: string): string {
    var R = typeof SCORES !== 'undefined' && SCORES ? SCORES.recovery : null;
    if (key === 'recovery' && R && R.gated && T.rec && T.rec.insufficient) return T.rec.insufficient;
    if (NIGHT_KEYS.indexOf(key) !== -1 && key !== 'recovery' && isoDate(D.asOf) && T.unrecordedSheet) return T.unrecordedSheet;
    // a load sheet whose workouts never carry heart rate / effort: the cards' own sentence (lib/score/training-load.mjs)
    var L = typeof SCORES !== 'undefined' && SCORES ? SCORES.load : null;
    if (/^load-/.test(key) && L && Array.isArray(L.modalities) && T.load && T.load.gated && T.load.gated.noEffortSource) {
      var mod = null as Baked;
      L.modalities.forEach(function (m: Baked) { if (m && 'load-' + m.key === key) mod = m; });
      if (mod && mod.trend && mod.trend.reason === 'noEffortSource') return T.load.gated.noEffortSource;
    }
    return T.empty;
  }
  // a deep-dive page folds its month calendar + day panel behind one "History" row, so the page reads
  // like the reference (dial, contributors, insight, weekly bars, trend); collapsed by default, open
  // after a dated open (the day it was opened for is in there) and remembered for the session
  function foldHtml(fold: boolean, inner: string): string {
    if (!fold) return inner;
    var F = T.deep.hist, open = histOpen || !!state!.hist;
    return '<section class="dd-hist"><button type="button" class="dd-fold" data-dt-act="hist" aria-expanded="' + open + '" aria-controls="dd-hist">' +
      '<span class="dd-fold-t">' + esc(F.title) + '</span><span class="dd-fold-s">' + esc(F.sub) + '</span>' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg></button>' +
      '<div class="dd-hist-b" id="dd-hist"' + (open ? '' : ' hidden') + '>' + inner + '</div></section>';
  }
  function dayPart(key: string, m: Metric, sel: string | null): string {
    return sel ? dayHtml(key, m, sel) : '<p class="dt-note">' + esc(T.day.pick) + '</p>';
  }
  // a day tap: only the calendar (selection) and the day panel change, and the chart's selection
  // rect moves; the chart itself is not rebuilt. Falls back to a full render when a part is missing.
  function renderDay() {
    var v = state!.view, cal = q('[data-dt-part="cal"]'), day = q('[data-dt-part="day"]');
    if (!v || !cal || !day) { render(); return; }
    try {
      var sel = state!.date && state!.date >= v.m.start && state!.date <= v.end ? state!.date : state!.sel;
      state!.sel = sel;
      cal.innerHTML = calendarHtml(v.key, v.m, state!.month!, sel, v.end);
      day.innerHTML = dayPart(v.key, v.m, sel);
      var rect = q('.dt-sel'), sx = DC.selX(state!.geo, sel);
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
      html = head(state!.key) + '<div class="dt-body"><p class="dt-empty">' + esc(T.viewError) + '</p></div>';
    }
    host!.innerHTML = '<div class="dt-panel">' + html + '</div>';
  }

  /* ---------- open / close / history ---------- */
  function isOpen() {
    return !!state && !host!.hidden;
  }
  function hashOf() {
    if (viewOf(state!.key)) return '#' + state!.key;
    return '#detail/' + state!.key + (state!.date ? '/' + state!.date : '');
  }
  // true when the history entry was written; a sandboxed frame may refuse it (the view still works,
  // only Back / deep links do not), and then closing must never call history.back()
  function setHash(push: boolean): boolean {
    try {
      if (push) history.pushState({ hcDetail: true }, '', hashOf());
      else history.replaceState({ hcDetail: true }, '', hashOf());
      return true;
    } catch (e) {
      return false;
    }
  }
  function q(sel: string): Ctl | null {
    return host!.querySelector ? host!.querySelector<Ctl>(sel) : null;
  }
  // focus a control of the sheet; a control that a re-render removed or disabled hands focus to the
  // close button, so focus never falls out of the dialog
  function focusEl(sel: string): void {
    var el = q(sel);
    if (!el || el.disabled || typeof el.focus !== 'function') el = q('[data-dt-act="close"]');
    if (el && typeof el.focus === 'function') el.focus();
  }
  // no opener to return to (a deep link, a forward navigation): the visible tab's heading
  function focusHome() {
    var panels = document.querySelectorAll ? document.querySelectorAll<HTMLElement>('.tab-panel') : [];
    for (var i = 0; i < panels.length; i++) {
      if (panels[i].hidden) continue;
      var h = (panels[i].querySelector && panels[i].querySelector<HTMLElement>('h1, h2')) || panels[i];
      if (h.setAttribute && !(h.hasAttribute && h.hasAttribute('tabindex'))) h.setAttribute('tabindex', '-1');
      if (typeof h.focus === 'function') h.focus();
      return;
    }
  }
  // the page behind: inert (+ aria-hidden as the fallback where inert is unsupported), scroll locked
  function lockPage(on: boolean): void {
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
  function open(key: string, date: string | null, opts?: OpenOpts): void {
    opts = opts || {};
    var wasOpen = isOpen();
    if (!wasOpen) opener = opts.opener || null;
    var asked = date == null || date === '' ? null : String(date);
    state = { key: key, date: isoDate(date), range: RANGES.indexOf(opts.range) !== -1 ? opts.range : RANGES[1], shift: 0, month: null, pushed: wasOpen ? state!.pushed : !!opts.pushed, sel: null, view: null, geo: null };
    // a dated open shows its day: the History fold of a deep-dive page starts open
    state!.hist = !!state!.date;
    // while a close's Back is in flight, history is left alone: its popstate gives this sheet an entry
    if (opts.push !== false && !pendingBack) {
      var written = setHash(!wasOpen);
      if (!wasOpen) state!.pushed = written;
    }
    try {
      render();
      host!.hidden = false;
      lockPage(true);
    } catch (e) {
      hide();
      return;
    }
    if (opts.syncUrl && asked && asked !== state!.sel && !pendingBack) {
      state!.date = state!.sel;
      setHash(false);
    }
    focusEl(opts.focus || '[data-dt-act="close"]');
    if (opts.focus) scrollTo(opts.focus);
    // a dated dial page (a run / ride / timeline row): the day it was opened for sits below the hero,
    // the insight and the chart, so the sheet starts at that day's panel — except the stress page,
    // whose hero IS the dated day (the Inicio tile's earlier reading): it starts at the top
    else if (state!.date && deep(key) && key !== 'stress') scrollTo('[data-dt-part="day"]', 'start');
  }
  function scrollTo(sel: string, block?: ScrollLogicalPosition): void {
    var el = q(sel);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: block || 'nearest' });
  }
  function hide() {
    if (!state) return;
    host!.hidden = true;
    host!.innerHTML = '';
    lockPage(false);
    var o = opener;
    state = null;
    opener = null;
    if (o && typeof o.focus === 'function' && o.isConnected !== false) o.focus();
    else focusHome();
  }
  function close() {
    if (!isOpen()) return;
    var pushed = state!.pushed;
    hide();
    if (pendingBack) return; // the Back in flight already leaves this page's entry
    if (pushed) {
      pendingBack = true;
      try { history.back(); } catch (e) { pendingBack = false; }
      return;
    }
    // a deep-linked sheet (no entry of ours): the URL goes back to the tab underneath (core.ts)
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
    if (!mm) return null;
    // a retired key opens its replacement (lib/nav/tabs.mjs DETAIL_ALIAS: load-gym -> load-strength)
    var alias = typeof NAV !== 'undefined' && NAV && NAV.detailAlias;
    var key = own(alias, mm[1]) ? (alias as Readonly<Record<string, string>>)[mm[1]] : mm[1]; // own() is false without NAV
    // own keys only (no "constructor" / "toString"), and only a metric the page has data for
    if (!own(T.metrics, key) || !metric(key)) return null;
    return { key: key, date: mm[2] || null };
  }
  function act(el: Element): void {
    var a = el.getAttribute('data-dt-act');
    if (a === 'close') { close(); return; }
    if (a === 'day') {
      state!.date = isoDate(el.getAttribute('data-date'));
      if (!pendingBack) setHash(false);
      renderDay();
      focusEl('[data-date="' + state!.date + '"]');
      return;
    }
    if (a === 'info') { toggleInfo(el); return; }
    if (a === 'hist') { toggleHist(el); return; }
    if (a === 'learn') { learnMore(); return; }
    if (a === 'trend') { toTrend(); return; }
    var focusSel;
    if (a === 'range') {
      var r = +el.getAttribute('data-range')!;
      state!.range = RANGES.indexOf(r) !== -1 ? r : RANGES[1];
      state!.shift = 0;
      focusSel = '[data-range="' + state!.range + '"]';
    } else if (a === 'win') {
      var wd = +el.getAttribute('data-wdir')! || 0;
      state!.shift = Math.max(0, (state!.shift || 0) - wd);
      focusSel = '[data-wdir="' + wd + '"]';
    } else if (a === 'month') {
      var dir = +el.getAttribute('data-dir')! || 0;
      state!.month = addMonths(state!.month, dir);
      focusSel = '[data-dir="' + dir + '"]';
    } else return;
    render();
    focusEl(focusSel);
  }
  // a Tab stop the browser can really focus: not disabled, not hidden, not inside a [hidden] block,
  // a closed <details> body or a disabled fieldset
  function focusable(el: Ctl): boolean {
    if (!el || el.disabled || el.hidden) return false;
    if (!el.closest) return true;
    if (el.closest('[hidden]') || el.closest('fieldset[disabled]')) return false;
    var d = el.closest('details');
    return !d || d.open || (el.tagName === 'SUMMARY' && el.parentElement === d);
  }
  // a control inside a card (a link, a button, a summary…) keeps its own job: only a tap on the card
  // itself or its plain content opens the sheet
  var CONTROL_TAGS = ['A', 'BUTTON', 'SUMMARY', 'INPUT', 'SELECT', 'TEXTAREA'];
  function isControl(el: Element): boolean {
    return CONTROL_TAGS.indexOf(String(el.tagName || '').toUpperCase()) !== -1 || (!!el.getAttribute && el.getAttribute('role') === 'button');
  }
  function openerOf(t: Element | null): Opener | null {
    var o = t && t.closest ? t.closest('[data-detail]') : null;
    if (!o) return null;
    for (var el = t; el && el !== o; el = el.parentElement) if (isControl(el)) return null;
    return o;
  }

  document.addEventListener('click', function (e) {
    var t = e.target as Element | null;
    if (!t) return;
    if (isOpen() && t === host) { close(); return; }
    var a = t.closest ? t.closest('[data-dt-act]') : null;
    if (a && isOpen()) { act(a); return; }
    var o = openerOf(t);
    if (o) {
      if (e.preventDefault) e.preventDefault();
      open(o.getAttribute('data-detail')!, o.getAttribute('data-date'), { opener: o });
    }
  });
  // the trend view's metric picker: the sheet re-opens on the picked metric (same range, URL replaced)
  document.addEventListener('change', function (e) {
    var t = e.target as (Element & { value?: string }) | null;
    if (!t || !isOpen() || !t.getAttribute || t.getAttribute('data-dt-pick') !== 'metric') return;
    var k = String(t.value || '');
    if (trendKeys().indexOf(k) === -1 || k === state!.key) return;
    open(k, null, { range: state!.range, focus: '[data-dt-pick="metric"]' });
  });
  document.addEventListener('keydown', function (e) {
    // a key a view already handled (the add sheet's Escape back to its list, client/food-sheet.ts) is left alone
    if (e.defaultPrevented) return;
    if (isOpen()) {
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab' && host!.querySelectorAll) {
        var f = Array.prototype.slice.call(host!.querySelectorAll(TRAP)).filter(focusable);
        if (!f.length) return;
        var i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
      }
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var o = openerOf(e.target as Element | null);
    if (!o) return;
    e.preventDefault();
    open(o.getAttribute('data-detail')!, o.getAttribute('data-date'), { opener: o });
  });
  window.addEventListener('popstate', function () {
    if (pendingBack) {
      // the Back of a close: a sheet opened meanwhile gets its own history entry now
      pendingBack = false;
      if (isOpen()) state!.pushed = setHash(true);
      return;
    }
    var h = fromHash();
    if (h) open(h.key, h.date, { push: false, pushed: !!(history.state && history.state!.hcDetail), syncUrl: true });
    else if (isOpen()) hide();
  });

  window.HCDetail = {
    // opts.focus: a control of the view to focus (the goal chip opens the profile sheet on its goal);
    // opts.opener: where focus returns on close (default: the focused element)
    open: function (key: string, date: string | null, opts?: { opener?: Opener | null; focus?: unknown }) {
      open(key, date, { opener: (opts && opts.opener) || document.activeElement || null, focus: opts && typeof opts.focus === 'string' ? opts.focus : null });
    },
    close: close,
    state: function () { return state; },
    dayState: dayState,
    periodStats: function (key: string, end: string, days: number) { var m = metric(key); return m ? periodStats(m, end, days) : null; },
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
