/* Pure nutrition macro computation — extracted verbatim from the compute
 * section of data/nutrition/generate.js (astro-plan-web migration, slice 2).
 * No I/O: given the same (ingredients, plan) input, always produces the same
 * output. data/nutrition/generate.js requires this module and destructures
 * its result instead of computing inline, so legacy output stayed byte-for-
 * byte identical through the refactor (verified once against a golden
 * capture taken before this extraction; the capture script itself
 * (scripts/capture-golden.mjs) was retired at the astro-plan-web cutover —
 * nothing in the current pipeline regenerates or reads that snapshot).
 */

import { validateTargets } from './targets.mjs';
import { MEAL_SLOTS } from './slots.mjs';
import { validateIngredientMeta } from './units.mjs';

// the part markers lib/nutrition/scale.mjs knows how to scale (it re-exports this list)
export const FLEX_KINDS = Object.freeze(['carb']);

export function buildNutrition(ingredients, plan) {
  const ING = ingredients;
  const {
    data: RAW,
    extras: RAWEX,
    quesoKeys: QUESO,
    vegKeys: VEG,
    dayPlan: DAYPLAN,
    legumeKeys: LEGUMES,
    legumePlate: LEGUME_PLATE,
    targets,
  } = plan;

  const rk = (n) => Math.round(n); // kcal -> integer
  const rm = (n) => Math.round(n * 10) / 10; // macros -> 1 decimal (.0 dropped)
  const MACRO = ['k', 'p', 'c', 'g'];

  function macro(recipe, key) {
    return recipe.reduce((s, r) => {
      const ing = ING[r.ing];
      if (!ing) throw new Error('unknown ingredient: ' + r.ing);
      return s + ing[key] * (r.amt / ing.per);
    }, 0);
  }

  function resolve(o) {
    const out = {};
    const SKIP = { recipe: 1, manual: 1, tier: 1, cap: 1 }; // tier/cap are breakfast-table-only
    for (const k of Object.keys(o)) {
      if (!SKIP[k]) out[k] = o[k];
    }
    if (o.recipe) {
      out.k = rk(macro(o.recipe, 'k'));
      MACRO.slice(1).forEach((f) => { out[f] = rm(macro(o.recipe, f)); });
    } else if (o.manual) {
      MACRO.forEach((f) => { out[f] = o.manual[f]; });
    } else if (o.none) {
      MACRO.forEach((f) => { out[f] = 0; });
    } else {
      throw new Error('item has neither recipe, manual nor none: ' + (o.n || o.l));
    }
    return out;
  }

  // resolved copies used for both the plan-web.html GEN:DATA block and plan-tables.md
  const D = {};
  for (const [cat, v] of Object.entries(RAW)) {
    if (Array.isArray(v)) D[cat] = v.map(resolve);
    else {
      D[cat] = {};
      for (const [sub, arr] of Object.entries(v)) D[cat][sub] = arr.map(resolve);
    }
  }
  const EX = {};
  for (const [k, o] of Object.entries(RAWEX)) EX[k] = resolve(o);

  /* ---------- breakfast recipe-row helpers (feed both plan-web + plan-tables.md) ---------- */
  const nd = (n) => { const r = Math.round(n * 10) / 10; return String(r).replace('.', ','); }; // 1 decimal, comma sep
  const lineMacro = (line, key) => {
    const ing = ING[line.ing];
    if (!ing) throw new Error('unknown ingredient: ' + line.ing);
    return ing[key] * (line.amt / ing.per);
  };
  function brkRows(recipe) {
    const rows = [];
    const byGroup = {};
    for (const line of recipe) {
      const ing = ING[line.ing];
      const m = { k: lineMacro(line, 'k'), p: lineMacro(line, 'p'), c: lineMacro(line, 'c'), g: lineMacro(line, 'g') };
      if (line.group && byGroup[line.group] != null) { // merge into the row that opened this group
        const row = rows[byGroup[line.group]];
        row.amt += line.amt;
        MACRO.forEach((f) => { row[f] += m[f]; });
        continue;
      }
      if (line.group) byGroup[line.group] = rows.length;
      rows.push({
        name: line.glabel || line.label || line.ing, q: line.q || null, link: line.link || null,
        amt: line.amt, unit: ing.unit, k: m.k, p: m.p, c: m.c, g: m.g,
      });
    }
    return rows;
  }
  const brkQty = (row) => (row.q ? row.q : (row.unit === 'ud' ? String(row.amt / 100) : row.amt + ' ' + row.unit));

  /* ---------- dayPlan part/meal macro resolution ---------- */
  function resolvePart(part) {
    if (part.ing) {
      const ing = ING[part.ing];
      if (!ing) throw new Error('dayPlan part: unknown ingredient: ' + part.ing);
      const f = part.amt / ing.per;
      return { k: ing.k * f, p: ing.p * f, c: ing.c * f, g: ing.g * f };
    }
    const r = resolve(findItem(part));
    return { k: r.k, p: r.p, c: r.c, g: r.g };
  }
  /** The raw data item a `{use, tier?, match}` dayPlan part points at (exact name/label first, then
   * the first substring hit); throws when nothing matches. */
  function findItem(part) {
    const bucket = part.tier ? (RAW[part.use] && RAW[part.use][part.tier]) : RAW[part.use];
    if (!Array.isArray(bucket)) throw new Error('dayPlan part: no items at data.' + part.use + (part.tier ? '.' + part.tier : ''));
    const m = part.match;
    const find = (pred) => bucket.find(pred);
    const item =
      find((o) => o.n === m) ||
      find((o) => o.l === m) ||
      find((o) => o.n && o.n.includes(m)) ||
      find((o) => o.l && o.l.includes(m));
    if (!item) throw new Error('dayPlan part: no match for "' + m + '" in data.' + part.use + (part.tier ? '.' + part.tier : ''));
    return item;
  }
  function mealMacros(meal) {
    return meal.parts.reduce((s, part) => {
      const m = resolvePart(part);
      return { k: s.k + m.k, p: s.p + m.p, c: s.c + m.c, g: s.g + m.g };
    }, { k: 0, p: 0, c: 0, g: 0 });
  }
  const dotThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  /* ---------- live-calculator TARGET ----------
     k is DERIVED from the same day total the summary card shows, so the displayed target
     can never drift from the plan it prescribes. p/fatMax are owner-set (plan.targets),
     with safe defaults so a plan without that block still generates. */
  const TARGET_DEFAULTS = { train: { p: 170, fatMax: 75 }, rest: { p: 170, fatMax: 70 } };
  const dayTotalK = (day) => rk(DAYPLAN[day].meals.reduce((s, m) => s + mealMacros(m).k, 0));
  function targetFor(day) {
    const cfg = (targets && targets[day]) || {};
    const def = TARGET_DEFAULTS[day];
    return { k: dayTotalK(day), p: cfg.p != null ? cfg.p : def.p, fatMax: cfg.fatMax != null ? cfg.fatMax : def.fatMax };
  }

  /* ---------- Mi día view-model additions (astro-plan-web slice 3; extraKeys & co. fed the removed day builder) ----------
     Legacy hand-typed two client-side objects (X, XN) OUTSIDE any GEN region to track
     extras-stepper state and their short "copy for Claude" names — they drifted from
     extrasDisplay (a real key, aceitespray, was present in the stepper markup but
     missing from both X and XN, so it silently never counted toward totals or the
     copied log text). extraKeys/extraNames are derived here from ALL extrasDisplay
     groups instead, so every stepper key is always tracked. */
  const extraKeys = [];
  const extraNames = {};
  for (const group of plan.extrasDisplay || []) {
    for (const item of group.items || []) {
      extraKeys.push(item.key);
      extraNames[item.key] = item.copyName || item.name;
    }
  }
  const indulge = plan.indulgeKeys || [];
  const alcoholKeys = plan.alcoholKeys || [];
  const mealReplaceKeys = plan.mealReplaceKeys || [];

  /* ---------- Tablas tab view-model additions (astro-plan-web slice 4) ----------
     `breakfast`: server-rendered equivalent of generate.js's brkTable() string
     builder — same cap/rows shape, computed here instead of written as an HTML
     string, so web/src/tabs/Tablas.astro can render it directly. */
  const breakfast = (RAW.desayuno || []).filter((o) => !o.none).map((item) => {
    const r = resolve(item);
    return {
      cap: `${item.tier} ${item.cap} · ~${r.k} kcal · ${Math.round(r.p)} P · ${Math.round(r.c)} C · ${Math.round(r.g)} G`,
      rows: brkRows(item.recipe).map((row) => ({
        name: row.name,
        link: row.link || null,
        qty: brkQty(row),
        k: rk(row.k),
        p: nd(row.p),
        c: nd(row.c),
        g: nd(row.g),
      })),
    };
  });

  /* `fruitSummary`: REPLACES a hand-typed literal in the legacy page's
     client script ("~60–105 kcal · 1 P · 15–27 C · 0 G") that had drifted
     from the real fruit list (it no longer covered every fruit added since).
     kcal/carb (the two macros that vary meaningfully across fruit) become a
     min–max range over D.postre's `cat==='fruit'` items — already-resolved
     (rounded) values, so no extra rounding here. protein/fat (near-constant
     across fruit) become a single rounded average, same intent as legacy's
     single representative numbers. null when the plan has no fruit items
     (degrades gracefully, e.g. an empty/placeholder plan). */
  const fruitItems = (D.postre || []).filter((o) => o.cat === 'fruit');
  const fruitSummary = fruitItems.length ? {
    kMin: Math.min(...fruitItems.map((o) => o.k)),
    kMax: Math.max(...fruitItems.map((o) => o.k)),
    cMin: Math.min(...fruitItems.map((o) => o.c)),
    cMax: Math.max(...fruitItems.map((o) => o.c)),
    p: Math.round(fruitItems.reduce((s, o) => s + o.p, 0) / fruitItems.length),
    g: Math.round(fruitItems.reduce((s, o) => s + o.g, 0) / fruitItems.length),
  } : null;

  return {
    ING, RAW, RAWEX, QUESO, VEG, DAYPLAN, LEGUMES, LEGUME_PLATE,
    D, EX, MACRO, rk, rm, nd, dotThousands,
    resolve, macro, lineMacro, brkRows, brkQty, resolvePart, findItem, mealMacros,
    dayTotalK, targetFor,
    extraKeys, extraNames, indulge, alcoholKeys, mealReplaceKeys,
    breakfast, fruitSummary,
  };
}

/* ---------- integrity validation ----------
   Extracted verbatim from generate.js's validate(). Runs before every generate, and
   standalone via `node generate.js --check`. Catches the failure modes that would
   silently corrupt the plan numbers. */
// Default day-total kcal sanity band — a gross-bad-edit guard, not a target.
export const DEFAULT_KCAL_BAND = Object.freeze({ train: [2000, 2800], rest: [1700, 2400] });

export function validateNutrition(ingredients, plan) {
  const nut = buildNutrition(ingredients, plan);
  const { ING, RAW, RAWEX, DAYPLAN, EX, QUESO, VEG, LEGUMES, mealMacros } = nut;

  const errors = [];
  const warnings = [];
  const used = new Set();
  // every {ing,...} reference anywhere (recipe lines, dayPlan parts, breakfast lines)
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      if (typeof o.ing === 'string') {
        used.add(o.ing);
        if (!ING[o.ing]) errors.push('references unknown ingredient: ' + o.ing);
      }
      // hand-typed manual blocks are computed by nobody -> sanity-check kcal vs Atwater (4*p+4*c+9*g)
      if (o.manual) {
        const m = o.manual;
        const at = 4 * m.p + 4 * m.c + 9 * m.g;
        if (Math.abs(at - m.k) > Math.max(25, m.k * 0.15)) errors.push(`manual block fails Atwater sanity (k=${m.k} vs ~${Math.round(at)}): ${o.n || o.l || '?'}`);
      }
      for (const k of Object.keys(o)) if (k !== 'ingredients') walk(o[k]);
    }
  };
  walk(RAW); walk(RAWEX); walk(DAYPLAN);
  (LEGUMES || []).forEach((k) => { used.add(k); if (!ING[k]) errors.push('legumeKeys references unknown ingredient: ' + k); });
  // Unused ingredients are a WARNING, not an error: ingredients.json is a shared public
  // food DB that may legitimately hold more foods than a given plan uses.
  for (const k of Object.keys(ING)) if (!used.has(k)) warnings.push('ingredient defined in ingredients.json but not used by this plan: ' + k);
  // key lists must resolve to real resolved-extras entries
  [...(QUESO || []), ...(VEG || [])].forEach((k) => { if (!EX[k]) errors.push('queso/veg key has no extras entry: ' + k); });
  // astro-plan-web slice 3: indulgeKeys/alcoholKeys/mealReplaceKeys/page are optional
  // (older callers — existing generate.js flow, other tests — call validateNutrition
  // without them, and must keep passing), but when present they must be well-formed.
  if (plan.indulgeKeys) {
    for (const k of plan.indulgeKeys) if (!EX[k]) errors.push('indulgeKeys references unknown extras key: ' + k);
  }
  const indulgeSet = new Set(plan.indulgeKeys || []);
  if (plan.alcoholKeys) {
    for (const k of plan.alcoholKeys) if (!indulgeSet.has(k)) errors.push('alcoholKeys must be a subset of indulgeKeys: ' + k);
  }
  if (plan.mealReplaceKeys) {
    for (const k of plan.mealReplaceKeys) if (!indulgeSet.has(k)) errors.push('mealReplaceKeys must be a subset of indulgeKeys: ' + k);
  }
  if (plan.page) {
    const p = plan.page;
    if (typeof p.title !== 'string' || !p.title) errors.push('page.title must be a non-empty string');
    // h1 / sub are optional: without them the page opens straight onto the dials (the layout keeps a
    // visually hidden h1 from the title, so the document still has one)
    if (p.h1 != null && (typeof p.h1 !== 'string' || !p.h1)) errors.push('page.h1 must be a non-empty string when present');
    if (p.sub != null && typeof p.sub !== 'string') errors.push('page.sub must be a string when present');
    if (p.notes != null && typeof p.notes !== 'object') errors.push('page.notes must be an object when present');
  }
  // dayPlan `match` must resolve unambiguously (exact name/label, or exactly one substring hit)
  for (const day of ['train', 'rest']) {
    for (const meal of DAYPLAN[day].meals) {
      for (const part of (meal.parts || [])) {
        if (!part.match) continue;
        const bucket = part.tier ? (RAW[part.use] && RAW[part.use][part.tier]) : RAW[part.use];
        if (!Array.isArray(bucket)) { errors.push(`dayPlan ${day} part: no bucket data.${part.use}${part.tier ? '.' + part.tier : ''}`); continue; }
        if (!bucket.some((o) => o.n === part.match || o.l === part.match)) {
          const hits = bucket.filter((o) => (o.n && o.n.includes(part.match)) || (o.l && o.l.includes(part.match))).length;
          if (hits !== 1) errors.push(`dayPlan ${day} part "${part.match}" resolves ambiguously (${hits} substring hits, no exact) in ${part.use}`);
        }
      }
    }
  }
  // natural units of the food DB (optional piece / weighed metadata, lib/nutrition/units.mjs)
  errors.push(...validateIngredientMeta(ING));
  // nutrition v2: goal x day type targets, carb-flex markers, meal slots (all optional)
  errors.push(...validateTargets(plan));
  for (const day of ['train', 'rest']) {
    DAYPLAN[day].meals.forEach((meal, mi) => {
      if (meal.slot != null && !MEAL_SLOTS.includes(meal.slot)) errors.push(`dayPlan ${day} meal ${mi}: slot must be one of ${MEAL_SLOTS.join(', ')} (got ${JSON.stringify(meal.slot)})`);
      (meal.parts || []).forEach((part, pi) => {
        if (part.flex != null && !FLEX_KINDS.includes(part.flex)) errors.push(`dayPlan ${day} meal ${mi} part ${pi}: flex must be "carb" when present (got ${JSON.stringify(part.flex)})`);
      });
    });
  }
  // day totals within a sane band — catches a gross bad edit, not a tight target
  // (generic default; a plan overrides it via plan.validation.kcalBand = { train: [min, max], rest: [min, max] })
  const band = { ...DEFAULT_KCAL_BAND };
  const override = plan.validation && plan.validation.kcalBand;
  if (override != null) {
    for (const day of ['train', 'rest']) {
      const b = override[day];
      const ok = Array.isArray(b) && b.length === 2 && b.every((v) => typeof v === 'number' && Number.isFinite(v)) && b[0] < b[1];
      if (ok) band[day] = b;
      else { errors.push(`validation.kcalBand.${day} must be [min, max] with numeric min < max (got ${JSON.stringify(b)})`); band[day] = null; }
    }
  }
  for (const day of ['train', 'rest']) {
    if (!band[day]) continue;
    const total = DAYPLAN[day].meals.reduce((s, m) => s + mealMacros(m).k, 0);
    const [lo, hi] = band[day];
    if (total < lo || total > hi) errors.push(`${day}-day total ${Math.round(total)} kcal outside sane band ${lo}-${hi}`);
  }
  if (errors.length) throw new Error('plan-data.json validation failed:\n  - ' + errors.join('\n  - '));
  return { ok: true, warnings };
}
