/* The bottom dock's "+" action button and its popover (markup: layouts/Plan.astro, #act). Module script
 * (bundled into the page, docs/plan-page.md → Module scripts). It lists only REAL actions that already exist on this page, decided at view time:
 *   - food: the food log's add sheet (window.HCViews['food-add'], registered by food-log.js once
 *     GET /api/food/products answered — LAN only) opened through the detail sheet (window.HCDetail);
 *   - journal: the journal sheet (window.HCViews.journal, registered by client/journal.ts once
 *     GET /api/journal/settings answered — LAN only);
 *   - sync: the top bar's Sync button (#sync-btn, client/freshness.ts), available while the freshness
 *     group is shown (/api/sync/status answered — LAN only).
 * Both answer asynchronously, so freshness.ts and food-log.js call window.HCActions.refresh() when they
 * change; the root (#act) ships hidden and stays hidden while no action is available (example build,
 * file://, a static copy): never a dead control.
 * Open: the popover + a blurred scrim, the "+" turns into a close "x" (CSS on aria-expanded, the label
 * swaps to data-label-close), focus moves to the first action; Tab cycles over the button and the
 * visible actions; Escape, the button again or a tap outside the card (the scrim, the tab bar) closes
 * and focus returns to the button. An action closes the popover first; the add sheet gets the button as its opener. */

/** One "+" action: ok = available on this page right now, run = do it. */
type Action = { ok: () => boolean; run: () => void };

(function () {
  var root = document.getElementById('act');
  var btn = document.getElementById('act-btn');
  var pop = document.getElementById('act-pop');
  var scrim = document.getElementById('act-scrim');
  if (!root || !btn || !pop) return;
  var rootEl: HTMLElement = root, btnEl: HTMLElement = btn, popEl: HTMLElement = pop;
  var openLabel = btn.getAttribute('aria-label') || '';
  var closeLabel = btn.getAttribute('data-label-close') || openLabel;

  var ACTIONS: Record<string, Action> = {
    food: {
      ok: function () {
        return !!(window.HCViews && window.HCViews['food-add'] && window.HCDetail && typeof window.HCDetail.open === 'function');
      },
      run: function () {
        window.HCDetail.open('food-add', null, { opener: btnEl, focus: '#fa-q, #fa-label' });
      },
    },
    journal: {
      ok: function () {
        return !!(window.HCViews && window.HCViews.journal && window.HCDetail && typeof window.HCDetail.open === 'function');
      },
      run: function () {
        window.HCDetail.open('journal', null, { opener: btnEl });
      },
    },
    sync: {
      ok: function () {
        var host = document.getElementById('freshness');
        var s = document.getElementById('sync-btn');
        return !!(host && !host.hidden && s && typeof s.click === 'function');
      },
      run: function () {
        (document.getElementById('sync-btn') as HTMLElement).click();
      },
    },
  };

  function items(): HTMLElement[] {
    return Array.prototype.slice.call(document.querySelectorAll('.act-item'));
  }
  function available(el: Element) {
    var a = ACTIONS[el.getAttribute('data-act') as string];
    try {
      return !!(a && a.ok());
    } catch (e) {
      return false;
    }
  }
  function isOpen() {
    return !popEl.hidden;
  }
  function visible() {
    return items().filter(function (el) { return !el.hidden; });
  }
  function focus(el: HTMLElement | null) {
    if (el && typeof el.focus === 'function') el.focus();
  }

  function refresh() {
    var any = false;
    items().forEach(function (el) {
      var on = available(el);
      el.hidden = !on;
      if (on) any = true;
    });
    rootEl.hidden = !any;
    if (!any && isOpen()) close(false);
  }
  function open() {
    refresh();
    var list = visible();
    if (!list.length) return;
    popEl.hidden = false;
    if (scrim) scrim.hidden = false;
    btnEl.setAttribute('aria-expanded', 'true');
    btnEl.setAttribute('aria-label', closeLabel);
    focus(list[0]);
  }
  function close(restore: boolean) {
    popEl.hidden = true;
    if (scrim) scrim.hidden = true;
    btnEl.setAttribute('aria-expanded', 'false');
    btnEl.setAttribute('aria-label', openLabel);
    if (restore) focus(btnEl);
  }
  function within(t: Element, el: Element) {
    for (var n: Element | null = t; n; n = n.parentElement) if (n === el) return true;
    return false;
  }

  document.addEventListener('click', function (e) {
    var t = e.target as Element | null;
    if (!t) return;
    if (t === btnEl || within(t, btnEl)) {
      if (isOpen()) close(true);
      else open();
      return;
    }
    if (!isOpen()) return;
    // a tap outside the card (the scrim, or the tab bar above it) closes it
    if (!within(t, popEl)) {
      close(true);
      return;
    }
    var item = t.closest ? t.closest('[data-act]') : null;
    if (item) {
      var a = ACTIONS[item.getAttribute('data-act') as string];
      var ok = available(item);
      // the add sheet / the journal sheet return focus to the button itself when they close
      var sheet = item.getAttribute('data-act') === 'food' || item.getAttribute('data-act') === 'journal';
      close(!ok || !sheet);
      if (ok) a.run();
      refresh();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (!isOpen()) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key !== 'Tab') return;
    var ring = [btnEl].concat(visible());
    var i = ring.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      focus(ring[ring.length - 1]);
    } else if (!e.shiftKey && (i === -1 || i === ring.length - 1)) {
      e.preventDefault();
      focus(ring[0]);
    }
  });

  // runs one action by name when this page has it (the keyboard shortcuts, client/shortcuts.ts): false when
  // it is not available, so a shortcut for a missing action does nothing
  function run(name: string): boolean {
    var a = Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name] : null;
    var ok;
    try { ok = !!(a && a.ok()); } catch (e) { ok = false; }
    if (!ok) return false;
    if (isOpen()) close(false);
    (a as Action).run(); // ok is only true when a is an action
    return true;
  }

  window.HCActions = { refresh: refresh, open: open, close: close, run: run };
  refresh();
})();
