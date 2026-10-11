/* Natural units of the public food DB (data/nutrition/ingredients.json), all OPTIONAL per ingredient:
 *   piece   = { name: {es, en}, plural?: {es, en}, amt, g?, typical? } — the food's natural piece:
 *             `amt` in the ingredient's own unit (g / ml; a `ud` ingredient's piece is its unit, amt 100)
 *             and, for `ud` only, `g` = the grams reference of one piece. `typical: true` = a typical
 *             weight (a medium fruit), not a weighed label. A tablespoon's weight is per food:
 *             allioli / mayonesa 15 g (each food's own piece.amt); olive oil has no piece (logged in ml).
 *   weighed = 'raw' | 'dry' | 'cooked' — how the plan weighs the food (rice / pasta dry, meat raw…),
 *             stated next to its per-100 reference in Tablas.
 * A countable food (one with a piece) shows pieces with the grams reference in Plan de hoy and Tablas;
 * scaled amounts of it round to half pieces (PIECE_GRID; lib/nutrition/amounts.mjs stepAmount). Pure, no I/O. */

import { isLocText, locText } from './names.mjs';
import { round2 } from './num.mjs';

/** One unit of a `ud` food = 100 in its own scale (per: 100, so `amt: 200` = 2 units). */
export const UD_AMT = 100;
/** Countable foods round to (and show) this fraction of a piece: half pieces. */
export const PIECE_GRID = 0.5;

export const WEIGHED = Object.freeze(['raw', 'dry', 'cooked']);

/** Errors (strings) for malformed `piece` / `weighed` metadata; [] when everything is valid. */
export function validateIngredientMeta(ING) {
  const errors = [];
  for (const [key, ing] of Object.entries(ING || {})) {
    const bad = (msg) => errors.push(`ingredient ${key}: ${msg}`);
    if (ing.weighed != null && !WEIGHED.includes(ing.weighed)) bad(`weighed must be one of ${WEIGHED.join(', ')} (got ${JSON.stringify(ing.weighed)})`);
    const pc = ing.piece;
    if (pc == null) continue;
    if (typeof pc !== 'object' || Array.isArray(pc)) { bad('piece must be an object'); continue; }
    if (!isLocText(pc.name)) bad('piece.name must be {es, en} non-empty strings');
    if (pc.plural != null && !isLocText(pc.plural)) bad('piece.plural must be {es, en} non-empty strings when present');
    if (typeof pc.amt !== 'number' || !Number.isFinite(pc.amt) || pc.amt <= 0) bad('piece.amt must be a positive number (in the ingredient unit)');
    else if (ing.unit === 'ud' && pc.amt !== UD_AMT) bad(`piece.amt of a "ud" ingredient must be ${UD_AMT} (one unit)`);
    if (pc.g != null) {
      if (ing.unit !== 'ud') bad('piece.g (grams reference) is only for "ud" ingredients');
      else if (typeof pc.g !== 'number' || !Number.isFinite(pc.g) || pc.g <= 0) bad('piece.g must be a positive number');
    }
    if (pc.typical != null && typeof pc.typical !== 'boolean') bad('piece.typical must be a boolean when present');
  }
  return errors;
}

/** An ingredient's usable natural piece (an object with amt > 0), else null. */
export const ingPiece = (ing) => (ing && ing.piece && typeof ing.piece === 'object' && ing.piece.amt > 0 ? ing.piece : null);

/** The compact, localized piece table the page bakes: {key: {a: amt per piece, r: grams reference of a
 * `ud` piece | null, o: one, m: many}} for every ingredient with a piece. */
export function pieceFmt(ING, lang = 'en') {
  const out = {};
  for (const [key, ing] of Object.entries(ING || {})) {
    const pc = ingPiece(ing);
    if (!pc) continue;
    const o = locText(pc.name, lang);
    out[key] = { a: pc.amt, r: ing.unit === 'ud' && pc.g ? pc.g : null, o, m: locText(pc.plural, lang) || o };
  }
  return out;
}

/** 1 -> "1", 1.5 -> "1½", 0.5 -> "½". */
export function fmtHalf(h) {
  const whole = Math.floor(h);
  const half = h - whole >= 0.5;
  return (whole ? String(whole) : '') + (half ? '½' : '') || '0';
}

/** An amount of a countable food as pieces + the grams reference: "1½ medium bananas (~180 g)" when the
 * amount sits on the half-piece grid (the grams are then an estimate), "~1½ medium bananas (150 g)"
 * when it does not (the grams are the plan amount, the pieces approximate); a `ud` piece is always
 * exact ("2 eggs (~100 g)" with a 50 g egg, no reference without `r`). The page runs it (HC_SCALE). */
export function fmtPieces(amt, unit, pc) {
  const n = amt / pc.a;
  const h = Math.max(PIECE_GRID, Math.round(n / PIECE_GRID) * PIECE_GRID);
  const exact = Math.abs(n - h) < 1e-9;
  const name = h > 1 ? pc.m : pc.o;
  let ref;
  if (unit === 'ud') ref = pc.r ? '~' + Math.round(n * pc.r) + ' g' : null;
  else ref = (exact ? '~' : '') + round2(amt) + ' ' + unit;
  return (exact ? '' : '~') + fmtHalf(h) + ' ' + name + (ref ? ' (' + ref + ')' : '');
}

/** What lib/nutrition/client.mjs emits into the page's HC_SCALE: THESE functions' own source (a plain
 * descriptor, no import of the emitter). */
export const CLIENT = { consts: {}, hidden: { PIECE_GRID }, fns: { fmtHalf, fmtPieces } };
