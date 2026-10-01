/* lib/nutrition/slots.mjs — a meal's slot (explicit, or guessed from its es/en name). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEAL_SLOTS, mealSlot, MAIN_SLOTS, MEAL_GROUPS, ADDON_GROUP, ADDON_SLOT, isMainMeal, mealGroup } from './slots.mjs';

test('six slots, in day order', () => {
  assert.deepEqual(MEAL_SLOTS, ['breakfast', 'lunch', 'preworkout', 'postworkout', 'dinner', 'snack']);
});

test('an explicit valid slot wins over the name', () => {
  assert.equal(mealSlot({ name: 'Dinner', slot: 'snack' }), 'snack');
  assert.equal(mealSlot({ name: 'Dinner', slot: 'brunch' }), 'dinner', 'an unknown slot falls back to the name');
});

test('es / en names are recognised; pre / post workout before lunch / dinner words', () => {
  const cases = {
    Desayuno: 'breakfast', Breakfast: 'breakfast', Comida: 'lunch', Lunch: 'lunch', Almuerzo: 'lunch',
    'Pre-entreno': 'preworkout', 'Pre-workout': 'preworkout', 'Post-entreno': 'postworkout', 'Post-workout': 'postworkout',
    Cena: 'dinner', Dinner: 'dinner', Merienda: 'snack', 'Anclaje proteico': 'snack', 'Protein anchor': 'snack', 'Tentempié': 'snack',
  };
  for (const [name, slot] of Object.entries(cases)) assert.equal(mealSlot({ name }), slot, name);
});

test('names that only contain a slot word inside another word, or nothing, have no slot', () => {
  assert.equal(mealSlot({ name: 'Aceite de cocinar' }), null);
  assert.equal(mealSlot({ name: 'Café (tras comer)' }), null);
  assert.equal(mealSlot({ name: 'Cooking oil' }), null);
  assert.equal(mealSlot({ name: 'Escena' }), null);
  assert.equal(mealSlot(null), null);
});

/* main meals vs add-ons: Plan de hoy and Registrar show only breakfast / lunch / dinner as meals, every
 * other meal (pre / post workout, snack, a meal with no slot) in ONE "add-ons" group */
test('three main slots, four groups (the main slots + add-ons), add-ons stored as snack', () => {
  assert.deepEqual(MAIN_SLOTS, ['breakfast', 'lunch', 'dinner']);
  assert.equal(ADDON_GROUP, 'addon');
  assert.deepEqual(MEAL_GROUPS, ['breakfast', 'lunch', 'dinner', 'addon']);
  assert.equal(ADDON_SLOT, 'snack');
  for (const s of MAIN_SLOTS) assert.ok(MEAL_SLOTS.includes(s));
  assert.ok(MEAL_SLOTS.includes(ADDON_SLOT));
});

test('isMainMeal: breakfast / lunch / dinner (own slot or name); everything else is an add-on', () => {
  for (const name of ['Desayuno', 'Comida', 'Cena', 'Breakfast', 'Lunch', 'Dinner']) assert.equal(isMainMeal({ name }), true, name);
  for (const name of ['Pre-entreno', 'Post-entreno', 'Café (tras comer)', 'Anclaje proteico', 'Aceite de cocinar', 'Cooking oil', 'Protein anchor', 'Post-workout', 'Merienda']) {
    assert.equal(isMainMeal({ name }), false, name);
  }
  assert.equal(isMainMeal({ name: 'Cooking oil', slot: 'dinner' }), true, 'an explicit main slot wins');
  assert.equal(isMainMeal({ name: 'Dinner', slot: 'snack' }), false, 'an explicit add-on slot wins');
  assert.equal(isMainMeal(null), false);
});

test('mealGroup: a slot (or a group key) maps to its group; add-on slots, unknown and null -> addon', () => {
  assert.equal(mealGroup('breakfast'), 'breakfast');
  assert.equal(mealGroup('lunch'), 'lunch');
  assert.equal(mealGroup('dinner'), 'dinner');
  for (const s of ['preworkout', 'postworkout', 'snack', 'addon', null, undefined, 'brunch']) assert.equal(mealGroup(s), 'addon', String(s));
});
