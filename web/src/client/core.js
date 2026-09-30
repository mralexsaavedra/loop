/* Shared client-side nav/utility functions used by generated markup's
 * inline `onclick="..."` handlers across all tabs.
 *
 * This is a CLASSIC script (Astro emits it via is:inline set:html — never a
 * module-typed script tag, per spec: Single self-contained output). Classic
 * scripts have no module scope, so functions declared here are already
 * global; attaching them to `window` explicitly documents the public
 * contract inline markup depends on and survives any future
 * minification/bundling that would otherwise hide them.
 *
 * Ported VERBATIM (same DOM contract) from the legacy hand-maintained
 * `<script>` block of the pre-Astro generated page (deleted at the
 * astro-plan-web cutover) — ids (t-dia/...),
 * `.tab-panel[data-tab]` classes, and
 * `onclick="setTab(...)"` / `onclick="jump(...)"` / `onclick="bump(key,
 * delta)"` markup — NOT slice 1's invented `data-tab-btn`/`data-tab-panel`
 * attribute scheme. Parity with the legacy behavior (id sets + onclick
 * sets) was verified throughout the migration by a since-retired parity
 * test suite; web/src/client/core.test.mjs now covers this contract.
 *
 * `bump` deviates from legacy in ONE way: legacy's `bump` is defined
 * inline inside the day-builder IIFE, closing directly over its own `X`
 * state object and calling its own `recalc()`. Here the day-builder logic
 * lives in a separate script (client/nutrition.js, slice 3) with its own
 * module boundary, so `bump` reads/writes the counter straight from the DOM
 * (the single source of truth for the displayed count) and calls an
 * optional `window.bldRecalc()` hook — the same optional-global-hook
 * pattern nutri-day.js uses for `window.bldRefresh` / `window.intakeRefresh`.
 */
/* Four top-level tabs (Inicio / Entreno / Salud / Nutrición), nav buttons `#t-<key>`. The former
 * tab keys now name sections (`#sec-<key>`) inside one of them, so an old `setTab('tablas')` still
 * lands on the same content. Both lists come from NAV, baked by layouts/Plan.astro from
 * lib/nav/tabs.mjs (TAB_KEYS / SECTION_TAB) — the one copy, never repeated here. */
var NAV_TABS = (typeof NAV !== 'undefined' && NAV && NAV.tabs) || [];
var SECTION_TAB = (typeof NAV !== 'undefined' && NAV && NAV.sectionTab) || {};

function setTab(name, scrollTop) {
  if (SECTION_TAB[name]) {
    jump('sec-' + name);
    return;
  }
  document.querySelectorAll('.tab-panel').forEach(function (p) {
    p.hidden = p.getAttribute('data-tab') !== name;
  });
  NAV_TABS.forEach(function (key) {
    var b = document.getElementById('t-' + key);
    if (b) b.setAttribute('aria-pressed', key === name);
  });
  if (scrollTop !== false) window.scrollTo({ top: 0, behavior: 'auto' });
}

function jump(id) {
  var el = document.getElementById(id);
  if (!el) return;
  // a section hidden by page.hideTabs stays unreachable
  var section = el.closest && el.closest('.tab-section');
  if (section && section.hidden) return;
  var panel = el.closest && el.closest('.tab-panel');
  if (panel) setTab(panel.getAttribute('data-tab'), false);
  el.open = true;
  // open every enclosing <details> (e.g. a table inside the collapsed Tablas fold)
  var up = el.parentElement;
  while (up && up.closest) {
    up = up.closest('details');
    if (!up) break;
    up.open = true;
    up = up.parentElement;
  }
  setTimeout(function () {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 30);
}

/** jump(id) when the target exists and is not in a hidden section; otherwise open `tab`. Used by
 * Inicio's score cards to land on their Salud detail even when that detail has no data yet. */
function jumpOr(id, tab) {
  var el = document.getElementById(id);
  var section = el && el.closest && el.closest('.tab-section');
  if (el && !(section && section.hidden)) jump(id);
  else setTab(tab);
}

function bump(key, delta) {
  var el = document.getElementById('x-' + key);
  if (!el) return;
  var next = Math.max(0, Number(el.textContent || 0) + delta);
  el.textContent = String(next);
  if (typeof window.bldRecalc === 'function') window.bldRecalc();
}

window.setTab = setTab;
window.jump = jump;
window.jumpOr = jumpOr;
window.bump = bump;
