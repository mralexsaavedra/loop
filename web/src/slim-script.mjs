/* Build-time slimming of the inlined client scripts (web/layouts/Plan.astro): comments and whitespace
 * are removed, NOTHING else — identifiers keep their names, syntax is not rewritten and the output is
 * a classic script (no module wrapper), so every top-level `var` / function stays a page global the
 * other scripts and the tests read. Non-ASCII copy stays literal (charset utf8). esbuild is declared
 * in package.json at the exact version astro / vite already lock (one lockfile entry, deduped), so the
 * build does not rely on a transitive install. The ONE function the build and
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

/* The CSS twin of slimScript, applied to the built page's inline <style> blocks (web/astro.config.mjs,
 * the `page-post-build` integration): comments and whitespace go, NOTHING else — no minifySyntax (it
 * would rewrite `::before` → `:before`, `transparent` → `0 0`, rgba → hex) and no target lowering, so
 * every declaration stays as written and web/test/css-parity.test.mjs still matches it. Vite's own
 * cssMinify stays off for that reason. A test reading CSS from the built HTML must be whitespace
 * tolerant or compare against slimStyle(source). */
export function slimStyle(src) {
  return transformSync(src, {
    loader: 'css',
    minifyWhitespace: true,
    minifySyntax: false,
    minifyIdentifiers: false,
    legalComments: 'none',
    charset: 'utf8',
  }).code.trimEnd();
}

/* Rewrites every <style> block of a built HTML page through slimStyle. Only the document <head> is
 * touched (the page keeps all its styles there; a client script may hold the text "<style"). */
export function slimHtmlStyles(html) {
  const end = html.indexOf('</head>');
  if (end === -1) return html;
  const head = html.slice(0, end).replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_, open, css, close) => open + slimStyle(css) + close);
  return head + html.slice(end);
}
