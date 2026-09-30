#!/usr/bin/env node
/* One-shot, idempotent upgrade of a personal data/nutrition/plan-data.json to nutrition v2
 * (goal × day type targets + carb-flex portion scaling, lib/nutrition/{targets,scale}.mjs):
 *   1. targets.byGoal — added with the approved default numbers when absent (an existing block is
 *      kept as is; the day builder's targets.train / targets.rest are untouched);
 *   2. flex: "carb" — added to every dayPlan part that is pure carbs: an {ing} part whose ingredient
 *      key is in CARB_KEYS, or a {use, match} part whose data item's recipe uses ONLY CARB_KEYS
 *      ingredients. Mixed items (banana + whey), `manual` blocks (legume bowls) and everything else
 *      stay fixed. A part that already has a `flex` key (even `null`, the way to opt out) is left alone;
 *   3. page.goal — "maintain" when absent.
 * Nothing else changes. The file is backed up to `<file>.pre-v2-<YYYY-MM-DD>.bak` (never overwriting
 * an existing backup) BEFORE it is rewritten; when there is nothing to change, nothing is written.
 * Review the result, then run `npm run check` and `npm run generate`.
 *
 * Run:  node scripts/migrate-plan-v2.mjs [--dry-run] [--file <plan-data.json>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BY_GOAL, DEFAULT_GOAL } from '../lib/nutrition/targets.mjs';
import { buildNutrition } from '../lib/nutrition/macros.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* Ingredient keys that count as scalable carbs (es keys of the shared ingredients.json + common en
 * spellings a plan may use). Deliberately NOT here: fried / oily carbs (patatashorno, batataprefrita),
 * legumes (carb + protein), dairy, nuts, sweets and alcohol. Edit the plan by hand for anything else. */
export const CARB_KEYS = Object.freeze([
  // grains, bread, potatoes
  'arroz', 'rice', 'pasta', 'gnocchi', 'pan', 'panecillo', 'pansemillas', 'bread', 'toast',
  'patata', 'potato', 'boniato', 'batata', 'sweetpotato', 'avena', 'oats', 'cuscus', 'couscous', 'quinoa',
  // sweet carbs
  'miel', 'honey', 'confitura', 'mermelada', 'jam',
  // fruit
  'platano', 'banana', 'manzana', 'apple', 'naranja', 'orange', 'zumonaranja', 'pera', 'pear',
  'melocoton', 'nectarina', 'paraguayo', 'pina', 'sandia', 'melon', 'uvas', 'grapes', 'kiwi',
  'fresas', 'arandanos', 'ciruela', 'mango', 'datiles', 'dates', 'pasas', 'raisins',
]);

const clone = (o) => JSON.parse(JSON.stringify(o));
const isCarb = (key) => CARB_KEYS.includes(key);

/** Pure: plan (+ ingredients map) -> { plan: the upgraded copy, changes: human-readable lines }. */
export function migratePlanV2(input, ingredients) {
  const plan = clone(input);
  const changes = [];
  plan.targets = plan.targets && typeof plan.targets === 'object' ? plan.targets : {};
  if (plan.targets.byGoal == null) {
    plan.targets.byGoal = {
      _doc: 'Daily targets per goal (maintain / cut / bulk) and day type (rest; gym = a gym or run session ~1 h; bike = a ride ~2 h; bikeLong = a ride over 2.5 h). kcal, p = protein (g), f = fat (g); carbs are the remainder. Plan de hoy scales the dayPlan parts marked flex:"carb" so the day lands on kcal.',
      ...clone(DEFAULT_BY_GOAL),
    };
    changes.push('targets.byGoal: added the default goal x day type targets');
  }
  plan.page = plan.page && typeof plan.page === 'object' ? plan.page : {};
  if (plan.page.goal == null) {
    plan.page.goal = DEFAULT_GOAL;
    changes.push(`page.goal: set to "${DEFAULT_GOAL}"`);
  }
  const nut = buildNutrition(ingredients, { ...plan, extras: plan.extras || {} });
  for (const day of ['train', 'rest']) {
    const meals = (plan.dayPlan && plan.dayPlan[day] && plan.dayPlan[day].meals) || [];
    for (const meal of meals) {
      for (const part of meal.parts || []) {
        if ('flex' in part) continue;
        let carb = false;
        let what = part.ing;
        if (part.ing) carb = isCarb(part.ing);
        else if (part.use) {
          const item = nut.findItem(part);
          what = item.n || item.l || part.match;
          carb = Array.isArray(item.recipe) && item.recipe.length > 0 && item.recipe.every((l) => isCarb(l.ing));
        }
        if (!carb) continue;
        part.flex = 'carb';
        changes.push(`dayPlan ${day} · ${meal.name} · ${what}: marked flex "carb"`);
      }
    }
  }
  return { plan, changes };
}

export const backupPath = (file, today) => `${file}.pre-v2-${today}.bak`;

/** Reads, migrates and (unless dryRun or nothing changed) backs up + rewrites `file`. */
export function runMigration({
  file = path.join(ROOT, 'data', 'nutrition', 'plan-data.json'),
  ingredientsFile = path.join(ROOT, 'data', 'nutrition', 'ingredients.json'),
  today = new Date().toISOString().slice(0, 10),
  dryRun = false,
  log = console.log,
} = {}) {
  if (!fs.existsSync(file)) throw new Error(`${file} not found — nothing to migrate (a fresh clone starts from plan-data.example.json, already v2).`);
  if (!fs.existsSync(ingredientsFile)) throw new Error(`${ingredientsFile} not found — the plan's food DB is needed to resolve its items.`);
  const raw = fs.readFileSync(file, 'utf8');
  const { ingredients } = JSON.parse(fs.readFileSync(ingredientsFile, 'utf8'));
  const { plan, changes } = migratePlanV2(JSON.parse(raw), ingredients);
  if (!changes.length) {
    log(`${file}: already nutrition v2 — nothing to change.`);
    return { written: false, changes };
  }
  log(`${file}: ${changes.length} change(s)${dryRun ? ' (dry run, nothing written)' : ''}:\n  - ${changes.join('\n  - ')}`);
  if (dryRun) return { written: false, changes };
  let bak = backupPath(file, today);
  for (let n = 1; fs.existsSync(bak); n++) bak = `${backupPath(file, today)}.${n}`;
  fs.writeFileSync(bak, raw);
  log(`Backup: ${bak}`);
  fs.writeFileSync(file, JSON.stringify(plan, null, 2) + '\n');
  log('Done. Review the flex markers, then run: npm run check && npm run generate');
  return { written: true, changes, backup: bak };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--file');
  try {
    runMigration({ dryRun: args.includes('--dry-run'), ...(at >= 0 && args[at + 1] ? { file: path.resolve(args[at + 1]) } : {}) });
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
