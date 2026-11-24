/**
 * The request-body validation primitives the route modules share (food-validate.js, settings-profile.js).
 * Validation is strict and by hand: unknown keys are refused, strings trimmed and length-capped, numbers
 * finite, rounded to 1 decimal and THEN checked against their limits (so 0.04 g is 0 and refused where > 0 is
 * required). Every fault throws a 400 `invalid` httpError naming the field (http.js), never raw input.
 */
import { round1 } from './food-calc.js'
import { httpError, hasControlChars } from './http.js'

/** Throws the 400 `invalid` error naming `field`; never returns.
 * @param {string} field @returns {never} */
export function bad (field) {
  throw httpError(400, 'invalid', field)
}

/** A plain object (not null, not an array).
 * @param {unknown} v @returns {v is Record<string, any>} */
export function isObj (v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** `body` is an object whose keys are all in `allowed`, else a 400 naming `prefix` + the first unknown key.
 * @param {unknown} body @param {readonly string[]} allowed @param {string} [prefix] */
export function strictKeys (body, allowed, prefix = '') {
  if (!isObj(body)) bad(prefix ? prefix.slice(0, -1) : 'body')
  for (const k of Object.keys(/** @type {object} */ (body))) if (!allowed.includes(k)) bad(prefix + k)
}

/** @param {unknown} v @returns {v is null | undefined} */
export function absent (v) {
  return v === undefined || v === null
}

/** A trimmed, space-collapsed string of 1..max characters; optional: absent or '' is null.
 * @overload @param {unknown} v @param {string} field @param {number} max @param {false} [optional] @returns {string}
 * @overload @param {unknown} v @param {string} field @param {number} max @param {boolean} optional @returns {string | null}
 * @param {unknown} v @param {string} field @param {number} max @param {boolean} [optional] @returns {string | null} */
export function str (v, field, max, optional = false) {
  if (optional && (absent(v) || v === '')) return null
  if (typeof v !== 'string' || hasControlChars(v)) bad(field)
  const s = v.replace(/\s+/g, ' ').trim()
  if (!s || s.length > max) bad(field)
  return s
}

// rounded FIRST (1 decimal, the stored precision), then bound-checked: 0.04 is 0, 900.04 is 900
/** @typedef {{ min?: number, max: number, above?: boolean, integer?: boolean }} NumberBounds */
/**
 * @overload @param {unknown} v @param {string} field @param {NumberBounds & { optional?: false }} opts @returns {number}
 * @overload @param {unknown} v @param {string} field @param {NumberBounds & { optional: boolean }} opts @returns {number | null}
 * @param {unknown} v @param {string} field @param {NumberBounds & { optional?: boolean }} opts @returns {number | null} */
export function number (v, field, { min = 0, max, above = false, optional = false, integer = false }) {
  if (optional && absent(v)) return null
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(field)
  if (integer && !Number.isInteger(v)) bad(field)
  const n = integer ? v : round1(v)
  if (above ? n <= min : n < min) bad(field)
  if (n > max) bad(field)
  return n
}

/** `v` when it is one of `list`, else a 400 naming `field`.
 * @template T @param {unknown} v @param {string} field @param {readonly T[]} list @returns {T} */
export function oneOf (v, field, list) {
  if (!list.includes(/** @type {T} */ (v))) bad(field)
  return /** @type {T} */ (v)
}

/** A string matching `re`; optional (the default): absent or '' is null.
 * @overload @param {unknown} v @param {string} field @param {RegExp} re @param {false} optional @returns {string}
 * @overload @param {unknown} v @param {string} field @param {RegExp} re @param {boolean} [optional] @returns {string | null}
 * @param {unknown} v @param {string} field @param {RegExp} re @param {boolean} [optional] @returns {string | null} */
export function pattern (v, field, re, optional = true) {
  if (optional && (absent(v) || v === '')) return null
  if (typeof v !== 'string' || !re.test(v)) bad(field)
  return v
}

/** A boolean; absent is false.
 * @param {unknown} v @param {string} field @returns {boolean} */
export function flag (v, field) {
  if (absent(v)) return false
  if (typeof v !== 'boolean') bad(field)
  return v
}

/** A positive safe integer (a row id).
 * @param {unknown} v @param {string} field @returns {number} */
export function id (v, field) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) bad(field)
  return v
}
