/* lib/nutrition/slots.mjs — a meal's slot (explicit, or guessed from its es/en name). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEAL_SLOTS, mealSlot } from './slots.mjs';

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
