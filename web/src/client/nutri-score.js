/* Nutrition score — a day's 0-100 adherence to the viewer's own targets. The math is
 * lib/nutrition/score.mjs itself: its clientSource() emits HC_NSCORE (inlined with HC_FMT before
 * util.js), so nothing here re-implements it; NSCORE_CASES test it. Classic script (is:inline), after
 * nutri-day.js, adherence.js and today-date.js.
 *
 * Inputs: the baked food log (INTAKE.log.days: the synced foodlog-daily.csv, the example's demo data)
 * with, on the LAN page, each day of Constancia's live summary (HCAdherence.state().days) in its place;
 * each day's target = HCNutri.targetFor(date) (the CURRENT goal × that day's detected day type: the
 * same target Constancia and the intake rings use); constants = NUTRI.score (NSCORE).
 *
 * Renders: Inicio's "Nutrition" card (#home-nscore in My day; day stepping via HCDay: a past day shows
 * that day's score or nothing; otherwise the headline is the newest CLOSED scored day while it is
 * <= STALE_DAYS old, and today — still filling up — shows only its progress, "in progress", no score) and Nutrición's score block (#nutri-score-block: the same card + the 7 / 30-day
 * averages and a 30-day line; the formula behind its ⓘ, #nutri-score-info). Both open the detail sheet
 * on key 'nutrition' (detail.js reads HCNutriScore.metric(): kind 'nscore', one value per day of the
 * last NSCORE.days ending today, `days` = the per-day results for the day panel). Days without a log
 * have no score (never 0). adherence.js calls HCNutriScore.refresh() after every summary read, and a
 * goal change re-renders through it. Each host has its own try/catch: a failure empties it. */
(function () {
  var N = typeof NUTRI === 'undefined' || !NUTRI ? null : NUTRI;
  var C = N && N.score ? N.score : null;
  if (!C) return;
  var TS = typeof I18N_SCORE !== 'undefined' && I18N_SCORE && I18N_SCORE.home ? I18N_SCORE.home.nscore : null;
  var TN = typeof I18N_NUTRI !== 'undefined' && I18N_NUTRI ? I18N_NUTRI.score : null;
  var esc = HC.esc, format = HC.format, isoDate = HC.isoDate;
  var DAY = typeof HCDay !== 'undefined' && HCDay ? HCDay : null;
  var WIDE = 30; // the Nutrición block's longer average and line

  /* ---------- the score: lib/nutrition/score.mjs's own functions (clientSource -> HC_NSCORE) ---------- */
  var fin = HC_NSCORE.fin, scoreBand = HC_NSCORE.scoreBand, nutritionScore = HC_NSCORE.nutritionScore, scoreSeries = HC_NSCORE.scoreSeries;

  /* ---------- inputs ---------- */
  // the baked days, each replaced by the LAN summary's day when Constancia has read one
  function logDays() {
    var L = typeof INTAKE !== 'undefined' && INTAKE && INTAKE.log && Array.isArray(INTAKE.log.days) ? INTAKE.log.days : [];
    var by = {};
    L.forEach(function (d) { if (d && isoDate(d.date)) by[d.date] = d; });
    var A = window.HCAdherence, st;
    try { st = A && typeof A.state === 'function' ? A.state() : null; } catch (e) { st = null; }
    if (st && Array.isArray(st.days)) {
      st.days.forEach(function (d) {
        if (!d || !isoDate(d.date)) return;
        by[d.date] = { date: d.date, k: d.k, p: d.p, f: d.f, n: d.n, missing: d.missing || {}, groups: d.groups || {} };
      });
    }
    return Object.keys(by).map(function (k) { return by[k]; });
  }
  function targetsFor(dates) {
    var n = window.HCNutri, out = {};
    dates.forEach(function (d) {
      var t;
      try { t = n && typeof n.targetFor === 'function' ? n.targetFor(d) : null; } catch (e) { t = null; }
      out[d] = t && fin(t.k) ? { k: t.k, p: fin(t.p) ? t.p : null, g: fin(t.g) ? t.g : null, inferred: !!t.inferred } : null;
    });
    return out;
  }
  // the last NSCORE.days days ending at the viewer's today, oldest first
  function windowDates() {
    var today = HC.todayIso(), out = [];
    for (var i = C.days - 1; i >= 0; i--) out.push(HC.shiftIso(today, -i));
    return out;
  }
  // computed once per viewer day: a page left open past midnight recomputes (yesterday stops being
  // "so far"); refresh() drops it after new data
  var cache = null;
  function series() {
    var today = HC.todayIso();
    if (cache && cache.today === today) return cache;
    var dates = windowDates(), days = logDays();
    var s = days.length ? scoreSeries(dates, days, targetsFor(dates), today) : { days: {}, avg: null, n: 0 };
    s.dates = dates;
    s.any = days.length > 0;
    s.today = today;
    cache = s;
    return s;
  }
  // the mean of the FINAL scores among the last n dates (the 30-day figure; avg = the 7-day one)
  function meanFinal(s, n) {
    var sum = 0, k = 0;
    s.dates.slice(-n).forEach(function (d) {
      var r = s.days[d];
      if (r && !r.partial) { sum += r.score; k++; }
    });
    return k ? Math.round(sum / k) : null;
  }
  /** The detail sheet's series (detail.js metric('nutrition')): null without any scored day. */
  function metric() {
    var s = series(), v = [], any = false;
    s.dates.forEach(function (d) {
      var r = s.days[d];
      // today is still filling up: no score on the chart (its day panel shows the progress instead)
      v.push(r && !r.partial ? r.score : null);
      if (r) any = true;
    });
    return any ? { kind: 'nscore', dir: 1, dec: 0, start: s.dates[0], v: v, days: s.days, bands: C.bands } : null;
  }

  /* ---------- render ---------- */
  // Today is a partial day: it gets NO score (a mid-day "0%" in red read as a failed day) — only its
  // progress, eaten / target per component, labelled "in progress". The headline score is the newest
  // CLOSED day; a component's points are shown only for a closed day, labelled "· 85 pts".
  var BAND_CLS = { good: 'de-hi', mid: 'de-mid', low: 'de-lo' };
  function kf(v) {
    return HC.num(v, 0);
  }
  // pts = true: a closed day (its points in the label, the bar = the points in their band colour);
  // false: today in progress (eaten / target only, the bar = progress toward the target, neutral)
  function partRow(c, x, pts) {
    var L = TS.parts[c], unit = c === 'k' ? ' kcal' : ' g';
    if (!x) {
      return '<li class="nt-mac"><span class="nt-mac-lbl">' + esc(L) + '</span><span class="nt-mac-val"><small>' + esc(TS.unknown) + '</small></span>' +
        '<span class="nt-mac-track"></span></li>';
    }
    var w = pts ? x.pts : x.t > 0 ? Math.min(100, Math.round((100 * x.v) / x.t)) : 0;
    return '<li class="nt-mac ' + (pts ? BAND_CLS[scoreBand(x.pts)] : 'ns-run') + '"><span class="nt-mac-lbl">' +
      esc(pts ? format(TS.ptsTpl, { name: L, pts: HC.nf(x.pts) }) : L) + '</span>' +
      '<span class="nt-mac-val"><b>' + (x.min ? '≥ ' : '') + esc(kf(x.v)) + '</b><small> / ' + esc(kf(x.t)) + unit + '</small></span>' +
      '<span class="nt-mac-track">' + (w > 0 ? '<i style="width:' + w + '%"></i>' : '') + '</span></li>';
  }
  function partRows(r, pts) {
    return '<ul class="nt-macros">' + partRow('k', r.parts.k, pts) + partRow('p', r.parts.p, pts) + partRow('f', r.parts.f, pts) + '</ul>';
  }
  function dayWord(date) {
    return date === HC.shiftIso(HC.todayIso(), -1) ? TS.yesterday : HC.fmtDate(date);
  }
  // today's kcal eaten as a % of its target (the in-progress headline), null without a kcal log
  function runPct(run) {
    var k = run && run.parts ? run.parts.k : null;
    return k && fin(k.v) && fin(k.t) && k.t > 0 ? Math.round((100 * k.v) / k.t) : null;
  }
  // the footer's "Yesterday 56%": the closed day, when today's progress heads the card instead
  function prevTxt(o) {
    return o.run && o.head && !o.sel ? format(TS.prev, { date: dayWord(o.head.date), value: HC.pct(o.head.r.score) }) : '';
  }
  // o = {head: {date, r} | null (the scored, closed day), run: r | null (today, in progress), sel, extra}.
  // Today being logged heads the card ALONE (its kcal % of target, neutral: no score, no band); the
  // closed day's score moves to the footer line (o.extra, prevTxt). Without today, the closed day heads it.
  function cardHtml(o) {
    var h = o.head, run = o.run;
    var tag = run ? TS.inProgress : h.r.inc ? TS.incomplete : '';
    var pct = run ? runPct(run) : null;
    var aria = run
      ? [pct != null ? format(TS.ariaRunPct, { pct: pct }) : TS.ariaRun, h ? format(TS.aria, { value: h.r.score, date: dayWord(h.date) }) : '']
      : [format(TS.aria, { value: h.r.score, date: dayWord(h.date) })];
    var opens = o.sel || (h && !run ? h.date : null);
    var left = run
      ? (pct != null ? '<div class="tn-end ns-now"><span class="tn-time"><b class="en-num">' + esc(String(pct)) + '<small>%</small></b></span>' +
        '<span class="tn-lbl">' + esc(TS.runLbl) + '</span></div>' : '')
      : '<div class="tn-end"><span class="tn-time"><b class="en-num">' + esc(String(h.r.score)) + '<small>%</small></b></span>' +
        '<span class="tn-lbl">' + esc(dayWord(h.date)) + '</span></div>';
    var right = run ? '<div class="ns-run-box">' + partRows(run, false) + '</div>' : partRows(h.r, true);
    return '<div class="sc-card tn en ns' + (run ? '' : ' ' + BAND_CLS[scoreBand(h.r.score)]) + '"' + HC.detailAttrs('nutrition', opens) +
      ' aria-label="' + esc(aria.filter(Boolean).join(' · ')) + '">' +
      '<h3 class="tn-h">' + esc(TS.heading + (tag ? ' · ' + tag : '')) + '</h3>' +
      '<div class="tn-row">' + left + right + '</div>' + (o.extra || '') + '</div>';
  }
  function footHtml(parts) {
    var t = parts.filter(Boolean).join(' · ');
    return t ? '<p class="tn-lbl en-sub">' + esc(t) + '</p>' : '';
  }
  // the newest CLOSED scored day (never today) while it is <= STALE_DAYS old
  function closedDay(s) {
    var best = null;
    s.dates.forEach(function (d) { if (s.days[d] && !s.days[d].partial) best = d; });
    return best && HC.daysOld(best) <= HC.STALE_DAYS ? best : null;
  }
  // what a card shows: a stepped-to past day = that day's score; else the newest closed day + today's progress
  function view(s, sel) {
    if (sel) return s.days[sel] && !s.days[sel].partial ? { head: { date: sel, r: s.days[sel] }, run: null, sel: sel }
      : s.days[sel] ? { head: null, run: s.days[sel], sel: sel } : null;
    var c = closedDay(s), t = s.days[HC.todayIso()];
    var run = t && t.partial ? t : null;
    return c || run ? { head: c ? { date: c, r: s.days[c] } : null, run: run, sel: null } : null;
  }
  function renderHome() {
    var host = document.getElementById('home-nscore');
    if (!host || !TS) return;
    var shown = false;
    try {
      var sel = DAY && typeof DAY.sel === 'function' ? DAY.sel() || null : null;
      var s = series(), v = view(s, sel);
      if (v) v.extra = footHtml([prevTxt(v), s.avg != null && !sel ? format(TS.avg7, { value: s.avg }) : '']);
      host.innerHTML = v ? cardHtml(v) : '';
      shown = !!v;
    } catch (e) {
      host.innerHTML = '';
    }
    host.hidden = !shown;
  }
  // the last WIDE days' final scores as the Salud sparkline (.sc-spark / .spark: line + area down to the
  // 0 baseline, a caption under it), x by date (gaps = days without a score, bridged), 0-100 up
  var W = 200, H = 48;
  function lineHtml(s) {
    var dates = s.dates.slice(-WIDE), pts = [];
    dates.forEach(function (d, i) {
      var r = s.days[d];
      if (r && !r.partial) pts.push([(W * i) / (WIDE - 1), H - (H * r.score) / 100]);
    });
    if (pts.length < 2) return '';
    var dd = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var x0 = pts[0][0].toFixed(1), x1 = pts[pts.length - 1][0].toFixed(1);
    return '<div class="sc-spark ns-spark"><svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="area" d="' + dd + ' L' + x1 + ' ' + H + ' L' + x0 + ' ' + H + ' Z"/><path class="line" d="' + dd + '"/></svg>' +
      '<div class="sc-spark-lbl">' + esc(format(TN.lineLbl, { n: WIDE })) + '</div></div>';
  }
  function renderNutri() {
    var block = document.getElementById('nutri-score-block'), host = document.getElementById('nutri-score');
    if (!block || !host || !TS || !TN) return;
    var shown = false;
    try {
      var s = series();
      var info = document.getElementById('nutri-score-info');
      if (info) {
        info.innerHTML = '<p>' + esc(format(TN.formula, {
          wk: C.weights.k, wp: C.weights.p, wf: C.weights.f, kFull: Math.round(100 * C.kcal.full), kZero: Math.round(100 * C.kcal.zero),
          pFull: Math.round(100 * C.protein.full), pZero: Math.round(100 * C.protein.zero), fLo: Math.round(100 * C.fat.lo), fHi: Math.round(100 * C.fat.hi),
          fZeroLo: Math.round(100 * C.fat.zeroLo), fZeroHi: Math.round(100 * C.fat.zeroHi),
        })) + '</p><p>' + esc(format(TN.rules, { good: C.bands.good, mid: C.bands.mid })) + '</p><p>' + esc(TN.target) + '</p>';
      }
      if (s.any) {
        var v = view(s, null), wide = meanFinal(s, WIDE);
        var avgTxt = format(TN.avgs, { a7: HC.pct(s.avg), a30: HC.pct(wide) });
        var avgs = footHtml([avgTxt]) + lineHtml(s);
        if (v) v.extra = footHtml([prevTxt(v), avgTxt]) + lineHtml(s);
        host.innerHTML = v ? cardHtml(v)
          : '<div class="sc-card tn"' + HC.detailAttrs('nutrition') + '><p class="tn-lbl en-sub">' + esc(TN.none) + '</p>' + avgs + '</div>';
        shown = true;
      } else host.innerHTML = '';
    } catch (e) {
      host.innerHTML = '';
    }
    block.hidden = !shown;
  }
  function refresh() {
    cache = null;
    renderHome();
    renderNutri();
  }
  refresh();
  if (DAY && typeof DAY.on === 'function') DAY.on(renderHome);
  window.HCNutriScore = {
    nutritionScore: nutritionScore, scoreSeries: scoreSeries, scoreBand: scoreBand,
    metric: metric, refresh: refresh, render: refresh,
  };
})();
