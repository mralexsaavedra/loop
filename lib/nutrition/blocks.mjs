/* Choosable blocks of Plan de hoy. A dayPlan part that points at an option list (`{use, tier?, match}`,
 * e.g. data.proteina, data.carboComida.train, data.postre) is a BLOCK when that list holds at least two
 * eatable options; its default option is the part's own `match`. Fixed `{ing}` parts stay fixed.
 *
 * Swap rules (swapOption; applyPicks keeps the books):
 *   - a PROTEIN-role list (BLOCK_ROLES: proteina, anclaje, postentreno) scales the picked option so it
 *     gives the SAME protein grams as the default option (factor clamped to PROTEIN_SCALE_MIN–MAX,
 *     amounts rounded like every scaled amount: 5 g / 5 ml, half pieces, whole units);
 *   - every other list (breakfasts, fruit / desserts, carb lists…) takes the option's own recipe amounts.
 *   - a pick in a carb-flex part stays flex only when the option is itself a carb staple (a recipe whose
 *     every ingredient gets >= CARB_STAPLE_SHARE of its kcal from carbs; a `manual` block never is), so
 *     the carb-flex engine (lib/nutrition/scale.mjs solveScale) re-solves the WHOLE day for whatever was
 *     picked; otherwise it becomes a fixed part.
 *
 * Stable ids (never the array position alone): a block id = `<meal key>/<list>` where the meal key is the
 * meal's slot (its `slot`, else lib/nutrition/slots.mjs mealSlot from its name), else the meal name, and
 * <list> is the part's `use` WITHOUT the tier, so a pick follows the day across train / rest
 * ("lunch/carboComida" = Pasta on both); a second block of the same list in the same meal key gets
 * `#2`, `#3`… Ids are therefore slot / list-based, NOT meal-based: two meals sharing a slot (or a name)
 * and a list get their ids BY ORDER of appearance in the day (the first `snack/anclaje`, then
 * `snack/anclaje#2`), so reordering those two meals swaps which one a stored pick lands on. An option key = its name (names.mjs itemName: `n`, else `cap`, else `l`; a repeated key
 * gets ` (2)`…), so a pick
 * survives edits that reorder a list. A pick whose key is not in today's list is ignored (default).
 *
 * The bake: `lists[<use>[.<tier>]]` = options {k, n, gr?, ln | mb, q?, c?, pr, fx?} (ln = model lines,
 * lib/nutrition/amounts.mjs, macros to 2 decimals; fx: true = a carb staple, absent = not), and per base
 * day `blocks[id]` = {L: list path, r: ROLE, d: default key, fx: boolean, the part is carb-flex}. web/src/client/nutri-day.js ports applyPicks
 * line by line (parity test). Pure, no I/O. */
import { FLEX_KINDS } from './macros.mjs';
import { mealSlot } from './slots.mjs';
import { modelLine, stepAmount, fmtAmt, scaleLine, pieceOf, LINE, lineUnit, lineAmt, lineStep } from './amounts.mjs';
import { lineName, itemName, hasAmount } from './names.mjs';
import { round2 } from './num.mjs';

/** Swap roles: `protein` keeps the default's protein grams, `own` takes the option's own amounts. */
export const ROLE = Object.freeze({ protein: 'protein', own: 'own' });
export const BLOCK_ROLES = Object.freeze({ proteina: ROLE.protein, anclaje: ROLE.protein, postentreno: ROLE.protein });
export const PROTEIN_SCALE_MIN = 0.5;
export const PROTEIN_SCALE_MAX = 2;
export const CARB_STAPLE_SHARE = 0.6;

export const roleOf = (use) => (Object.prototype.hasOwnProperty.call(BLOCK_ROLES, use) ? BLOCK_ROLES[use] : ROLE.own);
export const listPath = (part) => (part.tier ? part.use + '.' + part.tier : part.use);

/** Option keys aligned with the bucket (null for a "none" row): the option's name (names.mjs itemName:
 * `n`, else `cap`, else `l` — the same name buildOption bakes); repeats get " (2)"… */
export function optionKeys(bucket) {
  const seen = {};
  return bucket.map((o) => {
    if (!o || o.none) return null;
    const base = itemName(o);
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] === 1 ? base : `${base} (${seen[base]})`;
  });
}

/** A recipe whose every ingredient gets >= CARB_STAPLE_SHARE of its kcal from carbs (rice, pasta,
 * bread, potato, oats, fruit, honey…). A manual block is never a staple. */
export function isCarbStaple(ING, item) {
  if (!item || !Array.isArray(item.recipe) || !item.recipe.length) return false;
  return item.recipe.every((l) => {
    const ing = ING[l.ing];
    if (!ing) return false;
    const kc = 4 * ing.p + 4 * ing.c + 9 * ing.g;
    return kc > 0 && (4 * ing.c) / kc >= CARB_STAPLE_SHARE;
  });
}

/** One option of a list, compact for the bake (component names in `lang`). */
export function buildOption(nut, item, key, lang = 'en') {
  const o = { k: key, n: itemName(item) || key };
  const gr = item.t || item.cat;
  if (gr) o.gr = String(gr);
  if (Array.isArray(item.recipe) && item.recipe.length) {
    o.ln = item.recipe.map((l) => { const ln = modelLine(nut.ING, l); for (let i = LINE.K; i <= LINE.G; i++) ln[i] = round2(ln[i]); return ln; });
    if (hasAmount(item.q)) o.q = item.q;
    if (item.recipe.length > 1) o.c = item.recipe.map((l) => lineName(nut.ING, l, lang));
    o.pr = round2(o.ln.reduce((a, l) => a + l[LINE.P], 0));
    if (isCarbStaple(nut.ING, item)) o.fx = true;
  } else {
    const r = nut.resolve(item);
    o.mb = [r.k, r.p, r.c, r.g];
    o.q = item.q || '';
    o.pr = r.p;
  }
  return o;
}

/** Block ids for one base day's meals: ids[meal][part] = id | null (only `{use}` parts get one here;
 * buildBlocks keeps those whose list offers a choice). */
export function partIds(meals) {
  const used = {};
  return meals.map((meal) => {
    const mk = meal.slot || mealSlot(meal) || meal.name;
    return (meal.parts || []).map((part) => {
      if (!part || !part.use || part.ing) return null;
      const base = `${mk}/${part.use}`;
      used[base] = (used[base] || 0) + 1;
      return used[base] === 1 ? base : `${base}#${used[base]}`;
    });
  });
}

/** The blocks of base day `day` and the option lists they use (added to `lists`, shared by both days).
 * Returns {blocks: {id: {L, r, d, fx}}, ids: [[id | null]] } — ids only for real blocks. */
export function buildBlocks(nut, day, lists, lang = 'en') {
  const meals = nut.DAYPLAN[day].meals;
  const raw = partIds(meals);
  const blocks = {};
  const ids = meals.map((meal, m) => (meal.parts || []).map((part, pi) => {
    const id = raw[m][pi];
    if (!id) return null;
    const bucket = part.tier ? nut.RAW[part.use] && nut.RAW[part.use][part.tier] : nut.RAW[part.use];
    if (!Array.isArray(bucket)) return null;
    const keys = optionKeys(bucket);
    if (keys.filter((k) => k != null).length < 2) return null;
    const item = nut.findItem(part);
    const d = keys[bucket.indexOf(item)];
    if (d == null) return null;
    const L = listPath(part);
    if (!lists[L]) lists[L] = bucket.map((o, i) => (keys[i] == null ? null : buildOption(nut, o, keys[i], lang))).filter(Boolean);
    blocks[id] = { L, r: roleOf(part.use), d, fx: FLEX_KINDS.includes(part.flex) };
    return id;
  }));
  return { blocks, ids };
}

function findOpt(list, key) {
  if (!Array.isArray(list)) return null;
  for (const o of list) if (o.k === key) return o;
  return null;
}
function limitP(f) { return f < PROTEIN_SCALE_MIN ? PROTEIN_SCALE_MIN : f > PROTEIN_SCALE_MAX ? PROTEIN_SCALE_MAX : f; }

/** The protein-role factor of `opt` against the block's default (1 for any other role, or when either
 * option has no protein), rounded to 2 decimals. */
export function swapFactor(block, list, opt) {
  if (block.r !== ROLE.protein) return 1;
  const def = findOpt(list, block.d);
  if (!def || !(def.pr > 0) || !(opt.pr > 0)) return 1;
  return round2(limitP(def.pr / opt.pr));
}

/** Block `b`'s option `key` as it replaces the default part (pure, nothing mutated):
 *   { part: the display part (no id), flex: its flex entry without the meal index ({ln} | {mb, q}) when it
 *     stays carb-flex, mac: its fixed macros [k, p, c, g] otherwise }.
 * Protein roles scale to the default's protein (swapFactor); a pick stays flex only when the part is
 * carb-flex AND the option a carb staple. */
export function swapOption(b, list, key, fmt) {
  const opt = findOpt(list, key);
  const s = swapFactor(b, list, opt);
  const isFlex = b.fx === true && opt.fx === true;
  if (opt.mb) {
    const mb = opt.mb.map((v) => v * s);
    const q = s === 1 ? opt.q : `${opt.q} ×${s.toFixed(2).replace('.', fmt.dec || '.')}`.trim();
    if (isFlex) return { part: { l: opt.n, x: 1 }, flex: { mb, q } };
    return { part: { l: opt.n, q, m: mb }, mac: mb };
  }
  const ln = s === 1 ? opt.ln : opt.ln.map((l) => scaleLine(l, stepAmount(lineAmt(l) * s, lineUnit(l), lineStep(l))));
  if (isFlex) return { part: opt.c && !opt.q ? { l: opt.n, x: 1, c: opt.c } : { l: opt.n, x: 1 }, flex: { ln } };
  const mac = [0, 0, 0, 0];
  for (const l of ln) for (let i = 0; i < 4; i++) mac[i] += l[LINE.K + i];
  const amts = ln.map((l) => fmtAmt(lineAmt(l), lineUnit(l), fmt.units, pieceOf(fmt.pieces || null, l)));
  if (opt.c && (!opt.q || s !== 1)) return { part: { l: opt.n, q: amts.join(' + '), c: opt.c, a: amts, m: mac }, mac };
  return { part: { l: opt.n, q: s === 1 && opt.q ? opt.q : amts.join(' + '), m: mac }, mac };
}

/** A base day's scaling model ({fixed, flex, meals}: lib/nutrition/scale.mjs buildDayPlans' base[day])
 * with `picks` ({id: option key}) applied: {fixed, flex, meals (display), picks (the effective ones)}.
 * The swap itself is swapOption; this only keeps the books: a touched meal's fixed macros are re-summed
 * from its parts, the flex entries stay in part order (the default's entry is replaced or dropped).
 * No effective pick -> the base model itself, untouched (today's plan, byte for byte). */
export function applyPicks(base, lists, picks, fmt) {
  const blocks = base.blocks || {};
  const eff = {};
  let any = false;
  if (picks && typeof picks === 'object') {
    for (const id of Object.keys(blocks)) {
      const key = picks[id];
      if (typeof key !== 'string' || key === blocks[id].d || !findOpt(lists && lists[blocks[id].L], key)) continue;
      eff[id] = key;
      any = true;
    }
  }
  if (!any) return { fixed: base.fixed, flex: base.flex, meals: base.meals, picks: {} };
  const fixed = [];
  const flex = [];
  let fi = 0;
  const meals = base.meals.map((meal, m) => {
    const touched = meal.parts.some((p) => p.id && eff[p.id] !== undefined);
    const f = touched ? [0, 0, 0, 0] : base.fixed[m].slice();
    const parts = meal.parts.map((p) => {
      const key = p.id ? eff[p.id] : undefined;
      if (key === undefined) {
        if (p.x) flex.push(base.flex[fi++]);
        else if (touched) for (let i = 0; i < 4; i++) f[i] += p.m[i];
        return p;
      }
      if (p.x) fi++; // the default's flex entry is replaced
      const b = blocks[p.id];
      const sw = swapOption(b, lists[b.L], key, fmt);
      if (sw.flex) flex.push({ m, ...sw.flex });
      else for (let i = 0; i < 4; i++) f[i] += sw.mac[i];
      return { ...sw.part, id: p.id };
    });
    fixed.push(f);
    return { n: meal.n, s: meal.s, pcf: meal.pcf, parts };
  });
  return { fixed, flex, meals, picks: eff };
}
