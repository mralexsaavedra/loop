/* Nutrición intake rings — the most recent logged day's intake (INTAKE.latest, from
 * dietary-daily.csv) against TODAY's target from Resumen de hoy (window.nutriTarget, client/nutri-day.js:
 * goal x day type; on bike days the MEALS target, with the ride fuel shown as its own line). Without
 * it (never in a normal build) the plan's training-day total (INTAKE.target.train) is used. Classic script (is:inline): reads INTAKE / I18N_INTAKE / LOCALE baked
 * by components/Bake.astro. Freshness is decided HERE against the viewer's clock (the build bakes
 * no "now"), so the rings only show when intake exists for a date within INTAKE.freshDays days.
 *
 * Data honesty: a ring fills ONLY from logged intake. No fresh intake (never logged, or nothing in
 * the last INTAKE.freshDays days) -> the block renders NOTHING (host hidden, no help text); a macro missing on the logged day -> an empty ring with a dash, never a ring drawn
 * from the target. Intake logged TODAY is shown by Resumen de hoy's kcal dial + macro bars
 * (client/nutri-day.js), so with Nutrición on the page the rings then step aside (host hidden). nutri-day.js calls window.intakeRefresh() after every goal / day type / ride change. */
(function () {
  var T = I18N_INTAKE;
  var DATE_LOCALE = LOCALE === 'es' ? 'es-ES' : 'en-GB';
  var RING_R = 18; // ring radius in the 44-unit viewBox (centre 22, 4 units of stroke room)
  var C = 2 * Math.PI * RING_R;
  var OVER_TARGET_RATIO = 1.1; // beyond 110% of the target the ring is styled as over

  // shared helpers (web/src/client/util.js)
  var format = HC.format, esc = HC.esc, nf = HC.nf;
  function fmtD(s) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(DATE_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function isFresh(date) {
    var age = HC.daysOld(date);
    return age != null && age >= 0 && age <= INTAKE.freshDays;
  }
  function ring(key, actual, target) {
    var has = actual != null && target > 0;
    var frac = has ? actual / target : null;
    var pct = has ? Math.round(frac * 100) : null;
    var len = has ? Math.min(1, Math.max(0, frac)) * C : 0;
    var cls = 'ring ring-' + key + (has ? (frac > OVER_TARGET_RATIO ? ' ring-over' : '') : ' ring-none');
    var fill = has && len > 0
      ? '<circle class="ring-fill" cx="22" cy="22" r="' + RING_R + '" stroke-dasharray="' + len.toFixed(2) + ' ' + C.toFixed(2) + '" transform="rotate(-90 22 22)"/>'
      : '';
    var aria = T.rings[key] + ': ' + (has ? nf(actual) + ' ' + format(T.ofTpl, { target: target, unit: T.units[key] }) : T.missing);
    return (
      '<figure class="' + cls + '" role="img" aria-label="' + esc(aria) + '">' +
      '<div class="ring-art"><svg viewBox="0 0 44 44" aria-hidden="true">' +
      '<circle class="ring-track" cx="22" cy="22" r="' + RING_R + '"/>' + fill + '</svg>' +
      '<span class="ring-pct">' + (has ? pct + '%' : '—') + '</span></div>' +
      '<figcaption><span class="ring-lbl">' + T.rings[key] + '</span>' +
      '<span class="ring-val"><b>' + (has ? nf(actual) : '—') + '</b> ' + format(T.ofTpl, { target: target, unit: T.units[key] }) + '</span></figcaption>' +
      '</figure>'
    );
  }

  function render() {
    var host = document.getElementById('intake');
    if (!host) return;
    var L = INTAKE.latest;
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
    // Nutrición's goal x day type target (client/nutri-day.js) when present; else the plan total
    if (typeof window.nutriTarget === 'function') {
      try {
        var nt = window.nutriTarget();
        if (nt && nt.k > 0) { t = nt; lbl = esc(nt.label); fuelK = nt.fuelK > 0 ? nt.fuelK : 0; }
      } catch (e) { /* keep the plan total */ }
    }
    // today's log is still filling up: say so, so partial rings are not read as a finished day
    var asOf = L.date === HC.todayIso() ? T.todayLbl : format(T.asOfTpl, { date: fmtD(L.date) });
    host.innerHTML =
      '<div class="intake-card">' +
      '<div class="intake-head"><h3>' + T.heading + '</h3><span class="intake-asof">' + esc(asOf) + '</span></div>' +
      '<div class="intake-target">' + lbl +
      (fuelK ? '<span class="intake-fuel">' + esc(format(T.rideFuel, { k: nf(fuelK) })) + '</span>' : '') + '</div>' +
      '<div class="intake-rings">' + ring('k', L.k, t.k) + ring('p', L.p, t.p) + ring('c', L.c, t.c) + ring('g', L.g, t.g) + '</div>' +
      '<p class="intake-note">' + T.noteHtml + '</p>' +
      '</div>';
  }

  window.intakeRefresh = render;
  render();
})();
