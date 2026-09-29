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

/** Extracts the first `<p class="acc-note"...>...</p>` inside `<details
 * id="detailsId">...</details>` — the per-accordion coaching note in the
 * Tablas tab. Non-greedy up to the FIRST acc-note, which is always the
 * accordion's own intro note (a details element's body has at most one
 * such note before any table). */
function noteInDetails(html, detailsId) {
  return between(html, new RegExp(`<details id="${detailsId}"[\\s\\S]*?<p class="acc-note"[^>]*>([\\s\\S]*?)</p>`));
}

/** Extracts a whole `<details id="detailsId">...</details>` block verbatim.
 * Used for accordions with NO structured plan-data source yet (Legumes,
 * Soups) — kept as opaque personal HTML instead of inventing a new schema
 * field for a single-slice's worth of content (see design's Personal copy
 * pattern: `page.notes[id]`, just a bigger blob than usual here). Safe as a
 * non-greedy match up to the first `</details>` since these accordions do
 * not nest another `<details>` inside. */
function detailsBlock(html, detailsId) {
  return between(html, new RegExp(`(<details id="${detailsId}">[\\s\\S]*?</details>)`));
}

/** Extracts the Postre/Dessert accordion's OPTIONAL second note (a personal-
 * only breakdown line after the table — no template equivalent). Anchored
 * on the accordion's own `tb-postre` table close so it never accidentally
 * grabs a later accordion's note. */
function postreExtraNote(html) {
  return between(
    html,
    /<details id="acc-postre">[\s\S]*?<tbody id="tb-postre">\s*<\/tbody>\s*<\/table><\/div>\s*<p class="acc-note"[^>]*>([\s\S]*?)<\/p>\s*<\/div>\s*<\/details>/,
  );
}

/** Extracts Registro's "off plan / notes" note — anchored on the
 * `GEN:EXTRAS END` marker (unique, always immediately precedes the off-plan
 * block) rather than on the heading's own text (differs between the es
 * personal page, "Fuera de plan / notas", and the en template, "Off plan /
 * notes") or on a bare "next combo-h" search: several extrasDisplay groups
 * ALSO render a `<div class="combo-h">` immediately followed by a
 * `<p class="acc-note">` (a group's optional `headerNote`) — a regex not
 * anchored past GEN:EXTRAS END would match one of those first and, being
 * non-greedy only up to the single `<textarea id="bld-notes">` anchor in
 * the whole document, swallow everything in between. */
function offPlanNote(html) {
  return between(html, /<!-- GEN:EXTRAS END -->\s*<div class="combo-h">[^<]*<\/div>\s*<p class="acc-note"[^>]*>([\s\S]*?)<\/p>\s*<textarea id="bld-notes"/);
}

/** Extracts the off-plan textarea's `placeholder` attribute value. */
function offPlanPlaceholder(html) {
  return between(html, /<textarea id="bld-notes" placeholder="([\s\S]*?)"><\/textarea>/);
}

/** Extracts the Supplements section's inner HTML, anchored between its own
 * heading and the NEXT heading ("How to use it" / "Cómo usarlo") — both are
 * unique per document, so this anchor is robust even though the div itself
 * contains nested `.supp` divs (a bare non-greedy `</div>` match would stop
 * at the FIRST nested close, not the div's own outer close). */
function supplementsHtml(html) {
  return between(html, /<h2>(?:Suplementaci[oó]n|Supplements)<\/h2>\s*([\s\S]*?)\s*<h2>(?:C[oó]mo usarlo|How to use it)<\/h2>/);
}

const NOTE_SLOTS = [
  ['registro.offPlan', offPlanNote],
  ['tablas.desayunos', (h) => noteInDetails(h, 'acc-desayunos')],
  ['tablas.carboComida', (h) => noteInDetails(h, 'acc-carbo-comida')],
  ['tablas.carboCena', (h) => noteInDetails(h, 'acc-carbo-cena')],
  ['tablas.proteina', (h) => noteInDetails(h, 'acc-proteina')],
  ['tablas.anclaje', (h) => noteInDetails(h, 'acc-anclaje')],
  ['tablas.postentreno', (h) => noteInDetails(h, 'acc-postentreno')],
  ['tablas.fruta', (h) => noteInDetails(h, 'acc-fruta')],
  ['tablas.postre', (h) => noteInDetails(h, 'acc-postre')],
  ['tablas.postreExtra', postreExtraNote],
  ['tablas.verduras', (h) => noteInDetails(h, 'acc-verduras')],
  ['tablas.quesos', (h) => noteInDetails(h, 'acc-quesos')],
  ['tablas.legumbresDetailsHtml', (h) => detailsBlock(h, 'acc-legumbres')],
  ['tablas.sopasDetailsHtml', (h) => detailsBlock(h, 'acc-sopas')],
  ['tablas.supplements', supplementsHtml],
];

/** Slice-4 follow-up migration: lifts additional personal copy that slice 3
 * left hardcoded in tracked i18n dicts (Registro's off-plan note/
 * placeholder) or that has no structured plan-data source yet (Tablas' per-
 * accordion notes, the opaque Legumes/Soups accordions, the Supplements
 * block) into `plan.page.notes` / `plan.page.offPlanPlaceholder`.
 *
 * Independently idempotent PER FIELD — unlike `migrate()`'s all-or-nothing
 * `plan.page` short-circuit — so it is safe to run again on an
 * already-migrated plan (real usage: the owner's plan-data.json already
 * has `plan.page` from slice 3) without disturbing fields slice 3 already
 * wrote, and safe to extend with more slots in a future slice. */
export function migrateNotes({ plan, html }) {
  const next = structuredClone(plan);
  next.page = next.page || {};
  next.page.notes = next.page.notes || {};
  let changed = false;

  for (const [id, extract] of NOTE_SLOTS) {
    if (next.page.notes[id] != null) continue;
    const value = extract(html);
    if (value != null) {
      next.page.notes[id] = value;
      changed = true;
    }
  }

  if (next.page.offPlanPlaceholder == null) {
    const placeholder = offPlanPlaceholder(html);
    if (placeholder != null) {
      next.page.offPlanPlaceholder = placeholder;
      changed = true;
    }
  }

  return { plan: next, changed };
}

/** Writes `content` to `filePath`, backing up the file's CURRENT contents
 * to `<filePath>.bak` first — but only if no `.bak` already exists, so a
 * later run of this idempotent script never clobbers the TRUE original
 * with an already-migrated intermediate state. Writes the target
 * atomically (temp file in the same directory + rename) so a crash or
 * interruption mid-write can never leave `filePath` truncated or
 * corrupted. No-op backup step (nothing to back up yet) if `filePath`
 * does not exist. */
export function writeWithBackup(filePath, content) {
  const backupPath = filePath + '.bak';
  if (fs.existsSync(filePath) && !fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
  }
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
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
  const { plan: afterMigrate, changed: changed1 } = migrate({ plan, html });
  const { plan: migrated, changed: changed2 } = migrateNotes({ plan: afterMigrate, html });

  if (!changed1 && !changed2) {
    console.log('migrate-plan-data: already migrated (plan.page + all known note slots present) — no-op.');
    return;
  }

  writeWithBackup(PLAN_PATH, JSON.stringify(migrated, null, 2) + '\n');
  const backupNote = fs.existsSync(BACKUP_PATH)
    ? `backup at ${path.relative(ROOT, BACKUP_PATH)}`
    : 'no backup written (unexpected — please report this)';
  console.log(`migrate-plan-data: wrote plan.locale/page/indulgeKeys/alcoholKeys/mealReplaceKeys + extrasDisplay copyName's + page.notes/offPlanPlaceholder into ${path.relative(ROOT, PLAN_PATH)} (${backupNote}).`);
  console.log(`  page.title=${JSON.stringify(migrated.page.title)}`);
  console.log(`  indulgeKeys=${JSON.stringify(migrated.indulgeKeys)}`);
  console.log(`  alcoholKeys=${JSON.stringify(migrated.alcoholKeys)}`);
  console.log(`  mealReplaceKeys=${JSON.stringify(migrated.mealReplaceKeys)}`);
  console.log(`  page.notes keys=${JSON.stringify(Object.keys(migrated.page.notes))}`);
  console.log(`  page.offPlanPlaceholder=${JSON.stringify(migrated.page.offPlanPlaceholder)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
