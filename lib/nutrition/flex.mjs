/* Which dayPlan parts the portion scaling (lib/nutrition/scale.mjs) may grow or shrink — the CARB-FLEX
 * parts. Three sources, in this order:
 *   1. `flex: null` on a part opts it OUT (always fixed);
 *   2. an explicit `flex: "carb"` (FLEX_KINDS) opts it IN (also a manual block, scaled as a whole);
 *   3. otherwise by FOOD CATEGORY (lib/nutrition/categories.mjs): an `{ing}` part whose food is
 *      auto-flex (autoFlexIng), or a `{use, match}` item whose recipe lines are ALL auto-flex foods.
 *      A manual block, a mixed composite (rice + chicken) and a food without category stay fixed.
 * auto-flex food = category carb or fruit, or a sweet that is a carb staple (honey, jam: >=
 * CARB_STAPLE_SHARE of its kcal from carbs) — chocolate, ice cream or pastries never grow to fill carbs.
 * Spreading the carbs over every such part (instead of the 2–3 marked ones) plus the per-food portion
 * caps (`maxAmt`, lib/nutrition/amounts.mjs) is what keeps one plate from absorbing a whole day's carbs.
 *
 * isFlexItem is the looser test of a PICK (lib/nutrition/blocks.mjs): an option replacing a flex part
 * stays flex when each of its lines is an auto-flex food OR a carb staple by share. Pure, no I/O. */
import { FLEX_KINDS } from './macros.mjs';
import { catOf } from './categories.mjs';

export const CARB_STAPLE_SHARE = 0.6;
export const AUTO_FLEX_CATS = Object.freeze(['carb', 'fruit']);
// categories whose foods are auto-flex only when they are carb staples (honey, jam)
export const AUTO_FLEX_STAPLE_CATS = Object.freeze(['sweet']);

function stapleIng(ING, key) {
  const ing = ING[key];
  if (!ing) return false;
  const kc = 4 * ing.p + 4 * ing.c + 9 * ing.g;
  return kc > 0 && (4 * ing.c) / kc >= CARB_STAPLE_SHARE;
}

/** A recipe whose every ingredient gets >= CARB_STAPLE_SHARE of its kcal from carbs (rice, pasta,
 * bread, potato, oats, fruit, honey…). A manual block is never a staple. */
export function isCarbStaple(ING, item) {
  if (!item || !Array.isArray(item.recipe) || !item.recipe.length) return false;
  return item.recipe.every((l) => Object.prototype.hasOwnProperty.call(ING, l.ing) && stapleIng(ING, l.ing));
}

/** Ingredient `key` scales automatically: category carb / fruit, or a sweet carb staple. */
export function autoFlexIng(ING, key) {
  const cat = catOf(ING, key);
  if (!cat) return false;
  if (AUTO_FLEX_CATS.includes(cat)) return true;
  return AUTO_FLEX_STAPLE_CATS.includes(cat) && stapleIng(ING, key);
}

const hasRecipe = (item) => !!item && Array.isArray(item.recipe) && item.recipe.length > 0;

/** A pick (list option or food) may stay flex: every line an auto-flex food or a carb staple by share. */
export function isFlexItem(ING, item) {
  if (!hasRecipe(item)) return false;
  return item.recipe.every((l) => autoFlexIng(ING, l.ing) || stapleIng(ING, l.ing));
}

/** dayPlan part `part` is carb-flex (see the header). `nut` = buildNutrition() result. */
export function isFlexPart(nut, part) {
  if (!part) return false;
  if (Object.prototype.hasOwnProperty.call(part, 'flex') && part.flex === null) return false;
  if (FLEX_KINDS.includes(part.flex)) return true;
  if (part.ing) return autoFlexIng(nut.ING, part.ing);
  if (!part.use) return false;
  const item = nut.findItem(part);
  return hasRecipe(item) && item.recipe.every((l) => autoFlexIng(nut.ING, l.ing));
}
