/* On-bike fuelling ("Avituallamiento") for the bike day types — ORIENTATIVE ranges from common
 * sports-nutrition guidance, not a prescription and not medical advice:
 *   Antes / Before   2–3 h before: ~1–2 g carbs per kg; in the last hour 30–60 g of easy carbs.
 *   Durante / During bike 60 g/h, bikeLong 60–90 g/h; fluids 500–750 ml/h; sodium ~300–600 mg/h
 *                    (more in heat or for heavy sweaters — there is no weather data here, so ranges).
 *   Después / After  within 1 h: ~1–1.2 g carbs per kg + 30–40 g protein.
 * The on-bike carbs COUNT INSIDE the day total: the plan's meals are scaled to (target - ride fuel),
 * with the fuel point = the midpoint of the during-ride range (lib/nutrition/scale.mjs).
 *
 * The page recomputes this client-side for the viewer's ride duration (web/src/client/nutri-day.js
 * ports fuelPlan over the baked FUEL constants; a test pins that both agree). Pure: no I/O. */

import { isLocText, locText } from './names.mjs';

export const RIDE_DEFAULT_MIN = Object.freeze({ bike: 120, bikeLong: 210 });
// the ride-duration picker's choices (minutes): 1 h to 6 h in half hours
export const RIDE_DURATIONS = Object.freeze([60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360]);

export const FUEL = Object.freeze({
  before: Object.freeze({ hoursBefore: [2, 3], gPerKg: [1, 2], lastHourG: [30, 60] }),
  during: Object.freeze({
    gPerH: Object.freeze({ bike: [60, 60], bikeLong: [60, 90] }),
    fluidMlPerH: [500, 750],
    sodiumMgPerH: [300, 600],
  }),
  after: Object.freeze({ withinH: 1, gPerKg: [1, 1.2], proteinG: [30, 40] }),
  // generic practical units (not brands): a gel, a banana, a bar, a 500 ml bottle of 6–8% drink
  units: Object.freeze({ gelG: 25, bananaG: 25, barG: 40, bottleMl: 500, bottlePct: [6, 8], bottleG: [30, 40] }),
  roundG: 5,
  roundMl: 50,
  roundMg: 50,
  kcalPerG: 4,
});

export const isBikeDay = (dayType) => dayType === 'bike' || dayType === 'bikeLong';

const step = (v, s) => Math.round(v / s) * s;
const range = ([lo, hi], mul, s) => [step(lo * mul, s), step(hi * mul, s)];

/* ---------- the user's own fuel items (optional plan-data.json `fuel.items`) ----------
 * [{ name: {es, en} | string, carbs: g per piece, fat?: g, kind?: "fast" | "slow" }], baked as
 * NUTRI.fuel.items = [{n, c, f, k}] (name resolved by the build locale). With items, fuelPlan adds:
 *  during.own — the PIECE MIX: eating starts at OWN_START_MIN (the first half hour runs on the carbs
 *    eaten before), the pieces' target = the during-rate midpoint × (minutes − start) / 60 (5 g steps);
 *    n pieces are spread evenly from the start (piece j at start + j × (minutes − start) / n); a piece
 *    before half the ride is the first `slow` item (else the first item without a kind, else the first
 *    item), from half way the first `fast` one (same fallbacks); n = 1 … (minutes − start) / 10 (at most
 *    a piece every 10 min) whose total is closest to the target (ties: fewer pieces), never above the
 *    during range top. gapG = the plan point (planG, the day accounting) − the pieces, in 5 g steps.
 *  before.own — last hour: k fast pieces whose total falls inside lastHourG, closest to its midpoint.
 * The page ports this (web/src/client/nutri-day.js); FUEL_CASES pin both. */
export const FUEL_ITEM_KINDS = Object.freeze(['fast', 'slow']);
export const OWN_START_MIN = 30;
const OWN_MIN_EVERY = 10;

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const okName = (n) => (typeof n === 'string' ? n.trim() !== '' : isLocText(n));
const okCarbs = (c) => isFiniteNum(c) && c > 0 && c <= 100;
const okFat = (f) => f == null || (isFiniteNum(f) && f >= 0 && f <= 100);
const okKind = (k) => k == null || FUEL_ITEM_KINDS.includes(k);

/** Problems in plan.fuel (empty list = valid; absent = valid). */
export function validateFuelItems(plan) {
  const errs = [];
  const fuel = plan && plan.fuel;
  if (fuel == null) return errs;
  if (typeof fuel !== 'object' || Array.isArray(fuel)) return ['fuel must be an object { items: [...] }'];
  if (fuel.items == null) return errs;
  if (!Array.isArray(fuel.items)) return ['fuel.items must be an array of { name, carbs, fat?, kind? }'];
  fuel.items.forEach((it, i) => {
    const at = `fuel.items[${i}]`;
    if (!it || typeof it !== 'object' || Array.isArray(it)) { errs.push(`${at} must be an object { name, carbs, fat?, kind? }`); return; }
    if (!okName(it.name)) errs.push(`${at}.name must be a non-empty string or { es, en } with both texts`);
    if (!okCarbs(it.carbs)) errs.push(`${at}.carbs must be grams per piece, > 0 and <= 100 (got ${JSON.stringify(it.carbs)})`);
    if (!okFat(it.fat)) errs.push(`${at}.fat must be grams >= 0 when present (got ${JSON.stringify(it.fat)})`);
    if (!okKind(it.kind)) errs.push(`${at}.kind must be one of ${FUEL_ITEM_KINDS.join(', ')} when present (got ${JSON.stringify(it.kind)})`);
  });
  return errs;
}

/** plan.fuel.items -> the baked [{n, c, f, k}] in `lang`; malformed items are dropped ([] when none). */
export function normalizeFuelItems(plan, lang = 'en') {
  const items = plan && plan.fuel && Array.isArray(plan.fuel.items) ? plan.fuel.items : [];
  return items
    .filter((it) => it && typeof it === 'object' && okName(it.name) && okCarbs(it.carbs) && okFat(it.fat) && okKind(it.kind))
    .map((it) => ({ n: (typeof it.name === 'string' ? it.name : locText(it.name, lang)).trim(), c: it.carbs, f: it.fat == null ? null : it.fat, k: it.kind == null ? null : it.kind }));
}

function pickItem(items, kind) {
  let i = items.findIndex((x) => x.k === kind);
  if (i < 0) i = items.findIndex((x) => x.k == null);
  return i < 0 ? 0 : i;
}

function ownDuring(items, min, gPerH, topG, planG) {
  const eat = min - OWN_START_MIN;
  if (eat <= 0) return null;
  const targetG = step(((gPerH[0] + gPerH[1]) / 2) * eat / 60, FUEL.roundG);
  const slow = pickItem(items, 'slow'), fast = pickItem(items, 'fast');
  const maxN = Math.max(1, Math.floor(eat / OWN_MIN_EVERY));
  let best = null;
  for (let n = 1; n <= maxN; n++) {
    const seq = [];
    let total = 0;
    for (let j = 0; j < n; j++) {
      // piece j at start + j × eat / n; before half the ride <=> 2 × j × eat < (min − 2 × start) × n
      const i = 2 * j * eat < (min - 2 * OWN_START_MIN) * n ? slow : fast;
      seq.push(i);
      total += items[i].c;
    }
    total = Math.round(total * 10) / 10;
    if (total > topG) continue;
    if (!best || Math.abs(total - targetG) < Math.abs(best.total - targetG)) best = { n, seq, total };
  }
  if (!best) return null;
  const every = eat / best.n;
  const slots = [];
  best.seq.forEach((i, j) => {
    const last = slots[slots.length - 1];
    if (last && last.i === i) last.count++;
    else slots.push({ i, count: 1, fromMin: Math.round(OWN_START_MIN + j * every), everyMin: Math.round(every) });
  });
  return { startMin: OWN_START_MIN, targetG, slots, totalG: best.total, gapG: Math.max(0, step(planG - best.total, FUEL.roundG)) };
}

function ownBefore(items, [lo, hi]) {
  const i = pickItem(items, 'fast');
  const c = items[i].c;
  const mid = (lo + hi) / 2;
  let best = null;
  for (let k = 1; k * c <= hi; k++) {
    const g = Math.round(k * c * 10) / 10;
    if (g < lo) continue;
    if (!best || Math.abs(g - mid) < Math.abs(best.g - mid)) best = { i, count: k, g };
  }
  return best;
}

/** { dayType, minutes, weightKg, items? } -> the three windows for that ride, or null on a non-bike day. */
export function fuelPlan({ dayType, minutes, weightKg, items }) {
  if (!isBikeDay(dayType)) return null;
  const min = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : RIDE_DEFAULT_MIN[dayType];
  const h = min / 60;
  const kg = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : null;
  const U = FUEL.units;
  const gPerH = FUEL.during.gPerH[dayType];
  const carbsG = range(gPerH, h, FUEL.roundG);
  const planG = step(((gPerH[0] + gPerH[1]) / 2) * h, FUEL.roundG);
  const bottleMid = (U.bottleG[0] + U.bottleG[1]) / 2;
  const bottles = Math.max(0, Math.min(Math.ceil(h), Math.floor(planG / bottleMid)));
  const out = {
    minutes: min,
    before: {
      hoursBefore: FUEL.before.hoursBefore,
      gPerKg: FUEL.before.gPerKg,
      carbsG: kg ? range(FUEL.before.gPerKg, kg, FUEL.roundG) : null,
      lastHourG: FUEL.before.lastHourG,
    },
    during: {
      gPerH,
      carbsG,
      planG,
      fluidsMl: range(FUEL.during.fluidMlPerH, h, FUEL.roundMl),
      sodiumMg: range(FUEL.during.sodiumMgPerH, h, FUEL.roundMg),
      equiv: {
        gels: Math.ceil(planG / U.gelG),
        bananas: Math.ceil(planG / U.bananaG),
        bars: Math.ceil(planG / U.barG),
        bottles: [Math.ceil(planG / U.bottleG[1]), Math.ceil(planG / U.bottleG[0])],
      },
      mix: { bottles, gels: Math.ceil(Math.max(0, planG - bottles * bottleMid) / U.gelG) },
    },
    after: {
      withinH: FUEL.after.withinH,
      gPerKg: FUEL.after.gPerKg,
      carbsG: kg ? range(FUEL.after.gPerKg, kg, FUEL.roundG) : null,
      proteinG: FUEL.after.proteinG,
    },
    kcal: planG * FUEL.kcalPerG,
  };
  if (Array.isArray(items) && items.length) {
    out.during.own = ownDuring(items, min, gPerH, out.during.carbsG[1], planG);
    out.before.own = ownBefore(items, FUEL.before.lastHourG);
  }
  return out;
}

/** Shared cases: the reference and the client port must agree on each (web/src/client/nutri-day.test.mjs). */
const C_PASTE = { n: 'Fruit paste', c: 21, f: 0.3, k: 'fast' };
const C_BAR = { n: 'Date bar', c: 20, f: 2.7, k: 'slow' };
export const FUEL_CASES = Object.freeze([
  { dayType: 'bike', minutes: 90, weightKg: 70, items: [C_PASTE, C_BAR] },
  { dayType: 'bike', minutes: 120, weightKg: null, items: [C_BAR, C_PASTE] },
  { dayType: 'bikeLong', minutes: 210, weightKg: 70, items: [C_PASTE, C_BAR] },
  { dayType: 'bikeLong', minutes: 360, weightKg: 80, items: [C_PASTE] },
  { dayType: 'bike', minutes: 75, weightKg: 70, items: [{ n: 'Gel', c: 25, f: null, k: null }, C_BAR] },
  { dayType: 'bikeLong', minutes: 150, weightKg: 70, items: [{ n: 'Big bar', c: 45, f: 9, k: 'slow' }] },
]);
