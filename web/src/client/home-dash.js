/* Inicio "My dashboard" (#my-dash, after "My plan"): a stack of single-row metric cards (60px) — icon ·
 * UPPERCASE full metric name (I18N_SCORE.home.dash.names, else the sheet's title) · the latest value
 * (22px, the unit at half that) on the right, the 30-day baseline under it and an arrow vs that
 * baseline (▲▼ --up better / --down worse by the metric's good direction, --ink for a neutral metric (HC.trendTone),
 * a grey dot when within ±FLAT_SHARE). Only metrics present in the baked DETAIL (lib/detail/detail.mjs);
 * the same series, titles and units as the detail sheet (I18N_DETAIL), so nothing new is computed
 * beyond the baseline mean. A row opens that metric's detail sheet.
 *
 * Value = the newest day with data up to the viewer's today (a daily total skips today, still filling
 * up); baseline = the mean of the BASE_DAYS (30) days before that day, with at least MIN_BASE (7) days
 * of data (MIN_BASE_SPARSE (2) readings for a sparse series such as weight); no baseline → no arrow.
 *
 * "Customize ✎" opens a registered sheet ('dash-edit', client/detail.js modal) to show / hide and move
 * rows: drag a row's ≡ handle (Pointer Events: mouse, touch, pen) or use its ↑ / ↓ buttons (keyboard,
 * screen readers); both go through the pure move() and save the same way. Preferences live in localStorage (PREFS_KEY) as {order, hidden}; every read and
 * write is wrapped in try/catch, unknown or unavailable keys are ignored and missing ones fall back to
 * the catalogue order + default visibility, so the page works the same without storage (in memory).
 *
 * Classic script in layouts/Plan.astro's end-of-body list, right after client/home-week.js and before
 * detail.js (its `dash-edit` sheet is registered before detail.js runs); its own try/catch hides the section on a throw. */
(function () {
  function boot() {
    var TS = typeof I18N_SCORE !== 'undefined' && I18N_SCORE && I18N_SCORE.home ? I18N_SCORE.home.dash : null;
    var TD = typeof I18N_DETAIL !== 'undefined' && I18N_DETAIL ? I18N_DETAIL : null;
    var D = typeof DETAIL !== 'undefined' && DETAIL && DETAIL.metrics ? DETAIL : null;
    if (!TS || !TD || typeof HC === 'undefined') return;
    var esc = HC.esc, format = HC.format;
    var CATALOG = ['rhr', 'hrv', 'sleep', 'weight', 'steps', 'vo2max', 'fitnessAge', 'walkingHr', 'exercise'];
    var DEFAULT_ON = ['rhr', 'hrv', 'sleep', 'weight', 'steps'];
    var PREFS_KEY = 'hc-dash-v1';
    var BASE_DAYS = 30, MIN_BASE = 7, MIN_BASE_SPARSE = 2, FLAT_SHARE = 0.02;
    var memory = null; // the prefs when storage is unavailable

    function fin(v) {
      return typeof v === 'number' && isFinite(v);
    }
    function own(o, k) {
      return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
    }

    /* ---------- pure: preferences ---------- */
    // raw: the stored JSON string (or null); available: the catalogue keys with data
    // -> [{key, on}] in display order
    function prefsFrom(raw, available) {
      var avail = CATALOG.filter(function (k) { return available.indexOf(k) !== -1; });
      var p = null;
      try { p = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { p = null; }
      var order = p && Array.isArray(p.order) ? p.order : [];
      var hidden = p && Array.isArray(p.hidden) ? p.hidden : null;
      var out = [], seen = {};
      order.concat(avail).forEach(function (k) {
        if (typeof k !== 'string' || avail.indexOf(k) === -1 || own(seen, k)) return;
        seen[k] = true;
        var stored = order.indexOf(k) !== -1 && hidden;
        out.push({ key: k, on: stored ? hidden.indexOf(k) === -1 : DEFAULT_ON.indexOf(k) !== -1 });
      });
      return out;
    }
    function serialize(list) {
      return JSON.stringify({ order: list.map(function (x) { return x.key; }), hidden: list.filter(function (x) { return !x.on; }).map(function (x) { return x.key; }) });
    }
    function readPrefs() {
      if (memory != null) return memory;
      try { return window.localStorage ? window.localStorage.getItem(PREFS_KEY) : null; } catch (e) { return null; }
    }
    function writePrefs(list) {
      var s = serialize(list);
      try {
        if (!window.localStorage) throw new Error('no storage');
        window.localStorage.setItem(PREFS_KEY, s);
        memory = null;
      } catch (e) {
        memory = s; // keeps working for this visit
      }
    }
    function copy(list) {
      return list.map(function (x) { return { key: x.key, on: x.on }; });
    }
    function indexOf(list, key) {
      for (var j = 0; j < list.length; j++) if (list[j].key === key) return j;
      return -1;
    }
    // one item from index `from` to index `to` (pure): a new list; an out-of-range or equal index
    // returns an unchanged copy. The ↑ / ↓ buttons and the ≡ drag both reorder through it.
    function move(list, from, to) {
      var out = copy(list), n = out.length;
      var ok = function (i) { return typeof i === 'number' && i % 1 === 0 && i >= 0 && i < n; };
      if (!ok(from) || !ok(to) || from === to) return out;
      out.splice(to, 0, out.splice(from, 1)[0]);
      return out;
    }
    // up / down / toggle on the list (pure): returns a new list
    function edit(list, key, act) {
      var i = indexOf(list, key);
      if (i === -1) return copy(list);
      if (act === 'up') return move(list, i, i - 1);
      if (act === 'down') return move(list, i, i + 1);
      var out = copy(list);
      if (act === 'toggle') out[i].on = !out[i].on;
      return out;
    }

    /* ---------- pure: one row's numbers ---------- */
    function at(m, iso) {
      var i = Math.round((HC.parseIso(iso) - HC.parseIso(m.start)) / HC.MS_PER_DAY);
      var v = i >= 0 && i < m.v.length ? m.v[i] : null;
      return fin(v) ? v : null;
    }
    // m: a DETAIL metric, today: the viewer's ISO day -> null | {value, date, base, arrow, tone}
    function rowValue(m, today) {
      if (!m || !Array.isArray(m.v) || !HC.isoDate(m.start) || !HC.isoDate(today)) return null;
      var end = m.kind === 'total' ? HC.shiftIso(today, -1) : today; // today's total is still filling up
      var date = null;
      for (var d = end, k = 0; d >= m.start && k < m.v.length + 400; d = HC.shiftIso(d, -1), k++) {
        if (at(m, d) != null) { date = d; break; }
      }
      if (!date) return null;
      var value = at(m, date), s = 0, n = 0;
      for (var j = 1; j <= BASE_DAYS; j++) {
        var b = at(m, HC.shiftIso(date, -j));
        if (b != null) { s += b; n++; }
      }
      var base = n >= (m.kind === 'sparse' ? MIN_BASE_SPARSE : MIN_BASE) ? s / n : null;
      var arrow = null, tone = 'flat';
      if (base != null) {
        var rel = base ? (value - base) / Math.abs(base) : value - base;
        arrow = Math.abs(rel) < FLAT_SHARE ? 'flat' : rel > 0 ? 'up' : 'down';
        if (arrow !== 'flat' && m.dir) tone = (arrow === 'up') === (m.dir > 0) ? 'good' : 'bad';
      }
      return { value: value, date: date, base: base, arrow: arrow, tone: tone };
    }

    /* ---------- render ---------- */
    function icon(key) {
      return HC.metricIcon(key); // the shared row icons (client/util.js)
    }
    // the row's full name (TS.names: "Resting heart rate"), else the detail sheet's title
    function titleOf(key) {
      if (own(TS.names, key)) return TS.names[key];
      return own(TD.metrics, key) && TD.metrics[key].title ? TD.metrics[key].title : key;
    }
    function unitOf(key) {
      return own(TD.metrics, key) && TD.metrics[key].unit ? TD.metrics[key].unit : '';
    }
    function fmt(key, m, v) {
      if (key === 'sleep') return HC.hours(v); // hours → 7:32
      if (key === 'fitnessAge') { // whole years; a value at the reference curve's clamp = that age or beyond
        if (fin(m.lo) && v <= m.lo) return '≤ ' + m.lo;
        if (fin(m.hi) && v >= m.hi) return '≥ ' + m.hi;
        return HC.num(v, 0);
      }
      return HC.num(v, m.dec || 0);
    }
    function rowHtml(key, m, r) {
      var unit = key === 'sleep' ? '' : unitOf(key);
      var stale = HC.daysOld(r.date) > HC.STALE_DAYS;
      var aria = format(TS.rowAria, { metric: titleOf(key), value: fmt(key, m, r.value) + (unit ? ' ' + unit : ''), date: HC.fmtDate(r.date) }) +
        (r.base != null ? ' · ' + format(TS.baseAria, { base: fmt(key, m, r.base) + (unit ? ' ' + unit : '') }) + ' · ' + TS.dirs[r.arrow] : '');
      return HC.metricRow({ key: key, cls: stale ? 'db-stale' : '', attrs: HC.detailAttrs(key), aria: aria, name: titleOf(key), value: fmt(key, m, r.value), unit: unit,
        arrow: r.arrow, tone: r.tone, base: r.base != null ? fmt(key, m, r.base) : null });
    }
    function available() {
      return D ? CATALOG.filter(function (k) { return own(D.metrics, k) && D.metrics[k] && Array.isArray(D.metrics[k].v); }) : [];
    }
    function current() {
      return prefsFrom(readPrefs(), available());
    }
    function renderDash() {
      var sec = document.getElementById('my-dash'), host = document.getElementById('home-dash');
      if (!sec || !host) return;
      try {
        var today = HC.todayIso(), rows = [];
        var list = current();
        list.forEach(function (p) {
          if (!p.on) return;
          var m = D.metrics[p.key], r = rowValue(m, today);
          if (r) rows.push(rowHtml(p.key, m, r));
        });
        host.innerHTML = rows.length ? '<ul class="db-list">' + rows.join('') + '</ul>' : '<p class="db-empty">' + esc(TS.empty) + '</p>';
        // the section shows whenever a metric exists, so "Customize" can bring a hidden row back
        sec.hidden = !list.length;
      } catch (e) {
        host.innerHTML = '';
        sec.hidden = true;
      }
    }

    // the customize sheet: one row per available metric — show / hide, up, down
    // the SHORT name (the trend sheet's title: "HRV", "Resting HR"), so a row fits 1-2 lines at 360 px
    // beside its controls; the full name stays in the buttons' accessible names
    function shortOf(key) {
      return own(TD.metrics, key) && TD.metrics[key].title ? TD.metrics[key].title : titleOf(key);
    }
    function editHtml(list) {
      return '<p class="dt-note">' + esc(TS.editNote) + '</p><ul class="db-edit">' + list.map(function (p, i) {
        var t = titleOf(p.key);
        return '<li class="db-erow' + (p.on ? '' : ' db-off') + '">' + icon(p.key) + '<span class="db-name">' + esc(shortOf(p.key)) + '</span>' +
          HC.switchBtn(p.on, format(TS.showAria, { metric: t }), ' data-dash-act="toggle" data-key="' + esc(p.key) + '"') +
          '<button type="button" class="db-btn" data-dash-act="up" data-key="' + esc(p.key) + '" aria-label="' + esc(format(TS.upAria, { metric: t })) + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="db-btn" data-dash-act="down" data-key="' + esc(p.key) + '" aria-label="' + esc(format(TS.downAria, { metric: t })) + '"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
          // the ≡ handle: pointer drag (mouse, touch, pen); the ↑ / ↓ buttons are its keyboard / screen-reader twin
          '<span class="db-grip" data-dash-grip="" data-key="' + esc(p.key) + '" aria-hidden="true"><svg class="db-grip-ico" viewBox="0 0 20 20"><path d="M3 6h14M3 10h14M3 14h14"/></svg></span></li>';
      }).join('') + '</ul>';
    }
    HC.registerView('dash-edit', {
      title: function () { return TS.editTitle; },
      // a re-render replaces the rows: any drag still in flight is dropped (nothing saved)
      render: function () { clearDrag(); return { head: '', body: editHtml(current()) }; },
    });
    // save a new list, re-render the dashboard and the open sheet (focus: a selector to keep, or none)
    function commit(list, focus) {
      writePrefs(list);
      renderDash();
      reopen(focus);
    }
    function reopen(focus) {
      var H = window.HCDetail;
      if (H && typeof H.open === 'function') H.open('dash-edit', null, focus ? { focus: focus } : undefined);
    }
    document.addEventListener('click', function (e) {
      var b = e && e.target && e.target.closest ? e.target.closest('[data-dash-act]') : null;
      if (!b) return;
      var key = b.getAttribute('data-key'), act = b.getAttribute('data-dash-act');
      // keep focus on the control just used (or its row's toggle when the move disabled it)
      commit(edit(current(), key, act), '[data-dash-act="' + act + '"][data-key="' + key + '"]');
    });

    /* ≡ drag (Pointer Events, so mouse, touch and pen alike): pointerdown on a handle captures the
     * pointer, every move puts the row where the pointer is (the DOM row moves live), the drop saves
     * through commit() like ↑ / ↓; a cancel re-renders the saved order. Only the primary pointer starts
     * a drag (never a second finger), a mouse only with its main button, and never while one is active.
     * A lost capture is re-taken while the pointer is active, else it cancels like pointercancel; a drag
     * whose row left the page (sheet closed or
     * re-rendered) is stale and never blocks the next one. */
    var drag = null;
    function clearDrag() {
      if (drag) drag.li.classList.remove('db-drag');
      drag = null;
    }
    function rowsBut(d) {
      return [].slice.call(d.ul.children).filter(function (r) { return r !== d.li; });
    }
    document.addEventListener('pointerdown', function (e) {
      if (drag && !drag.li.isConnected) clearDrag();
      if (drag || !e || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var g = e && e.target && e.target.closest ? e.target.closest('[data-dash-grip]') : null;
      var li = g && g.closest('li');
      if (!li || !li.parentNode) return;
      var from = [].slice.call(li.parentNode.children).indexOf(li);
      drag = { id: e.pointerId, grip: g, li: li, ul: li.parentNode, key: li.getAttribute('data-key') || g.getAttribute('data-key'), from: from, to: from };
      try { g.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety: document listeners still see the moves */ }
      li.classList.add('db-drag');
      e.preventDefault();
    });
    document.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var others = rowsBut(drag), to = 0;
      others.forEach(function (r) {
        var b = r.getBoundingClientRect();
        if (b.top + b.height / 2 < e.clientY) to++;
      });
      if (to !== drag.to) {
        drag.ul.insertBefore(drag.li, others[to] || null);
        drag.to = to;
      }
      e.preventDefault();
    });
    function endDrag(e, save) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag;
      drag = null;
      d.li.classList.remove('db-drag');
      try { d.grip.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      if (save && d.to !== d.from) {
        var list = current();
        commit(move(list, indexOf(list, d.key), d.to));
      } else if (d.to !== d.from) reopen();
    }
    document.addEventListener('pointerup', function (e) { endDrag(e, true); });
    document.addEventListener('pointercancel', function (e) { endDrag(e, false); });
    // moving the row in the DOM drops the capture (Chromium fires lostpointercapture on every live
    // reorder): while the row is on the page, take it back; only when that fails (the pointer is gone)
    // or the row left the page does the lost capture cancel like pointercancel
    document.addEventListener('lostpointercapture', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.li.isConnected) {
        try { drag.grip.setPointerCapture(e.pointerId); return; } catch (err) { /* the pointer is no longer active */ }
      }
      endDrag(e, false);
    });

    window.HCDash = { prefsFrom: prefsFrom, serialize: serialize, edit: edit, move: move, rowValue: rowValue, render: renderDash, CATALOG: CATALOG, DEFAULT_ON: DEFAULT_ON, PREFS_KEY: PREFS_KEY };
    renderDash();
  }
  boot();
})();
