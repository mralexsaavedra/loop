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
const { buildDayPlans, fmtFactor } = require(path.join(DIR, '..', '..', 'lib', 'nutrition', 'scale.mjs'));
const { buildReference } = require(path.join(DIR, '..', '..', 'lib', 'nutrition', 'reference.mjs'));
const { ingName } = require(path.join(DIR, '..', '..', 'lib', 'nutrition', 'names.mjs'));

// Food names (the plan's own option names and the ingredients' {es, en} names) follow the build locale
// like the page (LOCALE env -> plan.locale -> en); the document's headings and words stay English.
const LOCALE = ['es', 'en'].includes(process.env.LOCALE) ? process.env.LOCALE : (plan.locale === 'es' ? 'es' : 'en');

// Pure macro computation now lives in lib/nutrition/macros.mjs (astro-plan-web slice 2) —
// `ingredients` comes only from ingredients.json (plan-data.json no longer carries it).
const nut = buildNutrition(ingFile.ingredients, plan);
const {
  ING, RAW, RAWEX, QUESO, VEG, DAYPLAN, LEGUMES, LEGUME_PLATE,
  D, EX, MACRO,
  resolve, macro, mealMacros,
  dayTotalK, targetFor,
} = nut;

/* ---------- render plan-tables.md ---------- */
/* Food tables = FIXED reference values per natural unit (lib/nutrition/reference.mjs, the same rows the
   page's Tablas renders): a piece with its grams reference, oil per tablespoon, else per 100 g / ml with
   how the plan weighs it. No portions: today's amounts come from the scaled plan (Plan de hoy). */
const REF_WORDS = { raw: 'raw', dry: 'dry', cooked: 'cooked', serving: 'serving', unit: 'pc' };
function mdRefTable(rows) {
  const head = '| Food | Reference | kcal | P | C | F |\n|---|---|---|---|---|---|';
  const body = rows.map((r) => {
    if (r.kind === 'group') return `| **${r.name}** | | | | | |`;
    const unit = r.unit + (r.typical ? ' _(typical weight)_' : '');
    return `| ${r.sub ? '↳ ' : ''}${r.name} | ${unit} | ${r.k} | ${r.p} | ${r.c} | ${r.g} |`;
  });
  return [head, ...body].join('\n');
}

function buildTables() {
const md = [];
md.push('# Plan — reference tables');
md.push('');
md.push('> GENERATED from `plan-data.json` by `generate.js`. **Do not edit this file by hand** —');
md.push('> edit `plan-data.json` / `ingredients.json` and run `node data/nutrition/generate.js`. Macros in');
md.push('> grams, COMPUTED from the per-100 g ingredient layer (`ingredients.json`, verified:true = a real');
md.push('> product label). Food tables are fixed reference values per natural unit, never portions.');
md.push('> Not a doctor — see `CLAUDE.md`.');
md.push('');

/* Daily targets per goal x day type and how the scaled plan meets them (lib/nutrition/scale.mjs,
   the same numbers the page bakes). Meals = the carb-flex-scaled base day; on bike days the ride
   fuel counts inside the target; remainder = target - ride fuel - meals. */
md.push('## Daily targets by goal and day type');
md.push('');
md.push('> From `targets.byGoal` (defaults when absent); carbs = remainder. Plan de hoy scales the parts marked');
md.push('> `flex: "carb"` by one factor (clamped) so the day lands on the target; the remainder is what is left.');
md.push('');
{
  const days = buildDayPlans(nut, plan);
  const head = '| Goal | Day type | kcal | P | F | C | Meals kcal | Ride fuel | Carb factor | Remainder |\n|---|---|---|---|---|---|---|---|---|---|';
  const rows = [];
  for (const g of days.goals) for (const d of days.dayTypes) {
    const x = days.plans[g][d];
    rows.push(`| ${g} | ${d} | ${x.t.kcal} | ${x.t.p} | ${x.t.f} | ${x.t.c} | ${x.tot.k} | ${x.fuelK || '—'} | ×${fmtFactor(x.factor)}${x.clamp ? ' (' + x.clamp + ')' : ''} | ${x.rem} |`);
  }
  md.push([head, ...rows].join('\n'));
  md.push('');
}

const ref = buildReference(nut, { lang: LOCALE, words: REF_WORDS });
const section = (title, rows, note) => {
  md.push(title);
  md.push('');
  if (note) { md.push(note); md.push(''); }
  md.push(rows.length ? mdRefTable(rows) : '_(none in this plan)_');
  md.push('');
};
md.push('## Food reference (fixed values per natural unit)');
md.push('');
md.push('> Per piece (with its grams reference; fruit = a typical medium weight, not a label), per tablespoon');
md.push('> of oil, else per 100 g / ml as the plan weighs it (raw / dry / cooked). These never change with the');
md.push('> goal or the day type; the day\'s amounts are the scaled plan above (Plan de hoy on the page).');
md.push('');
section('### Breakfasts (components)', ref.desayunos);
[['lean', '🟢 Lean — daily base'], ['mod', '🟡 Moderate — with awareness'], ['fat', '🔴 Fatty — occasional']].forEach(([t, title]) => section('### Protein — ' + title, ref.proteina[t]));
section('### Carbs — lunch', ref.carboComida);
section('### Carbs — dinner', ref.carboCena);
section('### Legumes', ref.legumes, '> The plan\'s legume bowl is a deliberate composite (any legume); per-type values below.');
section('### Post-workout', ref.postentreno);
section('### Protein anchor', ref.anclaje);
section('### Fruit', ref.fruta);
section('### Dessert', ref.postre);
section('### Vegetables', ref.verduras);
section('### Cheeses & sauces (count them — not free)', ref.quesos);

/* Verified product labels (per-100g/ml/ud) — the single source for packaged-food
   macros. Rendered from `ingredients` where verified:true, so food-log.md no
   longer hand-maintains a second copy. */
md.push('## Verified product labels (real, per 100 g/ml/ud)');
md.push('');
md.push('> From the user\'s actual product photos — these OVERRIDE generic/database estimates.');
md.push('> SINGLE SOURCE: the `ingredients` (verified:true) in `plan-data.json`. Do not re-type these anywhere else.');
md.push('');
const labelHead = '| Product | Per | kcal | P | C | F | Note |\n|---|---|---|---|---|---|---|';
const labelRows = Object.entries(ING)
  .filter(([, i]) => i.verified)
  .map(([key, i]) => `| ${ingName(ING, key, LOCALE)} | 100 ${i.unit} | ${i.k} | ${i.p} | ${i.c} | ${i.g} | ${i.note || ''} |`);
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

module.exports = { ING, D, EX, MACRO, resolve, macro, mealMacros, buildTables, validate, RAW, RAWEX, DAYPLAN, LEGUMES, LEGUME_PLATE, dayTotalK, targetFor, PLAN_PATH, usedExampleFallback, LOCALE };
