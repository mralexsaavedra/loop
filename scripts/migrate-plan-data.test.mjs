/* Unit tests for scripts/migrate-plan-data.mjs's pure `migrate()` — the
 * one-shot slice-3 migration that lifts personal copy (title/kicker/h1/sub/
 * footer/notes) and indulge-warning key lists OUT of the hand-maintained
 * legacy plan-web.html `<script>` block and INTO plan-data.json, so the
 * Astro client scripts (slice 3+) can read them instead of hardcoding
 * personal strings (which the tracked scripts/migrate-plan-data.mjs itself
 * must never contain — see web/test/leak.test.mjs).
 *
 * These use a small fixture HTML that mirrors the REAL legacy structure
 * (same tag/class/id shapes as data/nutrition/plan-web.template.html) but
 * with fully generic, non-personal fixture copy — not the owner's real
 * plan-web.html. The CLI's file IO (backup + real personal file) is
 * exercised separately, once, against the real files (not from this test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate, migrateNotes, writeWithBackup } from './migrate-plan-data.mjs';

function fixtureHtml() {
  // The <style> block's desktop media query legitimately contains the bare
  // substring `data-tab="registro"` (a CSS attribute selector) BEFORE the
  // real registro panel in the document — a regex anchored on that bare
  // substring instead of the actual `<div class="tab-panel" data-tab=...`
  // element would wrongly match this CSS text first. Kept in the fixture
  // to guard against that regression.
  return `<title>Sample Plan</title>
<style>
  @media (min-width:900px){
    .tab-panel[data-tab="registro"] .builder{display:grid}
  }
</style>
<div class="wrap">
  <header>
    <div class="kicker">Cut · Sample</div>
    <h1>Sample Panel</h1>
    <p class="sub">Sample sub copy for the fixture.</p>
  </header>
  <div class="tab-panel" data-tab="dia">
  <!-- GEN:DAYPLAN START -->
  <div class="day-panel" data-day="train"></div>
  <!-- GEN:DAYPLAN END -->
  <p class="acc-note" style="border-top:1px solid var(--line);padding-top:14px;margin-top:18px">Dia footnote fixture text.</p>
  </div>
  <div class="tab-panel" data-tab="registro" hidden>
  <h2>Food log</h2>
  <p class="acc-note" style="margin:-4px 0 10px">Registro intro fixture text.</p>
  <div class="builder">
    <!-- an extrasDisplay group's own combo-h + optional headerNote <p class="acc-note">
         immediately after it — same shape as the real off-plan block. A regex not
         anchored past GEN:EXTRAS END would wrongly match THIS pair first and, being
         non-greedy only up to the single <textarea id="bld-notes"> in the document,
         swallow everything in between as the "note". Kept to guard that regression. -->
    <div class="combo-h">Coffee</div>
    <p class="acc-note" style="margin:-2px 0 6px">Extras group header-note fixture text (NOT the off-plan note).</p>
    <div class="extras"></div>
    <!-- GEN:EXTRAS END -->
    <div class="combo-h">Off plan / notes</div>
    <p class="acc-note" style="margin:-2px 0 6px">Off-plan fixture note text.</p>
    <textarea id="bld-notes" placeholder="Off-plan fixture placeholder text."></textarea>
  </div>
  </div>
  <div class="tab-panel" data-tab="tablas" hidden>
  <h2>Equivalences</h2>
  <details id="acc-desayunos">
    <summary>☕ Breakfasts <span class="chev">›</span></summary>
    <div class="acc-body">
      <p class="acc-note">Desayunos fixture note text.</p>
    </div>
  </details>
  <details id="acc-proteina">
    <summary>🥩 Protein <span class="chev">›</span></summary>
    <div class="acc-body">
      <p class="acc-note">Proteina fixture note text.</p>
    </div>
  </details>
  <details id="acc-legumbres">
    <summary>🫘 Legumes <span class="chev">›</span></summary>
    <div class="acc-body">
      <p class="acc-note">Legumbres fixture note text.</p>
      <div class="table-scroll"><table><tbody><tr><td>Fixture legume</td></tr></tbody></table></div>
    </div>
  </details>
  <details id="acc-postre">
    <summary>🍨 Dessert <span class="chev">›</span></summary>
    <div class="acc-body">
      <p class="acc-note">Postre fixture note text.</p>
      <div class="table-scroll"><table>
        <tbody id="tb-postre"></tbody>
      </table></div>
      <p class="acc-note" style="margin-top:10px">Postre extra fixture note text.</p>
    </div>
  </details>
  <details id="acc-sopas">
    <summary>🍜 Soups <span class="chev">›</span></summary>
    <div class="acc-body">
      <p class="acc-note">Sopas fixture note text.</p>
      <div class="table-scroll"><table><tbody><tr><td>Fixture soup</td></tr></tbody></table></div>
    </div>
  </details>
  <details id="acc-quesos">
    <summary>🧀 Cheeses &amp; sauces <span class="chev">›</span></summary>
    <div class="acc-body">
      <p class="acc-note">Quesos fixture note text.</p>
    </div>
  </details>
  <h2>Supplements</h2>
  <div class="meal" style="padding:6px 16px">
    <div class="supp"><span class="when">Lunch</span><div class="what">Fixture supplement<small>fixture dose</small></div></div>
  </div>
  <h2>How to use it</h2>
  <div class="tip">Fixture tip text.</div>
  </div>
  <footer>
    Fixture footer line one.<br><br>
    Fixture footer line two.
  </footer>
</div>
<script>
  var EXTRAS = { cafe:{k:1}, beer:{k:118}, pintxo:{k:200}, chocolate:{k:48} };
  var XN={cafe:'coffee with milk',beer:'Beer',pintxo:'pintxo',chocolate:'chocolate'};
  function recalc(){
    var exK=0, INDULGE={beer:1,pintxo:1,chocolate:1};
    if(X.beer>0){var ak=X.beer*EXTRAS.beer.k;v.push(['warn','🍺 fixture beer warning']);}
    if(X.pintxo>0) v.push(['warn','🍢 fixture pintxo warning']);
  }
</script>`;
}

function fixturePlan() {
  return {
    extrasDisplay: [
      {
        header: 'Coffee',
        items: [
          { key: 'cafe', emoji: '☕', name: 'Coffee with milk', qty: '145 ml' },
          { key: 'newkey', emoji: '💨', name: 'New key with no legacy XN entry', qty: '1 g' },
        ],
      },
      {
        header: 'Treats',
        items: [
          { key: 'beer', emoji: '🍺', name: 'Beer', qty: '1 bottle' },
          { key: 'pintxo', emoji: '🍢', name: 'Pintxo', qty: '1' },
          { key: 'chocolate', emoji: '🍫', name: 'Chocolate', qty: '1 square' },
        ],
      },
    ],
  };
}

test('migrate() extracts page copy (title/kicker/h1/sub/footerHtml/notes) from the legacy HTML', () => {
  const { plan } = migrate({ plan: fixturePlan(), html: fixtureHtml() });
  assert.equal(plan.page.title, 'Sample Plan');
  assert.equal(plan.page.kicker, 'Cut · Sample');
  assert.equal(plan.page.h1, 'Sample Panel');
  assert.equal(plan.page.sub, 'Sample sub copy for the fixture.');
  assert.match(plan.page.footerHtml, /Fixture footer line one\.<br><br>\s*Fixture footer line two\./);
  assert.equal(plan.page.notes['dia.footnote'], 'Dia footnote fixture text.');
  assert.equal(plan.page.notes['registro.intro'], 'Registro intro fixture text.');
});

test('migrate() sets locale to es', () => {
  const { plan } = migrate({ plan: fixturePlan(), html: fixtureHtml() });
  assert.equal(plan.locale, 'es');
});

test('migrate() derives indulgeKeys from the legacy INDULGE object and alcohol/mealReplace keys from the bespoke warning rules', () => {
  const { plan } = migrate({ plan: fixturePlan(), html: fixtureHtml() });
  assert.deepEqual(plan.indulgeKeys.slice().sort(), ['beer', 'chocolate', 'pintxo']);
  assert.deepEqual(plan.alcoholKeys, ['beer']);
  assert.deepEqual(plan.mealReplaceKeys, ['pintxo']);
});

test('migrate() sets copyName on extrasDisplay items from the legacy XN map, only when it differs from name, and leaves keys with no legacy XN entry untouched', () => {
  const { plan } = migrate({ plan: fixturePlan(), html: fixtureHtml() });
  const cafe = plan.extrasDisplay[0].items.find((i) => i.key === 'cafe');
  const beer = plan.extrasDisplay[1].items.find((i) => i.key === 'beer');
  const newkey = plan.extrasDisplay[0].items.find((i) => i.key === 'newkey');
  assert.equal(cafe.copyName, 'coffee with milk', 'differs from item.name ("Coffee with milk") -> copyName applied');
  assert.equal(beer.copyName, undefined, 'legacy XN.beer ("Beer") === item.name -> no redundant copyName');
  assert.equal(newkey.copyName, undefined, 'no legacy XN entry -> untouched, falls back to name at read time');
});

test('migrate() is idempotent: running twice does not change an already-migrated plan', () => {
  const once = migrate({ plan: fixturePlan(), html: fixtureHtml() });
  assert.equal(once.changed, true);
  const twice = migrate({ plan: once.plan, html: fixtureHtml() });
  assert.equal(twice.changed, false, 'already has plan.page -> no-op');
  assert.deepEqual(twice.plan, once.plan);
});

// ---- astro-plan-web slice 4 follow-up: migrateNotes() lifts the Registro
// off-plan note/placeholder (left hardcoded in tracked i18n dicts by slice
// 3) and the Tablas tab's per-accordion notes + opaque Legumes/Soups/
// Supplements blocks (no structured plan-data source yet) into
// plan.page.notes / plan.page.offPlanPlaceholder. Independently idempotent
// PER FIELD — unlike migrate()'s all-or-nothing `plan.page` short-circuit,
// so it can run again on an already-migrated plan (real usage: the owner's
// plan-data.json already has plan.page from slice 3) without disturbing
// fields slice 3 already wrote.
test('migrateNotes() extracts the Registro off-plan note + placeholder', () => {
  const { plan, changed } = migrateNotes({ plan: fixturePlan(), html: fixtureHtml() });
  assert.equal(changed, true);
  assert.equal(plan.page.notes['registro.offPlan'], 'Off-plan fixture note text.');
  assert.equal(plan.page.offPlanPlaceholder, 'Off-plan fixture placeholder text.');
});

test('migrateNotes() extracts per-accordion Tablas notes by details id', () => {
  const { plan } = migrateNotes({ plan: fixturePlan(), html: fixtureHtml() });
  assert.equal(plan.page.notes['tablas.desayunos'], 'Desayunos fixture note text.');
  assert.equal(plan.page.notes['tablas.proteina'], 'Proteina fixture note text.');
  assert.equal(plan.page.notes['tablas.quesos'], 'Quesos fixture note text.');
});

test('migrateNotes() extracts the optional postre extra note (present only for accordions that have one)', () => {
  const { plan } = migrateNotes({ plan: fixturePlan(), html: fixtureHtml() });
  assert.equal(plan.page.notes['tablas.postre'], 'Postre fixture note text.');
  assert.equal(plan.page.notes['tablas.postreExtra'], 'Postre extra fixture note text.');
});

test('migrateNotes() extracts whole opaque Legumes/Soups <details> blocks verbatim (no structured plan-data source yet)', () => {
  const { plan } = migrateNotes({ plan: fixturePlan(), html: fixtureHtml() });
  assert.match(plan.page.notes['tablas.legumbresDetailsHtml'], /^<details id="acc-legumbres">[\s\S]*<\/details>$/);
  assert.match(plan.page.notes['tablas.legumbresDetailsHtml'], /Fixture legume/);
  assert.match(plan.page.notes['tablas.sopasDetailsHtml'], /^<details id="acc-sopas">[\s\S]*<\/details>$/);
  assert.match(plan.page.notes['tablas.sopasDetailsHtml'], /Fixture soup/);
});

test('migrateNotes() extracts the Supplements block between its heading and "How to use it"', () => {
  const { plan } = migrateNotes({ plan: fixturePlan(), html: fixtureHtml() });
  assert.match(plan.page.notes['tablas.supplements'], /^<div class="meal" style="padding:6px 16px">[\s\S]*<\/div>$/);
  assert.match(plan.page.notes['tablas.supplements'], /Fixture supplement/);
  assert.doesNotMatch(plan.page.notes['tablas.supplements'], /How to use it/, 'must not swallow the next heading');
});

test('migrateNotes() is idempotent per-field: a second run does not overwrite fields already present, and reports changed:false when nothing new is found', () => {
  const once = migrateNotes({ plan: fixturePlan(), html: fixtureHtml() });
  assert.equal(once.changed, true);
  const twice = migrateNotes({ plan: once.plan, html: fixtureHtml() });
  assert.equal(twice.changed, false, 'every field once() found is already present -> no-op');
  assert.deepEqual(twice.plan, once.plan);
});

test('migrateNotes() is safe to run on a plan already migrated by migrate() (real-world order: migrate() then migrateNotes())', () => {
  const { plan: afterMigrate } = migrate({ plan: fixturePlan(), html: fixtureHtml() });
  const { plan: afterNotes, changed } = migrateNotes({ plan: afterMigrate, html: fixtureHtml() });
  assert.equal(changed, true);
  assert.equal(afterNotes.page.title, 'Sample Plan', 'migrate()\'s own fields are preserved');
  assert.equal(afterNotes.page.notes['dia.footnote'], 'Dia footnote fixture text.', 'migrate()\'s own notes are preserved');
  assert.equal(afterNotes.page.notes['registro.offPlan'], 'Off-plan fixture note text.');
});

test('migrateNotes() degrades gracefully when an accordion/section is absent from the html (e.g. a plan without Legumes/Soups)', () => {
  const { plan } = migrateNotes({ plan: fixturePlan(), html: fixtureHtml() });
  assert.equal(plan.page.notes['tablas.carboComida'], undefined, 'fixture has no acc-carbo-comida -> not set, not a throw');
});

// ---- writeWithBackup(): the CLI's file-IO contract. A real run of this
// script had NOT actually left a `plan-data.json.bak` behind despite the
// script's own log message claiming one was written — this exercises that
// contract directly (against a throwaway tmp dir, never the real repo
// files) instead of leaving it untested, which is how the gap slipped
// through originally.
function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-plan-data-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('writeWithBackup() backs up the file to <file>.bak BEFORE writing new content', () => {
  withTmpDir((dir) => {
    const target = path.join(dir, 'plan-data.json');
    const backup = target + '.bak';
    fs.writeFileSync(target, 'ORIGINAL');

    writeWithBackup(target, 'UPDATED');

    assert.ok(fs.existsSync(backup), 'expected a .bak file to exist after writeWithBackup()');
    assert.equal(fs.readFileSync(backup, 'utf8'), 'ORIGINAL', 'the .bak must hold the pre-write content');
    assert.equal(fs.readFileSync(target, 'utf8'), 'UPDATED', 'the target must hold the new content');
  });
});

test('writeWithBackup() never overwrites an existing .bak (preserves the TRUE original across repeated runs)', () => {
  withTmpDir((dir) => {
    const target = path.join(dir, 'plan-data.json');
    const backup = target + '.bak';
    fs.writeFileSync(target, 'TRUE_ORIGINAL');
    fs.writeFileSync(backup, 'TRUE_ORIGINAL'); // simulates a .bak already written by a prior run

    writeWithBackup(target, 'SECOND_UPDATE');
    writeWithBackup(target, 'THIRD_UPDATE');

    assert.equal(fs.readFileSync(backup, 'utf8'), 'TRUE_ORIGINAL', 'a pre-existing .bak must never be overwritten, even across multiple later runs');
    assert.equal(fs.readFileSync(target, 'utf8'), 'THIRD_UPDATE');
  });
});

test('writeWithBackup() writes the target atomically (temp file + rename, no partial writes left behind)', () => {
  withTmpDir((dir) => {
    const target = path.join(dir, 'plan-data.json');
    fs.writeFileSync(target, 'ORIGINAL');

    writeWithBackup(target, 'UPDATED');

    const leftovers = fs.readdirSync(dir).filter((f) => f !== 'plan-data.json' && f !== 'plan-data.json.bak');
    assert.deepEqual(leftovers, [], `expected no leftover temp files, found: ${leftovers.join(', ')}`);
    assert.equal(fs.readFileSync(target, 'utf8'), 'UPDATED');
  });
});

test('writeWithBackup() skips the backup step (nothing to back up) when the target file does not exist yet', () => {
  withTmpDir((dir) => {
    const target = path.join(dir, 'plan-data.json');
    const backup = target + '.bak';

    writeWithBackup(target, 'FIRST_WRITE');

    assert.equal(fs.existsSync(backup), false, 'no prior file existed — there is nothing meaningful to back up');
    assert.equal(fs.readFileSync(target, 'utf8'), 'FIRST_WRITE');
  });
});
