/* Inicio "Today's activities" (honest version of a day-activities list): last night's sleep, the day's
 * workouts (modality, minutes, Relative Effort when the source recorded it) and, on the viewer's
 * today, the programmed session (window.HCProgram, client/training-today.js), rendered from
 * SCORES.timeline (lib/score/timeline.mjs, baked by components/Bake.astro) + I18N_SCORE.timeline.
 * Each row = a coloured chip (icon + value: hours asleep / minutes), the uppercase name, and the
 * details stacked on the right (bed / wake clock for sleep; RE and merged parts for a workout — the
 * extract has no workout start times; "programmed" for the plan row). Matching a programmed session
 * to a done workout is not done anywhere yet, so the plan row is only listed, never ticked.
 *
 * Classic script (is:inline, no module scope). The build bakes only the last few data days; the
 * VIEWER's today is picked here from Date.now(), so consecutive builds stay byte-identical. When
 * today has nothing yet, the newest earlier day is shown under its date with a "nothing logged yet
 * today" line; data older than STALE_DAYS is greyed. When the viewer's clock is EARLIER than every
 * baked day (clock / timezone skew), the newest baked day is shown under its date instead of the
 * empty state. A throw (even a missing LOCALE global) renders the card's fallback, never a blank
 * Inicio. A row opens the detail sheet on its day (sleep -> the sleep view, a workout -> its
 * modality's load view, "other" -> training time, the plan row -> the 'hoy-session' view), whatever
 * tabs page.hideTabs hides.
 *
 * Day stepping (the top bar's "‹ TODAY ›", window.HCDay): on a PAST day the card lists THAT day — its
 * night (DETAIL.metrics.sleep: hours asleep + bed / wake clock, dated the wake-up day) and its workouts
 * (DETAIL.sessions: one per date + modality after the SAME display rule as SCORES.timeline, minutes,
 * RE, parts) — under "Activities · <date>", never greyed, without the programmed row; every row opens
 * its sheet on that day. Nothing that day → "Nothing logged that day". Today renders as before.
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
  // 24-unit line icons (stroke = currentColor), inline so the page stays self-contained
  var ICON = {
    sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    gym: '<path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/>',
    run: '<circle cx="14" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2v5M6 12l3-4h4l3 4 3 1M11 15l-1-4"/>',
    bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2 7h-6M14 6h3"/>',
    other: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  };
  function icon(key) {
    return '<svg class="tl-ico" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[key] || ICON.other) + '</svg>';
  }
  // aria: an explicit label (the plan row: its focus can be longer than the ellipsised name)
  function row(cls, link, ico, chip, name, side, sideCls, aria) {
    return '<li class="tl-row ' + cls + '"' + link + (aria ? ' aria-label="' + esc(aria) + '"' : '') + '><span class="tl-chip">' + icon(ico) + '<b>' + esc(chip) + '</b></span>' +
      '<span class="tl-name">' + esc(name) + '</span>' +
      (side && side.length ? '<span class="tl-side' + (sideCls ? ' ' + sideCls : '') + '">' + side.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</span>' : '') +
      '</li>';
  }
  // decimal hours (sleep-daily.csv bed / wake) -> "23:07"; past-midnight values wrap
  function clock(h) {
    if (typeof h !== 'number' || !isFinite(h)) return null;
    var m = Math.round((((h % 24) + 24) % 24) * 60) % 1440;
    var H = Math.floor(m / 60), M = m % 60;
    return (H < 10 ? '0' : '') + H + ':' + (M < 10 ? '0' : '') + M;
  }
  function card(inner, stale) {
    return '<div class="sc-card tl' + (stale ? ' sc-stale' : '') + '" role="group" aria-label="' + esc(T.ariaLabel) + '">' + inner + '</div>';
  }
  // today's programmed session (client/training-today.js), only on the viewer's today
  function programRow(today) {
    var P = typeof window !== 'undefined' && window.HCProgram ? window.HCProgram : null;
    if (!P || P.date !== today) return '';
    var kind = String(P.kind || 'gym').replace(/[^a-z]/g, '');
    var focus = P.focus || '';
    return row('tl-prog tl-prog-' + kind, HC.detailAttrs('hoy-session'), kind, T.programmedChip, focus, [T.programmed], '',
      focus ? T.programmedChip + ': ' + focus + ' · ' + T.programmed : '');
  }

  // DETAIL dense series value on `iso` ({start, v}: one slot per day), else null
  function at(m, arr, iso) {
    if (!m || !isoDate(m.start) || !arr) return null;
    var i = Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(m.start + 'T00:00:00Z')) / HC.MS_PER_DAY);
    var v = i >= 0 && i < arr.length ? arr[i] : null;
    return typeof v === 'number' && isFinite(v) ? v : null;
  }
  // a past day in SCORES.timeline's day shape, from DETAIL (null when nothing was logged that day)
  var MODS = ['gym', 'run', 'bike', 'other'];
  function pastDay(iso) {
    var X = typeof DETAIL !== 'undefined' && DETAIL ? DETAIL : {};
    var sl = X.metrics && X.metrics.sleep;
    var hours = at(sl, sl && sl.v, iso);
    var items = [];
    (Array.isArray(X.sessions) ? X.sessions : []).forEach(function (x) {
      if (x && x.d === iso && MODS.indexOf(x.m) !== -1) items.push({ modality: x.m, dur: x.min, re: x.re == null ? null : x.re, sessions: x.n || 1 });
    });
    items.sort(function (a, b) { return MODS.indexOf(a.modality) - MODS.indexOf(b.modality); });
    if (hours == null && !items.length) return null;
    return { date: iso, sleep: hours, bed: at(sl, sl && sl.bed, iso), wake: at(sl, sl && sl.wake, iso), items: items };
  }
  function pastHtml(iso) {
    var day = pastDay(iso);
    var title = format(T.pastHeading, { date: HC.fmtDate(iso) });
    var note = !!(day && day.items.length && T.note);
    var out = ['<div class="sc-head"><h3>' + esc(title) + '</h3>' + (note ? HC.infoBtn('tl-info', format(T.infoLbl || '{section}', { section: title })) : '') + '</div>' +
      (note ? '<div class="hs-info" id="tl-info" hidden><p>' + esc(T.note) + '</p></div>' : '')];
    if (!day) out.push('<div class="sc-note">' + esc(T.noDay) + '</div>');
    else out.push('<ul class="tl-list">' + dayRows(day).join('') + '</ul>');
    return card(out.join(''), false);
  }
  // the night + the workouts of one day (SCORES.timeline day shape), each opening its sheet on that day
  function dayRows(day) {
    var list = [];
    var sleepLink = HC.detailAttrs('sleep', day.date);
    var times = [clock(day.bed), clock(day.wake)].filter(function (x) { return x; });
    list.push(day.sleep != null
      ? row('tl-sleep', sleepLink, 'sleep', format(T.sleepVal, { hours: num(day.sleep, 1) }), T.sleep, times.length === 2 ? times : [], 'tl-times')
      : row('tl-sleep tl-none', sleepLink, 'sleep', '—', T.noSleep, []));
    day.items.forEach(function (it) {
      var side = [];
      if (it.re != null) side.push(format(T.re, { n: num(it.re, 0) }));
      if (it.sessions > 1) side.push(format(T.parts, { n: it.sessions }));
      var mod = String(it.modality).replace(/[^a-z]/g, '');
      list.push(row('tl-' + mod, HC.detailAttrs(modDetail(mod), day.date), mod, format(T.minutes, { n: num(it.dur, 0) }), T.modalities[mod] || mod, side));
    });
    return list;
  }

  function html() {
    var past = DAY && typeof DAY.sel === 'function' ? DAY.sel() : null;
    if (past) return pastHtml(past);
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
    var plan = programRow(today);
    if (!day && !plan) return card('<div class="sc-head"><h3>' + esc(T.heading) + '</h3></div><div class="sc-note">' + esc(T.empty) + '</div>', false);
    var isToday = !day || day.date === today;
    // the same-day merge note: behind the header's ⓘ (client/health.js toggles [data-hs-info]), only
    // when the day lists workouts
    var title = isToday ? T.heading : format(T.dateHeading, { date: HC.fmtDate(day.date) });
    var note = !!(day && day.items.length && T.note);
    var out = ['<div class="sc-head"><h3>' + esc(title) + '</h3>' + (note ? HC.infoBtn('tl-info', format(T.infoLbl || '{section}', { section: title })) : '') + '</div>' +
      (note ? '<div class="hs-info" id="tl-info" hidden><p>' + esc(T.note) + '</p></div>' : '')];
    if (!isToday && !ahead) out.push('<div class="sc-note">' + esc(T.noToday) + '</div>');
    var list = day ? dayRows(day) : [];
    // the plan row belongs to the viewer's today: shown under today's heading only
    if (plan && isToday) list.push(plan);
    out.push('<ul class="tl-list">' + list.join('') + '</ul>');
    return card(out.join(''), !!day && daysOld(day.date) > HC.STALE_DAYS);
  }

  var DAY = typeof HCDay !== 'undefined' && HCDay ? HCDay : null;
  function paint() {
    try {
      if (typeof LOCALE === 'undefined') throw new Error('LOCALE is not baked');
      host.innerHTML = html();
    } catch (e) {
      host.innerHTML = '<div class="sc-card sc-card-error">' + esc((I18N_SCORE.recovery && I18N_SCORE.recovery.cardError) || '') + '</div>';
    }
  }
  paint();
  if (DAY && typeof DAY.on === 'function') DAY.on(paint);
})();
