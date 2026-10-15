/* The page's Content-Security-Policy, written at build time (web/astro.config.mjs, the `page-csp`
 * integration, after the CSS is slimmed). The page is ONE self-contained file that also opens from disk,
 * so the policy travels in a <meta http-equiv> right after <meta charset> (a meta CSP cannot carry
 * frame-ancestors: services/loop-web/nginx.conf.template sends that one as a header). Every script is
 * inline (`is:inline`), so script-src lists the sha256 of each exact <script> body and never
 * 'unsafe-inline'; inline event-handler attributes (onclick=…) are therefore blocked, and the page uses
 * delegated listeners instead (client/core.js data-tab-go / data-jump). style-src keeps
 * 'unsafe-inline': the client writes computed style="width:…" attributes into its markup, which no hash
 * can cover. Fonts, the favicon and the avatar are data: URIs; the LAN APIs are same-origin. */
import { createHash } from 'node:crypto';

// every inline <script> body, in document order (a browser ends a script at its first </script)
const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
const CHARSET_RE = /<meta charset="?utf-8"?\s*\/?>/i;

export function scriptHashes(html) {
  return [...html.matchAll(SCRIPT_RE)].map((m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
}

export function cspFor(html) {
  const hashes = [...new Set(scriptHashes(html))];
  return [
    "default-src 'none'",
    `script-src ${hashes.length ? hashes.join(' ') : "'none'"}`,
    "style-src 'unsafe-inline'",
    'img-src data:',
    'font-src data:',
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
}

/* Inserts the CSP meta right after <meta charset> (before any <style> or <script>, so it covers them
 * all). Run it LAST: any later change to a script body would no longer match its hash. Throws on a page
 * without a charset meta (the policy would otherwise silently not be written). */
export function addCsp(html) {
  const m = CHARSET_RE.exec(html);
  if (!m) throw new Error('page-csp: no <meta charset="utf-8"> to anchor the Content-Security-Policy meta');
  const at = m.index + m[0].length;
  return `${html.slice(0, at)}<meta http-equiv="Content-Security-Policy" content="${cspFor(html)}">${html.slice(at)}`;
}

/* The personal plan's trusted notes (plan-data.json `page.notes`, rendered with set:html by
 * components/Note.astro and tabs/Tablas.astro) may still carry the legacy inline handlers
 * onclick="jump('<id>')" / onclick="setTab('<tab>')", which the CSP blocks. They become the delegated
 * data-jump / data-tab-go attributes client/core.js listens for; anything else is left as written (and
 * reported by inlineHandlers, so the build can warn). */
export function delegateLegacyHandlers(html) {
  return html
    .replace(/\sonclick=(["'])jump\((?:'|&#39;)([\w-]+)(?:'|&#39;)\)\1/g, ' data-jump="$2"')
    .replace(/\sonclick=(["'])setTab\((?:'|&#39;)([\w-]+)(?:'|&#39;)\)\1/g, ' data-tab-go="$2"');
}

/* Inline event-handler attributes (` onclick="`, ` onload='` …) anywhere in the page text, markup AND
 * script strings that build markup; [] on a clean page. */
export function inlineHandlers(html) {
  return [...html.matchAll(/\son[a-z]+=\\?["']/gi)].map((m) => m[0].trim());
}
