/* The source of one page client script, as layouts/Plan.astro inlines it and the tests run it.
 *
 *   - a classic script (web/src/client/*.js) is its file, as is;
 *   - a module script (web/src/client/*.ts) is BUNDLED by esbuild into one classic IIFE: its TypeScript types are
 *     stripped and its imports (lib/ modules, other client modules) inlined, so the page stays one self-contained
 *     file whose every <script> is inline and hashed by the CSP (web/src/csp.mjs), exactly like a classic script.
 *
 * One function for the build (the virtual module of astro.config.mjs) and the tests, so both run the same bytes.
 * Deterministic: no minification, no source map, no banner. Build / test time only. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

export const CLIENT_DIR = fileURLToPath(new URL('./client/', import.meta.url));

/** True for a client entry the build bundles (a .ts module), false for a classic .js script. */
export const isModuleScript = (file) => file.endsWith('.ts');

/** The JavaScript the page inlines for `file` (a name in web/src/client/). */
export function clientScriptSource(file) {
  const entry = path.join(CLIENT_DIR, file);
  if (!isModuleScript(file)) return fs.readFileSync(entry, 'utf8');
  const out = buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    charset: 'utf8',
    legalComments: 'none',
    write: false,
    logLevel: 'silent',
  });
  return out.outputFiles[0].text;
}
