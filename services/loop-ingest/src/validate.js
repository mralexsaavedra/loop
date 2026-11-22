/**
 * The request-body validation primitives the route modules share (food-validate.js, settings-profile.js).
 * Validation is strict and by hand: unknown keys are refused, strings trimmed and length-capped, numbers
 * finite, rounded to 1 decimal and THEN checked against their limits (so 0.04 g is 0 and refused where > 0 is
 * required). Every fault throws a 400 `invalid` httpError naming the field (http.js), never raw input.
 */
import { round1 } from './food-calc.js'
import { httpError, hasControlChars } from './http.js'

export function bad (field) {
  throw httpError(400, 'invalid', field)
}

export function isObj (v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function strictKeys (body, allowed, prefix = '') {
  if (!isObj(body)) bad(prefix ? prefix.slice(0, -1) : 'body')
  for (const k of Object.keys(body)) if (!allowed.includes(k)) bad(prefix + k)
}

export function absent (v) {
  return v === undefined || v === null
}

export function str (v, field, max, optional = false) {
  if (optional && (absent(v) || v === '')) return null
  if (typeof v !== 'string' || hasControlChars(v)) bad(field)
  const s = v.replace(/\s+/g, ' ').trim()
  if (!s || s.length > max) bad(field)
  return s
}

// rounded FIRST (1 decimal, the stored precision), then bound-checked: 0.04 is 0, 900.04 is 900
export function number (v, field, { min = 0, max, above = false, optional = false, integer = false }) {
  if (optional && absent(v)) return null
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(field)
  if (integer && !Number.isInteger(v)) bad(field)
  const n = integer ? v : round1(v)
  if (above ? n <= min : n < min) bad(field)
  if (n > max) bad(field)
  return n
}

export function oneOf (v, field, list) {
  if (!list.includes(v)) bad(field)
  return v
}

export function pattern (v, field, re, optional = true) {
  if (optional && (absent(v) || v === '')) return null
  if (typeof v !== 'string' || !re.test(v)) bad(field)
  return v
}

export function flag (v, field) {
  if (absent(v)) return false
  if (typeof v !== 'boolean') bad(field)
  return v
}

export function id (v, field) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) bad(field)
  return v
}
