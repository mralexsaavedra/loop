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

/* Main meals vs add-ons (display grouping only, no number changes): Plan de hoy and the food log
 * (Registrar) show breakfast / lunch / dinner as the day's meals and gather every other meal — pre /
 * post workout, snack, a meal with no slot (an after-lunch coffee, cooking oil) — into ONE add-ons
 * group. The stored food-log slot enum (MEAL_SLOTS) is unchanged: an add-on logged by hand is stored as
 * ADDON_SLOT. Baked for the page (nutri-day.js, food.js) so the client never re-types the lists. */
export const MAIN_SLOTS = Object.freeze(['breakfast', 'lunch', 'dinner']);
export const ADDON_GROUP = 'addon';
export const MEAL_GROUPS = Object.freeze([...MAIN_SLOTS, ADDON_GROUP]);
export const ADDON_SLOT = 'snack';

/** The display group of a slot (or a group key): a main slot is its own group, anything else add-ons. */
export function mealGroup(slot) {
  return MAIN_SLOTS.includes(slot) ? slot : ADDON_GROUP;
}

/** A day plan meal is a main meal when its slot (own or from its name) is breakfast, lunch or dinner. */
export function isMainMeal(meal) {
  return MAIN_SLOTS.includes(mealSlot(meal));
}

/* Late night: before this local hour the evening still belongs to the day before (a dinner logged at
 * 00:30 is yesterday's dinner, not today's breakfast). The food log's day navigator opens on the
 * previous day and the add sheet guesses dinner. Baked for food.js as FOOD_CONST.lateNightHour. */
export const LATE_NIGHT_HOUR = 4;
