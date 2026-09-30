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
  // baked dates are interpolated into markup: accept only a real ISO date, anything else is absent
  function isoDate(s) {
    return typeof s === 'string' && ISO_RE.test(s) ? s : null;
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
  // whole days between an ISO date and the viewer's today (negative = ahead of the clock); null if not ISO
  function daysOld(iso) {
    iso = isoDate(iso);
    if (!iso) return null;
    return Math.round((parseIso(todayIso()) - parseIso(iso)) / MS_PER_DAY);
  }
  // decimal comma in es, the value otherwise untouched
  function nf(n) {
    return isEs() ? String(n).replace('.', ',') : String(n);
  }
  // fixed decimals, optional leading "+"; a value that rounds to zero carries no sign
  function num(x, dec, signed) {
    var s = Number(x).toFixed(dec);
    if (Number(s) === 0) s = (0).toFixed(dec);
    else if (signed && Number(s) > 0) s = '+' + s;
    return isEs() ? s.replace('.', ',') : s;
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
  // minutes -> "1 h 45 min" / "45 min" / "1 h"; units = {h, min} from the page's i18n dict
  function duration(min, units) {
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + ' ' + units.h + (m ? ' ' + m + ' ' + units.min : '') : m + ' ' + units.min;
  }

  return {
    MS_PER_DAY: MS_PER_DAY,
    STALE_DAYS: C.staleDays,
    isEs: isEs,
    esc: esc,
    format: format,
    isoDate: isoDate,
    isoOf: isoOf,
    parseIso: parseIso,
    todayIso: todayIso,
    shiftIso: shiftIso,
    daysOld: daysOld,
    nf: nf,
    num: num,
    duration: duration,
    weekdayIndex: weekdayIndex,
    fmtDate: fmtDate,
    fmtMonth: fmtMonth,
    detailAttrs: detailAttrs,
  };
})();
