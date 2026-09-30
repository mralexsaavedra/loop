/* Test harness helper for the classic client scripts: every script reads the shared helpers from
 * the global HC (web/src/client/util.js), which layouts/Plan.astro inlines FIRST, right after the
 * baked HC_CONST. loadUtil(ctx) reproduces that order inside a vm context. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { hcConst } from '../../lib/stale.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const UTIL_SOURCE = fs.readFileSync(path.join(here, '..', 'src', 'client', 'util.js'), 'utf8');
export const HC_CONST_BAKE = hcConst();

/** Bakes HC_CONST (unless the test set its own) and runs util.js in `ctx` (already a vm context). */
export function loadUtil(ctx) {
  if (!('HC_CONST' in ctx)) ctx.HC_CONST = HC_CONST_BAKE;
  vm.runInContext(UTIL_SOURCE, ctx);
  return ctx;
}
