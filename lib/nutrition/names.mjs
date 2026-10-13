/* Display names of the nutrition plan, ONE rule each, shared by the scaling model (scale.mjs), the
 * portion guide (guide.mjs sorts its example foods), Tablas (reference.mjs) and plan-tables.md (generate.mjs):
 *   - an ingredient (data/nutrition/ingredients.json) is named by `name`: {es, en} resolved by the build
 *     locale (a plain string stays valid, for any language), else its key;
 *   - a recipe line by its own `label`, else its ingredient's name;
 *   - a plan option / extras item by `n`, else `cap`, else `l` (itemName: the option key, the baked
 *     option name and the Tablas row all use it).
 * Pure, no I/O. */

export const NAME_LANGS = Object.freeze(['es', 'en']);

const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';
/** {es, en} with both strings non-empty. */
export const isLocText = (o) => !!o && typeof o === 'object' && !Array.isArray(o) && NAME_LANGS.every((l) => nonEmpty(o[l]));
/** A localized {es, en} text in `lang`, falling back to en, then es; null without one. */
export const locText = (o, lang) => (o ? o[lang] || o.en || o.es : null);

/** A name folded for comparing: lower case, accents stripped ("Plátano" -> "platano"); '' for null.
 * The basics search (basics.mjs normName) and the portion guide's example order (guide.mjs roleOptions) share it;
 * web/src/client/food-*.js ports it (norm). */
export function foldName(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Ingredient `key`'s display name in `lang` (default en); its key when it has none. */
export function ingName(ING, key, lang = 'en') {
  const n = ING && ING[key] ? ING[key].name : null;
  if (nonEmpty(n)) return n;
  if (n && typeof n === 'object') return locText(n, lang) || key;
  return key;
}

/** A recipe line's display name: its `label`, else its ingredient's name in `lang`, else the key. */
export const lineName = (ING, l, lang = 'en') => l.label || ingName(ING, l.ing, lang);

/** A plan option's (or extras item's) name: `n`, else `cap`, else `l`; '' without any. */
export const itemName = (item) => String((item && (item.n || item.cap || item.l)) || '');

/** An item's own `q` states an amount ("130 g", "1 (120 g)") only when it has a digit — not a
 * placeholder like "—". */
export const hasAmount = (q) => typeof q === 'string' && /\d/.test(q);

/** Ingredient names: a missing one is a WARNING (the page falls back to the key), a malformed one an
 * error. Returns {errors, warnings}. */
export function validateIngredientNames(ING) {
  const errors = [];
  const warnings = [];
  for (const [key, ing] of Object.entries(ING || {})) {
    const n = ing && ing.name;
    if (n == null) warnings.push(`ingredient ${key} has no name (the page shows its key); add name: {es, en}`);
    else if (!nonEmpty(n) && !isLocText(n)) errors.push(`ingredient ${key}: name must be a non-empty string or {es, en} non-empty strings`);
  }
  return { errors, warnings };
}
