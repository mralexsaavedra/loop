/* Portion scaling: the plan's base day (dayPlan.train / dayPlan.rest) scaled to a (goal × day type)
 * target. Declarative: a dayPlan part marked `flex: "carb"` (rice, pasta, bread, fruit, honey…) is
 * scalable; every other part (protein, fat, veg) stays as written. The base day's macros come from
 * the existing engine (lib/nutrition/macros.mjs, ingredients.json — never hand-typed); ONE factor is
 * applied to every carb-flex part so the day lands on the target kcal, clamped to
 * [SCALE_MIN, SCALE_MAX] so a portion never becomes absurd. Amounts round to practical steps (5 g /
 * 5 ml; units stay whole units) and the totals are recomputed from the ROUNDED amounts, so what the
 * page shows adds up. Whatever the clamp or the rounding leaves over is reported as `rem` (target −
 * ride fuel − meals, kcal), never hidden.
 *
 * Bike day types: the on-bike carbs count inside the day total, so the meals aim at target − ride
 * fuel (lib/nutrition/fuel.mjs, default ride duration).
 *
 * buildDayPlans() precomputes all 12 (goal × day type) plans at build time; the page only switches
 * between them, so builds stay byte-identical. Pure: no I/O. */
import { DAY_TYPES, GOALS, BASE_DAY, resolveTargets, resolveGoal } from './targets.mjs';
import { fuelPlan, RIDE_DEFAULT_MIN, isBikeDay } from './fuel.mjs';
import { mealSlot } from './slots.mjs';
import { pieceFmt, UD_AMT, PIECE_GRID } from './units.mjs';
import { ingName, lineName, hasAmount } from './names.mjs';
import { round2 } from './num.mjs';
import { buildBlocks, applyPicks, newFoods } from './blocks.mjs';
import { AMOUNT_STEP, stepAmount, capAmount, capFactor, modelLine, isDiscrete, fmtAmt, LINE, lineUnit, lineAmt, lineStep, lineKey, pieceOf } from './amounts.mjs';
import { isFlexPart } from './flex.mjs';

export const SCALE_MIN = 0.6;
export const SCALE_MAX = 2.0;
// rounding every flex part to 5 g moves the day by a few dozen kcal at most; beyond this the page
// says how much is missing (or left over) and what to do with it
export const REMAINDER_TOLERANCE_K = 75;
// protein and fat are not scaled: a plan more than this far from the target says so
export const MACRO_TOLERANCE_G = 15;

const DEFAULT_UNITS = Object.freeze({ g: 'g', ml: 'ml', ud: 'ud' });
const MAC = ['k', 'p', 'c', 'g'];
const zero = () => ({ k: 0, p: 0, c: 0, g: 0 });
const add = (a, b) => { for (const f of MAC) a[f] += b[f]; return a; };
const r0 = (v) => Math.round(v);



function lineMacros(ING, line) {
  const ing = ING[line.ing];
  if (!ing) throw new Error('unknown ingredient: ' + line.ing);
  const f = line.amt / ing.per;
  return { k: ing.k * f, p: ing.p * f, c: ing.c * f, g: ing.g * f };
}

function fmtLine(ING, l, units, pieces) {
  const unit = ING[l.ing].unit;
  return fmtAmt(l.amt, unit, units, pieces && pieces[l.ing]);
}
function fmtLines(ING, lines, units, pieces) {
  return lines.map((l) => fmtLine(ING, l, units, pieces)).join(' + ');
}

/** A dayPlan part -> { label, flex, lines ([{ing, amt}]) | manual ({k,p,c,g}), q (display text) }. */
function describePart(nut, part, units, pieces, lang) {
  const flex = isFlexPart(nut, part); // explicit marks + carb / fruit foods by category (lib/nutrition/flex.mjs)
  if (part.ing) {
    const ing = nut.ING[part.ing];
    if (!ing) throw new Error('dayPlan part: unknown ingredient: ' + part.ing);
    const lines = [{ ing: part.ing, amt: part.amt }];
    return { label: part.label || ingName(nut.ING, part.ing, lang), flex, lines, q: fmtLines(nut.ING, lines, units, pieces) };
  }
  const item = nut.findItem(part);
  const label = part.label || item.n || item.l;
  if (item.recipe) {
    const lines = item.recipe.map((l) => ({ ing: l.ing, amt: l.amt }));
    const own = hasAmount(item.q);
    const d = { label, flex, lines, q: own ? item.q : fmtLines(nut.ING, item.recipe, units, pieces) };
    // a composite (several lines, no amount of its own): the page lists its components by name
    if (!own && lines.length > 1) {
      d.names = item.recipe.map((l) => lineName(nut.ING, l, lang));
      d.amts = lines.map((l) => fmtLine(nut.ING, l, units, pieces));
    }
    return d;
  }
  const r = nut.resolve(item); // manual / none: a fixed macro block, scaled as a whole
  return { label, flex, manual: { k: r.k, p: r.p, c: r.c, g: r.g }, q: item.q || '' };
}

function describeDay(nut, day, units, pieces, lang) {
  return nut.DAYPLAN[day].meals.map((meal) => ({ meal, parts: (meal.parts || []).map((p) => describePart(nut, p, units, pieces, lang)) }));
}

// a described part's macros [k, p, c, g] (a manual block as written, else the sum of its lines)
function partMacros(nut, d) {
  const x = d.manual ? d.manual : d.lines.reduce((acc, l) => add(acc, lineMacros(nut.ING, l)), zero());
  return MAC.map((k) => x[k]);
}

/** The base day `day` as a compact, JSON-safe SCALING MODEL — what the page bakes so it can re-solve
 * the plan for any meals target (a ride's minutes change it) with the same maths as here:
 *   fixed[i] = meal i's fixed macros [k, p, c, g] (every part not marked flex);
 *   flex     = the carb-flex parts in part order: { m: meal index, ln: [[unit, amt, k, p, c, g], …] }
 *              (the macros at that amount) or, for a `manual` block, { m, mb: [k, p, c, g], q }.
 * `meals` (not baked) keeps the described parts for scaleDay / the bake's display structure. */
export function planModel(nut, day, { units = DEFAULT_UNITS, pieces = null, lang = 'en' } = {}) {
  const meals = describeDay(nut, day, units, pieces, lang);
  const fixed = [];
  const flex = [];
  meals.forEach(({ parts }, m) => {
    const f = [0, 0, 0, 0];
    for (const d of parts) {
      if (d.flex) {
        if (d.manual) flex.push({ m, mb: MAC.map((x) => d.manual[x]), q: d.q });
        else flex.push({ m, ln: d.lines.map((l) => modelLine(nut.ING, l)) });
      } else {
        const x = d.manual ? d.manual : d.lines.reduce((acc, l) => add(acc, lineMacros(nut.ING, l)), zero());
        MAC.forEach((k, i) => { f[i] += x[k]; });
      }
    }
    fixed.push(f);
  });
  return { meals, fixed, flex };
}

/** The carb factor as the page labels it: 2 decimals (the factor is rounded to 2), locale decimal mark. */
export function fmtFactor(f, dec = '.') {
  return f.toFixed(2).replace('.', dec);
}



function limit(f) {
  if (f < SCALE_MIN) return [SCALE_MIN, 'min'];
  if (f > SCALE_MAX) return [SCALE_MAX, 'max'];
  return [f, null];
}

/** Water-filling over `items` ([{k: kcal at factor 1, cap: capFactor}]): ONE common factor so they total
 * `needK`, clamped to [SCALE_MIN, SCALE_MAX]; an item whose cap is below that factor is HELD at its cap
 * (its kcal at the cap leave the need) and the factor is re-solved over the items still free, until no
 * free item passes its cap or every item is held. A cap below SCALE_MIN still wins (a written amount
 * above its cap shrinks to it). Returns {f: the factor rounded to 2 decimals, clamp, held: [boolean]};
 * with every item held there is no common factor left: `f` = the largest factor a portion got (its cap)
 * and no clamp. */
function waterFill(items, needK) {
  const held = items.map(() => false);
  let heldK = 0;
  let f = 1;
  let clamp = null;
  for (;;) {
    let freeK = 0;
    items.forEach((it, i) => { if (!held[i]) freeK += it.k; });
    if (!(freeK > 0)) break;
    [f, clamp] = limit((needK - heldK) / freeK);
    let more = false;
    items.forEach((it, i) => {
      if (!held[i] && it.cap < f) { held[i] = true; heldK += it.k * it.cap; more = true; }
    });
    if (!more) break;
  }
  if (items.length && held.every(Boolean)) {
    f = Math.max(...items.map((it) => it.cap));
    clamp = null;
  }
  return { f: round2(f), clamp, held };
}

/** Pure solver over a planModel: the carb-flex parts scaled so the meals total `mealsTargetK`.
 *  1. water-filling (waterFill) over every flex line and manual block: one common factor f0, a line
 *     that would pass its portion cap (`maxAmt`, lib/nutrition/amounts.mjs) held at the cap;
 *  2. whole-unit / countable (DISCRETE) lines round at their factor (min(f0, cap)) to whole units / half
 *     pieces, never past the cap;
 *  3. the factor is RE-SOLVED (water-filling again) on the remaining g / ml lines and manual blocks for
 *     what the rounded units left — so a unit's rounding does not throw the day off. With only unit
 *     parts flexible (`udOnly`), the factor stays f0 and the remainder says what is left.
 * Amounts round to 5 g / 5 ml (factor 1 leaves them as written) and never past a cap; the totals come
 * from the ROUNDED amounts. `capped` = some line is at its cap, `allCapped` = every flex line is (and
 * no manual block, which has no cap) — nothing can grow any more. web/src/client/nutri-day.js ports this
 * line by line (parity test). */
export function solveScale(model, mealsTargetK, { units = DEFAULT_UNITS, dec = '.', pieces = null } = {}) {
  let fixedK = 0;
  for (const f of model.fixed) fixedK += f[0];
  let udK = 0;
  let contK = 0;
  const all = []; // every flex line / manual block, in part then line order: {k, cap, ud}
  for (const x of model.flex) {
    if (x.mb) { contK += x.mb[0]; all.push({ k: x.mb[0], cap: Infinity, ud: false }); continue; }
    for (const l of x.ln) {
      const ud = isDiscrete(l);
      if (ud) udK += l[LINE.K]; else contK += l[LINE.K];
      all.push({ k: l[LINE.K], cap: capFactor(l), ud });
    }
  }
  const w0 = waterFill(all, mealsTargetK - fixedK);
  const f0 = w0.f;
  let clamp = w0.clamp;
  let held = w0.held;
  const amountAt = (l, s) => (s === 1 ? lineAmt(l) : capAmount(stepAmount(lineAmt(l) * s, lineUnit(l), lineStep(l)), l));
  let factor = f0;
  if (udK > 0 && contK > 0) {
    let udNowK = 0;
    for (const x of model.flex) if (x.ln) for (const l of x.ln) if (isDiscrete(l)) udNowK += l[LINE.K] * (amountAt(l, Math.min(f0, capFactor(l))) / lineAmt(l));
    const w1 = waterFill(all.filter((it) => !it.ud), mealsTargetK - fixedK - udNowK);
    factor = w1.f;
    clamp = w1.clamp;
    let ci = 0;
    held = all.map((it, i) => (it.ud ? w0.held[i] : w1.held[ci++]));
  }
  const meals = model.fixed.map((f) => f.slice());
  const q = [];
  const qa = []; // per flex part: its line amounts (the page lists a composite's components)
  const dir = []; // per flex part: +1 scaled up, -1 down, 0 as written
  const qm = []; // per flex part: its macros [k, p, c, g] at the rounded amounts (the food log's "Del plan")
  const qn = []; // per flex part: its numeric line amounts ([null] for a manual block)
  let capped = false;
  let allCapped = all.length > 0;
  let ii = 0; // index into `all` / `held`
  for (const x of model.flex) {
    const m = meals[x.m];
    if (x.mb) {
      ii++;
      allCapped = false; // a manual block has no cap: it could still grow
      const pm = x.mb.map((v) => v * factor);
      for (let i = 0; i < 4; i++) m[i] += pm[i];
      const t = factor === 1 ? x.q : `${x.q} ×${fmtFactor(factor, dec)}`.trim();
      q.push(t);
      qa.push([t]);
      qn.push([null]);
      dir.push(Math.sign(factor - 1));
      qm.push(pm);
      continue;
    }
    let baseK = 0;
    let nowK = 0;
    const pm = [0, 0, 0, 0];
    const nums = [];
    const amts = x.ln.map((l) => {
      const cf = capFactor(l);
      const f = isDiscrete(l) ? f0 : factor;
      if (held[ii++] || f >= cf) capped = true;
      else allCapped = false;
      const amt = amountAt(l, Math.min(f, cf));
      nums.push(amt);
      const r = amt / lineAmt(l);
      for (let i = 0; i < 4; i++) { m[i] += l[LINE.K + i] * r; pm[i] += l[LINE.K + i] * r; }
      baseK += l[LINE.K];
      nowK += l[LINE.K] * r;
      return fmtAmt(amt, lineUnit(l), units, pieceOf(pieces, l));
    });
    q.push(amts.join(' + '));
    qa.push(amts);
    qn.push(nums);
    dir.push(Math.abs(nowK - baseK) < 0.5 ? 0 : Math.sign(nowK - baseK));
    qm.push(pm);
  }
  const totals = zero();
  for (const m of meals) MAC.forEach((k, i) => { totals[k] += m[i]; });
  return { factor, clamp, udOnly: udK > 0 && contK === 0, capped, allCapped, meals, q, qa, qn, dir, qm, totals, rem: r0(mealsTargetK) - r0(totals.k) };
}

/** The base day `day` ('train' | 'rest') scaled so its meals total `mealsTargetK` kcal. */
export function scaleDay(nut, day, mealsTargetK, { units = DEFAULT_UNITS, dec = '.', lang = 'en' } = {}) {
  const pieces = pieceFmt(nut.ING, lang);
  const model = planModel(nut, day, { units, pieces, lang });
  const s = solveScale(model, mealsTargetK, { units, dec, pieces });
  let fi = 0;
  const out = model.meals.map(({ meal, parts }, i) => {
    const [k, p, c, g] = s.meals[i];
    const shown = parts.map((d) => ({ label: d.label, flex: d.flex, q: d.flex ? s.q[fi++] : d.q }));
    return { name: meal.name, slot: mealSlot(meal), k, p, c, g, parts: shown };
  });
  return { factor: s.factor, clamp: s.clamp, udOnly: s.udOnly, capped: s.capped, allCapped: s.allCapped, meals: out, totals: s.totals, rem: s.rem };
}

const macroRow = (m) => m.map(r0);

/** One (goal, day type) plan for a ride of `minutes` (bike day types; else ignored): the meals aim at
 * target - ride fuel(minutes) (lib/nutrition/fuel.mjs; the default duration when minutes is absent).
 * `bake` = { base: {<day>: model}, lists, plans: {<g>: {<d>: {base, t}}}, fmt }. `mt` = the MEALS
 * target (the ride fuel is all carbs, so it comes off kcal and carbs). `picks` = the viewer's block
 * choices ({id: option key}, lib/nutrition/blocks.mjs applyPicks): the WHOLE day is re-solved with
 * them; `view` = the meals to display (the base day's display structure when nothing is picked) and
 * `picks` = the effective ones. The page runs the same function over the baked models (nutri-day.js,
 * parity test). */
export function planFor(bake, goal, dayType, minutes, picks) {
  const x = bake.plans[goal][dayType];
  const fuel = isBikeDay(dayType) ? fuelPlan({ dayType, minutes }) : null;
  const fuelK = fuel ? fuel.kcal : 0;
  const fuelC = fuel ? fuel.during.planG : 0;
  const mdl = applyPicks(bake.base[x.base], bake.lists || {}, picks, bake.fmt, bake.foods);
  const s = solveScale(mdl, x.t.kcal - fuelK, bake.fmt);
  const tot = { k: r0(s.totals.k), p: r0(s.totals.p), c: r0(s.totals.c), g: r0(s.totals.g) };
  return {
    base: x.base,
    t: x.t,
    minutes: fuel ? fuel.minutes : null,
    fuelK,
    fuelC,
    mt: { k: x.t.kcal - fuelK, p: x.t.p, c: x.t.c - fuelC, f: x.t.f },
    meals: s.meals.map(macroRow),
    flex: s.q,
    flexAmts: s.qa,
    flexN: s.qn,
    flexDir: s.dir,
    flexMac: s.qm,
    tot,
    factor: s.factor,
    clamp: s.clamp,
    udOnly: s.udOnly,
    capped: s.capped,
    allCapped: s.allCapped,
    rem: x.t.kcal - fuelK - tot.k,
    view: mdl.meals,
    picks: mdl.picks,
  };
}

/** All 12 (goal × day type) plans. The meal structure AND the scaling model are baked once per base
 * day (`base[day]` = { note, meals: display structure, fixed, flex }); `plans[g][d]` = planFor() at the
 * default ride minutes (plan-tables.md reads these; the page bakes only `{base, t}` and re-solves).
 * `supplements` (profile.json) ride along for Plan de hoy. */
export function buildDayPlans(nut, plan, { supplements = [], units = DEFAULT_UNITS, dec = '.', lang = 'en' } = {}) {
  const targets = resolveTargets(plan);
  const allPieces = pieceFmt(nut.ING, lang);
  const base = {};
  const lists = {};
  const foods = newFoods();
  for (const day of new Set(Object.values(BASE_DAY))) {
    const model = planModel(nut, day, { units, pieces: allPieces, lang });
    const bl = buildBlocks(nut, day, lists, lang, foods);
    base[day] = {
      note: nut.DAYPLAN[day].kcalNote || null,
      meals: model.meals.map(({ meal, parts }, mi) => ({
        n: meal.name,
        s: mealSlot(meal),
        pcf: meal.pcf !== false,
        // a fixed part carries its own macros `m` [k, p, c, g] (the food log's "Del plan" logs one
        // item); a flex part's come from solveScale (`qm`) at the scaled amount
        // a choosable block (lib/nutrition/blocks.mjs) carries its stable id
        parts: parts.map((x, pi) => {
          const id = bl.ids[mi][pi];
          let d;
          if (x.flex) d = x.names ? { l: x.label, x: 1, c: x.names } : { l: x.label, x: 1 };
          else {
            const m = partMacros(nut, x);
            d = x.names ? { l: x.label, q: x.q, c: x.names, a: x.amts, m } : { l: x.label, q: x.q, m };
          }
          if (id) d.id = id;
          return d;
        }),
      })),
      fixed: model.fixed,
      flex: model.flex,
      blocks: bl.blocks,
    };
  }
  // only the pieces a baked line can format (flex lines of the base days, every option line)
  const pieces = {};
  const usePieces = (ln) => { for (const l of ln) { const k = lineKey(l); if (k && allPieces[k]) pieces[k] = allPieces[k]; } };
  for (const day of Object.keys(base)) for (const x of base[day].flex) if (x.ln) usePieces(x.ln);
  for (const L of Object.keys(lists)) for (const o of lists[L]) if (o.ln) usePieces(o.ln);
  for (const k of Object.keys(foods.ings)) usePieces([foods.ings[k].l]);
  const fmt = { units, dec, pieces };
  const bake = { base, lists, foods, plans: {}, fmt };
  for (const g of GOALS) {
    bake.plans[g] = {};
    for (const d of DAY_TYPES) bake.plans[g][d] = { base: BASE_DAY[d], t: targets[g][d] };
  }
  const plans = {};
  for (const g of GOALS) {
    plans[g] = {};
    for (const d of DAY_TYPES) plans[g][d] = planFor(bake, g, d, RIDE_DEFAULT_MIN[d]);
  }
  return {
    goal: resolveGoal(plan),
    goals: GOALS,
    dayTypes: DAY_TYPES,
    base,
    lists,
    foods,
    plans,
    fmt,
    tolerance: REMAINDER_TOLERANCE_K,
    scale: { min: SCALE_MIN, max: SCALE_MAX, step: AMOUNT_STEP, ud: UD_AMT, grid: PIECE_GRID },
    supplements: Array.isArray(supplements) ? supplements : [],
  };
}
