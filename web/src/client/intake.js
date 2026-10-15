/* Nutrición intake rings — the most recent logged day's intake (INTAKE.latest, from
 * dietary-daily.csv) against THAT day's target (window.HCNutri.targetFor(date), client/nutri-day.js:
 * the day's own detected day type x the current goal, its recorded ride minutes; today = Resumen de
 * hoy's nutriTarget; on bike days the MEALS target, with the ride fuel shown as its own line). A past
 * day whose type cannot be determined (targetFor -> null) renders NO rings: there is no honest target
 * to fill against. Without Nutrición (never in a normal build) the plan's training-day total
 * (INTAKE.target.train) is used. Classic script (is:inline): reads INTAKE / I18N_INTAKE / LOCALE baked
 * by components/Bake.astro. Freshness is decided HERE against the viewer's clock (the build bakes
 * no "now"), so the rings only show when intake exists for a date within INTAKE.freshDays days.
 *
 * Data honesty: a ring fills ONLY from logged intake. No fresh intake (never logged, or nothing in
 * the last INTAKE.freshDays days) -> the block renders NOTHING (host hidden, no help text); a macro missing on the logged day -> an empty ring with a dash, never a ring drawn
 * from the target. Intake logged TODAY is shown by Resumen de hoy's kcal dial + macro bars
 * (client/nutri-day.js), so with Nutrición on the page the rings then step aside (host hidden). nutri-day.js calls window.intakeRefresh() after every goal / day type / ride change.
 * On the LAN page (the food API answered: HCFood.ready(), client/food-*.js) the page's food log is the ONE
 * source: today's log (window.foodTotals, labelled "Logged today") when it has entries, else the most
 * recent food-log day in the same window (HCFood.recentDay(INTAKE.freshDays), labelled by its date),
 * else nothing — never the Apple Health day there (nor while today's log is not loaded: HCFood.groupTotals()
 * null). While the food API boot request is in flight (HCFood.pending()) the rings render nothing; past
 * INTAKE.bootGraceMs without an answer the Apple Health day renders, and a late answer still switches.
 * That wait is shared (window.intakeWaiting) with Resumen de hoy's dial + bars (nutri-day.js), which
 * this script re-renders at load and at the grace's end (HCNutri.refresh) — one timer for both. */
(function () {
  var T = I18N_INTAKE;
  var RING_R = 18; // ring radius in the 44-unit viewBox (centre 22, 4 units of stroke room)
  var C = 2 * Math.PI * RING_R;
  var OVER_TARGET_RATIO = 1.1; // beyond 110% of the target the ring is styled as over

  // shared helpers (web/src/client/util.js)
  var format = HC.format, esc = HC.esc, nf = HC.nf;
  function isFresh(date) {
    var age = HC.daysOld(date);
    return age != null && age >= 0 && age <= INTAKE.freshDays;
  }
  // min = some of today's food-log entries lack this macro: the logged sum is a minimum ("≥")
  function ring(key, actual, target, min) {
    var has = actual != null && target > 0;
    var shown = has ? (min ? '≥ ' : '') + nf(actual) : null;
    var frac = has ? actual / target : null;
    var pct = has ? Math.round(frac * 100) : null;
    var len = has ? Math.min(1, Math.max(0, frac)) * C : 0;
    var cls = 'ring ring-' + key + (has ? (frac > OVER_TARGET_RATIO ? ' ring-over' : '') : ' ring-none');
    var fill = has && len > 0
      ? '<circle class="ring-fill" cx="22" cy="22" r="' + RING_R + '" stroke-dasharray="' + len.toFixed(2) + ' ' + C.toFixed(2) + '" transform="rotate(-90 22 22)"/>'
      : '';
    var aria = T.rings[key] + ': ' + (has ? shown + ' ' + format(T.ofTpl, { target: nf(target), unit: T.units[key] }) : T.missing);
    return (
      '<figure class="' + cls + '" role="img" aria-label="' + esc(aria) + '">' +
      '<div class="ring-art"><svg viewBox="0 0 44 44" aria-hidden="true">' +
      '<circle class="ring-track" cx="22" cy="22" r="' + RING_R + '"/>' + fill + '</svg>' +
      '<span class="ring-pct">' + (has ? HC.pct(pct) : '—') + '</span></div>' +
      '<figcaption><span class="ring-lbl">' + T.rings[key] + '</span>' +
      '<span class="ring-val"><b>' + (has ? shown : '—') + '</b> ' + format(T.ofTpl, { target: nf(target), unit: T.units[key] }) + '</span></figcaption>' +
      '</figure>'
    );
  }

  function render() {
    var host = document.getElementById('intake');
    if (!host) return;
    var L = INTAKE.latest;
    var F = window.HCFood, lan = lanReady();
    // the food API boot request is still in flight: no source yet, so no rings (never a flash of the
    // Apple Health day) — until it answers / fails (food-log.js re-renders us) or the grace period ends
    if (waiting()) {
      host.innerHTML = '';
      host.hidden = true;
      return;
    }
    if (lan) {
      // LAN page: the food log only — today's, else its most recent day in the window (no Apple Health);
      // today's log not loaded (read failed / not back yet): nothing until its retry re-renders us
      try {
        L = typeof F.groupTotals === 'function' && F.groupTotals() == null ? null :
          (typeof window.foodTotals === 'function' && window.foodTotals()) ||
          (typeof F.recentDay === 'function' ? F.recentDay(INTAKE.freshDays) : null) || null;
      } catch (e) { L = null; }
    } else if (typeof window.foodTotals === 'function') {
      // today's page food log wins over the Apple Health day
      try {
        var logged = window.foodTotals(); // null unless today has entries (the contract in food-*.js)
        if (logged) L = logged;
      } catch (e) { /* keep the Apple Health day */ }
    }
    host.hidden = false;
    // logged TODAY and Resumen de hoy is on the page: its kcal dial + macro bars already show it
    if (L && L.date === HC.todayIso() && typeof window.nutriTarget === 'function') {
      host.innerHTML = '';
      host.hidden = true;
      return;
    }
    // no intake in the last INTAKE.freshDays days (or never logged): the block renders nothing
    if (!L || !isFresh(L.date)) {
      host.innerHTML = '';
      host.hidden = true;
      return;
    }
    var t = INTAKE.target.train, lbl = T.targetLbl.train, fuelK = 0;
    // Nutrición's target for THAT day (client/nutri-day.js HCNutri.targetFor: the logged day's own
    // detected day type x the current goal); else the plan total
    var N = window.HCNutri;
    if (N && typeof N.targetFor === 'function') {
      var nt;
      try { nt = N.targetFor(L.date); } catch (e) { nt = undefined; /* keep the plan total */ }
      // that day's type cannot be determined: there is no honest target to fill against
      if (nt === null) {
        host.innerHTML = '';
        host.hidden = true;
        return;
      }
      if (nt && nt.k > 0) { t = nt; lbl = esc(nt.label); fuelK = nt.fuelK > 0 ? nt.fuelK : 0; }
    }
    var M = L.missing || {};
    var minP = !!M.protein && L.p != null, minC = !!M.carbs && L.c != null, minG = !!M.fat && L.g != null;
    // today's log is still filling up: say so, so partial rings are not read as a finished day
    var asOf = L.date === HC.todayIso() ? (L.src === 'log' ? T.foodLbl : T.todayLbl) : format(T.asOfTpl, { date: HC.fmtDate(L.date) });
    host.innerHTML =
      '<div class="intake-card">' +
      '<div class="intake-head"><h3>' + T.heading + '</h3><span class="intake-asof">' + esc(asOf) + '</span></div>' +
      '<div class="intake-target">' + lbl +
      (fuelK ? '<span class="intake-fuel">' + esc(format(T.rideFuel, { k: nf(fuelK) })) + '</span>' : '') + '</div>' +
      '<div class="intake-rings">' + ring('k', L.k, t.k) + ring('p', L.p, t.p, minP) + ring('c', L.c, t.c, minC) + ring('g', L.g, t.g, minG) + '</div>' +
      (minP || minC || minG ? '<p class="intake-note">' + esc(T.minNote) + '</p>' : '') +
      '<p class="intake-note">' + T.noteHtml + '</p>' +
      '</div>';
  }

  // HCFood.pending(): the food API boot request has not answered yet (client/food-log.js)
  function booting() {
    var F = window.HCFood;
    try { return !!(F && typeof F.pending === 'function' && F.pending()); } catch (e) { return false; }
  }
  // past INTAKE.bootGraceMs without an answer (a fetch hanging in a sandboxed artifact) the Apple
  // Health day renders anyway; a late answer still switches to the food log
  var graceOver = false;
  function lanReady() {
    var F = window.HCFood;
    try { return !!(F && typeof F.ready === 'function' && F.ready()); } catch (e) { return false; }
  }
  // the ONE boot wait, shared with Resumen de hoy's dial + bars (client/nutri-day.js intakeToday): no
  // source yet while the boot request is in flight and the grace has not elapsed
  function waiting() { return !lanReady() && !graceOver && booting(); }
  // HCNutri.refresh re-renders Resumen de hoy, which re-renders the rings itself (refreshDependents)
  function renderAll() {
    var n = window.HCNutri;
    if (n && typeof n.refresh === 'function') {
      try { n.refresh(); return; } catch (e) { /* the rings below still render */ }
    }
    render();
  }
  window.intakeRefresh = render;
  window.intakeWaiting = waiting;
  if (booting() && typeof setTimeout === 'function') {
    setTimeout(function () { graceOver = true; renderAll(); }, INTAKE.bootGraceMs);
    // nutri-day.js rendered before the food scripts existed (it may show the Apple Health day): it
    // re-renders now, in the wait state. Consecutive inline scripts run before the first paint, so the
    // Apple Health day never reaches the screen.
    renderAll();
  } else render();
})();
