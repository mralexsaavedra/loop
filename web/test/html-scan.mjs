/* Pure scan helper: extracts the structural facts the build-output guard
 * (and later parity/leak tests) need from a built HTML string. No I/O, no
 * DOM — plain regex over the string so it has zero dependencies and stays
 * fast across every guard/parity test that reuses it.
 */

export function scanHtml(html) {
  return {
    hasDoctype: /^<!doctype html>/i.test(html.trim()),
    hasCharsetMeta: /<meta\s+charset=["']utf-8["']\s*\/?>/i.test(html),
    hasViewportMeta: /<meta\s+name=["']viewport["']/i.test(html),
    externalScriptSrcs: [...html.matchAll(/<script[^>]+\bsrc=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]),
    moduleScriptCount: [...html.matchAll(/<script[^>]*\btype=["']module["'][^>]*>/gi)].length,
    externalLinkHrefs: [...html.matchAll(/<link[^>]+\bhref=["']([^"']+)["'][^>]*>/gi)]
      .map((m) => m[1])
      .filter((href) => !href.startsWith('#') && !href.startsWith('data:')),
    hasAstroAssetsDir: /["'/]_astro\//.test(html),
    hasAstroCidAttr: /\bdata-astro-cid-/.test(html),
  };
}
