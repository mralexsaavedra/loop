/* Pure nutrition macro computation — extracted verbatim from the compute
 * section of data/nutrition/generate.js (astro-plan-web migration, slice 2).
 * No I/O: given the same (ingredients, plan) input, always produces the same
 * output. data/nutrition/generate.js requires this module and destructures
 * its result instead of computing inline, so legacy output stays byte-for-
 * byte identical (see web/test/.golden/personal/, captured by
 * scripts/capture-golden.mjs before this refactor).
 */

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
    const r = resolve(item);
    return { k: r.k, p: r.p, c: r.c, g: r.g };
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

  return {
    ING, RAW, RAWEX, QUESO, VEG, DAYPLAN, LEGUMES, LEGUME_PLATE,
    D, EX, MACRO, rk, rm, nd, dotThousands,
    resolve, macro, lineMacro, brkRows, brkQty, resolvePart, mealMacros,
    dayTotalK, targetFor,
  };
}

/* ---------- integrity validation ----------
   Extracted verbatim from generate.js's validate(). Runs before every generate, and
   standalone via `node generate.js --check`. Catches the failure modes that would
   silently corrupt the plan numbers. */
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
  // day totals within a sane band — catches a gross bad edit, not a tight target
  const band = { train: [2000, 2800], rest: [1700, 2400] };
  for (const day of ['train', 'rest']) {
    const total = DAYPLAN[day].meals.reduce((s, m) => s + mealMacros(m).k, 0);
    const [lo, hi] = band[day];
    if (total < lo || total > hi) errors.push(`${day}-day total ${Math.round(total)} kcal outside sane band ${lo}-${hi}`);
  }
  if (errors.length) throw new Error('plan-data.json validation failed:\n  - ' + errors.join('\n  - '));
  return { ok: true, warnings };
}
