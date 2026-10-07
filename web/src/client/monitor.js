/* Inicio "Health monitor": two summary tiles near the top of Inicio (#home-tiles: the out-of-range
 * count + the HRV signal) and the full grid (#monitor, folded under "See metrics" until P5 moves it to
 * Salud). The latest overnight signals (respiratory rate, resting HR, HRV, sleeping
 * wrist temperature, sleep duration) against the owner's own normal range, rendered from
 * SCORES.monitor (lib/score/monitor.mjs, baked by components/Bake.astro) + I18N_SCORE.monitor.
 *
 * Classic script (is:inline, no module scope). Everything numeric is baked: the band and the bar
 * fractions come from the lib; this file only formats numbers and joins markup. The range bar is an
 * inline SVG whose geometry lives in attributes (no inline styles), so the page stays CSP-safe.
 * "Last night" vs an older date and the staleness grey are decided here from Date.now(), never
 * baked, so consecutive builds stay byte-identical. Colour follows the baked tone (good / bad /
 * watch / normal), never the raw direction: respiratory rate and wrist temp only ever reach
 * "watch". A card whose OWN date is more than STALE_DAYS old drops its tone and status ("no recent
 * data"), whatever the other cards say. One card throwing never blanks the block: it falls back to
 * its empty state. A tap on any card opens its detail sheet (HC.detailAttrs -> client/detail.js).
 */
(function () {
  var host = document.getElementById('monitor');
  if (!host) return;
  var S = typeof SCORES === 'undefined' ? null : SCORES;
  var M = S && S.monitor;
  var T = typeof I18N_SCORE === 'undefined' || !I18N_SCORE ? null : I18N_SCORE.monitor;
  if (!M || !M.cards || !T) return;
  var STALE_DAYS = HC.STALE_DAYS; // a reading older than this is shown greyed, with no status (baked)
  // range bar geometry (SVG user units): the bar is BAR_H tall, the value mark MARK_H thick
  var BAR_H = 100;
  var MARK_H = 3;

  // shared helpers (web/src/client/util.js)
  var esc = HC.esc, isoDate = HC.isoDate, daysOld = HC.daysOld, format = HC.format;
  function num(x, dec) {
    return HC.num(x, dec, false);
  }
  // every card opens its detail sheet (client/detail.js); the monitor keys are the detail metric keys
  function linkAttrs(key) {
    return HC.detailAttrs(key);
  }
  // vertical range bar, 0 = bottom, 1 = top (viewBox 0..BAR_H tall)
  function bar(b) {
    var y = function (f) { return (BAR_H * (1 - f)).toFixed(1); };
    var markY = Math.min(BAR_H - MARK_H, Math.max(0, BAR_H * (1 - b.v) - MARK_H / 2));
    return '<svg class="hm-bar" viewBox="0 0 12 ' + BAR_H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect class="hm-track" x="4" y="0" width="4" height="' + BAR_H + '" rx="2"/>' +
      '<rect class="hm-band" x="3" y="' + y(b.hi) + '" width="6" height="' + (BAR_H * (b.hi - b.lo)).toFixed(1) + '" rx="2"/>' +
      '<rect class="hm-mark" x="0" y="' + markY.toFixed(1) + '" width="12" height="' + MARK_H + '" rx="1.5"/></svg>';
  }
  var OPEN = '<div class="hm-card';
  var CLOSE = '</div><!--/hm-->';
  function emptyCard(key) {
    var lbl = T.labels[key] || key;
    return OPEN + ' hm-none" data-hm="' + esc(key) + '"' + linkAttrs(key) + '><div class="hm-body"><div class="hm-lbl">' + esc(lbl) +
      '</div><div class="hm-val">—</div><div class="hm-status">' + esc(T.status.none) + '</div></div>' + CLOSE;
  }
  function card(c) {
    if (c.state !== 'ok') return emptyCard(c.key);
    var lbl = T.labels[c.key] || c.key;
    var age = daysOld(c.date);
    var old = age != null && age > STALE_DAYS;
    var cls = old ? ' hm-stale' : ' hm-tone-' + esc(c.tone || 'normal');
    var out = [OPEN + cls + '" data-hm="' + esc(c.key) + '"' + linkAttrs(c.key) + '>'];
    if (c.bar && !old) out.push(bar(c.bar));
    out.push('<div class="hm-body"><div class="hm-lbl">' + esc(lbl) + '</div>');
    out.push('<div class="hm-val"><b class="hm-num">' + esc(num(c.value, c.dec)) + '</b><small>' + esc(T.units[c.key] || '') + '</small></div>');
    out.push('<div class="hm-status">' + esc(old ? T.status.stale : T.status[c.status] || '') + '</div>');
    // the range is written one decimal finer than the value (max 2), so a value just past the edge
    // never reads as sitting on it (e.g. 15.1 vs "14.2–15.1" for a High)
    var rd = Math.min(c.dec + 1, 2);
    if (c.band && !old) out.push('<div class="hm-range">' + esc(T.rangeLbl.replace('{lo}', num(c.band.lo, rd)).replace('{hi}', num(c.band.hi, rd))) + '</div>');
    if (daysOld(c.date) !== 0 && isoDate(c.date)) out.push('<div class="hm-date">' + esc(HC.fmtDate(c.date)) + '</div>');
    out.push('</div>' + CLOSE);
    return out.join('');
  }
  function safeCard(c) {
    try {
      return card(c);
    } catch (e) {
      return emptyCard(c && c.key ? c.key : '');
    }
  }

  /* ---- Inicio tiles (#home-tiles): the monitor's summary + the HRV signal, from the SAME cards ---- */
  // a card counts only with a fresh value (its own date <= STALE_DAYS old) and a status vs its band
  function fresh(c) {
    var a = c && c.state === 'ok' ? daysOld(c.date) : null;
    return a != null && a <= STALE_DAYS;
  }
  var CHECK = '<svg class="hmt-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  function lbl(text) {
    return '<span class="hmt-lbl">' + esc(text) + '<span class="hmt-chev" aria-hidden="true">›</span></span>';
  }
  // tile 1: out-of-range count (teal check "within range" when none), "n/total metrics" in range; a
  // tap jumps to the full monitor grid (core.js jump: opens its fold / switches to its tab)
  function sumTile() {
    var TT = T.tile, inR = 0, out = 0;
    M.cards.forEach(function (c) {
      if (!fresh(c)) return;
      if (c.status === 'normal') inR++;
      else if (c.status === 'high' || c.status === 'low') out++;
    });
    var chip = out > 0 ? '<span class="hmt-chip hmt-out">' + esc(format(TT.out, { n: out })) + '</span>'
      : inR > 0 ? '<span class="hmt-chip hmt-in">' + CHECK + esc(TT.inRange) + '</span>'
      : '<span class="hmt-chip hmt-none">' + esc(TT.none) + '</span>';
    return '<button type="button" class="hmt hmt-sum" onclick="jump(\'monitor\')">' + lbl(T.heading) +
      '<span class="hmt-body">' + chip + '<span class="hmt-sub">' + esc(format(TT.metrics, { n: inR, total: M.cards.length })) + '</span></span></button>';
  }
  // tile 2: HRV, a real baked value (no invented stress score); left out without a fresh reading
  function hrvTile() {
    var c = null;
    M.cards.forEach(function (x) { if (x && x.key === 'hrv') c = x; });
    if (!fresh(c)) return '';
    return '<div class="hmt hmt-hrv hm-tone-' + esc(c.tone || 'normal') + '"' + linkAttrs('hrv') + '>' + lbl(T.labels.hrv || 'HRV') +
      '<span class="hmt-body"><span class="hmt-val"><b>' + esc(num(c.value, c.dec)) + '</b><small>' + esc(T.units.hrv || '') + '</small></span>' +
      '<span class="hmt-status">' + esc(T.status[c.status] || '') + '</span>' +
      (daysOld(c.date) !== 0 && isoDate(c.date) ? '<span class="hmt-sub">' + esc(HC.fmtDate(c.date)) + '</span>' : '') + '</span></div><!--/hmt-->';
  }
  var tiles = document.getElementById('home-tiles');
  if (tiles && T.tile) {
    try {
      var t2 = hrvTile();
      tiles.innerHTML = '<div class="hm-tiles' + (t2 ? '' : ' hm-tiles-one') + '" role="group" aria-label="' + esc(T.tile.ariaLabel) + '">' + sumTile() + t2 + '</div>';
    } catch (e) {
      tiles.innerHTML = '';
    }
  }

  var age = daysOld(M.asOf);
  var stale = age != null && age > STALE_DAYS;
  host.innerHTML = '<div class="hm sc-card' + (stale ? ' sc-stale' : '') + '" role="group" aria-label="' + esc(T.ariaLabel) + '">' +
    '<div class="sc-head"><h3>' + esc(T.heading) + '</h3></div><div class="hm-grid">' +
    M.cards.map(safeCard).join('') + '</div><div class="sc-note">' + esc(T.note) + '</div></div>';
})();
