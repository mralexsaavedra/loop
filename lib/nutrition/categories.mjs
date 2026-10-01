/* Food categories of the public food DB (data/nutrition/ingredients.json, `cat` on every ingredient)
 * and the swap rule of each. A fixed `{ing}` part of the day plan is a choosable block whose options
 * are the ingredients of the SAME category (lib/nutrition/blocks.mjs): the rule says what a swap keeps
 * equal to the default food, and whether a "none" option is offered.
 *
 *   by     = what the swapped amount keeps equal to the default (SWAP_BY): protein / carbs / fat grams,
 *            kcal, or the same weight (veg is ~free, so the same grams);
 *   skip   = a "none" option is offered (skipping a vegetable, a fruit, a sweet, the milk in a coffee,
 *            the cheese, a drink or a sauce is sensible; skipping the protein, the carbs or the cooking fat is not).
 *
 * The factor against the default's weight is clamped like the protein swaps of the list blocks
 * (PROTEIN_SCALE_MIN–MAX, 0.5–2×), so a swap never becomes absurd. Pure, no I/O. */

export const SWAP_BY = Object.freeze({ protein: 'protein', carbs: 'carbs', fat: 'fat', kcal: 'kcal', weight: 'weight' });

export const CAT_RULES = Object.freeze({
  protein: Object.freeze({ by: SWAP_BY.protein, skip: false }),
  carb: Object.freeze({ by: SWAP_BY.carbs, skip: false }),
  legume: Object.freeze({ by: SWAP_BY.carbs, skip: false }),
  fruit: Object.freeze({ by: SWAP_BY.carbs, skip: true }),
  veg: Object.freeze({ by: SWAP_BY.weight, skip: true }),
  dairy: Object.freeze({ by: SWAP_BY.kcal, skip: true }),
  // cheese is not milk: its own category, so a slice of cheese is never offered in place of the coffee's milk
  cheese: Object.freeze({ by: SWAP_BY.kcal, skip: true }),
  fat: Object.freeze({ by: SWAP_BY.fat, skip: false }),
  sweet: Object.freeze({ by: SWAP_BY.carbs, skip: true }),
  drink: Object.freeze({ by: SWAP_BY.kcal, skip: true }),
  sauce: Object.freeze({ by: SWAP_BY.kcal, skip: true }),
  other: Object.freeze({ by: SWAP_BY.weight, skip: false }),
});

export const FOOD_CATS = Object.freeze(Object.keys(CAT_RULES));
/** The option key of "none" in a food block (so no ingredient may use it as its key). */
export const NONE_KEY = 'none';

const isCat = (c) => typeof c === 'string' && Object.prototype.hasOwnProperty.call(CAT_RULES, c);

/** Ingredient `key`'s category, or null (no ingredient, no / unknown cat). */
export function catOf(ING, key) {
  if (!ING || !Object.prototype.hasOwnProperty.call(ING, key)) return null;
  const c = ING[key] && ING[key].cat;
  return isCat(c) ? c : null;
}

/** A missing `cat` is a WARNING (that food stays a fixed part), an unknown one an error; `swap` (optional,
 * false = a log-only basic: never a swap option, its own part stays fixed — lib/nutrition/blocks.mjs) must
 * be a boolean. */
export function validateIngredientCats(ING) {
  const errors = [];
  const warnings = [];
  const list = FOOD_CATS.join(', ');
  for (const [key, ing] of Object.entries(ING || {})) {
    if (key === NONE_KEY) errors.push(`ingredient key "${NONE_KEY}" is reserved (the "none" option of a food block)`);
    const c = ing && ing.cat;
    if (c == null) warnings.push(`ingredient ${key} has no cat (Plan de hoy cannot offer swaps for it); add one of ${list}`);
    else if (!isCat(c)) errors.push(`ingredient ${key}: cat must be one of ${list} (got ${JSON.stringify(c)})`);
    if (ing && ing.swap != null && typeof ing.swap !== 'boolean') errors.push(`ingredient ${key}: swap must be true or false when present (got ${JSON.stringify(ing.swap)})`);
  }
  return { errors, warnings };
}
