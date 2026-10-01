#!/usr/bin/env node
/* Idempotent upgrade of a personal data/nutrition/plan-data.json to nutrition v2 (goal × day type
 * targets + carb-flex portion scaling, lib/nutrition/{targets,scale}.mjs):
 *   1. targets.byGoal — added with the approved default numbers when absent (an existing block is
 *      kept as is; the day builder's targets.train / targets.rest are untouched);
 *   2. flex: "carb" — added to every dayPlan part that is a carb STAPLE: an {ing} part whose ingredient
 *      key is in STAPLE_KEYS (rice, pasta, bread, potato, oats, couscous / quinoa, wheat wraps), or a
 *      {use, match} part whose data item's recipe uses ONLY those. Fruit, honey, jam and juice are NOT
 *      marked unless `--include-fruit` (FRUIT_KEYS); mixed items (banana + whey), `manual` blocks
 *      (legume bowls) and everything else stay fixed. A part that already has a `flex` key (even
 *      `null`, the way to opt out) is left alone;
 *   3. page.goal — "maintain" when absent.
 * Step 2 is mostly legacy now: the page decides flex by food category (lib/nutrition/flex.mjs: carb,
 * fruit and carb-staple sweets auto-flex), which already covers these key lists except orange juice.
 * `--reset-flex` re-derives the markers of an already-migrated plan: a part whose flex is exactly
 * "carb" but that is not in the current set (staples, + fruit with --include-fruit) loses its marker;
 * unmarked staples get one; `flex: null` opt-outs are never touched.
 * A non-object `targets` / `page` is an error (never replaced). Nothing else changes. The file is
 * backed up to `<file>.pre-v2-<local YYYY-MM-DD>.bak` (never overwriting a backup) BEFORE it is
 * rewritten atomically (temp file + rename, 2-space JSON); when nothing changes, nothing is written.
 * Every run prints the resulting carb factor and remainder per (goal, day type), so a dry run shows
 * what the page would do. Then run `npm run check` and `npm run generate`.
 *
 * Run:  node scripts/migrate-plan-v2.mjs [--dry-run] [--reset-flex] [--include-fruit] [--file <plan-data.json>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BY_GOAL, DEFAULT_GOAL } from '../lib/nutrition/targets.mjs';
import { buildNutrition } from '../lib/nutrition/macros.mjs';
import { buildDayPlans, fmtFactor } from '../lib/nutrition/scale.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* Carb staples scaled by default (es keys of the shared ingredients.json + common en spellings).
 * Deliberately NOT here: fried / oily carbs (patatashorno, batataprefrita), legumes (carb + protein),
 * dairy, nuts, sweets, alcohol — and "tortilla", which in a Spanish plan is an omelette. */
export const STAPLE_KEYS = Object.freeze([
  'arroz', 'rice', 'pasta', 'gnocchi',
  'pan', 'panecillo', 'pansemillas', 'bread', 'toast',
  'patata', 'potato', 'boniato', 'batata', 'sweetpotato',
  'avena', 'oats', 'cuscus', 'couscous', 'quinoa',
  'wrap', 'wraps', 'tortillatrigo', 'tortillawrap',
]);
/* Opt-in with --include-fruit: fruit, honey / jam and juice. */
export const FRUIT_KEYS = Object.freeze([
  'miel', 'honey', 'confitura', 'mermelada', 'jam', 'zumonaranja', 'zumo', 'juice',
  'platano', 'banana', 'manzana', 'apple', 'naranja', 'orange', 'pera', 'pear',
  'melocoton', 'nectarina', 'paraguayo', 'pina', 'sandia', 'melon', 'uvas', 'grapes', 'kiwi',
  'fresas', 'arandanos', 'ciruela', 'mango', 'datiles', 'dates', 'pasas', 'raisins',
]);

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** An existing block must be an object; absent / null is created. Anything else is the owner's data
 * in an unexpected shape: stop rather than overwrite it. */
function objectBlock(plan, key) {
  const v = plan[key];
  if (v == null) return (plan[key] = {});
  if (!isObj(v)) throw new Error(`plan-data.json: "${key}" must be an object (found ${Array.isArray(v) ? 'an array' : typeof v}) — fix it by hand, nothing was changed.`);
  return v;
}

/** Pure: plan (+ ingredients map) -> { plan: the upgraded copy, changes: human-readable lines }. */
export function migratePlanV2(input, ingredients, { includeFruit = false, resetFlex = false } = {}) {
  const plan = clone(input);
  const changes = [];
  const targets = objectBlock(plan, 'targets');
  const page = objectBlock(plan, 'page');
  if (targets.byGoal == null) {
    targets.byGoal = {
      _doc: 'Daily targets per goal (maintain / cut / bulk) and day type (rest; gym = a gym or run session ~1 h; bike = a ride ~2 h; bikeLong = a ride over 2.5 h). kcal, p = protein (g), f = fat (g); carbs are the remainder. Plan de hoy scales the dayPlan parts marked flex:"carb" so the day lands on kcal.',
      ...clone(DEFAULT_BY_GOAL),
    };
    changes.push('targets.byGoal: added the default goal x day type targets');
  }
  if (page.goal == null) {
    page.goal = DEFAULT_GOAL;
    changes.push(`page.goal: set to "${DEFAULT_GOAL}"`);
  }
  const keys = new Set([...STAPLE_KEYS, ...(includeFruit ? FRUIT_KEYS : [])]);
  const inSet = (k) => keys.has(k);
  const nut = buildNutrition(ingredients, { ...plan, extras: plan.extras || {} });
  for (const day of ['train', 'rest']) {
    const meals = (plan.dayPlan && plan.dayPlan[day] && plan.dayPlan[day].meals) || [];
    for (const meal of meals) {
      for (const part of meal.parts || []) {
        let carb = false;
        let what = part.ing;
        if (part.ing) carb = inSet(part.ing);
        else if (part.use) {
          const item = nut.findItem(part);
          what = item.n || item.l || part.match;
          carb = Array.isArray(item.recipe) && item.recipe.length > 0 && item.recipe.every((l) => inSet(l.ing));
        }
        if ('flex' in part) {
          // only a reset touches an existing marker, and only a "carb" one this set no longer covers
          if (resetFlex && part.flex === 'carb' && !carb) {
            delete part.flex;
            changes.push(`dayPlan ${day} · ${meal.name} · ${what}: removed flex "carb"`);
          }
          continue;
        }
        if (!carb) continue;
        part.flex = 'carb';
        changes.push(`dayPlan ${day} · ${meal.name} · ${what}: marked flex "carb"`);
      }
    }
  }
  return { plan, changes };
}

/** The carb factor and remainder the page would show per (goal, day type), for the dry-run report. */
export function scaleReport(plan, ingredients) {
  const days = buildDayPlans(buildNutrition(ingredients, { ...plan, extras: plan.extras || {} }), plan);
  const lines = [];
  for (const g of days.goals) for (const d of days.dayTypes) {
    const x = days.plans[g][d];
    const rem = (x.rem > 0 ? '+' : '') + x.rem;
    lines.push(`${g.padEnd(8)} ${d.padEnd(8)} ×${fmtFactor(x.factor)}${x.clamp ? ` (${x.clamp})` : ''}  remainder ${rem} kcal`);
  }
  return lines;
}

/** The LOCAL calendar date (YYYY-MM-DD) — the backup is named after the owner's day, not UTC's. */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const backupPath = (file, today) => `${file}.pre-v2-${today}.bak`;

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Reads, migrates and (unless dryRun or nothing changed) backs up + rewrites `file`. */
export function runMigration({
  file = path.join(ROOT, 'data', 'nutrition', 'plan-data.json'),
  ingredientsFile = path.join(ROOT, 'data', 'nutrition', 'ingredients.json'),
  today = localDate(),
  dryRun = false,
  resetFlex = false,
  includeFruit = false,
  log = console.log,
} = {}) {
  if (!fs.existsSync(file)) throw new Error(`${file} not found — nothing to migrate (a fresh clone starts from plan-data.example.json, already v2).`);
  if (!fs.existsSync(ingredientsFile)) throw new Error(`${ingredientsFile} not found — the plan's food DB is needed to resolve its items.`);
  const raw = fs.readFileSync(file, 'utf8');
  const { ingredients } = JSON.parse(fs.readFileSync(ingredientsFile, 'utf8'));
  const { plan, changes } = migratePlanV2(JSON.parse(raw), ingredients, { resetFlex, includeFruit });
  const report = () => {
    try {
      log(`Carb factor and remainder per goal x day type${changes.length ? ' after this migration' : ''} (default ride minutes):\n  ${scaleReport(plan, ingredients).join('\n  ')}`);
    } catch (err) {
      log(`(could not compute the scaling report: ${err.message})`);
    }
  };
  if (!changes.length) {
    log(`${file}: already nutrition v2 — nothing to change.`);
    report();
    return { written: false, changes };
  }
  log(`${file}: ${changes.length} change(s)${dryRun ? ' (dry run, nothing written)' : ''}:\n  - ${changes.join('\n  - ')}`);
  report();
  if (dryRun) return { written: false, changes };
  let bak = backupPath(file, today);
  for (let n = 1; fs.existsSync(bak); n++) bak = `${backupPath(file, today)}.${n}`;
  fs.writeFileSync(bak, raw, { flag: 'wx' });
  log(`Backup: ${bak}`);
  writeAtomic(file, JSON.stringify(plan, null, 2) + '\n');
  log('Done. Review the flex markers, then run: npm run check && npm run generate');
  return { written: true, changes, backup: bak };
}

/** CLI flags -> options; an unknown flag is an error (a typo must not run a real migration). */
export function parseArgs(args) {
  const out = { dryRun: false, resetFlex: false, includeFruit: false, file: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--reset-flex') out.resetFlex = true;
    else if (a === '--include-fruit') out.includeFruit = true;
    else if (a === '--file' && args[i + 1]) out.file = args[++i];
    else throw new Error(`unknown option: ${a} (use --dry-run, --reset-flex, --include-fruit, --file <path>)`);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { file, ...opts } = parseArgs(process.argv.slice(2));
    runMigration({ ...opts, ...(file ? { file: path.resolve(file) } : {}) });
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
