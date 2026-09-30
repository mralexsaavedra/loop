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

/* Four-tab layout, one question each (Whoop-style): Inicio = today, Entreno = training, Salud =
 * body & recovery, Nutrición = food. TAB_KEYS is the nav order. SECTION_TAB maps every section key
 * to its tab: the former top-level tab keys (hoy/dash/dia/registro/tablas) now name SECTIONS, and
 * Entreno's other blocks are sections too (load = the per-modality load cards + caveats, calendar =
 * the 30-day calendar + cumulative time, sessions = running / cycling / load vs recovery), so
 * Entreno, like Nutrición, is made ONLY of sections. It is the ONE copy: the page bakes it for
 * core.js (setTab of a section key) and derives each tab's section list from it.
 * `page.hideTabs` stays backward compatible: a section key hides its section, a top-level key
 * hides the tab. */
export const TAB_KEYS = Object.freeze(['home', 'entreno', 'health', 'nutricion']);
export const SECTION_TAB = Object.freeze({
  hoy: 'home',
  load: 'entreno', calendar: 'entreno', sessions: 'entreno', dash: 'entreno',
  dia: 'nutricion', registro: 'nutricion', tablas: 'nutricion',
});

/** The section keys hosted by `tab`, in SECTION_TAB order. */
export function sectionsOf(tab) {
  return Object.keys(SECTION_TAB).filter((key) => SECTION_TAB[key] === tab);
}

/** The global train/rest toggle drives Mi día's day panels and Registro's post-workout label only
 * (Tablas shows both day types side by side), so it is off when Nutrición is hidden or when both
 * of those sections are. */
export function showDayToggle(hideTabs) {
  const hidden = new Set(hideTabs || []);
  if (hidden.has('nutricion')) return false;
  return !(hidden.has('dia') && hidden.has('registro'));
}

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
