/* "Health monitor": the full list leads Salud (#monitor, components/HealthMonitor.astro, first in
 * tabs/Salud.astro) and two summary tiles sit near the top of Inicio (#home-tiles: the out-of-range
 * count + the HRV signal). The latest overnight signals (respiratory rate, resting HR, HRV, sleeping
 * wrist temperature, sleep duration) against the user's own normal range, rendered from
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
 *
 * Tile 2 is the stress monitor (SCORES.stress, lib/score/stress.mjs: a heart-rate-only estimate per
 * waking hour) when the day has a value, else the HRV signal.
 *
 * Day stepping (the top bar's "‹ TODAY ›", window.HCDay): on a PAST day the two Inicio tiles show that
 * day's summary (SCORES.days, lib/score/days.mjs: the cards fresh ON that day, scored with the inputs
 * cut at it) and that day's stress value or HRV card, which opens its sheet on that day. The Salud list stays the
 * latest. Today renders exactly as before.
 */
(function () {
  var host = document.getElementById('monitor');
  if (!host) return;
  var S = typeof SCORES === 'undefined' ? null : SCORES;
  var M = S && S.monitor;
  var T = typeof I18N_SCORE === 'undefined' || !I18N_SCORE ? null : I18N_SCORE.monitor;
  if (!M || !M.cards || !T) return;
  // the detail sheet's copy (baked before this script): a signal the device never wrote says so
  var TD = typeof I18N_DETAIL === 'undefined' || !I18N_DETAIL ? null : I18N_DETAIL;
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
  // `unrec`: the series has no reading at all (state 'none'): its device does not record it; a card
  // that failed to render stays a plain "No data"
  function emptyCard(key, unrec) {
    var word = unrec && TD && TD.unrecorded ? TD.unrecorded : T.status.none;
    return row(key, { cls: 'hm-none', value: '—', base: word, aria: word });
  }
  function card(c) {
    if (c.state !== 'ok') return emptyCard(c.key, c.state === 'none');
    var age = daysOld(c.date);
    var old = age != null && age > STALE_DAYS;
    var unit = T.units[c.key] || '';
    // hours (sleep) read as h:mm and carry no unit (docs/design-system.md → "Numbers")
    var hm = unit === 'h';
    if (hm) unit = '';
    var value = hm ? HC.hours(c.value) : num(c.value, c.dec);
    // the range is written one decimal finer than the value (max 2), so a value just past the edge
    // never reads as sitting on it (e.g. 15.1 vs "14.2–15.1" for a High); hours to the minute
    var rd = Math.min(c.dec + 1, 2);
    var bound = function (v) { return hm ? HC.hours(v) : num(v, rd); };
    var lo = c.band && !old ? bound(c.band.lo) : '', hi = c.band && !old ? bound(c.band.hi) : '';
    var range = c.band && !old ? format(T.rangeLbl, { lo: lo, hi: hi }) : '';
    var rangeAria = range ? format(T.rangeAria || T.rangeLbl, { lo: lo, hi: hi }) : '';
    var status = old ? T.status.stale : T.status[c.status] || '';
    // short date (no weekday), only when the reading is not last night's
    var when = daysOld(c.date) !== 0 && isoDate(c.date) ? HC.fmtDate(c.date, { weekday: false }) : '';
    // a row with a band: the range under the value (+ its date when it is not last night); without
    // one (building baseline / stale): the status word instead, no marker
    var base = range ? [range, when].filter(Boolean).join(' · ') : status;
    var marked = !!(range && ARROW[c.status]);
    return row(c.key, {
      cls: old ? 'hm-stale' : 'hm-tone-' + esc(c.tone || 'normal'), value: value, unit: unit, numCls: 'hm-num',
      arrow: marked ? ARROW[c.status] : null, tone: marked ? TONE[c.tone] || 'flat' : null, base: base,
      aria: [value + (unit ? ' ' + unit : ''), status, rangeAria, when].filter(Boolean).join(' · '),
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
  // THE carried-value rule (HC.carried, docs/design-system.md → Carried values): a tile whose value is
  // dated before the shown day (`day`, null = the viewer's today) is dimmed and names that date, short
  // (no weekday: a half-width tile)
  function carry(iso, day) {
    var c = HC.carried(iso, day, { weekday: false });
    c.html = c.carried ? '<span class="carried-date">' + esc(c.label) + '</span>' : '';
    return c;
  }
  function lbl(text) {
    return '<span class="hmt-lbl">' + esc(text) + '<span class="chev" aria-hidden="true">›</span></span>';
  }
  // tile 1: out-of-range count (teal check "within range" when none), "n/total metrics" in range; a
  // tap jumps to the full monitor grid (core.js jump: opens its fold / switches to its tab)
  // the status chip (Inicio's summary tile and the Salud list header): out-of-range count, teal check
  // "within range" when none, "building baseline" when the only fresh cards have no band yet, "no
  // data" when nothing is fresh; + the in-range count
  // `bld`: fresh cards still building their baseline (no band yet) are data too, never "no data"
  function counts() {
    var inR = 0, out = 0, bld = 0;
    M.cards.forEach(function (c) {
      if (!fresh(c)) return;
      if (c.status === 'normal') inR++;
      else if (c.status === 'high' || c.status === 'low') out++;
      else if (c.status === 'building') bld++;
    });
    return { inR: inR, out: out, bld: bld };
  }
  // bare: no check inside (the Inicio tile draws its status as a square icon beside the chip)
  function chip(n, bare) {
    var TT = T.tile;
    return n.out > 0 ? '<span class="hmt-chip hmt-out">' + esc(format(TT.out, { n: n.out })) + '</span>'
      : n.inR > 0 ? '<span class="hmt-chip hmt-in">' + (bare ? '' : CHECK) + esc(TT.inRange) + '</span>'
      : n.bld > 0 ? '<span class="hmt-chip hmt-none hmt-building">' + esc(T.status.building) + '</span>'
      : '<span class="hmt-chip hmt-none">' + esc(TT.none) + '</span>';
  }
  // tile 1: a square status icon (✓ teal: every fresh signal in range; ! orange: one or more out; none
  // without fresh data) left of the chip + "n/total metrics" in range; a tap jumps to the full monitor
  // list at the top of Salud (core.js jump: switches to the tab that holds #monitor and scrolls to it)
  // `asOf` = the newest night it counts (today only; a past day's summary is that day's): carried when
  // earlier than today, its date on a line of its own under the count (a ' · ' join wraps at 360 px)
  function sumTile(n, total, asOf) {
    var tone = n.out > 0 ? 'out' : n.inR > 0 ? 'in' : '';
    var sq = tone ? '<span class="hmt-sq hmt-' + tone + '" aria-hidden="true">' + (tone === 'in' ? CHECK : '!') + '</span>' : '';
    var c = carry(asOf, null);
    return '<button type="button" class="hmt hmt-sum' + c.cls + '" data-jump="monitor">' + lbl(T.heading) +
      '<span class="hmt-srow">' + sq + '<span class="hmt-body">' + chip(n, true) + '<span class="hmt-sub">' + esc(format(T.tile.metrics, { n: n.inR + n.out > 0 ? n.inR : n.bld || 0, total: total })) + '</span>' +
      (c.html ? '<span class="hmt-sub">' + c.html + '</span>' : '') + '</span></span></button>';
  }
  // the newest night among the fresh cards (what the summary counts), null without one
  function newestFresh() {
    var out = null;
    M.cards.forEach(function (c) { if (fresh(c) && isoDate(c.date) && (!out || c.date > out)) out = c.date; });
    return out;
  }
  // tile 2: the stress monitor (lib/score/stress.mjs, SCORES.stress: a heart-rate-only ESTIMATE per
  // waking hour) when the day has a value: the latest scored hour's value chip, its band word in the
  // band colour, the hour (+ the date when it is not today); it opens the stress page. `day` = the
  // past day shown (null = today: the newest day with a value, when <= STALE_DAYS old)
  function stressDay(day) {
    var St = S.stress, out = null;
    if (!St || !St.ok || !Array.isArray(St.days)) return null;
    St.days.forEach(function (x) {
      if (!x || !x.now || !isoDate(x.date)) return;
      if (day ? x.date === day : !out || x.date > out.date) out = x;
    });
    if (out && !day && !(daysOld(out.date) <= STALE_DAYS)) return null;
    return out;
  }
  function stressTile(d, day) {
    var ST = T.stress, n = d.now, band = ST.bands[n.band] ? n.band : 'low';
    var time = String(n.t).slice(0, 2) + ':00';
    var c = carry(d.date, day), old = c.carried;
    var when = old ? c.label + ' · ' + time : time;
    // an earlier day's reading opens the stress page ON that day (tile and sheet agree), never on an
    // empty today
    var opens = day || (old ? d.date : null);
    return '<div class="hmt hmt-stress hmt-sb-' + esc(band) + c.cls + '"' + (opens ? HC.detailAttrs('stress', opens) : linkAttrs('stress')) +
      ' aria-label="' + esc(format(ST.aria, { value: num(n.v, 1), band: ST.bands[band], time: when })) + '">' + lbl(ST.label) +
      '<span class="hmt-body"><span class="hmt-srow"><span class="hmt-sv">' + esc(num(n.v, 1)) + '</span>' +
      '<span class="hmt-band">' + esc(ST.bands[band]) + '</span></span>' +
      '<span class="hmt-sub">' + (old ? c.html + ' · ' : '') + esc(time) + '</span></span></div><!--/hmt-->';
  }
  function secondTile(day, hrv) {
    var d = T.stress ? stressDay(day) : null;
    return d ? stressTile(d, day) : hrvTile(hrv, day);
  }
  // HRV: a real baked value, the fallback of tile 2 without a stress value; left out without a fresh reading.
  // `day` = the past day shown (null = today): its date line and the sheet's opening day
  function hrvTile(c, day) {
    if (!c) return '';
    var k = carry(c.date, day);
    return '<div class="hmt hmt-hrv hm-tone-' + esc(c.tone || 'normal') + k.cls + '"' + (day ? HC.detailAttrs('hrv', day) : linkAttrs('hrv')) + '>' + lbl(T.labels.hrv || 'HRV') +
      '<span class="hmt-body"><span class="hmt-val"><b>' + esc(num(c.value, c.dec)) + '</b><small>' + esc(T.units.hrv || '') + '</small></span>' +
      '<span class="hmt-status">' + esc(T.status[c.status] || '') + '</span>' +
      (k.carried ? '<span class="hmt-sub">' + k.html + '</span>' : '') + '</span></div><!--/hmt-->';
  }
  function todayHrv() {
    var c = null;
    M.cards.forEach(function (x) { if (x && x.key === 'hrv') c = x; });
    return fresh(c) ? c : null;
  }
  // a past day's summary (SCORES.days): its in / out-of-range counts and HRV card; none = no data
  function pastEntry(day) {
    var H = S.days && S.days.days ? S.days.days : [], out = null;
    H.forEach(function (x) { if (x && x.date === day) out = x.monitor; });
    return out || { inR: 0, out: 0, total: M.cards.length, hrv: null };
  }
  var DAY = typeof HCDay !== 'undefined' && HCDay ? HCDay : null;
  var tiles = document.getElementById('home-tiles');
  function renderTiles() {
    var day = DAY && typeof DAY.sel === 'function' ? DAY.sel() || null : null;
    try {
      var p = day ? pastEntry(day) : null;
      var t2 = p ? secondTile(day, p.hrv) : secondTile(null, todayHrv());
      var t1 = p ? sumTile(p, p.total, null) : sumTile(counts(), M.cards.length, newestFresh());
      tiles.innerHTML = '<div class="hm-tiles' + (t2 ? '' : ' hm-tiles-one') + '" role="group" aria-label="' + esc(T.tile.ariaLabel) + '">' + t1 + t2 + '</div>';
    } catch (e) {
      tiles.innerHTML = '';
    }
  }
  if (tiles && T.tile) {
    renderTiles();
    if (DAY && typeof DAY.on === 'function') DAY.on(renderTiles);
  }

  var age = daysOld(M.asOf);
  var stale = age != null && age > STALE_DAYS;
  var head;
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
