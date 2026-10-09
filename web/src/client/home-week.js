/* Inicio "Tonight" + "My plan" (after "My day" and the eat card): honest versions of a bedtime card
 * and a weekly plan, built only from data the page already bakes — no invented metric.
 *
 * Tonight (#home-tonight): the recommended bedtime and the usual wake time joined by a dashed line,
 * from SCORES.tonight (lib/score/tonight.mjs: usual wake = the median wake clock of the last 14 nights,
 * bedtime = that − the 7.5 h sleep target; null under 7 nights → the card stays hidden). The rule is
 * stated in the sheet the card opens (the registered 'tonight' view), never on the card. No alarm
 * editing: the page cannot set one.
 *
 * My plan (#my-plan): a collapsible weekly card for the VIEWER's week (Monday to Sunday, Date.now(),
 * never baked) — "Weekly plan · N days left · X % accomplished" + a progress bar, and up to four goal
 * rows (done / target, a small bar, ▲ on pace / ▼ behind):
 *   sleep    nights this week (dated the wake-up day) asleep ≥ the target (DETAIL.metrics.sleep);
 *            weekly target GOALS.sleepNights (5 of 7);
 *   training distinct days with a session this week (DETAIL.sessions, the display rule) vs the days
 *            programmed this week (TRAINING, training-data.json), else vs the usual week = the median
 *            of the session days per week over the last TYPICAL_WEEKS (6) complete weeks (≥ 3 of them
 *            covered by the data; a usual week of 0 hides the row);
 *   food     days this week with ≥ 1 food log entry (window.HCAdherence's summary, LAN page only);
 *            target GOALS.foodDays (7);
 *   kcal     days this week on the kcal target (HCAdherence.dayState === 'on': a complete day within
 *            ±10 % of HCNutri.targetFor); target GOALS.kcalDays (5).
 * A row whose source is missing or stale (DETAIL's newest day > STALE_DAYS before today) is hidden; no
 * row → no card. % accomplished = the mean of min(1, done / target) over the shown rows. On pace = done
 * ≥ target × (days elapsed / 7). The food rows appear once the food log summary answers
 * (client/adherence.js calls HCWeekPlan.refresh after each read).
 *
 * Classic script in layouts/Plan.astro's end-of-body list: it runs at once, after HC, the baked globals
 * and adherence.js, and BEFORE detail.js, so the `tonight` sheet is registered before detail.js runs
 * (window.HCDetail is only used on a click). Each block renders in its own try/catch; a
 * throw hides that block. No host (#home-tonight / #my-plan) = nothing rendered. */
(function () {
  function boot() {
    var T = typeof I18N_SCORE !== 'undefined' && I18N_SCORE && I18N_SCORE.home ? I18N_SCORE.home : null;
    if (!T || typeof HC === 'undefined') return;
    var esc = HC.esc, format = HC.format;
    // weekly goal targets (profile.json has no goals block yet: these are the documented defaults)
    var GOALS = { sleepNights: 5, foodDays: 7, kcalDays: 5 };
    var TYPICAL_WEEKS = 6, MIN_TYPICAL_WEEKS = 3;
    var D = typeof DETAIL !== 'undefined' && DETAIL ? DETAIL : null;

    /* ---------- pure: the week ---------- */
    function fin(v) {
      return typeof v === 'number' && isFinite(v);
    }
    function weekOf(today) {
      var start = HC.shiftIso(today, -HC.weekdayIndex(today));
      return { start: start, end: HC.shiftIso(start, 6), elapsed: HC.weekdayIndex(today) + 1, daysLeft: 6 - HC.weekdayIndex(today) };
    }
    function valueAt(m, iso) {
      if (!m || !Array.isArray(m.v) || !HC.isoDate(m.start)) return null;
      var i = Math.round((HC.parseIso(iso) - HC.parseIso(m.start)) / HC.MS_PER_DAY);
      var v = i >= 0 && i < m.v.length ? m.v[i] : null;
      return fin(v) ? v : null;
    }
    function median(xs) {
      var s = xs.slice().sort(function (a, b) { return a - b; }), k = s.length >> 1;
      return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
    }
    function goalRow(key, done, target, wk, extra) {
      var r = { key: key, done: done, target: target, frac: Math.min(1, done / target), onTrack: done >= target * wk.elapsed / 7 - 1e-9 };
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
      return r;
    }
    // in: {today, asOf, sleep (DETAIL metric), sessions, sessionsStart, training ({iso: day}), food
    // (summary days | null), kcal ({iso: 'on' | …} | null), goals} -> null | {week, rows, pct}
    function weekGoals(inp) {
      var today = HC.isoDate(inp.today);
      if (!today) return null;
      var wk = weekOf(today), goals = inp.goals || GOALS, rows = [];
      var asOf = HC.isoDate(inp.asOf);
      var gap = asOf ? Math.round((HC.parseIso(today) - HC.parseIso(asOf)) / HC.MS_PER_DAY) : null;
      var fresh = gap != null && gap <= HC.STALE_DAYS;
      var days = [];
      for (var d = wk.start; d <= today; d = HC.shiftIso(d, 1)) days.push(d);
      // sleep: nights this week at or above the target
      var sl = inp.sleep;
      if (fresh && sl && fin(sl.target) && sl.target > 0) {
        var nights = days.filter(function (iso) { var v = valueAt(sl, iso); return v != null && v >= sl.target; }).length;
        rows.push(goalRow('sleep', nights, goals.sleepNights, wk, { hours: sl.target }));
      }
      // training: distinct session days vs the programmed days, else vs the usual week
      if (fresh && Array.isArray(inp.sessions)) {
        var on = {};
        inp.sessions.forEach(function (s) { if (s && HC.isoDate(s.d)) on[s.d] = true; });
        var done = days.filter(function (iso) { return on[iso]; }).length;
        var prog = 0, tr = inp.training && typeof inp.training === 'object' ? inp.training : {};
        for (var p = wk.start; p <= wk.end; p = HC.shiftIso(p, 1)) if (Object.prototype.hasOwnProperty.call(tr, p) && tr[p]) prog++;
        if (prog > 0) rows.push(goalRow('training', done, prog, wk, { basis: 'programmed' }));
        else {
          var weeks = [], first = HC.isoDate(inp.sessionsStart);
          for (var w = 1; w <= TYPICAL_WEEKS; w++) {
            var ws = HC.shiftIso(wk.start, -7 * w);
            if (!first || ws < first) break; // a week the data does not cover is not a rest week
            var n = 0;
            for (var j = 0; j < 7; j++) if (on[HC.shiftIso(ws, j)]) n++;
            weeks.push(n);
          }
          var typical = weeks.length >= MIN_TYPICAL_WEEKS ? Math.round(median(weeks)) : 0;
          if (typical > 0) rows.push(goalRow('training', done, typical, wk, { basis: 'typical' }));
        }
      }
      // food log (LAN page only): days with an entry, then days on the kcal target
      if (Array.isArray(inp.food)) {
        var logged = {};
        inp.food.forEach(function (x) { if (x && HC.isoDate(x.date) && x.n > 0) logged[x.date] = true; });
        rows.push(goalRow('food', days.filter(function (iso) { return logged[iso]; }).length, goals.foodDays, wk, {}));
        if (inp.kcal && typeof inp.kcal === 'object') {
          rows.push(goalRow('kcal', days.filter(function (iso) { return inp.kcal[iso] === 'on'; }).length, goals.kcalDays, wk, {}));
        }
      }
      if (!rows.length) return null;
      var sum = 0;
      rows.forEach(function (r) { sum += r.frac; });
      return { week: wk, rows: rows, pct: Math.round(100 * sum / rows.length) };
    }

    /* ---------- inputs from the page ---------- */
    function foodInputs(today) {
      var A = window.HCAdherence, out = { food: null, kcal: null };
      var st = A && typeof A.state === 'function' ? A.state() : null;
      if (!st || !Array.isArray(st.days)) return out;
      out.food = st.days;
      var N = window.HCNutri;
      if (!N || typeof N.targetFor !== 'function' || typeof A.dayState !== 'function') return out;
      var by = {}, k = {};
      st.days.forEach(function (x) { if (x && HC.isoDate(x.date)) by[x.date] = x; });
      for (var d = weekOf(today).start; d <= today; d = HC.shiftIso(d, 1)) {
        var t = null;
        try { t = N.targetFor(d); } catch (e) { t = null; }
        t = t && fin(t.k) ? { k: t.k, p: fin(t.p) ? t.p : null, inferred: !!t.inferred } : null;
        k[d] = A.dayState(by[d] || null, t);
      }
      out.kcal = k;
      return out;
    }
    function planInputs() {
      var today = HC.todayIso(), f = foodInputs(today);
      var M = D && D.metrics ? D.metrics : {};
      return {
        today: today,
        asOf: D ? D.asOf : null,
        sleep: M.sleep || null,
        sessions: D && Array.isArray(D.sessions) ? D.sessions : null,
        sessionsStart: M.workouts ? M.workouts.start : null,
        training: typeof TRAINING !== 'undefined' ? TRAINING : null,
        food: f.food,
        kcal: f.kcal,
      };
    }

    /* ---------- render: Tonight ---------- */
    var ICON = {
      moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
      alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 1.5M5 4 2.5 6.5M19 4l2.5 2.5"/>',
    };
    function icon(k, cls) {
      return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg>';
    }
    function clock(h) {
      if (!fin(h)) return '—';
      var m = Math.round((((h % 24) + 24) % 24) * 60) % 1440, H = Math.floor(m / 60), M = m % 60;
      return (H < 10 ? '0' : '') + H + ':' + (M < 10 ? '0' : '') + M;
    }
    function tonightData() {
      var S = typeof SCORES !== 'undefined' && SCORES ? SCORES.tonight : null;
      return S && fin(S.bed) && fin(S.wake) ? S : null;
    }
    function tonightHtml(tn) {
      var TT = T.tonight;
      // state: a teal "● Usual wake" line under the wake clock (the page sets no alarm: it is the
      // median of the last nights, which the caption under it names)
      var end = function (ico, time, lbl, state) {
        return '<div class="tn-end"><span class="tn-time">' + icon(ico, 'tn-ico') + '<b>' + esc(time) + '</b></span>' +
          (state ? '<span class="tn-lbl tn-state">' + esc(state) + '</span>' : '') + '<span class="tn-lbl">' + esc(lbl) + '</span></div>';
      };
      var wakeLbl = fin(tn.nights) && TT.nights ? format(TT.nights, { n: tn.nights }) : TT.wake;
      var stale = HC.daysOld(tn.asOf) > HC.STALE_DAYS;
      return '<div class="sc-card tn' + (stale ? ' sc-stale' : '') + '"' + HC.detailAttrs('tonight') +
        ' aria-label="' + esc(format(TT.aria, { bed: clock(tn.bed), wake: clock(tn.wake) })) + '">' +
        '<h3 class="tn-h">' + esc(TT.heading) + '</h3>' +
        '<div class="tn-row">' + end('moon', clock(tn.bed), TT.bed) + '<span class="tn-dash" aria-hidden="true"></span>' + end('alarm', clock(tn.wake), wakeLbl, TT.wakeState) + '</div></div>';
    }
    // Inicio's day stepping (window.HCDay): Tonight is about the coming night, so a PAST day hides it
    function pastDay() {
      var D = typeof HCDay !== 'undefined' && HCDay ? HCDay : null;
      return !!(D && typeof D.sel === 'function' && D.sel());
    }
    function renderTonight() {
      var host = document.getElementById('home-tonight');
      if (!host) return;
      try {
        var tn = pastDay() ? null : tonightData();
        host.innerHTML = tn ? tonightHtml(tn) : '';
        host.hidden = !tn;
      } catch (e) {
        host.innerHTML = '';
        host.hidden = true;
      }
    }
    // the sheet behind the card: the rule, with the owner's own numbers, and a way to the sleep history
    window.HCViews = window.HCViews || {};
    window.HCViews.tonight = {
      title: function () { return T.tonight.heading; },
      render: function () {
        var tn = tonightData(), TT = T.tonight;
        if (!tn) return { head: '', body: '<p class="dt-empty">' + esc(TT.none) + '</p>' };
        var head = '<div class="dt-latest"><b class="dt-num">' + esc(clock(tn.bed)) + '</b><span class="dt-when">' + esc(TT.bed) + '</span></div>';
        var body = '<p class="tn-rule">' + esc(format(TT.rule, { wake: clock(tn.wake), n: tn.nights, target: HC.hours(tn.target), bed: clock(tn.bed) })) + '</p>' +
          '<p class="dt-note">' + esc(TT.note) + '</p>' +
          (D && D.metrics && D.metrics.sleep ? '<button type="button" class="tn-more" data-detail="sleep">' + esc(TT.history) + '</button>' : '');
        return { head: head, body: body };
      },
    };

    /* ---------- render: My plan ---------- */
    var open = false; // the card's expanded state survives a re-render (food summary answers later)
    function rowHtml(r) {
      var P = T.plan, lbl = format(P.rows[r.key], { hours: r.hours != null ? HC.hours(r.hours) : '' });
      var sub = r.key === 'training' ? P.basis[r.basis] : format(P.goal, { n: r.target });
      var link = r.key === 'sleep' ? HC.detailAttrs('sleep') : r.key === 'training' ? HC.detailAttrs('workouts') : '';
      var tone = r.onTrack ? 'up' : 'down';
      return '<li class="wp-row"' + link + '><span class="wp-lbl">' + esc(lbl) + '<small>' + esc(sub) + '</small></span>' +
        '<span class="wp-val"><b>' + r.done + '</b>/' + r.target + ' <span class="wp-arr wp-' + tone + '" aria-hidden="true">' + (r.onTrack ? '▲' : '▼') + '</span><span class="sr-only">' + esc(r.onTrack ? P.onTrack : P.behind) + '</span></span>' +
        '<span class="wp-bar" aria-hidden="true"><i class="wp-' + tone + '" style="width:' + Math.round(r.frac * 100) + '%"></i></span></li>';
    }
    function planHtml(g) {
      var P = T.plan, left = g.week.daysLeft;
      var leftTxt = left === 0 ? P.lastDay : left === 1 ? P.oneLeft : format(P.daysLeft, { n: left });
      return '<details class="sc-card wp"' + (open ? ' open' : '') + '><summary class="wp-sum">' +
        '<span class="wp-top"><b class="wp-title">' + esc(P.card) + '</b><span class="wp-chev" aria-hidden="true"></span></span>' +
        '<span class="wp-left">' + esc(leftTxt) + '</span>' +
        '<span class="wp-pct"><b>' + g.pct + '</b><small>%</small> ' + esc(P.done) + '</span>' +
        '<span class="wp-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + g.pct + '" aria-label="' + esc(P.card) + '"><i style="width:' + g.pct + '%"></i></span>' +
        '</summary><ul class="wp-rows">' + g.rows.map(rowHtml).join('') + '</ul></details>';
    }
    function renderPlan() {
      var sec = document.getElementById('my-plan'), host = document.getElementById('home-plan');
      if (!sec || !host) return;
      try {
        var d = host.querySelector ? host.querySelector('details') : null;
        if (d) open = !!d.open;
        var g = weekGoals(planInputs());
        host.innerHTML = g ? planHtml(g) : '';
        sec.hidden = !g;
      } catch (e) {
        host.innerHTML = '';
        sec.hidden = true;
      }
    }

    window.HCWeekPlan = { weekGoals: weekGoals, weekOf: weekOf, refresh: renderPlan, GOALS: GOALS };
    renderTonight();
    renderPlan();
    // My plan stays the viewer's week whatever day Inicio shows; Tonight follows the day
    if (typeof HCDay !== 'undefined' && HCDay && typeof HCDay.on === 'function') HCDay.on(renderTonight);
  }
  boot();
})();
