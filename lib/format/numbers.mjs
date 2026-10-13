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
 * self-contained ES5 that only calls the other functions listed in clientSource() (no imports, no closures). */

import { stripCommentsAndStrings } from './js-scan.mjs';

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

/** Emits a classic-script global from a module's OWN values and function source:
 * `var <global> = (function () { var …constants; function …; return { …public keys }; })();`.
 * Every lib clientSource() goes through it (HC_FMT, HC_BAND, HC_ADH, HC_PROG, the nutrition ones). Robust to the build's
 * bundler: Vite / Rollup bundles the libs together and renames clashing top-level names (fin ->
 * fin$3, ISO_RE -> ISO_RE$2), so neither the public keys nor the constants may come from identifiers.
 * Public keys are the explicit map keys, each bound to the name its function source actually declares;
 * every constant is declared under its own name AND under each renamed spelling (NAME$n, Rollup's only
 * rename form) the emitted function bodies reference IN CODE: the scan runs over the bodies with comments
 * and string / template / regex literal contents stripped (lib/format/js-scan.mjs), so a 'NAME$2' string
 * or an unrelated local NAME2 adds nothing. `consts` are returned as public keys, `hidden` only declared;
 * `fns` = {publicKey: function declaration}; two different functions under one declared name are refused.
 * web/test/client-globals-build.test.mjs runs the result from the built page. */
export function classicGlobal(global, { consts = {}, hidden = {}, fns = {} }) {
  const srcs = Object.entries(fns).map(([key, f]) => {
    const src = f.toString();
    const m = /^function\s+([\w$]+)\s*\(/.exec(src);
    if (!m) throw new Error(`classicGlobal ${global}.${key}: not a function declaration`);
    return { key, src, id: m[1] };
  });
  // one IIFE scope: two different functions declaring one name would silently shadow each other (the
  // unbundled modules keep their own names, e.g. a local round2 next to num.mjs round2)
  const seen = new Map();
  for (const x of srcs) {
    if (seen.has(x.id) && seen.get(x.id) !== x.src) throw new Error(`classicGlobal ${global}: two functions declare ${x.id} twice`);
    seen.set(x.id, x.src);
  }
  const code = stripCommentsAndStrings(srcs.map((x) => x.src).join('\n'));
  const decls = [];
  for (const [name, value] of Object.entries({ ...consts, ...hidden })) {
    const lit = value instanceof RegExp ? value.toString() : JSON.stringify(value);
    const ids = new Set([name]);
    const esc = name.replace(/\$/g, '\\$');
    for (const m of code.matchAll(new RegExp('(?<![\\w$])' + esc + '(?:\\$\\d+)?(?![\\w$])', 'g'))) ids.add(m[0]);
    for (const id of ids) decls.push(id + ' = ' + lit);
  }
  const keys = [...Object.keys(consts).map((k) => k + ': ' + k), ...srcs.map((x) => x.key + ': ' + x.id)];
  return (
    'var ' + global + ' = (function () {\n' + (decls.length ? '  var ' + decls.join(', ') + ';\n' : '') +
    srcs.map((x) => '  ' + x.src).join('\n') + '\n  return { ' + keys.join(', ') + ' };\n})();'
  );
}

/** The classic-script twin for the inline page scripts: `var HC_FMT = {…}` built from THESE functions'
 * own source, so the build and the browser can never format differently. */
export function clientSource() {
  return classicGlobal('HC_FMT', {
    consts: { DASH },
    fns: { toNum, groupDigits, localise, fmtNumber, fmtInt, fmtRaw, fmtPercent, fmtMinutes, fmtHours, fmtPlain },
  });
}
