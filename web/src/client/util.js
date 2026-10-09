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
  // markup-safe text AND attribute value (quotes too)
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // "{key}" placeholders; a missing value renders as empty, never "undefined"
  function format(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) {
      return vars && vars[k] != null ? vars[k] : '';
    });
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
    run: '<circle cx="14" cy="4.5" r="1.8"/><path d="M6 21l3.5-5 3 2 1-5 3 3h3M8 10l3-3h3l-1.5 6"/>',
    bike: '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-7h5l3 7M10 9l2 7h-6M13 5h3"/>',
    food: '<path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2 1.5-3 4-3 8h3"/>',
    balance: '<path d="M12 4v16M8 20h8M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>',
  };
  function metricIcon(key) {
    return '<svg class="db-ico" viewBox="0 0 24 24" aria-hidden="true">' + (Object.prototype.hasOwnProperty.call(ICONS, key) ? ICONS[key] : ICONS.hrv) + '</svg>';
  }
  // the ONE trend glyph (docs/design-system.md → Components → Trend glyph): ▲ / ▼ for a change, • for
  // typical / steady; the tone class colours it — good / bad / watch by the metric's direction,
  // `neutral` (--ink) for a change with no good direction, `flat` (grey) ONLY for the • (no grey arrow)
  var ARROWS = { up: '▲', down: '▼', flat: '•' };
  function trendTone(arrow, tone) {
    if (arrow === 'flat') return 'flat';
    return !tone || tone === 'flat' || tone === 'normal' ? 'neutral' : tone;
  }
  // o = {key, cls?, attrs?, aria?, name, note?, value, unit?, numCls?, arrow? ('up' | 'down' | 'flat'),
  //      tone? ('good' | 'bad' | 'watch' | 'flat'), base?} — every text is escaped here; `note` = a small
  //      line under the name (a session's secondary numbers on Entreno's run / ride rows)
  function metricRow(o) {
    var arrow = o.arrow && Object.prototype.hasOwnProperty.call(ARROWS, o.arrow) ? ARROWS[o.arrow] : '';
    return '<li class="db-row' + (o.cls ? ' ' + o.cls : '') + '"' + (o.attrs || '') + (o.aria ? ' aria-label="' + esc(o.aria) + '"' : '') + '>' + metricIcon(o.key) +
      '<span class="db-name">' + esc(o.name) + (o.note ? '<small class="db-note">' + esc(o.note) + '</small>' : '') + '</span>' +
      '<span class="db-vals"><span class="db-val"><b' + (o.numCls ? ' class="' + o.numCls + '"' : '') + '>' + esc(o.value) + '</b>' + (o.unit ? '<small>' + esc(o.unit) + '</small>' : '') +
      (arrow ? '<span class="db-arr db-' + esc(trendTone(o.arrow, o.tone)) + '" aria-hidden="true">' + arrow + '</span>' : '') + '</span>' +
      (o.base != null && o.base !== '' ? '<span class="db-base">' + esc(o.base) + '</span>' : '') + '</span></li>';
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

  return {
    MS_PER_DAY: MS_PER_DAY,
    STALE_DAYS: C.staleDays,
    isEs: isEs,
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
    sheetHead: sheetHead,
    rolloverAction: rolloverAction,
  };
})();
