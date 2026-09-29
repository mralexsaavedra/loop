/* Client-side (browser, classic-script) counterpart of es.mjs/en.mjs's
 * `verdict` function dictionaries. web/src/client/nutrition.js runs as a
 * CLASSIC script (`is:inline`, no `<script type="module">` — see spec:
 * Single self-contained output / design's Scripts row) so it cannot
 * `import` an ES module at runtime; it can only receive plain JSON-safe
 * data baked by Bake.astro (see lib/serialize.mjs `jsonForScript`).
 *
 * These are pure `{placeholder}` format strings (no functions) carrying
 * the SAME wording as es.mjs/en.mjs's `verdict.*` functions, substituted
 * client-side by a tiny `format(tpl, vars)` helper in nutrition.js. Keep
 * these two in sync — web/test/i18n.test.mjs checks both dicts expose the
 * same keys AND that every `{placeholder}` used here also appears in the
 * matching es/en `verdict` function's parameter list (best-effort guard
 * against drift, not a byte-for-byte prose check).
 */
export const es = {
  proteinOk: 'Proteína ✓ — {p} g',
  proteinShort: 'Proteína algo corta ({p} g, objetivo ~{t}). Suma un anclaje (~25 g) o sube la ración.',
  proteinVeryShort: 'Proteína muy corta ({p} g, objetivo ~{t}). Añade proteína magra.',
  overBudget: 'Te pasas ~{diff} kcal. Para cuadrar: {cuts}.',
  underBudget: 'Vas ~{under} kcal por debajo. Bien para definición si no tienes hambre; si la tienes, sube el carbo (no bajes proteína).',
  onTarget: 'Calorías en objetivo ({signedDiff} kcal).',
  fatHigh: 'Grasa alta ({g} g). Suele venir de proteína roja o carbo aceitoso — cambia a verde/patata.',
  cutExtras: 'los extras pesan ~{kcal} kcal',
  cutDessert: 'aligera el postre (fruta o yogur solo)',
  cutDinnerCarb: 'baja una porción el carbo de la cena',
  alcohol: '🍺 {n} {name} ≈ {kcal} kcal de alcohol (vacías, frenan la quema de grasa esa noche). Recorta ~{kcal} kcal de carbo, no de proteína.',
  sweetTreats: '🍫 Caprichos dulces: cuéntalos como carbo del día. Si te pasas, recorta el carbo de la cena o salta el postre.',
  mealReplace: '🍢 {name} reemplaza la cena, no se suma. Si cenas {name}, no marques también proteína+carbo de cena.',
};

export const en = {
  proteinOk: 'Protein ✓ — {p} g',
  proteinShort: 'Protein a little short ({p} g, target ~{t}). Add an anchor (~25 g) or raise the serving.',
  proteinVeryShort: 'Protein very short ({p} g, target ~{t}). Add lean protein.',
  overBudget: 'You are ~{diff} kcal over. To balance: {cuts}.',
  underBudget: 'You are ~{under} kcal under. Fine for a cut if you are not hungry; if you are, raise the carb (do not drop protein).',
  onTarget: 'Calories on target ({signedDiff} kcal).',
  fatHigh: 'Fat high ({g} g). Usually from fatty protein or oily carbs — switch to lean/potato.',
  cutExtras: 'the extras weigh ~{kcal} kcal',
  cutDessert: 'lighten the dessert (fruit or plain yogurt)',
  cutDinnerCarb: 'drop a portion of the dinner carb',
  alcohol: '🍺 {n} {name} ≈ {kcal} kcal of alcohol (empty, slows fat burning that evening). Trim ~{kcal} kcal of carbs, not protein.',
  sweetTreats: "🍫 Sweet treats: count them as the day's carbs. If you go over, cut the dinner carb or skip dessert.",
  mealReplace: '🍢 {name} REPLACES dinner, it does not add to it. If you have {name}, do not also mark dinner protein+carb.',
};
