/* Shared client helpers for the classic (is:inline) scripts: escaping, templates, the viewer's local
 * calendar and locale-aware number / duration formatting. layouts/Plan.astro inlines this FIRST, right
 * after `var HC_CONST` (baked from lib/stale.mjs), so every later script reads the global `HC`
 * (window.HC) instead of redefining these. Constants come from HC_CONST, never client literals.
 *
 * Dates: every "today" is the VIEWER's local calendar day from Date.now() (never baked), so
 * consecutive builds stay byte-identical. Numbers: LOCALE is read at call time ("es" = decimal comma).
 * Display dates: fmtDate / fmtMonth are the ONE date formatter ("lun 29 sept" / "Mon 29 Sep"), names
 * from I18N_DATE (web/src/i18n/date-templates.mjs, baked next to HC_CONST), read at call time.
 */
var HC = (function () {
  var MS_PER_DAY = 86400000;
  var C = typeof HC_CONST !== 'undefined' && HC_CONST ? HC_CONST : {};
  var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isEs() {
    return typeof LOCALE !== 'undefined' && LOCALE === 'es';
  }
  // the LAN services (food / journal / sync APIs, status.json, device manuals) answer only when the page is
  // served over http(s); opened from a file (file://) every LAN fetch is skipped, so the page degrades
  // exactly as when they are down, with no console errors. Read at call time; no location = served.
  function lan() {
    var loc = typeof location !== 'undefined' && location ? location
      : typeof window !== 'undefined' && window && window.location ? window.location : null;
    return !loc || loc.protocol !== 'file:';
  }
  // markup-safe text AND attribute value (quotes too); an absent value (null / undefined) is ''
  function esc(s) {
    return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // "{key}" placeholders; a missing value renders as empty, never "undefined"
  function format(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) {
      return vars && vars[k] != null ? vars[k] : '';
    });
  }
  // The ONE fetch wrapper of the LAN JSON APIs (food-core.js: /api/food + X-HC-Food, journal.js:
  // /api/journal + X-HC-Journal — each API requires its own header, the CSRF guard of services/loop-ingest).
  // Returns api(method, path, body?) -> a promise of the JSON body of a 2xx ({} when it has none); it
  // rejects {code, field, status}: the server's coarse error code (else 'generic'), or 'offline' with
  // status 0 when there is no answer, it timed out (timeoutMs) or the page runs from a file (lan()).
  function jsonApi(base, header, timeoutMs) {
    return function (method, path, body) {
      var headers = {};
      headers[header] = '1';
      var init = { method: method, headers: headers, cache: 'no-store', credentials: 'same-origin' };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      if (!lan()) return Promise.reject({ code: 'offline', status: 0 });
      // the body is read inside the timeout: a service that sends its headers and then stalls is offline too
      return fetchTimeout(base + path, init, timeoutMs, function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      }).then(function (r) {
        if (r.ok) return r.data || {};
        throw { code: (r.data && typeof r.data.error === 'string' && r.data.error) || 'generic', field: r.data && r.data.field, status: r.status };
      }, function () {
        throw { code: 'offline', status: 0 };
      });
    };
  }
  // The ONE timed fetch (jsonApi above, client/freshness.js, client/profile.js): fetch(url, init) that rejects
  // with {name: 'TimeoutError'} once `ms` pass without an answer, aborting the request (AbortController,
  // when the browser has it). `read(res)` (optional) reads the body INSIDE the same timeout and its result
  // is what resolves, so a stalled body is covered too. The caller's init is copied, never mutated; a
  // caller's init.signal is combined with the timeout's (AbortSignal.any, else relayed by hand), and its
  // abort rejects at once with an AbortError. A hung LAN service never leaves a control busy.
  function fetchTimeout(url, init, ms, read) {
    var opts = {}, k, src = init || {};
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) opts[k] = src[k];
    var caller = src.signal || null;
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctl) {
      var hasAny = typeof AbortSignal !== 'undefined' && AbortSignal && typeof AbortSignal.any === 'function';
      opts.signal = caller && hasAny ? AbortSignal.any([caller, ctl.signal]) : ctl.signal;
    }
    return new Promise(function (resolve, reject) {
      var settled = false, timer = null;
      var onAbort = function () {
        if (ctl) ctl.abort();
        finish(reject, { name: 'AbortError' });
      };
      var finish = function (fn, v) {
        if (settled) return;
        settled = true;
        if (typeof clearTimeout === 'function') clearTimeout(timer);
        if (caller && typeof caller.removeEventListener === 'function') caller.removeEventListener('abort', onAbort);
        fn(v);
      };
      timer = setTimeout(function () {
        if (ctl) ctl.abort();
        finish(reject, { name: 'TimeoutError' });
      }, ms);
      if (caller) {
        if (caller.aborted) onAbort();
        else if (typeof caller.addEventListener === 'function') caller.addEventListener('abort', onAbort);
      }
      if (settled) return;
      try {
        fetch(url, opts).then(function (r) { return read ? read(r) : r; })
          .then(function (v) { finish(resolve, v); }, function (e) { finish(reject, e); });
      } catch (e) {
        finish(reject, e);
      }
    });
  }
  // fetchTimeout + the JSON body of a 2xx answer (null for any other answer), the body read inside the
  // timeout (client/freshness.js: the status and sync replies)
  function fetchJson(url, init, ms) {
    return fetchTimeout(url, init, ms, function (r) { return r && r.ok ? r.json() : null; });
  }
  // baked dates are interpolated into markup: accept only a real ISO date (the shape AND a calendar
  // round trip, so 2026-02-31 is rejected), anything else is absent
  function isoDate(s) {
    return typeof s === 'string' && ISO_RE.test(s) && isoOf(parseIso(s)) === s ? s : null;
  }
  function isoOf(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseIso(s) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function todayIso() {
    return isoOf(new Date(Date.now()));
  }
  function shiftIso(s, n) {
    var d = parseIso(s);
    d.setDate(d.getDate() + n);
    return isoOf(d);
  }
  // whole years between an ISO birthdate and an ISO day; null when either is not a date or birth > day
  // (the profile sheet's age and Salud's chronological age next to the fitness age)
  function ageOn(birth, day) {
    birth = isoDate(birth);
    day = isoDate(day);
    if (!birth || !day || birth > day) return null;
    var age = +day.slice(0, 4) - +birth.slice(0, 4);
    if (day.slice(5) < birth.slice(5)) age--;
    return age;
  }
  // whole days between an ISO date and the viewer's today (negative = ahead of the clock); null if not ISO
  function daysOld(iso) {
    iso = isoDate(iso);
    if (!iso) return null;
    return Math.round((parseIso(todayIso()) - parseIso(iso)) / MS_PER_DAY);
  }
  // Numbers: the ONE formatter is HC_FMT (lib/format/numbers.mjs, inlined before this script); these
  // wrappers only add the page LOCALE. Grouping for every value >= 1000 ("2.500" / "2,500"), percent
  // without a space ("97%"), durations as h:mm ("7:01"), absent values as "—".
  function loc() {
    return isEs() ? 'es' : 'en';
  }
  // the decimals the value carries ("1,25"), grouped
  function nf(n) {
    return HC_FMT.fmtRaw(n, loc());
  }
  // fixed decimals, optional leading "+"; a value that rounds to zero carries no sign
  function num(x, dec, signed) {
    return HC_FMT.fmtNumber(x, dec, loc(), signed);
  }
  // a whole number, grouped ("13.463")
  function int(x, signed) {
    return HC_FMT.fmtInt(x, loc(), signed);
  }
  // "97%"
  function pct(x, signed, dec) {
    return HC_FMT.fmtPercent(x, loc(), signed, dec);
  }
  // decimal hours -> "7:30"
  function hours(h, signed) {
    return HC_FMT.fmtHours(h, signed);
  }
  // an input field's value: decimal comma in es, NEVER grouped (the field parses it back); `dec`
  // fixed decimals or (omitted) the decimals the value carries
  function numInput(x, dec) {
    return HC_FMT.fmtPlain(x, dec, loc());
  }
  function dateNames() {
    return typeof I18N_DATE !== 'undefined' && I18N_DATE ? I18N_DATE : null;
  }
  // Monday = 0 … Sunday = 6
  function weekdayIndex(iso) {
    return (parseIso(iso).getDay() + 6) % 7;
  }
  // "lun 29 sept" / "Mon 29 Sep" (opts.weekday === false drops the weekday); '' for a non-ISO value,
  // the ISO date itself when the names are not baked
  function fmtDate(iso, opts) {
    iso = isoDate(iso);
    if (!iso) return '';
    var N = dateNames();
    if (!N) return iso;
    var d = parseIso(iso);
    var tpl = opts && opts.weekday === false ? N.dayNoWeekdayTpl : N.dayTpl;
    return format(tpl, { weekday: N.weekdays[weekdayIndex(iso)], day: d.getDate(), month: N.months[d.getMonth()] });
  }
  // THE carried-value rule (docs/design-system.md → Carried values): a display that stands for a day
  // (the viewer's today, or the stepped-to day `shownDay`) but shows a value dated EARLIER (`asOf`) is
  // "carried": it names that date (`label`, fmtDate; opts.weekday === false for a 360 px ring) and is
  // dimmed (`cls` = ' carried'). A value of the shown day itself is normal. `opts.stale` (the stronger
  // > STALE_DAYS grey, which the caller already applies) keeps the date but drops the dim class.
  function carried(asOf, shownDay, opts) {
    var a = isoDate(asOf), day = isoDate(shownDay) || todayIso();
    var c = !!a && a < day;
    return {
      carried: c,
      label: c ? fmtDate(a, opts && opts.weekday === false ? { weekday: false } : null) : '',
      cls: c && !(opts && opts.stale) ? ' carried' : '',
    };
  }
  // "septiembre 2026" / "September 2026"; "YYYY-MM" when the names are not baked
  function fmtMonth(iso) {
    iso = isoDate(iso);
    if (!iso) return '';
    var N = dateNames();
    if (!N) return iso.slice(0, 7);
    var d = parseIso(iso);
    return format(N.monthTpl, { month: N.monthsLong[d.getMonth()], year: d.getFullYear() });
  }
  // The ONE opener markup of the detail sheet (client/detail.js listens for [data-detail] clicks and
  // Enter / Space): data-detail="<metric>" [data-date="<iso>"] plus a button role and a tab stop;
  // opts.plain = only the data attributes (a real <button>, or a mouse-only target such as an SVG
  // calendar cell or a table row whose keyboard path is another opener). '' when the sheet is not baked.
  function detailAttrs(key, date, opts) {
    if (typeof DETAIL === 'undefined') return '';
    var d = isoDate(date);
    var out = ' data-detail="' + esc(key) + '"' + (d ? ' data-date="' + d + '"' : '');
    return opts && opts.plain ? out : out + ' role="button" tabindex="0" aria-haspopup="dialog"';
  }
  // midnight rollover: a page left open (a phone tab woken the next morning) shows the day it loaded on
  // (dials, top-bar date, timeline, day type, rings are computed once). 'reload' when the viewer's day
  // differs from the load day and the page is visible; 'defer' while the page is busy (the caller
  // decides: an open detail sheet, an open product / recipe editor, a focused field — anything a reload
  // would lose); 'none' otherwise (same day, hidden page, no usable dates).
  function rolloverAction(loadDay, today, busy, hidden) {
    if (hidden || !isoDate(loadDay) || !isoDate(today) || loadDay === today) return 'none';
    return busy ? 'defer' : 'reload';
  }
  // minutes -> "1:45" / "0:45" (h:mm, the one duration format; the old `units` argument is ignored)
  function duration(min) {
    return HC_FMT.fmtMinutes(min);
  }

  // The ONE metric-row markup (Inicio "My dashboard", the Salud monitor and metric rows, Entreno's run /
  // ride rows, Nutrición's Balance):
  // icon · UPPERCASE name · value (+ small unit) and a ▲ / ▼ / • marker on the right, a small line
  // (the baseline, a range or a status word) under the value. Styles: .db-* in styles/score.css.
  // Line icons on a 24-unit grid, stroke only (currentColor via .db-ico); unknown key -> the HRV line.
  var ICONS = {
    rhr: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    hrv: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    weight: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9.5a4 4 0 0 1 6 0L12.5 12"/>',
    steps: '<path d="M8 3c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5zM6 15h4v2a2 2 0 0 1-4 0zM16 7c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5z"/>',
    vo2max: '<path d="M4 16a8 8 0 0 1 16 0M12 16l4-5"/>',
    fitnessAge: '<path d="M7 3h10M7 21h10M8 3c0 4 4 5 4 9s-4 5-4 9M16 3c0 4-4 5-4 9s4 5 4 9"/>',
    walkingHr: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6 3 3v3M8 11l2-3h3l2 4 3 1"/>',
    exercise: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    respiratory: '<path d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3"/>',
    wristTemp: '<path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z"/>',
    bodyfat: '<circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="M18 6L6 18"/>',
    lean: '<path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/>',
    waist: '<path d="M4 8h16v8H4zM8 8v3M12 8v4M16 8v3"/>',
    distance: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
    flights: '<path d="M4 20h5v-5h5v-5h5V5"/>',
    energy: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-3-2 2-3 4-3 7a6 6 0 0 0 6 6z"/>',
    gym: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
    run: '<circle cx="14" cy="4.5" r="1.8"/><path d="M6 21l3.5-5 3 2 1-5 3 3h3M8 10l3-3h3l-1.5 6"/>',
    bike: '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-7h5l3 7M10 9l2 7h-6M13 5h3"/>',
    food: '<path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2 1.5-3 4-3 8h3"/>',
    balance: '<path d="M12 4v16M8 20h8M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>',
  };
  // one icon set: a key missing here falls back to the contributor rows' paths (CONTRIB_ICONS: bed, wake,
  // vsTarget, cons, eff, stages …), then to the HRV line
  function metricIcon(key) {
    var own = Object.prototype.hasOwnProperty;
    return '<svg class="db-ico" viewBox="0 0 24 24" aria-hidden="true">' + (own.call(ICONS, key) ? ICONS[key]
      : own.call(CONTRIB_ICONS, key) ? '<path d="' + CONTRIB_ICONS[key] + '"/>' : ICONS.hrv) + '</svg>';
  }
  // the ONE trend glyph (docs/design-system.md → Components → Trend glyph): ▲ / ▼ for a change, • for
  // typical / steady; the tone class colours it — good / bad / watch by the metric's direction,
  // `neutral` (--ink) for a change with no good direction, `flat` (grey) ONLY for the • (no grey arrow)
  var ARROWS = { up: '▲', down: '▼', flat: '•' };
  function trendTone(arrow, tone) {
    if (arrow === 'flat') return 'flat';
    return !tone || tone === 'flat' || tone === 'normal' ? 'neutral' : tone;
  }
  // o = {key, cls?, attrs?, aria?, name, value, unit?, numCls?, arrow? ('up' | 'down' | 'flat'),
  //      tone? ('good' | 'bad' | 'watch' | 'flat'), base?, base2?} — every text is escaped here; the
  //      secondary lines sit under the value: `base`, then an optional second one `base2` (a ride's
  //      HR · effort · kJ; docs/design-system.md → Metric row)
  //      An opener row (attrs with role="button", detailAttrs) keeps its <li> a list item: the button
  //      role sits on an inner <div class="db-row"> (`<li><div role="button">`), styled as the row itself
  function metricRow(o) {
    var arrow = o.arrow && Object.prototype.hasOwnProperty.call(ARROWS, o.arrow) ? ARROWS[o.arrow] : '';
    var tag = /\brole="button"/.test(o.attrs || '') ? 'div' : 'li';
    return (tag === 'div' ? '<li>' : '') + '<' + tag + ' class="db-row' + (o.cls ? ' ' + o.cls : '') + '"' + (o.attrs || '') + (o.aria ? ' aria-label="' + esc(o.aria) + '"' : '') + '>' + metricIcon(o.key) +
      '<span class="db-name">' + esc(o.name) + '</span>' +
      '<span class="db-vals"><span class="db-val"><b' + (o.numCls ? ' class="' + o.numCls + '"' : '') + '>' + esc(o.value) + '</b>' + (o.unit ? '<small>' + esc(o.unit) + '</small>' : '') +
      (arrow ? '<span class="db-arr db-' + esc(trendTone(o.arrow, o.tone)) + '" aria-hidden="true">' + arrow + '</span>' : '') + '</span>' +
      (o.base != null && o.base !== '' ? '<span class="db-base">' + esc(o.base) + '</span>' : '') +
      (o.base2 ? '<span class="db-base">' + esc(o.base2) + '</span>' : '') + '</span>' + (tag === 'div' ? '</div></li>' : '</li>');
  }

  // THE contributor row (docs/design-system.md → Components → Contributor row): the deep-dive sheets'
  // inputs and Salud's Recovery card — icon · caps label (+ a small sub line) · value · ▲ / ▼ / •.
  // Styles: .dd-row / .dd-ico / .dd-mk in styles/detail.css. 24-unit stroked paths, one per row key.
  var CONTRIB_ICONS = {
    hrv: 'M2 12h4l2-5 4 10 2-5h8',
    rhr: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
    sleep: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    need: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    perf: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    resp: 'M12 3v8M12 11l-3 3M12 11l3 3M9 7c-3 0-6 4-6 10 0 2 1 3 3 3s3-1 3-3zM15 7c3 0 6 4 6 10 0 2-1 3-3 3s-3-1-3-3z',
    vsTarget: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8',
    bed: 'M3 18v-8M3 14h18v4M21 14a3 3 0 0 0-3-3h-7v3M7 12.5a1.5 1.5 0 1 0 0-.01',
    wake: 'M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
    re: 'M13 2 4 14h7l-1 8 9-12h-7z',
    acute: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    sessions: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    typical: 'M3 12h4M17 12h4M12 3v4M12 17v4M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8',
    eff: 'M3 19h18M6 19v-5M10 19V9M14 19v-7M18 19V5',
    cons: 'M4 7h16M4 12h16M4 17h16M8 5v4M15 10v4M11 15v4',
    restor: 'M3 15c3-6 6-6 9 0s6 6 9 0',
    clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2',
    stages: 'M3 6h5v6h6v6h7',
  };
  function contribIcon(k) {
    return '<svg class="dd-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="' + CONTRIB_ICONS[k] + '"/></svg>';
  }
  // o = {row? (data-row key), icon (CONTRIB_ICONS key), label, sub?, value, mark? {glyph, tone
  // ('better' | 'worse' | 'neutral' | 'typical'), said (screen-reader words)}} — texts escaped here
  function contribRow(o) {
    var m = o.mark;
    return '<li class="dd-row"' + (o.row ? ' data-row="' + esc(o.row) + '"' : '') + '>' + contribIcon(o.icon) +
      '<span class="dd-row-lbl">' + esc(o.label) + (o.sub ? ' <small class="dd-row-sub">' + esc(o.sub) + '</small>' : '') + '</span>' +
      '<b class="dd-row-val">' + esc(o.value) + '</b>' +
      (m ? '<span class="dd-mk dd-' + esc(m.tone) + '" aria-hidden="true">' + m.glyph + '</span><span class="sr-only">' + esc(m.said) + '</span>' : '') + '</li>';
  }

  // THE switch (docs/design-system.md → Components → Switch): show / hide one item; attrs = its own
  // data-* hooks; label = what it shows / hides (the state is aria-checked, so no visible word)
  function switchBtn(on, label, attrs) {
    return '<button type="button" class="sw" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="' + esc(label) + '"' + (attrs || '') + '>' +
      '<span class="sw-knob" aria-hidden="true"></span></button>';
  }

  // ⓘ button of a Salud header: toggles the hidden block #<id> (client/health.js listens for
  // [data-hs-info]); drawn as an SVG, the page fonts carry no ⓘ glyph
  var INFO_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>';
  function infoBtn(id, label) {
    return '<button type="button" class="hs-i" data-hs-info="' + esc(id) + '" aria-expanded="false" aria-controls="' + esc(id) + '" aria-label="' + esc(label) + '">' +
      INFO_SVG + '</button>';
  }
  // THE stress chart (lib/score/stress.mjs hours: [{t: 'HH', v: 0-3, hr}]): 24 h across, 0-3 up, the three
  // bands shaded, one point per scored hour (its middle), joined while the hours are consecutive. Drawn by
  // the stress sheet (client/deepdive.js) and Mi panel's stress card (client/home-dash.js); P = the
  // I18N_DETAIL.deep.stress copy, fmt(v, dec) = the page's number format; decorative = aria-hidden
  var STRESS_BANDS = ['low', 'medium', 'high'];
  var SCV = { w: 320, h: 150, l: 22, r: 6, t: 8, b: 20 };
  function stressBand(v) {
    return v >= 2 ? 'high' : v >= 1 ? 'medium' : 'low';
  }
  function stressChart(hours, P, fmt, decorative) {
    var iw = SCV.w - SCV.l - SCV.r, ih = SCV.h - SCV.t - SCV.b;
    var x = function (h) { return SCV.l + (iw * h) / 24; };
    var y = function (v) { return SCV.t + ih * (1 - v / 3); };
    var hh = function (t) { return String(t).slice(0, 2) + ':00'; };
    var ok = function (v) { return typeof v === 'number' && isFinite(v); };
    var out = STRESS_BANDS.map(function (b, i) {
      return '<rect class="ds-zone ds-' + b + '" x="' + SCV.l + '" y="' + y(i + 1).toFixed(1) + '" width="' + iw + '" height="' + (ih / 3).toFixed(1) + '"/>';
    }).join('');
    for (var k = 0; k <= 3; k++) {
      out += '<text class="ds-ylbl" x="' + (SCV.l - 5) + '" y="' + (y(k) + 3).toFixed(1) + '" text-anchor="end">' + esc(fmt(k, 0)) + '</text>';
    }
    for (var h = 0; h <= 24; h += 6) {
      out += '<text class="ds-xlbl" x="' + x(h).toFixed(1) + '" y="' + (SCV.h - 5) + '" text-anchor="' + (h === 0 ? 'start' : h === 24 ? 'end' : 'middle') + '">' + (h < 10 ? '0' : '') + h + ':00</text>';
    }
    hours = hours || [];
    var path = '', prev = null;
    hours.forEach(function (p) {
      var n = parseInt(p.t, 10);
      if (!isFinite(n) || !ok(p.v)) return;
      path += (prev != null && n === prev + 1 ? ' L' : (path ? ' M' : 'M')) + x(n + 0.5).toFixed(1) + ' ' + y(p.v).toFixed(1);
      prev = n;
    });
    if (path) out += '<path class="ds-line" d="' + path + '"/>';
    hours.forEach(function (p) {
      var n = parseInt(p.t, 10);
      if (!isFinite(n) || !ok(p.v)) return;
      out += '<circle class="ds-pt ds-' + stressBand(p.v) + '" cx="' + x(n + 0.5).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="2.6"><title>' +
        esc(format(P.ptTitle, { time: hh(p.t), value: fmt(p.v, 1), hr: fmt(p.hr, 0) })) + '</title></circle>';
    });
    return '<svg class="ds-chart" viewBox="0 0 ' + SCV.w + ' ' + SCV.h + '"' +
      (decorative ? ' aria-hidden="true"' : ' role="img" aria-label="' + esc(format(P.curveSr, { n: hours.length })) + '"') + '>' + out + '</svg>';
  }
  // THE stale-data marker: a short line ("Data 5 d old" + ⓘ) whose full sentence is one tap away. A
  // native <details>, so it needs no listener (works on any tab, also with Salud hidden); cls = the owner
  function staleMark(cls, short, sentence) {
    return '<details class="stale-mk' + (cls ? ' ' + esc(cls) : '') + '"><summary>' + esc(short) + INFO_SVG + '</summary><p>' +
      esc(sentence) + '</p></details>';
  }
  // the ONE CTA link (docs/design-system.md → Components → CTA link): a standalone "go there" link —
  // caps, link blue (.cta, base.css), the arrow drawn here; attrs = the button's own attributes
  function cta(label, attrs) {
    return '<button type="button" class="cta"' + (attrs || '') + '>' + esc(label) + '<span aria-hidden="true"> →</span></button>';
  }
  // the ONE detail-sheet header (dial deep-dives and metric details, client/detail.js): "‹" back =
  // the sheet's close button, the title centred (the dialog's label, #dt-title), and on the right
  // either the ⓘ (the same SVG as infoBtn; toggles o.info.controls via data-dt-act="info") or an
  // equal-width spacer so the title stays centred
  // o.sr: words read before the visible title (screen readers only), e.g. the metric of a dial page
  // whose visible title is its date, so the dialog's label still names what it shows
  function sheetHead(o) {
    return '<div class="dt-head sh-head"><button type="button" class="sh-back" data-dt-act="close" aria-label="' + esc(o.back) + '">‹</button>' +
      '<h2 class="sh-title" id="dt-title">' + (o.sr ? '<span class="sr-only">' + esc(o.sr) + ' · </span>' : '') + esc(o.title) + '</h2>' +
      (o.info ? '<button type="button" class="sh-info" data-dt-act="info" aria-expanded="false" aria-controls="' + esc(o.info.controls) + '" aria-label="' + esc(o.info.label) + '">' + INFO_SVG + '</button>'
        : '<span class="sh-pad" aria-hidden="true"></span>') + '</div>';
  }
  // the detail sheet's registered views (window.HCViews: {<key>: {title(), render()}}, opened by
  // client/detail.js, deep link #<key>). The ONE writer; the registry appears with the first view. A
  // script registering its key again (a re-render, a reload of its API) replaces its view and never
  // throws on the live page; two scripts claiming one key is caught statically (util.test.mjs scan).
  function registerView(name, view) {
    var all = window.HCViews = window.HCViews || {};
    all[name] = view;
  }
  // a registered view by key (own keys only: never "constructor" / "toString"), or null
  function view(name) {
    var all = typeof window !== 'undefined' && window.HCViews && typeof window.HCViews === 'object' ? window.HCViews : null;
    return all && Object.prototype.hasOwnProperty.call(all, name) ? all[name] : null;
  }

  return {
    MS_PER_DAY: MS_PER_DAY,
    STALE_DAYS: C.staleDays,
    isEs: isEs,
    lan: lan,
    jsonApi: jsonApi,
    fetchTimeout: fetchTimeout,
    fetchJson: fetchJson,
    DASH: HC_FMT.DASH,
    int: int,
    pct: pct,
    hours: hours,
    numInput: numInput,
    esc: esc,
    format: format,
    isoDate: isoDate,
    isoOf: isoOf,
    parseIso: parseIso,
    todayIso: todayIso,
    shiftIso: shiftIso,
    daysOld: daysOld,
    ageOn: ageOn,
    nf: nf,
    num: num,
    duration: duration,
    weekdayIndex: weekdayIndex,
    fmtDate: fmtDate,
    fmtMonth: fmtMonth,
    carried: carried,
    detailAttrs: detailAttrs,
    cta: cta,
    trendTone: trendTone,
    metricIcon: metricIcon,
    metricRow: metricRow,
    contribIcon: contribIcon,
    contribRow: contribRow,
    switchBtn: switchBtn,
    infoBtn: infoBtn,
    infoSvg: INFO_SVG,
    staleMark: staleMark,
    stressBand: stressBand,
    stressChart: stressChart,
    sheetHead: sheetHead,
    rolloverAction: rolloverAction,
    registerView: registerView,
    view: view,
  };
})();
