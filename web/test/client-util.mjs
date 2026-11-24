/* Test harness helper for the client scripts: every script reads the shared helpers from the global HC
 * (web/src/client/util.ts), which layouts/Plan.astro inlines right after the baked HC_CONST and I18N_DATE and
 * the lib globals (web/src/client/lib-globals.ts). loadUtil(ctx) reproduces that order inside a vm context. */
import vm from 'node:vm';
import { hcConst } from '../../lib/stale.mjs';
import { es as esDate, en as enDate } from '../src/i18n/date-templates.mjs';
import { clientScriptSource } from '../src/client-bundle.mjs';

export const HC_CONST_BAKE = hcConst();
/** util.ts as the page runs it: after lib-globals.ts (HC_FMT, HC_BAND, HC_ADH, HC_PROG, HC_NSCORE, HC_FOODLOG,
 * HC_DAYTYPE, HC_FUEL, HC_SCALE, HC_GUIDE, HC_ENERGY), both as their bundles, so running UTIL_SOURCE alone in a
 * vm gives a working HC. */
export const UTIL_SOURCE = clientScriptSource('lib-globals.ts') + '\n' + clientScriptSource('util.ts');

/** Bakes HC_CONST and I18N_DATE (by ctx.LOCALE, like the page; unless the test set its own) and runs
 * util.ts in `ctx` (already a vm context). */
export function loadUtil(ctx) {
  if (!('HC_CONST' in ctx)) ctx.HC_CONST = HC_CONST_BAKE;
  if (!('I18N_DATE' in ctx)) ctx.I18N_DATE = ctx.LOCALE === 'es' ? esDate : enDate;
  vm.runInContext(UTIL_SOURCE, ctx);
  return ctx;
}

/** The food log's four scripts in their page order (layouts/Plan.astro): food-core.ts (the
 * formula from HC_FOODLOG, the API client, shared state → window.HCFoodInternal), then the add sheet, Mis productos
 * / Mis recetas, and food-log.ts (Registrar, events, boot, window.HCFood). FOOD_SOURCE = the four
 * joined: each is its own IIFE, so running the joined text equals running them one after another. */
export const FOOD_SCRIPTS = ['food-core.ts', 'food-sheet.ts', 'food-catalog.ts', 'food-log.ts'];
// the bytes the page inlines: a classic script as is, a module script (*.ts) bundled (web/src/client-bundle.mjs).
// Joined, a module's leading "use strict" is a plain expression unless it comes first: the page runs each script
// on its own (strict for a module), which the browser e2e cover.
export const FOOD_SOURCES = FOOD_SCRIPTS.map((f) => clientScriptSource(f));
export const FOOD_SOURCE = FOOD_SOURCES.join('\n');

/** The detail sheet's scripts in their page order (web/src/client/manifest.mjs): the data /
 * state helpers (window.HCDetailState), the trend chart (window.HCDetailChart), then detail.ts (the
 * sheet shell, window.HCDetail).
 * DETAIL_SOURCE = them joined: each is self-contained, so running the joined text equals running them
 * one after another. */
const DETAIL_SCRIPTS = ['detail-state.ts', 'detail-chart.ts', 'detail.ts'];
const DETAIL_SOURCES = DETAIL_SCRIPTS.map((f) => clientScriptSource(f));
export const DETAIL_SOURCE = DETAIL_SOURCES.join('\n');
