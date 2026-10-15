/* Inicio "My journal" card (#my-journal, after Tonight) + the journal sheet (registered view 'journal').
 * Design: docs/journal.md. The behaviour list, groups and limits come from the bake (SCORES.journal,
 * lib/journal/bake.mjs over lib/journal/journal.mjs), the copy from I18N_SCORE.home.journal.
 *
 * LAN page only for writing, like the food log: the sheet exists only once GET /api/journal/settings
 * answered (loop-web proxies /api/journal/ to the ingest service, every request carries
 * `X-HC-Journal: 1`). Then the card shows the 7 days ending on the viewer's today (Date.now(), never
 * baked) with a check circle per journaled day (GET /api/journal/summary), the "+" popover lists
 * "Complete your journal" (client/nav-actions.js) and a tap on the card / a day opens the sheet on that
 * day. Without the API (example build, file://, a static copy) the card still shows when the build
 * baked a journal (SCORES.journal.recent: the synced journal-daily.csv, the example's demo data), its
 * columns read-only, and nothing can be written.
 *
 * Behaviour insights (registered view 'journal-insights', every build with a journal): the baked
 * SCORES.journal.insights rows (lib/journal/journal.mjs behaviorInsights) as impact rows — UPPERCASE
 * behaviour, the signed difference in recovery points, a bar from a centre dot (--up better, --down
 * worse) — best first, then the behaviours that need more data; the ⓘ states the formula and that it
 * is an association, not causation.
 *
 * The sheet: a strip of the same 7 days (the picked one ringed), "What's happening today?" (or "What
 * happened on <date>?"), the switched-on behaviours grouped DAYTIME / NIGHTTIME / STATUS as rows with a
 * ✕ / ✓ pair (a pressed answer pressed again = not answered), the drinks as ✕ (= 0) + a − n + stepper,
 * a note, the behaviours' on / off list (a fold; stored server-side, PUT /api/journal/settings) and a
 * sticky "SAVE JOURNAL" pill: PUT /api/journal/day (the whole day, idempotent), then the sheet closes
 * and the card re-renders (only the sheet that saved: one reopened meanwhile stays). One save at a time:
 * while it is in flight the pill is disabled, the note read-only and every edit refused. An unsaved draft
 * survives a re-render of the open sheet and is dropped when another day is picked or the sheet closes
 * (the next fresh open starts from the saved day). Errors are one line from the coarse codes.
 *
 * Classic script in layouts/Plan.astro's end-of-body list, after home-dash.js and before deepdive.js /
 * detail.js. Each render runs in its own try/catch; a throw hides the card. */
(function () {
  function boot() {
    var T = typeof I18N_SCORE !== 'undefined' && I18N_SCORE && I18N_SCORE.home ? I18N_SCORE.home.journal : null;
    var J = typeof SCORES !== 'undefined' && SCORES && SCORES.journal && Array.isArray(SCORES.journal.behaviors) ? SCORES.journal : null;
    if (!T || !J || typeof HC === 'undefined') return;
    var esc = HC.esc, format = HC.format;
    var API = '/api/journal', TIMEOUT_MS = 15000, WEEK = 7;
    var LIM = J.limits || { countMax: 20, notesMax: 500 };
    var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg>';
    var CROSS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
    // ready: the API answered; on: {key: bool}; days: {iso: {date, answers, notes}} of the strip window
    // inSheet: the next render is a re-render of the open sheet (reopen), not a fresh open; session counts
    // fresh opens, so a save that answers after the sheet was closed and opened again never closes it
    var S = { ready: false, on: {}, days: {}, draft: null, saving: false, msg: '', err: false, manage: false, inSheet: false, session: 0 };

    function own(o, k) {
      return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
    }
    function byKey(k) {
      for (var i = 0; i < J.behaviors.length; i++) if (J.behaviors[i].key === k) return J.behaviors[i];
      return null;
    }

    /* ---------- pure ---------- */
    // the 7 ISO days ending on `today`, oldest first
    function weekDays(today) {
      var out = [];
      for (var i = WEEK - 1; i >= 0; i--) out.push(HC.shiftIso(today, -i));
      return out;
    }
    // true / false = answered, null = not answered (a count > 0 is a yes)
    function did(answers, key) {
      var b = byKey(key), v = answers && own(answers, key) ? answers[key] : null;
      if (!b || v == null) return null;
      if (b.kind === 'count') return typeof v === 'number' && isFinite(v) ? v > 0 : null;
      return typeof v === 'boolean' ? v : null;
    }
    function journaled(day) {
      if (!day || !day.answers) return false;
      return J.behaviors.some(function (b) { return did(day.answers, b.key) !== null; });
    }
    // a ✕ / ✓ / stepper press on the draft answers (pure): returns the new answers
    function press(answers, key, act) {
      var b = byKey(key), out = {};
      Object.keys(answers || {}).forEach(function (k) { out[k] = answers[k]; });
      if (!b) return out;
      var cur = own(out, key) ? out[key] : null;
      var next = cur;
      if (b.kind === 'count') {
        var n = typeof cur === 'number' ? cur : null;
        if (act === 'no') next = n === 0 ? null : 0;
        else if (act === 'inc') next = Math.min(LIM.countMax, (n || 0) + 1);
        else if (act === 'dec') next = n == null ? null : Math.max(0, n - 1);
      } else if (act === 'no' || act === 'yes') {
        var v = act === 'yes';
        next = cur === v ? null : v;
      }
      if (next == null) delete out[key];
      else out[key] = next;
      return out;
    }

    /* ---------- API ---------- */
    // HC.jsonApi (util.js), with the journal API's own X-HC-Journal header
    var api = HC.jsonApi(API, 'X-HC-Journal', TIMEOUT_MS);

    /* ---------- card ---------- */
    function dayLabel(iso) {
      var N = typeof I18N_DATE !== 'undefined' && I18N_DATE ? I18N_DATE : null;
      return N ? N.weekdays[HC.weekdayIndex(iso)] : iso.slice(5);
    }
    // the baked journaled dates (SCORES.journal.recent): the card's checks when there is no API
    var BAKED = {};
    (Array.isArray(J.recent) ? J.recent : []).forEach(function (d) { if (HC.isoDate(d)) BAKED[d] = true; });
    function isDone(d) {
      return S.ready ? journaled(S.days[d]) : own(BAKED, d);
    }
    function hasInsights() {
      return !!(J.insights && Array.isArray(J.insights.rows) && J.insights.rows.length);
    }
    // the card's last day: the viewer's today, except a baked (no API) journal whose newest day is older
    // than the 7-day window: then that journal's own last week (a stale bake never reads as empty)
    function cardEnd(today) {
      if (S.ready) return today;
      var dates = Object.keys(BAKED);
      if (J.insights && HC.isoDate(J.insights.asOf)) dates.push(J.insights.asOf);
      var newest = dates.sort().pop();
      return newest && newest < HC.shiftIso(today, -(WEEK - 1)) ? newest : today;
    }
    function cardHtml(today) {
      var live = S.ready;
      today = cardEnd(today);
      var cols = weekDays(today).map(function (d) {
        var on = isDone(d);
        var aria = format(on ? T.dayDone : T.dayOpen, { day: HC.fmtDate(d) });
        var inner = '<span class="jr-wd">' + esc(dayLabel(d)) + '</span><span class="jr-dot' + (on ? ' jr-on' : '') + '">' + (on ? CHECK : '') + '</span>';
        // without the API the columns only show (no sheet to open)
        return '<li>' + (live
          ? '<button type="button" class="jr-day" data-detail="journal" data-date="' + d + '" aria-haspopup="dialog" aria-label="' + esc(aria) + '">' + inner + '</button>'
          : '<span class="jr-day" role="img" aria-label="' + esc(aria) + '">' + inner + '</span>') + '</li>';
      }).join('');
      var ins = hasInsights()
        ? '<button type="button" class="jr-ins" data-detail="journal-insights" aria-haspopup="dialog">' + esc(T.insights) + '</button>' : '';
      return '<div class="sc-card jr">' +
        '<div class="jr-top"><h3 class="tn-h">' + esc(T.heading) + '</h3>' +
        (live ? '<button type="button" class="nav-btn jr-chev" data-detail="journal" aria-haspopup="dialog" aria-label="' + esc(T.open) + '"><span class="chev" aria-hidden="true">›</span></button>' : '') + '</div>' +
        '<ol class="jr-week">' + cols + '</ol>' + ins + '</div>';
    }
    function renderCard() {
      var host = document.getElementById('my-journal');
      if (!host) return;
      try {
        // the API (LAN page), or a baked journal (the synced CSV, the example's demo data)
        var show = S.ready || Object.keys(BAKED).length > 0 || hasInsights();
        host.innerHTML = show ? cardHtml(HC.todayIso()) : '';
        host.hidden = !show;
      } catch (e) {
        host.innerHTML = '';
        host.hidden = true;
      }
    }

    /* ---------- behaviour insights (baked, every build with a journal) ---------- */
    var INFO = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>';
    function signed(v) {
      var n = HC.num(Math.abs(v), 0);
      return (v > 0 ? '+' : v < 0 ? '−' : '') + n + '%';
    }
    // ok rows by impact (best first), then the rows that need more data, in the list order
    function insightRows(rows) {
      var ok = rows.filter(function (r) { return r.status === 'ok' && typeof r.diff === 'number'; });
      ok.sort(function (a, b) { return b.diff - a.diff; });
      return ok.concat(rows.filter(function (r) { return ok.indexOf(r) === -1; }));
    }
    // the bar: a centre dot, the fill to the right (better) or left (worse); scale = the largest
    // |difference| shown, at least 20 points, = half the bar
    function barStyle(diff, scale) {
      var half = Math.min(50, (Math.abs(diff) / scale) * 50);
      return 'left:' + (diff >= 0 ? 50 : 50 - half).toFixed(1) + '%;width:' + half.toFixed(1) + '%';
    }
    function insightsHtml() {
      var I = J.insights, min = (J.limits && J.limits.insightMinDays) || 5;
      var rows = insightRows(I.rows);
      var scale = Math.max(20, Math.max.apply(null, rows.map(function (r) { return typeof r.diff === 'number' ? Math.abs(r.diff) : 0; })));
      var ok = rows.filter(function (r) { return r.status === 'ok'; });
      var need = rows.filter(function (r) { return r.status !== 'ok'; });
      var list = ok.map(function (r) {
        var name = T.names[r.key] || r.key;
        var tone = Math.abs(r.diff) < 1 ? 'flat' : r.diff > 0 ? 'up' : 'down';
        var aria = format(T.rowAria, { name: name, diff: (r.diff > 0 ? '+' : '') + HC.num(r.diff, 1), yesMean: HC.num(r.yesMean, 0), noMean: HC.num(r.noMean, 0), yes: r.yesDays, no: r.noDays });
        return '<li class="ji-row" aria-label="' + esc(aria) + '"><span class="ji-name" aria-hidden="true">' + esc(name) + '</span>' +
          '<b class="ji-pct ji-' + tone + '" aria-hidden="true">' + esc(signed(r.diff)) + '</b>' +
          '<span class="ji-bar" aria-hidden="true"><i class="ji-fill ji-' + tone + '" style="' + barStyle(r.diff, scale) + '"></i><i class="ji-dot"></i></span></li>';
      }).join('');
      // the behaviours without enough days share ONE card (not one identical "Need more data" card
      // each): with nothing scored yet, what is needed + how many days count so far; else their counts
      if (need.length) {
        var counted = Math.max.apply(null, need.map(function (r) { return (r.yesDays || 0) + (r.noDays || 0); }));
        list += '<li class="ji-row ji-empty"><span class="ji-name">' + esc(T.need) + '</span>' + (ok.length
          ? '<p class="jr-msg">' + esc(format(T.needSome, { min: min })) + '</p><ul class="ji-need-list">' + need.map(function (r) {
            return '<li>' + esc(format(T.needItem, { name: T.names[r.key] || r.key, yes: r.yesDays, no: r.noDays })) + '</li>';
          }).join('') + '</ul>'
          : '<p class="jr-msg">' + esc(format(T.needAll, { min: min, n: counted })) + '</p>') + '</li>';
      }
      var days = Math.round((HC.parseIso(I.asOf) - HC.parseIso(I.from)) / HC.MS_PER_DAY) + 1;
      return {
        head: '',
        body: '<div class="jr-top"><p class="jr-g">' + esc(format(T.window, { n: days, date: HC.fmtDate(I.asOf) })) + '</p>' +
          '<button type="button" class="sh-info" data-dt-act="info" aria-expanded="false" aria-controls="dd-info" aria-label="' + esc(T.infoLabel) + '">' + INFO + '</button></div>' +
          '<div class="dd-info dt-info" id="dd-info" hidden><p>' + esc(format(T.info, { min: min })) + '</p><p>' + esc(T.caveat) + '</p></div>' +
          '<h3 class="jr-q">' + esc(T.impact) + '</h3><p class="dt-note">' + esc(T.intro) + '</p>' +
          (ok.length ? '<div class="ji-leg" aria-hidden="true"><span class="ji-down">▼ ' + esc(T.hurts) + '</span><span>' + esc(T.pct) + '</span><span class="ji-up">' + esc(T.helps) + ' ▲</span></div>' : '') +
          '<ul class="jr-rows">' + list + '</ul>',
      };
    }
    if (hasInsights()) {
      HC.registerView('journal-insights', {
        title: function () { return T.insightsTitle; },
        render: insightsHtml,
      });
    }

    /* ---------- sheet ---------- */
    function sheetDate() {
      var st = window.HCDetail && typeof window.HCDetail.state === 'function' ? window.HCDetail.state() : null;
      var today = HC.todayIso(), d = st && st.key === 'journal' && HC.isoDate(st.date) ? st.date : today;
      return d > today || d < HC.shiftIso(today, -(WEEK - 1)) ? today : d;
    }
    function draftFor(date) {
      if (S.draft && S.draft.date === date) return S.draft;
      var day = S.days[date] || {};
      var answers = {};
      Object.keys(day.answers || {}).forEach(function (k) { answers[k] = day.answers[k]; });
      S.draft = { date: date, answers: answers, notes: day.notes || '' };
      S.msg = '';
      return S.draft;
    }
    function pair(b, v, q) {
      var no = b.kind === 'count' ? v === 0 : v === false;
      var html = '<button type="button" class="jr-x" data-jr="no" data-key="' + b.key + '" aria-pressed="' + no + '" aria-label="' + esc(format(T.no, { q: q })) + '">' + CROSS + '</button>';
      if (b.kind === 'count') {
        var n = typeof v === 'number' ? v : null;
        return html + '<span class="jr-step"><button type="button" class="jr-x" data-jr="dec" data-key="' + b.key + '" aria-label="' + esc(T.less) + '"' + (n ? '' : ' disabled') + '>−</button>' +
          // unanswered = a dimmed "0" (a "–" read as the minus beside it); its spoken form stays "—"
          '<b class="jr-n' + (n == null ? ' jr-n-none' : '') + '" aria-live="polite" aria-label="' + esc(format(T.count, { n: n == null ? '—' : n })) + '">' + (n == null ? 0 : n) + '</b>' +
          '<button type="button" class="jr-x" data-jr="inc" data-key="' + b.key + '" aria-label="' + esc(T.more) + '"' + (n != null && n >= LIM.countMax ? ' disabled' : '') + '>+</button></span>';
      }
      return html + '<button type="button" class="jr-x jr-y" data-jr="yes" data-key="' + b.key + '" aria-pressed="' + (v === true) + '" aria-label="' + esc(format(T.yes, { q: q })) + '">' + CHECK + '</button>';
    }
    function stripHtml(sel, today) {
      return '<div class="jr-strip" role="group">' + weekDays(today).map(function (d) {
        var on = journaled(S.days[d]);
        return '<button type="button" class="jr-sd" data-jr="day" data-date="' + d + '" aria-pressed="' + (d === sel) + '" aria-label="' + esc(format(on ? T.dayDone : T.dayOpen, { day: HC.fmtDate(d) })) + '">' +
          '<span class="jr-wd">' + HC.parseIso(d).getDate() + '</span><span class="jr-dot' + (on ? ' jr-on' : '') + '">' + (on ? CHECK : '') + '</span></button>';
      }).join('') + '</div>';
    }
    function sheetHtml() {
      var today = HC.todayIso(), date = sheetDate(), d = draftFor(date);
      var rows = J.groups.map(function (g) {
        var list = J.behaviors.filter(function (b) { return b.group === g && S.on[b.key] !== false; });
        if (!list.length) return '';
        return '<p class="jr-g">' + esc(T.groups[g]) + '</p><ul class="jr-rows">' + list.map(function (b) {
          var q = T.q[b.key] || b.key, v = own(d.answers, b.key) ? d.answers[b.key] : null;
          return '<li class="jr-row"><span class="jr-txt">' + esc(q) + '</span><span class="jr-ctl">' + pair(b, v, q) + '</span></li>';
        }).join('') + '</ul>';
      }).join('');
      var manage = '<details class="jr-man"' + (S.manage ? ' open' : '') + '><summary class="jr-g" data-jr="man">' + esc(T.manage) + ' <span class="chev" aria-hidden="true">›</span></summary>' +
        '<p class="dt-note">' + esc(T.manageNote) + '</p><ul class="jr-rows">' + J.behaviors.map(function (b) {
          var on = S.on[b.key] !== false, name = T.names[b.key] || b.key;
          return '<li class="jr-row"><span class="jr-txt">' + esc(name) + '</span>' + HC.switchBtn(on, format(T.toggle, { name: name }), ' data-jr="tog" data-key="' + b.key + '"') + '</li>';
        }).join('') + '</ul></details>';
      var q = date === today ? T.today : format(T.past, { date: HC.fmtDate(date) });
      return {
        head: stripHtml(date, today),
        body: '<h3 class="jr-q">' + esc(q) + '</h3>' + (rows || '<p class="dt-note">' + esc(T.allOff) + '</p>') +
          '<label class="jr-g" for="jr-notes">' + esc(T.notes) + '</label>' +
          '<textarea id="jr-notes" class="jr-notes" rows="3" maxlength="' + LIM.notesMax + '" placeholder="' + esc(T.notesPh) + '"' + (S.saving ? ' readonly' : '') + '>' + esc(d.notes) + '</textarea>' +
          manage +
          '<p class="jr-msg' + (S.err ? ' jr-err' : '') + '" role="status" aria-live="polite">' + esc(S.msg) + '</p>' +
          '<div class="jr-save"><button type="button" class="save-btn" data-jr="save"' + (S.saving ? ' disabled' : '') + '>' + esc(S.saving ? T.saving : T.save) + '</button></div>',
      };
    }
    function reopen(focus) {
      var H = window.HCDetail;
      if (!H || typeof H.open !== 'function' || !S.draft) return;
      S.inSheet = true;
      try { H.open('journal', S.draft.date, { focus: focus }); } finally { S.inSheet = false; }
    }
    // the view's render: a fresh open (from the card, the "+", a deep link) starts from the SAVED day,
    // so a draft left by closing the sheet never comes back; a re-render (reopen) keeps it
    function renderSheet() {
      if (!S.inSheet) {
        S.session++;
        S.draft = null;
        S.msg = '';
        S.err = false;
      }
      return sheetHtml();
    }

    function save() {
      var d = S.draft;
      // one save at a time: the pill is disabled and every edit refused until it answers
      if (!d || S.saving) return;
      var session = S.session;
      S.saving = true;
      S.msg = '';
      S.err = false;
      reopen('[data-jr="save"]');
      var notes = String(d.notes || '').trim();
      api('PUT', '/day', { date: d.date, answers: d.answers, notes: notes || null }).then(function (r) {
        S.saving = false;
        var day = r && r.day;
        if (day && journaled(day)) S.days[d.date] = day;
        else if (day && day.notes) S.days[d.date] = day;
        else delete S.days[d.date];
        S.draft = null;
        renderCard();
        // close the sheet this save came from, never one opened again meanwhile
        var st = window.HCDetail && typeof window.HCDetail.state === 'function' ? window.HCDetail.state() : null;
        if (session === S.session && st && st.key === 'journal' && typeof window.HCDetail.close === 'function') window.HCDetail.close();
      }, function (err) {
        S.saving = false;
        S.err = true;
        if (session !== S.session) return; // the sheet was closed: its draft is gone anyway
        S.msg = err && err.code === 'offline' ? T.offline : format(T.failed, { code: (err && err.code) || 'generic' });
        reopen('[data-jr="save"]');
      });
    }
    function toggle(key) {
      var patch = {};
      patch[key] = S.on[key] === false;
      S.manage = true;
      api('PUT', '/settings', { behaviors: patch }).then(function (r) {
        if (r && r.behaviors) S.on = r.behaviors;
        S.err = false;
        S.msg = '';
        reopen('[data-jr="tog"][data-key="' + key + '"]');
      }, function (err) {
        S.err = true;
        S.msg = err && err.code === 'offline' ? T.offline : format(T.failed, { code: (err && err.code) || 'generic' });
        reopen('[data-jr="tog"][data-key="' + key + '"]');
      });
    }

    document.addEventListener('click', function (e) {
      var b = e && e.target && e.target.closest ? e.target.closest('[data-jr]') : null;
      if (!b || !S.ready) return;
      var act = b.getAttribute('data-jr'), key = b.getAttribute('data-key');
      if (act === 'man') { S.manage = !(b.parentElement && b.parentElement.open); return; }
      if (S.saving) return; // the request in flight carries the draft as it was: no edit may slip in
      if (act === 'save') { save(); return; }
      if (act === 'tog') { toggle(key); return; }
      if (act === 'day') {
        var date = HC.isoDate(b.getAttribute('data-date'));
        if (!date) return;
        if (!S.draft || S.draft.date !== date) S.draft = null;
        draftFor(date);
        reopen('[data-jr="day"][data-date="' + date + '"]');
        return;
      }
      if (!S.draft || !byKey(key)) return;
      S.draft.answers = press(S.draft.answers, key, act);
      S.msg = '';
      reopen('[data-jr="' + act + '"][data-key="' + key + '"]');
    });
    document.addEventListener('input', function (e) {
      var t = e && e.target;
      if (t && t.id === 'jr-notes' && S.draft && !S.saving) S.draft.notes = String(t.value || '').slice(0, LIM.notesMax);
    });

    function register() {
      HC.registerView('journal', {
        title: function () { return T.sheetTitle; },
        render: renderSheet,
      });
    }

    function load() {
      return api('GET', '/settings').then(function (r) {
        S.on = r && r.behaviors && typeof r.behaviors === 'object' ? r.behaviors : {};
        var today = HC.todayIso();
        return api('GET', '/summary?from=' + HC.shiftIso(today, -(WEEK - 1)) + '&to=' + today).then(function (s) {
          S.days = {};
          (s && Array.isArray(s.days) ? s.days : []).forEach(function (d) { if (d && HC.isoDate(d.date)) S.days[d.date] = d; });
        }, function () { S.days = {}; }).then(function () {
          S.ready = true;
          register();
          renderCard();
          if (window.HCActions) {
            try { window.HCActions.refresh(); } catch (e) { /* the "+" keeps its last state */ }
          }
          // a deep link to the sheet waited for the API (detail.js leaves an async view's hash alone)
          if (typeof location !== 'undefined' && location.hash === '#journal' && window.HCDetail) window.HCDetail.open('journal', null, {});
        });
      }, function () { /* no journal API (example build, file://, old service): nothing appears */ });
    }

    window.HCJournal = {
      weekDays: weekDays, did: did, journaled: journaled, press: press, render: renderCard, insightRows: insightRows, barStyle: barStyle,
      ready: function () { return S.ready; }, state: function () { return S; }, load: load,
    };
    renderCard();
    if (typeof fetch === 'function') load();
  }
  boot();
})();
