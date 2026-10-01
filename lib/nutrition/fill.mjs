/* Water-filling: the ONE solver behind the carb-flex scaling (lib/nutrition/scale.mjs solveScale).
 * web/src/client/nutri-day.js ports it line by line
 * (parity test over FILL_CASES and through planFor). Pure, no I/O. */
import { round2 } from './num.mjs';

// the factor bounded by `clamp` ([min, max] -> [f, 'min' | 'max' | null]); without one only floored at 0
function bound(f, clamp) {
  if (!clamp) return [Math.max(0, f), null];
  if (f < clamp[0]) return [clamp[0], 'min'];
  if (f > clamp[1]) return [clamp[1], 'max'];
  return [f, null];
}

/** Water-filling over `items` ([{k: kcal at factor 1, cap: capFactor}]): ONE common factor so they total
 * `needK`, bounded by `clamp` ([min, max]; absent = no bound, never below 0); an item whose cap is below
 * that factor is HELD at its cap (its kcal at the cap leave the need) and the factor is re-solved over
 * the items still free, until no free item passes its cap or every item is held. A cap below the clamp's
 * minimum still wins (a written amount above its cap shrinks to it). `start` = the factor when there is
 * nothing free to fill (the carb solve: 1; default 0). Returns {f: rounded to 2 decimals, clamp: the
 * bound hit ('min' | 'max' | null), held: [boolean]}; with every item held there is no common factor
 * left: `f` = the largest factor a portion got (its cap) and no clamp. */
export function waterFill(items, needK, { clamp = null, start = 0 } = {}) {
  const held = items.map(() => false);
  let heldK = 0;
  let f = start;
  let hit = null;
  for (;;) {
    let freeK = 0;
    items.forEach((it, i) => { if (!held[i]) freeK += it.k; });
    if (!(freeK > 0)) break;
    [f, hit] = bound((needK - heldK) / freeK, clamp);
    let more = false;
    items.forEach((it, i) => {
      if (!held[i] && it.cap < f) { held[i] = true; heldK += it.k * it.cap; more = true; }
    });
    if (!more) break;
  }
  if (items.length && held.every(Boolean)) {
    f = Math.max(...items.map((it) => it.cap));
    hit = null;
  }
  return { f: round2(f), clamp: hit, held };
}

const C = Object.freeze([0.6, 2]);
/** Shared cases: {items, need, opts?}; the lib tests and the page port run them (nutri-day.test.mjs). */
export const FILL_CASES = Object.freeze([
  { items: [{ k: 100, cap: 5 }, { k: 300, cap: 5 }], need: 600 },
  { items: [{ k: 100, cap: 1.2 }, { k: 300, cap: 5 }], need: 1000 },
  { items: [{ k: 100, cap: 9 }], need: -50 },
  { items: [{ k: 100, cap: 1.5 }, { k: 100, cap: 1.2 }], need: 1000 },
  { items: [], need: 300 },
  { items: [{ k: 120, cap: Infinity }, { k: 80, cap: 1.1 }, { k: 50, cap: 0.4 }], need: 333 },
  { items: [{ k: 100, cap: 9 }], need: 1000, opts: { clamp: C, start: 1 } },
  { items: [{ k: 100, cap: 9 }], need: 10, opts: { clamp: C, start: 1 } },
  { items: [{ k: 100, cap: 0.5 }, { k: 100, cap: 9 }], need: 100, opts: { clamp: C, start: 1 } },
  { items: [{ k: 200, cap: 1.3 }, { k: 250, cap: 1.7 }, { k: 90, cap: Infinity }], need: 900, opts: { clamp: C, start: 1 } },
  { items: [], need: 300, opts: { clamp: C, start: 1 } },
]);
