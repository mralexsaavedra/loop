/* Shared client-side nav/utility functions used by generated markup's
 * inline `onclick="..."` handlers across all tabs.
 *
 * This is a CLASSIC script (Astro emits it via is:inline set:html — never a
 * module-typed script tag, per spec: Single self-contained output). Classic
 * scripts have no module scope, so functions declared here are already
 * global; attaching them to `window` explicitly documents the public
 * contract inline markup depends on and survives any future
 * minification/bundling that would otherwise hide them.
 */
function setTab(name) {
  document.querySelectorAll('[data-tab-panel]').forEach((el) => {
    el.classList.toggle('active', el.dataset.tabPanel === name);
  });
  document.querySelectorAll('[data-tab-btn]').forEach((el) => {
    el.classList.toggle('active', el.dataset.tabBtn === name);
  });
}

function setDay(day) {
  document.querySelectorAll('[data-day-panel]').forEach((el) => {
    el.classList.toggle('active', el.dataset.dayPanel === day);
  });
  document.querySelectorAll('[data-day-btn]').forEach((el) => {
    el.classList.toggle('active', el.dataset.dayBtn === day);
  });
}

function jump(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bump(id, delta) {
  const el = document.getElementById(id);
  if (!el) return;
  const next = Math.max(0, Number(el.textContent || 0) + delta);
  el.textContent = String(next);
}

window.setTab = setTab;
window.setDay = setDay;
window.jump = jump;
window.bump = bump;
