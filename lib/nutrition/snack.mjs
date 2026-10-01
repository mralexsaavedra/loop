/* The automatic snack of Plan de hoy. With realistic portion caps (lib/nutrition/amounts.mjs maxAmt) a
 * plan's meals often cannot reach a high target: every carb portion stops at its maximum and the day
 * ends short. Instead of only saying so, planFor (lib/nutrition/scale.mjs) ADDS a snack sized to the
 * shortfall when it is beyond REMAINDER_TOLERANCE_K:
 *   - the options are small TRACKED recipes (SNACK_OPTIONS, never the personal plan) built from the
 *     public food DB (data/nutrition/ingredients.json, incl. the log-only basics); each line has a
 *     snack-sized cap `max` (an absolute amount in the food's unit), its effective cap = min(max, the
 *     food's own maxAmt);
 *   - the WHOLE option scales by one factor to the shortfall (fillTo: water-filling, a line past its cap
 *     held there and the factor re-solved over the rest, no 0.6–2× clamp: a snack may be small or big),
 *     countable lines rounded first to half pieces / whole units, then the g / ml lines re-solved for
 *     what is left (like solveScale); amounts on the usual grid (stepAmount), never past the cap, the
 *     macros from the ROUNDED amounts. What the caps leave over stays the day's remainder (a note);
 *   - the default option (defaultSnack) = the first option in list order whose capped kcal can fill the
 *     shortfall, else the one that fills most — deterministic; a viewer's pick (hc.nutri.picks, id
 *     SNACK_ID) wins while it is a known option;
 *   - the snack is an add-on: a new meal "Tentempié" / "Snack" (slot snack) after the others, or — when
 *     the plan already has a snack-slot meal (a merienda, a protein anchor) — ONE more part of the first
 *     such meal, never a second snack meal (withSnack);
 *   - bike day types: the shortfall goes to the ride fuel as before, but only up to the top of the
 *     ride's g/h range (rideHeadroomK: 0 for `bike`, whose rate is fixed at 60 g/h); only what is beyond
 *     that becomes a snack.
 * web/src/client/nutri-day.js ports fillTo / solveSnack / snackCapK / defaultSnack / snackFor /
 * rideHeadroomK / withSnack line by line (parity test). Pure, no I/O. */
import { modelLine, stepAmount, capAmount, capFactor, isDiscrete, fmtAmt, pieceOf, LINE, lineUnit, lineAmt, lineStep } from './amounts.mjs';
import { ingName, locText } from './names.mjs';
import { round2 } from './num.mjs';
import { FUEL } from './fuel.mjs';

export const SNACK_ID = 'snack/auto';
export const SNACK_SLOT = 'snack';
export const SNACK_NAME = Object.freeze({ es: 'Tentempié', en: 'Snack' });

const opt = (k, es, en, recipe) => Object.freeze({ k, n: Object.freeze({ es, en }), recipe: Object.freeze(recipe.map((l) => Object.freeze(l))) });
/** The snack options, in default-preference order: {k: stable key (the pick), n: {es, en}, recipe:
 * [{ing, amt (the ratio at factor 1), max (the snack-sized cap)}]}. */
export const SNACK_OPTIONS = Object.freeze([
  opt('fruit-yogurt', 'Fruta + yogur natural', 'Fruit + plain yogurt', [{ ing: 'manzana', amt: 180, max: 270 }, { ing: 'yogurnatural', amt: 125, max: 250 }]),
  opt('banana-quark', 'Plátano + queso fresco batido', 'Banana + quark', [{ ing: 'platano', amt: 120, max: 240 }, { ing: 'quesobatido', amt: 150, max: 300 }]),
  opt('yogurt-cereal', 'Yogur + cereales', 'Yogurt + cereal', [{ ing: 'yogurnatural', amt: 125, max: 250 }, { ing: 'cereales', amt: 30, max: 60 }]),
  opt('tomato-toast', 'Tostada con aceite y tomate', 'Toast with olive oil and tomato', [{ ing: 'panbarra', amt: 60, max: 150 }, { ing: 'tomate', amt: 50, max: 150 }, { ing: 'aceiteoliva', amt: 5, max: 15 }]),
  opt('turkey-sandwich', 'Bocadillo de pavo', 'Turkey sandwich', [{ ing: 'panbarra', amt: 60, max: 150 }, { ing: 'pavo', amt: 40, max: 120 }]),
  opt('nuts', 'Frutos secos (nueces y almendras)', 'Nuts (walnuts and almonds)', [{ ing: 'nueces', amt: 15, max: 30 }, { ing: 'almendras', amt: 15, max: 30 }]),
]);

/** The snack bake: {id: SNACK_ID, slot: SNACK_SLOT, n: the meal name in `lang`, opts: [{k, n, ln: model
 * lines (macros to 2 decimals, every line capped), c: component names}]}. An option whose food is missing
 * from ING is left out. */
export function buildSnacks(ING, lang = 'en') {
  const opts = [];
  for (const o of SNACK_OPTIONS) {
    if (!o.recipe.every((l) => ING && ING[l.ing])) continue;
    const ln = o.recipe.map((l) => {
      const x = modelLine(ING, l);
      for (let i = LINE.K; i <= LINE.G; i++) x[i] = round2(x[i]);
      while (x.length < LINE.CAP) x.push(null);
      x[LINE.CAP] = Math.min(l.max, ING[l.ing].maxAmt > 0 ? ING[l.ing].maxAmt : Infinity);
      return x;
    });
    opts.push({ k: o.k, n: locText(o.n, lang), ln, c: o.recipe.map((l) => ingName(ING, l.ing, lang)) });
  }
  return { id: SNACK_ID, slot: SNACK_SLOT, n: locText(SNACK_NAME, lang), opts };
}

/** Water-filling WITHOUT a clamp over `items` ([{k: kcal at factor 1, cap: capFactor}]): one common
 * factor so they total `needK` (never below 0), an item past its cap held there and the factor re-solved
 * over the rest until stable; every item held -> the largest cap. {f: rounded to 2 decimals, held}. */
export function fillTo(items, needK) {
  const held = items.map(() => false);
  let heldK = 0;
  let f = 0;
  for (;;) {
    let freeK = 0;
    items.forEach((it, i) => { if (!held[i]) freeK += it.k; });
    if (!(freeK > 0)) break;
    f = Math.max(0, (needK - heldK) / freeK);
    let more = false;
    items.forEach((it, i) => {
      if (!held[i] && it.cap < f) { held[i] = true; heldK += it.k * it.cap; more = true; }
    });
    if (!more) break;
  }
  if (items.length && held.every(Boolean)) f = Math.max(...items.map((it) => it.cap));
  return { f: round2(f), held };
}

/** The most kcal option `o` can give (every line at its cap). */
export function snackCapK(o) {
  let k = 0;
  for (const l of o.ln) k += l[LINE.K] * capFactor(l);
  return k;
}

/** The default option key for a shortfall of `needK`: the first that can fill it, else the one that
 * fills most (the first on a tie); null without options. */
export function defaultSnack(opts, needK) {
  let best = null;
  let bestK = -1;
  for (const o of opts || []) {
    const k = snackCapK(o);
    if (k >= needK) return o.k;
    if (k > bestK) { best = o.k; bestK = k; }
  }
  return best;
}

/** Option `o` scaled to `needK` kcal: {k, n, c, nums (line amounts), amts (as shown), mac [k, p, c, g]
 * at the rounded amounts, capped: every line at its cap (nothing can grow)}. */
export function solveSnack(o, needK, fmt) {
  const all = o.ln.map((l) => ({ k: l[LINE.K], cap: capFactor(l), ud: isDiscrete(l) }));
  const amountAt = (l, s) => capAmount(stepAmount(lineAmt(l) * s, lineUnit(l), lineStep(l)), l);
  const f0 = fillTo(all, needK).f;
  let f = f0;
  if (all.some((it) => it.ud) && all.some((it) => !it.ud)) {
    let udK = 0;
    for (const l of o.ln) if (isDiscrete(l)) udK += l[LINE.K] * (amountAt(l, Math.min(f0, capFactor(l))) / lineAmt(l));
    f = fillTo(all.filter((it) => !it.ud), needK - udK).f;
  }
  const mac = [0, 0, 0, 0];
  const nums = [];
  let capped = true;
  const amts = o.ln.map((l) => {
    const cf = capFactor(l);
    const s = isDiscrete(l) ? f0 : f;
    if (s < cf) capped = false;
    const amt = amountAt(l, Math.min(s, cf));
    nums.push(amt);
    for (let i = 0; i < 4; i++) mac[i] += (l[LINE.K + i] * amt) / lineAmt(l);
    return fmtAmt(amt, lineUnit(l), fmt.units, pieceOf(fmt.pieces || null, l));
  });
  return { k: o.k, n: o.n, c: o.c || null, nums, amts, mac, capped };
}

/** The snack for a shortfall of `needK`: the picked option when it is a known one, else the default,
 * solved (solveSnack) + `d` = the default key; null without a bake or options. */
export function snackFor(sb, needK, pick, fmt) {
  if (!sb || !Array.isArray(sb.opts) || !sb.opts.length) return null;
  const d = defaultSnack(sb.opts, needK);
  let o = null;
  for (const x of sb.opts) if (x.k === pick) o = x;
  if (!o) for (const x of sb.opts) if (x.k === d) o = x;
  return { ...solveSnack(o, needK, fmt), d };
}

/** kcal the ride may still take before it passes the top of its g/h range (fuelPlan result; 0 off-bike
 * and for `bike`, whose rate is fixed). */
export function rideHeadroomK(fuel, kcalPerG = FUEL.kcalPerG) {
  if (!fuel) return 0;
  const top = fuel.during.gPerH[1] * (fuel.minutes / 60);
  return Math.max(0, Math.round((top - fuel.during.planG) * kcalPerG));
}

/** The plan's meals ({view, meals: [[k, p, c, g]]}) with snack `sn` (snackFor) added — a new meal named
 * `name` (slot snack) after the others, or one more part of the first meal already in the snack slot.
 * Fresh arrays; the inputs are never mutated. The part carries the stable id SNACK_ID and `sn: 1`. */
export function withSnack(view, meals, sn, name) {
  const part = sn.c && sn.amts.length > 1
    ? { l: sn.n, id: SNACK_ID, sn: 1, c: sn.c, a: sn.amts, m: sn.mac }
    : { l: sn.n, id: SNACK_ID, sn: 1, q: sn.amts.join(' + '), m: sn.mac };
  const v = view.slice();
  const ms = meals.map((m) => m.slice());
  let at = -1;
  for (let i = 0; i < v.length && at < 0; i++) if (v[i] && v[i].s === SNACK_SLOT) at = i;
  if (at < 0) {
    v.push({ n: name, s: SNACK_SLOT, pcf: true, parts: [part] });
    ms.push(sn.mac.slice());
  } else {
    v[at] = { ...v[at], parts: v[at].parts.concat([part]) };
    for (let i = 0; i < 4; i++) ms[at][i] += sn.mac[i];
  }
  return { view: v, meals: ms };
}
