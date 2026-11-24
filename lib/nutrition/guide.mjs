/* Plan de hoy as a PORTION GUIDE ("how much can I eat"), not a menu: every day the same four meal
 * groups — breakfast, lunch, dinner and Extras — and the day type / goal only change the amounts.
 *
 *   - budgets: each main meal = the totals of today's plan solve for the meals of its slot
 *     (lib/nutrition/scale.mjs planFor: goal × day type × ride minutes, portion caps and all);
 *     a COOKING-OIL meal (no slot, every part a `fat` food: the oil the plates are cooked with) is split
 *     evenly between the lunch and dinner budgets (wholly into the one the plan has; Extras if neither),
 *     so oil logged with lunch does not drain that meal early (oilMeals);
 *     Extras = the MEALS target (target − ride fuel) − the three main budgets, so it absorbs the
 *     add-ons (pre / post workout, a protein anchor, any other meal with no slot, like an after-lunch
 *     coffee) and whatever the capped plates leave over. Never negative: a macro the main meals already
 *     pass clamps at 0.
 *   - a main meal is shown as a plate by parts: protein ~P g, carbs ~C g, vegetables free, fat ~F g,
 *     each macro with ONE example food and the amount of that food that supplies it (exampleAmount),
 *     in the food's natural unit and grid, never past its portion cap (`maxAmt`).
 *   - with the food log (LAN page), what is LEFT: remaining / mealState / isCovered, and the DAY cap:
 *     a macro row never offers more than the day still allows (dayRemaining = the "Left today" line,
 *     capByDay), so overspending one meal is taken from the others.
 *
 * Every number comes from the existing engine and the public food DB (data/nutrition/ingredients.json);
 * each example covers its macro only (a chicken breast also brings some fat), so the guide is
 * orientative. web/src/client/nutri-day.ts runs guideBudgets / exampleAmount / remaining / mealState /
 * isCovered / dayRemaining / capByDay / roleOptions themselves (HC_GUIDE, web/src/client/lib-globals.ts;
 * see CLIENT). Pure, no I/O. */
import { planModel } from './scale.mjs';
import { mealSlot, MAIN_SLOTS } from './slots.mjs';
import { foldName } from './names.mjs';
import { fin } from './num.mjs';
import { UD_AMT, PIECE_GRID } from './units.mjs';
import { AMOUNT_STEP, floorToStep } from './amounts.mjs';

/** @typedef {import('./macros.mjs').Nutrition} Nutrition */
/** @typedef {import('./macros.mjs').FoodDB} FoodDB */
/** @typedef {import('./basics.mjs').BasicFood} BasicFood */
/** @typedef {import('./foodlog.mjs').Product} Product */
/** A food an example amount is computed for: unit, [kcal, p, c, f] per 100 of its amount scale, its piece, its cap.
 * @typedef {{u: string, m: readonly (number | null)[], pc?: {a: number} | null, x?: number | null}} GuideFood */
/** One example choice of a role: 'b:<key>' (a basic) or 'p:<id>' (a product), its name and food.
 * @typedef {{id: string, n: string, food: GuideFood}} RoleOption */
/** Logged sums by macro (a macro no entry states is absent or null).
 * @typedef {Partial<Record<string, number | null>>} LoggedSums */

/** The three macro rows of a plate: the food categories an example may come from and the slot of the
 * macro in [kcal, protein, carbs, fat] (a basic's `m`, lib/nutrition/basics.mjs). Vegetables are free
 * (no amount), so they are not a role. */
/** @type {Readonly<Record<string, Readonly<{at: number, cats: readonly string[]}>>>} */
export const GUIDE_ROLES = Object.freeze({
  p: Object.freeze({ at: 1, cats: Object.freeze(['protein']) }),
  c: Object.freeze({ at: 2, cats: Object.freeze(['carb', 'legume', 'fruit']) }),
  f: Object.freeze({ at: 3, cats: Object.freeze(['fat']) }),
});
export const ROLE_KEYS = Object.freeze(['p', 'c', 'f']);
/** The example when the base plan has no food of that role in the meal: chicken / rice / olive oil. */
/** @type {Readonly<Record<string, string>>} */
export const GUIDE_FALLBACK = Object.freeze({ p: 'pollo', c: 'arroz', f: 'aceiteoliva' });
/** A meal whose logged kcal reach this share of its budget is done ("✓ N kcal logged"). */
export const DONE_SHARE = 0.9;
/** A macro row with at most this share of its budget left is covered ("✓ covered"). */
export const COVERED_SHARE = 0.1;
/** The Extras hint: a few everyday add-ons and what they cost, computed from the food DB. */
export const EXTRAS_EXAMPLES = Object.freeze([
  Object.freeze({ id: 'fruit', ing: 'platano', amt: 120 }), // a medium banana
  Object.freeze({ id: 'yogurt', ing: 'yogurnatural', amt: 125 }), // one plain yogurt
  Object.freeze({ id: 'shake', ing: 'wheyup', amt: 30 }), // a 30 g whey shake in water
]);
/** The grid exampleAmount rounds on (baked for the page as NUTRI.scale: ud / grid / step). */
export const GUIDE_GRID = Object.freeze({ ud: UD_AMT, grid: PIECE_GRID, step: AMOUNT_STEP });

/** @type {('k' | 'p' | 'c' | 'f')[]} */
const MACS = ['k', 'p', 'c', 'f'];
// the page runs the functions named in CLIENT (web/src/client/lib-globals.ts publishes them as HC_GUIDE)
/** @returns {Macros} */
function zero() { return { k: 0, p: 0, c: 0, f: 0 }; }
// the DB's macro letter of a role (ingredients.json writes fat as `g`)
/** @type {Record<string, 'p' | 'c' | 'g'>} */
const ING_MAC = { p: 'p', c: 'c', f: 'g' };

/** The main slots a cooking-oil meal is split between (evenly, lunch first). */
export const OIL_SLOTS = Object.freeze(['lunch', 'dinner']);

/** The cooking-oil meals of base day `day`: the indices of the meals with no slot whose parts are ALL
 * foods of the `fat` category (a manual block or an empty meal is not oil). Baked per base day as
 * NUTRI.guide.oil for guideBudgets.
 * @param {Nutrition} nut @param {string} day @returns {number[]} */
export function oilMeals(nut, day) {
  /** @type {number[]} */
  const out = [];
  planModel(nut, day).meals.forEach(({ meal, parts }, i) => {
    if (mealSlot(meal) !== null || !parts.length) return;
    const allFat = parts.every((d) => d.lines && d.lines.length && d.lines.every((l) => nut.ING[l.ing] && nut.ING[l.ing].cat === 'fat'));
    if (allFat) out.push(i);
  });
  return out;
}

/** Today's budgets. x = planFor() ({meals: [[k, p, c, g]…] whole numbers, mt: {k, p, c, f}}), slots =
 * each plan meal's slot (baked per base day as `sl`), mains = MAIN_SLOTS, oil = the cooking-oil meal
 * indices (oilMeals; none = every slotless meal is an add-on). A cooking-oil meal goes half to lunch
 * (the rounded half) and the rest to dinner, wholly to the one of OIL_SLOTS the plan has (a meal of
 * that slot), else to Extras. Returns {meals: {<slot>: {k, p, c, f}}, extras, total (= the meals
 * target), clamped (some Extras macro was below 0)}.
 * @param {{meals: readonly (readonly number[])[], mt: {k: number, p: number, c: number, f: number}}} x planFor()'s result
 * @param {readonly (string | null)[]} slots @param {readonly string[]} mains @param {readonly number[] | null} [oil]
 * @returns {{meals: Record<string, Macros>, extras: Macros, total: Macros, clamped: boolean}} */
export function guideBudgets(x, slots, mains, oil) {
  const meals = /** @type {Record<string, Macros>} */ ({});
  for (const s of mains) meals[s] = zero();
  const oilTo = OIL_SLOTS.filter((s) => meals[s] && slots.includes(s));
  x.meals.forEach((row, i) => {
    if (oil && oil.includes(i) && oilTo.length) {
      MACS.forEach((m, j) => {
        const first = oilTo.length > 1 ? Math.round(row[j] / 2) : row[j];
        meals[oilTo[0]][m] += first;
        if (oilTo.length > 1) meals[oilTo[1]][m] += row[j] - first;
      });
      return;
    }
    const b = meals[/** @type {string} */ (slots[i])];
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
 * below one step — and never passes the cap (stepping DOWN on the grid; capped = it was cut there).
 * @param {GuideFood | null | undefined} food @param {string} role @param {number} grams
 * @param {{ud: number, grid: number, step: number}} grid
 * @returns {{amt: number, capped: boolean} | null} */
export function exampleAmount(food, role, grams, grid) {
  const r = GUIDE_ROLES[role];
  if (!food || !r || !food.m || !fin(grams) || !(grams > 0)) return null;
  const per = food.m[r.at];
  if (!fin(per) || !(per > 0)) return null;
  const raw = (grams * 100) / per;
  const st = food.u === 'ud' ? grid.ud : food.pc && food.pc.a > 0 ? food.pc.a * grid.grid : grid.step;
  const amt = Math.max(st, Math.round(raw / st) * st);
  const cap = fin(food.x) && food.x > 0 ? food.x : null;
  if (cap && amt > cap) return { amt: floorToStep(cap, st), capped: true };
  return { amt, capped: false };
}

/** Whole kcal and grams of protein / carbs / fat, also read by a macro key (MACS).
 * @typedef {{k: number, p: number, c: number, f: number} & Record<string, number>} Macros */

/** What is left of a budget after the logged sums (a macro no entry states counts as 0), floor 0.
 * @param {{k: number, p: number, c: number, f: number}} budget @param {LoggedSums | null | undefined} logged
 * @returns {Macros} */
export function remaining(budget, logged) {
  const out = /** @type {Macros} */ ({});
  for (const m of MACS) {
    const l = logged && fin(logged[m]) ? logged[m] : 0;
    out[m] = Math.max(0, Math.round(budget[m] - l));
  }
  return out;
}

/** A meal's log state: 'done' (logged kcal >= DONE_SHARE of the budget), 'partial' (something logged),
 * null (nothing logged, or no log at all).
 * @param {{k: number}} budget @param {LoggedSums | null | undefined} logged @returns {'done' | 'partial' | null} */
export function mealState(budget, logged) {
  const k = logged && fin(logged.k) ? logged.k : 0;
  if (!(k > 0)) return null;
  return k >= DONE_SHARE * budget.k ? 'done' : 'partial';
}

/** A macro row is covered when at most COVERED_SHARE of its budget is left (a zero budget always is). */
/** @param {number} left @param {number} budget @returns {boolean} */
export function isCovered(left, budget) {
  return !(budget > 0) || left <= COVERED_SHARE * budget;
}

/** What the DAY still allows: the meals target (`total`, guideBudgets) − everything logged today (the
 * main meals + the add-ons; a macro no entry states counts as 0), floor 0 — the "Left today" line.
 * groups = the food log's group totals ({meals: {<slot>: {k, p, c, f}}, addon}); null (no food log)
 * → null.
 * @param {{k: number, p: number, c: number, f: number}} total
 * @param {{meals?: Record<string, LoggedSums | null | undefined>, addon?: LoggedSums | null} | null | undefined} groups
 * @param {readonly string[]} mains
 * @returns {Macros | null} */
export function dayRemaining(total, groups, mains) {
  if (!groups) return null;
  const all = zero();
  const add = (/** @type {LoggedSums | null | undefined} */ g) => { for (const m of MACS) all[m] += g && fin(g[m]) ? g[m] : 0; };
  for (const s of mains) add(groups.meals && groups.meals[s]);
  add(groups.addon);
  return remaining(total, all);
}

/** A row capped by the day: left = min(the meal's own left, what the day still allows); byDay = the day
 * itself is covered for that macro (isCovered over the day's meals target). day = null (no food log) →
 * the meal's left unchanged.
 * @param {number} mealLeft @param {number | null | undefined} dayLeft @param {number} dayTotal
 * @returns {{left: number, byDay: boolean}} */
export function capByDay(mealLeft, dayLeft, dayTotal) {
  if (!fin(dayLeft)) return { left: mealLeft, byDay: false };
  return { left: Math.min(mealLeft, dayLeft), byDay: isCovered(dayLeft, dayTotal) };
}

/** The default example per main meal and role for base day `day`: among the meal's recipe lines whose
 * food is of the role's categories, the one that supplies most of that macro (summed over the meals of
 * that slot), else GUIDE_FALLBACK. {breakfast: {p, c, f}, lunch, dinner} of ingredient keys.
 * @param {Nutrition} nut @param {string} day @returns {Record<string, Record<string, string>>} */
export function mealDefaults(nut, day) {
  const { meals } = planModel(nut, day);
  /** @type {Record<string, Record<string, Map<string, number>>>} */
  const acc = {};
  for (const s of MAIN_SLOTS) acc[s] = { p: new Map(), c: new Map(), f: new Map() };
  for (const { meal, parts } of meals) {
    const a = acc[/** @type {string} */ (mealSlot(meal))];
    if (!a) continue;
    for (const d of parts) {
      if (!d.lines) continue; // a manual block names no food
      for (const l of d.lines) {
        const ing = nut.ING[l.ing];
        if (!ing || !(ing.per > 0)) continue;
        for (const r of ROLE_KEYS) {
          if (!GUIDE_ROLES[r].cats.includes(/** @type {string} */ (ing.cat))) continue;
          const v = (ing[ING_MAC[r]] * l.amt) / ing.per;
          if (fin(v) && v > 0) a[r].set(l.ing, (a[r].get(l.ing) || 0) + v);
        }
      }
    }
  }
  /** @type {Record<string, Record<string, string>>} slot -> role -> ingredient key */
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

/** The Extras hint's examples present in the food DB: [{id, k (kcal, whole)}].
 * @param {FoodDB | null | undefined} ING @returns {{id: string, k: number}[]} */
export function extrasExamples(ING) {
  /** @type {{id: string, k: number}[]} */
  const out = [];
  for (const e of EXTRAS_EXAMPLES) {
    const ing = ING && Object.prototype.hasOwnProperty.call(ING, e.ing) ? ING[e.ing] : null;
    if (!ing || !fin(ing.k) || !(ing.per > 0)) continue;
    out.push({ id: e.id, k: Math.round((ing.k * e.amt) / ing.per) });
  }
  return out;
}

/** @param {string} a @param {string} b @returns {number} */
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/** The example choices of a role: {basics: [{id: 'b:<key>', n, food}], products: [{id: 'p:<id>', n,
 * food: {u, m}}]} — the public basics (lib/nutrition/basics.mjs, log-only ones included) of the role's
 * categories with some of its macro, and the user's own products (GET /api/food/products, view time
 * only) in g / ml that state it; each group sorted by the folded name (code-unit order, then id).
 * @param {readonly (BasicFood | null | undefined)[] | null | undefined} basics
 * @param {readonly (Product | null | undefined)[] | null | undefined} products @param {string} role
 * @returns {{basics: RoleOption[], products: RoleOption[]}} */
export function roleOptions(basics, products, role) {
  const r = GUIDE_ROLES[role];
  const b = (basics || [])
    .filter(/** @type {(x: BasicFood | null | undefined) => x is BasicFood} */ ((x) => x && r.cats.includes(/** @type {string} */ (x.c)) && Array.isArray(x.m) && fin(x.m[r.at]) && x.m[r.at] > 0))
    .map((x) => ({ id: 'b:' + x.k, n: x.n, food: x }));
  /** @type {RoleOption[]} */
  const p = [];
  for (const x of products || []) {
    const v = x && x.per100;
    if (!v || (x.unit !== 'g' && x.unit !== 'ml') || !fin(v.kcal)) continue;
    const m = [v.kcal, v.protein, v.carbs, v.fat].map((n) => (fin(n) ? n : null));
    if (!(/** @type {number} */ (m[r.at]) > 0)) continue;
    p.push({ id: 'p:' + x.id, n: String(x.name || ''), food: { u: x.unit, m } });
  }
  /** @type {(list: RoleOption[]) => RoleOption[]} */
  const sort = (list) => list.sort((x, y) => cmp(foldName(x.n), foldName(y.n)) || cmp(x.id, y.id));
  return { basics: sort(b), products: sort(p) };
}

/** capByDay cases, run by the lib, the page and the built page (HC_GUIDE). */
export const DAYCAP_CASES = Object.freeze([
  { meal: 23, day: 0, total: 65, expect: { left: 0, byDay: true } },
  { meal: 109, day: 30, total: 280, expect: { left: 30, byDay: false } },
  { meal: 25, day: 90, total: 150, expect: { left: 25, byDay: false } },
  { meal: 25, day: 15, total: 150, expect: { left: 15, byDay: true } },
  { meal: 40, day: null, total: 150, expect: { left: 40, byDay: false } },
  { meal: 0, day: 40, total: 0, expect: { left: 0, byDay: true } },
]);

/** Shared cases: the page's exampleAmount (HC_GUIDE in nutri-day.ts) is pinned against these. */
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

/** What web/src/client/lib-globals.ts publishes as the page's HC_GUIDE (with num.mjs fin, amounts.mjs floorToStep,
 * names.mjs foldName): THESE functions, the portion guide's math (a plain descriptor; lib/nutrition never
 * imports lib/format: data/nutrition/generate.mjs loads lib/nutrition on its own). */
export const CLIENT = {
  consts: { GUIDE_ROLES, ROLE_KEYS, MACS, DONE_SHARE, COVERED_SHARE, OIL_SLOTS },
  hidden: {},
  fns: { zero, cmp, guideBudgets, exampleAmount, remaining, mealState, isCovered, dayRemaining, capByDay, roleOptions },
};
