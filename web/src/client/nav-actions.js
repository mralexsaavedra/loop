/* The bottom dock's "+" action button and its popover (markup: layouts/Plan.astro, #act). Classic script
 * (is:inline). It lists only REAL actions that already exist on this page, decided at view time:
 *   - food: the food log's add sheet (window.HCViews['food-add'], registered by food-log.js once
 *     GET /api/food/products answered — LAN only) opened through the detail sheet (window.HCDetail);
 *   - sync: the top bar's Sync button (#sync-btn, client/freshness.js), available while the freshness
 *     group is shown (/api/sync/status answered — LAN only).
 * Both answer asynchronously, so freshness.js and food-log.js call window.HCActions.refresh() when they
 * change; the root (#act) ships hidden and stays hidden while no action is available (example build,
 * file://, a static copy): never a dead control.
 * Open: the popover + a blurred scrim, the "+" turns into a close "x" (CSS on aria-expanded, the label
 * swaps to data-label-close), focus moves to the first action; Tab cycles over the button and the
 * visible actions; Escape, the button again or a tap outside the card (the scrim, the tab bar) closes
 * and focus returns to the button. An action closes the popover first; the add sheet gets the button as its opener. */
(function () {
  var root = document.getElementById('act');
  var btn = document.getElementById('act-btn');
  var pop = document.getElementById('act-pop');
  var scrim = document.getElementById('act-scrim');
  if (!root || !btn || !pop) return;
  var openLabel = btn.getAttribute('aria-label') || '';
  var closeLabel = btn.getAttribute('data-label-close') || openLabel;

  var ACTIONS = {
    food: {
      ok: function () {
        return !!(window.HCViews && window.HCViews['food-add'] && window.HCDetail && typeof window.HCDetail.open === 'function');
      },
      run: function () {
        window.HCDetail.open('food-add', null, { opener: btn, focus: '#fa-meal' });
      },
    },
    sync: {
      ok: function () {
        var host = document.getElementById('freshness');
        var s = document.getElementById('sync-btn');
        return !!(host && !host.hidden && s && typeof s.click === 'function');
      },
      run: function () {
        document.getElementById('sync-btn').click();
      },
    },
  };

  function items() {
    return Array.prototype.slice.call(document.querySelectorAll('.act-item'));
  }
  function available(el) {
    var a = ACTIONS[el.getAttribute('data-act')];
    try {
      return !!(a && a.ok());
    } catch (e) {
      return false;
    }
  }
  function isOpen() {
    return !pop.hidden;
  }
  function visible() {
    return items().filter(function (el) { return !el.hidden; });
  }
  function focus(el) {
    if (el && typeof el.focus === 'function') el.focus();
  }

  function refresh() {
    var any = false;
    items().forEach(function (el) {
      var on = available(el);
      el.hidden = !on;
      if (on) any = true;
    });
    root.hidden = !any;
    if (!any && isOpen()) close(false);
  }
  function open() {
    refresh();
    var list = visible();
    if (!list.length) return;
    pop.hidden = false;
    if (scrim) scrim.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-label', closeLabel);
    focus(list[0]);
  }
  function close(restore) {
    pop.hidden = true;
    if (scrim) scrim.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', openLabel);
    if (restore) focus(btn);
  }
  function within(t, el) {
    for (var n = t; n; n = n.parentElement) if (n === el) return true;
    return false;
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) return;
    if (t === btn || within(t, btn)) {
      if (isOpen()) close(true);
      else open();
      return;
    }
    if (!isOpen()) return;
    // a tap outside the card (the scrim, or the tab bar above it) closes it
    if (!within(t, pop)) {
      close(true);
      return;
    }
    var item = t.closest ? t.closest('[data-act]') : null;
    if (item) {
      var a = ACTIONS[item.getAttribute('data-act')];
      var ok = available(item);
      // the add sheet returns focus to the button itself when it closes
      close(!ok || item.getAttribute('data-act') !== 'food');
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
    var ring = [btn].concat(visible());
    var i = ring.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      focus(ring[ring.length - 1]);
    } else if (!e.shiftKey && (i === -1 || i === ring.length - 1)) {
      e.preventDefault();
      focus(ring[0]);
    }
  });

  window.HCActions = { refresh: refresh, open: open, close: close };
  refresh();
})();
