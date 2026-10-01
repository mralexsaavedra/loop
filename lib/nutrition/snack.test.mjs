/* lib/nutrition/snack.mjs — the automatic snack that fills a short day. Synthetic fixtures + the tracked
 * public food DB (never the owner's plan). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SNACK_OPTIONS, SNACK_ID, SNACK_SLOT, SNACK_NAME, buildSnacks, snackCapK, defaultSnack, solveSnack, snackFor, rideHeadroomK, withSnack } from './snack.mjs';
import { LINE, lineCap, lineAmt, stepAmount, lineUnit, lineStep } from './amounts.mjs';
import { fuelPlan } from './fuel.mjs';
import { pieceFmt } from './units.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ING = JSON.parse(fs.readFileSync(path.join(here, '../../data/nutrition/ingredients.json'), 'utf8')).ingredients;
const FMT = { units: { g: 'g', ml: 'ml', ud: 'ud' }, dec: '.', pieces: pieceFmt(ING, 'en') };

test('every tracked snack option resolves on the tracked food DB, with a stable key, es / en names and a cap on every line', () => {
  assert.ok(SNACK_OPTIONS.length >= 6);
  const keys = SNACK_OPTIONS.map((o) => o.k);
  assert.equal(new Set(keys).size, keys.length, 'unique keys');
  for (const o of SNACK_OPTIONS) {
    assert.match(o.k, /^[a-z][a-z-]*$/, o.k);
    assert.ok(o.n.es && o.n.en, o.k);
    assert.ok(o.recipe.length >= 2, `${o.k}: a small recipe`);
    for (const l of o.recipe) {
      assert.ok(ING[l.ing], `${o.k}: ${l.ing} is in ingredients.json`);
      assert.ok(l.max > 0 && l.max >= l.amt, `${o.k}/${l.ing}: a snack cap at or above the written amount`);
    }
  }
  const b = buildSnacks(ING, 'es');
  assert.equal(b.n, SNACK_NAME.es);
  assert.equal(b.id, SNACK_ID, 'the page reads the pick id and the slot from the bake');
  assert.equal(b.slot, SNACK_SLOT);
  assert.deepEqual(b.opts.map((o) => o.k), keys, 'every option baked, in order');
  for (const o of b.opts) for (const l of o.ln) assert.ok(lineCap(l) > 0, `${o.k}: every line capped`);
  assert.equal(SNACK_ID, 'snack/auto');
  assert.equal(SNACK_SLOT, 'snack');
});

test('buildSnacks: a line cap = min(the food\'s maxAmt, the snack\'s max); names and components localized; an unknown food drops the option', () => {
  const b = buildSnacks(ING, 'en');
  const fy = b.opts.find((o) => o.k === 'fruit-yogurt');
  assert.equal(fy.n, 'Fruit + plain yogurt');
  assert.deepEqual(fy.c, ['Apple', 'Plain yogurt']);
  const def = SNACK_OPTIONS.find((o) => o.k === 'fruit-yogurt');
  def.recipe.forEach((l, i) => assert.equal(lineCap(fy.ln[i]), Math.min(l.max, ING[l.ing].maxAmt || Infinity)));
  const noYogurt = { ...ING };
  delete noYogurt.yogurnatural;
  const b2 = buildSnacks(noYogurt, 'en');
  assert.ok(!b2.opts.some((o) => o.k === 'fruit-yogurt'));
  assert.ok(b2.opts.length > 0);
  assert.deepEqual(buildSnacks({}, 'en').opts, []);
});

test('solveSnack: the whole option scales by one factor to the need, rounded like every amount (half pieces, 5 g)', () => {
  const b = buildSnacks(ING, 'en');
  for (const o of b.opts) for (const need of [80, 150, 220, 300]) {
    const s = solveSnack(o, need, FMT);
    assert.equal(s.k, o.k);
    assert.ok(Math.abs(s.mac[0] - need) <= 60 || s.capped, `${o.k} @${need}: ${s.mac[0]}`);
    o.ln.forEach((l, i) => {
      const a = s.nums[i];
      assert.equal(a, stepAmount(a, lineUnit(l), lineStep(l)), `${o.k}: ${a} on its grid`);
      assert.ok(a <= lineCap(l), `${o.k}: never past its cap`);
    });
    const k = o.ln.reduce((acc, l, i) => acc + (l[LINE.K] * s.nums[i]) / lineAmt(l), 0);
    assert.ok(Math.abs(k - s.mac[0]) < 1e-9, 'the macros come from the rounded amounts');
    assert.equal(s.amts.length, o.ln.length);
  }
});

test('solveSnack: a need beyond the option\'s caps holds every line at its cap (capped), the rest stays a remainder', () => {
  const o = buildSnacks(ING, 'en').opts.find((x) => x.k === 'fruit-yogurt');
  const s = solveSnack(o, 2000, FMT);
  assert.equal(s.capped, true);
  o.ln.forEach((l, i) => assert.equal(s.nums[i], lineCap(l)));
  assert.ok(s.mac[0] <= snackCapK(o) + 1e-9);
  assert.equal(solveSnack(o, 120, FMT).capped, false);
});

test('defaultSnack: the first option (in list order) that can fill the need, else the one that fills most', () => {
  const opts = buildSnacks(ING, 'en').opts;
  assert.equal(defaultSnack(opts, 150), 'fruit-yogurt', 'fruit + yogurt for a usual shortfall');
  const caps = opts.map((o) => snackCapK(o));
  const biggest = opts[caps.indexOf(Math.max(...caps))].k;
  assert.equal(defaultSnack(opts, 5000), biggest);
  const firstFit = opts.find((o) => snackCapK(o) >= 400);
  assert.equal(defaultSnack(opts, 400), firstFit ? firstFit.k : biggest);
  assert.equal(defaultSnack([], 100), null);
});

test('snackFor: a valid pick wins, an unknown / missing pick falls back to the default; `d` = the default key', () => {
  const sb = buildSnacks(ING, 'en');
  const a = snackFor(sb, 200, undefined, FMT);
  assert.equal(a.k, 'fruit-yogurt');
  assert.equal(a.d, 'fruit-yogurt');
  const b = snackFor(sb, 200, 'nuts', FMT);
  assert.equal(b.k, 'nuts');
  assert.equal(b.d, 'fruit-yogurt');
  assert.equal(snackFor(sb, 200, 'cake', FMT).k, 'fruit-yogurt');
  assert.equal(snackFor({ n: 'Snack', opts: [] }, 200, undefined, FMT), null);
  assert.equal(snackFor(null, 200, undefined, FMT), null);
});

test('rideHeadroomK: how much more the ride may take before it passes the top of its g/h range (0 for bike, whose rate is fixed)', () => {
  assert.equal(rideHeadroomK(fuelPlan({ dayType: 'bike', minutes: 120 })), 0);
  const f = fuelPlan({ dayType: 'bikeLong', minutes: 210 });
  assert.equal(rideHeadroomK(f), Math.round((90 * 3.5 - f.during.planG) * 4));
  assert.equal(rideHeadroomK(null), 0);
});

test('withSnack: a new add-on meal (slot snack) after the others, or appended to an existing snack-slot meal; nothing mutated', () => {
  const view = [{ n: 'Lunch', s: 'lunch', pcf: true, parts: [{ l: 'Rice', q: '100 g', m: [360, 7, 79, 1] }] }];
  const meals = [[360, 7, 79, 1]];
  const sn = { k: 'nuts', n: 'Nuts', mac: [190.4, 5.5, 1.4, 17.7], amts: ['15 g', '15 g'], c: ['Walnuts', 'Almonds'] };
  const frozen = JSON.stringify([view, meals]);
  const a = withSnack(view, meals, sn, 'Snack');
  assert.equal(JSON.stringify([view, meals]), frozen, 'inputs untouched');
  assert.equal(a.view.length, 2);
  assert.deepEqual(a.view[1], { n: 'Snack', s: 'snack', pcf: true, parts: [{ l: 'Nuts', id: SNACK_ID, sn: 1, c: ['Walnuts', 'Almonds'], a: ['15 g', '15 g'], m: sn.mac }] });
  assert.deepEqual(a.meals[1], sn.mac);
  const withAnchor = view.concat([{ n: 'Protein anchor', s: 'snack', pcf: true, parts: [{ l: 'Shake', q: '1', m: [120, 24, 3, 1] }] }]);
  const b = withSnack(withAnchor, meals.concat([[120, 24, 3, 1]]), sn, 'Snack');
  assert.equal(b.view.length, 2, 'no second snack meal');
  assert.equal(b.view[1].parts.length, 2);
  assert.equal(b.view[1].parts[1].id, SNACK_ID);
  assert.deepEqual(b.meals[1], [120 + 190.4, 24 + 5.5, 3 + 1.4, 1 + 17.7]);
  assert.equal(withAnchor[1].parts.length, 1, 'the existing meal is copied, not mutated');
  const one = withSnack(view, meals, { k: 'x', n: 'X', mac: [100, 1, 1, 1], amts: ['50 g'], c: null }, 'Snack');
  assert.deepEqual(one.view[1].parts[0], { l: 'X', id: SNACK_ID, sn: 1, q: '50 g', m: [100, 1, 1, 1] });
});
