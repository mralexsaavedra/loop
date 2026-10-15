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
 * The single-file page is built separately by the
 * Astro pipeline (`node scripts/build-web.mjs`, wired into `npm run generate`)
 * using the SAME lib/nutrition/macros.mjs — this file emits no HTML.
 *
 * Run:  node data/nutrition/generate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../../scripts/lib/is-main.mjs';
import { buildNutrition, validateNutrition } from '../../lib/nutrition/macros.mjs';
import { buildDayPlans, fmtFactor } from '../../lib/nutrition/scale.mjs';
import { buildReference } from '../../lib/nutrition/reference.mjs';
import { ingName } from '../../lib/nutrition/names.mjs';
import { writeAtomic, runCli } from '../apple-health/sync-common.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));

const readJson = (file, name) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`${name} is not valid JSON (${err.message})`, { cause: err });
    throw err;
  }
};

/** Reads ingredients.json + the plan from `dir` and builds the nutrition model; throws one-line errors on a
 * missing or malformed file. The personal plan-data.json is gitignored, so a fresh clone falls back to the
 * tracked plan-data.example.json, with a warning (it validates / regenerates the PUBLIC example plan). */
export function load({ dir = DIR, env = process.env, warn = console.warn } = {}) {
  const ingPath = path.join(dir, 'ingredients.json');
  if (!fs.existsSync(ingPath)) {
    throw new Error('ingredients.json not found at ' + ingPath + ' — it is the public food DB the plan depends on. A fresh clone ships it; do not delete it.');
  }
  const ingFile = readJson(ingPath, 'ingredients.json');
  if (!ingFile || !ingFile.ingredients || typeof ingFile.ingredients !== 'object') {
    throw new Error('ingredients.json must contain a top-level "ingredients" object.');
  }
  const personal = path.join(dir, 'plan-data.json');
  const PLAN_PATH = fs.existsSync(personal) ? personal : path.join(dir, 'plan-data.example.json');
  if (PLAN_PATH !== personal) {
    if (!fs.existsSync(PLAN_PATH)) {
      throw new Error('Neither plan-data.json nor plan-data.example.json found in ' + dir + ' — plan-data.example.json ships tracked in every clone; do not delete it.');
    }
    warn(
      'generate.mjs: personal plan-data.json not found — falling back to plan-data.example.json ' +
      '(fresh-clone default). This validates/regenerates the PUBLIC example plan-tables.md, not ' +
      'your personal plan. Copy plan-data.example.json -> plan-data.json to use your own plan.',
    );
  }
  const plan = readJson(PLAN_PATH, path.basename(PLAN_PATH));
  // Food names (the plan's own option names and the ingredients' {es, en} names) follow the build locale
  // like the page (LOCALE env -> plan.locale -> en); the document's headings and words stay English.
  const LOCALE = ['es', 'en'].includes(env.LOCALE) ? env.LOCALE : (plan && plan.locale === 'es' ? 'es' : 'en');
  // Pure macro computation lives in lib/nutrition/macros.mjs; `ingredients` comes only from ingredients.json.
  return { ...buildNutrition(ingFile.ingredients, plan), ingredients: ingFile.ingredients, plan, PLAN_PATH, LOCALE };
}

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

/** The plan-tables.md text for a load() result. */
function buildTables(ctx) {
const { ING, plan, LOCALE } = ctx;
const nut = ctx;
const md = [];
md.push('# Plan — reference tables');
md.push('');
md.push('> GENERATED from `plan-data.json` by `generate.mjs`. **Do not edit this file by hand** —');
md.push('> edit `plan-data.json` / `ingredients.json` and run `node data/nutrition/generate.mjs`. Macros in');
md.push('> grams, COMPUTED from the per-100 g ingredient layer (`ingredients.json`, verified:true = a real');
md.push('> product label). Food tables are fixed reference values per natural unit, never portions.');
md.push('> Not a doctor — see `CLAUDE.md`.');
md.push('');

/* Daily targets per goal x day type and how the scaled plan meets them (lib/nutrition/scale.mjs,
   the same numbers the page bakes). Meals = the carb-flex-scaled base day; on bike days the ride
   fuel counts inside the target; remainder = target - ride fuel - meals (Plan de hoy's portion guide
   hands it to Extras, lib/nutrition/guide.mjs). */
md.push('## Daily targets by goal and day type');
md.push('');
md.push('> From `targets.byGoal` (defaults when absent); carbs = remainder. Plan de hoy scales the carb-flex parts');
md.push('> (`flex: "carb"` marks plus every carb / fruit food; `flex: null` opts out) by one common factor (clamped),');
md.push('> holding a portion at its cap (`maxAmt` in ingredients.json) and spreading the rest over the others; the');
md.push('> remainder is what is left ("capped" = some portions at their cap, "all capped" = none can grow). Plan de');
md.push('> hoy shows the breakfast / lunch / dinner totals as portion budgets; the rest of the meals target (add-ons');
md.push('> and this remainder) is the Extras budget.');
md.push('');
{
  const days = buildDayPlans(nut, plan, { lang: LOCALE });
  const head = '| Goal | Day type | kcal | P | F | C | Meals kcal | Ride fuel | Carb factor | Remainder |\n|---|---|---|---|---|---|---|---|---|---|';
  const rows = [];
  for (const g of days.goals) for (const d of days.dayTypes) {
    const x = days.plans[g][d];
    rows.push(`| ${g} | ${d} | ${x.t.kcal} | ${x.t.p} | ${x.t.f} | ${x.t.c} | ${x.tot.k} | ${x.fuelK || '—'} | ×${fmtFactor(x.factor)}${x.clamp ? ' (' + x.clamp + ')' : ''}${x.allCapped ? ' (all capped)' : x.capped ? ' (capped)' : ''} | ${x.rem} |`);
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
md.push('> SINGLE SOURCE: the `verified: true` entries of `ingredients.json`. Do not re-type these anywhere else.');
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
   Runs before every generate, and standalone via `node data/nutrition/generate.mjs --check`.
   Catches the failure modes that would silently corrupt the plan numbers (validateNutrition in
   lib/nutrition/macros.mjs). */
function validate(ctx) {
  return validateNutrition(ctx.ingredients, ctx.plan);
}

function reportWarnings(warnings) {
  if (warnings && warnings.length) {
    console.warn('Validation warnings (' + warnings.length + '):\n  - ' + warnings.join('\n  - '));
  }
}

const USAGE = `Usage: node data/nutrition/generate.mjs [--check]

Validates the nutrition plan (ingredients.json + plan-data.json, else plan-data.example.json) and writes
data/nutrition/plan-tables.md.
  --check      validate only, write nothing
  -h, --help   this help
Env: LOCALE (es|en) for the food names (default: the plan's locale, else en).`;

/** The CLI entry (runCli parses the flags first: an unknown one exits 2 before any read or write). */
function main({ check = false } = {}) {
  const ctx = load();
  reportWarnings(validate(ctx).warnings);
  if (check) {
    console.log('Validation OK: ingredients, recipes, day totals consistent.');
    return 0;
  }
  writeAtomic(path.join(DIR, 'plan-tables.md'), buildTables(ctx));
  console.log('Generated: plan-tables.md');
  return 0;
}

if (isMain(import.meta.url)) runCli(main, { usage: USAGE, options: { check: { type: 'boolean' } } });

export { buildTables, validate };
