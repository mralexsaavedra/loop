/* Rounding helpers shared by the nutrition modules (fill, guide, amounts, units, reference, basics,
 * foodlog). Pure. */

/** A finite number (never a numeric string). The page runs it too (several CLIENT descriptors list it;
 * web/src/client/lib-globals.ts publishes them).
 * @param {unknown} v @returns {v is number} */
export function fin(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** To 1 decimal (macros as Tablas shows them), PLAIN: a value a float sum leaves just under x.x5 rounds down
 * (2.3 + 0.05 = 2.3499… -> 2.3). Not lib/nutrition/foodlog.mjs round1, which is roundEps(v, 1) (-> 2.4): the
 * plan's pinned numbers use this one, the food log that one (num.test.mjs pins the difference).
 * @param {number} v @returns {number} */
export const round1 = (v) => Math.round(v * 10) / 10;
/** To 2 decimals (the carb / swap factors, baked line macros, amounts in a label). The page runs it in
 * HC_SCALE (web/src/client/lib-globals.ts).
 * @param {number} v @returns {number} */
export function round2(v) {
  return Math.round(v * 100) / 100;
}

/** The tiny epsilon of roundEps: it keeps x.x5 from rounding down on floating-point noise
 * (1.005 * 100 = 100.4999…, 0.1 + 0.2 …). */
export const ROUND_EPS = 1e-9;
/** To `dec` decimals (0 = whole), epsilon-safe: the food log's entries and the basics' macros. round1 /
 * round2 stay plain, so the plan's pinned numbers (and the page ports that mirror them) never move.
 * @param {number} v @param {number} dec @returns {number} */
export function roundEps(v, dec) {
  var f = Math.pow(10, dec);
  return Math.round(v * f + ROUND_EPS) / f;
}
