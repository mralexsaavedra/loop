#!/usr/bin/env node
/* Generator for the nutrition plan's human-readable reference tables.
 * Two sources, merged in memory:
 *   - ingredients.json (TRACKED, public food DB): `ingredients` =
 *     per-100g/ml/ud base foods (verified = real product label). Reusable.
 *   - plan-data.json (GITIGNORED, personal plan): `data`/`dayPlan`/`extras`/etc.
 *     Each item carries a `recipe` ([{ing, amt}]) OR a `manual` macro block
 *     (ranges/estimates with no single label) OR `none` (the "— ninguno —" row).
 * This script COMPUTES per-serving k/p/c/g from ingredient*amt, validates the
 * plan's integrity, then writes plan-tables.md (DO NOT edit by hand).
 *
 * The single-file page (plan-web.html equivalent) is built separately by the
 * Astro pipeline (`node scripts/build-web.mjs`, wired into `npm run generate`)
 * using the SAME lib/nutrition/macros.mjs — this file no longer emits HTML.
 *
 * Run:  node data/nutrition/generate.js
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ingPath = path.join(DIR, 'ingredients.json');
if (!fs.existsSync(ingPath)) {
  throw new Error('ingredients.json not found at ' + ingPath + ' — it is the public food DB the plan depends on. A fresh clone ships it; do not delete it.');
}
const ingFile = JSON.parse(fs.readFileSync(ingPath, 'utf8'));
if (!ingFile.ingredients || typeof ingFile.ingredients !== 'object') {
  throw new Error('ingredients.json must contain a top-level "ingredients" object.');
}

// The personal plan-data.json is gitignored — a fresh clone with no bootstrap
// step run has only the tracked plan-data.example.json. Rather than crash
// module load (which used to take down every test in generate.test.js, not
// just the personal-data-dependent ones), fall back to the example seed with
// a clear, loud warning. `npm run generate`/`check` on such a clone then
// validates + regenerates plan-tables.md from the PUBLIC example plan
// instead of failing outright — matching build-web.mjs's own DATA_MODE
// fallback story (lib/load/inputs.mjs), just without an explicit flag here
// since this script has always been personal-plan-only by convention.
const PLAN_PATH = fs.existsSync(path.join(DIR, 'plan-data.json'))
  ? path.join(DIR, 'plan-data.json')
  : path.join(DIR, 'plan-data.example.json');
const usedExampleFallback = PLAN_PATH.endsWith('plan-data.example.json');
if (usedExampleFallback) {
  if (!fs.existsSync(PLAN_PATH)) {
    throw new Error(
      'Neither plan-data.json nor plan-data.example.json found in ' + DIR +
      ' — plan-data.example.json ships tracked in every clone; do not delete it.',
    );
  }
  console.warn(
    'generate.js: personal plan-data.json not found — falling back to plan-data.example.json ' +
    '(fresh-clone default). This validates/regenerates the PUBLIC example plan-tables.md, not ' +
    'your personal plan. Copy plan-data.example.json -> plan-data.json to use your own plan.',
  );
}
const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
// The existence checks above MUST run before this require — a test copies only this
// file (no lib/) into a temp dir to assert the "ingredients.json not found" error; if
// this require ran first, a missing-lib require would mask that error.
const { buildNutrition, validateNutrition } = require(path.join(DIR, '..', '..', 'lib', 'nutrition', 'macros.mjs'));

// Pure macro computation now lives in lib/nutrition/macros.mjs (astro-plan-web slice 2) —
// `ingredients` comes only from ingredients.json (plan-data.json no longer carries it).
const nut = buildNutrition(ingFile.ingredients, plan);
const {
  ING, RAW, RAWEX, QUESO, VEG, DAYPLAN, LEGUMES, LEGUME_PLATE,
  D, EX, MACRO, rk, rm,
  resolve, macro, brkRows, brkQty, mealMacros,
  dayTotalK, targetFor,
} = nut;

/* ---------- render plan-tables.md ---------- */
const real = arr => arr.filter(o => !o.none);
function mdTable(items) {
  const head = '| Item | Cant. | kcal | P | C | F |\n|---|---|---|---|---|---|';
  const rows = items.map(o => {
    const name = o.n + (o.note ? ' _(' + o.note + ')_' : '');
    return `| ${name} | ${o.q || ''} | ${o.k} | ${o.p} | ${o.c} | ${o.g} |`;
  });
  return [head, ...rows].join('\n');
}
function extraItems(keys) { return keys.map(k => EX[k]); }

/* breakfast detail as markdown — same recipes/source as the plan-web GEN:BREAKFAST block,
   so plan-tables.md carries the breakfast reference too (food-log no longer hand-maintains it). */
function brkTableMd(item) {
  const r = resolve(item);
  const cap = `${item.tier} ${item.cap} · ~${r.k} kcal · ${Math.round(r.p)} P · ${Math.round(r.c)} C · ${Math.round(r.g)} G`;
  const rows = brkRows(item.recipe).map(row => `| ${row.name} | ${brkQty(row)} | ${rk(row.k)} | ${rm(row.p)} | ${rm(row.c)} | ${rm(row.g)} |`);
  return [`**${cap}**`, '', '| Componente | Cant. | kcal | P | C | G |', '|---|---|---|---|---|---|', ...rows].join('\n');
}

function buildTables() {
const md = [];
md.push('# Plan — reference tables');
md.push('');
md.push('> GENERATED from `plan-data.json` by `generate.js`. **Do not edit this file by hand** —');
md.push('> edit `plan-data.json` and run `node data/nutrition/generate.js`. Macros in grams; this is');
md.push('> the per-serving reference, COMPUTED from the per-100g ingredient layer. Verified per-100g');
md.push('> product labels live in `plan-data.json` (`ingredients`, verified:true).');
md.push('> Not a doctor — see `CLAUDE.md`.');
md.push('');

md.push('## Breakfasts (A/B/C — itemized components)');
md.push('');
md.push('> Generated from the `desayuno` recipes in `plan-data.json` — same source as the plan-web cards.');
md.push('');
RAW.desayuno.filter(o => !o.none).forEach(item => { md.push(brkTableMd(item)); md.push(''); });

md.push('## Protein (~40 g protein/serving, raw weight)');
md.push('');
[['lean', '🟢 Lean — daily base'], ['mod', '🟡 Moderate — with awareness'], ['fat', '🔴 Fatty — occasional']].forEach(([t, title]) => {
  md.push('### ' + title);
  md.push('');
  md.push(mdTable(D.proteina.filter(o => o.t === t)));
  md.push('');
});

md.push('## Carbs — lunch (matched by calories)');
md.push('');
md.push('**🏋️ Training day**');
md.push('');
md.push(mdTable(real(D.carboComida.train)));
md.push('');
md.push('**😴 Rest day**');
md.push('');
md.push(mdTable(real(D.carboComida.rest)));
md.push('');

md.push('## Carbs — dinner (raised portion, cooked/ready weight)');
md.push('');
md.push('**🏋️ Training day**');
md.push('');
md.push(mdTable(real(D.carboCena.train)));
md.push('');
md.push('**😴 Rest day**');
md.push('');
md.push(mdTable(real(D.carboCena.rest)));
md.push('');

/* Legumes detail — per ~300 g cooked plate, COMPUTED from the legume ingredients.
   This used to be a hand-typed table in food-log.md duplicating the ingredient macros;
   it now renders from the single source (and is why those ingredients aren't orphans). */
md.push(`## Legumes — per ~${LEGUME_PLATE} g plate (carb + protein hybrid)`);
md.push('');
md.push('> The plan\'s "Legumbre (plato hondo)" row is a deliberate composite (any legume, ~345–420 kcal');
md.push('> by plate fullness). Per-type detail below is computed from the `ingredients` layer.');
md.push('');
const legumeRows = LEGUMES.map(k => {
  const ing = ING[k]; const f = LEGUME_PLATE / ing.per;
  return `| ${ing.name || k} | ~${LEGUME_PLATE} g | ${rk(ing.k * f)} | ${rm(ing.p * f)} | ${rm(ing.c * f)} | ${rm(ing.g * f)} |`;
});
md.push(['| Source | Amount | kcal | P | C | F |\n|---|---|---|---|---|---|', ...legumeRows].join('\n'));
md.push('');

md.push('## Post-workout (~25–30 g protein)');
md.push('');
md.push(mdTable(real(D.postentreno)));
md.push('');

md.push('## Protein anchor — rest-day slot (~25 g protein)');
md.push('');
md.push(mdTable(real(D.anclaje)));
md.push('');

md.push('## Fruit (per piece/serving)');
md.push('');
md.push(mdTable(D.postre.filter(o => o.cat === 'fruit')));
md.push('');

md.push('## Dessert (also any fruit above)');
md.push('');
md.push(mdTable(D.postre.filter(o => o.cat === 'yogurt')));
md.push('');

md.push('## Vegetables (per 100 g — ~free in the cut)');
md.push('');
md.push(mdTable(extraItems(VEG)));
md.push('');

md.push('## Cheeses & sauces (count them — not free)');
md.push('');
md.push(mdTable(extraItems(QUESO)));
md.push('');

/* Verified product labels (per-100g/ml/ud) — the single source for packaged-food
   macros. Rendered from `ingredients` where verified:true, so food-log.md no
   longer hand-maintains a second copy. */
md.push('## Verified product labels (real, per 100 g/ml/ud)');
md.push('');
md.push('> From the user\'s actual product photos — these OVERRIDE generic/database estimates.');
md.push('> SINGLE SOURCE: the `ingredients` (verified:true) in `plan-data.json`. Do not re-type these anywhere else.');
md.push('');
const labelHead = '| Product | Per | kcal | P | C | F | Note |\n|---|---|---|---|---|---|---|';
const labelRows = Object.values(ING)
  .filter(i => i.verified && i.name)
  .map(i => `| ${i.name} | 100 ${i.unit} | ${i.k} | ${i.p} | ${i.c} | ${i.g} | ${i.note || ''} |`);
md.push([labelHead, ...labelRows].join('\n'));
md.push('');

return md.join('\n');
}

/* ---------- integrity validation ----------
   Runs before every generate, and standalone via `node generate.js --check`.
   Catches the failure modes that would silently corrupt the plan numbers.
   Logic now lives in lib/nutrition/macros.mjs (validateNutrition), rebuilding
   its own `nut` from (ingredients, plan) so it stays a 0-arg call here. */
function validate() {
  return validateNutrition(ingFile.ingredients, plan);
}

function reportWarnings(warnings) {
  if (warnings && warnings.length) {
    console.warn('Validation warnings (' + warnings.length + '):\n  - ' + warnings.join('\n  - '));
  }
}

function main() {
  reportWarnings(validate().warnings);
  fs.writeFileSync(path.join(DIR, 'plan-tables.md'), buildTables());
  console.log('Generated: plan-tables.md');
}

if (require.main === module) {
  if (process.argv.includes('--check')) { reportWarnings(validate().warnings); console.log('Validation OK: ingredients, recipes, day totals consistent.'); }
  else main();
}

module.exports = { ING, D, EX, MACRO, resolve, macro, mealMacros, buildTables, validate, RAW, RAWEX, DAYPLAN, LEGUMES, LEGUME_PLATE, dayTotalK, targetFor, PLAN_PATH, usedExampleFallback };
