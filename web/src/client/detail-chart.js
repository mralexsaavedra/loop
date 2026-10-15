/* Detail sheet, the trend chart (no DOM: markup only). detail-state.js (the data / state helpers) ->
 * detail-chart.js (this file) -> detail.js (the sheet shell). Classic scripts (is:inline), inlined in
 * that order right after deepdive.js (web/src/client/manifest.mjs).
 *
 * window.HCDetailChart(T, DS) builds the chart over the sheet's copy (I18N_DETAIL) and one
 * HCDetailState (DS): chartHtml = the window's SVG (daily points or bars, the 7-day line, the personal
 * band / target / typical lines, three round Y ticks, the newest value labelled, a missing day is a gap,
 * never 0) + its key; selX = the x of a day's slot from the geometry the last chart recorded;
 * breakdownHtml = the window's days by state as one stacked bar + counts. detail.js calls it once.
 * Reads window.HC (util.js) and, at call time, I18N_DATE (the weekday labels of a week's bars). */
window.HCDetailChart = function (T, DS) {
  var esc = HC.esc, format = HC.format, parseIso = HC.parseIso, shiftIso = HC.shiftIso;
  var dayDiff = DS.dayDiff, own = DS.own, valueOf = DS.valueOf, stateOn = DS.stateOn, targetOf = DS.targetOf;
  var fmtM = DS.fmtM, titleOf = DS.titleOf, legendItems = DS.legendItems, lineFor = DS.lineFor;
  // chart geometry (SVG user units): width, height, inner padding
  var CW = 320, CH = 140, CPAD = 8;

  /* ---------- chart ---------- */
  // x of a day's slot in the chart, from the geometry of the chart last drawn (the sheet state's geo)
  function selX(g, sel) {
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
  // the trend chart of [from, to] with `sel` marked; records its geometry in state.geo (the sheet's
  // state) so a day tap can move the selection without a rebuild (selX)
  var fx = function (v) { return v.toFixed(1); };

  // Y range over every value, the 7-day line, the band / target / typical day / recovery zone; 3 Y ticks on
  // round numbers (step 1 / 2 / 2.5 / 5 × 10^k), the range widened to cover them, plus 12 % headroom so the
  // outermost (out-of-range) days never sit on the chart's edge (bars: 8 %, and a week's bars 18 % for the
  // value labels on top)
  function yRange(m, vals, line, tg, zc, bars, week) {
    var ext = vals.concat(line.filter(function (x) { return x != null; }));
    if (m.band) ext.push(m.band.lo, m.band.hi);
    if (tg != null) ext.push(tg);
    if (m.typical != null) ext.push(m.typical);
    if (zc != null) ext.push(zc, -zc);
    var lo = bars ? 0 : Math.min.apply(null, ext.length ? ext : [0]);
    var hi = Math.max.apply(null, ext.length ? ext : [1]);
    var tk = yTicks(lo, hi, bars);
    lo = Math.min(lo, tk[0]);
    hi = Math.max(hi, tk[2]);
    if (!bars) { var pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad; } else hi = hi * (week ? 1.18 : 1.08) || 1;
    return { lo: lo, hi: hi, tk: tk };
  }
  // the chart's geometry: n day slots across, [lo, hi] up; x / y in viewBox units, pctX / pctY in % of the box
  function chartGeo(n, lo, hi) {
    var slot = (CW - 2 * CPAD) / n;
    var x = function (i) { return CPAD + slot * (i + 0.5); };
    var y = function (v) { return CPAD + (CH - 2 * CPAD) * (1 - (v - lo) / (hi - lo)); };
    return {
      n: n, slot: slot, x: x, y: y,
      pctX: function (i) { return (x(i) / CW * 100).toFixed(1) + '%'; },
      pctY: function (v) { return (y(v) / CH * 100).toFixed(1) + '%'; },
    };
  }
  // one bar or point per day with a value (a week's bars also get their value label); returns the states drawn
  function dayMarks(m, days, g, o, out, labels) {
    var bw = Math.max(0.6, g.slot * (o.week ? 0.42 : 0.7)), r = g.n > 120 ? 1.3 : g.n > 45 ? 1.8 : 2.4;
    var drawn = [];
    days.forEach(function (d, i) {
      if (d.v == null || (o.thin && inRange(m, d.v))) return;
      var st = stateOn(m, d.iso, d.v);
      if (drawn.indexOf(st) < 0 && !(o.bars && d.v <= 0)) drawn.push(st);
      if (o.bars) {
        if (o.week) labels.push('<span class="dt-bv" style="left:' + g.pctX(i) + ';top:' + g.pctY(Math.max(0, d.v)) + '">' + esc(fmtM(m, d.v, o.dec)) + '</span>');
        if (d.v <= 0) return;
        out.push('<rect class="dt-bar dt-s-' + st + '" x="' + fx(g.x(i) - bw / 2) + '" y="' + fx(g.y(d.v)) + '" width="' + fx(bw) + '" height="' + fx(Math.max(0.5, g.y(0) - g.y(d.v))) + '"/>');
      } else {
        out.push('<circle class="dt-pt dt-s-' + st + '" cx="' + fx(g.x(i)) + '" cy="' + fx(g.y(d.v)) + '" r="' + r + '"/>');
      }
    });
    return drawn;
  }
  // the 7-day line breaks where the average is undefined, so a gap never reads as a trend; a sparse
  // series (weigh-ins days apart) joins its rolling points, which exist only on reading days
  function linePath(m, line, g) {
    var path = '', pen = false, join = m.kind === 'sparse';
    line.forEach(function (v, i) {
      if (v == null) { if (!join) pen = false; return; }
      path += (pen ? ' L' : ' M') + fx(g.x(i)) + ',' + fx(g.y(v));
      pen = true;
    });
    return path ? '<path class="dt-line" d="' + path.trim() + '"/>' : '';
  }
  // the chart's key: the marks drawn, the 7-day line, the target / typical day lines
  function chartKeys(m, drawn, o, line, tg) {
    var keys = drawn.length ? ['<span class="dt-k dt-k-pts ' + (o.thin ? 'dt-k-out' : 'dt-k-daily') + '">' + keyMarks(m, drawn, o.bars) + esc(o.thin ? T.chartKey.outside : T.chartKey.daily) + '</span>'] : [];
    if (line.some(function (v) { return v != null; })) keys.push('<span class="dt-k dt-k-line">' + esc(T.chartKey.roll7) + '</span>');
    if (tg != null) keys.push('<span class="dt-k dt-k-target">' + esc(T.chartKey.target) + '</span>');
    if (m.typical != null) keys.push('<span class="dt-k dt-k-target">' + esc(T.chartKey.typical) + '</span>');
    return keys.join('');
  }
  // the Y tick labels and the X axis (a week: weekday + day of month under each bar; else the window's ends)
  function chartAxes(m, tk, g, days, week, from, to) {
    var tdec = tk[1] - tk[0] < 0.1 ? 2 : tk[1] - tk[0] < 1 ? 1 : 0;
    var yax = '<div class="dt-yax" aria-hidden="true">' + tk.slice().reverse().map(function (t) {
      return '<span style="top:' + (g.y(t) / CH * 100).toFixed(1) + '%">' + esc(fmtM(m, t, tdec)) + '</span>';
    }).join('') + '</div>';
    var N = typeof I18N_DATE !== 'undefined' && I18N_DATE ? I18N_DATE.weekdays : null;
    var axis = week && N
      ? '<div class="dt-wdays" aria-hidden="true">' + days.map(function (d, i) {
        return '<span style="left:' + g.pctX(i) + '">' + esc(N[HC.weekdayIndex(d.iso)]) + '<b>' + esc(String(parseIso(d.iso).getDate())) + '</b></span>';
      }).join('') + '</div>'
      : '<div class="dt-ax"><span>' + esc(HC.fmtDate(from)) + '</span><span>' + esc(HC.fmtDate(to)) + '</span></div>';
    return { yax: yax, axis: axis };
  }

  function chartHtml(key, m, from, to, sel, state) {
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
    var tg = targetOf(key, m);
    var yr = yRange(m, vals, line, tg, zc, bars, week), tk = yr.tk;
    var g = chartGeo(n, yr.lo, yr.hi), y = g.y;
    var out = ['<svg class="dt-chart" viewBox="0 0 ' + CW + ' ' + CH + '" role="img" aria-label="' +
      esc(format(T.chartAria, { title: titleOf(key), from: HC.fmtDate(from), to: HC.fmtDate(to) })) + '">'];
    var hline = function (cls, v) { out.push('<line class="' + cls + '" x1="0" x2="' + CW + '" y1="' + fx(y(v)) + '" y2="' + fx(y(v)) + '"/>'); };
    var zone = function (a, b) { out.push('<rect class="dt-band" x="0" width="' + CW + '" y="' + fx(y(b)) + '" height="' + fx(Math.max(0, y(a) - y(b))) + '"/>'); };
    tk.slice().reverse().forEach(function (t) { hline('dt-grid', t); });
    if (zc != null) { zone(-zc, zc); hline('dt-med', 0); }
    else if (m.band) { zone(m.band.lo, m.band.hi); hline('dt-med', m.band.median); }
    if (tg != null) hline('dt-target', tg);
    if (m.typical != null) hline('dt-target', m.typical);
    // the selected day's slot: always drawn (hidden outside the range) so a day tap only moves it
    state.geo = { from: from, n: n, slot: g.slot };
    var sx = selX(state.geo, sel);
    out.push('<rect class="dt-sel" x="' + fx(sx == null ? 0 : sx) + '" y="0" width="' + fx(g.slot) + '" height="' + CH + '"' + (sx == null ? ' visibility="hidden"' : '') + '/>');
    // a long window (6M / 1Y) of points: only the days OUT of the range get a dot, the 7-day line
    // carries the rest, so the dots never saturate the chart
    var o = { week: week, bars: bars, thin: !bars && n > THIN_DAYS && (m.kind === 'recovery' || !!m.band), dec: m.kind === 'sleep' ? 1 : m.dec };
    var labels = [];
    var drawn = dayMarks(m, days, g, o, out, labels);
    var path = linePath(m, line, g);
    if (path) out.push(path);
    // the window's newest value, labelled (a week's bars already carry every value): a ring on it
    // and its number above
    if (!week) {
      for (var j = days.length - 1; j >= 0; j--) {
        if (days[j].v == null) continue;
        var ly = bars ? Math.max(0, days[j].v) : days[j].v;
        out.push('<circle class="dt-last" cx="' + fx(g.x(j)) + '" cy="' + fx(y(ly)) + '" r="3.2"/>');
        labels.push('<span class="dt-lastv" style="left:' + g.pctX(j) + ';top:' + g.pctY(ly) + '">' + esc(fmtM(m, days[j].v, o.dec)) + '</span>');
        break;
      }
    }
    out.push('</svg>');
    // the shaded band is named once, top-right of the chart
    var band = zc != null ? T.trend.baseline : m.band ? T.trend.typical : '';
    var ax = chartAxes(m, tk, g, days, week, from, to);
    return '<figure class="dt-fig">' + (band ? '<div class="dt-fig-top"><span class="dt-typ">' + esc(band) + '</span></div>' : '') +
      '<div class="dt-plot"><div class="dt-svg">' + out.join('') + (labels.length ? '<div class="dt-labels" aria-hidden="true">' + labels.join('') + '</div>' : '') + '</div>' + ax.yax + '</div>' +
      ax.axis + '<figcaption class="dt-keys">' + chartKeys(m, drawn, o, line, tg) + '</figcaption></figure>';
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
    // unnamed: a named <section> would be a region landmark; its <h3> names the part
    return '<section class="dt-brk"><div class="dt-brk-top"><h3 class="dt-brk-t">' + esc(B.title) + '</h3>' +
      HC.cta(B.learn, ' data-dt-act="learn"') + '</div>' +
      '<div class="dt-brk-bar" aria-hidden="true">' + bar + '</div><ul class="dt-brk-leg">' + items.map(function (it) {
        return '<li data-st="' + it[0] + '"><span class="dt-sw dt-s-' + it[0] + '" aria-hidden="true"></span>' + esc(it[1]) + '<b>' + esc(format(B.count, { n: n[it[0]] })) + '</b></li>';
      }).join('') + '</ul></section>';
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

  return { chartHtml: chartHtml, selX: selX, breakdownHtml: breakdownHtml };
};
