/* Inicio "Energy bank" card (#home-energy, in "My day" under the outlook bar): OUR intraday 0-100
 * estimate (SCORES.energy, lib/score/energy.mjs: it starts at wake at the morning's recovery %, drains
 * per awake hour by a baseline, the stress estimate and the heart-rate load, recharges in calm hours).
 * Nothing is scored here: the level, the start, the low and the hourly levels are baked; this lays
 * out the latest level big, a compact curve from wake to the latest hour, "estimate", and the start.
 * Colour by level: high >= 67, middle 34-66, low < 34 (the recovery dial's thirds).
 *
 * Day stepping (window.HCDay): a PAST day shows that day's bake and opens the page on it; a day
 * without a value (no recovery %, no wake time) hides the card, as does a newest valued day more than
 * STALE_DAYS old on today. Classic script (is:inline); a tap opens the energy page (client/detail.js
 * + deepdive.js energyPage, key 'energy-bank').
 */
(function () {
  var host = document.getElementById('home-energy');
  var S = typeof SCORES !== 'undefined' && SCORES ? SCORES.energy : null;
  var T = typeof I18N_SCORE !== 'undefined' && I18N_SCORE && I18N_SCORE.home ? I18N_SCORE.home.energy : null;
  if (!host || !T) return;
  var esc = HC.esc, format = HC.format, isoDate = HC.isoDate;
  var DAY = typeof HCDay !== 'undefined' && HCDay ? HCDay : null;

  function band(lv) {
    return lv >= 67 ? 'hi' : lv >= 34 ? 'mid' : 'lo';
  }
  function clock(h) {
    return (h < 10 ? '0' : '') + h + ':00';
  }
  function wakeDec(w) {
    var m = /^(\d{2}):(\d{2})$/.exec(String(w || ''));
    return m ? +m[1] + m[2] / 60 : null;
  }
  // the day shown: `sel` (a past day) or the newest day with a value, when <= STALE_DAYS old
  function dayOf(sel) {
    if (!S || !S.ok || !Array.isArray(S.days)) return null;
    var out = null;
    S.days.forEach(function (x) {
      if (!x || !x.now || !isoDate(x.date)) return;
      if (sel ? x.date === sel : !out || x.date > out.date) out = x;
    });
    if (out && !sel && !(HC.daysOld(out.date) <= HC.STALE_DAYS)) return null;
    return out;
  }
  // wake -> latest hour, 0-100 up: the line + a soft area under it (viewBox units, stretched to fit)
  var W = 200, H = 60;
  function curve(d) {
    var w0 = wakeDec(d.wake), hrs = d.hours || [];
    if (w0 == null) return '';
    var x1 = Math.max(w0 + 1, hrs.length ? hrs[hrs.length - 1].h + 1 : w0 + 1);
    var x = function (t) { return ((W * (t - w0)) / (x1 - w0)).toFixed(1); };
    var y = function (v) { return (H - (H * Math.max(0, Math.min(100, v))) / 100).toFixed(1); };
    var line = 'M' + x(w0) + ' ' + y(d.start);
    hrs.forEach(function (p) { line += ' L' + x(p.h + 1) + ' ' + y(p.lv); });
    var last = hrs.length ? x(hrs[hrs.length - 1].h + 1) : x(w0);
    return '<svg class="en-sp" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="en-a" d="' + line + ' L' + last + ' ' + H + ' L' + x(w0) + ' ' + H + ' Z"/><path class="en-l" d="' + line + '"/></svg>';
  }
  // THE carried-value rule (HC.carried, docs/design-system.md → Carried values): a level from before
  // the shown day is dimmed, names its date (short: the narrow column beside the curve) and opens the
  // page ON that day, like the stress tile
  function cardHtml(d, sel) {
    var lv = d.now.lv, time = d.now.h != null ? clock(d.now.h) : d.wake;
    var c = HC.carried(d.date, sel, { weekday: false });
    var when = c.carried ? c.label + ' · ' + time : time;
    var opens = sel || (c.carried ? d.date : null);
    return '<div class="sc-card tn en de-' + band(lv) + c.cls + '"' + (opens ? HC.detailAttrs('energy-bank', opens) : HC.detailAttrs('energy-bank')) +
      ' aria-label="' + esc(format(T.aria, { value: lv, time: when })) + '">' +
      '<h3 class="tn-h">' + esc(T.heading) + ' <small class="tn-lbl">' + esc(T.estimate) + '</small></h3>' +
      '<div class="tn-row"><div class="tn-end"><span class="tn-time"><b class="en-num">' + esc(String(lv)) + '</b></span>' +
      '<span class="tn-lbl">' + (c.carried ? '<span class="carried-date">' + esc(c.label) + '</span> · ' : '') + esc(time) + '</span></div>' + curve(d) + '</div>' +
      '<p class="tn-lbl en-sub">' + esc(format(T.from, { start: d.start, wake: d.wake, min: d.min.lv })) + '</p></div>';
  }
  function render() {
    var sel = DAY && typeof DAY.sel === 'function' ? DAY.sel() || null : null;
    var d = null;
    try {
      d = dayOf(sel);
      host.innerHTML = d ? cardHtml(d, sel) : '';
    } catch (e) {
      d = null;
      host.innerHTML = '';
    }
    host.hidden = !d;
  }
  render();
  if (DAY && typeof DAY.on === 'function') DAY.on(render);
})();
