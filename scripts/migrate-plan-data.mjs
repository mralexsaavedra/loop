#!/usr/bin/env node
/* One-shot migration (astro-plan-web slice 3): lift personal copy and
 * indulge-warning key lists OUT of the hand-maintained legacy
 * `data/nutrition/plan-web.html` `<script>` block and INTO
 * `data/nutrition/plan-data.json`, so the new Astro client scripts read
 * them from data instead of a second, hand-typed copy.
 *
 * Why parse the personal plan-web.html instead of hardcoding the owner's
 * real copy strings here: THIS SCRIPT IS TRACKED (git). Hardcoding the
 * owner's real Spanish page copy or extras key lists into a tracked file
 * would be exactly the personal-data leak web/test/leak.test.mjs exists to
 * catch. Reading it at RUNTIME from the gitignored, already-generated
 * plan-web.html keeps the tracked script itself fully generic.
 *
 * Idempotent: if plan.page already exists, this is a no-op (safe to re-run).
 * Backs up plan-data.json -> plan-data.json.bak (gitignored) before writing.
 *
 * Run: node scripts/migrate-plan-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NUTRITION_DIR = path.join(ROOT, 'data', 'nutrition');
const PLAN_PATH = path.join(NUTRITION_DIR, 'plan-data.json');
const HTML_PATH = path.join(NUTRITION_DIR, 'plan-web.html');
const BACKUP_PATH = PLAN_PATH + '.bak';

function between(html, re) {
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

/** Parses the legacy `<script>` block's hand-typed INDULGE / bespoke
 * per-key warning rules (var INDULGE={...}, `if(X.key>0){...'🍺...'}`,
 * `if(X.key>0) v.push(['warn','🍢...`) and the XN short-name map. */
function parseScript(html) {
  const indulgeKeys = [];
  // legacy declares this as `var exK=0, INDULGE={...}` (comma-joined var
  // declaration inside recalc()), not a standalone `var INDULGE = {...}`.
  const indulgeMatch = html.match(/\bINDULGE\s*=\s*\{([^}]*)\}/);
  if (indulgeMatch) {
    for (const m of indulgeMatch[1].matchAll(/(\w+)\s*:\s*1/g)) indulgeKeys.push(m[1]);
  }

  const alcoholKeys = [];
  for (const m of html.matchAll(/if\(X\.(\w+)>0\)\{var ak=X\.\1\*EXTRAS\.\1\.k;v\.push\(\['warn','🍺/g)) {
    alcoholKeys.push(m[1]);
  }

  const mealReplaceKeys = [];
  for (const m of html.matchAll(/if\(X\.(\w+)>0\)\s*v\.push\(\['warn','🍢/g)) {
    mealReplaceKeys.push(m[1]);
  }

  const copyNames = {};
  const xnMatch = html.match(/var XN\s*=\s*\{([\s\S]*?)\};/);
  if (xnMatch) {
    for (const m of xnMatch[1].matchAll(/(\w+)\s*:\s*'((?:[^'\\]|\\.)*)'/g)) {
      copyNames[m[1]] = m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    }
  }

  return { indulgeKeys, alcoholKeys, mealReplaceKeys, copyNames };
}

function parsePageCopy(html) {
  const title = between(html, /<title>([\s\S]*?)<\/title>/);
  const kicker = between(html, /<div class="kicker">([\s\S]*?)<\/div>/);
  const h1 = between(html, /<h1>([\s\S]*?)<\/h1>/);
  const sub = between(html, /<p class="sub">([\s\S]*?)<\/p>/);
  const footerHtml = between(html, /<footer>([\s\S]*?)<\/footer>/);

  const diaFootnote = between(
    html,
    /<!-- GEN:DAYPLAN END -->\s*<p class="acc-note"[^>]*>([\s\S]*?)<\/p>/,
  );
  const registroIntro = between(
    html,
    /<div class="tab-panel" data-tab="registro"[^>]*>[\s\S]*?<p class="acc-note"[^>]*>([\s\S]*?)<\/p>\s*<div class="builder">/,
  );

  const notes = {};
  if (diaFootnote) notes['dia.footnote'] = diaFootnote;
  if (registroIntro) notes['registro.intro'] = registroIntro;

  return { title, kicker, h1, sub, footerHtml, notes };
}

/** Pure migration step: (plan, legacy html) -> { plan: migratedPlan, changed }.
 * Never touches the filesystem — see main() below for the CLI's file IO. */
export function migrate({ plan, html }) {
  if (plan.page) return { plan, changed: false };

  const next = structuredClone(plan);
  next.locale = 'es';
  next.page = parsePageCopy(html);

  const { indulgeKeys, alcoholKeys, mealReplaceKeys, copyNames } = parseScript(html);
  next.indulgeKeys = indulgeKeys;
  next.alcoholKeys = alcoholKeys;
  next.mealReplaceKeys = mealReplaceKeys;

  for (const group of next.extrasDisplay || []) {
    for (const item of group.items || []) {
      const legacyName = copyNames[item.key];
      if (legacyName != null && legacyName !== item.name) item.copyName = legacyName;
    }
  }

  return { plan: next, changed: true };
}

function main() {
  if (!fs.existsSync(PLAN_PATH)) {
    console.error(`migrate-plan-data: ${path.relative(ROOT, PLAN_PATH)} not found — nothing to migrate (fresh clone / example-only setup).`);
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(HTML_PATH)) {
    console.error(`migrate-plan-data: ${path.relative(ROOT, HTML_PATH)} not found — run \`npm run generate\` at least once first so there is a legacy page to migrate copy from.`);
    process.exitCode = 1;
    return;
  }

  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const { plan: migrated, changed } = migrate({ plan, html });

  if (!changed) {
    console.log('migrate-plan-data: already migrated (plan.page present) — no-op.');
    return;
  }

  fs.copyFileSync(PLAN_PATH, BACKUP_PATH);
  fs.writeFileSync(PLAN_PATH, JSON.stringify(migrated, null, 2) + '\n');
  console.log(`migrate-plan-data: wrote plan.locale/page/indulgeKeys/alcoholKeys/mealReplaceKeys + extrasDisplay copyName's into ${path.relative(ROOT, PLAN_PATH)} (backup at ${path.relative(ROOT, BACKUP_PATH)}).`);
  console.log(`  page.title=${JSON.stringify(migrated.page.title)}`);
  console.log(`  indulgeKeys=${JSON.stringify(migrated.indulgeKeys)}`);
  console.log(`  alcoholKeys=${JSON.stringify(migrated.alcoholKeys)}`);
  console.log(`  mealReplaceKeys=${JSON.stringify(migrated.mealReplaceKeys)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
