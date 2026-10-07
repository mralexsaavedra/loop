/* Entreno "Intensity (HR)" block — what is left of the executed-workouts dashboard once its weekly
 * volume, modality split and summary cards merged into the Activity card (client/training-activity.js).
 * Reads DASH (lib/training/dashboard.mjs aggregateDashboard, baked by web/src/components/Bake.astro),
 * and I18N_DASH (web/src/i18n/dash-templates.mjs).
 *
 * One metric row per modality (HC.metricRow, the shared row of Salud / My dashboard): the
 * minute-weighted mean HR over the dashboard's 12 weeks, the peak as the small line. There are no
 * heart-rate zones in the extract, so no zone bars are drawn; the mean HR is per modality and per
 * the fixed 12-week window (not per W / M / 6M), so it stays a compact card of its own. The section
 * header carries an ⓘ: the window and how many sessions have HR, the data date, and the strength
 * caveat. No data, or no session with HR: nothing is drawn (the Activity card holds the empty state).
 *
 * DASH is a fully precomputed snapshot: nothing here depends on `new Date()`.
 */
(function () {
  var host = document.getElementById('train-dash');
  if (!host) return;
  var LBL = I18N_DASH.modalityLabels;
  var DASH_ = typeof DASH === 'undefined' ? null : DASH;
  var esc = HC.esc, format = HC.format;

  function html() {
    var D = DASH_;
    if (!D || !D.hasData || !D.intensity || !D.intensity.avgHr) return '';
    var rows = D.modality.filter(function (m) { return m.avgHr; }).slice().sort(function (a, b) { return b.avgHr - a.avgHr; })
      .map(function (m) {
        var name = LBL[m.key] || m.key, peak = m.peakHr ? format(I18N_DASH.peakTpl, { value: m.peakHr }) : '';
        return HC.metricRow({ key: 'rhr', name: name, value: String(m.avgHr), unit: I18N_DASH.bpmLabel, base: peak,
          aria: format(I18N_DASH.rowAria, { name: name, value: m.avgHr }) + (peak ? ' · ' + peak : '') });
      });
    var q = D.intensity, title = I18N_DASH.intensityHeading;
    return '<section class="hs-sec" aria-labelledby="int-h"><div class="hs-head"><h3 class="hs-lbl" id="int-h">' + esc(title) + '</h3>' +
      HC.infoBtn('int-info', format(I18N_DASH.infoLbl, { section: title })) + '</div>' +
      '<div class="hs-info" id="int-info" hidden><p>' + esc(format(I18N_DASH.intensityHint, { withHr: q.withHr, total: q.total, weeks: D.weeks })) + ' ' +
      esc(format(I18N_DASH.asOfLine, { date: HC.fmtDate(D.asOf, { weekday: false }) })) + '</p><p>' + I18N_DASH.note2Html + '</p></div>' +
      '<ul class="db-list">' + rows.join('') + '</ul></section>';
  }

  try {
    host.innerHTML = html();
  } catch (e) {
    host.innerHTML = '';
  }
})();
