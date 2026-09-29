#!/usr/bin/env node
/* Builds the single-file Astro plan page into web/dist/<mode>/index.html.
 *
 * Builds into a private per-process staging directory first and renames it
 * into place only on success. Astro empties its outDir at the start of
 * every build, so building straight into web/dist/<mode> would destroy the
 * last good output the moment a build starts — staging + atomic rename
 * means a failed build never takes down what was already served (see
 * spec: Resilient serving on build failure).
 *
 * Usage: node scripts/build-web.mjs [--mode personal|example] [--locale es|en]
 *   DATA_MODE / LOCALE env vars are equivalent to --mode / --locale.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode') out.mode = argv[++i];
    else if (argv[i] === '--locale') out.locale = argv[++i];
  }
  return out;
}

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB_ROOT = path.join(ROOT, 'web');
const ASTRO_BIN = path.join(ROOT, 'node_modules', '.bin', 'astro');

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode || process.env.DATA_MODE || 'personal';
  const locale = args.locale || process.env.LOCALE || (mode === 'example' ? 'en' : 'es');

  // Consumed by web/src/env.mjs from slice 2 onward, and by the layout's
  // <html lang> in the meantime.
  process.env.DATA_MODE = mode;
  process.env.LOCALE = locale;
  process.env.HC_REPO_ROOT = ROOT;

  const outDir = path.join(WEB_ROOT, 'dist', mode);
  const stagingDir = path.join(WEB_ROOT, 'dist', `.staging-${process.pid}`);
  fs.rmSync(stagingDir, { recursive: true, force: true });

  try {
    execFileSync(ASTRO_BIN, ['build', '--root', WEB_ROOT, '--outDir', stagingDir], {
      stdio: 'inherit',
      env: process.env,
    });
  } catch (err) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    console.error(`build-web: build failed (mode=${mode}) — keeping previous ${path.relative(ROOT, outDir)}/ untouched`);
    process.exitCode = 1;
    return;
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  fs.renameSync(stagingDir, outDir);

  console.log(`build-web: wrote ${path.relative(ROOT, outDir)}/index.html (mode=${mode}, locale=${locale})`);
}

main();
