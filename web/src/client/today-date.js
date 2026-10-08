/* Top bar "‹ TODAY ›" pill + Inicio's day stepping (window.HCDay). Classic script (is:inline), run
 * right after core.js, so every Inicio renderer (score.js, monitor.js, timeline.js, nutri-day.js,
 * home-week.js) can read the selected day at its first render and subscribe to changes.
 *
 * The date line: the viewer's local today ("mar 30 sept" / "Tue 30 Sep") written with the one date
 * formatter (HC.fmtDate, util.js) into the <time> inside the pill, decided here from Date.now(), never
 * baked, so consecutive builds stay byte-identical.
 *
 * Day stepping: "‹" steps back one day, "›" forward; "›" is disabled on the viewer's today, "‹" at the
 * oldest reachable day = the baked history's first day (SCORES.days.from, lib/score/days.mjs), never
 * more than NAV.day.maxDays before today. With no history in reach (no data, or data far behind the
 * clock) both chevrons stay hidden: no dead control. A past day shows its date as the pill's label
 * (uppercase in CSS) and the label becomes "back to today". The day lives in the hash as
 * #d=YYYY-MM-DD (lib/nav/tabs.mjs DAY_HASH; core.js shows Inicio for it and keeps it), replaced —
 * never pushed — and only while Inicio is shown and the detail sheet is closed; today writes #home.
 * Keyboard: ← / → while focus is inside the pill. HCDay.on(fn) listeners get the selected day (null
 * = today), each in its own try/catch. */
(function () {
  var el = document.getElementById('today-date');
  if (!el) return;
  var DAY = (typeof NAV !== 'undefined' && NAV && NAV.day) || { prefix: 'd=', tab: 'home', maxDays: 30 };
  var HIST = typeof SCORES !== 'undefined' && SCORES && SCORES.days && HC.isoDate(SCORES.days.from) ? SCORES.days : null;
  var DAY_RE = new RegExp('^#' + DAY.prefix + '(\\d{4}-\\d{2}-\\d{2})$');
  var pill = document.getElementById('date-pill');
  var prev = document.getElementById('day-prev');
  var next = document.getElementById('day-next');
  var lbl = document.getElementById('day-lbl');
  var word = document.getElementById('day-word');
  var todayWord = word ? word.textContent : '';
  var sel = null;
  var subs = [];

  function today() {
    return HC.todayIso();
  }
  // the oldest day "‹" reaches, or null when no baked day is in reach
  function oldest() {
    if (!HIST) return null;
    var t = today(), yest = HC.shiftIso(t, -1), cap = HC.shiftIso(t, -DAY.maxDays);
    var lo = HIST.from > cap ? HIST.from : cap;
    return lo > yest || HIST.to < lo ? null : lo;
  }
  // iso -> the past day it names (null = today), or undefined when it is out of reach
  function normal(iso) {
    if (iso == null || iso === today()) return null;
    var d = HC.isoDate(iso), lo = oldest();
    return d && lo && d >= lo && d < today() ? d : undefined;
  }
  // '#d=2026-09-24' -> '2026-09-24' (a real calendar day only), else null
  function parse(hash) {
    var m = DAY_RE.exec(String(hash || ''));
    return m && HC.isoDate(m[1]) && HC.shiftIso(m[1], 0) === m[1] ? m[1] : null;
  }
  function readHash() {
    try {
      return (typeof location !== 'undefined' && location && location.hash) || '';
    } catch (e) {
      return '';
    }
  }
  function writeHash(h) {
    var sheet = document.getElementById('detail');
    if (sheet && !sheet.hidden) return;
    if (typeof currentTab === 'function' && currentTab() !== DAY.tab) return;
    if (readHash() === h) return;
    try {
      history.replaceState(null, '', location.pathname + location.search + h);
    } catch (e) { /* a frame that refuses history writes: the day still changes */ }
  }

  function paint() {
    var iso = sel || today();
    el.textContent = HC.fmtDate(iso);
    el.setAttribute('datetime', iso);
    if (word) word.textContent = sel ? HC.fmtDate(sel) : todayWord;
    var lo = oldest();
    [prev, next].forEach(function (b) { if (b) b.hidden = !lo; });
    if (pill && pill.classList) pill.classList.toggle('has-steps', !!lo);
    if (prev) prev.disabled = !lo || iso <= lo;
    if (next) next.disabled = !sel;
    if (lbl) {
      if (sel) {
        lbl.removeAttribute('aria-disabled');
        lbl.setAttribute('aria-label', HC.fmtDate(sel) + ' · ' + (lbl.getAttribute('data-back') || ''));
      } else {
        lbl.setAttribute('aria-disabled', 'true');
        lbl.removeAttribute('aria-label');
      }
    }
  }
  // opts.hash === false: the change came from the URL (do not write it back)
  function set(iso, opts) {
    var d = normal(iso);
    if (d === undefined) return false;
    if (d === sel) return true;
    sel = d;
    paint();
    if (!opts || opts.hash !== false) writeHash(sel ? '#' + DAY.prefix + sel : '#' + DAY.tab);
    subs.forEach(function (fn) {
      try { fn(sel); } catch (e) { /* one renderer never stops the others */ }
    });
    return true;
  }
  function step(n) {
    var iso = HC.shiftIso(sel || today(), n);
    var lo = oldest();
    if (!lo || iso < lo) return false;
    return set(iso >= today() ? null : iso);
  }

  // first paint: a #d= hash in reach opens on that day; one out of reach falls back to today and the
  // URL names Inicio instead
  var first = readHash();
  var asked = parse(first) ? normal(parse(first)) : null;
  if (asked) sel = asked;
  else if (first.indexOf('#' + DAY.prefix) === 0) writeHash('#' + DAY.tab);
  paint();

  if (prev && prev.addEventListener) prev.addEventListener('click', function () { step(-1); });
  if (next && next.addEventListener) next.addEventListener('click', function () { step(1); });
  if (lbl && lbl.addEventListener) lbl.addEventListener('click', function () { set(null); });
  if (pill && pill.addEventListener) {
    pill.addEventListener('keydown', function (e) {
      var n = e && e.key === 'ArrowLeft' ? -1 : e && e.key === 'ArrowRight' ? 1 : 0;
      if (!n || !oldest()) return;
      if (e.preventDefault) e.preventDefault();
      step(n);
      var a = document.activeElement;
      if (a && a.disabled && lbl && typeof lbl.focus === 'function') lbl.focus();
    });
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('hashchange', function () {
      var h = readHash();
      var d = parse(h);
      if (d) set(d, { hash: false });
      else if (h === '#' + DAY.tab) set(null, { hash: false });
    });
  }

  window.HCDay = {
    sel: function () { return sel; },
    iso: function () { return sel || today(); },
    oldest: oldest,
    set: set,
    step: step,
    hash: function () { return sel ? '#' + DAY.prefix + sel : ''; },
    on: function (fn) { if (typeof fn === 'function') subs.push(fn); },
  };
})();
