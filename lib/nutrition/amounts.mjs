/* Amount helpers shared by the portion scaling (lib/nutrition/scale.mjs) and the choosable blocks
 * (lib/nutrition/blocks.mjs): the model line, the practical rounding steps and the display format of
 * an amount. web/src/client/nutri-day.js ports stepAmount / fmtAmt line by line. Pure, no I/O. */
import { fmtPieces, ingPiece, UD_AMT, PIECE_GRID } from './units.mjs';
import { round2 } from './num.mjs';

export const AMOUNT_STEP = 5; // g / ml

/** A scaled amount rounded to a practical step: 5 g / 5 ml (never below one step); `ud` (UD_AMT = one
 * unit) to whole units, at least one; a countable g / ml food (`st` = PIECE_GRID of its piece, see
 * lib/nutrition/units.mjs) to half pieces, at least one half. */
export function stepAmount(amt, unit, st) {
  if (unit === 'ud') return Math.max(UD_AMT, Math.round(amt / UD_AMT) * UD_AMT);
  if (st > 0) return Math.max(st, Math.round(amt / st) * st);
  return Math.max(AMOUNT_STEP, Math.round(amt / AMOUNT_STEP) * AMOUNT_STEP);
}

/** The MODEL LINE: a compact JSON-safe tuple (it is baked), [unit, amt, k, p, c, g] + [step, ingredient
 * key] for a countable food. Its layout is named here ONCE; every reader (scale.mjs, blocks.mjs and the
 * page port in web/src/client/nutri-day.js, which mirrors these accessors) goes through LINE / the
 * accessors below, never a bare index. */
export const LINE = Object.freeze({ UNIT: 0, AMT: 1, K: 2, P: 3, C: 4, G: 5, STEP: 6, KEY: 7 });
export const lineUnit = (l) => l[LINE.UNIT];
export const lineAmt = (l) => l[LINE.AMT];
/** The line's macros [k, p, c, g] at its amount. */
export const lineMac = (l) => l.slice(LINE.K, LINE.G + 1);
/** The rounding step of a countable line (UD_AMT for `ud`, half a piece for g / ml), else undefined. */
export const lineStep = (l) => l[LINE.STEP];
/** The ingredient key of a countable line (to look up its baked piece), else undefined. */
export const lineKey = (l) => l[LINE.KEY];
/** A countable line's baked piece entry (units.mjs pieceFmt, `fmt.pieces`), else null. */
export const pieceOf = (pieces, l) => (lineKey(l) && pieces ? pieces[lineKey(l)] || null : null);
/** The same line at amount `amt`: macros proportional, step and key kept (a new array). */
export function scaleLine(l, amt) {
  const r = amt / lineAmt(l);
  return [lineUnit(l), amt, l[LINE.K] * r, l[LINE.P] * r, l[LINE.C] * r, l[LINE.G] * r].concat(l.slice(LINE.STEP));
}

/** A model line for recipe line `l` (`ud` rounds to whole units, a g / ml food with a piece to half
 * pieces — both are DISCRETE in solveScale). */
export function modelLine(ING, l) {
  const ing = ING[l.ing];
  if (!ing) throw new Error('unknown ingredient: ' + l.ing);
  const f = l.amt / ing.per;
  const ln = [ing.unit, l.amt, ing.k * f, ing.p * f, ing.c * f, ing.g * f];
  const pc = ingPiece(ing);
  if (pc) ln.push(ing.unit === 'ud' ? UD_AMT : pc.amt * PIECE_GRID, l.ing);
  return ln;
}
export const isDiscrete = (l) => lineUnit(l) === 'ud' || l.length > LINE.STEP;

/** An amount as the page shows it: pieces + grams reference for a countable food (`pc` = its
 * pieceFmt entry), else "N ud" / "N g" / "N ml". */
export function fmtAmt(amt, unit, units, pc) {
  if (pc) return fmtPieces(amt, unit, pc);
  return unit === 'ud' ? `${round2(amt / UD_AMT)} ${units.ud}` : `${round2(amt)} ${units[unit] || unit}`;
}
