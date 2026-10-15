// @ts-check
import { defineConfig } from 'astro/config';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { slimHtmlStyles } from './src/slim-script.mjs';
import { addCsp, delegateLegacyHandlers, inlineHandlers } from './src/csp.mjs';

// Post-processes every built page once Astro wrote it, so it sees the final markup whatever Vite /
// Astro did: (1) slims the inlined CSS (comments + whitespace only, see slimStyle); (2) turns the
// legacy onclick="jump(…)" / "setTab(…)" of the personal trusted notes into delegated data-* attributes
// and warns about any other inline handler (the CSP blocks them); (3) LAST, writes the
// Content-Security-Policy meta with the sha256 of every inline script (src/csp.mjs), so nothing may
// change a script after it.
const postBuild = {
  name: 'page-post-build',
  hooks: {
    'astro:build:done': ({ dir }) => {
      const root = fileURLToPath(dir);
      for (const entry of fs.readdirSync(root, { recursive: true })) {
        if (!String(entry).endsWith('.html')) continue;
        const file = path.join(root, String(entry));
        const html = delegateLegacyHandlers(slimHtmlStyles(fs.readFileSync(file, 'utf8')));
        const left = inlineHandlers(html);
        if (left.length) console.warn(`page-csp: ${entry} keeps ${left.length} inline handler(s) the CSP blocks (use data-jump / data-tab-go)`);
        fs.writeFileSync(file, addCsp(html));
      }
    },
  },
};


// This is a data repo, not a "web app" repo — `web/` IS the Astro project
// root, and `src/` has no special meaning here (srcDir points at the
// project root itself, so `pages/`, `layouts/` live directly under `web/`).
// The final build MUST be one self-contained HTML file usable both as a
// claude.ai artifact and as the LAN-served page — see spec:
// plan-web-single-file-build.
export default defineConfig({
  srcDir: '.',
  output: 'static',
  build: {
    // Inline all stylesheets into the page instead of emitting a linked
    // asset — required for a single self-contained HTML file.
    inlineStylesheets: 'always',
  },
  // HTML-semantics whitespace collapse. Astro 7's default is 'jsx' collapse,
  // which strips whitespace between inline elements (e.g. buttons/spans) and
  // would visibly change legacy layout spacing — explicit 'true' here keeps
  // the collapse HTML-safe instead.
  compressHTML: true,
  devToolbar: { enabled: false },
  integrations: [postBuild],
  vite: {
    server: {
      fs: {
        // allow Vite dev-server file access outside web/ (e.g. ../lib,
        // ../data) once later slices read repo-root modules during `astro dev`.
        allow: ['..'],
      },
    },
    build: {
      // esbuild's default CSS minifier rewrites some declarations into
      // functionally-equivalent-but-textually-different forms (e.g.
      // `background:transparent` → `background:0 0`, `rgba(...)` → hex,
      // `::before` → `:before`). Harmless for rendering, but it defeats the
      // CSS parity guard's byte-level "every legacy declaration is present"
      // check (web/test/css-parity.test.mjs) and makes web/src/styles/*.css
      // harder to diff against the legacy source. The `page-post-build`
      // integration above removes comments + whitespace only instead.
      cssMinify: false,
    },
  },
  // No public/ directory by design: zero external assets, everything is
  // baked into the single output file. (Astro tolerates a missing public/
  // — nothing to configure, we simply never create the folder.)
});
