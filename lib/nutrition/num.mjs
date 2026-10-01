/* Rounding helpers shared by the nutrition modules (fill, guide, amounts, units, reference, basics,
 * foodlog). Pure. */

/** A finite number (never a numeric string). */
export const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** To 1 decimal (macros as Tablas shows them). */
export const round1 = (v) => Math.round(v * 10) / 10;
/** To 2 decimals (the carb / swap factors, baked line macros, amounts in a label). */
export const round2 = (v) => Math.round(v * 100) / 100;

/** The tiny epsilon of roundEps: it keeps x.x5 from rounding down on floating-point noise
 * (1.005 * 100 = 100.4999…, 0.1 + 0.2 …). */
export const ROUND_EPS = 1e-9;
/** To `dec` decimals (0 = whole), epsilon-safe: the food log's entries and the basics' macros. round1 /
 * round2 stay plain, so the plan's pinned numbers (and the page ports that mirror them) never move. */
export const roundEps = (v, dec) => {
  const f = 10 ** dec;
  return Math.round(v * f + ROUND_EPS) / f;
};
