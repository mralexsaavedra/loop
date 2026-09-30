/* Shared client helpers for the classic (is:inline) scripts: escaping, templates, the viewer's local
 * calendar and locale-aware number / duration formatting. layouts/Plan.astro inlines this FIRST, right
 * after `var HC_CONST` (baked from lib/stale.mjs), so every later script reads the global `HC`
 * (window.HC) instead of redefining these. Constants come from HC_CONST, never client literals.
 *
 * Dates: every "today" is the VIEWER's local calendar day from Date.now() (never baked), so
 * consecutive builds stay byte-identical. Numbers: LOCALE is read at call time ("es" = decimal comma).
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
  };
})();
