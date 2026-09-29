/* Personal-data leak guard — see design's "Personal-data safety": every
 * live-only personal string (plan-data.json's `page.*`/notes, training-
 * data.json's coach/program/source) must NOT appear verbatim in any
 * TRACKED file (what `git ls-files` would commit). Strings that are also
 * present in the tracked public food DB (ingredients.json name/note) or
 * the tracked .example seeds are allowlisted — they are legitimately
 * public/generic content, not a leak.
 *
 * Skips gracefully when the personal files are absent (fresh clone / CI
 * without the owner's gitignored data) — see spec's Fresh-clone bootstrap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(path.dirname(here)); // web/test -> web -> repo root

const MIN_LEN = 8;

function readJsonIfExists(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Collects every string leaf (recursively) from a JSON-like value. */
function collectStrings(value, out) {
  if (typeof value === 'string') {
    if (value.length >= MIN_LEN) out.add(value);
    return;
  }
  if (Array.isArray(value)) { value.forEach((v) => collectStrings(v, out)); return; }
  if (value && typeof value === 'object') { for (const v of Object.values(value)) collectStrings(v, out); }
}

function buildAllowlist() {
  const allow = new Set();

  const ing = readJsonIfExists(path.join(ROOT, 'data', 'nutrition', 'ingredients.json'));
  if (ing?.ingredients) {
    for (const item of Object.values(ing.ingredients)) {
      if (item.name) allow.add(item.name);
      if (item.note) allow.add(item.note);
    }
  }

  const nutritionExample = readJsonIfExists(path.join(ROOT, 'data', 'nutrition', 'plan-data.example.json'));
  if (nutritionExample) collectStrings(nutritionExample, allow);

  const trainingExample = readJsonIfExists(path.join(ROOT, 'data', 'training', 'training-data.example.json'));
  if (trainingExample) collectStrings(trainingExample, allow);

  return { allow };
}

/** Personal-only strings to scan for: plan-data.json's page.* (title/
 * kicker/h1/sub/footerHtml/notes.*) and training-data.json's coach/
 * program/source. NOT meal names/descs (those overlap heavily with
 * generic recipe copy already covered by ingredients.json/allowlist and
 * are not the "personal prose" this guard targets — the page block is). */
function personalStrings() {
  const out = new Set();
  const plan = readJsonIfExists(path.join(ROOT, 'data', 'nutrition', 'plan-data.json'));
  if (plan?.page) collectStrings(plan.page, out);

  const training = readJsonIfExists(path.join(ROOT, 'data', 'training', 'training-data.json'));
  if (training) {
    for (const field of ['coach', 'program', 'source']) {
      if (typeof training[field] === 'string' && training[field].length >= MIN_LEN) out.add(training[field]);
    }
  }
  return out;
}

function trackedFileContents() {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const contents = [];
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
    // skip binary-ish assets by extension — leak scanning is a text search
    if (/\.(png|jpg|jpeg|gif|pdf|zip|ico|woff2?)$/i.test(rel)) continue;
    try {
      contents.push([rel, fs.readFileSync(abs, 'utf8')]);
    } catch {
      // unreadable/binary — skip
    }
  }
  return contents;
}

test('no personal plan-data.json `page.*` / training-data.json coach-program-source string leaks into any tracked file', () => {
  const personal = personalStrings();
  if (personal.size === 0) {
    // fresh clone / no personal data present — nothing to guard, per spec's
    // Fresh-clone bootstrap (personal files are gitignored and optional).
    return;
  }

  const { allow } = buildAllowlist();
  const tracked = trackedFileContents();

  const leaks = [];
  for (const str of personal) {
    if (allow.has(str)) continue;
    for (const [file, content] of tracked) {
      if (content.includes(str)) leaks.push({ string: str, file });
    }
  }

  assert.deepEqual(leaks, [], `personal strings leaked into tracked files:\n${leaks.map((l) => `  "${l.string.slice(0, 60)}..." in ${l.file}`).join('\n')}`);
});
