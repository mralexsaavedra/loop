/* Tablas = FIXED reference values, never portions. Every food of the plan's lists shows its macros per
 * its NATURAL unit, which never changes with the goal or the day type:
 *   - a countable food (ingredients.json `piece`, lib/nutrition/units.mjs) per piece with its grams
 *     reference ("1 medium banana (~120 g)"; a typical weight is flagged as such), a sauce per tablespoon;
 *   - everything else per 100 g / 100 ml, with how the plan weighs it ("100 g raw", "100 g dry");
 *   - a `manual` option (a bowl of legumes, a soup) per serving as written (it has no per-100 basis).
 * A composite option (several recipe lines) is a group row followed by one row per component food.
 * Today's amounts live in Plan de hoy's portion guide (lib/nutrition/scale.mjs + guide.mjs), not here.
 * Rendered server-side by web/src/tabs/Tablas.astro and written to plan-tables.md by
 * data/nutrition/generate.mjs, so both show the same numbers. Pure, no I/O. */
import { ingName, lineName, locText, itemName } from './names.mjs';
import { round1, round2 } from './num.mjs';
import { ingPiece } from './units.mjs';

const DEFAULT_WORDS = Object.freeze({ raw: 'raw', dry: 'dry', cooked: 'cooked', serving: 'serving', unit: 'pc' });

/** The natural unit of ingredient `key`: {amt (in the ingredient unit), label, typical}. */
export function refUnit(ING, key, { lang = 'en', words = DEFAULT_WORDS } = {}) {
  const ing = ING[key];
  if (!ing) throw new Error('unknown ingredient: ' + key);
  const pc = ingPiece(ing);
  if (pc) {
    const ref = ing.unit === 'ud' ? (pc.g ? `~${round2(pc.g)} g` : null) : `~${round2(pc.amt)} ${ing.unit}`;
    return { amt: pc.amt, label: `1 ${locText(pc.name, lang)}` + (ref ? ` (${ref})` : ''), typical: pc.typical === true };
  }
  if (ing.unit === 'ud') return { amt: 100, label: `1 ${words.unit}`, typical: false };
  const state = ing.weighed && words[ing.weighed] ? ` ${words[ing.weighed]}` : '';
  return { amt: 100, label: `100 ${ing.unit}${state}`, typical: false };
}

/** One food row: name, natural unit, macros at that unit (kcal whole, macros to 1 decimal). */
export function foodRow(ING, key, name, opts = {}) {
  const ing = ING[key];
  const u = refUnit(ING, key, opts);
  const f = u.amt / ing.per;
  return { kind: 'food', name, unit: u.label, typical: u.typical, verified: ing.verified === true, k: Math.round(ing.k * f), p: round1(ing.p * f), c: round1(ing.c * f), g: round1(ing.g * f) };
}

/** The reference rows of one option / extras item. */
export function itemRows(nut, item, opts = {}) {
  const words = opts.words || DEFAULT_WORDS;
  const name = itemName(item);
  if (Array.isArray(item.recipe) && item.recipe.length) {
    if (item.recipe.length === 1) return [foodRow(nut.ING, item.recipe[0].ing, name, opts)];
    return [{ kind: 'group', name }, ...item.recipe.map((l) => ({ ...foodRow(nut.ING, l.ing, lineName(nut.ING, l, opts.lang), opts), sub: true }))];
  }
  if (item.manual) {
    const m = item.manual;
    return [{ kind: 'serving', name, unit: `1 ${words.serving}` + (item.q ? ` (${item.q})` : ''), typical: false, verified: false, k: Math.round(m.k), p: round1(m.p), c: round1(m.c), g: round1(m.g) }];
  }
  return [];
}

/** The rows of a list of options, the "none" rows dropped and repeated options (same name, e.g. the
 * train and rest tiers of a carb list) listed once — but only when their reference rows are EQUAL (the
 * same food at another amount); a same-named option with another recipe is listed too, never hidden. */
export function listRows(nut, items, opts = {}) {
  const seen = new Map(); // name -> the JSON of every distinct row set listed under it
  const out = [];
  for (const item of items) {
    if (!item || item.none) continue;
    const k = itemName(item);
    const rows = itemRows(nut, item, opts);
    const sig = JSON.stringify(rows);
    const sigs = seen.get(k) || [];
    if (sigs.includes(sig)) continue;
    seen.set(k, sigs.concat(sig));
    out.push(...rows);
  }
  return out;
}

const bucketOf = (RAW, use) => {
  const v = RAW[use];
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return Object.values(v).flat(); // tiers (train / rest): one list
  return [];
};

/** Every Tablas section's rows. */
export function buildReference(nut, opts = {}) {
  const RAW = nut.RAW;
  const rows = (use, filter) => listRows(nut, bucketOf(RAW, use).filter(filter || (() => true)), opts);
  const prot = (t) => rows('proteina', (o) => o.t === t);
  const extras = (keys) => (keys || []).flatMap((k) => (nut.RAWEX[k] ? itemRows(nut, { n: nut.EX[k].n || nut.EX[k].l || k, ...nut.RAWEX[k] }, opts) : []));
  return {
    desayunos: rows('desayuno'),
    carboComida: rows('carboComida'),
    carboCena: rows('carboCena'),
    proteina: { lean: prot('lean'), mod: prot('mod'), fat: prot('fat') },
    anclaje: rows('anclaje'),
    postentreno: rows('postentreno'),
    fruta: rows('postre', (o) => o.cat === 'fruit'),
    postre: rows('postre', (o) => !o.none && o.cat !== 'fruit'),
    legumes: (nut.LEGUMES || []).filter((k) => nut.ING[k]).map((k) => foodRow(nut.ING, k, ingName(nut.ING, k, opts.lang), opts)),
    verduras: extras(nut.VEG),
    quesos: extras(nut.QUESO),
  };
}
