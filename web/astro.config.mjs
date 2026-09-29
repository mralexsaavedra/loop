// @ts-check
import { defineConfig } from 'astro/config';

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
  vite: {
    server: {
      fs: {
        // allow Vite dev-server file access outside web/ (e.g. ../lib,
        // ../data) once later slices read repo-root modules during `astro dev`.
        allow: ['..'],
      },
    },
  },
  // No public/ directory by design: zero external assets, everything is
  // baked into the single output file. (Astro tolerates a missing public/
  // — nothing to configure, we simply never create the folder.)
});
