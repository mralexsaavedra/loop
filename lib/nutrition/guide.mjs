/* Plan de hoy as a PORTION GUIDE ("how much can I eat"), not a menu: every day the same four blocks —
 * breakfast, lunch, dinner and Extras — and the day type / goal only change the amounts.
 *
 *   - budgets: each main meal = the totals of today's plan solve for the meals of its slot
 *     (lib/nutrition/scale.mjs planFor: goal × day type × ride minutes, portion caps and all);
 *     Extras = the MEALS target (target − ride fuel) − the three main budgets, so it absorbs the
 *     add-ons (pre / post workout, a protein anchor, cooking oil, any meal with no slot) and whatever
 *     the capped plates leave over. Never negative: a macro the main meals already pass clamps at 0.
 *   - a main meal is shown as a plate by parts: protein ~P g, carbs ~C g, vegetables free, fat ~F g,
 *     each macro with ONE example food and the amount of that food that supplies it (exampleAmount),
 *     in the food's natural unit and grid, never past its portion cap (`maxAmt`).
 *   - with the food log (LAN page), what is LEFT: remaining / mealState / isCovered.
 *
 * Every number comes from the existing engine and the public food DB (data/nutrition/ingredients.json);
 * each example covers its macro only (a chicken breast also brings some fat), so the guide is
 * orientative. web/src/client/nutri-day.js ports guideBudgets / exampleAmount / remaining / mealState /
 * isCovered / roleOptions line by line (parity tests). Pure, no I/O. */
import { planModel } from './scale.mjs';
import { mealSlot, MAIN_SLOTS } from './slots.mjs';
import { foldName } from './names.mjs';
import { fin } from './num.mjs';
import { UD_AMT, PIECE_GRID } from './units.mjs';
import { AMOUNT_STEP } from './amounts.mjs';

/** The three macro rows of a plate: the food categories an example may come from and the slot of the
 * macro in [kcal, protein, carbs, fat] (a basic's `m`, lib/nutrition/basics.mjs). Vegetables are free
 * (no amount), so they are not a role. */
export const GUIDE_ROLES = Object.freeze({
  p: Object.freeze({ at: 1, cats: Object.freeze(['protein']) }),
  c: Object.freeze({ at: 2, cats: Object.freeze(['carb', 'legume', 'fruit']) }),
  f: Object.freeze({ at: 3, cats: Object.freeze(['fat']) }),
});
export const ROLE_KEYS = Object.freeze(['p', 'c', 'f']);
/** The example when the base plan has no food of that role in the meal: chicken / rice / olive oil. */
export const GUIDE_FALLBACK = Object.freeze({ p: 'pollo', c: 'arroz', f: 'aceiteoliva' });
/** A meal whose logged kcal reach this share of its budget is done ("✓ N kcal logged"). */
export const DONE_SHARE = 0.9;
/** A macro row with at most this share of its budget left is covered ("✓ covered"). */
export const COVERED_SHARE = 0.1;
/** The Extras hint: a few everyday add-ons and what they cost, computed from the food DB. */
export const EXTRAS_EXAMPLES = Object.freeze([
  Object.freeze({ id: 'cortado', ing: 'cortado', amt: 100 }), // one cortado (a `ud` food: 100 = one unit)
  Object.freeze({ id: 'fruit', ing: 'platano', amt: 120 }), // a medium banana
  Object.freeze({ id: 'yogurt', ing: 'yogurnatural', amt: 125 }), // one plain yogurt
  Object.freeze({ id: 'shake', ing: 'wheyup', amt: 30 }), // a 30 g whey shake in water
]);
/** The grid exampleAmount rounds on (baked for the page as NUTRI.scale: ud / grid / step). */
export const GUIDE_GRID = Object.freeze({ ud: UD_AMT, grid: PIECE_GRID, step: AMOUNT_STEP });

const MACS = ['k', 'p', 'c', 'f'];
const zero = () => ({ k: 0, p: 0, c: 0, f: 0 });
// the DB's macro letter of a role (ingredients.json writes fat as `g`)
const ING_MAC = { p: 'p', c: 'c', f: 'g' };

/** Today's budgets. x = planFor() ({meals: [[k, p, c, g]…] whole numbers, mt: {k, p, c, f}}), slots =
 * each plan meal's slot (baked per base day as `sl`), mains = MAIN_SLOTS. Returns {meals: {<slot>:
 * {k, p, c, f}}, extras, total (= the meals target), clamped (some Extras macro was below 0)}. */
export function guideBudgets(x, slots, mains) {
  const meals = {};
  for (const s of mains) meals[s] = zero();
  x.meals.forEach((row, i) => {
    const b = meals[slots[i]];
    if (!b) return;
    MACS.forEach((m, j) => { b[m] += row[j]; });
  });
  const total = { k: Math.round(x.mt.k), p: Math.round(x.mt.p), c: Math.round(x.mt.c), f: Math.round(x.mt.f) };
  const extras = zero();
  let clamped = false;
  for (const m of MACS) {
    let left = total[m];
    for (const s of mains) left -= meals[s][m];
    if (left < 0) clamped = true;
    extras[m] = Math.max(0, left);
  }
  return { meals, extras, total, clamped };
}

/** The amount of `food` that supplies `grams` of the role's macro: {amt, capped} | null (nothing to
 * supply, or the food has none of that macro). food = {u: 'g' | 'ml' | 'ud', m: [kcal, p, c, f] per 100
 * of its amount scale (a `ud` food: per unit = 100), pc?: its piece (a), x?: its portion cap}. The amount
 * rounds like a scaled plan amount — whole units, half pieces of a countable food, else 5 g / 5 ml, never
 * below one step — and never passes the cap (stepping DOWN on the grid; capped = it was cut there). */
export function exampleAmount(food, role, grams, grid) {
  const r = GUIDE_ROLES[role];
  if (!food || !r || !food.m || !fin(grams) || !(grams > 0)) return null;
  const per = food.m[r.at];
  if (!fin(per) || !(per > 0)) return null;
  const raw = (grams * 100) / per;
  const st = food.u === 'ud' ? grid.ud : food.pc && food.pc.a > 0 ? food.pc.a * grid.grid : grid.step;
  const amt = Math.max(st, Math.round(raw / st) * st);
  const cap = fin(food.x) && food.x > 0 ? food.x : null;
  if (cap && amt > cap) return { amt: Math.max(st, Math.floor(cap / st + 1e-9) * st), capped: true };
  return { amt, capped: false };
}

/** What is left of a budget after the logged sums (a macro no entry states counts as 0), floor 0. */
export function remaining(budget, logged) {
  const out = {};
  for (const m of MACS) {
    const l = logged && fin(logged[m]) ? logged[m] : 0;
    out[m] = Math.max(0, Math.round(budget[m] - l));
  }
  return out;
}

/** A meal's log state: 'done' (logged kcal >= DONE_SHARE of the budget), 'partial' (something logged),
 * null (nothing logged, or no log at all). */
export function mealState(budget, logged) {
  const k = logged && fin(logged.k) ? logged.k : 0;
  if (!(k > 0)) return null;
  return k >= DONE_SHARE * budget.k ? 'done' : 'partial';
}

/** A macro row is covered when at most COVERED_SHARE of its budget is left (a zero budget always is). */
export function isCovered(left, budget) {
  return !(budget > 0) || left <= COVERED_SHARE * budget;
}

/** The default example per main meal and role for base day `day`: among the meal's recipe lines whose
 * food is of the role's categories, the one that supplies most of that macro (summed over the meals of
 * that slot), else GUIDE_FALLBACK. {breakfast: {p, c, f}, lunch, dinner} of ingredient keys. */
export function mealDefaults(nut, day) {
  const { meals } = planModel(nut, day);
  const acc = {};
  for (const s of MAIN_SLOTS) acc[s] = { p: new Map(), c: new Map(), f: new Map() };
  for (const { meal, parts } of meals) {
    const a = acc[mealSlot(meal)];
    if (!a) continue;
    for (const d of parts) {
      if (!d.lines) continue; // a manual block names no food
      for (const l of d.lines) {
        const ing = nut.ING[l.ing];
        if (!ing || !(ing.per > 0)) continue;
        for (const r of ROLE_KEYS) {
          if (!GUIDE_ROLES[r].cats.includes(ing.cat)) continue;
          const v = (ing[ING_MAC[r]] * l.amt) / ing.per;
          if (fin(v) && v > 0) a[r].set(l.ing, (a[r].get(l.ing) || 0) + v);
        }
      }
    }
  }
  const out = {};
  for (const s of MAIN_SLOTS) {
    out[s] = {};
    for (const r of ROLE_KEYS) {
      let best = null;
      let bestV = 0;
      for (const [k, v] of acc[s][r]) if (v > bestV + 1e-9) { best = k; bestV = v; }
      out[s][r] = best || GUIDE_FALLBACK[r];
    }
  }
  return out;
}

/** The Extras hint's examples present in the food DB: [{id, k (kcal, whole)}]. */
export function extrasExamples(ING) {
  const out = [];
  for (const e of EXTRAS_EXAMPLES) {
    const ing = ING && Object.prototype.hasOwnProperty.call(ING, e.ing) ? ING[e.ing] : null;
    if (!ing || !fin(ing.k) || !(ing.per > 0)) continue;
    out.push({ id: e.id, k: Math.round((ing.k * e.amt) / ing.per) });
  }
  return out;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The example choices of a role: {basics: [{id: 'b:<key>', n, food}], products: [{id: 'p:<id>', n,
 * food: {u, m}}]} — the public basics (lib/nutrition/basics.mjs, log-only ones included) of the role's
 * categories with some of its macro, and the owner's own products (GET /api/food/products, view time
 * only) in g / ml that state it; each group sorted by the folded name (code-unit order, then id). */
export function roleOptions(basics, products, role) {
  const r = GUIDE_ROLES[role];
  const b = (basics || [])
    .filter((x) => x && r.cats.includes(x.c) && Array.isArray(x.m) && fin(x.m[r.at]) && x.m[r.at] > 0)
    .map((x) => ({ id: 'b:' + x.k, n: x.n, food: x }));
  const p = [];
  for (const x of products || []) {
    const v = x && x.per100;
    if (!v || (x.unit !== 'g' && x.unit !== 'ml') || !fin(v.kcal)) continue;
    const m = [v.kcal, v.protein, v.carbs, v.fat].map((n) => (fin(n) ? n : null));
    if (!(m[r.at] > 0)) continue;
    p.push({ id: 'p:' + x.id, n: String(x.name || ''), food: { u: x.unit, m } });
  }
  const sort = (list) => list.sort((x, y) => cmp(foldName(x.n), foldName(y.n)) || cmp(x.id, y.id));
  return { basics: sort(b), products: sort(p) };
}

/** Shared cases: the page port of exampleAmount (nutri-day.js) is pinned against these. */
export const GUIDE_CASES = Object.freeze([
  { food: { u: 'g', m: [109, 22.9, 0, 2.3] }, role: 'p', g: 45, expect: { amt: 195, capped: false } },
  { food: { u: 'g', m: [109, 22.9, 0, 2.3] }, role: 'p', g: 1, expect: { amt: 5, capped: false } },
  { food: { u: 'g', m: [109, 22.9, 0, 2.3] }, role: 'c', g: 30, expect: null },
  { food: { u: 'g', m: [360, 7, 79, 1], x: 150 }, role: 'c', g: 200, expect: { amt: 150, capped: true } },
  { food: { u: 'g', m: [360, 7, 79, 1], x: 150 }, role: 'c', g: 118.5, expect: { amt: 150, capped: false } },
  { food: { u: 'ud', m: [72, 6.3, 0.4, 5], pc: { a: 100, r: 50 } }, role: 'p', g: 20, expect: { amt: 300, capped: false } },
  { food: { u: 'ud', m: [72, 6.3, 0.4, 5], pc: { a: 100, r: 50 } }, role: 'p', g: 2, expect: { amt: 100, capped: false } },
  { food: { u: 'ud', m: [200, 6, 40, 2], x: 300 }, role: 'c', g: 200, expect: { amt: 300, capped: true } },
  { food: { u: 'g', m: [88, 0.8, 22.5, 0.3], pc: { a: 120 }, x: 240 }, role: 'c', g: 40, expect: { amt: 180, capped: false } },
  { food: { u: 'g', m: [88, 0.8, 22.5, 0.3], pc: { a: 120 }, x: 240 }, role: 'c', g: 90, expect: { amt: 240, capped: true } },
  { food: { u: 'g', m: [259, 8.2, 51, 1.1], pc: { a: 45 }, x: 135 }, role: 'c', g: 100, expect: { amt: 135, capped: true } },
  { food: { u: 'g', m: [900, 0, 0, 100], pc: { a: 10 } }, role: 'f', g: 12, expect: { amt: 10, capped: false } },
  { food: { u: 'ml', m: [46, 3.4, 4.8, 1.7] }, role: 'c', g: 10, expect: { amt: 210, capped: false } },
  { food: { u: 'ml', m: [46, 3.4, 4.8, null] }, role: 'f', g: 10, expect: null },
]);
