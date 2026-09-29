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

/* Three-tab layout (Inicio / Nutrición / Salud). The former top-level tab keys now name SECTIONS
 * inside one of the three tabs; SECTION_TAB records which. `page.hideTabs` stays backward
 * compatible: a legacy key hides its section, a top-level key hides the tab. */
export const SECTION_TAB = Object.freeze({ hoy: 'home', dia: 'nutricion', registro: 'nutricion', tablas: 'nutricion', dash: 'health' });

/** Resolves `page.hideTabs` against the top-level tab list. A tab may declare `sections` (the
 * section keys it is made of ENTIRELY); such a tab is dropped when all of them are hidden, so a
 * nav button never opens an empty panel. Returns the visible tabs (order kept) and the hidden
 * section keys (SECTION_TAB order). */
export function resolveNav(tabs, hideTabs) {
  const hidden = new Set(hideTabs || []);
  const hiddenSections = Object.keys(SECTION_TAB).filter((key) => hidden.has(key));
  const visible = tabs.filter((tab) => {
    if (hidden.has(tab.key)) return false;
    return !(tab.sections && tab.sections.length && tab.sections.every((s) => hidden.has(s)));
  });
  return { tabs: visible, hiddenSections };
}
