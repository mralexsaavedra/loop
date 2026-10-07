/* "Entrenos / Workouts" tab — dashboard of EXECUTED training sessions.
 * Ported verbatim from the legacy `<script>` IIFE in
 * data/nutrition/plan-web.template.html ("training dashboard"), adapted to
 * read DASH/LOCALE from globals baked by web/src/components/Bake.astro and
 * I18N_DASH (web/src/i18n/dash-templates.mjs) instead of hardcoded English
 * strings/labels — same pattern as client/training-today.js.
 *
 * `esc()` calls are placed at EXACTLY the same spots as the legacy source
 * (fmtD()/hc() results, modality labels, composed bar-title strings) —
 * static I18N_DASH copy is trusted the same way legacy's hardcoded English
 * literals were, so it is NOT re-escaped (matches design's Trusted markup
 * row: dict content is generic/tracked, never user input).
 *
 * Unlike training-today.js, nothing here depends on `new Date()` — DASH is
 * a fully precomputed snapshot (lib/training/dashboard.mjs's
 * aggregateDashboard, baked at build time), so this script's output is
 * deterministic for a given DASH value regardless of when the page loads.
 *
 * `hc()` (compact hour/minute label) is the one LOCALE-sensitive number
 * format here: the tracked English template never localizes the decimal
 * separator, but the owner's live Spanish page does (`1.5` -> `1,5`) — see
 * docs/health-tab.md's "es-ES dates, comma decimals". Ported as a genuine per-locale
 * behavior, not a hardcoded literal.
 */
(function () {
  var LBL = I18N_DASH.modalityLabels;

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  function format(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) {
      return vars && vars[k] != null ? vars[k] : '';
    });
  }
  // the ONE display-date formatter (util.js), without the weekday: "22 Jun" / "22 jun"
  function fmtD(isoStr) {
    return HC.fmtDate(isoStr, { weekday: false });
  }
  function hm(min) {
    var h = Math.floor(min / 60);
    var m = min % 60;
    return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min';
  }
  function hc(min) {
    if (min < 60) return min + ' min';
    var h = Math.round((min / 60) * 10) / 10;
    return (LOCALE === 'es' ? String(h).replace('.', ',') : String(h)) + ' h';
  }

  function render() {
    var host = document.getElementById('train-dash');
    if (!host) return;
    if (!DASH.hasData) {
      host.innerHTML = '<div class="train-empty">' + I18N_DASH.emptyMsg + '</div>';
      return;
    }
    var r = DASH.recent;
    var cards =
      '<div class="dash-cards">' +
      '<div class="dash-card"><div class="dash-num">' + r.daysPerWeek + '</div><div class="dash-lbl">' + I18N_DASH.daysPerWeekLbl + '</div></div>' +
      '<div class="dash-card"><div class="dash-num">' + esc(hc(r.minPerWeek)) + '</div><div class="dash-lbl">' + I18N_DASH.perWeekLbl + '</div></div>' +
      '<div class="dash-card"><div class="dash-num">' + r.sessions + '</div><div class="dash-lbl">' + I18N_DASH.sessions4wkLbl + '</div></div>' +
      '</div>';
    var wk = DASH.weeklyMin;
    var max = Math.max.apply(null, wk.map(function (w) { return w.min; })) || 1;
    var bars = wk
      .map(function (w) {
        var h = Math.round((100 * w.min) / max);
        return '<div class="wbar' + (w.min ? '' : ' zero') + '" title="' + esc(fmtD(w.w) + ': ' + hm(w.min) + ' · ' + w.days + 'd') + '"><i style="height:' + h + '%"></i></div>';
      })
      .join('');
    var ax = '<div class="waxis"><span>' + esc(fmtD(wk[0].w)) + '</span><span>' + esc(fmtD(wk[Math.floor(wk.length / 2)].w)) + '</span><span>' + esc(fmtD(wk[wk.length - 1].w)) + '</span></div>';
    var vol = '<div class="dash-sec"><h3>' + I18N_DASH.volHeading + '</h3><p class="hint">' + format(I18N_DASH.volHint, { weeks: DASH.weeks }) + '</p><div class="wbars">' + bars + '</div>' + ax + '</div>';
    var mb = DASH.modality
      .map(function (m) {
        return '<div class="mrow"><span class="mlbl">' + esc(LBL[m.key] || m.key) + '</span><div class="mtrack"><i style="width:' + m.pct + '%"></i></div><span class="mval">' + m.pct + '% · ' + esc(hc(m.min)) + '</span></div>';
      })
      .join('');
    var mod = '<div class="dash-sec"><h3>' + I18N_DASH.modHeading + '</h3><p class="hint">' + format(I18N_DASH.modHint, { weeks: DASH.weeks }) + '</p>' + mb + '</div>';
    var note = I18N_DASH.note1Html;
    var intens = '';
    if (DASH.intensity && DASH.intensity.avgHr) {
      var im = DASH.modality.filter(function (m) { return m.avgHr; }).slice().sort(function (a, b) { return b.avgHr - a.avgHr; });
      var imax = Math.max.apply(null, im.map(function (m) { return m.avgHr; })) || 1;
      var ir = im
        .map(function (m) {
          var w = Math.round((100 * m.avgHr) / imax);
          return '<div class="mrow"><span class="mlbl">' + esc(LBL[m.key] || m.key) + '</span><div class="mtrack"><i style="width:' + w + '%"></i></div><span class="mval">' + m.avgHr + ' ' + I18N_DASH.bpmLabel + ' · ' + I18N_DASH.peakLabel + ' ' + m.peakHr + '</span></div>';
        })
        .join('');
      var iq = DASH.intensity;
      intens =
        '<div class="dash-sec"><h3>' + I18N_DASH.intensityHeading + '</h3><p class="hint">' + format(I18N_DASH.intensityHint, { withHr: iq.withHr, total: iq.total, weeks: DASH.weeks }) + '</p>' + ir + I18N_DASH.note2Html + '</div>';
    }
    host.innerHTML = '<p class="dash-as">' + format(I18N_DASH.asOfLine, { date: esc(fmtD(DASH.asOf)) }) + '</p>' + cards + vol + mod + intens + note;
  }

  render();
})();
