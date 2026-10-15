/* Tab navigation for the page: setTab / jump, the URL hash routing and the midnight rollover.
 *
 * This is a CLASSIC script (Astro emits it via is:inline set:html — never a module-typed script tag,
 * per spec: Single self-contained output), wrapped in ONE function scope: its helpers stay private and
 * the public contract is the explicit list of window writes at the end (setTab, jump, jumpOr, currentTab,
 * HCNav).
 *
 * Markup contract (ported from the legacy hand-maintained page): nav buttons `#t-<key>`, panels
 * `.tab-panel[data-tab]`. The page has NO inline onclick= (its Content-Security-Policy blocks them,
 * src/csp.mjs): one delegated document click listener below reads `data-tab-go="<tab>"` (empty = the
 * default tab: the wordmark) and `data-jump="<id>"` (in-page links, the personal notes' links too).
 * web/src/client/core.test.mjs covers this contract.
 */
(function () {
  /* Four top-level tabs (Inicio / Entreno / Salud / Nutrición), nav buttons `#t-<key>`. The former
   * tab keys now name sections (`#sec-<key>`) inside one of them, so an old `setTab('tablas')` still
   * lands on the same content. Both lists come from NAV, baked by layouts/Plan.astro from
   * lib/nav/tabs.mjs (TAB_KEYS / SECTION_TAB) — the one copy, never repeated here. */
  var NAV_TABS = (typeof NAV !== 'undefined' && NAV && NAV.tabs) || [];
  var SECTION_TAB = (typeof NAV !== 'undefined' && NAV && NAV.sectionTab) || {};
  // deep link -> the tab shown underneath the sheet (lib/nav/tabs.mjs DETAIL_TAB / VIEW_TAB)
  var DETAIL_TAB = (typeof NAV !== 'undefined' && NAV && NAV.detailTab) || {};
  var VIEW_TAB = (typeof NAV !== 'undefined' && NAV && NAV.viewTab) || {};
  // an in-page anchor deep link (#monitor) -> the tab that holds it (lib/nav/tabs.mjs ANCHOR_TAB)
  var ANCHOR_TAB = (typeof NAV !== 'undefined' && NAV && NAV.anchorTab) || {};
  // Inicio's day stepping (lib/nav/tabs.mjs DAY_HASH): #d=YYYY-MM-DD = a past day, shown on DAY.tab
  var DAY = (typeof NAV !== 'undefined' && NAV && NAV.day) || null;

  /* The open tab lives in the URL hash (#home / #entreno / #health / #nutricion), so a reload (and
   * the midnight rollover's reload) reopens it. setTab REPLACES the entry (never pushes: Back does not
   * walk through tabs, it keeps closing the detail sheet), only for a tab with a nav button
   * (page.hideTabs never gets written) and never while the sheet is open (its #detail/… owns the URL).
   * Every history / location access is wrapped: a sandboxed frame that refuses them still switches. */
  function hasOwn(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  function tabVisible(key) {
    return NAV_TABS.indexOf(key) !== -1 && !!document.getElementById('t-' + key);
  }
  function defaultTab() {
    for (var i = 0; i < NAV_TABS.length; i++) if (tabVisible(NAV_TABS[i])) return NAV_TABS[i];
    return null;
  }
  function currentTab() {
    var panels = document.querySelectorAll('.tab-panel');
    for (var i = 0; i < panels.length; i++) if (!panels[i].hidden) return panels[i].getAttribute('data-tab');
    return null;
  }
  function readHash() {
    try {
      return (typeof location !== 'undefined' && location && location.hash) || '';
    } catch (e) {
      return '';
    }
  }
  // the hash a tab is named by: Inicio with a past day selected (client/today-date.js HCDay) keeps
  // that day's #d=YYYY-MM-DD, so leaving Inicio and coming back does not drop the day
  function tabHash(key) {
    var d = DAY && key === DAY.tab && typeof window !== 'undefined' && window.HCDay ? window.HCDay.hash() : '';
    return d || '#' + key;
  }
  function writeTabHash(key) {
    if (!tabVisible(key) || readHash() === tabHash(key)) return;
    var sheet = document.getElementById('detail');
    if (sheet && !sheet.hidden) return;
    try {
      history.replaceState(null, '', location.pathname + location.search + tabHash(key));
    } catch (e) { /* a frame that refuses history writes: the tab still switches */ }
  }

  function setTab(name, scrollTop) {
    if (SECTION_TAB[name]) {
      jump('sec-' + name);
      return;
    }
    showTab(name);
    writeTabHash(name);
    if (scrollTop !== false) window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // switches the visible panel + the nav state only (no history, no scroll)
  // the shown tab's nav button carries aria-current="page" (a nav of buttons, not a tablist)
  function showTab(name) {
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.hidden = p.getAttribute('data-tab') !== name;
    });
    NAV_TABS.forEach(function (key) {
      var b = document.getElementById('t-' + key);
      if (!b) return;
      if (key === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
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
      el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }, 30);
  }
  // the viewer asked the system for less motion: jumps land instantly (read per jump, the setting can change)
  function reducedMotion() {
    try {
      return typeof window.matchMedia === 'function' && !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  /** jump(id) when the target exists and is not in a hidden section; otherwise open `tab`. Used by
   * Inicio's score cards to land on their Salud detail even when that detail has no data yet. */
  function jumpOr(id, tab) {
    var el = document.getElementById(id);
    var section = el && el.closest && el.closest('.tab-section');
    if (el && !(section && section.hidden)) jump(id);
    else setTab(tab);
  }

  /* Hash routing. A tab hash opens that tab; no hash, or a hidden or unknown one, opens the default
   * visible tab and the URL is replaced to match. A detail-sheet deep link (#detail/<metric>[/<date>], #<view>) is left
   * to detail.js (inlined later), which opens the sheet; underneath it the HOST tab is shown when one is
   * known and visible (DETAIL_TAB / VIEW_TAB; profile = none), so closing the sheet lands there and
   * detail.js rewrites the URL to HCNav.hash(). Later hash navigation (an edited URL, a bookmark, Back
   * onto a tab entry) switches to a visible tab hash and ignores everything else: a sheet's hash is
   * detail.js's popstate, never a tab switch, so the two listeners never fight. */
  var DETAIL_HASH_RE = /^#detail\/([A-Za-z-]+)(?:\/|$)/;
  var KEY_HASH_RE = /^#([a-z][a-z-]*)$/;
  // null = no hash; {deep: true, tab} = a sheet deep link (tab = its host, or null); {deep: false, tab}
  // = anything else (tab = the tab it names, or null when it names none)
  function hashRoute(hash) {
    if (!hash) return null;
    // a past day of Inicio (#d=YYYY-MM-DD): its tab, the hash kept; today-date.js validates the day
    if (DAY && hash.indexOf('#' + DAY.prefix) === 0) return { deep: false, tab: DAY.tab, day: true };
    var m = DETAIL_HASH_RE.exec(hash);
    if (m) return { deep: true, tab: hasOwn(DETAIL_TAB, m[1]) ? DETAIL_TAB[m[1]] : null };
    m = KEY_HASH_RE.exec(hash);
    if (m && hasOwn(VIEW_TAB, m[1])) return { deep: true, tab: VIEW_TAB[m[1]] };
    if (m && hasOwn(ANCHOR_TAB, m[1])) return { deep: false, tab: ANCHOR_TAB[m[1]], anchor: m[1] };
    return { deep: false, tab: m && NAV_TABS.indexOf(m[1]) !== -1 ? m[1] : null };
  }
  // an anchor deep link: its tab without touching the hash (#monitor stays), then scroll to the block
  function showAnchor(r) {
    showTab(r.tab);
    var el = document.getElementById(r.anchor);
    if (el) setTimeout(function () { el.scrollIntoView({ behavior: 'auto', block: 'start' }); }, 30);
  }
  (function () {
    var r = hashRoute(readHash());
    if (r && r.anchor && tabVisible(r.tab)) {
      showAnchor(r);
    } else if (r && r.tab && tabVisible(r.tab)) {
      showTab(r.tab); // a deep link's hash stays as it is; a tab hash already matches
    } else if (!r || !r.deep) {
      // no hash, or a hidden / unknown one: the default tab (the one the server rendered visible), and
      // the URL names it (so Back from a sheet opened before any tab tap still lands on a tab hash)
      var c = currentTab();
      var d = c && tabVisible(c) ? c : defaultTab();
      if (d) setTab(d, false);
    }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('hashchange', function () {
        var n = hashRoute(readHash());
        if (n && n.anchor && tabVisible(n.tab)) showAnchor(n);
        else if (n && n.day && tabVisible(n.tab)) showTab(n.tab);
        else if (n && !n.deep && n.tab && tabVisible(n.tab) && currentTab() !== n.tab) setTab(n.tab);
      });
    }
  })();

  /* Midnight rollover (HC.rolloverAction): the page captures the viewer's day at load; when it becomes
   * visible on another day it reloads once, so every view computed at load (dials, top-bar date,
   * timeline, day type, rings) moves to the new day. While the page is BUSY — the detail sheet (#detail)
   * is open, a Mis productos / Mis recetas editor is open (any form field inside #fp-body / #fr-body:
   * closed, those hosts hold only buttons and the list) or a text field anywhere has focus — the reload
   * waits: a watcher polls each second while there is something to wait for, and stops when there is
   * nothing to do (page hidden, clock back on the load day); visibilitychange / pageshow re-arm it.
   * A reload that throws (a sandboxed frame) is not retried by the watcher, only by a later event.
   * food-*.js's own visibilitychange listener still re-reads today's log: when the page reloads that read
   * is simply dropped, and while a reload is deferred it keeps Registrar on the new day. */
  (function () {
    if (typeof HC === 'undefined' || !HC.rolloverAction || typeof document.addEventListener !== 'function') return;
    var loadDay = HC.todayIso();
    var watch = null;
    var reloading = false;
    var EDITOR_HOSTS = ['fp-body', 'fr-body'];
    var FIELDS = 'input, select, textarea';
    function stopWatch() {
      if (watch != null) clearInterval(watch);
      watch = null;
    }
    function isTextField(el) {
      var tag = el && el.tagName ? String(el.tagName).toUpperCase() : '';
      if (tag === 'SELECT' || tag === 'TEXTAREA') return true;
      return tag === 'INPUT' && !/^(radio|checkbox|button|submit|reset)$/i.test(el.type || '');
    }
    function busy() {
      var d = document.getElementById('detail');
      if (d && !d.hidden) return true;
      for (var i = 0; i < EDITOR_HOSTS.length; i++) {
        var host = document.getElementById(EDITOR_HOSTS[i]);
        if (host && typeof host.querySelector === 'function' && host.querySelector(FIELDS)) return true;
      }
      return isTextField(document.activeElement);
    }
    function check() {
      var action = HC.rolloverAction(loadDay, HC.todayIso(), busy(), !!document.hidden);
      if (action === 'defer') {
        if (watch == null) watch = setInterval(check, 1000);
        return;
      }
      stopWatch();
      if (action !== 'reload' || reloading) return;
      reloading = true; // the page is going away: never a second reload
      try {
        window.location.reload();
      } catch (e) {
        reloading = false; // a sandboxed frame may refuse: a later visibilitychange / pageshow tries again
      }
    }
    document.addEventListener('visibilitychange', check);
    // a page restored from the back-forward cache
    if (typeof window.addEventListener === 'function') window.addEventListener('pageshow', check);
  })();

  /* Delegated navigation (no inline handlers: the CSP blocks them). A click on, or inside, a
   * [data-tab-go] element opens that tab (an empty value = the default tab, scrolled to the top: the
   * wordmark); one on a [data-jump] element jumps to that id (opens its tab and folds, scrolls to it). */
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', function (e) {
      var t = e && e.target;
      if (!t || typeof t.closest !== 'function') return;
      var go = t.closest('[data-tab-go]');
      if (go) {
        var key = go.getAttribute('data-tab-go') || defaultTab();
        if (e.preventDefault) e.preventDefault();
        if (key) setTab(key);
        return;
      }
      var to = t.closest('[data-jump]');
      if (to) {
        if (e.preventDefault) e.preventDefault();
        jump(to.getAttribute('data-jump'));
      }
    });
  }

  window.setTab = setTab;
  window.jump = jump;
  window.jumpOr = jumpOr;
  // client/today-date.js: is Inicio the shown tab
  window.currentTab = currentTab;
  // detail.js: the hash a closed sheet returns to ('' when no visible tab is shown)
  window.HCNav = {
    hash: function () {
      var t = currentTab();
      return t && tabVisible(t) ? tabHash(t) : '';
    },
  };
})();
