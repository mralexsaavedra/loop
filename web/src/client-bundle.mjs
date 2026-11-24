/* The source of one page client script, as layouts/Plan.astro inlines it and the tests run it: every client
 * script is a TypeScript module (web/src/client/*.ts) BUNDLED by esbuild into one IIFE: its types are stripped
 * and its imports (lib/ modules, other client modules) inlined, so the page stays one self-contained file whose
 * every <script> is inline and hashed by the CSP (web/src/csp.mjs).
 *
 * One function for the build (the virtual module of astro.config.mjs) and the tests, so both run the same bytes.
 * Deterministic: no minification, no source map, no banner. Build / test time only. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

export const CLIENT_DIR = fileURLToPath(new URL('./client/', import.meta.url));

/** The JavaScript the page inlines for `file` (a name in web/src/client/).
 * @param {string} file @returns {string} */
export function clientScriptSource(file) {
  const entry = path.join(CLIENT_DIR, file);
  if (!file.endsWith('.ts')) throw new Error(`client script ${file}: every client script is a TypeScript module (*.ts)`);
  const out = buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    charset: 'utf8',
    legalComments: 'none',
    // a lib constant is `Object.freeze({...})`: pure, so one the page never reads is dropped with its module's
    // other unused code (a freeze kept for its effect, lib/extract/read.mjs, is Node-only: never in a page bundle)
    pure: ['Object.freeze'],
    write: false,
    logLevel: 'silent',
  });
  return out.outputFiles[0].text;
}
