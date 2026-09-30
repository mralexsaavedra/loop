/* Detail sheet: a tap on any card opens its metric full-screen (phones) or as a large centred panel
 * (desktop), Whoop-style: header (metric, latest value + date, personal band / target), a 30 d / 90 d /
 * 1 yr range switch, a chart (daily points or bars, the 7-day average line, the personal band; a
 * missing day is a gap, never 0), a Monday-first month calendar coloured by state tokens against that
 * band / target, and the picked day's detail underneath.
 *
 * Classic script (is:inline, no module scope). Reads DETAIL (lib/detail/detail.mjs) + I18N_DETAIL, both
 * baked by components/DetailSheet.astro, and the shared helpers of util.js (window.HC). Openers are any
 * element with data-detail="<metric>" [data-date="<iso>"] (HC.detailAttrs writes them): one delegated
 * click / keydown listener, so the card renderers never wire handlers. The view ends at the VIEWER's
 * today (Date.now(), never baked), or at the data's own asOf when that is stale or ahead of the clock.
 *
 * Modal contract: role="dialog" + aria-modal on #detail, the page behind is `inert`, focus moves to the
 * close button, Tab stays inside, Esc / the close button / a tap on the backdrop close it, and focus
 * returns to the opener. History: opening pushes #detail/<metric>[/<date>] so browser Back closes it; a
 * page opened with that hash opens the view (deep link). Every view renders inside a try/catch with a
 * message fallback; no NaN is ever printed (non-finite values render as a dash).
 */
(function () {
  var host = document.getElementById('detail');
  var T = typeof I18N_DETAIL === 'undefined' ? null : I18N_DETAIL;
  if (!host || !T) return;
  var D = typeof DETAIL === 'undefined' || !DETAIL ? { asOf: null, metrics: {}, sessions: [] } : DETAIL;
  var esc = HC.esc, format = HC.format, isoDate = HC.isoDate, parseIso = HC.parseIso, shiftIso = HC.shiftIso;
  var RANGES = [30, 90, 365];
  // chart geometry (SVG user units): width, height, inner padding
  var CW = 320, CH = 140, CPAD = 8;
  // a 7-day average needs at least 3 days with data (same floor as the recovery trend)
  var ROLL_DAYS = 7, ROLL_MIN = 3;
  var NIGHT_KEYS = ['sleep', 'recovery', 'hrv', 'rhr', 'respiratory', 'wristTemp', 'walkingHr'];
  var HASH_RE = /^#detail\/([A-Za-z-]+)(?:\/(\d{4}-\d{2}-\d{2}))?$/;
  var state = null;
  var opener = null;

  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-labelledby', 'dt-title');

  /* ---------- data access ---------- */
  function dayDiff(a, b) {
    return Math.round((parseIso(b) - parseIso(a)) / HC.MS_PER_DAY);
  }
  function metric(key) {
    var m = D.metrics && D.metrics[key];
    return m && isoDate(m.start) ? m : null;
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
  function lastDataDate(m, end) {
    for (var i = Math.min(m.v.length - 1, dayDiff(m.start, end)); i >= 0; i--) {
      if (typeof m.v[i] === 'number' && isFinite(m.v[i]) && (m.kind !== 'workouts' || m.v[i] > 0)) return shiftIso(m.start, i);
    }
    return null;
  }
  // the view's last day: the viewer's today, or the data's asOf when stale / ahead of the clock
  function viewEnd() {
    var today = HC.todayIso(), asOf = isoDate(D.asOf);
    if (!asOf) return { end: today, stale: false };
    var age = HC.daysOld(asOf);
    if (age > HC.STALE_DAYS) return { end: asOf, stale: true };
    return { end: age < 0 ? asOf : today, stale: false };
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
    return signed(v, 0) + (HC.isEs() ? ' %' : '%');
  }
  function clock(h) {
    if (h == null || !isFinite(h)) return '—';
    h = ((h % 24) + 24) % 24;
    var H = Math.floor(h), M = Math.round((h - H) * 60);
    if (M === 60) { M = 0; H = (H + 1) % 24; }
    return String(H).padStart(2, '0') + ':' + String(M).padStart(2, '0');
  }
  function unitOf(key) {
    return (T.metrics[key] && T.metrics[key].unit) || '';
  }
  function titleOf(key) {
    return (T.metrics[key] && T.metrics[key].title) || key;
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
    if (m.kind === 'workouts' || m.kind === 'load') return v > 0 ? 'l' + Math.max(1, level(v, m.levels)) : 'rest';
    if (m.kind === 'sparse') return 'measured';
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
    var fill = function (b, dec) { return { lo: fmt(b.lo, dec), hi: fmt(b.hi, dec), median: fmt(b.median, dec), unit: u }; };
    var out = [];
    if (m.kind === 'sleep' && m.target != null) out.push(format(B.target, { value: fmt(m.target, 1), unit: u }));
    if ((m.kind === 'signal' || m.kind === 'sleep') && m.band) out.push(format(B.monitor, fill(m.band, d)));
    if (m.kind === 'total' && m.band) out.push(format(B.iqr, fill(m.band, m.dec)));
    if (m.kind === 'load') out.push(m.typical != null ? format(B.typical, { value: fmt(m.typical, 0) }) : B.noTypical);
    if (m.kind === 'recovery') out.push(format(B.recovery, { cut: fmt(m.cut, 1) }));
    if (m.kind === 'sparse') out.push(format(B.sparse, { n: m.v.filter(function (x) { return x != null; }).length }));
    return out.map(function (s) { return '<div class="dt-band-txt">' + esc(s) + '</div>'; }).join('');
  }
  function head(key, inner) {
    return '<div class="dt-head"><div class="dt-titles"><h2 id="dt-title">' + esc(titleOf(key)) + '</h2>' + (inner || '') + '</div>' +
      '<button type="button" class="dt-close" data-dt-act="close" aria-label="' + esc(T.close) + '">×</button></div>';
  }
  function latestHtml(key, m, end) {
    var d = lastDataDate(m, end);
    if (!d) return '<div class="dt-latest"><span class="dt-none">' + esc(T.noData) + '</span></div>';
    var v = valueOf(m, d);
    var num = m.kind === 'recovery' ? signed(v, 1) : fmt(v, m.kind === 'sleep' ? 1 : m.dec);
    return '<div class="dt-latest"><b class="dt-num dt-c-' + esc(dayState(m, v)) + '">' + esc(num) + '</b><small>' + esc(unitOf(key)) + '</small>' +
      '<span class="dt-when">' + esc(format(T.latestLbl, { date: HC.fmtDate(d) })) + '</span></div>';
  }

  /* ---------- range switch ---------- */
  function rangeHtml(range) {
    var lbl = { 30: T.ranges.d30, 90: T.ranges.d90, 365: T.ranges.d365 };
    return '<div class="dt-range" role="group" aria-label="' + esc(T.rangeLabel) + '">' + RANGES.map(function (r) {
      return '<button type="button" data-dt-act="range" data-range="' + r + '" aria-pressed="' + (r === range ? 'true' : 'false') + '">' + esc(lbl[r]) + '</button>';
    }).join('') + '</div>';
  }

  /* ---------- chart ---------- */
  function chartHtml(key, m, from, to, sel) {
    var n = dayDiff(from, to) + 1;
    var bars = m.kind === 'total' || m.kind === 'workouts' || m.kind === 'load';
    var days = [], vals = [];
    for (var i = 0; i < n; i++) {
      var iso = shiftIso(from, i), v = valueOf(m, iso);
      days.push({ iso: iso, v: v });
      if (v != null) vals.push(v);
    }
    var line = [];
    if (m.kind === 'recovery') days.forEach(function (d) { line.push(at(m.t7, m, d.iso)); });
    else if (m.kind !== 'sparse') days.forEach(function (d) { line.push(roll7(m, d.iso)); });
    var ext = vals.concat(line.filter(function (x) { return x != null; }));
    if (m.band) ext.push(m.band.lo, m.band.hi);
    if (m.target != null) ext.push(m.target);
    if (m.typical != null) ext.push(m.typical);
    if (m.kind === 'recovery') ext.push(m.cut, -m.cut);
    var lo = bars ? 0 : Math.min.apply(null, ext.length ? ext : [0]);
    var hi = Math.max.apply(null, ext.length ? ext : [1]);
    if (!bars) { var pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad; } else hi = hi * 1.08 || 1;
    var slot = (CW - 2 * CPAD) / n;
    var x = function (i) { return CPAD + slot * (i + 0.5); };
    var y = function (v) { return CPAD + (CH - 2 * CPAD) * (1 - (v - lo) / (hi - lo)); };
    var f = function (v) { return v.toFixed(1); };
    var out = ['<svg class="dt-chart" viewBox="0 0 ' + CW + ' ' + CH + '" role="img" aria-label="' +
      esc(format(T.chartAria, { title: titleOf(key), from: HC.fmtDate(from), to: HC.fmtDate(to) })) + '">'];
    var hline = function (cls, v) { out.push('<line class="' + cls + '" x1="0" x2="' + CW + '" y1="' + f(y(v)) + '" y2="' + f(y(v)) + '"/>'); };
    var zone = function (a, b) { out.push('<rect class="dt-band" x="0" width="' + CW + '" y="' + f(y(b)) + '" height="' + f(Math.max(0, y(a) - y(b))) + '"/>'); };
    if (m.kind === 'recovery') { zone(-m.cut, m.cut); hline('dt-med', 0); }
    else if (m.band) { zone(m.band.lo, m.band.hi); hline('dt-med', m.band.median); }
    if (m.target != null) hline('dt-target', m.target);
    if (m.typical != null) hline('dt-target', m.typical);
    var si = sel ? dayDiff(from, sel) : -1;
    if (si >= 0 && si < n) out.push('<rect class="dt-sel" x="' + f(x(si) - slot / 2) + '" y="0" width="' + f(slot) + '" height="' + CH + '"/>');
    var bw = Math.max(0.6, slot * 0.7), r = n > 120 ? 1.3 : n > 45 ? 1.8 : 2.4;
    days.forEach(function (d, i) {
      if (d.v == null) return;
      var st = dayState(m, d.v);
      if (bars) {
        if (d.v <= 0) return;
        out.push('<rect class="dt-bar dt-s-' + st + '" x="' + f(x(i) - bw / 2) + '" y="' + f(y(d.v)) + '" width="' + f(bw) + '" height="' + f(Math.max(0.5, y(0) - y(d.v))) + '"/>');
      } else {
        out.push('<circle class="dt-pt dt-s-' + st + '" cx="' + f(x(i)) + '" cy="' + f(y(d.v)) + '" r="' + r + '"/>');
      }
    });
    // the 7-day line breaks where the average is undefined, so a gap never reads as a trend
    var path = '', pen = false;
    line.forEach(function (v, i) {
      if (v == null) { pen = false; return; }
      path += (pen ? ' L' : ' M') + f(x(i)) + ',' + f(y(v));
      pen = true;
    });
    if (path) out.push('<path class="dt-line" d="' + path.trim() + '"/>');
    out.push('</svg>');
    var key2 = ['<span class="dt-k dt-k-daily">' + esc(T.chartKey.daily) + '</span>'];
    if (line.some(function (v) { return v != null; })) key2.push('<span class="dt-k dt-k-line">' + esc(T.chartKey.roll7) + '</span>');
    if (m.kind === 'recovery') key2.push('<span class="dt-k dt-k-band">' + esc(T.chartKey.baseline) + '</span>');
    else if (m.band) key2.push('<span class="dt-k dt-k-band">' + esc(T.chartKey.band) + '</span>');
    if (m.target != null) key2.push('<span class="dt-k dt-k-target">' + esc(T.chartKey.target) + '</span>');
    if (m.typical != null) key2.push('<span class="dt-k dt-k-target">' + esc(T.chartKey.typical) + '</span>');
    return '<figure class="dt-fig">' + out.join('') +
      '<div class="dt-ax"><span>' + esc(HC.fmtDate(from)) + '</span><span>' + esc(HC.fmtDate(to)) + '</span></div>' +
      '<figcaption class="dt-keys">' + key2.join('') + '</figcaption></figure>';
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
  function legendHtml(m) {
    var L = T.legend, items;
    if (m.kind === 'workouts' || m.kind === 'load') items = [['l1', ''], ['l2', ''], ['l3', ''], ['l4', L.levels]];
    else if (m.kind === 'sparse') items = [['measured', L.measured]];
    else if (m.kind === 'recovery') items = [['good', L.recAbove], ['normal', L.recAt], ['bad', L.recBelow]];
    else if (m.kind === 'sleep') items = [['good', L.sleepGood], ['mid', L.sleepMid], ['bad', L.sleepBad]];
    else if (!m.band) items = [['normal', L.measured]];
    else if (m.dir === 0 && m.kind === 'total') items = [['hi', L.hi], ['normal', L.normal], ['lo', L.lo]];
    else if (m.dir === 0) items = [['normal', L.normal], ['watch', L.watch]];
    else items = [['good', L.good], ['normal', L.normal], ['bad', L.bad]];
    items.push(['none', L.none]);
    return '<div class="dt-legend">' + items.map(function (it) {
      return '<span class="dt-leg"><span class="dt-sw dt-s-' + it[0] + '" aria-hidden="true"></span>' + esc(it[1]) + '</span>';
    }).join('') + '</div>';
  }
  function calendarHtml(key, m, month, sel, end) {
    var first = monthOf(m.start), last = monthOf(end);
    var N = typeof I18N_DATE !== 'undefined' && I18N_DATE ? I18N_DATE.weekdaysMin : ['1', '2', '3', '4', '5', '6', '7'];
    var out = ['<div class="dt-cal-head"><button type="button" class="dt-mnav" data-dt-act="month" data-dir="-1" aria-label="' + esc(T.prevMonth) + '"' + (month <= first ? ' disabled' : '') + '>‹</button>' +
      '<h3 class="dt-month">' + esc(HC.fmtMonth(month)) + '</h3>' +
      '<button type="button" class="dt-mnav" data-dt-act="month" data-dir="1" aria-label="' + esc(T.nextMonth) + '"' + (month >= last ? ' disabled' : '') + '>›</button></div>'];
    out.push('<div class="dt-cal" role="group" aria-label="' + esc(format(T.calAria, { title: titleOf(key), month: HC.fmtMonth(month) })) + '">');
    N.forEach(function (w) { out.push('<span class="dt-wd">' + esc(w) + '</span>'); });
    var lead = HC.weekdayIndex(month);
    for (var b = 0; b < lead; b++) out.push('<span class="dt-blank"></span>');
    var next = addMonths(month, 1);
    for (var d = month; d < next; d = shiftIso(d, 1)) {
      var day = String(parseIso(d).getDate());
      if (d > end || d < m.start) { out.push('<span class="dt-day dt-out">' + day + '</span>'); continue; }
      var v = valueOf(m, d), st = dayState(m, v);
      var lbl = HC.fmtDate(d) + ': ' + (v == null ? T.noData : (m.kind === 'recovery' ? signed(v, 1) : fmt(v, m.dec)) + ' ' + unitOf(key));
      out.push('<button type="button" class="dt-day dt-s-' + st + '" data-dt-act="day" data-date="' + d + '" aria-pressed="' + (d === sel ? 'true' : 'false') + '" aria-label="' + esc(lbl) + '">' + day + '</button>');
    }
    out.push('</div>');
    return out.join('') + legendHtml(m);
  }

  /* ---------- day detail ---------- */
  function row(lbl, val, sub) {
    return '<div class="dt-row"><span class="dt-row-lbl">' + esc(lbl) + '</span><b class="dt-row-val">' + esc(val) + '</b>' + (sub ? '<small class="dt-row-sub">' + esc(sub) + '</small>' : '') + '</div>';
  }
  function nightHtml(key, m, iso) {
    var out = [];
    var main = valueOf(m, iso);
    if (main == null) out.push('<p class="dt-nodata">' + esc(T.day.noData) + '</p>');
    var sl = metric('sleep');
    if (sl) {
      var h = at(sl.v, sl, iso);
      out.push(row(T.day.asleep, valUnit(h, 1, 'h'), h != null && sl.target != null ? format(T.day.vsTarget, { delta: signed(h - sl.target, 1), target: fmt(sl.target, 1) }) : ''));
      var bed = at(sl.bed, sl, iso), wake = at(sl.wake, sl, iso);
      if (bed != null || wake != null) out.push(row(T.day.bedWake, clock(bed) + '–' + clock(wake)));
    }
    var rec = metric('recovery');
    if (rec) {
      var rv = at(rec.v, rec, iso);
      if (rv != null) out.push(row(titleOf('recovery'), format(T.day.recValue, { value: signed(rv, 1), band: T.day.bands[rv >= rec.cut ? 'above' : rv <= -rec.cut ? 'below' : 'at'] })));
    }
    ['hrv', 'rhr', 'respiratory', 'wristTemp', 'walkingHr'].forEach(function (k) {
      var mk = metric(k);
      if (!mk) return;
      var v = at(mk.v, mk, iso);
      if (v != null || k === key) out.push(row(titleOf(k), valUnit(v, mk.dec, unitOf(k))));
    });
    if (key === 'sleep') out.push('<p class="dt-note">' + esc(T.day.stagesNote) + '</p>');
    return out.join('');
  }
  function totalHtml(key, m, iso) {
    var v = valueOf(m, iso);
    if (v == null) return '<p class="dt-nodata">' + esc(T.day.noData) + '</p>';
    var u = unitOf(key);
    var sub = m.band && m.band.median > 0 ? format(T.day.vsMedian, { pct: pct(Math.round(100 * (v / m.band.median - 1))), median: fmt(m.band.median, m.dec), unit: u }) : '';
    var out = [row(key === 'energy' ? T.day.total : titleOf(key), valUnit(v, m.dec, u), sub)];
    if (key === 'energy') {
      out.push(row(T.day.active, valUnit(at(m.active, m, iso), 0, u)));
      out.push(row(T.day.basal, valUnit(at(m.basal, m, iso), 0, u)));
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
    var D2 = T.day, parts = [format(D2.minutes, { n: fmt(s.min, 0) })];
    if (s.km != null) parts.push(format(D2.km, { n: fmt(s.km, s.km < 10 ? 2 : 1) }));
    if (s.el != null) parts.push(format(D2.elev, { n: fmt(s.el, 0) }));
    if (s.hr != null) parts.push(format(D2.hr, { n: fmt(s.hr, 0) }));
    if (s.re != null) parts.push(format(D2.re, { n: fmt(s.re, 0) }));
    if (s.n > 1) parts.push(format(D2.parts, { n: s.n }));
    var mod = T.modalities[s.m] || s.m, type = T.types[s.t] || String(s.t || '').replace(/([a-z])([A-Z])/g, '$1 $2');
    return '<li class="dt-sess"><b class="dt-sess-name">' + esc(mod + (type && type !== mod ? ' · ' + type : '')) + '</b>' +
      '<span class="dt-sess-meta">' + esc(parts.join(' · ')) + '</span>' +
      (s.src ? '<small class="dt-sess-src">' + esc(format(D2.source, { src: s.src })) + '</small>' : '') + '</li>';
  }
  function workoutsHtml(key, m, iso) {
    var list = sessionsOn(iso, modOf(key));
    var out = [];
    if (m.kind === 'load') {
      var v = valueOf(m, iso);
      if (v == null && list.length) out.push('<p class="dt-nodata">' + esc(T.day.noEffort) + '</p>');
      else if (v != null && v > 0) out.push(row(titleOf(key), valUnit(v, 0, unitOf(key))));
    }
    if (!list.length) out.push('<p class="dt-nodata">' + esc(T.day.rest) + '</p>');
    else out.push('<ul class="dt-sessions">' + list.map(sessionHtml).join('') + '</ul>');
    return out.join('');
  }
  function dayHtml(key, m, iso) {
    var body = m.kind === 'workouts' || m.kind === 'load' ? workoutsHtml(key, m, iso)
      : m.kind === 'total' ? totalHtml(key, m, iso)
      : m.kind === 'sparse' ? sparseHtml(key, m, iso)
      : NIGHT_KEYS.indexOf(key) !== -1 ? nightHtml(key, m, iso)
      : totalHtml(key, m, iso);
    return '<section class="dt-dayd" aria-live="polite"><h3 class="dt-day-h">' + esc(format(T.day.heading, { date: HC.fmtDate(iso) })) + '</h3>' + body + '</section>';
  }

  /* ---------- view ---------- */
  function viewHtml() {
    var key = state.key, m = metric(key);
    if (!m) return head(key) + '<div class="dt-body"><p class="dt-empty">' + esc(T.empty) + '</p></div>';
    var ve = viewEnd(), end = ve.end;
    var sel = state.date && state.date >= m.start && state.date <= end ? state.date : lastDataDate(m, end);
    if (!state.month) state.month = monthOf(sel || end);
    var lo = monthOf(m.start), hiM = monthOf(end);
    if (state.month < lo) state.month = lo;
    if (state.month > hiM) state.month = hiM;
    var from = shiftIso(end, -(state.range - 1));
    return head(key, latestHtml(key, m, end) + bandText(key, m)) +
      '<div class="dt-body">' +
      (ve.stale ? '<p class="dt-stale">' + esc(format(T.staleNote, { date: HC.fmtDate(end) })) + '</p>' : '') +
      rangeHtml(state.range) + chartHtml(key, m, from, end, sel) +
      calendarHtml(key, m, state.month, sel, end) +
      (sel ? dayHtml(key, m, sel) : '<p class="dt-note">' + esc(T.day.pick) + '</p>') + '</div>';
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
    return '#detail/' + state.key + (state.date ? '/' + state.date : '');
  }
  function setHash(push) {
    try {
      if (push) history.pushState({ hcDetail: true }, '', hashOf());
      else history.replaceState({ hcDetail: true }, '', hashOf());
    } catch (e) { /* sandboxed frame: the view still works, only Back / deep links do not */ }
  }
  function focusEl(sel) {
    var el = host.querySelector ? host.querySelector(sel) : null;
    if (el && el.focus) el.focus();
  }
  function lockPage(on) {
    var wrap = document.querySelector ? document.querySelector('.wrap') : null;
    if (wrap) { if (on) wrap.setAttribute('inert', ''); else wrap.removeAttribute('inert'); }
    var root = document.documentElement;
    if (root && root.classList) root.classList[on ? 'add' : 'remove']('dt-lock');
  }
  function open(key, date, opts) {
    opts = opts || {};
    var wasOpen = isOpen();
    if (!wasOpen) opener = opts.opener || document.activeElement || null;
    state = { key: key, date: isoDate(date), range: RANGES[0], month: null, pushed: wasOpen ? state.pushed : !!opts.pushed };
    if (opts.push !== false) {
      setHash(!wasOpen);
      if (!wasOpen) state.pushed = true;
    }
    render();
    host.hidden = false;
    lockPage(true);
    focusEl('[data-dt-act="close"]');
  }
  function hide() {
    if (!state) return;
    host.hidden = true;
    host.innerHTML = '';
    lockPage(false);
    var o = opener;
    state = null;
    opener = null;
    if (o && o.focus) o.focus();
  }
  function close() {
    if (!isOpen()) return;
    var pushed = state.pushed;
    hide();
    try {
      if (pushed) history.back();
      else history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { /* see setHash */ }
  }
  function fromHash() {
    var mm = HASH_RE.exec((typeof location !== 'undefined' && location.hash) || '');
    if (!mm || !T.metrics[mm[1]]) return null;
    return { key: mm[1], date: mm[2] || null };
  }
  function act(el) {
    var a = el.getAttribute('data-dt-act');
    if (a === 'close') { close(); return; }
    var focusSel = null;
    if (a === 'range') {
      state.range = +el.getAttribute('data-range') || RANGES[0];
      focusSel = '[data-range="' + state.range + '"]';
    } else if (a === 'month') {
      var dir = +el.getAttribute('data-dir') || 0;
      state.month = addMonths(state.month, dir);
      focusSel = '[data-dir="' + dir + '"]';
    } else if (a === 'day') {
      state.date = isoDate(el.getAttribute('data-date'));
      setHash(false);
      focusSel = '[data-date="' + state.date + '"]';
    } else return;
    render();
    if (focusSel) focusEl(focusSel);
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) return;
    if (isOpen() && t === host) { close(); return; }
    var a = t.closest ? t.closest('[data-dt-act]') : null;
    if (a && isOpen()) { act(a); return; }
    var o = t.closest ? t.closest('[data-detail]') : null;
    if (o) {
      if (e.preventDefault) e.preventDefault();
      open(o.getAttribute('data-detail'), o.getAttribute('data-date'), { opener: o });
    }
  });
  document.addEventListener('keydown', function (e) {
    if (isOpen()) {
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab' && host.querySelectorAll) {
        var f = Array.prototype.slice.call(host.querySelectorAll('button:not([disabled])'));
        if (!f.length) return;
        var i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
      }
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var o = e.target && e.target.closest ? e.target.closest('[data-detail]') : null;
    if (!o) return;
    e.preventDefault();
    open(o.getAttribute('data-detail'), o.getAttribute('data-date'), { opener: o });
  });
  window.addEventListener('popstate', function () {
    var h = fromHash();
    if (h) open(h.key, h.date, { push: false, pushed: !!(history.state && history.state.hcDetail) });
    else if (isOpen()) hide();
  });

  window.HCDetail = {
    open: function (key, date) { open(key, date, {}); },
    close: close,
    state: function () { return state; },
    dayState: dayState,
  };

  var initial = fromHash();
  if (initial) open(initial.key, initial.date, { push: false });
})();
