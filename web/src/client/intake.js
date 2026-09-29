/* Nutrición intake rings — the most recent logged day's intake (INTAKE.latest, from
 * dietary-daily.csv) against the plan's day total for the day type picked in the train/rest
 * toggle (INTAKE.target). Classic script (is:inline): reads INTAKE / I18N_INTAKE / LOCALE baked
 * by components/Bake.astro. Freshness is decided HERE against the viewer's clock (the build bakes
 * no "now"), so the rings only show when intake exists for a date within INTAKE.freshDays days.
 *
 * Data honesty: a ring fills ONLY from logged intake. No fresh intake -> empty state with how to
 * enable it; a macro missing on the logged day -> an empty ring with a dash, never a ring drawn
 * from the target. core.js setDay() calls window.intakeRefresh() when the toggle changes. */
(function () {
  var T = I18N_INTAKE;
  var DATE_LOCALE = LOCALE === 'es' ? 'es-ES' : 'en-GB';
  var RING_R = 18; // ring radius in the 44-unit viewBox (centre 22, 4 units of stroke room)
  var C = 2 * Math.PI * RING_R;
  var OVER_TARGET_RATIO = 1.1; // beyond 110% of the target the ring is styled as over

  function format(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) {
      return vars && vars[k] != null ? vars[k] : '';
    });
  }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  function nf(n) {
    return LOCALE === 'es' ? String(n).replace('.', ',') : String(n);
  }
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayNum(s) {
    return Date.parse(s + 'T00:00:00Z') / 86400000;
  }
  function fmtD(s) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(DATE_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function isFresh(date) {
    if (!date) return false;
    var age = dayNum(iso(new Date())) - dayNum(date);
    return age >= 0 && age <= INTAKE.freshDays;
  }
  function dayType() {
    var b = document.getElementById('b-train');
    return b && b.getAttribute('aria-pressed') === 'false' ? 'rest' : 'train';
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
    // never logged at all: one line, not a card (with Registro visible, Dia.astro renders no host
    // and the line sits in the Registro fold summary instead)
    if (!L) {
      host.innerHTML = '<p class="intake-hint">' + T.noneHtml + '</p>';
      return;
    }
    if (!isFresh(L.date)) {
      var last = L ? format(T.lastTpl, { date: esc(fmtD(L.date)) }) : '';
      host.innerHTML = '<div class="intake-card intake-empty"><h3>' + T.heading + '</h3><p>' + format(T.emptyHtml, { days: INTAKE.freshDays }) + last + '</p></div>';
      return;
    }
    var d = dayType(), t = INTAKE.target[d];
    // today's log is still filling up: say so, so partial rings are not read as a finished day
    var asOf = L.date === iso(new Date()) ? T.todayLbl : format(T.asOfTpl, { date: fmtD(L.date) });
    host.innerHTML =
      '<div class="intake-card">' +
      '<div class="intake-head"><h3>' + T.heading + '</h3><span class="intake-asof">' + esc(asOf) + '</span></div>' +
      '<div class="intake-target">' + T.targetLbl[d] + '</div>' +
      '<div class="intake-rings">' + ring('k', L.k, t.k) + ring('p', L.p, t.p) + ring('c', L.c, t.c) + ring('g', L.g, t.g) + '</div>' +
      '<p class="intake-note">' + T.noteHtml + '</p>' +
      '</div>';
  }

  window.intakeRefresh = render;
  render();
})();
