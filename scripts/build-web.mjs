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
 *
 * `--check` skips the Astro build entirely and only validates the
 * programmed training data for the given mode (fast, no astro binary
 * invoked). This replaces the training validation the retired
 * data/training/generate-training.js --check used to provide — nutrition
 * validation stays in `node data/nutrition/generate.js --check` (`npm run
 * check` chains both).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadInputs } from '../lib/load/inputs.mjs';
import { validateProgram } from '../lib/training/program.mjs';
import { resolveEnv } from '../web/src/env.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode') out.mode = argv[++i];
    else if (argv[i] === '--locale') out.locale = argv[++i];
    else if (argv[i] === '--check') out.check = true;
    else if (argv[i] === '--outdir') out.outdir = argv[++i];
  }
  return out;
}

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB_ROOT = path.join(ROOT, 'web');
const ASTRO_BIN = path.join(ROOT, 'node_modules', '.bin', 'astro');

/** Pure: loads training-data(.example).json for `mode` and validates it.
 * Throws with validateProgram's error message on a malformed program. */
export function checkTraining({ repoRoot, mode }) {
  const { training } = loadInputs({ repoRoot, dataMode: mode });
  return validateProgram(training);
}

/** Pure: resolves the build locale using the SAME precedence contract as
 * web/src/env.mjs's resolveEnv (env/CLI > plan.locale > 'en') — delegates to
 * it directly instead of re-implementing the fallback, so the CLI path can
 * never drift from the Astro build's own resolution again. `explicitLocale`
 * is the CLI `--locale` flag or a pre-existing `LOCALE` env var; pass
 * null/undefined when neither was given. */
export function resolveLocale({ repoRoot, mode, explicitLocale }) {
  return resolveEnv({ HC_REPO_ROOT: repoRoot, DATA_MODE: mode, LOCALE: explicitLocale || undefined }).locale;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode || process.env.DATA_MODE || 'personal';
  const explicitLocale = args.locale || process.env.LOCALE || null;

  if (args.check) {
    checkTraining({ repoRoot: ROOT, mode });
    console.log(`build-web --check: training-data.json OK (mode=${mode})`);
    return;
  }

  // Resolved with the SAME precedence env.mjs's resolveEnv uses (explicit >
  // plan.locale > 'en') — see resolveLocale() above. Previously this
  // defaulted personal builds to a hardcoded 'es' regardless of what the
  // plan itself declared, making plan.locale dead through this CLI path.
  const locale = resolveLocale({ repoRoot: ROOT, mode, explicitLocale });

  // Consumed by web/src/env.mjs from slice 2 onward, and by the layout's
  // <html lang> in the meantime.
  process.env.DATA_MODE = mode;
  process.env.LOCALE = locale;
  process.env.HC_REPO_ROOT = ROOT;

  // --outdir overrides the default web/dist/<mode> destination — used by
  // web/test/build-fixtures.mjs to build test fixtures into web/.test-dist/
  // instead, so `npm test` never overwrites the live personal build that
  // services/plan-web/refresh.sh publishes from (design's Testing Strategy).
  const outDir = args.outdir ? path.resolve(ROOT, args.outdir) : path.join(WEB_ROOT, 'dist', mode);
  const stagingDir = path.join(path.dirname(outDir), `.staging-${mode}-${process.pid}`);
  fs.mkdirSync(path.dirname(stagingDir), { recursive: true });
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

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
