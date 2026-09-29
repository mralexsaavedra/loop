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
import { migrate } from './migrate-plan-data.mjs';

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
  <div class="builder"></div>
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
