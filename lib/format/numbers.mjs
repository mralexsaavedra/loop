/* The ONE display formatter for numbers, percents and durations (docs/design-system.md → "Numbers").
 * Pure functions, no Intl: the page must print the same bytes in every browser / Node ICU build.
 *
 * Rules (es | en):
 *   - grouping: every |value| >= 1000 is grouped, 4 digits too ("2.500" | "2,500"); es-ES Intl
 *     would leave 4 digits ungrouped (minimumGroupingDigits 2), so the page would print "2500"
 *     next to "13.463" — one rule everywhere instead;
 *   - decimals: "7,5" | "7.5"; fixed decimals per call site; a value that rounds to zero carries no
 *     sign ("0,0", never "-0,0" / "+0,0"); a signed value gets "+";
 *   - percent: no space ("97%"), in both locales;
 *   - durations: h:mm from minutes ("7:01", "0:37", "27:06"); total minutes are rounded FIRST, so
 *     7.999 h prints "8:00", never "7:60";
 *   - absent (null / undefined / '' / NaN / ±Infinity) → "—".
 *
 * The same functions reach the classic inline client scripts: clientSource() serialises them into
 * `var HC_FMT = (function () { … })();`, which web/layouts/Plan.astro inlines before util.js (HC.num,
 * HC.int, HC.pct, HC.hm read it with the page LOCALE). Every function below must therefore be
 * self-contained ES5 that only calls the other functions listed in FNS (no imports, no closures). */

export const DASH = '—';

/** A finite number from a number or a numeric string; NaN for anything absent. */
export function toNum(x) {
  if (x == null || x === '' || typeof x === 'boolean') return NaN;
  var n = typeof x === 'number' ? x : Number(x);
  return isFinite(n) ? n : NaN;
}

/** Group the integer digits of an unsigned digit string ("2500" → "2.500" in es). */
export function groupDigits(digits, locale) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, locale === 'es' ? '.' : ',');
}

/** "1.234,5" (es) / "1,234.5" (en) from an unsigned "1234.5". */
function localise(abs, locale) {
  var parts = abs.split('.');
  var out = groupDigits(parts[0], locale);
  return parts.length > 1 ? out + (locale === 'es' ? ',' : '.') + parts[1] : out;
}

/** Fixed `dec` decimals (default 0), grouped; `signed` adds "+" to a positive value. */
export function fmtNumber(x, dec, locale, signed) {
  var n = toNum(x);
  if (n !== n) return DASH;
  var s = n.toFixed(dec || 0);
  if (Number(s) === 0) return localise((0).toFixed(dec || 0), locale);
  var neg = s.charAt(0) === '-';
  return (neg ? '-' : signed ? '+' : '') + localise(neg ? s.slice(1) : s, locale);
}

/** A whole number, grouped ("13.463"). */
export function fmtInt(x, locale, signed) {
  return fmtNumber(x, 0, locale, signed);
}

/** As many decimals as the value carries (a baked 1.25 stays "1,25"), grouped. */
export function fmtRaw(x, locale) {
  var n = toNum(x);
  if (n !== n) return DASH;
  var s = String(n);
  if (/e/i.test(s)) return fmtNumber(n, 0, locale);
  var neg = s.charAt(0) === '-';
  return (neg ? '-' : '') + localise(neg ? s.slice(1) : s, locale);
}

/** A percent, no space ("97%"); `dec` decimals (default 0). */
export function fmtPercent(x, locale, signed, dec) {
  var s = fmtNumber(x, dec || 0, locale, signed);
  return s === DASH ? s : s + '%';
}

/** A duration in minutes as h:mm ("7:01", "0:37"); `signed` adds "+" to a positive one. */
export function fmtMinutes(min, signed) {
  var n = toNum(min);
  if (n !== n) return DASH;
  var t = Math.round(Math.abs(n));
  var h = Math.floor(t / 60), m = t % 60;
  var sign = t === 0 ? '' : n < 0 ? '-' : signed ? '+' : '';
  return sign + h + ':' + (m < 10 ? '0' : '') + m;
}

/** A duration in (decimal) hours as h:mm (7.5 → "7:30", 7.999 → "8:00"). */
export function fmtHours(hours, signed) {
  var n = toNum(hours);
  return n !== n ? DASH : fmtMinutes(n * 60, signed);
}

/** An input field's value: decimal comma in es, NEVER grouped (the field parses it back); `dec`
 * fixed decimals, or (null) the decimals the value carries; '' when absent. Display uses fmtNumber. */
export function fmtPlain(x, dec, locale) {
  var n = toNum(x);
  if (n !== n) return '';
  var s = dec == null ? String(n) : n.toFixed(dec);
  return locale === 'es' ? s.replace('.', ',') : s;
}

const FNS = [toNum, groupDigits, localise, fmtNumber, fmtInt, fmtRaw, fmtPercent, fmtMinutes, fmtHours, fmtPlain];

/** The classic-script twin for the inline page scripts: `var HC_FMT = {…}` built from THESE functions'
 * own source, so the build and the browser can never format differently. */
export function clientSource() {
  return (
    'var HC_FMT = (function () {\n  var DASH = ' + JSON.stringify(DASH) + ';\n' +
    FNS.map((f) => '  ' + f.toString()).join('\n') +
    '\n  return { DASH: DASH, ' + FNS.map((f) => f.name + ': ' + f.name).join(', ') + ' };\n})();'
  );
}
