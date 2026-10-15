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
 * Usage: node scripts/build-web.mjs [--mode personal|example] [--locale es|en] [--outdir <dir>] [--check]
 *   DATA_MODE / LOCALE env vars are equivalent to --mode / --locale; --help prints the usage, and an
 *   unknown flag or a bad --mode / --locale value exits 2 before anything is read or built.
 *
 * `--check` skips the Astro build entirely and only validates the
 * programmed training data for the given mode (fast, no astro binary
 * invoked); nutrition
 * validation stays in `node data/nutrition/generate.mjs --check` (`npm run
 * check` chains both).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadInputs } from '../lib/load/inputs.mjs';
import { validateProgram } from '../lib/training/program.mjs';
import { checkManualProfile } from '../lib/profile/read.mjs';
import { resolveEnv } from '../web/src/env.mjs';
import { isMain } from './lib/is-main.mjs';
import { parseCli } from '../data/apple-health/sync-common.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB_ROOT = path.join(ROOT, 'web');
const ASTRO_BIN = path.join(ROOT, 'node_modules', '.bin', 'astro');

/** Pure: loads training-data(.example).json for `mode` and validates it.
 * Throws with validateProgram's error message on a malformed program.
 * training-data.json is OPTIONAL in personal mode (see lib/load/inputs.mjs)
 * — when the file is simply ABSENT, there is nothing to validate and that
 * is not an error, so this skips validateProgram entirely rather than
 * routing the resulting empty `{days:{}}` through it (which would
 * otherwise fail with a misleading "days is empty" for a user who
 * deliberately has no programmed-training file). A file that EXISTS but is
 * empty/malformed still fails validation normally — only true absence is
 * optional. */
export function checkTraining({ repoRoot, mode }) {
  if (mode !== 'example') {
    const trainingPath = path.join(repoRoot, 'data', 'training', 'training-data.json');
    if (!fs.existsSync(trainingPath)) return { ok: true, skipped: true };
  }
  const { training } = loadInputs({ repoRoot, dataMode: mode });
  return validateProgram(training);
}

/** Prints the manual-profile check and returns the exit code: the BUILD only warns on a malformed
 * profile/profile.json and ignores it, so `npm run check` is where it fails, with the reason. */
export function reportProfileCheck(res, mode, { log = console.log, error = console.error } = {}) {
  if (res.error) {
    error(`build-web --check: ERROR: ${res.error}`);
    return 1;
  }
  log(res.skipped
    ? `build-web --check: profile.json not present (mode=${mode}) — optional, skipping`
    : `build-web --check: profile.json OK (mode=${mode})`);
  return 0;
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

const DEFAULT_STALE_STAGING_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

/** True if `pid` names a process that is currently running. Uses the
 * `kill(pid, 0)` idiom (no signal sent — just existence/permission check):
 * ESRCH means "no such process" (dead); any other error (e.g. EPERM, a live
 * process owned by someone else) or a successful call means it's alive. An
 * unparseable pid is treated as unknown, which callers must treat as alive
 * (conservative — never guess a directory is safe to delete). */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

/** Removes orphaned `.staging-*` directories left behind by a crashed/killed
 * previous build. A clean run always renames its own staging dir away
 * before exiting, so a leftover `.staging-<mode>-<pid>` MIGHT be an orphan —
 * but might also be a genuinely in-flight concurrent build, so directory
 * age alone is never sufficient. Only removes an entry when BOTH:
 *   1. its encoded PID is no longer alive (isPidAlive() false), AND
 *   2. its mtime is older than `maxAgeMs` (default 10 min) — a grace
 *      period in case the dead process's directory write is still
 *      mid-flush on a slow filesystem.
 * Never touches `currentStagingDir` itself. Returns the list of removed
 * paths. */
export function sweepStaleStaging({ dir, currentStagingDir, now = Date.now(), maxAgeMs = DEFAULT_STALE_STAGING_MAX_AGE_MS }) {
  if (!fs.existsSync(dir)) return [];
  const swept = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith('.staging-')) continue;
    const entryPath = path.join(dir, name);
    if (entryPath === currentStagingDir) continue;
    const pidMatch = name.match(/-(\d+)$/);
    const pid = pidMatch ? Number(pidMatch[1]) : NaN;
    if (isPidAlive(pid)) continue; // in-flight build (or unparseable name) — never touch
    const { mtimeMs } = fs.statSync(entryPath);
    if (now - mtimeMs < maxAgeMs) continue; // dead but too recent — grace period
    fs.rmSync(entryPath, { recursive: true, force: true });
    swept.push(entryPath);
  }
  return swept;
}

/** A missing input file (a fresh clone whose `.example` seeds were not copied yet) as ONE line for the
 * terminal, or null for any other error (those still surface with their stack). */
export function inputErrorLine(err) {
  if (!err || err.code !== 'HC_MISSING_INPUT') return null;
  return `build-web: ${path.relative(ROOT, err.file) || err.file} not found.${err.hint ? ' ' + err.hint : ''}`;
}

const USAGE = `Usage: node scripts/build-web.mjs [--mode personal|example] [--locale es|en] [--outdir <dir>] [--check]

Builds the single-file plan page into web/dist/<mode>/index.html (staged, then renamed into place).
  --mode       personal (default) or example; env DATA_MODE is equivalent
  --locale     es or en (default: the plan's locale, else en); env LOCALE is equivalent
  --outdir     build into <dir> instead of web/dist/<mode> (the test fixtures)
  --check      validate training-data.json and profile/profile.json only, no build
  -h, --help   this help`;

const CLI_OPTIONS = { mode: { type: 'string' }, locale: { type: 'string' }, outdir: { type: 'string' }, check: { type: 'boolean' } };

/** argv -> parseCli's result, plus the --mode / --locale value check (exit 2, like an unknown flag). Pure. */
export function parseBuildArgs(argv) {
  const cli = parseCli(argv, { usage: USAGE, options: CLI_OPTIONS });
  if (cli.exit != null) return cli;
  const { mode, locale } = /** @type {{ mode?: string, locale?: string }} */ (cli.values);
  if (mode != null && !['personal', 'example'].includes(mode)) return { exit: 2, err: `ERROR: --mode must be personal or example, got ${JSON.stringify(mode)}\n\n${USAGE}` };
  if (locale != null && !['es', 'en'].includes(locale)) return { exit: 2, err: `ERROR: --locale must be es or en, got ${JSON.stringify(locale)}\n\n${USAGE}` };
  return cli;
}

/** The build; returns the exit code. */
function main(args) {
  const mode = args.mode || process.env.DATA_MODE || 'personal';
  const explicitLocale = args.locale || process.env.LOCALE || null;

  if (args.check) {
    const res = checkTraining({ repoRoot: ROOT, mode });
    console.log(
      res.skipped
        ? `build-web --check: training-data.json not present (mode=${mode}) — optional, skipping (Hoy/Entrenos will render their empty state)`
        : `build-web --check: training-data.json OK (mode=${mode})`,
    );
    return reportProfileCheck(checkManualProfile({ repoRoot: ROOT, mode }), mode);
  }

  // Resolved with the SAME precedence env.mjs's resolveEnv uses (explicit >
  // plan.locale > 'en') — see resolveLocale() above.
  let locale;
  try {
    locale = resolveLocale({ repoRoot: ROOT, mode, explicitLocale });
  } catch (err) {
    const line = inputErrorLine(err);
    if (!line) throw err;
    console.error(line);
    return 1;
  }

  // read by web/src/env.mjs (and the layout's <html lang>)
  process.env.DATA_MODE = mode;
  process.env.LOCALE = locale;
  process.env.HC_REPO_ROOT = ROOT;

  // --outdir overrides the default web/dist/<mode> destination — used by
  // web/test/build-fixtures.mjs to build test fixtures into web/.test-dist/
  // instead, so `npm test` never overwrites the live personal build that
  // services/loop-web/refresh.sh publishes from (design's Testing Strategy).
  const outDir = args.outdir ? path.resolve(ROOT, args.outdir) : path.join(WEB_ROOT, 'dist', mode);
  const stagingParent = path.dirname(outDir);
  const stagingDir = path.join(stagingParent, `.staging-${mode}-${process.pid}`);
  fs.mkdirSync(stagingParent, { recursive: true });
  const swept = sweepStaleStaging({ dir: stagingParent, currentStagingDir: stagingDir });
  if (swept.length) {
    console.warn(`build-web: swept ${swept.length} orphaned staging dir(s) from a previous crashed/killed build: ${swept.map((p) => path.relative(ROOT, p)).join(', ')}`);
  }
  fs.rmSync(stagingDir, { recursive: true, force: true });

  try {
    execFileSync(ASTRO_BIN, ['build', '--root', WEB_ROOT, '--outDir', stagingDir], {
      stdio: 'inherit',
      env: process.env,
    });
  } catch (err) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    console.error(`build-web: build failed (mode=${mode}) — keeping previous ${path.relative(ROOT, outDir)}/ untouched`);
    return 1;
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  fs.renameSync(stagingDir, outDir);

  console.log(`build-web: wrote ${path.relative(ROOT, outDir)}/index.html (mode=${mode}, locale=${locale})`);
  return 0;
}

if (isMain(import.meta.url)) {
  const cli = parseBuildArgs(process.argv.slice(2));
  if (cli.exit != null) {
    if (cli.exit) console.error(cli.err);
    else console.log(cli.out);
    process.exitCode = cli.exit;
  } else {
    process.exitCode = main(cli.values);
  }
}
