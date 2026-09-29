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
 * `<script>` block in data/nutrition/plan-web.template.html — ids
 * (t-dia/b-train/b-rest/...), `.tab-panel[data-tab]` / `.day-panel[data-day]`
 * classes, and `onclick="setTab(...)"` / `onclick="jump(...)"` /
 * `onclick="bump(key,delta)"` markup — NOT slice 1's invented
 * `data-tab-btn`/`data-tab-panel` attribute scheme, so the legacy-vs-Astro
 * parity test (id sets + onclick sets) passes. See design's carried-over
 * IMPORTANT note (slice 1 -> slice 3) and web/test/parity.test.mjs.
 *
 * `bump` deviates from legacy in ONE way: legacy's `bump` is defined
 * inline inside the day-builder IIFE, closing directly over its own `X`
 * state object and calling its own `recalc()`. Here the day-builder logic
 * lives in a separate script (client/nutrition.js, slice 3) with its own
 * module boundary, so `bump` reads/writes the counter straight from the DOM
 * (the single source of truth for the displayed count) and calls an
 * optional `window.bldRecalc()` hook — the same optional-global-hook
 * pattern legacy already uses for `setDay` -> `window.bldRefresh`.
 */
function setTab(name, scrollTop) {
  document.querySelectorAll('.tab-panel').forEach(function (p) {
    p.hidden = p.getAttribute('data-tab') !== name;
  });
  [
    ['t-dia', 'dia'],
    ['t-registro', 'registro'],
    ['t-tablas', 'tablas'],
    ['t-hoy', 'hoy'],
    ['t-dash', 'dash'],
    ['t-health', 'health'],
  ].forEach(function (pair) {
    var b = document.getElementById(pair[0]);
    if (b) b.setAttribute('aria-pressed', pair[1] === name);
  });
  var dt = document.getElementById('day-toggle');
  if (dt) dt.style.display = name === 'dia' || name === 'registro' ? '' : 'none';
  if (scrollTop !== false) window.scrollTo({ top: 0, behavior: 'auto' });
}

function setDay(day) {
  document.querySelectorAll('.day-panel').forEach(function (p) {
    p.hidden = p.getAttribute('data-day') !== day;
  });
  var t = document.getElementById('b-train');
  var r = document.getElementById('b-rest');
  t.setAttribute('aria-pressed', day === 'train');
  r.setAttribute('aria-pressed', day === 'rest');
  if (window.bldRefresh) window.bldRefresh();
}

function jump(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var panel = el.closest && el.closest('.tab-panel');
  if (panel) setTab(panel.getAttribute('data-tab'), false);
  el.open = true;
  setTimeout(function () {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 30);
}

function bump(key, delta) {
  var el = document.getElementById('x-' + key);
  if (!el) return;
  var next = Math.max(0, Number(el.textContent || 0) + delta);
  el.textContent = String(next);
  if (typeof window.bldRecalc === 'function') window.bldRecalc();
}

window.setTab = setTab;
window.setDay = setDay;
window.jump = jump;
window.bump = bump;
