/* Meal slots: where in the day a meal sits. A day plan meal may say it (`slot`); otherwise it is
 * guessed from the meal's name (es/en words), and a meal nothing matches has no slot. Supplements in
 * profile/profile.json name the slot they go with (`meal`), so Plan de hoy can show them under it.
 * Pure: no I/O. */

export const MEAL_SLOTS = Object.freeze(['breakfast', 'lunch', 'preworkout', 'postworkout', 'dinner', 'snack']);

// first match wins: pre/post workout before lunch/dinner words that could appear inside them
const W = (alts) => new RegExp('(?:^|[^a-z\u00e0-\u00ff])(?:' + alts + ')(?![a-z\u00e0-\u00ff])', 'i');
const NAME_RULES = [
  ['preworkout', W('pre[\\s-]?(?:entreno|workout|entrenamiento)')],
  ['postworkout', W('post[\\s-]?(?:entreno|workout|entrenamiento)')],
  ['breakfast', W('desayuno|breakfast')],
  ['lunch', W('comida|almuerzo|lunch')],
  ['dinner', W('cena|dinner|supper')],
  ['snack', W('snack|merienda|tentempi[e\u00e9]|anclaje|protein anchor')],
];

/** The slot of a day plan meal: its own valid `slot`, else the one its name suggests, else null. */
export function mealSlot(meal) {
  if (!meal) return null;
  if (MEAL_SLOTS.includes(meal.slot)) return meal.slot;
  const name = String(meal.name || '');
  for (const [slot, re] of NAME_RULES) if (re.test(name)) return slot;
  return null;
}
