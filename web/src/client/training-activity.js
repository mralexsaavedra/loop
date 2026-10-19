/* Entreno "Activity" card: ONE card for the 30-day calendar, the cumulative training time and the
 * weekly volume + modality split. Rendered from ACTIVITY
 * (lib/training/activity.mjs) + I18N_ACTIVITY, both baked by tabs/TrainingDetail.astro.
 *
 * Top to bottom: the "ACTIVITY" header with an ⓘ (how the numbers are counted, the Watch-label
 * caveat), then the card: TOTAL TIME of the chosen window + a pill vs the window before it, the
 * W / M / 6M switch (7 / 30 / 182 days, the detail sheet's ranges), SESSIONS · DAYS · PER WEEK, the
 * modality split as one stacked bar with a legend (sessions × + share of the minutes), and the
 * compact 30-day calendar (always the last 30 days, Monday-first, one sequential hue: --strain).
 *
 * Classic script (is:inline, no module scope). ACTIVITY holds one entry per active day of the last
 * 367 data days; every window ends HERE at the viewer's today (from Date.now(), never baked, so
 * builds stay byte-identical) — or at the data's own date when that is more than STALE_DAYS old
 * (greyed with a note) or AFTER the viewer's today (clock / timezone skew: its sessions stay
 * visible). A window that starts before the first session gets no comparison. Geometry lives in SVG
 * attributes (no inline styles). A throw renders the empty state, never a blank tab. The totals and
 * the calendar open the training-time detail sheet (HC.detailAttrs -> client/detail.js); a tap on a
 * day cell opens that day. The chosen window is a per-viewer convenience (localStorage, optional).
 */
(function () {
  var host = document.getElementById('train-activity');
  if (!host) return;
  var A = typeof ACTIVITY === 'undefined' ? null : ACTIVITY;
  var T = typeof I18N_ACTIVITY === 'undefined' ? null : I18N_ACTIVITY;
  if (!T) return;
  var W = typeof window === 'undefined' ? null : window;
  // calendar geometry (SVG user units): square cells with a gap, a weekday header row on top
  var CAL_CELL = 16, CAL_GAP = 4, CAL_STEP = CAL_CELL + CAL_GAP, CAL_HEAD = 14, CAL_WD_Y = 10, CAL_RX = 4;
  // wide screens (styles/base.css breakpoint): the calendar is an HTML grid spanning the card's full
  // width (.cal-grid, styles/training.css) instead of the phone's fixed-size SVG; re-rendered on change
  var WIDE = '(min-width: 900px)';
  // the bar's known buckets (the dashboard's; the Watch's `hiit` is shown as Gym); segments are drawn
  // largest first
  var MODS = ['hiit', 'strength', 'run', 'bike', 'other'];
  // a change below this share is "about the same" (the detail sheet's DELTA_FLAT)
  var DELTA_FLAT = 0.01;
  var RANGE_KEY = { 7: 'w', 30: 'm', 182: 'm6' };
  var STORE = 'hc-act-range';
  // shared helpers (web/src/client/util.js); windows and level cuts are baked in ACTIVITY
  var esc = HC.esc, format = HC.format, shift = HC.shiftIso, parse = HC.parseIso;
  var PERIODS = A && Array.isArray(A.periods) ? A.periods : [7, 30, 182];
  var range = 30;
  try {
    var saved = Number(W.localStorage.getItem(STORE));
    if (PERIODS.indexOf(saved) !== -1) range = saved;
  } catch (e) { /* no storage: the default window */ }

  function hm(min) {
    return HC.duration(min);
  }
  function level(min, cuts) {
    var l = 0;
    cuts.forEach(function (cut, i) { if (min >= cut) l = i + 1; });
    return l;
  }
  function pct(v) {
    return HC.pct(v);
  }

  // The numbers of one window [end − n + 1, end] (pure; exposed as HCActivity.summary): total minutes,
  // sessions (one per day and modality — the shared same-day rule already merged the fragments),
  // active days, minutes per week, the split by modality ({min, n}) and, when the window before it
  // lies wholly after the first session and inside the baked days, its total (`prev`) and the change
  // in % (`pct`, null when the window before had no training).
  function summary(byDate, end, n) {
    var out = { from: shift(end, -(n - 1)), to: end, min: 0, sessions: 0, days: 0, perWeek: 0, mods: {}, prev: null, pct: null };
    function sum(from, to, mods) {
      var t = 0;
      for (var d = from; d <= to; d = shift(d, 1)) {
        var x = byDate[d];
        if (!x || !(x.min > 0)) continue;
        t += x.min;
        if (!mods) continue;
        out.days++;
        Object.keys(x.mods).forEach(function (k) {
          var m = mods[k] || (mods[k] = { min: 0, n: 0 });
          m.min += x.mods[k];
          m.n++;
          out.sessions++;
        });
      }
      return t;
    }
    out.min = sum(out.from, end, out.mods);
    out.perWeek = Math.round(out.min * 7 / n);
    var pFrom = shift(out.from, -n), pTo = shift(out.from, -1);
    var baked = A && A.asOf && A.bakeDays ? shift(A.asOf, -(A.bakeDays - 1)) : pFrom;
    if (A && A.first && pFrom >= A.first && pFrom >= baked) {
      out.prev = sum(pFrom, pTo, null);
      out.pct = out.prev > 0 ? 100 * (out.min - out.prev) / out.prev : null;
    }
    return out;
  }

  function wide() {
    try { return !!(W && typeof W.matchMedia === 'function' && W.matchMedia(WIDE).matches); } catch (e) { return false; }
  }

  function cellTitle(date, d) {
    var min = d ? d.min : 0;
    var mods = d ? Object.keys(d.mods).map(function (m) { return (T.modalityLabels[m] || m) + ' ' + hm(d.mods[m]); }).join(', ') : '';
    var shown = HC.fmtDate(date); // display date; the ISO stays in data-date
    return min > 0 ? format(T.cellTitle, { date: shown, time: hm(min) }) + (Object.keys(d.mods).length > 1 ? ' (' + mods + ')' : '') : format(T.cellRest, { date: shown });
  }

  // wide screens: 7 equal columns across the card, the same Monday-first offset, levels and openers
  function calendarGrid(dates, byDate) {
    var offset = (parse(dates[0]).getDay() + 6) % 7; // Monday = 0
    var out = ['<div class="cal-grid" role="img" aria-label="' + esc(T.calAria) + '">'];
    T.weekdays.forEach(function (w) { out.push('<span class="cal-wd">' + esc(w) + '</span>'); });
    for (var i = 0; i < offset; i++) out.push('<span class="cal-pad"></span>');
    dates.forEach(function (date) {
      var d = byDate[date];
      out.push('<span class="cal-day cal-l' + level(d ? d.min : 0, A.levelMin) + '"' + HC.detailAttrs('workouts', date, { plain: true }) + ' title="' + esc(cellTitle(date, d)) + '"></span>');
    });
    out.push('</div>');
    return out.join('');
  }

  function calendar(dates, byDate) {
    if (wide()) return calendarGrid(dates, byDate);
    var CELL = CAL_CELL, GAP = CAL_GAP, STEP = CAL_STEP, HEAD = CAL_HEAD;
    var offset = (parse(dates[0]).getDay() + 6) % 7; // Monday = 0
    var rows = Math.ceil((offset + dates.length) / 7);
    var out = ['<svg class="cal-svg" viewBox="0 0 ' + (7 * STEP - GAP) + ' ' + (HEAD + rows * STEP - GAP) + '" role="img" aria-label="' + esc(T.calAria) + '">'];
    T.weekdays.forEach(function (w, i) {
      out.push('<text class="cal-wd" x="' + (i * STEP + CELL / 2) + '" y="' + CAL_WD_Y + '" text-anchor="middle">' + esc(w) + '</text>');
    });
    dates.forEach(function (date, i) {
      var k = offset + i, d = byDate[date];
      var min = d ? d.min : 0;
      var title = cellTitle(date, d);
      out.push('<rect class="cal-cell cal-l' + level(min, A.levelMin) + '"' + HC.detailAttrs('workouts', date, { plain: true }) + ' x="' + ((k % 7) * STEP) + '" y="' + (HEAD + Math.floor(k / 7) * STEP) + '" width="' + CELL + '" height="' + CELL + '" rx="' + CAL_RX + '"><title>' + esc(title) + '</title></rect>');
    });
    out.push('</svg>');
    return out.join('');
  }

  function rangeHtml() {
    return '<div class="dt-range act-range" role="group" aria-label="' + esc(T.rangeLabel) + '">' + PERIODS.map(function (r) {
      var k = RANGE_KEY[r];
      return '<button type="button" data-act-range="' + r + '" aria-pressed="' + (r === range ? 'true' : 'false') + '" aria-label="' + esc(T.rangesLong[k]) + '">' + esc(T.ranges[k]) + '</button>';
    }).join('') + '</div>';
  }

  // total time + the pill vs the window before (no good direction: more training is neither good nor bad, so a change is a neutral --ink arrow and a
  // steady window a grey dot, HC.trendTone)
  function totalHtml(s) {
    var k = RANGE_KEY[range], pill, tone = '';
    if (s.pct != null) {
      var flat = Math.abs(s.pct) < 100 * DELTA_FLAT;
      pill = (flat ? '•' : s.pct > 0 ? '▲' : '▼') + ' ' + pct(Math.abs(s.pct)) + ' ' + T.vs[k];
      tone = ' dt-pill-' + HC.trendTone(flat ? 'flat' : 'up', null);
    } else pill = s.prev === 0 ? T.prevNone[k] : T.noPrev;
    return '<div class="act-sum"' + HC.detailAttrs('workouts') + '><span class="dt-trend-lbl">' + esc(T.totalLbl) + '</span>' +
      '<div class="dt-trend-row"><b class="dt-trend-num">' + esc(hm(s.min)) + '</b><span class="dt-pill' + tone + '">' + esc(pill) + '</span></div></div>';
  }
  function statsHtml(s) {
    var tiles = [[String(s.sessions), T.sessionsLbl], [String(s.days), T.daysLbl], [hm(s.perWeek), T.perWeekLbl]];
    return '<div class="act-stats">' + tiles.map(function (t) {
      return '<div class="act-stat"><b>' + esc(t[0]) + '</b><span>' + esc(t[1]) + '</span></div>';
    }).join('') + '</div>';
  }
  // the split: one stacked horizontal bar (SVG, widths in attributes) + a legend with counts
  function splitHtml(s) {
    var keys = Object.keys(s.mods).filter(function (k) { return s.mods[k].min > 0; });
    if (!s.min || !keys.length) return '<p class="act-none">' + esc(T.noSessions) + '</p>';
    keys.sort(function (a, b) { return s.mods[b].min - s.mods[a].min || MODS.indexOf(a) - MODS.indexOf(b); });
    var x = 0, segs = [], items = [], aria = [];
    keys.forEach(function (k) {
      var w = 100 * s.mods[k].min / s.min, share = pct(Math.round(w));
      var name = T.modalityLabels[k] || k, cls = MODS.indexOf(k) === -1 ? 'other' : k;
      segs.push('<rect class="act-m-' + cls + '" x="' + x.toFixed(2) + '" y="0" width="' + w.toFixed(2) + '" height="8"/>');
      x += w;
      items.push('<li><span class="act-sw act-m-' + cls + '" aria-hidden="true"></span><b>' + s.mods[k].n + '×</b> ' + esc(name) + ' <small>' + esc(share + ' · ' + hm(s.mods[k].min)) + '</small></li>');
      aria.push(format(T.splitItem, { name: name, n: s.mods[k].n, share: share, time: hm(s.mods[k].min) }));
    });
    return '<div class="act-split"><span class="dt-trend-lbl">' + esc(T.splitLbl) + '</span>' +
      '<svg class="act-bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="' + esc(T.splitLbl + ': ' + aria.join(', ')) + '">' + segs.join('') + '</svg>' +
      '<ul class="act-legend">' + items.join('') + '</ul></div>';
  }

  function html() {
    var head = '<div class="hs-head"><h3 class="hs-lbl" id="act-h">' + esc(T.heading) + '</h3>' + HC.infoBtn('act-info', format(T.infoLbl, { section: T.heading })) + '</div>' +
      '<div class="hs-info" id="act-info" hidden><p>' + esc(T.help) + '</p><p>' + esc(T.note) + '</p><p>' + esc(T.labelsNote) + '</p></div>';
    if (!A || !A.hasData || !Array.isArray(A.days)) return '<section class="hs-sec act" aria-labelledby="act-h">' + head + '<div class="train-empty">' + T.empty + '</div></section>';
    var today = HC.todayIso();
    var age = HC.daysOld(A.asOf);
    var stale = age > HC.STALE_DAYS;
    var end = stale || age < 0 ? A.asOf : today;
    var byDate = {};
    A.days.forEach(function (d) { byDate[d.date] = d; });
    var dates = [];
    for (var i = A.windowDays - 1; i >= 0; i--) dates.push(shift(end, -i));
    var active = dates.filter(function (d) { return byDate[d] && byDate[d].min > 0; }).length;
    var s = summary(byDate, end, range);
    var legend = T.levels.map(function (lbl, l) {
      return '<span class="cal-legend-item"><span class="cal-legend-sw cal-l' + l + '"></span>' + esc(lbl) + '</span>';
    }).join('');
    return '<section class="hs-sec act' + (stale ? ' act-stale' : '') + '" aria-labelledby="act-h">' + head +
      (stale ? HC.staleMark('act-stale-note', format(T.staleShort, { days: age }), format(T.staleNote, { days: age, date: HC.fmtDate(A.asOf) })) : '') +
      '<div class="act-card"><div class="act-top">' + totalHtml(s) + rangeHtml() + '</div>' + statsHtml(s) + splitHtml(s) +
      '<div class="act-cal"' + HC.detailAttrs('workouts') + '><span class="dt-trend-lbl">' + esc(T.calHeading) + '</span>' +
      '<p class="hint">' + esc(active === 1 ? T.calHintOne : format(T.calHint, { days: active })) + '</p>' +
      calendar(dates, byDate) + '<div class="cal-legend">' + legend + '</div></div></div></section>';
  }

  function render(focusRange) {
    try {
      host.innerHTML = html();
    } catch (e) {
      host.innerHTML = '<div class="train-empty">' + T.empty + '</div>';
    }
    if (focusRange && typeof host.querySelector === 'function') {
      var b = host.querySelector('[data-act-range="' + focusRange + '"]');
      if (b && typeof b.focus === 'function') b.focus();
    }
  }
  // W / M / 6M: re-render in place, focus stays on the button just pressed
  function choose(r) {
    if (PERIODS.indexOf(r) === -1 || r === range) return;
    range = r;
    try { W.localStorage.setItem(STORE, String(r)); } catch (e) { /* convenience only */ }
    render(r);
  }
  if (typeof host.addEventListener === 'function') {
    host.addEventListener('click', function (e) {
      var t = e && e.target;
      var b = t && typeof t.closest === 'function' ? t.closest('[data-act-range]') : null;
      if (b) choose(Number(b.getAttribute('data-act-range')));
    });
  }
  // crossing the wide breakpoint swaps the calendar markup (SVG <-> grid)
  try {
    var mq = W && typeof W.matchMedia === 'function' ? W.matchMedia(WIDE) : null;
    if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', function () { render(); });
  } catch (e) { /* no media queries: the phone SVG stays */ }
  if (W) window.HCActivity = { summary: summary, choose: choose };
  render();
})();
