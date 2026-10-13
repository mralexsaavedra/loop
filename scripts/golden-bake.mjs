#!/usr/bin/env node
/* Golden guard for every build-time bake (web/src/bakes.mjs computeBakes, the page's composition root).
 *
 * Canonical JSON of the bakes for two envs is compared against committed fixtures:
 *   - example: the tracked seeds + the synthetic demo extract (data/demo/extract), as `npm run build:example`
 *   - empty:   the same seeds with an EMPTY extract directory (the fresh-clone shapes)
 * web/test/golden-bake.test.mjs runs the comparison in `npm test`; this script maintains the fixtures:
 *
 *   npm run golden:bake                 compare example + empty, exit 1 on a diff
 *   npm run golden:bake -- --update     rewrite web/test/fixtures/bake-golden.{example,empty}.json
 *   npm run golden:bake -- --personal   owner-local: the personal bakes vs web/test/.golden/ (gitignored);
 *                                       the first run writes it, later runs compare (exit 1 on a diff),
 *                                       `--personal --update` rewrites it. Prints only counts and JSON
 *                                       paths, never personal values. Exit 2 when the personal inputs
 *                                       (data/nutrition/plan-data.json) are missing.
 *
 * Determinism: a fixed clock (GOLDEN_NOW, the demo extract's last day — scripts/make-demo-data.mjs
 * DEMO_DEFAULTS.end) and TZ=UTC while computing; object keys sorted. Canonicalisation drops:
 *   - profile.photo: the avatar data URI (a personal image, large; not extract-derived) -> '[photo]' or null.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock } from 'node:test';
import { resolveEnv } from '../web/src/env.mjs';
import { computeBakes } from '../web/src/bakes.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const GOLDEN_NOW = '2026-09-28T20:00:00Z';
export const FIXTURES = {
  example: path.join(ROOT, 'web', 'test', 'fixtures', 'bake-golden.example.json'),
  empty: path.join(ROOT, 'web', 'test', 'fixtures', 'bake-golden.empty.json'),
  personal: path.join(ROOT, 'web', 'test', '.golden', 'bake-golden.personal.json'),
};

/** The env a build of `kind` resolves ('example' | 'personal' | 'empty' = example with an empty extract dir). */
export function goldenEnv(kind, { emptyDir } = {}) {
  const env = resolveEnv({ HC_REPO_ROOT: ROOT, DATA_MODE: kind === 'personal' ? 'personal' : 'example', LOCALE: 'en' });
  return kind === 'empty' ? { ...env, extractDir: emptyDir } : env;
}

/** Recursively sorted keys; JSON round trip first (undefined dropped, NaN -> null, like the page's bake). */
export function canonical(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    return v;
  };
  return sort(JSON.parse(JSON.stringify(value)));
}

/** computeBakes(env) under the fixed clock + UTC, canonicalised (see the drops in the header). */
export function goldenBakes(env) {
  const tz = process.env.TZ;
  process.env.TZ = 'UTC';
  mock.timers.enable({ apis: ['Date'], now: new Date(GOLDEN_NOW) });
  let bakes;
  try {
    bakes = computeBakes(env);
  } finally {
    mock.timers.reset();
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
  const out = canonical(bakes);
  if (out.profile && 'photo' in out.profile) out.profile.photo = out.profile.photo ? '[photo]' : null;
  return out;
}

/** The example and empty goldens (the empty extract dir is a temp dir, removed afterwards). */
export function trackedGoldens() {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-golden-empty-'));
  try {
    return { example: goldenBakes(goldenEnv('example')), empty: goldenBakes(goldenEnv('empty', { emptyDir })) };
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
}

/** The differing JSON paths between two canonical values: [{path, kind}] (kind: changed | added | removed). */
export function diffPaths(expected, actual, at = '$', out = []) {
  const isObj = (v) => v !== null && typeof v === 'object';
  if (isObj(expected) && isObj(actual) && Array.isArray(expected) === Array.isArray(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const k of keys) {
      const p = Array.isArray(expected) ? `${at}[${k}]` : `${at}.${k}`;
      if (!(k in actual)) out.push({ path: p, kind: 'removed' });
      else if (!(k in expected)) out.push({ path: p, kind: 'added' });
      else diffPaths(expected[k], actual[k], p, out);
    }
  } else if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    out.push({ path: at, kind: 'changed', expected, actual });
  }
  return out;
}

/** A compact report: the count and the first `limit` paths; values only when `values` (never for personal data). */
export function formatDiff(name, diffs, { limit = 20, values = true } = {}) {
  const short = (v) => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 80 ? s.slice(0, 77) + '...' : s; };
  const lines = [`${name}: ${diffs.length} differing path(s)${diffs.length > limit ? `, first ${limit}` : ''}:`];
  for (const d of diffs.slice(0, limit)) {
    lines.push(`  ${d.kind.padEnd(7)} ${d.path}` + (values && d.kind === 'changed' ? `  ${short(d.expected)} -> ${short(d.actual)}` : ''));
  }
  return lines.join('\n');
}

const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n');
};
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const rel = (file) => path.relative(ROOT, file);

function runPersonal(update) {
  if (!fs.existsSync(path.join(ROOT, 'data', 'nutrition', 'plan-data.json'))) {
    console.error('golden:bake --personal: personal inputs missing (data/nutrition/plan-data.json); nothing to compare. Run it in the clone that holds your personal data.');
    return 2;
  }
  const env = goldenEnv('personal');
  if (!env.extractDir) console.warn('golden:bake --personal: no data/apple-health/extract — the personal golden holds the empty-extract shapes.');
  const actual = goldenBakes(env);
  const file = FIXTURES.personal;
  const expected = readJson(file);
  if (update || !expected) {
    write(file, actual);
    console.log(`golden:bake --personal: ${expected ? 'rewrote' : 'wrote'} ${rel(file)} (gitignored; never commit it)`);
    return 0;
  }
  const diffs = diffPaths(expected, actual);
  if (!diffs.length) { console.log(`golden:bake --personal: identical to ${rel(file)}`); return 0; }
  console.error(formatDiff('personal', diffs, { values: false }));
  return 1;
}

function runTracked(update) {
  const actual = trackedGoldens();
  let failed = 0;
  for (const kind of ['example', 'empty']) {
    const file = FIXTURES[kind];
    if (update) { write(file, actual[kind]); console.log(`golden:bake: wrote ${rel(file)}`); continue; }
    const expected = readJson(file);
    if (!expected) { console.error(`golden:bake: ${rel(file)} missing — run npm run golden:bake -- --update`); failed = 1; continue; }
    const diffs = diffPaths(expected, actual[kind]);
    if (diffs.length) { console.error(formatDiff(kind, diffs)); failed = 1; } else console.log(`golden:bake: ${kind} identical`);
  }
  return failed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  process.exitCode = args.includes('--personal') ? runPersonal(update) : runTracked(update);
}
