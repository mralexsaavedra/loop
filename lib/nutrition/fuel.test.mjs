/* lib/nutrition/fuel.mjs — on-bike fuelling ranges (Avituallamiento). Orientative sports-nutrition
 * ranges, never a prescription. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUEL, RIDE_DEFAULT_MIN, fuelPlan, isBikeDay } from './fuel.mjs';

test('only bike day types get a fuelling plan; default ride = 2 h / 3.5 h', () => {
  assert.equal(isBikeDay('bike'), true);
  assert.equal(isBikeDay('bikeLong'), true);
  assert.equal(isBikeDay('gym'), false);
  assert.equal(isBikeDay('rest'), false);
  assert.equal(fuelPlan({ dayType: 'gym', minutes: 60, weightKg: 70 }), null);
  assert.deepEqual(RIDE_DEFAULT_MIN, { bike: 120, bikeLong: 210 });
});

test('bike, 2 h, 70 kg: 60 g/h during, 1–2 g/kg before, 1–1.2 g/kg + 30–40 g protein after', () => {
  const f = fuelPlan({ dayType: 'bike', minutes: 120, weightKg: 70 });
  assert.deepEqual(f.before.carbsG, [70, 140]);
  assert.deepEqual(f.before.lastHourG, [30, 60]);
  assert.deepEqual(f.during.gPerH, [60, 60]);
  assert.deepEqual(f.during.carbsG, [120, 120]);
  assert.equal(f.during.planG, 120);
  assert.deepEqual(f.during.fluidsMl, [1000, 1500]);
  assert.deepEqual(f.during.sodiumMg, [600, 1200]);
  assert.deepEqual(f.after.carbsG, [70, 85]); // 84 -> 85 (5 g steps)
  assert.deepEqual(f.after.proteinG, [30, 40]);
  assert.equal(f.kcal, 480, 'the on-bike carbs count inside the day total (4 kcal/g)');
});

test('bikeLong, 3.5 h: 60–90 g/h, the plan point is the midpoint', () => {
  const f = fuelPlan({ dayType: 'bikeLong', minutes: 210, weightKg: 80 });
  assert.deepEqual(f.during.gPerH, [60, 90]);
  assert.deepEqual(f.during.carbsG, [210, 315]);
  assert.equal(f.during.planG, 265); // 262.5 -> 5 g steps
  assert.deepEqual(f.during.fluidsMl, [1750, 2650]); // 2625 -> 50 ml steps
  assert.equal(f.kcal, 1060);
});

test('practical units: gels ~25 g, banana ~25 g, bar ~40 g, 500 ml drink at 6–8% ≈ 30–40 g', () => {
  assert.deepEqual(FUEL.units, { gelG: 25, bananaG: 25, barG: 40, bottleMl: 500, bottlePct: [6, 8], bottleG: [30, 40] });
  const f = fuelPlan({ dayType: 'bike', minutes: 120, weightKg: 70 });
  assert.deepEqual(f.during.equiv, { gels: 5, bananas: 5, bars: 3, bottles: [3, 4] });
  // a mix idea: one bottle per hour (fluids) + the rest in gels
  assert.deepEqual(f.during.mix, { bottles: 2, gels: 2 });
});

test('no weigh-in: the g/kg windows keep their rates but no grams', () => {
  const f = fuelPlan({ dayType: 'bike', minutes: 90, weightKg: null });
  assert.equal(f.before.carbsG, null);
  assert.equal(f.after.carbsG, null);
  assert.deepEqual(f.before.gPerKg, [1, 2]);
  assert.deepEqual(f.during.carbsG, [90, 90]);
});

test('a bad duration falls back to the day type default', () => {
  assert.equal(fuelPlan({ dayType: 'bike', minutes: 0, weightKg: 70 }).minutes, 120);
  assert.equal(fuelPlan({ dayType: 'bikeLong', minutes: NaN, weightKg: 70 }).minutes, 210);
});
