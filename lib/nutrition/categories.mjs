/* Food categories of the public food DB (data/nutrition/ingredients.json, `cat` on every ingredient):
 * a small CLOSED set. They decide which dayPlan parts the portion scaling may grow (lib/nutrition/flex.mjs:
 * carb / fruit, carb-staple sweets) and which foods Plan de hoy's portion guide offers as the example of
 * a macro (lib/nutrition/guide.mjs: protein; carb / legume / fruit; fat). Cheese is its own category, so
 * a slice of cheese is never read as milk. Pure, no I/O. */

export const FOOD_CATS = Object.freeze(['protein', 'carb', 'legume', 'fruit', 'veg', 'dairy', 'cheese', 'fat', 'sweet', 'drink', 'sauce', 'other']);

const isCat = (c) => typeof c === 'string' && FOOD_CATS.includes(c);

/** Ingredient `key`'s category, or null (no ingredient, no / unknown cat). */
export function catOf(ING, key) {
  if (!ING || !Object.prototype.hasOwnProperty.call(ING, key)) return null;
  const c = ING[key] && ING[key].cat;
  return isCat(c) ? c : null;
}

/** A missing `cat` is a WARNING (that food never auto-scales and is never a guide example), an unknown
 * one an error; `swap` (optional; false marks a log-only basic added for the food log — kept as data,
 * it no longer changes the page) must be a boolean. */
export function validateIngredientCats(ING) {
  const errors = [];
  const warnings = [];
  const list = FOOD_CATS.join(', ');
  for (const [key, ing] of Object.entries(ING || {})) {
    const c = ing && ing.cat;
    if (c == null) warnings.push(`ingredient ${key} has no cat (it never scales by category nor shows as a guide example); add one of ${list}`);
    else if (!isCat(c)) errors.push(`ingredient ${key}: cat must be one of ${list} (got ${JSON.stringify(c)})`);
    if (ing && ing.swap != null && typeof ing.swap !== 'boolean') errors.push(`ingredient ${key}: swap must be true or false when present (got ${JSON.stringify(ing.swap)})`);
  }
  return { errors, warnings };
}
