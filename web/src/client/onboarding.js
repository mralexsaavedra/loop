/* The in-page onboarding (LAN page only): a 4-step sheet for a user without an AI coach — about you + a
 * safety screen, the goal and target weight, the computed daily numbers per day type (editable within the
 * bounds), and how the data gets in (Shortcut, Strava). Saving PUTs the document to /api/food/profile (the
 * ingest service, sql/011_profile.sql), sets the goal / target weight through HCSettings, then presses the
 * page's Sync button: the next build bakes the accepted targets (lib/load/inputs.mjs).
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
  var GOALS = ['maintain', 'cut', 'bulk'];
  var TOTAL = 4;
  var P = (typeof PROFILE !== 'undefined' && PROFILE) || {};
  var S = fresh();

  function fresh() {
    return {
      step: 1,
      a: {
        name: P.name || '', sex: P.sex || '', birthdate: P.birthdate || '', heightCm: P.heightCm != null ? String(P.heightCm) : '',
        weightKg: P.weight && P.weight.kg != null ? String(P.weight.kg) : '', activity: 'light',
        pregnant: false, medical: false, eating1: false, eating2: false,
      },
      goal: 'maintain', target: '', edits: {}, errors: {}, screen: null, status: '',
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
  function person() {
    var a = S.a;
    return { sex: a.sex, age: a.birthdate ? E.ageOn(a.birthdate, HC.todayIso()) : null, heightCm: num(a.heightCm), weightKg: num(a.weightKg), activity: a.activity };
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

  /* ---------- steps ---------- */
  function field(id, label, input, err) {
    return '<label class="food-field" for="' + id + '"><span class="food-lbl">' + esc(label) + '</span>' + input +
      '<small class="food-err" id="' + id + '-err">' + esc(err || '') + '</small></label>';
  }
  function textIn(id, key, value, opts) {
    opts = opts || {};
    return '<span class="food-in-wrap"><input class="food-in" id="' + id + '" data-onb-field="' + key + '" type="' + (opts.type || 'text') + '"' +
      (opts.mode ? ' inputmode="' + opts.mode + '"' : '') + ' value="' + esc(value) + '"' + (opts.err ? ' aria-invalid="true"' : '') + '>' +
      (opts.suffix ? '<span class="food-suffix">' + esc(opts.suffix) + '</span>' : '') + '</span>';
  }
  function radios(name, key, options, current, label, srOnly) {
    return '<fieldset class="onb-choice"><legend class="' + (srOnly ? 'sr-only' : 'food-lbl') + '">' + esc(label) + '</legend>' + options.map(function (o) {
      return '<label class="pf-goal-opt"><input type="radio" name="' + name + '" data-onb-field="' + key + '" value="' + esc(o.value) + '"' +
        (o.value === current ? ' checked' : '') + '><span class="pf-goal-txt"><b class="pf-goal-name">' + esc(o.label) + '</b>' +
        (o.desc ? '<small class="pf-goal-desc">' + esc(o.desc) + '</small>' : '') + '</span></label>';
    }).join('') + (S.errors[key] ? '<small class="food-err">' + esc(S.errors[key]) + '</small>' : '') + '</fieldset>';
  }
  function check(key, label) {
    return '<label class="onb-check"><input type="checkbox" data-onb-field="' + key + '"' + (S.a[key] ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
  }
  function aboutHtml() {
    var A = T.about, a = S.a, er = S.errors;
    return '<p class="pf-note">' + esc(A.intro) + '</p>' +
      field('onb-name', A.name, textIn('onb-name', 'name', a.name)) +
      radios('onb-sex', 'sex', [{ value: 'female', label: A.female }, { value: 'male', label: A.male }], a.sex, A.sex) +
      field('onb-birth', A.birthdate, textIn('onb-birth', 'birthdate', a.birthdate, { type: 'date', err: er.age }), er.age) +
      field('onb-height', A.height, textIn('onb-height', 'heightCm', a.heightCm, { mode: 'decimal', suffix: 'cm', err: er.heightCm }), er.heightCm) +
      field('onb-weight', A.weight, textIn('onb-weight', 'weightKg', a.weightKg, { mode: 'decimal', suffix: 'kg', err: er.weightKg }), er.weightKg) +
      radios('onb-act', 'activity', ['sedentary', 'light', 'active'].map(function (k) { return { value: k, label: A.activities[k] }; }), a.activity, A.activity) +
      '<fieldset class="onb-choice"><legend class="food-lbl">' + esc(A.safety) + '</legend>' +
      (a.sex === 'female' ? check('pregnant', A.pregnant) : '') + check('medical', A.medical) + check('eating1', A.eating1) + check('eating2', A.eating2) +
      '</fieldset><p class="pf-note">' + esc(A.privacy) + '</p>';
  }
  function goalHtml() {
    var G = T.goal, sc = S.screen;
    var notes = sc.flags.filter(function (f) { return G[f]; }).map(function (f) { return '<p class="pf-note">' + esc(G[f]) + '</p>'; }).join('');
    return notes + radios('onb-goal', 'goal', sc.goals.map(function (g) { return { value: g, label: G.options[g] }; }), S.goal, G.heading, true) +
      (S.goal === 'maintain' ? '' : field('onb-target', G.target, textIn('onb-target', 'target', S.target, { mode: 'decimal', suffix: 'kg', err: S.errors.target }), S.errors.target));
  }
  function numbersHtml() {
    var N = T.numbers, t = targets(), res = E.checkTargets(t, person()), mine = res.errors.concat(res.warnings).filter(function (x) { return x.goal === S.goal; });
    var floor = E.computeTargets(person()).flags.indexOf('floor') >= 0;
    var min = person().sex === 'male' ? 1500 : 1200;
    var rows = DAYS.map(function (d) {
      var c = t[S.goal][d], carbs = E.carbsOf(c);
      var msgs = mine.filter(function (x) { return x.day === d; }).map(function (x) {
        var txt = T.errors[x.code] ? format(T.errors[x.code], { min: min }) : T.warnings[x.code];
        return '<small class="' + (T.errors[x.code] ? 'food-err' : 'pf-note') + '">' + esc(txt) + '</small>';
      }).join('');
      function cell(k, lbl) {
        var bad = S.errors[d + '.' + k];
        return '<label class="onb-cell"><span class="onb-cell-lbl">' + esc(lbl) + '</span><input class="food-in" data-onb-cell="' + d + '.' + k + '" inputmode="numeric" value="' + esc(String(c[k])) + '"' + (bad ? ' aria-invalid="true"' : '') + '></label>';
      }
      return '<li class="onb-day"><b class="onb-day-name">' + esc(N.days[d]) + '</b><div class="onb-cells">' + cell('kcal', N.kcal) + cell('p', N.p) + cell('f', N.f) +
        '<label class="onb-cell"><span class="onb-cell-lbl">' + esc(N.c) + '</span><input class="food-in" value="' + esc(String(carbs)) + '" disabled></label></div>' + msgs + '</li>';
    }).join('');
    return '<p class="pf-note">' + esc(N.intro) + '</p>' + (floor ? '<p class="pf-note">' + esc(N.floor) + '</p>' : '') +
      '<ul class="onb-days">' + rows + '</ul><div class="food-btns"><button type="button" class="food-btn food-btn-ghost" data-onb-act="reset">' + esc(N.reset) + '</button></div>' +
      '<p class="pf-note">' + esc(N.disclaimer) + '</p>';
  }
  function devicesHtml() {
    var D = T.devices, origin = typeof location !== 'undefined' && location && location.origin ? location.origin : '';
    return '<p class="pf-note">' + esc(D.intro) + '</p>' +
      '<p class="pf-note"><a class="lnk" href="' + esc(SHORTCUT_URL) + '" target="_blank" rel="noopener">' + esc(D.shortcut) + '</a></p>' +
      '<p class="pf-note"><span class="food-lbl">' + esc(D.url) + '</span><br><code>' + esc(origin) + '</code></p>' +
      '<p class="pf-note">' + esc(D.token) + '</p><p class="pf-note">' + esc(D.strava) + '</p><p class="pf-note">' + esc(D.after) + '</p>';
  }
  function stopHtml() {
    var X = T.stop, why = S.screen.flags[0];
    return '<h3 class="pf-h">' + esc(X.heading) + '</h3><p class="pf-note">' + esc(X[why] || X.minor) + '</p>' +
      '<div class="food-btns"><button type="button" class="food-btn" data-onb-act="later">' + esc(X.close) + '</button></div>';
  }
  function navHtml() {
    var first = S.step === 1, last = S.step === TOTAL;
    return '<p class="pf-note pf-status" id="onb-status" role="status" aria-live="polite">' + esc(S.status) + '</p><div class="food-btns">' +
      (first ? '<button type="button" class="food-btn food-btn-ghost" data-onb-act="later">' + esc(T.later) + '</button>'
        : '<button type="button" class="food-btn food-btn-ghost" data-onb-act="back">' + esc(T.back) + '</button>') +
      '<button type="button" class="food-btn" data-onb-act="' + (last ? 'save' : 'next') + '">' + esc(last ? T.save : T.next) + '</button></div>';
  }
  function render() {
    if (S.step === 'stop') return { head: '', body: '<section class="pf-sec onb">' + stopHtml() + '</section>' };
    var heads = [T.about.heading, T.goal.heading, T.numbers.heading, T.devices.heading];
    var body = [aboutHtml, goalHtml, numbersHtml, devicesHtml][S.step - 1]();
    return {
      head: '',
      body: '<section class="pf-sec onb"><p class="onb-step">' + esc(format(T.step, { n: S.step, total: TOTAL })) + '</p><h3 class="pf-h">' + esc(heads[S.step - 1]) + '</h3>' +
        body + navHtml() + '</section>',
    };
  }

  /* ---------- validation per step ---------- */
  function validateAbout() {
    var a = S.a, p = person(), errs = {};
    var bad = realDate(a.birthdate) ? E.validatePerson(p) : E.validatePerson(Object.assign({}, p, { age: null }));
    bad.forEach(function (k) { errs[k] = T.errors[k]; });
    S.errors = errs;
    if (bad.length) {
      // under 18 with a real date is the safety screen's stop, not an input error
      if (bad.length === 1 && bad[0] === 'age' && realDate(a.birthdate) && p.age != null && p.age >= 0 && p.age < 18) { S.errors = {}; return true; }
      return false;
    }
    return true;
  }
  function screen() {
    var a = S.a, p = person();
    return E.screenPerson({ age: p.age, heightCm: p.heightCm, weightKg: p.weightKg, pregnant: a.sex === 'female' && a.pregnant, medical: a.medical, eatingRisk: a.eating1 || a.eating2 });
  }
  function validateGoal() {
    S.errors = {};
    if (S.goal === 'maintain' || String(S.target).trim() === '') return true;
    var t = num(S.target);
    if (t == null) { S.errors.target = T.errors.target; return false; }
    var p = person(), probs = E.checkTargetWeight({ heightCm: p.heightCm, weightKg: p.weightKg, goal: S.goal, targetWeightKg: t });
    if (probs.length) { S.errors.target = T.errors[probs[0]]; return false; }
    return true;
  }
  function validateNumbers() {
    var res = E.checkTargets(targets(), person());
    return !res.errors.some(function (x) { return x.goal === S.goal; });
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
  function next() {
    if (S.step === 1) {
      if (!validateAbout()) return reopen('[aria-invalid="true"], [data-onb-act="next"]');
      S.screen = screen();
      if (!S.screen.numbers) { S.step = 'stop'; return reopen('[data-onb-act="later"]'); }
      if (S.screen.goals.indexOf(S.goal) < 0) S.goal = S.screen.goals[0];
    } else if (S.step === 2) {
      if (!validateGoal()) return reopen('#onb-target');
      S.edits = {};
    } else if (S.step === 3 && !validateNumbers()) {
      return reopen('[data-onb-act="next"]');
    }
    S.step += 1;
    reopen('[data-onb-act="' + (S.step === TOTAL ? 'save' : 'next') + '"]');
  }
  function back() {
    S.step = Math.max(1, S.step - 1);
    S.errors = {};
    reopen('[data-onb-act="back"], [data-onb-act="later"]');
  }
  function doc() {
    var a = S.a, p = person(), out = {
      sex: a.sex, birthdate: a.birthdate, heightCm: p.heightCm, weightKg: p.weightKg, activity: a.activity,
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
    if (key === 'goal') { S.goal = t.value; return reopen('[data-onb-field="goal"][value="' + t.value + '"]'); }
    if (key === 'target') { S.target = t.value; return; }
    if (t.type === 'checkbox') S.a[key] = Boolean(t.checked);
    else S.a[key] = t.value;
    if (key === 'sex') reopen('[data-onb-field="sex"][value="' + t.value + '"]');
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
