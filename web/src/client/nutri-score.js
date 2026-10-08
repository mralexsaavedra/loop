/* Nutrition score — a day's 0-100 adherence to the viewer's own targets (lib/nutrition/score.mjs is
 * the reference; nutritionScore / scoreSeries port it line by line, a test runs both over
 * NSCORE_CASES). Classic script (is:inline), after nutri-day.js, adherence.js and today-date.js.
 *
 * Inputs: the baked food log (INTAKE.log.days: the synced foodlog-daily.csv, the example's demo data)
 * with, on the LAN page, each day of Constancia's live summary (HCAdherence.state().days) in its place;
 * each day's target = HCNutri.targetFor(date) (the CURRENT goal × that day's detected day type: the
 * same target Constancia and the intake rings use); constants = NUTRI.score (NSCORE).
 *
 * Renders: Inicio's "Nutrition" card (#home-nscore in My day; day stepping via HCDay: a past day shows
 * that day's score or nothing; today shows today "so far", else the newest scored day while it is
 * <= STALE_DAYS old) and Nutrición's score block (#nutri-score-block: the same card + the 7 / 30-day
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
  var REQUIRED = ['breakfast', 'lunch', 'dinner'];
  var WIDE = 30; // the Nutrición block's longer average and line

  /* ---------- port of lib/nutrition/score.mjs ---------- */
  function fin(v) {
    return typeof v === 'number' && isFinite(v);
  }
  function clamp100(x) {
    return Math.max(0, Math.min(100, x));
  }
  function ratio(v, t) {
    return fin(v) && fin(t) && t > 0 ? Math.round((v / t) * 1e6) / 1e6 : null;
  }
  function pts1(x) {
    return Math.round(x * 10) / 10;
  }
  function kcalPoints(k, t) {
    var r = ratio(k, t), K = C.kcal;
    if (r == null) return null;
    var d = Math.round(Math.abs(r - 1) * 1e6) / 1e6;
    return d <= K.full ? 100 : pts1(clamp100((100 * (K.zero - d)) / (K.zero - K.full)));
  }
  function proteinPoints(p, t) {
    var r = ratio(p, t), P = C.protein;
    if (r == null) return null;
    return r >= P.full ? 100 : pts1(clamp100((100 * (r - P.zero)) / (P.full - P.zero)));
  }
  function fatPoints(f, t) {
    var r = ratio(f, t), F = C.fat;
    if (r == null) return null;
    if (r > F.hi) return pts1(clamp100((100 * (F.zeroHi - r)) / (F.zeroHi - F.hi)));
    if (r < F.lo) return pts1(clamp100((100 * (r - F.zeroLo)) / (F.lo - F.zeroLo)));
    return 100;
  }
  function scoreBand(s) {
    if (!fin(s)) return null;
    return s >= C.bands.good ? 'good' : s >= C.bands.mid ? 'mid' : 'low';
  }
  function hasMeals(day) {
    var g = day && day.groups;
    return !!g && REQUIRED.every(function (k) { return fin(g[k]) && g[k] >= 1; });
  }
  function nutritionScore(day, target, opts) {
    if (!day || !(day.n > 0) || !target || !fin(target.k) || !(target.k > 0)) return null;
    var miss = day.missing || {};
    var parts = { k: null, p: null, f: null };
    var raw = {};
    var kp = kcalPoints(day.k, target.k);
    if (kp != null) { raw.k = kp; parts.k = { v: day.k, t: target.k, pts: Math.round(kp) }; }
    var pp = proteinPoints(day.p, target.p);
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
      sw += C.weights[c];
      sum += C.weights[c] * raw[c];
    });
    if (!(sw > 0)) return null;
    return {
      score: Math.round(sum / sw), parts: parts, inc: !!(miss.p || miss.f),
      partial: !!(opts && opts.today && day.date === opts.today), meals: hasMeals(day), assumed: !!target.inferred,
    };
  }
  function scoreSeries(dates, days, targets, today) {
    var by = {}, T = targets || {}, out = { days: {}, avg: null, n: 0 };
    (days || []).forEach(function (d) { if (d && typeof d.date === 'string') by[d.date] = d; });
    (dates || []).forEach(function (date) {
      var r = nutritionScore(by[date] || null, T[date] || null, { today: today });
      if (r) out.days[date] = r;
    });
    var s = 0;
    (dates || []).slice(-C.avgDays).forEach(function (date) {
      var r = out.days[date];
      if (!r || r.partial) return;
      s += r.score;
      out.n++;
    });
    if (out.n) out.avg = Math.round(s / out.n);
    return out;
  }

  /* ---------- inputs ---------- */
  // the baked days, each replaced by the LAN summary's day when Constancia has read one
  function logDays() {
    var L = typeof INTAKE !== 'undefined' && INTAKE && INTAKE.log && Array.isArray(INTAKE.log.days) ? INTAKE.log.days : [];
    var by = {};
    L.forEach(function (d) { if (d && isoDate(d.date)) by[d.date] = d; });
    var A = window.HCAdherence, st = null;
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
      var t = null;
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
  var cache = null;
  function series() {
    if (cache) return cache;
    var dates = windowDates(), days = logDays();
    var s = days.length ? scoreSeries(dates, days, targetsFor(dates), HC.todayIso()) : { days: {}, avg: null, n: 0 };
    s.dates = dates;
    s.any = days.length > 0;
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
      v.push(r ? r.score : null);
      if (r) any = true;
    });
    return any ? { kind: 'nscore', dir: 1, dec: 0, start: s.dates[0], v: v, days: s.days, bands: C.bands } : null;
  }

  /* ---------- render ---------- */
  var BAND_CLS = { good: 'de-hi', mid: 'de-mid', low: 'de-lo' };
  function kf(v) {
    return HC.num(v, 0);
  }
  function partRow(c, x) {
    var L = TS.parts[c], unit = c === 'k' ? ' kcal' : ' g';
    if (!x) {
      return '<li class="nt-mac"><span class="nt-mac-lbl">' + esc(L) + '</span><span class="nt-mac-val"><small>' + esc(TS.unknown) + '</small></span>' +
        '<span class="nt-mac-track"></span></li>';
    }
    return '<li class="nt-mac ' + BAND_CLS[scoreBand(x.pts)] + '"><span class="nt-mac-lbl">' + esc(L) + ' · ' + esc(String(x.pts)) + '</span>' +
      '<span class="nt-mac-val"><b>' + (x.min ? '≥ ' : '') + esc(kf(x.v)) + '</b><small> / ' + esc(kf(x.t)) + unit + '</small></span>' +
      '<span class="nt-mac-track">' + (x.pts > 0 ? '<i style="width:' + x.pts + '%"></i>' : '') + '</span></li>';
  }
  // the card: heading (+ "so far" / "incomplete"), the score big in its band colour, when, the three rows
  function cardHtml(date, r, sel, extra) {
    var tag = r.partial ? TS.soFar : r.inc ? TS.incomplete : '';
    var when = r.partial ? TS.today : HC.fmtDate(date);
    var aria = format(r.partial ? TS.ariaSoFar : TS.aria, { value: r.score, date: when });
    return '<div class="sc-card tn en ns ' + BAND_CLS[scoreBand(r.score)] + '"' + HC.detailAttrs('nutrition', sel || (r.partial ? null : date)) +
      ' aria-label="' + esc(aria) + '">' +
      '<h3 class="tn-h">' + esc(TS.heading) + (tag ? ' <small class="tn-lbl">' + esc(tag) + '</small>' : '') + '</h3>' +
      '<div class="tn-row"><div class="tn-end"><span class="tn-time"><b class="en-num">' + esc(String(r.score)) + '<small>%</small></b></span>' +
      '<span class="tn-lbl">' + esc(when) + '</span></div>' +
      '<ul class="nt-macros">' + partRow('k', r.parts.k) + partRow('p', r.parts.p) + partRow('f', r.parts.f) + '</ul></div>' +
      (extra || '') + '</div>';
  }
  // the day a card shows: `sel` (a past day), else today when logged, else the newest scored day <= STALE_DAYS old
  function pick(s, sel) {
    if (sel) return s.days[sel] ? sel : null;
    var best = null;
    s.dates.forEach(function (d) { if (s.days[d]) best = d; });
    if (!best) return null;
    return best === HC.todayIso() || HC.daysOld(best) <= HC.STALE_DAYS ? best : null;
  }
  function renderHome() {
    var host = document.getElementById('home-nscore');
    if (!host || !TS) return;
    var shown = false;
    try {
      var sel = DAY && typeof DAY.sel === 'function' ? DAY.sel() || null : null;
      var s = series(), d = pick(s, sel);
      var avg = s.avg != null && !sel ? '<p class="tn-lbl en-sub">' + esc(format(TS.avg7, { value: s.avg })) + '</p>' : '';
      host.innerHTML = d ? cardHtml(d, s.days[d], sel, avg) : '';
      shown = !!d;
    } catch (e) {
      host.innerHTML = '';
    }
    host.hidden = !shown;
  }
  // the last WIDE days' final scores as a line (gaps = days without a score), 0-100 up
  var W = 200, H = 48;
  function lineHtml(s) {
    var dates = s.dates.slice(-WIDE), pts = [];
    dates.forEach(function (d, i) {
      var r = s.days[d];
      if (r && !r.partial) pts.push([(W * i) / (WIDE - 1), H - (H * r.score) / 100]);
    });
    if (pts.length < 2) return '';
    var dd = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    return '<svg class="en-sp" style="width:100%" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><path class="en-l" d="' + dd + '"/></svg>';
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
        var d = pick(s, null), wide = meanFinal(s, WIDE);
        var avgs = '<p class="tn-lbl en-sub">' + esc(format(TN.avgs, { a7: s.avg == null ? '—' : s.avg, a30: wide == null ? '—' : wide })) + '</p>' + lineHtml(s);
        host.innerHTML = d ? cardHtml(d, s.days[d], null, avgs)
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
