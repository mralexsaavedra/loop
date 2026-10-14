/* The in-page onboarding (LAN page only): a full-screen flow, one question per screen with a progress bar,
 * for a user without an AI coach — welcome, name, sex, birth date, height, weight, activity outside training,
 * the sports they do (big cards) and one screen per sport (session length + times a week), the safety
 * questions, the goal and target weight, a summary (the week's average kcal as the hero number, the day types
 * their sports reach, numbers editable within the bounds under "Adjust") and how the data gets in (Shortcut,
 * Strava). Saving PUTs the document with its `sports` to /api/food/profile (the ingest service,
 * sql/011_profile.sql), sets the goal / target weight through HCSettings, then presses the page's Sync button:
 * the next build bakes the accepted targets and the person's day names (lib/load/inputs.mjs).
 * The numbers, screen and bounds are HC_ENERGY = lib/nutrition/energy.mjs (one formula for the page and the
 * build). Opened from the profile sheet ([data-onb-open]) and, once, on its own when the server has neither a
 * profile nor a goal yet ("Later" is remembered in localStorage, a convenience only). Registers the
 * `onboarding` view of the detail sheet (client/detail.js: ASYNC_VIEWS, deep link #onboarding). */
(function () {
  var T = typeof I18N_ONB !== 'undefined' ? I18N_ONB : null, E = typeof HC_ENERGY !== 'undefined' ? HC_ENERGY : null;
  if (!T || !E) return;
  var esc = HC.esc, format = HC.format;
  var LATER_KEY = 'hc.onboarding.later';
  var SHORTCUT_URL = 'https://www.icloud.com/shortcuts/ceb66eea36fc434a9d2f910421dd18aa';
  var DAYS = ['rest', 'gym', 'bike', 'bikeLong'];
  var MINUTES = [30, 45, 60, 90, 120, 180, 240];
  var TIMES = [1, 2, 3, 4, 5, 6, 7];
  // a new pick's session: an hour three times a week, a ride two hours twice
  var SESSION = { cycling: { minutes: 120, perWeek: 2 } };
  var P = (typeof PROFILE !== 'undefined' && PROFILE) || {};
  var S = fresh();

  function fresh() {
    return {
      at: 'welcome',
      a: {
        name: P.name || '', sex: P.sex || '', birthdate: P.birthdate || '', heightCm: P.heightCm != null ? String(P.heightCm) : '',
        weightKg: P.weight && P.weight.kg != null ? String(P.weight.kg) : '', activity: 'light',
        pregnant: false, medical: false, eating1: false, eating2: false,
      },
      picks: [], sess: {}, goal: 'maintain', target: '', edits: {}, adjust: false, errors: {}, screen: null, status: '',
    };
  }
  function api() {
    var F = window.HCFood;
    return F && typeof F.api === 'function' ? F.api : null;
  }
  function num(v) {
    var s = String(v == null ? '' : v).trim().replace(',', '.');
    return s === '' || !/^\d+(\.\d+)?$/.test(s) ? null : Number(s);
  }
  function sports() {
    return S.picks.map(function (k) { return { sport: k, minutes: S.sess[k].minutes, perWeek: S.sess[k].perWeek }; });
  }
  function person() {
    var a = S.a;
    return {
      sex: a.sex, age: realDate(a.birthdate) ? E.ageOn(a.birthdate, HC.todayIso()) : null, heightCm: num(a.heightCm), weightKg: num(a.weightKg),
      activity: a.activity, sports: sports(),
    };
  }
  function realDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  // the 12 cells: computed for this person, the chosen goal's cells overridden by what was typed
  function targets() {
    var t = E.computeTargets(person()).targets;
    DAYS.forEach(function (d) {
      ['kcal', 'p', 'f'].forEach(function (k) {
        var v = S.edits[d + '.' + k];
        if (v != null) t[S.goal][d][k] = v;
      });
    });
    return t;
  }
  // the screens in order (they follow the sports picked and the goal)
  function screens() {
    var out = ['welcome', 'name', 'sex', 'birth', 'height', 'weight', 'activity', 'sports'];
    S.picks.forEach(function (k) { out.push('sport:' + k); });
    out.push('safety', 'goal');
    if (S.goal !== 'maintain') out.push('target');
    out.push('summary', 'data');
    return out;
  }

  /* ---------- screens ---------- */
  function q(text, hint) {
    return '<h3 class="onb-q">' + esc(text) + '</h3>' + (hint ? '<p class="pf-note">' + esc(hint) + '</p>' : '');
  }
  function err(key) {
    return S.errors[key] ? '<small class="food-err">' + esc(S.errors[key]) + '</small>' : '';
  }
  function input(key, value, opts) {
    opts = opts || {};
    var id = 'onb-' + key;
    return '<label class="food-field' + (opts.big ? ' onb-big' : '') + '" for="' + id + '"><span class="food-lbl">' + esc(opts.label || '') + '</span><span class="food-in-wrap"><input class="food-in" id="' + id +
      '" data-onb-field="' + key + '" type="' + (opts.type || 'text') + '"' + (opts.mode ? ' inputmode="' + opts.mode + '"' : '') + ' value="' + esc(value) + '"' +
      (S.errors[opts.err || key] ? ' aria-invalid="true"' : '') + '>' + (opts.suffix ? '<span class="food-suffix">' + esc(opts.suffix) + '</span>' : '') +
      '</span>' + err(opts.err || key) + '</label>';
  }
  // big option cards: radios (one) or checkboxes (several); `o` = [{value, name, desc?, on}]
  function cards(key, type, o, label) {
    return '<fieldset class="seg"><legend class="sr-only">' + esc(label) + '</legend>' + o.map(function (x) {
      return '<label class="seg-opt onb-card"><input type="' + type + '" name="onb-' + key + '" data-onb-field="' + key + '" value="' + esc(x.value) + '"' + (x.on ? ' checked' : '') +
        '><span class="chip seg-in onb-in"><b>' + esc(x.name) + '</b>' + (x.desc ? '<small>' + esc(x.desc) + '</small>' : '') + '</span></label>';
    }).join('') + '</fieldset>' + err(key);
  }
  // compact pills (the session length and times a week)
  function pills(key, values, current, label, text) {
    return '<fieldset class="seg"><legend class="seg-lbl">' + esc(label) + '</legend><div class="seg-opts">' + values.map(function (v) {
      return '<label class="seg-opt"><input type="radio" name="onb-' + key + '" data-onb-field="' + key + '" value="' + v + '"' + (v === current ? ' checked' : '') +
        '><span class="chip seg-in"><span class="seg-txt">' + esc(text(v)) + '</span></span></label>';
    }).join('') + '</div></fieldset>';
  }
  function minutesText(m) {
    return m < 60 ? format(T.session.min, { n: m }) : HC.hours(m / 60);
  }
  function sportsOf(d) {
    return S.picks.filter(function (k) { return E.dayTypeOfMinutes(S.sess[k].minutes) === d; }).map(function (k) { return T.sports.names[k]; });
  }
  // the week's average kcal for the chosen goal: each sport's sessions on its day type, the other days rest
  // (more than 7 sessions a week are scaled to 7)
  function weekAverage(t) {
    var n = { gym: 0, bike: 0, bikeLong: 0 }, total = 0;
    S.picks.forEach(function (k) { n[E.dayTypeOfMinutes(S.sess[k].minutes)] += S.sess[k].perWeek; total += S.sess[k].perWeek; });
    var f = total > 7 ? 7 / total : 1, sum = 0;
    ['gym', 'bike', 'bikeLong'].forEach(function (d) { sum += n[d] * f * t[S.goal][d].kcal; });
    sum += (7 - Math.min(7, total)) * t[S.goal].rest.kcal;
    return E.round50(sum / 7);
  }
  function summaryHtml() {
    var N = T.summary, t = targets(), p = person(), used = E.usedDayTypes(p.sports);
    var res = E.checkTargets(t, p), mine = res.errors.concat(res.warnings).filter(function (x) { return x.goal === S.goal && used.indexOf(x.day) >= 0; });
    var floor = E.computeTargets(p).flags.indexOf('floor') >= 0, min = p.sex === 'male' ? 1500 : 1200;
    var rows = used.map(function (d) {
      var c = t[S.goal][d], names = sportsOf(d);
      var msgs = mine.filter(function (x) { return x.day === d; }).map(function (x) {
        var txt = T.errors[x.code] ? format(T.errors[x.code], { min: min }) : T.warnings[x.code];
        return '<small class="' + (T.errors[x.code] ? 'food-err' : 'pf-note') + '">' + esc(txt) + '</small>';
      }).join('');
      function cell(k, lbl) {
        var bad = S.errors[d + '.' + k];
        return '<label class="onb-cell"><span class="food-lbl">' + esc(lbl) + '</span><input class="food-in" data-onb-cell="' + d + '.' + k + '" inputmode="numeric" value="' + esc(String(c[k])) + '"' + (bad ? ' aria-invalid="true"' : '') + '></label>';
      }
      return '<li class="db-row"><span class="db-name">' + esc(N.days[d]) + (names.length ? '<br><small class="pf-goal-desc">' + esc(names.join(' · ')) + '</small>' : '') + '</span>' +
        '<span class="db-val"><b>' + esc(HC.int(c.kcal)) + '</b>' + esc(N.kcal) + '</span>' +
        (S.adjust ? '<div class="onb-cells">' + cell('kcal', N.kcal) + cell('p', N.p) + cell('f', N.f) +
          '<label class="onb-cell"><span class="food-lbl">' + esc(N.c) + '</span><input class="food-in" value="' + esc(String(E.carbsOf(c))) + '" disabled></label></div>' : '') + msgs + '</li>';
    }).join('');
    return q(N.q) + '<div class="onb-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="57"/></svg><b class="kcal">' + esc(HC.int(weekAverage(t))) +
      '</b><span class="pf-note">' + esc(N.hero) + '</span></div><p class="pf-note">' + esc(format(N.protein, { p: t[S.goal].rest.p })) + '</p>' +
      (floor ? '<p class="pf-note">' + esc(N.floor) + '</p>' : '') + '<ul class="db-list">' + rows + '</ul><div class="food-btns">' +
      (S.adjust ? '<button type="button" class="food-btn food-btn-ghost" data-onb-act="reset">' + esc(N.reset) + '</button>'
        : '<button type="button" class="food-btn food-btn-ghost" data-onb-act="adjust">' + esc(N.adjust) + '</button>') +
      '</div><p class="pf-note">' + esc(N.disclaimer) + '</p>';
  }
  function dataHtml() {
    var D = T.data, origin = typeof location !== 'undefined' && location && location.origin ? location.origin : '';
    return q(D.q, D.intro) +
      '<p class="pf-note"><a class="lnk" href="' + esc(SHORTCUT_URL) + '" target="_blank" rel="noopener">' + esc(D.shortcut) + '</a></p>' +
      '<p class="pf-note"><span class="food-lbl">' + esc(D.url) + '</span><br><code>' + esc(origin) + '</code></p>' +
      '<p class="pf-note">' + esc(D.token) + '</p><p class="pf-note">' + esc(D.strava) + '</p><p class="pf-note">' + esc(D.after) + '</p>';
  }
  function screenHtml(id) {
    var a = S.a;
    if (id === 'welcome') {
      return q(T.welcome.q, T.welcome.intro) + '<ol class="db-list onb-steps">' + T.welcome.steps.map(function (x, n) {
        return '<li class="db-row"><b class="db-val">' + (n + 1) + '</b><span class="db-name">' + esc(x) + '</span></li>';
      }).join('') + '</ol><p class="pf-note">' + esc(T.welcome.time) + '</p>';
    }
    if (id === 'name') return q(T.name.q) + input('name', a.name, { label: T.optional });
    if (id === 'sex') return q(T.sex.q, T.sex.hint) + cards('sex', 'radio', ['female', 'male'].map(function (v) { return { value: v, name: T.sex[v], on: a.sex === v }; }), T.sex.q);
    if (id === 'birth') return q(T.birth.q) + input('birthdate', a.birthdate, { type: 'date', err: 'age', big: true });
    if (id === 'height') return q(T.height.q) + input('heightCm', a.heightCm, { mode: 'decimal', suffix: 'cm', big: true });
    if (id === 'weight') return q(T.weight.q, P.weight && P.weight.kg != null ? T.weight.hint : '') + input('weightKg', a.weightKg, { mode: 'decimal', suffix: 'kg', big: true });
    if (id === 'activity') {
      var A = T.activity.options;
      return q(T.activity.q) + cards('activity', 'radio', ['sedentary', 'light', 'active'].map(function (v) { return { value: v, name: A[v].name, desc: A[v].desc, on: a.activity === v }; }), T.activity.q);
    }
    if (id === 'sports') {
      return q(T.sports.q, T.sports.hint) + cards('sport', 'checkbox', Object.keys(T.sports.names).map(function (k) { return { value: k, name: T.sports.names[k], on: S.picks.indexOf(k) >= 0 }; }), T.sports.q);
    }
    if (id.indexOf('sport:') === 0) {
      var k = id.slice(6), s = S.sess[k];
      return q(T.sports.names[k]) + pills('minutes', MINUTES, s.minutes, T.session.minutes, minutesText) + pills('perWeek', TIMES, s.perWeek, T.session.perWeek, String);
    }
    if (id === 'safety') {
      var Y = T.safety, keys = (a.sex === 'female' ? ['pregnant'] : []).concat(['medical', 'eating1', 'eating2']);
      return q(Y.q, Y.hint) + keys.map(function (k) {
        return '<label class="seg-opt onb-card"><input type="checkbox" data-onb-field="' + k + '"' + (a[k] ? ' checked' : '') + '><span class="chip seg-in onb-in"><small>' + esc(Y[k]) + '</small></span></label>';
      }).join('');
    }
    if (id === 'goal') {
      var G = T.goal, sc = S.screen;
      var notes = sc.flags.filter(function (f) { return G[f]; }).map(function (f) { return '<p class="pf-note">' + esc(G[f]) + '</p>'; }).join('');
      return q(G.q) + notes + cards('goal', 'radio', sc.goals.map(function (g) { return { value: g, name: G.options[g].name, desc: G.options[g].desc, on: S.goal === g }; }), G.q);
    }
    if (id === 'target') return q(T.target.q, T.target.hint) + input('target', S.target, { mode: 'decimal', suffix: 'kg', big: true });
    if (id === 'summary') return summaryHtml();
    return dataHtml();
  }
  function stopHtml() {
    var X = T.stop, why = S.screen.flags[0];
    return q(X.heading) + '<p class="pf-note">' + esc(X[why] || X.minor) + '</p>' +
      '<div class="onb-nav"><button type="button" class="food-btn" data-onb-act="later">' + esc(X.close) + '</button></div>';
  }
  // the flow's own header (a `bare` view): ONE back arrow (on the cover it closes, like "Later"), the
  // segmented progress (one segment per screen after the cover) and "Later"
  function topHtml(i, n) {
    var back = i > 0 ? 'back' : 'later', segs = '';
    for (var k = 1; k <= n; k++) segs += '<i' + (k <= i ? ' class="on"' : '') + '></i>';
    return '<div class="onb-top"><button type="button" class="sh-back" data-onb-act="' + back + '" aria-label="' + esc(i > 0 ? T.back : T.later) + '">‹</button>' +
      (i > 0 ? '<span class="onb-prog" role="img" aria-label="' + esc(format(T.step, { n: i, total: n })) + '">' + segs + '</span>' : '') +
      (i > 0 ? '<button type="button" class="lnk" data-onb-act="later">' + esc(T.later) + '</button>' : '') + '</div><h2 class="sr-only" id="dt-title">' + esc(T.title) + '</h2>';
  }
  function navHtml(list, i) {
    var first = i === 0, last = i === list.length - 1;
    return '<div class="onb-nav"><p class="pf-note pf-status" id="onb-status" role="status" aria-live="polite">' + esc(S.status) + '</p>' +
      '<button type="button" class="food-btn" data-onb-act="' + (last ? 'save' : 'next') + '">' + esc(last ? T.save : first ? T.start : T.next) + '</button></div>';
  }
  function render() {
    if (S.at === 'stop') return { bare: true, body: '<section class="onb">' + topHtml(0, 0) + stopHtml() + '</section>' };
    var list = screens(), i = list.indexOf(S.at), n = list.length - 1;
    return { bare: true, body: '<section class="onb">' + topHtml(i, n) + screenHtml(S.at) + navHtml(list, i) + '</section>' };
  }

  /* ---------- validation per screen ---------- */
  var FIELD = { birth: 'age', height: 'heightCm', weight: 'weightKg' };
  function valid(id) {
    S.errors = {};
    if (id === 'sex' && !S.a.sex) S.errors.sex = T.errors.sex;
    if (FIELD[id] && E.validatePerson(person()).indexOf(FIELD[id]) >= 0) S.errors[FIELD[id]] = T.errors[FIELD[id]];
    if (id === 'sports' && !S.picks.length) S.errors.sport = T.errors.sports;
    if (id === 'target') validTarget();
    if (id === 'summary') {
      var res = E.checkTargets(targets(), person()), used = E.usedDayTypes(sports());
      if (res.errors.some(function (x) { return x.goal === S.goal && used.indexOf(x.day) >= 0; })) S.errors.summary = true;
    }
    return !Object.keys(S.errors).length;
  }
  function validTarget() {
    if (S.goal === 'maintain' || String(S.target).trim() === '') return;
    var t = num(S.target);
    if (t == null) { S.errors.target = T.errors.target; return; }
    var p = person(), probs = E.checkTargetWeight({ heightCm: p.heightCm, weightKg: p.weightKg, goal: S.goal, targetWeightKg: t });
    if (probs.length) S.errors.target = T.errors[probs[0]];
  }
  function screen() {
    var a = S.a, p = person();
    return E.screenPerson({ age: p.age, heightCm: p.heightCm, weightKg: p.weightKg, pregnant: a.sex === 'female' && a.pregnant, medical: a.medical, eatingRisk: a.eating1 || a.eating2 });
  }

  /* ---------- actions ---------- */
  function reopen(focus) {
    var H = window.HCDetail;
    if (H && typeof H.open === 'function') H.open('onboarding', null, focus ? { focus: focus } : undefined);
  }
  function close() {
    var H = window.HCDetail;
    if (H && typeof H.close === 'function') H.close();
  }
  function later() {
    try { localStorage.setItem(LATER_KEY, '1'); } catch (e) { /* convenience only */ }
    close();
  }
  function stop() {
    S.at = 'stop';
    reopen('[data-onb-act="later"]');
  }
  function next() {
    var id = S.at;
    // under 18 with a real date is the safety screen's stop, not an input error
    var age = person().age;
    if (id === 'birth' && age != null && age >= 0 && age < 18) { S.screen = { numbers: false, goals: [], flags: ['minor'] }; return stop(); }
    if (!valid(id)) return reopen('[aria-invalid="true"], [data-onb-act="next"]');
    if (id === 'safety') {
      S.screen = screen();
      if (!S.screen.numbers) return stop();
      if (S.screen.goals.indexOf(S.goal) < 0) S.goal = S.screen.goals[0];
    }
    if (id === 'goal' || id === 'target') { S.edits = {}; S.adjust = false; }
    var list = screens();
    S.at = list[Math.min(list.length - 1, list.indexOf(id) + 1)];
    reopen('[data-onb-act="' + (S.at === 'data' ? 'save' : 'next') + '"]');
  }
  function back() {
    var list = screens();
    S.at = list[Math.max(0, list.indexOf(S.at) - 1)];
    S.errors = {};
    reopen('[data-onb-act="next"]');
  }
  function doc() {
    var a = S.a, p = person(), out = {
      sex: a.sex, birthdate: a.birthdate, heightCm: p.heightCm, weightKg: p.weightKg, activity: a.activity, sports: sports(),
      goals: S.screen.goals.slice(), targets: targets(),
    };
    if (String(a.name).trim()) out.name = String(a.name).trim();
    return out;
  }
  function save() {
    var call = api();
    if (!call) return;
    S.status = T.saving;
    reopen('[data-onb-act="save"]');
    var st = window.HCSettings;
    call('PUT', '/profile', doc()).then(function () {
      var t = S.goal === 'maintain' ? null : num(S.target);
      return st && typeof st.saveGoal === 'function'
        ? Promise.resolve(st.saveGoal(S.goal)).then(function () { return st.saveTarget(t); })
        : null;
    }).then(function () {
      S.status = T.saved;
      try { localStorage.removeItem(LATER_KEY); } catch (e) { /* convenience only */ }
      close();
      var b = document.getElementById ? document.getElementById('sync-btn') : null;
      if (b && !b.hidden && typeof b.click === 'function') b.click();
    }).catch(function (err) {
      S.status = format(T.errors.save, { reason: err && err.status === 0 ? T.reasons.offline : T.reasons.generic });
      reopen('[data-onb-act="save"]');
    });
  }

  function onInput(e) {
    var t = e && e.target;
    if (!t || !t.getAttribute) return;
    var cell = t.getAttribute('data-onb-cell');
    if (cell) {
      var v = String(t.value).trim();
      var n = /^\d+$/.test(v) ? Number(v) : null;
      S.errors[cell] = n == null;
      if (n != null) S.edits[cell] = n;
      return e.type === 'change' ? reopen('[data-onb-cell="' + cell + '"]') : undefined;
    }
    var key = t.getAttribute('data-onb-field');
    if (!key) return;
    if (key === 'sport') {
      var i = S.picks.indexOf(t.value);
      if (t.checked && i < 0 && Object.prototype.hasOwnProperty.call(T.sports.names, t.value)) {
        S.picks.push(t.value);
        if (!S.sess[t.value]) S.sess[t.value] = Object.assign({ minutes: 60, perWeek: 3 }, SESSION[t.value]);
      } else if (!t.checked && i >= 0) S.picks.splice(i, 1);
      return;
    }
    if (key === 'minutes' || key === 'perWeek') { S.sess[S.at.slice(6)][key] = Number(t.value); return; }
    if (key === 'goal') { S.goal = t.value; return; }
    if (key === 'target') { S.target = t.value; return; }
    if (t.type === 'checkbox') S.a[key] = Boolean(t.checked);
    else S.a[key] = t.value;
  }

  if (document.addEventListener) {
    document.addEventListener('click', function (e) {
      var t = e && e.target && e.target.closest ? e.target : null;
      if (!t) return;
      var open = t.closest('[data-onb-open]');
      if (open) { S = fresh(); return reopen(); }
      var b = t.closest('[data-onb-act]');
      if (!b) return;
      var act = b.getAttribute('data-onb-act');
      if (act === 'next') next();
      else if (act === 'back') back();
      else if (act === 'later') later();
      else if (act === 'save') save();
      else if (act === 'adjust') { S.adjust = true; reopen('[data-onb-cell]'); }
      else if (act === 'reset') { S.edits = {}; S.errors = {}; reopen('[data-onb-act="reset"]'); }
    });
    document.addEventListener('input', onInput);
    document.addEventListener('change', onInput);
  }

  HC.registerView('onboarding', { title: function () { return T.title; }, render: render });

  // first run (LAN only): neither an onboarding document nor a goal on the server, and not postponed here
  function laterSet() {
    try { return localStorage.getItem(LATER_KEY) === '1'; } catch (e) { return false; }
  }
  function firstRun() {
    var call = api();
    if (!call || laterSet()) return;
    Promise.all([call('GET', '/profile'), call('GET', '/settings')]).then(function (r) {
      var prof = r[0] && r[0].profile, set = r[1] && r[1].settings;
      if (prof || (set && set.goal)) return;
      // a sheet deep link (#detail/…, #profile …) wins; a tab hash (#home, written at load) does not
      var h = location && location.hash ? location.hash.slice(1) : '';
      if (/^detail\//.test(h) || (window.HCViews && Object.prototype.hasOwnProperty.call(window.HCViews, h))) return;
      reopen();
    }).catch(function () { /* an old or unreachable service: no wizard, nothing else changes */ });
  }
  if (HC.lan()) firstRun();

  window.HCOnboarding = { render: render, state: function () { return S; }, targets: targets };
})();
