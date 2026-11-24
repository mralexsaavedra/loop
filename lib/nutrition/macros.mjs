/* Pure nutrition macro computation over ingredients.json + plan-data.json: the resolved items (D, EX), the
 * breakfast tables, the fruit summary and the macro helpers data/nutrition/generate.mjs and the page build
 * use. No I/O: the same (ingredients, plan) input always gives the same output. */

import { validateTargets } from './targets.mjs';
import { validateFuelItems } from './fuel.mjs';
import { MEAL_SLOTS } from './slots.mjs';
import { validateIngredientMeta } from './units.mjs';
import { validateIngredientNames } from './names.mjs';
import { validateIngredientCats } from './categories.mjs';
import { validateIngredientCaps } from './amounts.mjs';

/** One of the four plan macros: k = kcal, p = protein, c = carbs, g = fat (grams).
 * @typedef {'k' | 'p' | 'c' | 'g'} MacroKey */
/** The four plan macros of a food amount, an item, a part or a day.
 * @typedef {{k: number, p: number, c: number, g: number}} PlanMacros */
/** One food of the public food DB (data/nutrition/ingredients.json `ingredients`): units.mjs DbIngredient plus
 * the flags of basics.mjs / categories.mjs (`verified`, `basic`, `swap`) and the free `note`.
 * @typedef {import('./units.mjs').DbIngredient & {verified?: boolean, basic?: boolean, swap?: boolean, note?: string}} Food */
/** The food DB by ingredient key.
 * @typedef {Record<string, Food>} FoodDB */
/** One recipe line: `amt` of ingredient `ing` in its unit; `group` merges breakfast-table rows.
 * @typedef {{ing: string, amt: number, label?: string, glabel?: string, group?: string, q?: string, link?: string}} RecipeLine */
/** A plan option or extras item (plan-data.json `data` / `extras`): a recipe, a manual block or `none`.
 * @typedef {{n?: string, l?: string, cap?: string, q?: string, t?: string, cat?: string, tier?: string, note?: string,
 *   none?: boolean, recipe?: RecipeLine[], manual?: PlanMacros}} PlanItem */
/** A plan item with its macros resolved (resolveItem): recipe / manual / tier / cap dropped.
 * @typedef {Omit<PlanItem, 'recipe' | 'manual' | 'tier' | 'cap'> & PlanMacros} ResolvedItem */
/** A `data` category: a list of items, or an object of lists (by day type / tier).
 * @typedef {PlanItem[] | Record<string, PlanItem[]>} PlanBucket */
/** @typedef {ResolvedItem[] | Record<string, ResolvedItem[]>} ResolvedBucket */
/** A dayPlan part of one food: `amt` of ingredient `ing`.
 * @typedef {{ing: string, amt: number, label?: string, flex?: string | null, use?: undefined, tier?: undefined, match?: undefined}} IngPart */
/** A dayPlan part pointing at a `data` item: bucket `use` (sub-list `tier`), item named / labelled `match`.
 * @typedef {{use: string, match: string, tier?: string, label?: string, flex?: string | null, ing?: undefined, amt?: undefined}} MatchPart */
/** @typedef {IngPart | MatchPart} DayPart */
/** @typedef {{parts: DayPart[], name?: string, slot?: string, jump?: string, desc?: string, pcf?: unknown}} PlanMeal */
/** @typedef {{meals: PlanMeal[], kcalNote?: string}} PlanDay */
/** The fields of plan-data.json (loop-data/cache/plan.json) buildNutrition reads (assertPlanStructure checked them).
 * @typedef {{data: Record<string, PlanBucket>, extras: Record<string, PlanItem>, dayPlan: Record<string, PlanDay>,
 *   quesoKeys?: string[], vegKeys?: string[], legumeKeys?: string[], legumePlate?: number}} Plan */
/** A breakfast table row before rounding (breakfastRows).
 * @typedef {PlanMacros & {name: string, q: string | null, link: string | null, amt: number, unit: string}} BrkRow */
/** buildNutrition's result (`nut` across lib/nutrition).
 * @typedef {ReturnType<typeof buildNutrition>} Nutrition */

// the part markers lib/nutrition/scale.mjs knows how to scale
export const FLEX_KINDS = Object.freeze(['carb']);

/** @param {number} n */
const rk = (n) => Math.round(n); // kcal -> integer
/** @param {number} n */
const rm = (n) => Math.round(n * 10) / 10; // macros -> 1 decimal (.0 dropped)
/** @param {number} n */
const nd = (n) => { const r = Math.round(n * 10) / 10; return String(r).replace('.', ','); }; // 1 decimal, comma sep
/** @param {number | string} n */
const dotThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** @type {MacroKey[]} */
const MACRO_KEYS = ['k', 'p', 'c', 'g'];
// tier / cap are breakfast-table-only; recipe / manual are replaced by the resolved macros
/** @type {Record<string, 1>} */
const RESOLVE_SKIP = { recipe: 1, manual: 1, tier: 1, cap: 1 };

/** One macro (`key` of k / p / c / g) of a recipe [{ing, amt}], unrounded; an unknown ingredient throws.
 * @param {FoodDB} ING @param {RecipeLine[]} recipe @param {MacroKey} key @returns {number} */
function recipeMacro(ING, recipe, key) {
  return recipe.reduce((s, r) => {
    const ing = ING[r.ing];
    if (!ing) throw new Error('unknown ingredient: ' + r.ing);
    return s + ing[key] * (r.amt / ing.per);
  }, 0);
}

/** A plan item with its macros resolved: from its recipe (kcal whole, macros 1 decimal), its manual block or
 * zero (`none`); its other fields copied.
 * @param {FoodDB} ING @param {PlanItem} o @returns {ResolvedItem} */
function resolveItem(ING, o) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of /** @type {(keyof PlanItem)[]} */ (Object.keys(o))) {
    if (!RESOLVE_SKIP[k]) out[k] = o[k];
  }
  if (o.recipe) {
    out.k = rk(recipeMacro(ING, o.recipe, 'k'));
    MACRO_KEYS.slice(1).forEach((f) => { out[f] = rm(recipeMacro(ING, /** @type {RecipeLine[]} */ (o.recipe), f)); });
  } else if (o.manual) {
    MACRO_KEYS.forEach((f) => { out[f] = /** @type {PlanMacros} */ (o.manual)[f]; });
  } else if (o.none) {
    MACRO_KEYS.forEach((f) => { out[f] = 0; });
  } else {
    throw new Error('item has neither recipe, manual nor none: ' + (o.n || o.l));
  }
  return /** @type {ResolvedItem} */ (out);
}

/** plan.data resolved category by category (an array, or {sub: array}).
 * @param {Record<string, PlanBucket>} RAW @param {(o: PlanItem) => ResolvedItem} resolve
 * @returns {Record<string, ResolvedBucket>} */
function resolveData(RAW, resolve) {
  /** @type {Record<string, ResolvedBucket>} */
  const D = {};
  for (const [cat, v] of Object.entries(RAW)) {
    if (Array.isArray(v)) D[cat] = v.map(resolve);
    else {
      D[cat] = {};
      for (const [sub, arr] of Object.entries(v)) /** @type {Record<string, ResolvedItem[]>} */ (D[cat])[sub] = arr.map(resolve);
    }
  }
  return D;
}

/** One macro of one recipe line, unrounded; an unknown ingredient throws.
 * @param {FoodDB} ING @param {RecipeLine} line @param {MacroKey} key @returns {number} */
function lineMacroOf(ING, line, key) {
  const ing = ING[line.ing];
  if (!ing) throw new Error('unknown ingredient: ' + line.ing);
  return ing[key] * (line.amt / ing.per);
}

/** A breakfast recipe's table rows: one per line, lines sharing a `group` merged into the row that opened it.
 * @param {FoodDB} ING @param {RecipeLine[]} recipe @returns {BrkRow[]} */
function breakfastRows(ING, recipe) {
  /** @type {BrkRow[]} */
  const rows = [];
  /** @type {Record<string, number>} */
  const byGroup = {};
  for (const line of recipe) {
    const ing = ING[line.ing];
    const m = { k: lineMacroOf(ING, line, 'k'), p: lineMacroOf(ING, line, 'p'), c: lineMacroOf(ING, line, 'c'), g: lineMacroOf(ING, line, 'g') };
    if (line.group && byGroup[line.group] != null) { // merge into the row that opened this group
      const row = rows[byGroup[line.group]];
      row.amt += line.amt;
      MACRO_KEYS.forEach((f) => { row[f] += m[f]; });
      continue;
    }
    if (line.group) byGroup[line.group] = rows.length;
    rows.push({
      name: line.glabel || line.label || line.ing, q: line.q || null, link: line.link || null,
      amt: line.amt, unit: ing.unit, k: m.k, p: m.p, c: m.c, g: m.g,
    });
  }
  return rows;
}
/** @param {BrkRow} row @returns {string} */
const brkQty = (row) => (row.q ? row.q : (row.unit === 'ud' ? String(row.amt / 100) : row.amt + ' ' + row.unit));

/** The raw data item a `{use, tier?, match}` dayPlan part points at (exact name/label first, then
 * the first substring hit); throws when nothing matches.
 * @param {Record<string, PlanBucket>} RAW @param {MatchPart} part @returns {PlanItem} */
function findPlanItem(RAW, part) {
  const bucket = part.tier ? (RAW[part.use] && /** @type {Record<string, PlanItem[]>} */ (RAW[part.use])[part.tier]) : RAW[part.use];
  if (!Array.isArray(bucket)) throw new Error('dayPlan part: no items at data.' + part.use + (part.tier ? '.' + part.tier : ''));
  const m = part.match;
  /** @param {(o: PlanItem) => unknown} pred */
  const find = (pred) => bucket.find(pred);
  const item =
    find((o) => o.n === m) ||
    find((o) => o.l === m) ||
    find((o) => o.n && o.n.includes(m)) ||
    find((o) => o.l && o.l.includes(m));
  if (!item) throw new Error('dayPlan part: no match for "' + m + '" in data.' + part.use + (part.tier ? '.' + part.tier : ''));
  return item;
}

/** A dayPlan part's macros, unrounded: an `{ing, amt}` part from the ingredient, a `{use, match}` part from
 * the resolved item it points at.
 * @param {FoodDB} ING @param {Record<string, PlanBucket>} RAW @param {DayPart} part @returns {PlanMacros} */
function partMacros(ING, RAW, part) {
  if (part.ing) {
    const ing = ING[part.ing];
    if (!ing) throw new Error('dayPlan part: unknown ingredient: ' + part.ing);
    const f = part.amt / ing.per;
    return { k: ing.k * f, p: ing.p * f, c: ing.c * f, g: ing.g * f };
  }
  const r = resolveItem(ING, findPlanItem(RAW, /** @type {MatchPart} */ (part)));
  return { k: r.k, p: r.p, c: r.c, g: r.g };
}

/** Tablas' breakfast tables: per breakfast item a caption and its recipe rows, ready to render (structuralErrors
 * checked that data.desayuno is a list and every non-`none` breakfast has a recipe).
 * @param {FoodDB} ING @param {Record<string, PlanBucket>} RAW */
function breakfastTables(ING, RAW) {
  return /** @type {PlanItem[]} */ (RAW.desayuno || []).filter((o) => !o.none).map((item) => {
    const r = resolveItem(ING, item);
    return {
      cap: `${item.tier} ${item.cap} · ~${r.k} kcal · ${Math.round(r.p)} P · ${Math.round(r.c)} C · ${Math.round(r.g)} G`,
      rows: breakfastRows(ING, /** @type {RecipeLine[]} */ (item.recipe)).map((row) => ({
        name: row.name,
        link: row.link || null,
        qty: brkQty(row),
        k: rk(row.k),
        p: nd(row.p),
        c: nd(row.c),
        g: nd(row.g),
      })),
    };
  });
}

/** The fruit line of the dessert table, from the plan's fruit items (D.postre, `cat === 'fruit'`, already
 * rounded): kcal and carbs (which vary across fruit) as a min-max range, protein and fat (near constant) as
 * one rounded mean; null when the plan has no fruit (structuralErrors checked that data.postre is a list).
 * @param {Record<string, ResolvedBucket>} D */
function fruitSummaryOf(D) {
  const fruitItems = /** @type {ResolvedItem[]} */ (D.postre || []).filter((o) => o.cat === 'fruit');
  return fruitItems.length ? {
    kMin: Math.min(...fruitItems.map((o) => o.k)),
    kMax: Math.max(...fruitItems.map((o) => o.k)),
    cMin: Math.min(...fruitItems.map((o) => o.c)),
    cMax: Math.max(...fruitItems.map((o) => o.c)),
    p: Math.round(fruitItems.reduce((s, o) => s + o.p, 0) / fruitItems.length),
    g: Math.round(fruitItems.reduce((s, o) => s + o.g, 0) / fruitItems.length),
  } : null;
}

/** The plan's numbers and helpers over the food DB (`nut` across lib/nutrition); run assertPlanStructure first.
 * @param {FoodDB} ingredients @param {Plan} plan */
export function buildNutrition(ingredients, plan) {
  const ING = ingredients;
  const {
    data: RAW,
    extras: RAWEX,
    quesoKeys: QUESO,
    vegKeys: VEG,
    dayPlan: DAYPLAN,
    legumeKeys: LEGUMES,
    legumePlate: LEGUME_PLATE,
  } = plan;

  const MACRO = MACRO_KEYS.slice();
  /** @param {RecipeLine[]} recipe @param {MacroKey} key */
  const macro = (recipe, key) => recipeMacro(ING, recipe, key);
  /** @param {PlanItem} o */
  const resolve = (o) => resolveItem(ING, o);
  /** @param {RecipeLine} line @param {MacroKey} key */
  const lineMacro = (line, key) => lineMacroOf(ING, line, key);
  /** @param {RecipeLine[]} recipe */
  const brkRows = (recipe) => breakfastRows(ING, recipe);
  /** @param {DayPart} part */
  const resolvePart = (part) => partMacros(ING, RAW, part);
  /** A `{use, match}` part's raw item (an `{ing}` part has none: callers check `part.use` first).
   * @param {DayPart} part */
  const findItem = (part) => findPlanItem(RAW, /** @type {MatchPart} */ (part));
  /** @param {PlanMeal} meal @returns {PlanMacros} */
  const mealMacros = (meal) => meal.parts.reduce((s, part) => {
    const m = resolvePart(part);
    return { k: s.k + m.k, p: s.p + m.p, c: s.c + m.c, g: s.g + m.g };
  }, { k: 0, p: 0, c: 0, g: 0 });
  // a base day's kcal, from the same mealMacros the tables use
  /** @param {string} day */
  const dayTotalK = (day) => rk(DAYPLAN[day].meals.reduce((s, m) => s + mealMacros(m).k, 0));

  // resolved copies: the page's tables and plan-tables.md
  const D = resolveData(RAW, resolve);
  /** @type {Record<string, ResolvedItem>} */
  const EX = {};
  for (const [k, o] of Object.entries(RAWEX)) EX[k] = resolve(o);

  return {
    ING, RAW, RAWEX, QUESO, VEG, DAYPLAN, LEGUMES, LEGUME_PLATE,
    D, EX, MACRO, rk, rm, nd, dotThousands,
    resolve, macro, lineMacro, brkRows, brkQty, resolvePart, findItem, mealMacros,
    dayTotalK,
    breakfast: breakfastTables(ING, RAW), fruitSummary: fruitSummaryOf(D),
  };
}

/* ---------- integrity validation: the failure modes that would silently corrupt the plan numbers ---------- */
// Default day-total kcal sanity band — a gross-bad-edit guard, not a target.
const DEFAULT_KCAL_BAND = Object.freeze({ train: [2000, 2800], rest: [1700, 2400] });

/** Top-level plan keys of the removed day builder: accepted, ignored, warned about by validateNutrition. */
const LEGACY_PLAN_KEYS = Object.freeze(['extrasDisplay', 'indulgeKeys', 'alcoholKeys', 'mealReplaceKeys']);

/** The shape buildNutrition walks in `data` (an object): every category is a list of item objects, or an object
 * whose every value is such a list (carboComida / carboCena by day type). One line per problem, [] when it fits.
 * The data service mirrors this rule in validateDocument (services/loop-ingest/src/documents.js, pinned by
 * scripts/documents.test.mjs).
 * @param {Record<string, unknown>} data @returns {string[]} */
export function dataShapeErrors(data) {
  /** @type {string[]} */
  const errors = [];
  /** @param {unknown} v @returns {v is Record<string, unknown>} */
  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  /** @param {unknown[]} list @param {string} at */
  const items = (list, at) => list.forEach((o, i) => { if (!isObj(o)) errors.push(`${at}[${i}] must be an object (a plan item)`); });
  for (const [cat, v] of Object.entries(data)) {
    if (Array.isArray(v)) items(v, `data.${cat}`);
    else if (isObj(v)) {
      for (const [sub, list] of Object.entries(v)) {
        if (Array.isArray(list)) items(list, `data.${cat}.${sub}`);
        else errors.push(`data.${cat}.${sub} must be a list of plan items`);
      }
    } else errors.push(`data.${cat} must be a list or an object of lists of plan items`);
  }
  return errors;
}

/** The checks buildNutrition needs to even run: every {ing} reference resolves and both day plans exist. All
 * of them are collected first, so one run reports every problem instead of the first one buildNutrition hits.
 * @param {FoodDB} ingredients
 * @param {any} plan the parsed plan JSON, untrusted: every field is checked here before it is read
 * @returns {string[]} */
function structuralErrors(ingredients, plan) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Set<string>} */
  const seen = new Set();
  // every {ing} node needs a positive numeric amt: a missing one computes NaN, a string one concatenates
  /** @param {any} o any JSON node of the plan @param {string} at @returns {void} */
  const walk = (o, at) => {
    if (Array.isArray(o)) return o.forEach((v, i) => walk(v, `${at}[${i}]`));
    if (!o || typeof o !== 'object') return;
    if (typeof o.ing === 'string' && !ingredients[o.ing] && !seen.has(o.ing)) {
      seen.add(o.ing);
      errors.push('references unknown ingredient: ' + o.ing);
    }
    if (typeof o.ing === 'string' && !(typeof o.amt === 'number' && Number.isFinite(o.amt) && o.amt > 0)) {
      errors.push(`${at} {ing: ${JSON.stringify(o.ing)}} needs a numeric amt > 0 (got ${JSON.stringify(o.amt)})`);
    }
    for (const k of Object.keys(o)) walk(o[k], `${at}.${k}`);
  };
  /** @param {unknown} v @returns {v is Record<string, any>} */
  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(plan.data)) errors.push('data must be an object');
  else errors.push(...dataShapeErrors(plan.data));
  if (!isObj(plan.extras)) errors.push('extras must be an object (use {} when the plan has none)');
  else for (const [k, o] of Object.entries(plan.extras)) if (!isObj(o)) errors.push(`extras.${k} must be an object`);
  // the breakfast tables list a breakfast's ingredients, so every breakfast but the "none" row needs a recipe
  // (a manual block has no ingredients to list)
  const desayuno = isObj(plan.data) ? plan.data.desayuno : null;
  if (desayuno != null && !Array.isArray(desayuno)) errors.push('data.desayuno must be a list');
  else for (const o of desayuno || []) {
    if (o && !o.none && !Array.isArray(o.recipe)) errors.push(`data.desayuno "${(o && (o.n || o.l)) || '?'}" needs a recipe (a list of {ing, amt}); a manual block is not supported for a breakfast`);
  }
  if (isObj(plan.data) && plan.data.postre != null && !Array.isArray(plan.data.postre)) errors.push('data.postre must be a list');
  walk(plan.data, 'data'); walk(plan.extras, 'extras'); walk(plan.dayPlan, 'dayPlan');
  if (isObj(plan.data)) forEachItem(plan.data, (o, at) => errors.push(...itemErrors(o, at)));
  if (isObj(plan.extras)) for (const [k, o] of Object.entries(plan.extras)) if (isObj(o)) errors.push(...itemErrors(o, `extras.${k}`));
  for (const day of ['train', 'rest']) {
    const d = plan.dayPlan && plan.dayPlan[day];
    if (!d || typeof d !== 'object' || !Array.isArray(d.meals)) { errors.push(`dayPlan.${day} must be an object with a "meals" array`); continue; }
    d.meals.forEach((/** @type {unknown} */ meal, /** @type {number} */ mi) => {
      if (!isObj(meal) || !Array.isArray(meal.parts)) errors.push(`dayPlan.${day}.meals[${mi}] must be an object with a "parts" array`);
      else meal.parts.forEach((/** @type {unknown} */ part, /** @type {number} */ pi) => errors.push(...partErrors(plan.data, part, `dayPlan.${day}.meals[${mi}].parts[${pi}]`)));
    });
  }
  for (const k of ['quesoKeys', 'vegKeys', 'legumeKeys']) {
    const v = plan[k];
    if (v != null && !(Array.isArray(v) && v.every((/** @type {unknown} */ x) => typeof x === 'string'))) errors.push(`${k} must be a list of ingredient / extras keys (strings) when present`);
  }
  return errors;
}

/** A JSON object (not null, not a list); its fields stay unchecked (`any`) for the caller to check.
 * @param {unknown} v @returns {v is Record<string, any>} */
const isPlainObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** Calls fn(item, at) for every object item of plan.data (a list, or an object of lists).
 * @param {Record<string, unknown>} data @param {(o: Record<string, any>, at: string) => void} fn */
function forEachItem(data, fn) {
  /** @param {unknown} v @param {string} at */
  const list = (v, at) => { if (Array.isArray(v)) v.forEach((o, i) => { if (isPlainObj(o)) fn(o, `${at}[${i}]`); }); };
  for (const [cat, v] of Object.entries(data)) {
    if (Array.isArray(v)) list(v, `data.${cat}`);
    else if (isPlainObj(v)) for (const [sub, l] of Object.entries(v)) list(l, `data.${cat}.${sub}`);
  }
}

/** The fields resolveItem and the match lookup read from one plan item (a data item or an extras entry): n / l
 * strings, and a recipe (a list of {ing, amt} objects), a manual block (an object) or `none`.
 * @param {Record<string, any>} o @param {string} at @returns {string[]} */
function itemErrors(o, at) {
  /** @type {string[]} */
  const errors = [];
  for (const f of ['n', 'l']) if (o[f] != null && typeof o[f] !== 'string') errors.push(`${at}.${f} must be a string when present`);
  if (o.recipe != null) {
    if (!Array.isArray(o.recipe)) errors.push(`${at}.recipe must be a list of {ing, amt}`);
    else o.recipe.forEach((/** @type {unknown} */ line, /** @type {number} */ i) => {
      if (!isPlainObj(line)) errors.push(`${at}.recipe[${i}] must be an object {ing, amt}`);
      else if (typeof line.ing !== 'string') errors.push(`${at}.recipe[${i}].ing must be an ingredient key (a string)`);
    });
  } else if (o.manual != null) {
    if (!isPlainObj(o.manual)) errors.push(`${at}.manual must be an object {k, p, c, g}`);
  } else if (!o.none) errors.push(`${at} needs a recipe, a manual block or "none": true`);
  return errors;
}

/** A dayPlan part: an {ing, amt} object, or a {use, tier?, match} object whose bucket exists in plan.data and
 * holds an item named / labelled `match` (exactly or as a substring, as findPlanItem looks it up).
 * @param {unknown} data @param {unknown} part @param {string} at @returns {string[]} */
function partErrors(data, part, at) {
  if (!isPlainObj(part)) return [`${at} must be an object ({ing, amt} or {use, match})`];
  if (part.ing != null) return typeof part.ing === 'string' ? [] : [`${at}.ing must be an ingredient key (a string)`];
  /** @type {string[]} */
  const errors = [];
  if (typeof part.use !== 'string') errors.push(`${at}.use must be a data category (a string)`);
  if (part.tier != null && typeof part.tier !== 'string') errors.push(`${at}.tier must be a string when present`);
  if (typeof part.match !== 'string' || !part.match) errors.push(`${at}.match must be a non-empty string`);
  if (errors.length || !isPlainObj(data)) return errors;
  const cat = data[part.use];
  const bucket = part.tier ? (isPlainObj(cat) ? cat[part.tier] : undefined) : cat;
  const where = `data.${part.use}${part.tier ? '.' + part.tier : ''}`;
  if (!Array.isArray(bucket)) return [`${at}: no items at ${where}`];
  const m = part.match;
  /** @param {unknown} o */
  const hit = (o) => isPlainObj(o) && [o.n, o.l].some((/** @type {unknown} */ v) => typeof v === 'string' && v.includes(m));
  if (!bucket.some(hit)) return [`${at}: no match for "${m}" in ${where}`];
  return [];
}

/** Throws `plan-data.json validation failed:` listing every structural problem (structuralErrors): what has to
 * hold before buildNutrition can run at all. load() (data/nutrition/generate.mjs) calls it before building.
 * @param {FoodDB} ingredients @param {unknown} plan the parsed plan JSON */
export function assertPlanStructure(ingredients, plan) {
  /** @param {unknown} v @returns {v is Record<string, any>} */
  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  const early = isObj(plan) ? structuralErrors(ingredients, plan) : ['the plan must be a JSON object'];
  if (early.length) throw new Error('plan-data.json validation failed:\n  - ' + early.join('\n  - '));
}

// A hand-typed manual block's {k, p, c, g} must agree with Atwater (4 kcal/g protein and carbs, 9 kcal/g fat)
// within MANUAL_ATWATER_TOL of its kcal or MANUAL_ATWATER_ABS_KCAL, whichever is larger. (A food LABEL has its
// own, looser tolerance: lib/nutrition/foodlog.mjs ATWATER_TOL / ATWATER_ABS_KCAL.)
export const MANUAL_ATWATER_TOL = 0.15;
export const MANUAL_ATWATER_ABS_KCAL = 25;

/** kcal from the macros (Atwater): 4 p + 4 c + 9 g.
 * @param {{p: number, c: number, g: number}} m @returns {number} */
export function atwaterKcal(m) {
  return 4 * m.p + 4 * m.c + 9 * m.g;
}

/** false only when a manual block's kcal disagree with its macros beyond the tolerance (see MANUAL_ATWATER_TOL);
 * a non-numeric field is the structural check's job, not this one's.
 * @param {PlanMacros} m @returns {boolean} */
export function manualAtwaterOk(m) {
  return !(Math.abs(atwaterKcal(m) - m.k) > Math.max(MANUAL_ATWATER_ABS_KCAL, m.k * MANUAL_ATWATER_TOL));
}

// Every {ing} reference anywhere (recipe lines, dayPlan parts, breakfast lines) and the legume keys: an
// unknown one is an error, a hand-typed manual block must pass the Atwater sanity check. Returns the used keys.
/** @param {Nutrition} nut @param {string[]} errors @returns {Set<string>} */
function referenceErrors(nut, errors) {
  const { ING, RAW, RAWEX, DAYPLAN, LEGUMES } = nut;
  /** @type {Set<string>} */
  const used = new Set();
  /** @param {any} o any JSON node of the plan @returns {void} */
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      if (typeof o.ing === 'string') {
        used.add(o.ing);
        if (!ING[o.ing]) errors.push('references unknown ingredient: ' + o.ing);
      }
      // hand-typed manual blocks are computed by nobody -> sanity-check kcal vs Atwater
      if (o.manual && !manualAtwaterOk(o.manual)) {
        errors.push(`manual block fails Atwater sanity (k=${o.manual.k} vs ~${Math.round(atwaterKcal(o.manual))}): ${o.n || o.l || '?'}`);
      }
      for (const k of Object.keys(o)) if (k !== 'ingredients') walk(o[k]);
    }
  };
  walk(RAW); walk(RAWEX); walk(DAYPLAN);
  (LEGUMES || []).forEach((k) => { used.add(k); if (!ING[k]) errors.push('legumeKeys references unknown ingredient: ' + k); });
  return used;
}

// Legacy fields of the removed day builder (Constructor de día / `registro`): an existing plan may still carry
// them. Nothing reads them any more, so they are accepted and ignored: a warning, never an error.
/** @param {any} plan the parsed plan JSON @param {string[]} warnings */
function legacyWarnings(plan, warnings) {
  for (const k of LEGACY_PLAN_KEYS) if (plan[k] != null) warnings.push(`${k} is a legacy day-builder field and is ignored (safe to delete)`);
  if (plan.page && plan.page.offPlanPlaceholder != null) warnings.push('page.offPlanPlaceholder is a legacy day-builder field and is ignored (safe to delete)');
}

/** @param {any} page the plan's `page` JSON, untrusted @param {string[]} errors */
function pageErrors(page, errors) {
  if (!page) return;
  if (typeof page.title !== 'string' || !page.title) errors.push('page.title must be a non-empty string');
  // h1 / sub are optional: without them the page opens straight onto the dials (the layout keeps a
  // visually hidden h1 from the title, so the document still has one)
  if (page.h1 != null && (typeof page.h1 !== 'string' || !page.h1)) errors.push('page.h1 must be a non-empty string when present');
  if (page.sub != null && typeof page.sub !== 'string') errors.push('page.sub must be a string when present');
  if (page.notes != null && typeof page.notes !== 'object') errors.push('page.notes must be an object when present');
}

// dayPlan `match` must resolve unambiguously (exact name/label, or exactly one substring hit)
/** @param {Record<string, PlanBucket>} RAW @param {Record<string, PlanDay>} DAYPLAN @param {string[]} errors */
function matchErrors(RAW, DAYPLAN, errors) {
  for (const day of ['train', 'rest']) {
    for (const meal of DAYPLAN[day].meals) {
      for (const part of (meal.parts || [])) {
        if (!part.match) continue;
        const bucket = part.tier ? (RAW[part.use] && /** @type {Record<string, PlanItem[]>} */ (RAW[part.use])[part.tier]) : RAW[part.use];
        if (!Array.isArray(bucket)) { errors.push(`dayPlan ${day} part: no bucket data.${part.use}${part.tier ? '.' + part.tier : ''}`); continue; }
        if (!bucket.some((o) => o.n === part.match || o.l === part.match)) {
          const hits = bucket.filter((o) => (o.n && o.n.includes(part.match)) || (o.l && o.l.includes(part.match))).length;
          if (hits !== 1) errors.push(`dayPlan ${day} part "${part.match}" resolves ambiguously (${hits} substring hits, no exact) in ${part.use}`);
        }
      }
    }
  }
}

// The food DB's optional metadata: natural units (units.mjs), realistic portion caps the scaling never exceeds
// (amounts.mjs), display names {es, en} (names.mjs; a missing one only warns, the page shows the key) and food
// categories (categories.mjs; a missing one only warns, that food is not swappable).
/** @param {FoodDB} ING @param {string[]} errors @param {string[]} warnings */
function ingredientErrors(ING, errors, warnings) {
  errors.push(...validateIngredientMeta(ING));
  errors.push(...validateIngredientCaps(ING));
  const names = validateIngredientNames(ING);
  errors.push(...names.errors);
  warnings.push(...names.warnings);
  const cats = validateIngredientCats(ING);
  errors.push(...cats.errors);
  warnings.push(...cats.warnings);
}

// meal slots and carb-flex markers of the day plans (optional)
/** @param {Record<string, PlanDay>} DAYPLAN @param {string[]} errors */
function slotFlexErrors(DAYPLAN, errors) {
  for (const day of ['train', 'rest']) {
    DAYPLAN[day].meals.forEach((meal, mi) => {
      if (meal.slot != null && !MEAL_SLOTS.includes(meal.slot)) errors.push(`dayPlan ${day} meal ${mi}: slot must be one of ${MEAL_SLOTS.join(', ')} (got ${JSON.stringify(meal.slot)})`);
      (meal.parts || []).forEach((part, pi) => {
        if (part.flex != null && !FLEX_KINDS.includes(part.flex)) errors.push(`dayPlan ${day} meal ${mi} part ${pi}: flex must be "carb" when present (got ${JSON.stringify(part.flex)})`);
      });
    });
  }
}

// Day totals within a sane band: catches a gross bad edit, not a tight target (DEFAULT_KCAL_BAND; a plan
// overrides it via plan.validation.kcalBand = { train: [min, max], rest: [min, max] }).
/** @param {any} plan the parsed plan JSON (`validation` untrusted) @param {Record<string, PlanDay>} DAYPLAN
 * @param {(meal: PlanMeal) => PlanMacros} mealMacros @param {string[]} errors */
function kcalBandErrors(plan, DAYPLAN, mealMacros, errors) {
  /** @type {Record<string, readonly number[] | null>} */
  const band = { ...DEFAULT_KCAL_BAND };
  const override = plan.validation && plan.validation.kcalBand;
  if (override != null) {
    for (const day of ['train', 'rest']) {
      const b = override[day];
      const ok = Array.isArray(b) && b.length === 2 && b.every((v) => typeof v === 'number' && Number.isFinite(v)) && b[0] < b[1];
      if (ok) band[day] = b;
      else { errors.push(`validation.kcalBand.${day} must be [min, max] with numeric min < max (got ${JSON.stringify(b)})`); band[day] = null; }
    }
  }
  for (const day of ['train', 'rest']) {
    if (!band[day]) continue;
    const total = DAYPLAN[day].meals.reduce((s, m) => s + mealMacros(m).k, 0);
    const [lo, hi] = band[day];
    // written so a NaN total (e.g. a manual block without k) fails instead of passing both comparisons
    if (!(total >= lo && total <= hi)) errors.push(`${day}-day total ${Math.round(total)} kcal outside sane band ${lo}-${hi}`);
  }
}

/** Throws one error listing every problem of the plan; else {ok: true, warnings}. Runs before every generate
 * and standalone (`node data/nutrition/generate.mjs --check`).
 * @param {FoodDB} ingredients @param {any} plan the parsed plan JSON, untrusted (assertPlanStructure checks it first) */
export function validateNutrition(ingredients, plan) {
  assertPlanStructure(ingredients, plan);
  const nut = buildNutrition(ingredients, plan);
  const { ING, RAW, DAYPLAN, EX, QUESO, VEG, mealMacros } = nut;

  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const used = referenceErrors(nut, errors);
  // Unused ingredients are a WARNING, not an error: ingredients.json is a shared public food DB that may
  // legitimately hold more foods than a given plan uses. One line with the count: listing every unused food
  // (100+ on a fresh clone) reads like a failure.
  const unused = Object.keys(ING).filter((k) => !used.has(k));
  if (unused.length) warnings.push(`${unused.length} ingredients in ingredients.json are not used by this plan (normal: it is a shared food database)`);
  // key lists must resolve to real resolved-extras entries
  [...(QUESO || []), ...(VEG || [])].forEach((k) => { if (!EX[k]) errors.push('queso/veg key has no extras entry: ' + k); });
  legacyWarnings(plan, warnings);
  pageErrors(plan.page, errors);
  matchErrors(RAW, DAYPLAN, errors);
  ingredientErrors(ING, errors, warnings);
  // nutrition v2: goal x day type targets (targets.mjs) and the user's own fuel items (fuel.mjs), both optional
  errors.push(...validateTargets(plan));
  errors.push(...validateFuelItems(plan));
  slotFlexErrors(DAYPLAN, errors);
  kcalBandErrors(plan, DAYPLAN, mealMacros, errors);
  if (errors.length) throw new Error('plan-data.json validation failed:\n  - ' + errors.join('\n  - '));
  return { ok: true, warnings };
}
