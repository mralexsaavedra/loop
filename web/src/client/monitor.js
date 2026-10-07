/* "Health monitor": the full list leads Salud (#monitor, components/HealthMonitor.astro, first in
 * tabs/Salud.astro) and two summary tiles sit near the top of Inicio (#home-tiles: the out-of-range
 * count + the HRV signal). The latest overnight signals (respiratory rate, resting HR, HRV, sleeping
 * wrist temperature, sleep duration) against the owner's own normal range, rendered from
 * SCORES.monitor (lib/score/monitor.mjs, baked by components/Bake.astro) + I18N_SCORE.monitor.
 *
 * Classic script (is:inline, no module scope). Everything numeric is baked: the band comes from the
 * lib; this file only formats numbers and joins markup. The list = an uppercase label + a status chip
 * (in range / n out of range / no data) + one shared metric row per signal (HC.metricRow: icon · NAME
 * · value · ▲ above / ▼ below / • inside the range, the range itself as the small line under the
 * value); the explanation sits behind an ⓘ toggle (client/health.js wires every [data-hs-info]).
 * "Last night" vs an older date and the staleness grey are decided here from Date.now(), never
 * baked, so consecutive builds stay byte-identical. Colour follows the baked tone (good / bad /
 * watch / normal), never the raw direction: respiratory rate and wrist temp only ever reach
 * "watch". A row whose OWN date is more than STALE_DAYS old drops its tone, marker and status ("no
 * recent data"), whatever the other rows say. One row throwing never blanks the block: it falls back
 * to its empty state. A tap on any row opens its detail sheet (HC.detailAttrs -> client/detail.js).
 */
(function () {
  var host = document.getElementById('monitor');
  if (!host) return;
  var S = typeof SCORES === 'undefined' ? null : SCORES;
  var M = S && S.monitor;
  var T = typeof I18N_SCORE === 'undefined' || !I18N_SCORE ? null : I18N_SCORE.monitor;
  if (!M || !M.cards || !T) return;
  var STALE_DAYS = HC.STALE_DAYS; // a reading older than this is shown greyed, with no status (baked)

  // shared helpers (web/src/client/util.js)
  var esc = HC.esc, isoDate = HC.isoDate, daysOld = HC.daysOld, format = HC.format;
  function num(x, dec) {
    return HC.num(x, dec, false);
  }
  // every row opens its detail sheet (client/detail.js); the monitor keys are the detail metric keys
  function linkAttrs(key) {
    return HC.detailAttrs(key);
  }
  var ARROW = { high: 'up', low: 'down', normal: 'flat' };
  var TONE = { good: 'good', bad: 'bad', watch: 'watch' };
  function row(key, o) {
    var lbl = T.labels[key] || key;
    return HC.metricRow({ key: key, cls: 'hm-row ' + o.cls, attrs: ' data-hm="' + esc(key) + '"' + linkAttrs(key), aria: [lbl, o.aria].filter(Boolean).join(' · '),
      name: lbl, value: o.value, unit: o.unit, numCls: o.numCls, arrow: o.arrow, tone: o.tone, base: o.base });
  }
  function emptyCard(key) {
    return row(key, { cls: 'hm-none', value: '—', base: T.status.none, aria: T.status.none });
  }
  function card(c) {
    if (c.state !== 'ok') return emptyCard(c.key);
    var age = daysOld(c.date);
    var old = age != null && age > STALE_DAYS;
    var unit = T.units[c.key] || '';
    var value = num(c.value, c.dec);
    // the range is written one decimal finer than the value (max 2), so a value just past the edge
    // never reads as sitting on it (e.g. 15.1 vs "14.2–15.1" for a High)
    var rd = Math.min(c.dec + 1, 2);
    var range = c.band && !old ? T.rangeLbl.replace('{lo}', num(c.band.lo, rd)).replace('{hi}', num(c.band.hi, rd)) : '';
    var status = old ? T.status.stale : T.status[c.status] || '';
    var when = daysOld(c.date) !== 0 && isoDate(c.date) ? HC.fmtDate(c.date) : '';
    // a row with a band: the range under the value (+ its date when it is not last night); without
    // one (building baseline / stale): the status word instead, no marker
    var base = range ? [range, when].filter(Boolean).join(' · ') : status;
    var marked = !!(range && ARROW[c.status]);
    return row(c.key, {
      cls: old ? 'hm-stale' : 'hm-tone-' + esc(c.tone || 'normal'), value: value, unit: unit, numCls: 'hm-num',
      arrow: marked ? ARROW[c.status] : null, tone: marked ? TONE[c.tone] || 'flat' : null, base: base,
      aria: [value + (unit ? ' ' + unit : ''), status, range, when].filter(Boolean).join(' · '),
    });
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
  // the status chip (Inicio's summary tile and the Salud list header): out-of-range count, teal check
  // "within range" when none, "no data" when nothing is fresh; + the in-range count
  function counts() {
    var inR = 0, out = 0;
    M.cards.forEach(function (c) {
      if (!fresh(c)) return;
      if (c.status === 'normal') inR++;
      else if (c.status === 'high' || c.status === 'low') out++;
    });
    return { inR: inR, out: out };
  }
  function chip(n) {
    var TT = T.tile;
    return n.out > 0 ? '<span class="hmt-chip hmt-out">' + esc(format(TT.out, { n: n.out })) + '</span>'
      : n.inR > 0 ? '<span class="hmt-chip hmt-in">' + CHECK + esc(TT.inRange) + '</span>'
      : '<span class="hmt-chip hmt-none">' + esc(TT.none) + '</span>';
  }
  // tile 1: the chip + "n/total metrics" in range; a tap jumps to the full monitor list at the top of
  // Salud (core.js jump: switches to the tab that holds #monitor and scrolls to it)
  function sumTile() {
    var n = counts();
    return '<button type="button" class="hmt hmt-sum" onclick="jump(\'monitor\')">' + lbl(T.heading) +
      '<span class="hmt-body">' + chip(n) + '<span class="hmt-sub">' + esc(format(T.tile.metrics, { n: n.inR, total: M.cards.length })) + '</span></span></button>';
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
  var head = '';
  try {
    head = T.tile ? chip(counts()) : '';
  } catch (e) {
    head = '';
  }
  var info = T.note ? HC.infoBtn('hm-info', T.info || T.heading) : '';
  host.innerHTML = '<div class="hm hs-sec' + (stale ? ' sc-stale' : '') + '" role="group" aria-label="' + esc(T.ariaLabel) + '">' +
    '<div class="hs-head"><h3 class="hs-lbl">' + esc(T.heading) + '</h3>' + head + info + '</div>' +
    (info ? '<div class="hs-info" id="hm-info" hidden><p>' + esc(T.note) + '</p></div>' : '') +
    '<ul class="db-list hm-list">' + M.cards.map(safeCard).join('') + '</ul></div>';
})();
