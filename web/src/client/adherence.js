/* Nutrición "Constancia" — food log adherence (LAN page only). Classic script (is:inline), inlined after
 * progress.js. Reads GET /api/food/log/summary (through window.HCFood.api, the food log's one client)
 * for the last NUTRI.adherence.stripDays days ending at the viewer's today, each day's MEALS target from
 * window.HCNutri.targetFor(date) (the CURRENT goal × that day's detected day type; null = unknown type)
 * and NUTRI.adherence + I18N_NUTRI.adherence.
 *
 * isComplete / dayState / adherence port lib/nutrition/adherence.mjs line by line (a test runs both
 * over ADHERENCE_CASES): logged days, COMPLETE days (>= 1 entry in each of breakfast, lunch, dinner —
 * the rule sits behind the section ⓘ), mean kcal vs mean target and protein-target days, computed ONLY over complete
 * days with a target; a complete day without one is counted apart. A 7 / 14 / 28-day switch (real
 * radios, in memory) picks the window; a 28-cell strip (7 per row, each a >= 44px button with its state
 * in words as its label, never colour only) opens Registrar on that day (HCFood.showDay). Missing macros
 * are minimums, never 0. The block ships hidden and appears only when the summary answers; it re-reads
 * after every add / delete (client/food-*.js calls HCAdherence.reload) and re-renders on a goal change
 * (HCNutri.refresh calls HCAdherence.render); each read also refreshes Inicio's weekly plan
 * (window.HCWeekPlan.refresh, client/home-week.js). Its own try/catch: a one-line fallback, never a blank tab. */
(function () {
  var N = typeof NUTRI === 'undefined' || !NUTRI ? null : NUTRI;
  var TN = typeof I18N_NUTRI === 'undefined' || !I18N_NUTRI ? null : I18N_NUTRI;
  if (!N || !TN || !N.adherence || !TN.adherence) return;
  var A = N.adherence, T = TN.adherence;
  var esc = HC.esc, format = HC.format;
  var MARK = { none: '', partial: '·', unknown: '?', assumed: '–', under: '↓', on: '✓', over: '↑' };
  var S = { win: A.windows[0], days: null, from: null, to: null, failed: false, seq: 0, timer: null };

  /* ---------- port of lib/nutrition/adherence.mjs ---------- */
  function fin(v) {
    return typeof v === 'number' && isFinite(v);
  }
  function isComplete(day) {
    var g = day && day.groups;
    if (!g) return false;
    return A.required.every(function (k) { return fin(g[k]) && g[k] >= 1; });
  }
  function dayState(day, target) {
    if (!day || !(day.n > 0)) return 'none';
    if (!isComplete(day)) return 'partial';
    if (!target || !fin(target.k) || !(target.k > 0) || !fin(day.k)) return 'unknown';
    // a rest day assumed from sleep alone (no session, nothing programmed): never compared
    if (target.inferred) return 'assumed';
    var r = day.k / target.k;
    if (r < 1 - A.onBand) return 'under';
    if (r > 1 + A.onBand) return 'over';
    return 'on';
  }
  function adherence(dates, days, targets) {
    var byDate = {};
    (days || []).forEach(function (d) { if (d && typeof d.date === 'string') byDate[d.date] = d; });
    var TT = targets || {};
    var out = { days: 0, logged: 0, complete: 0, compared: 0, unknown: 0, assumed: 0, meanK: null, meanTarget: null, proteinHit: 0, proteinMin: 0, proteinUnknown: 0, states: [] };
    var sumK = 0, sumT = 0;
    (dates || []).forEach(function (date) {
      var d = byDate[date] || null, t = TT[date] || null;
      var st = dayState(d, t);
      out.days++;
      out.states.push({ date: date, state: st });
      if (st === 'none') return;
      out.logged++;
      if (st === 'partial') return;
      out.complete++;
      if (st === 'unknown') { out.unknown++; return; }
    if (st === 'assumed') { out.assumed++; return; }
      out.compared++;
      sumK += d.k;
      sumT += t.k;
      if (!fin(d.p)) { out.proteinUnknown++; return; }
      var hit = fin(t.p) && t.p > 0 && d.p >= A.proteinShare * t.p;
      if (hit) out.proteinHit++;
      if (d.missing && d.missing.p) out.proteinMin++;
    });
    if (out.compared) {
      out.meanK = Math.round(sumK / out.compared);
      out.meanTarget = Math.round(sumT / out.compared);
    }
    return out;
  }

  /* ---------- data ---------- */
  function $(id) { return document.getElementById ? document.getElementById(id) : null; }
  function api() {
    var F = window.HCFood;
    return F && typeof F.api === 'function' ? F.api : null;
  }
  // the last n days ending at the viewer's today, oldest first
  function lastDays(n) {
    var today = HC.todayIso(), out = [];
    for (var i = n - 1; i >= 0; i--) out.push(HC.shiftIso(today, -i));
    return out;
  }
  function targets(dates) {
    var n = window.HCNutri, out = {};
    dates.forEach(function (d) {
      var t = null;
      try { t = n && typeof n.targetFor === 'function' ? n.targetFor(d) : null; } catch (e) { t = null; }
      out[d] = t && fin(t.k) ? { k: t.k, p: fin(t.p) ? t.p : null, inferred: !!t.inferred } : null;
    });
    return out;
  }
  function goalName() {
    var n = window.HCNutri, g = null;
    try { g = n && typeof n.state === 'function' ? n.state().goal : N.goal; } catch (e) { g = N.goal; }
    return TN.goals && TN.goals[g] ? TN.goals[g] : '';
  }
  // the summary read; reload() = the same, debounced (a burst of adds / deletes reads once)
  function load() {
    var call = api();
    if (!call) return null;
    var dates = lastDays(A.stripDays), mine = ++S.seq;
    return call('GET', '/log/summary?from=' + dates[0] + '&to=' + dates[dates.length - 1]).then(function (d) {
      if (mine !== S.seq) return;
      S.days = d && Array.isArray(d.days) ? d.days : [];
      S.from = dates[0];
      S.to = dates[dates.length - 1];
      S.failed = false;
      render();
      homePlan();
    }, function () {
      if (mine !== S.seq) return;
      // shown only once the block has been shown (an ingest without the summary never reveals it)
      S.failed = S.days != null;
      render();
    });
  }
  // Inicio's weekly plan (client/home-week.js) counts this week's logged / on-target days from the
  // same summary: tell it a fresh one is here (it is absent when Inicio is hidden)
  function homePlan() {
    var W = window.HCWeekPlan;
    try { if (W && typeof W.refresh === 'function') W.refresh(); } catch (e) { /* its own fallback */ }
  }
  function reload() {
    if (S.timer) clearTimeout(S.timer);
    S.timer = setTimeout(function () { S.timer = null; load(); }, A.reloadMs);
  }

  /* ---------- render ---------- */
  function k0(n) { return HC.num(n, 0); }
  function pctOf(share) { return HC.num(share * 100, 0); }
  function stateText(st) { return format(T.states[st] || '', { band: pctOf(A.onBand) }); }
  // one tile: UPPERCASE label, the number big in --num, "of N" small; share = a thin bar under it
  // (days logged / complete days of the window), the shared card language's small bar
  function stat(label, value, sub, share) {
    return '<div class="adh-stat"><span class="adh-lbl">' + esc(label) + '</span><b class="adh-val">' + esc(value) + '</b>' + (sub ? '<small class="adh-sub">' + esc(sub) + '</small>' : '') +
      (share != null ? '<span class="adh-bar" aria-hidden="true">' + (share > 0 ? '<i style="width:' + Math.round(Math.min(1, share) * 100) + '%"></i>' : '') + '</span>' : '') + '</div>';
  }
  // the tiles; the notes (no comparison, minimums, unknown / assumed days) go to the ⓘ block (notesOf)
  function statsHtml(r) {
    var out = [stat(T.logged, String(r.logged), format(T.ofDays, { n: r.days }), r.days ? r.logged / r.days : 0),
      stat(T.complete, String(r.complete), format(T.ofDays, { n: r.days }), r.days ? r.complete / r.days : 0)];
    if (r.compared) {
      out.push(stat(T.kcal, k0(r.meanK), format(T.kcalVs, { t: k0(r.meanTarget), pct: k0((r.meanK / r.meanTarget) * 100) })));
      out.push(stat(format(T.protein, { pct: pctOf(A.proteinShare) }), String(r.proteinHit), format(T.proteinOf, { n: r.compared })));
    }
    return '<div class="adh-stats">' + out.join('') + '</div>';
  }
  function notesOf(r) {
    var notes = [];
    if (!r.compared) notes.push(T.noCompared);
    if (r.proteinMin) notes.push(T.proteinMin);
    if (r.proteinUnknown) notes.push(format(T.proteinUnknown, { n: r.proteinUnknown }));
    if (r.unknown) notes.push(format(T.unknown, { n: r.unknown }));
    if (r.assumed) notes.push(format(T.assumed, { n: r.assumed }));
    notes.push(T.rule, format(T.goalNote, { goal: goalName() }));
    return notes;
  }
  function stripHtml(r) {
    var today = HC.todayIso();
    var cells = r.states.map(function (s) {
      var label = format(T.cell, { date: HC.fmtDate(s.date), state: stateText(s.state) });
      return '<button type="button" class="adh-cell adh-' + s.state + (s.date === today ? ' adh-today' : '') + '" data-adh-day="' + s.date + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
        '<span class="adh-d" aria-hidden="true">' + +s.date.slice(8, 10) + '</span><span class="adh-m" aria-hidden="true">' + esc(MARK[s.state] || '') + '</span></button>';
    }).join('');
    var legend = ['partial', 'under', 'on', 'over', 'assumed', 'unknown'].map(function (k) {
      return '<span class="adh-key"><span class="adh-sw adh-' + k + '" aria-hidden="true">' + esc(MARK[k]) + '</span>' + esc(T.legend[k]) + '</span>';
    }).join('');
    var title = format(T.strip, { n: A.stripDays });
    return '<h3 class="adh-h">' + esc(title) + '</h3><div class="adh-strip" role="group" aria-label="' + esc(title) + '">' + cells + '</div><div class="adh-legend">' + legend + '</div>';
  }
  // The ⓘ block (#adh-info, toggled by the section header's ⓘ in Dia.astro) leads the host: the
  // window's notes + the complete-day rule + the goal note, nothing lost; then the card of tiles,
  // then the strip (outside the card: at 360px only the full block width fits 7 cells of >= 44px)
  function html() {
    if (S.failed) return '<p class="nutri-failed">' + esc(T.failed) + ' <button type="button" class="lnk" data-adh-retry="1">' + esc(T.retry) + '</button></p>';
    var all = lastDays(A.stripDays);
    var tg = targets(all);
    var strip = adherence(all, S.days, tg);
    var win = adherence(all.slice(all.length - S.win), S.days, tg);
    return '<div class="hs-info" id="adh-info" hidden>' + notesOf(win).map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('') + '</div>' +
      '<div class="nutri-card adh-card">' + statsHtml(win) + '</div>' + stripHtml(strip);
  }
  function syncSwitch() {
    (document.querySelectorAll ? document.querySelectorAll('[name="adh-win"]') : []).forEach(function (inp) {
      inp.checked = Number(inp.getAttribute('value')) === S.win;
    });
  }
  function render() {
    var block = $('food-adherence-block'), host = $('food-adherence');
    if (!block || !host || S.days == null) return;
    block.hidden = false;
    try { syncSwitch(); } catch (e) { /* the server-rendered switch keeps its state */ }
    var was = $('adh-info'), open = !!(was && !was.hidden); // a re-render keeps the ⓘ block as it was
    try { host.innerHTML = html(); } catch (e) { host.innerHTML = '<p class="nutri-failed">' + esc(TN.failed) + '</p>'; }
    var now = $('adh-info');
    if (now && open) now.hidden = false;
  }

  /* ---------- events ---------- */
  function on(id, evt, fn) {
    var el = $(id);
    if (el && el.addEventListener) el.addEventListener(evt, fn);
  }
  on('adh-window', 'change', function (e) {
    var v = Number(e && e.target && e.target.value);
    if (A.windows.indexOf(v) < 0) return;
    S.win = v;
    render();
  });
  on('food-adherence', 'click', function (e) {
    var t = e && e.target;
    if (t && t.closest && t.closest('[data-adh-retry]')) { load(); return; }
    var cell = t && t.closest ? t.closest('[data-adh-day]') : null;
    var F = window.HCFood;
    if (!cell || !F || typeof F.showDay !== 'function') return;
    F.showDay(cell.getAttribute('data-adh-day'));
  });

  // a page left open past midnight: core.js reloads it when it becomes visible on another day, but waits
  // while the page is busy (a sheet open); this re-reads the window meanwhile so the strip ends at today
  if (document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && S.to && S.to !== HC.todayIso()) load();
    });
  }

  window.HCAdherence = { isComplete: isComplete, dayState: dayState, adherence: adherence, render: render, reload: reload, state: function () { return S; } };
  try { load(); } catch (e) { /* the block stays hidden */ }
})();
