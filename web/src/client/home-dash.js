/* Inicio "My dashboard" (#my-dash, after "My plan"): a stack of single-row metric cards — icon ·
 * UPPERCASE metric · the latest value on the right, the 30-day baseline under it and an arrow vs that
 * baseline (▲▼ --up better / --down worse by the metric's good direction, grey for a neutral metric,
 * a grey dot when within ±FLAT_SHARE). Only metrics present in the baked DETAIL (lib/detail/detail.mjs);
 * the same series, titles and units as the detail sheet (I18N_DETAIL), so nothing new is computed
 * beyond the baseline mean. A row opens that metric's detail sheet.
 *
 * Value = the newest day with data up to the viewer's today (a daily total skips today, still filling
 * up); baseline = the mean of the BASE_DAYS (30) days before that day, with at least MIN_BASE (7) days
 * of data (MIN_BASE_SPARSE (2) readings for a sparse series such as weight); no baseline → no arrow.
 *
 * "Customize ✎" opens a registered sheet ('dash-edit', client/detail.js modal) to show / hide and move
 * rows up / down. Preferences live in localStorage (PREFS_KEY) as {order, hidden}; every read and
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
    var CATALOG = ['rhr', 'hrv', 'sleep', 'weight', 'steps', 'vo2max', 'walkingHr', 'exercise'];
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
    // up / down / toggle on the list (pure): returns a new list
    function edit(list, key, act) {
      var out = list.map(function (x) { return { key: x.key, on: x.on }; });
      var i = -1;
      out.forEach(function (x, j) { if (x.key === key) i = j; });
      if (i === -1) return out;
      if (act === 'toggle') out[i].on = !out[i].on;
      else if (act === 'up' && i > 0) out.splice(i - 1, 0, out.splice(i, 1)[0]);
      else if (act === 'down' && i < out.length - 1) out.splice(i + 1, 0, out.splice(i, 1)[0]);
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
    var ICON = {
      rhr: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
      hrv: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
      sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
      weight: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9.5a4 4 0 0 1 6 0L12.5 12"/>',
      steps: '<path d="M8 3c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5zM6 15h4v2a2 2 0 0 1-4 0zM16 7c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5z"/>',
      vo2max: '<path d="M4 16a8 8 0 0 1 16 0M12 16l4-5"/>',
      walkingHr: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6 3 3v3M8 11l2-3h3l2 4 3 1"/>',
      exercise: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    };
    function icon(key) {
      return '<svg class="db-ico" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[key] || ICON.hrv) + '</svg>';
    }
    function titleOf(key) {
      return own(TD.metrics, key) && TD.metrics[key].title ? TD.metrics[key].title : key;
    }
    function unitOf(key) {
      return own(TD.metrics, key) && TD.metrics[key].unit ? TD.metrics[key].unit : '';
    }
    function fmt(key, m, v) {
      if (key === 'sleep') { // hours → 7:32
        var min = Math.round(v * 60);
        return Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0');
      }
      return HC.num(v, m.dec || 0);
    }
    function rowHtml(key, m, r) {
      var unit = key === 'sleep' ? '' : unitOf(key);
      var arrow = r.arrow === 'up' ? '▲' : r.arrow === 'down' ? '▼' : r.arrow === 'flat' ? '•' : '';
      var stale = HC.daysOld(r.date) > HC.STALE_DAYS;
      var aria = format(TS.rowAria, { metric: titleOf(key), value: fmt(key, m, r.value) + (unit ? ' ' + unit : ''), date: HC.fmtDate(r.date) }) +
        (r.base != null ? ' · ' + format(TS.baseAria, { base: fmt(key, m, r.base) + (unit ? ' ' + unit : '') }) + ' · ' + TS.dirs[r.arrow] : '');
      return '<li class="db-row' + (stale ? ' db-stale' : '') + '"' + HC.detailAttrs(key) + ' aria-label="' + esc(aria) + '">' + icon(key) +
        '<span class="db-name">' + esc(titleOf(key)) + '</span>' +
        '<span class="db-vals"><span class="db-val"><b>' + esc(fmt(key, m, r.value)) + '</b>' + (unit ? '<small>' + esc(unit) + '</small>' : '') +
        (arrow ? '<span class="db-arr db-' + r.tone + '" aria-hidden="true">' + arrow + '</span>' : '') + '</span>' +
        (r.base != null ? '<span class="db-base">' + esc(fmt(key, m, r.base)) + '</span>' : '') + '</span></li>';
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
    function editHtml(list) {
      return '<p class="dt-note">' + esc(TS.editNote) + '</p><ul class="db-edit">' + list.map(function (p, i) {
        var t = titleOf(p.key);
        return '<li class="db-erow' + (p.on ? '' : ' db-off') + '">' + icon(p.key) + '<span class="db-name">' + esc(t) + '</span>' +
          '<button type="button" class="db-btn db-tog" data-dash-act="toggle" data-key="' + esc(p.key) + '" aria-pressed="' + (p.on ? 'true' : 'false') + '" aria-label="' + esc(format(TS.showAria, { metric: t })) + '">' + esc(p.on ? TS.shown : TS.hidden) + '</button>' +
          '<button type="button" class="db-btn" data-dash-act="up" data-key="' + esc(p.key) + '" aria-label="' + esc(format(TS.upAria, { metric: t })) + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="db-btn" data-dash-act="down" data-key="' + esc(p.key) + '" aria-label="' + esc(format(TS.downAria, { metric: t })) + '"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button></li>';
      }).join('') + '</ul>';
    }
    window.HCViews = window.HCViews || {};
    window.HCViews['dash-edit'] = {
      title: function () { return TS.editTitle; },
      render: function () { return { head: '', body: editHtml(current()) }; },
    };
    document.addEventListener('click', function (e) {
      var b = e && e.target && e.target.closest ? e.target.closest('[data-dash-act]') : null;
      if (!b) return;
      var key = b.getAttribute('data-key'), act = b.getAttribute('data-dash-act');
      var list = edit(current(), key, act);
      writePrefs(list);
      renderDash();
      // re-render the open sheet, keeping focus on the control just used (or its row's toggle when
      // the move disabled it)
      var H = window.HCDetail;
      if (H && typeof H.open === 'function') H.open('dash-edit', null, { focus: '[data-dash-act="' + act + '"][data-key="' + key + '"]' });
    });

    window.HCDash = { prefsFrom: prefsFrom, serialize: serialize, edit: edit, rowValue: rowValue, render: renderDash, CATALOG: CATALOG, DEFAULT_ON: DEFAULT_ON, PREFS_KEY: PREFS_KEY };
    renderDash();
  }
  boot();
})();
