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

/* ---------- the user's own fuel items (plan-data.json fuel.items, optional) ---------- */
import { normalizeFuelItems, validateFuelItems, FUEL_CASES, FUEL_ITEM_KINDS } from './fuel.mjs';

const PASTE = { n: 'Fruit paste', c: 21, f: 0.3, k: 'fast' };
const BAR = { n: 'Date bar', c: 20, f: 2.7, k: 'slow' };

test('no items (absent or empty): the plan is exactly the generic one, no own keys', () => {
  const generic = fuelPlan({ dayType: 'bike', minutes: 90, weightKg: 70 });
  assert.deepEqual(fuelPlan({ dayType: 'bike', minutes: 90, weightKg: 70, items: [] }), generic);
  assert.equal('own' in generic.during, false);
  assert.equal('own' in generic.before, false);
});

test('90-min bike ride with a slow bar + a fast paste: 1 bar at min 30, then 2 pastes every ~20 min (62 g)', () => {
  const f = fuelPlan({ dayType: 'bike', minutes: 90, weightKg: 70, items: [PASTE, BAR] });
  const o = f.during.own;
  assert.equal(o.startMin, 30);
  assert.equal(o.targetG, 60, '60 g/h over the 60 min after the start');
  assert.deepEqual(o.slots, [{ i: 1, count: 1, fromMin: 30, everyMin: 20 }, { i: 0, count: 2, fromMin: 50, everyMin: 20 }]);
  assert.equal(o.totalG, 62);
  assert.ok(o.totalG <= f.during.carbsG[1]);
  assert.equal(o.gapG, 30, 'the plan point (90 g) minus the pieces, in 5 g steps');
  assert.equal(f.during.planG, 90, 'the day accounting is unchanged');
  assert.deepEqual(f.before.own, { i: 0, count: 2, g: 42 }, 'last hour: 2 fast pieces = 42 g, inside 30–60 g');
});

test('3.5 h bikeLong: slow pieces until half way, fast after, never above the range top', () => {
  const f = fuelPlan({ dayType: 'bikeLong', minutes: 210, weightKg: 70, items: [PASTE, BAR] });
  const o = f.during.own;
  assert.equal(o.targetG, 225); // 75 g/h × 3 h
  assert.deepEqual(o.slots, [{ i: 1, count: 5, fromMin: 30, everyMin: 16 }, { i: 0, count: 6, fromMin: 112, everyMin: 16 }]);
  assert.equal(o.totalG, 226);
  assert.ok(o.totalG <= f.during.carbsG[1]);
  assert.equal(o.gapG, 40);
});

test('kinds are optional: with one item of no kind it fills both halves', () => {
  const o = fuelPlan({ dayType: 'bike', minutes: 120, weightKg: 70, items: [{ n: 'Gel', c: 25, f: null, k: null }] }).during.own;
  assert.deepEqual(o.slots, [{ i: 0, count: 4, fromMin: 30, everyMin: 23 }]);
  assert.equal(o.totalG, 100);
});

test('FUEL_CASES pin the mix (shared with the client port)', () => {
  for (const c of FUEL_CASES) assert.ok(fuelPlan(c).during.own, JSON.stringify(c));
});

test('normalizeFuelItems: localized names by language, fat / kind optional, malformed items dropped', () => {
  const plan = { fuel: { items: [
    { name: { es: 'Pasta de frutas', en: 'Fruit paste' }, carbs: 21, fat: 0.3, kind: 'fast' },
    { name: 'Bar', carbs: 20 },
    { name: '', carbs: 20 },
    { name: 'Bad', carbs: 0 },
  ] } };
  assert.deepEqual(normalizeFuelItems(plan, 'es'), [{ n: 'Pasta de frutas', c: 21, f: 0.3, k: 'fast' }, { n: 'Bar', c: 20, f: null, k: null }]);
  assert.equal(normalizeFuelItems(plan, 'en')[0].n, 'Fruit paste');
  assert.deepEqual(normalizeFuelItems({}, 'en'), []);
  assert.deepEqual(FUEL_ITEM_KINDS, ['fast', 'slow']);
});

test('validateFuelItems: absent is valid; every bad field is named', () => {
  assert.deepEqual(validateFuelItems({}), []);
  assert.deepEqual(validateFuelItems({ fuel: { items: [{ name: { es: 'a', en: 'b' }, carbs: 21, fat: 0, kind: 'slow' }] } }), []);
  assert.match(validateFuelItems({ fuel: 3 })[0], /^fuel must be an object/);
  assert.match(validateFuelItems({ fuel: { items: {} } })[0], /^fuel\.items must be an array/);
  const errs = validateFuelItems({ fuel: { items: [{ name: ' ', carbs: 101, fat: -1, kind: 'medium' }, { name: { es: 'x' }, carbs: 0 }] } });
  assert.ok(errs.some((e) => /^fuel\.items\[0\]\.name/.test(e)));
  assert.ok(errs.some((e) => /^fuel\.items\[0\]\.carbs/.test(e)));
  assert.ok(errs.some((e) => /^fuel\.items\[0\]\.fat/.test(e)));
  assert.ok(errs.some((e) => /^fuel\.items\[0\]\.kind/.test(e)));
  assert.ok(errs.some((e) => /^fuel\.items\[1\]\.name/.test(e)));
  assert.ok(errs.some((e) => /^fuel\.items\[1\]\.carbs/.test(e)));
});
