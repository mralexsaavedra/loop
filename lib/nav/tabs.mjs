/* Pure nav-tab filtering — the data-driven replacement for the legacy
 * pattern of hand-commenting a nav <button> out of the pre-Astro generated
 * page (deleted at the astro-plan-web cutover) — astro-plan-web migration,
 * slice 5. See CLAUDE.md's "Hoy tab is optional and
 * source-agnostic": hiding a tab only removes its nav button — the
 * tab-panel, its baked globals and its client script always stay in the
 * build (harmless/unreachable, matching the legacy "uncomment to
 * reactivate" contract). Driven by `plan.page.hideTabs`, an array of tab
 * keys (e.g. `["hoy"]`).
 */
export function filterTabs(tabs, hideTabs) {
  const hidden = new Set(hideTabs || []);
  return tabs.filter((tab) => !hidden.has(tab.key));
}

/** Key of the tab that must be visible on load: the FIRST of the already-filtered list, so a
 * hidden first tab hands over to the next one and no panel is ever visible without a nav
 * button. Throws when nothing is left (every tab hidden). */
export function activeTabKey(tabs) {
  if (!tabs || !tabs.length) {
    throw new Error('activeTabKey: every tab is hidden (page.hideTabs removes them all) - at least one tab must stay visible.');
  }
  return tabs[0].key;
}
