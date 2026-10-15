/* The JavaScript literal of a lib constant, for the two emitters that copy lib values into generated code:
 * lib/build/esm-module.mjs esmModule (the ingest service's food-calc.js / journal-calc.js) and
 * lib/format/numbers.mjs classicGlobal (the page's HC_* classic-script globals). Build / test time only.
 *
 * Values must be JSON-safe (strings, finite numbers, booleans, null, arrays, plain objects): what the literal
 * prints is exactly what the lib holds, so NaN / Infinity / undefined / a Date / a function are refused
 * instead of silently turning into null or vanishing. */

/** `value` as a literal. `freeze` (default true): a frozen value is wrapped in Object.freeze(…) at EVERY
 * array / object level (the service cannot change a shared table through a nested reference either);
 * false prints the plain JSON. `who` names the emitter in the error. */
export function literal(name, value, { freeze = true, who = 'esmModule' } = {}) {
  const json = JSON.stringify(value);
  if (json === undefined || JSON.stringify(JSON.parse(json)) !== json || !sameJson(JSON.parse(json), value)) {
    throw new Error(`${who}: ${name} is not JSON-safe`);
  }
  return freeze && value !== null && typeof value === 'object' && Object.isFrozen(value) ? frozen(value) : json;
}

// Inline freezes (not an emitted deepFreeze helper) keep the output a list of plain declarations, with no
// extra name that could clash with a descriptor key.
function frozen(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const items = Array.isArray(v) ? v.map(frozen) : Object.entries(v).map(([k, x]) => JSON.stringify(k) + ':' + frozen(x));
  return 'Object.freeze(' + (Array.isArray(v) ? '[' + items.join(',') + ']' : '{' + items.join(',') + '}') + ')';
}

// deep equality of a JSON round trip with the original (catches NaN / Infinity → null, undefined, RegExp, Date …)
function sameJson(a, b) {
  if (a === null || typeof a !== 'object') return Object.is(a, b);
  if (b === null || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (!Array.isArray(b) && Object.getPrototypeOf(b) !== Object.prototype) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => sameJson(a[k], b[k]));
}
