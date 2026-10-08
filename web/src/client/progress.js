/* Nutrición "Progreso" (weight vs the goal) + its one-line summary in the profile sheet. Classic script
 * (is:inline), inlined after settings.js and before profile.js. Reads the baked DETAIL.metrics.weight
 * (the weight card's 7-day rolling average, `roll`), NUTRI.progress (the thresholds, from
 * lib/nutrition/progress.mjs) + I18N_NUTRI.progress, the goal from window.HCNutri and the target weight
 * from window.HCSettings (LAN page only; without it there is no target and no ETA).
 *
 * rollPoints / weeklyRate / weightProgress / etaMonths port lib/nutrition/progress.mjs line by line (a
 * test runs both over PROGRESS_CASES): the rate is the least-squares slope of the 7-day average over the
 * last windowDays (kg/week), the status is vs the goal's band (NUTRI.progress.bands, never more than
 * maxPctWeek of bodyweight a week), the ETA (only on pace) = remaining ÷ the observed rate ±etaSpread,
 * as a month range from the viewer's today. Everything time-based is
 * decided here, so builds stay byte-identical. The card opens the weight detail sheet (HC.detailAttrs),
 * which draws the target as a dashed line. The card carries numbers + labels only (average, rate pill,
 * status word, target, ETA); the why, the rate window and the method go behind the section's ⓘ
 * (#nutri-progress-info). The block renders in its own try/catch (a one-line fallback). */
(function () {
  var N = typeof NUTRI === 'undefined' || !NUTRI ? null : NUTRI;
  var TN = typeof I18N_NUTRI === 'undefined' || !I18N_NUTRI ? null : I18N_NUTRI;
  if (!N || !TN || !N.progress || !TN.progress) return;
  var P = N.progress, T = TN.progress;
  var esc = HC.esc, format = HC.format;
  var DIR = { cut: -1, bulk: 1, maintain: 0 };
  var DAYS_PER_WEEK = P.daysPerWeek; // lib/nutrition/progress.mjs DAYS_PER_WEEK (baked with NUTRI.progress)
  var MS_PER_DAY = 86400000;
  var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TONE = { onPace: 'good', steady: 'good', reached: 'good', slow: 'mid', drift: 'mid', fast: 'low', wrong: 'low', fewData: 'muted' };

  /* ---------- port of lib/nutrition/progress.mjs ---------- */
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
  function rollPoints(m) {
    if (!m || typeof m.start !== 'string' || !ISO_RE.test(m.start) || !Array.isArray(m.roll)) return [];
    var s = dayNum(m.start), out = [];
    m.roll.forEach(function (v, i) { if (fin(v)) out.push({ date: isoOf(s + i), kg: v }); });
    return out;
  }
  function weeklyRate(points) {
    if (!points || !points.length) return { rate: null, n: 0, span: 0, from: null };
    var end = dayNum(points[points.length - 1].date);
    var win = points.filter(function (p) { return dayNum(p.date) > end - P.windowDays; });
    var x0 = dayNum(win[0].date), span = end - x0;
    var out = { rate: null, n: win.length, span: span, from: win[0].date };
    if (win.length < P.minReadings || span < P.minSpanDays) return out;
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
    out.rate = sxx > 0 ? (sxy / sxx) * DAYS_PER_WEEK : null;
    return out;
  }
  function weightProgress(m, opts) {
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
    var mismatch = dir !== 0 && toGo != null && toGo < 0 && Math.abs(remaining) > P.reachedKg;
    var rate = r.rate != null ? round(r.rate, 2) : null;
    var status;
    if (dir !== 0 && remaining != null && Math.abs(remaining) <= P.reachedKg) status = 'reached';
    else if (rate == null) status = 'fewData';
    else if (dir === 0) status = Math.abs(rate) <= P.stableKg ? 'steady' : 'drift';
    else {
      var band = P.bands[o.goal];
      var safeMax = Math.min(band.max, (current.kg * P.maxPctWeek) / 100);
      var s = rate * dir;
      if (s < -P.flatKg) status = 'wrong';
      else if (s > safeMax) status = 'fast';
      else if (s >= band.min) status = 'onPace';
      else status = 'slow';
    }
    var eta = null;
    if (status === 'onPace' && toGo != null && toGo > 0 && !mismatch) {
      var weeks = toGo / Math.abs(rate);
      eta = [round(weeks * (1 - P.etaSpread), 1), round(weeks * (1 + P.etaSpread), 1)];
    }
    return { current: current, rate: rate, n: r.n, span: r.span, from: r.from, remaining: remaining, status: status, mismatch: mismatch, etaWeeks: eta };
  }
  function etaMonths(today, weeks) {
    if (!Array.isArray(weeks) || typeof today !== 'string' || !ISO_RE.test(today)) return null;
    var t = dayNum(today);
    return weeks.map(function (w) { return isoOf(t + Math.ceil(w * DAYS_PER_WEEK)).slice(0, 8) + '01'; });
  }

  /* ---------- inputs on the viewer's page ---------- */
  function weightMetric() {
    var D = typeof DETAIL === 'undefined' || !DETAIL ? null : DETAIL;
    var m = D && D.metrics ? D.metrics.weight : null;
    return m && typeof m === 'object' ? m : null;
  }
  function goal() {
    var n = window.HCNutri;
    try { return n && typeof n.state === 'function' ? n.state().goal : N.goal; } catch (e) { return N.goal; }
  }
  function target() {
    var S = window.HCSettings;
    return S && typeof S.ready === 'function' && S.ready() && fin(S.targetWeight()) ? S.targetWeight() : null;
  }
  function compute() {
    return weightProgress(weightMetric(), { goal: goal(), target: target() });
  }
  function stale(p) {
    return HC.daysOld(p.current.date) > P.staleDays;
  }
  function kg(v) { return HC.num(v, 1); }
  function rateText(p) { return format(T.rate, { rate: HC.num(p.rate, 2, true) }); }
  // the status word: a maintain drift says which way
  function statusKey(p) {
    return p.status === 'drift' ? (p.rate > 0 ? 'driftUp' : 'driftDown') : p.status;
  }
  // every number in the copy comes from the baked thresholds (the goal's own band)
  function detailText(p, g) {
    var D = T.detail, st = statusKey(p), band = P.bands[g] || {};
    var vars = { min: fin(band.min) ? HC.num(band.min, 2) : '', max: fin(band.max) ? HC.num(band.max, 2) : '', pct: HC.num(P.maxPctWeek, 0),
      kg: HC.num(P.reachedKg, 1), stable: HC.num(P.stableKg, 2) };
    if (st === 'fast' || st === 'wrong') return D[st + g] ? format(D[st + g], vars) : '';
    if (st === 'fewData') return format(T.fewData, { need: P.minReadings, span: P.minSpanDays, have: p.n });
    return D[st] ? format(D[st], vars) : '';
  }

  /* ---------- render ---------- */
  // The card = numbers + labels (the shared card language): "7-DAY AVERAGE" + the last weigh-in, the
  // average big in --num with the weekly rate as a pill coloured by the status, the status word with
  // its dot, the target / kg to go, the ETA. The why of the status, the rate window and the method go
  // to the section's ⓘ block (#nutri-progress-info, Dia.astro), written here on every render.
  function html(notes) {
    var m = weightMetric(), p = compute();
    if (!p) return '<p class="pg-empty">' + esc(T.empty) + '</p>';
    var g = goal(), old = stale(p), tone = old ? 'muted' : TONE[p.status] || 'muted';
    var out = ['<div class="pg-head"><span class="pg-lbl">' + esc(T.avg) + '</span><span class="pg-date">' + esc(format(T.asOf, { date: HC.fmtDate(p.current.date) })) + '</span></div>',
      '<div class="pg-main"><span class="pg-num"><b class="pg-kg">' + esc(kg(p.current.kg)) + '</b><small>kg</small></span>' +
      (p.rate != null && !old ? '<span class="pg-pill pg-s-' + tone + '">' + esc(rateText(p)) + '</span>' : '') + '</div>'];
    if (p.rate != null) notes.push(format(T.rateWin, { win: P.windowDays }));
    if (old) out.push('<p class="pg-status pg-s-muted">' + esc(format(T.stale, { date: HC.fmtDate(p.current.date) })) + '</p>');
    else {
      out.push('<p class="pg-status pg-s-' + tone + '"><span class="pg-dot" aria-hidden="true"></span><b>' + esc(T.status[statusKey(p)] || '') + '</b></p>');
      if (detailText(p, g)) notes.unshift(detailText(p, g));
    }
    var S = window.HCSettings, ready = S && typeof S.ready === 'function' && S.ready();
    if (p.remaining != null) {
      var togo = p.remaining === 0 ? '' : format(p.remaining > 0 ? T.toGoUp : T.toGoDown, { kg: kg(Math.abs(p.remaining)) });
      out.push('<p class="pg-target">' + esc(format(T.target, { kg: kg(target()) })) + (togo && p.status !== 'reached' ? ' · ' + esc(togo) : '') + '</p>');
      if (p.mismatch && T['mismatch' + g]) out.push('<p class="pg-warn">' + esc(T['mismatch' + g]) + '</p>');
    } else if (ready) out.push('<p class="pg-target pg-faint">' + esc(T.addTarget) + '</p>');
    if (!old && p.etaWeeks) {
      var mo = etaMonths(HC.todayIso(), p.etaWeeks);
      if (mo) {
        var a = HC.fmtMonth(mo[0]), b = HC.fmtMonth(mo[1]), spread = HC.num(P.etaSpread * 100, 0);
        out.push('<p class="pg-eta">' + esc(a === b ? format(T.etaOne, { from: a, spread: spread }) : format(T.eta, { from: a, to: b, spread: spread })) + '</p>');
      }
    }
    notes.push(format(T.method, { win: P.windowDays }));
    var open = m ? HC.detailAttrs('weight') : '';
    return '<div class="nutri-card pg-card"' + open + (open ? ' aria-label="' + esc(T.open) + '"' : '') + '>' + out.join('') + '</div>';
  }
  function render() {
    var host = document.getElementById ? document.getElementById('nutri-progress') : null;
    if (!host) return;
    var notes = [];
    try { host.innerHTML = html(notes); } catch (e) { host.innerHTML = '<p class="nutri-failed">' + esc(TN.failed) + '</p>'; notes = []; }
    var info = document.getElementById('nutri-progress-info');
    if (info) info.innerHTML = notes.map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('');
    var btn = document.getElementById('nutri-progress-i'); // the section's ⓘ: only with something behind it
    if (btn) btn.hidden = !notes.length;
  }
  /** The profile sheet's one line ("78,4 kg de media · -0,32 kg/sem · A buen ritmo"), or '' without data. */
  function line() {
    try {
      var p = compute();
      if (!p) return '';
      var st = stale(p) ? T.staleShort : T.status[statusKey(p)] || '';
      return p.rate != null && !stale(p) ? format(T.line, { avg: kg(p.current.kg), rate: rateText(p), status: st }) : format(T.lineFew, { avg: kg(p.current.kg), status: st });
    } catch (e) {
      return '';
    }
  }

  window.HCProgress = { rollPoints: rollPoints, weeklyRate: weeklyRate, weightProgress: weightProgress, etaMonths: etaMonths, compute: compute, render: render, line: line };
  var S = window.HCSettings;
  if (S && typeof S.onChange === 'function') S.onChange(render);
  render();
})();
