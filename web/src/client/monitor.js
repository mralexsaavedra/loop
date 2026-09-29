/* Inicio "Health monitor": the latest overnight signals (respiratory rate, resting HR, HRV, sleeping
 * wrist temperature, sleep duration) against the owner's own normal range, rendered from
 * SCORES.monitor (lib/score/monitor.mjs, baked by components/Bake.astro) + I18N_SCORE.monitor.
 *
 * Classic script (is:inline, no module scope). Everything numeric is baked: the band and the bar
 * fractions come from the lib; this file only formats numbers and joins markup. The range bar is an
 * inline SVG whose geometry lives in attributes (no inline styles), so the page stays CSP-safe.
 * "Last night" vs an older date and the staleness grey are decided here from Date.now(), never
 * baked, so consecutive builds stay byte-identical. Colour follows the baked tone (good / bad /
 * watch / normal), never the raw direction: respiratory rate and wrist temp only ever reach
 * "watch".
 */
(function () {
  var host = document.getElementById('monitor');
  if (!host) return;
  var S = typeof SCORES === 'undefined' ? null : SCORES;
  var M = S && S.monitor;
  if (!M || !M.cards) return;
  var T = I18N_SCORE.monitor;
  var ES = LOCALE === 'es';
  var STALE_DAYS = 3;
  var LINK = !!document.getElementById('t-health');

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(x, dec) {
    var s = Number(x).toFixed(dec);
    if (Number(s) === 0) s = (0).toFixed(dec);
    return ES ? s.replace('.', ',') : s;
  }
  function isoDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  function daysOld(iso) {
    iso = isoDate(iso);
    if (!iso) return null;
    var p = iso.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var n = new Date(Date.now());
    n = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    return Math.round((n - d) / 86400000);
  }
  function linkAttrs(key) {
    if (!LINK) return '';
    var call = "jumpOr('hl-" + key + "','health')";
    return ' role="button" tabindex="0" onclick="' + call + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + call + '}"';
  }
  // vertical range bar, 0 = bottom, 1 = top (viewBox 0..100 tall)
  function bar(b) {
    var y = function (f) { return (100 * (1 - f)).toFixed(1); };
    return '<svg class="hm-bar" viewBox="0 0 12 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect class="hm-track" x="4" y="0" width="4" height="100" rx="2"/>' +
      '<rect class="hm-band" x="3" y="' + y(b.hi) + '" width="6" height="' + (100 * (b.hi - b.lo)).toFixed(1) + '" rx="2"/>' +
      '<rect class="hm-mark" x="0" y="' + (Math.min(97, Math.max(0, 100 * (1 - b.v) - 1.5))).toFixed(1) + '" width="12" height="3" rx="1.5"/></svg>';
  }
  function card(c) {
    var lbl = T.labels[c.key] || c.key;
    var open = '<div class="hm-card';
    var close = '</div><!--/hm-->';
    if (c.state !== 'ok') {
      return open + ' hm-none" data-hm="' + esc(c.key) + '"' + linkAttrs(c.key) + '><div class="hm-body"><div class="hm-lbl">' + esc(lbl) +
        '</div><div class="hm-val">—</div><div class="hm-status">' + esc(T.status.none) + '</div></div>' + close;
    }
    var tone = c.tone || 'normal';
    var out = [open + ' hm-tone-' + esc(tone) + '" data-hm="' + esc(c.key) + '"' + linkAttrs(c.key) + '>'];
    if (c.bar) out.push(bar(c.bar));
    out.push('<div class="hm-body"><div class="hm-lbl">' + esc(lbl) + '</div>');
    out.push('<div class="hm-val"><b class="hm-num">' + esc(num(c.value, c.dec)) + '</b><small>' + esc(T.units[c.key] || c.unit) + '</small></div>');
    out.push('<div class="hm-status">' + esc(T.status[c.status] || '') + '</div>');
    // the range is written one decimal finer than the value (max 2), so a value just past the edge
    // never reads as sitting on it (e.g. 15.1 vs "14.2–15.1" for a High)
    var rd = Math.min(c.dec + 1, 2);
    if (c.band) out.push('<div class="hm-range">' + esc(T.rangeLbl.replace('{lo}', num(c.band.lo, rd)).replace('{hi}', num(c.band.hi, rd))) + '</div>');
    if (daysOld(c.date) !== 0 && isoDate(c.date)) out.push('<div class="hm-date">' + esc(c.date) + '</div>');
    out.push('</div>' + close);
    return out.join('');
  }

  var age = daysOld(M.asOf);
  var stale = age != null && age > STALE_DAYS;
  host.innerHTML = '<div class="hm sc-card' + (stale ? ' sc-stale' : '') + '" role="group" aria-label="' + esc(T.ariaLabel) + '">' +
    '<div class="sc-head"><h3>' + esc(T.heading) + '</h3></div><div class="hm-grid">' +
    M.cards.map(card).join('') + '</div><div class="sc-note">' + esc(T.note) + '</div></div>';
})();
