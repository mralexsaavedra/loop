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
 * `onclick="setTab(...)"` / `onclick="jump(...)"` markup — NOT slice 1's
 * invented `data-tab-btn`/`data-tab-panel` attribute scheme. Parity with the
 * legacy behavior (id sets + onclick sets) was verified throughout the
 * migration by a since-retired parity test suite; web/src/client/core.test.mjs
 * now covers this contract. (The legacy `bump` stepper helper went away with
 * the day builder.)
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

/* Midnight rollover (HC.rolloverAction): the page captures the viewer's day at load; when it becomes
 * visible on another day it reloads once, so every view computed at load (dials, top-bar date,
 * timeline, day type, rings) moves to the new day. While the detail sheet (#detail) is open the reload
 * waits for it to close (polled each second) or for the next visibility change with it closed.
 * food.js's own visibilitychange listener still re-reads today's log: when the page reloads that read
 * is simply dropped, and while a reload is deferred it keeps Registrar on the new day. */
(function () {
  if (typeof HC === 'undefined' || !HC.rolloverAction || typeof document.addEventListener !== 'function') return;
  var loadDay = HC.todayIso();
  var watch = null;
  var done = false;
  function sheetOpen() {
    var d = document.getElementById('detail');
    return !!(d && !d.hidden);
  }
  function check() {
    if (done) return;
    var action = HC.rolloverAction(loadDay, HC.todayIso(), sheetOpen(), !!document.hidden);
    if (action === 'reload') {
      done = true;
      if (watch != null) clearInterval(watch);
      watch = null;
      window.location.reload();
    } else if (action === 'defer' && watch == null) {
      watch = setInterval(check, 1000);
    }
  }
  document.addEventListener('visibilitychange', check);
  // a page restored from the back-forward cache
  if (typeof window.addEventListener === 'function') window.addEventListener('pageshow', check);
})();

window.setTab = setTab;
window.jump = jump;
window.jumpOr = jumpOr;
