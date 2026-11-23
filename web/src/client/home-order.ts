/* Inicio's block order: the user's order and show / hide of the blocks under the tiles (My day, Today you
 * eat, Tonight, My journal, My plan, My dashboard). The dials, the tiles and the programmed session's
 * hidden source never move. "Customize Home ✎" (#home-cust, last on the tab) opens a registered sheet
 * ('home-edit', client/detail.ts modal) built by the shared HC.orderList (client/util.js): the switch,
 * ↑ / ↓ and the ≡ drag; preferences in localStorage (PREFS_KEY) as {order, hidden}, working the same
 * without storage (in memory). Applying = moving each present block, in the saved order, right before
 * #home-cust; a block switched off gets `home-off` (display: none), never the `hidden` attribute its own
 * script manages (an empty block stays hidden whatever the user chose).
 *
 * Module script (bundled into the page, docs/plan-page.md → Module scripts) in layouts/Plan.astro's end-of-body list, after journal.js (every block it moves has
 * rendered) and before detail.ts (its sheet is registered before detail.ts reads a #home-edit deep
 * link); a throw keeps the built order. */
import type { PageGlobals } from './page-globals';

// the page globals this script reads (baked by the build or provided by an earlier script; manifest.mjs)
declare const HC: PageGlobals['HC'];
declare const I18N_SCORE: PageGlobals['I18N_SCORE'];

type BlockKey = 'day' | 'eat' | 'tonight' | 'journal' | 'plan' | 'dash';

(function () {
  function boot() {
    var T = typeof I18N_SCORE !== 'undefined' && I18N_SCORE && I18N_SCORE.home ? I18N_SCORE.home.order : null;
    if (!T || typeof HC === 'undefined' || typeof HC.orderList !== 'function') return;
    var PREFS_KEY = 'hc-home-v1';
    var CATALOG: BlockKey[] = ['day', 'eat', 'tonight', 'journal', 'plan', 'dash'];
    var BLOCKS: Record<BlockKey, string> = { day: '#my-day', eat: '.eat-card', tonight: '#home-tonight', journal: '#my-journal', plan: '#my-plan', dash: '#my-dash' };
    // the row icons, from the shared set (HC.metricIcon)
    var ICONS: Record<BlockKey, string> = { day: 'clock', eat: 'food', tonight: 'sleep', journal: 'cons', plan: 'sessions', dash: 'eff' };
    function el(key: BlockKey) {
      return document.querySelector(BLOCKS[key]);
    }
    function available() {
      return CATALOG.filter(function (k) { return !!el(k); });
    }
    function apply() {
      var anchor = document.getElementById('home-cust');
      if (!anchor || !anchor.parentNode) return;
      var at: HTMLElement = anchor;
      OL.current().forEach(function (p: { key: BlockKey; on: boolean }) {
        var n = el(p.key);
        if (!n) return;
        (at.parentNode as ParentNode).insertBefore(n, at);
        n.classList.toggle('home-off', !p.on);
      });
    }
    var OL = HC.orderList({
      view: 'home-edit', attr: 'home', key: PREFS_KEY, catalog: CATALOG, defaultOn: CATALOG, available: available,
      title: function () { return T.editTitle; },
      row: function (key: BlockKey) { return { icon: HC.metricIcon(ICONS[key]), name: T.names[key], full: T.names[key] }; },
      aria: { show: T.showAria, up: T.upAria, down: T.downAria },
      changed: function () { try { apply(); } catch (e) { /* the page keeps its current order */ } },
    });
    HC.registerView('home-edit', OL.sheet);
    window.HCHomeOrder = { apply: apply, prefsFrom: OL.prefsFrom, CATALOG: CATALOG, PREFS_KEY: PREFS_KEY };
    try { apply(); } catch (e) { /* the page keeps its built order */ }
  }
  boot();
})();
