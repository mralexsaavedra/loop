/* Emits a standalone ES module from a lib module's OWN values and function source: the ESM twin of
 * lib/format/numbers.mjs classicGlobal, for a consumer that cannot import lib/ at runtime (the ingest
 * service is built from its own directory: scripts/gen-food-calc.mjs writes its src/food-calc.js).
 *
 * Descriptor (a plain object the lib module exports, so lib/nutrition never imports lib/build):
 *   consts = {NAME: value} → `export const NAME = <literal>;` (Object.freeze(…) when the value is frozen)
 *   hidden = {NAME: value} → `const NAME = <literal>;` (not exported)
 *   fns    = {name: function declaration} → `export function name(…) { … }` (its own toString())
 *   local  = {name: function declaration} → `function name(…) { … }` (not exported)
 * Values must be JSON-safe (strings, finite numbers, booleans, null, arrays, plain objects): what the
 * literal prints is exactly what the lib holds. Keys must be the names the functions declare (an export
 * IS the declared name) and one name is declared once. Deterministic: same input, same bytes. Build /
 * test time only. */

function literal(name, value) {
  const json = JSON.stringify(value);
  if (json === undefined || JSON.stringify(JSON.parse(json)) !== json || !sameJson(JSON.parse(json), value)) {
    throw new Error(`esmModule: ${name} is not JSON-safe`);
  }
  return value !== null && typeof value === 'object' && Object.isFrozen(value) ? 'Object.freeze(' + json + ')' : json;
}

// deep equality of a JSON round trip with the original (catches NaN / Infinity → null, undefined, RegExp, Date …)
function sameJson(a, b) {
  if (a === null || typeof a !== 'object') return Object.is(a, b);
  if (b === null || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (!Array.isArray(b) && Object.getPrototypeOf(b) !== Object.prototype) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => sameJson(a[k], b[k]));
}

function declaration(name, f) {
  if (typeof f !== 'function') throw new Error(`esmModule: ${name} is not a function`);
  const src = f.toString();
  const m = /^function\s+([\w$]+)\s*\(/.exec(src);
  if (!m) throw new Error(`esmModule: ${name} is not a function declaration`);
  if (m[1] !== name) throw new Error(`esmModule: key ${name} declares ${m[1]}`);
  return src;
}

/** The module source: `header` (a block comment, without the comment markers' lines), then constants
 * (exported first, hidden next) and functions (local helpers first, exported next), in descriptor order. */
export function esmModule(header, { consts = {}, hidden = {}, fns = {}, local = {} }) {
  const names = [...Object.keys(consts), ...Object.keys(hidden), ...Object.keys(local), ...Object.keys(fns)];
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`esmModule: ${dup} is declared twice`);
  const lines = [
    header.trim().split('\n').map((l, i) => (i ? ' *' : '/*') + (l.trimEnd() ? ' ' + l.trimEnd() : '')).join('\n') + ' */',
    '',
    ...Object.entries(consts).map(([n, v]) => 'export const ' + n + ' = ' + literal(n, v) + ';'),
    ...Object.entries(hidden).map(([n, v]) => 'const ' + n + ' = ' + literal(n, v) + ';'),
    '',
    ...Object.entries(local).map(([n, f]) => declaration(n, f)),
    ...Object.entries(fns).map(([n, f]) => 'export ' + declaration(n, f)),
  ];
  return lines.join('\n') + '\n';
}
