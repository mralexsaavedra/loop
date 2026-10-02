/* Build-time slimming of the inlined client scripts (web/layouts/Plan.astro): comments and whitespace
 * are removed, NOTHING else — identifiers keep their names, syntax is not rewritten and the output is
 * a classic script (no module wrapper), so every top-level `var` / function stays a page global the
 * other scripts and the tests read. Non-ASCII copy stays literal (charset utf8). esbuild ships with
 * astro (its own and vite's dependency), so this adds no dependency. The ONE function the build and
 * the build-output tests share: a test locating a script in the built HTML compares against
 * slimScript(source), never the raw file. */
import { transformSync } from 'esbuild';

export function slimScript(src) {
  return transformSync(src, {
    loader: 'js',
    minifyWhitespace: true,
    minifySyntax: false,
    minifyIdentifiers: false,
    legalComments: 'none',
    charset: 'utf8',
  }).code;
}
