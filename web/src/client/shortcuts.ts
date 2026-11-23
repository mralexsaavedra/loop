/* Keyboard shortcuts for the whole page (no modifier keys, GitHub / Gmail style) and the "?" help sheet.
 * Module script (bundled into the page, docs/plan-page.md → Module scripts), inlined before deepdive.js / detail.js so the help sheet is a registered view
 * (window.HCViews.shortcuts, deep link #shortcuts) when detail.js reads the URL at load.
 *   1 … 4          the visible tabs in nav order (presses the tab bar's button: client/core.js)
 *   a              add food (window.HCActions.run('food'), client/nav-actions.ts; LAN only)
 *   d              the journal (window.HCActions.run('journal'); LAN only)
 *   ?              this list (the add sheet's own keys too: client/food-sheet.js)
 * A key is ignored while typing (input, textarea, select, contenteditable), with Ctrl / Cmd / Alt (so the
 * browser keeps Cmd+1 etc.), while a sheet or the "+" popover is open, and once something else handled it.
 * Copy: I18N_DETAIL.shortcuts (web/src/i18n/detail-templates.mjs). */
import type { PageGlobals } from './page-globals';

// the page globals this script reads (baked by the build or provided by an earlier script; manifest.mjs)
declare const HC: PageGlobals['HC'];
declare const I18N_DETAIL: PageGlobals['I18N_DETAIL'];
declare const NAV: PageGlobals['NAV'];

(function () {
  var T = typeof I18N_DETAIL !== 'undefined' && I18N_DETAIL ? I18N_DETAIL.shortcuts : null;
  if (!T || typeof document.addEventListener !== 'function') return;
  var esc = HC.esc;
  var TABS: string[] = (typeof NAV !== 'undefined' && NAV && NAV.tabs) || [];
  var ACTION_KEYS: Record<string, string> = { a: 'food', d: 'journal' };

  // the tabs this page shows, in nav order (a hidden tab has no button: layouts/Plan.astro)
  function tabButtons(): HTMLElement[] {
    var out: HTMLElement[] = [];
    for (var i = 0; i < TABS.length; i++) {
      var b = document.getElementById('t-' + TABS[i]);
      if (b && !b.hidden) out.push(b);
    }
    return out;
  }
  function typing(t: HTMLElement | null): boolean {
    if (!t) return false;
    var tag = String(t.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
  }
  function busy() {
    var d = window.HCDetail;
    if (d && typeof d.state === 'function' && d.state()) return true;
    var pop = document.getElementById('act-pop');
    return !!(pop && !pop.hidden);
  }
  function openHelp() {
    var d = window.HCDetail;
    if (d && typeof d.open === 'function') d.open('shortcuts', null);
  }

  function keyRow(keys: string[], label: string): string {
    return '<li class="kb-row"><span class="kb-keys">' + keys.map(function (k: string) { return '<kbd class="kb">' + esc(k) + '</kbd>'; }).join(' ') +
      '</span><span class="kb-label">' + esc(label) + '</span></li>';
  }
  function render() {
    // one row per tab this page shows, named by its own button (a hidden tab shifts the numbers)
    var page = tabButtons().map(function (b, i) { return keyRow([String(i + 1)], String(b.textContent || '').trim()); });
    // only the actions this page has (both LAN only: their views register once their API answered)
    if (HC.view('food-add')) page.push(keyRow(['a'], T.addFood));
    if (HC.view('journal')) page.push(keyRow(['d'], T.journal));
    page.push(keyRow(['?'], T.help));
    var sheet = [keyRow(['↑', '↓'], T.sheetMove), keyRow([T.enter], T.sheetPick), keyRow(['←', '→'], T.sheetTabs), keyRow([T.esc], T.sheetBack)];
    return {
      head: '',
      body: '<div class="kb-sheet"><h3 class="kb-h">' + esc(T.pageTitle) + '</h3><ul class="kb-list">' + page.join('') + '</ul>' +
        '<h3 class="kb-h">' + esc(T.sheetTitle) + '</h3><ul class="kb-list">' + sheet.join('') + '</ul>' +
        '<p class="kb-note">' + esc(T.note) + '</p></div>',
    };
  }
  HC.registerView('shortcuts', { title: function () { return T.title; }, render: render });

  document.addEventListener('keydown', function (e) {
    if (!e || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (typing(e.target as HTMLElement | null) || busy()) return;
    var k = e.key;
    if (k === '?') {
      e.preventDefault();
      openHelp();
      return;
    }
    if (/^[1-9]$/.test(k)) {
      var b = tabButtons()[Number(k) - 1];
      if (!b || typeof b.click !== 'function') return;
      e.preventDefault();
      b.click();
      return;
    }
    var name = ACTION_KEYS[String(k).toLowerCase()];
    if (name && !e.shiftKey && window.HCActions && typeof window.HCActions.run === 'function' && window.HCActions.run(name)) e.preventDefault();
  });
})();
