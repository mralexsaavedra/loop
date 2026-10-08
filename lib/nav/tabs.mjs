/* Pure nav-tab filtering — the data-driven replacement for the legacy
 * pattern of hand-commenting a nav <button> out of the pre-Astro generated
 * page (deleted at the astro-plan-web cutover) — astro-plan-web migration,
 * slice 5. See docs/training.md's "Hoy tab is optional and
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
 * to its tab: the former top-level tab keys (hoy/dash/dia/tablas) now name SECTIONS, and
 * Entreno's other blocks are sections too (load = the per-modality load summary, calendar = the
 * Activity card, sessions = running / cycling / load vs recovery; dash = intensity (HR)), so
 * Entreno, like Nutrición, is made ONLY of sections. It is the ONE copy: the page bakes it for
 * core.js (setTab of a section key) and derives each tab's section list from it.
 * `page.hideTabs` stays backward compatible: a section key hides its section, a top-level key
 * hides the tab. A DEPRECATED_SECTIONS key names a section that no longer exists (`registro`, the
 * day builder, replaced by the food log, Registrar): it is accepted in `page.hideTabs` (an
 * existing personal plan may carry it) and does nothing. */
export const TAB_KEYS = Object.freeze(['home', 'entreno', 'health', 'nutricion']);
export const SECTION_TAB = Object.freeze({
  hoy: 'home',
  load: 'entreno', calendar: 'entreno', sessions: 'entreno', dash: 'entreno',
  dia: 'nutricion', tablas: 'nutricion',
});
export const DEPRECATED_SECTIONS = Object.freeze(['registro']);

/* The tab a detail-sheet deep link opens UNDERNEATH the sheet (core.js, baked in NAV): a page opened
 * with #detail/<metric> shows the tab whose cards hold that metric, so closing the sheet lands there
 * (and the URL becomes that tab's hash). Every DETAIL_KEYS key of lib/detail/detail.mjs is listed (a
 * test pins it). VIEW_TAB does the same for a registered view's #<key> deep link; null = no host,
 * keep the current / default tab (the profile sheet opens from the top bar, on every tab). */
export const DETAIL_TAB = Object.freeze({
  sleep: 'health', recovery: 'health', hrv: 'health', rhr: 'health', respiratory: 'health',
  wristTemp: 'health', walkingHr: 'health', vo2max: 'health', steps: 'health', exercise: 'health',
  distance: 'health', flights: 'health', energy: 'health', weight: 'health', bodyfat: 'health',
  lean: 'health', waist: 'health',
  workouts: 'entreno', 'load-gym': 'entreno', 'load-run': 'entreno', 'load-bike': 'entreno',
  strain: 'entreno',
});
/* An in-page anchor that deep-links to a block of a tab (#<id>): core.js shows that tab and scrolls
 * to the element, keeping the hash. `monitor` = the health monitor list leading Salud. */
export const ANCHOR_TAB = Object.freeze({ monitor: 'health' });
export const VIEW_TAB = Object.freeze({ profile: null, 'food-add': 'nutricion', 'hoy-session': 'home', tonight: 'home', 'dash-edit': 'home', journal: 'home', 'journal-insights': 'home' });

/* Inicio day stepping (the top bar's "‹ TODAY ›" pill, client/today-date.js): a PAST day lives in
 * the hash as #d=YYYY-MM-DD and belongs to `tab` (core.js shows that tab and keeps the hash; a tab
 * switch back to it writes the day's hash again). `maxDays` caps how far back "‹" may ever reach;
 * the reachable history is the baked one (SCORES.days, lib/score/days.mjs), so the cap only matters
 * when the viewer's clock is far ahead of the data (no stepping then). */
export const DAY_HASH = Object.freeze({ prefix: 'd=', tab: 'home', maxDays: 30 });
const DAY_HASH_RE = /^#d=(\d{4}-\d{2}-\d{2})$/;

/** '#d=2026-09-24' -> '2026-09-24'; anything else (or an impossible date) -> null. */
export function parseDayHash(hash) {
  const m = DAY_HASH_RE.exec(String(hash || ''));
  if (!m) return null;
  const t = Date.parse(m[1] + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === m[1] ? m[1] : null;
}

/** '2026-09-24' -> '#d=2026-09-24' (the hash core.js and the pill write for a past day). */
export function dayHash(iso) {
  return '#' + DAY_HASH.prefix + iso;
}

/** The section keys hosted by `tab`, in SECTION_TAB order. */
export function sectionsOf(tab) {
  return Object.keys(SECTION_TAB).filter((key) => SECTION_TAB[key] === tab);
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
