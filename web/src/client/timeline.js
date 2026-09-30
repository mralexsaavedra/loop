/* Inicio "today" timeline (Whoop's day-activities list, honest version): last night's sleep, then
 * the day's workouts (modality, minutes, Relative Effort when the source recorded it), rendered from
 * SCORES.timeline (lib/score/timeline.mjs, baked by components/Bake.astro) + I18N_SCORE.timeline.
 *
 * Classic script (is:inline, no module scope). The build bakes only the last few data days; the
 * VIEWER's today is picked here from Date.now(), so consecutive builds stay byte-identical. When
 * today has nothing yet, the newest earlier day is shown under its date with a "nothing logged yet
 * today" line; data older than STALE_DAYS is greyed. When the viewer's clock is EARLIER than every
 * baked day (clock / timezone skew), the newest baked day is shown under its date instead of the
 * empty state. A throw (even a missing LOCALE global) renders the card's fallback, never a blank
 * Inicio. A row opens the detail sheet on its day (sleep -> the sleep view, a workout -> its
 * modality's load view, "other" -> training time), whatever tabs page.hideTabs hides.
 */
(function () {
  var host = document.getElementById('timeline');
  if (!host) return;
  var S = typeof SCORES === 'undefined' ? null : SCORES;
  var TL = S && S.timeline;
  var T = typeof I18N_SCORE === 'undefined' || !I18N_SCORE ? null : I18N_SCORE.timeline;
  if (!TL || !T) return;
  // shared helpers (web/src/client/util.js); HC.num reads LOCALE at call time, inside the try below
  var esc = HC.esc, format = HC.format, num = HC.num, isoDate = HC.isoDate, todayIso = HC.todayIso, daysOld = HC.daysOld;
  // a row opens the detail sheet on its day (client/detail.js): sleep -> the sleep view, a scored
  // modality -> its load view, anything else -> training time
  function modDetail(mod) {
    return mod === 'gym' || mod === 'run' || mod === 'bike' ? 'load-' + mod : 'workouts';
  }
  function row(cls, link, lbl, val) {
    return '<li class="tl-row ' + cls + '"' + link + '><span class="tl-dot" aria-hidden="true"></span><span class="tl-lbl">' + esc(lbl) + '</span>' +
      (val ? '<span class="tl-val">' + esc(val) + '</span>' : '') + '</li>';
  }
  function card(inner, stale) {
    return '<div class="sc-card tl' + (stale ? ' sc-stale' : '') + '" role="group" aria-label="' + esc(T.ariaLabel) + '">' + inner + '</div>';
  }

  function html() {
    var today = todayIso();
    var day = null, newest = null;
    (TL.days || []).forEach(function (d) {
      if (!isoDate(d.date)) return;
      if (!newest || d.date > newest.date) newest = d;
      if (d.date <= today && (!day || d.date > day.date)) day = d;
    });
    // clock skew: every baked day is after the viewer's today -> the newest one, under its date
    var ahead = !day && !!newest;
    if (ahead) day = newest;
    if (!day) return card('<div class="sc-head"><h3>' + esc(T.heading) + '</h3></div><div class="sc-note">' + esc(T.empty) + '</div>', false);
    var isToday = day.date === today;
    var out = ['<div class="sc-head"><h3>' + esc(isToday ? T.heading : format(T.dateHeading, { date: day.date })) + '</h3></div>'];
    if (!isToday && !ahead) out.push('<div class="sc-note">' + esc(T.noToday) + '</div>');
    var list = [];
    var sleepLink = HC.detailAttrs('sleep', day.date);
    list.push(day.sleep != null
      ? row('tl-sleep', sleepLink, T.sleep, format(T.sleepVal, { hours: num(day.sleep, 1) }))
      : row('tl-sleep tl-none', sleepLink, T.noSleep, ''));
    day.items.forEach(function (it) {
      var parts = [format(T.minutes, { n: num(it.dur, 0) })];
      if (it.re != null) parts.push(format(T.re, { n: num(it.re, 0) }));
      if (it.sessions > 1) parts.push(format(T.parts, { n: it.sessions }));
      var mod = String(it.modality).replace(/[^a-z]/g, '');
      list.push(row('tl-' + mod, HC.detailAttrs(modDetail(mod), day.date), T.modalities[mod] || mod, parts.join(' · ')));
    });
    out.push('<ul class="tl-list">' + list.join('') + '</ul>');
    if (day.items.length) out.push('<div class="sc-note">' + esc(T.note) + '</div>');
    return card(out.join(''), daysOld(day.date) > HC.STALE_DAYS);
  }

  try {
    if (typeof LOCALE === 'undefined') throw new Error('LOCALE is not baked');
    host.innerHTML = html();
  } catch (e) {
    host.innerHTML = '<div class="sc-card sc-card-error">' + esc((I18N_SCORE.recovery && I18N_SCORE.recovery.cardError) || '') + '</div>';
  }
})();
