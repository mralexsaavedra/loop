/* Test harness helper for the classic client scripts: every script reads the shared helpers from
 * the global HC (web/src/client/util.js), which layouts/Plan.astro inlines FIRST, right after the
 * baked HC_CONST and I18N_DATE. loadUtil(ctx) reproduces that order inside a vm context. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { hcConst } from '../../lib/stale.mjs';
import { clientSource } from '../../lib/format/numbers.mjs';
import { clientSource as bandSource } from '../../lib/score/recovery.mjs';
import { clientSource as adhSource } from '../../lib/nutrition/adherence.mjs';
import { clientSource as progSource } from '../../lib/nutrition/progress.mjs';
import { es as esDate, en as enDate } from '../src/i18n/date-templates.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const HC_CONST_BAKE = hcConst();
/** The one number formatter's classic-script twin (lib/format/numbers.mjs) + the recovery bands'
 * (lib/score/recovery.mjs HC_BAND) + the food log adherence (lib/nutrition/adherence.mjs HC_ADH) +
 * the weight progress (lib/nutrition/progress.mjs HC_PROG),
 * inlined together before util.js like layouts/Plan.astro does. */
export const FMT_SOURCE = clientSource() + '\n' + bandSource() + '\n' + adhSource() + '\n' + progSource();
/** util.js as the page runs it: after HC_FMT + HC_BAND + HC_ADH + HC_PROG (so running UTIL_SOURCE alone in a vm gives a working HC). */
export const UTIL_SOURCE = FMT_SOURCE + '\n' + fs.readFileSync(path.join(here, '..', 'src', 'client', 'util.js'), 'utf8');

/** Bakes HC_CONST and I18N_DATE (by ctx.LOCALE, like the page; unless the test set its own) and runs
 * util.js in `ctx` (already a vm context). */
export function loadUtil(ctx) {
  if (!('HC_CONST' in ctx)) ctx.HC_CONST = HC_CONST_BAKE;
  if (!('I18N_DATE' in ctx)) ctx.I18N_DATE = ctx.LOCALE === 'es' ? esDate : enDate;
  vm.runInContext(UTIL_SOURCE, ctx);
  return ctx;
}

/** The food log's four classic scripts in their page order (layouts/Plan.astro): food-core.js (the
 * formula port, the API client, shared state → window.HCFoodInternal), then the add sheet, Mis productos
 * / Mis recetas, and food-log.js (Registrar, events, boot, window.HCFood). FOOD_SOURCE = the four
 * joined: each is its own IIFE, so running the joined text equals running them one after another. */
export const FOOD_SCRIPTS = ['food-core.js', 'food-sheet.js', 'food-catalog.js', 'food-log.js'];
export const FOOD_SOURCES = FOOD_SCRIPTS.map((f) => fs.readFileSync(path.join(here, '..', 'src', 'client', f), 'utf8'));
export const FOOD_SOURCE = FOOD_SOURCES.join('\n');
