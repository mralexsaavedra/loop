/* The public basics of the food log: every food of the public food DB (data/nutrition/ingredients.json)
 * as a compact, localized list the add sheet's "Mis productos" search also looks in (web/src/tabs/Dia.astro
 * bakes it as FOOD_BASICS; web/src/client/food.js logs a pick as a quick entry through the shared
 * formula, lib/nutrition/foodlog.mjs basicEntry / basicLabel). One entry per food:
 *   {k: key, n: localized name, u: 'g' | 'ml' | 'ud', m: [kcal, protein, carbs, fat] per 100 of u
 *    (a 'ud' food: per one unit, the DB's UD_AMT scale), pc?: the piece (lib/nutrition/units.mjs pieceFmt:
 *    {a, r, o, m}), v?: 1 = a verified product label (everything else is an average table value)}.
 * Sorted by the accent- and case-insensitive name (plain code-unit order, not Intl, whose ICU builds
 * disagree), so builds stay byte-identical. Pure, no I/O. */
import { ingName } from './names.mjs';
import { pieceFmt } from './units.mjs';

export const BASIC_UNITS = Object.freeze(['g', 'ml', 'ud']);

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (v) => Math.round(v * 100 + 1e-9) / 100;

/** Lower case without accents: what the search compares ("Plátano" -> "platano"). food.js ports it (norm). */
export function normName(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** The compact basics list in `lang` (see the header); foods without all four macros, a positive
 * `per` or a known unit are left out. */
export function buildBasics(ING, lang = 'en') {
  const pcs = pieceFmt(ING, lang);
  const out = [];
  for (const [k, ing] of Object.entries(ING || {})) {
    if (!ing || !BASIC_UNITS.includes(ing.unit) || !(ing.per > 0)) continue;
    const vals = [ing.k, ing.p, ing.c, ing.g];
    if (!vals.every(fin)) continue;
    const f = 100 / ing.per;
    const b = { k, n: ingName(ING, k, lang), u: ing.unit, m: vals.map((v) => round2(v * f)) };
    if (pcs[k]) b.pc = pcs[k];
    if (ing.verified === true) b.v = 1;
    out.push(b);
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return out.sort((a, b) => cmp(normName(a.n), normName(b.n)) || cmp(a.k, b.k));
}
