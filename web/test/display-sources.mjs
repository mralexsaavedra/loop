/* The display sources the design-system guards scan (number-format.test.mjs, design-system.test.mjs):
 * the classic client scripts, the view helpers, the Astro tabs / components / layout, the i18n
 * templates and the build-time advice copy, read with comments stripped. Directories are listed
 * recursively, so a file in a new sub-folder is scanned too; tests (`.test.`) are skipped. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// every `ext` file under `dir` (repo-relative), sub-folders included, sorted
export function list(dir, ext) {
  return fs.readdirSync(path.join(ROOT, dir), { recursive: true })
    .map((f) => String(f).split(path.sep).join('/'))
    .filter((f) => f.endsWith(ext) && !f.includes('.test.'))
    .sort()
    .map((f) => `${dir}/${f}`);
}

export const CODE = [
  ...list('web/src/client', '.js'),
  ...list('web/src/view', '.mjs'),
  ...list('web/src/tabs', '.astro'),
  ...list('web/src/components', '.astro'),
  'web/layouts/Plan.astro',
  'lib/score/advice-copy.mjs',
];
export const I18N = list('web/src/i18n', '.mjs');

// comments out (block comments, and a `//` comment at a line start or after whitespace — a URL's
// "://" has no space before it), so a comment that says "±2 %" never trips a guard
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}
const read = (f) => stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));
export const SRC = Object.fromEntries([...CODE, ...I18N].map((f) => [f, read(f)]));
