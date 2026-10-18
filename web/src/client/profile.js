/* Profile sheet: registers the `profile` view of the detail sheet (window.HCViews.profile, rendered by
 * client/detail.js in its modal, deep link #profile), opened by the avatar button in the top bar
 * (components/Avatar.astro, data-detail="profile"). Strava-style card, honest data only:
 *   header  — photo (or initials, or a generic icon), full name, age, location;
 *   Goal    — Mantener / Bajar / Ganar radios, each with its kcal/day change vs maintain (PROFILE.goals,
 *             lib/profile/goal.mjs). The goal itself belongs to Nutrición (client/nutri-day.js, inlined
 *             earlier): the checked radio is window.HCNutri.state().goal and a change calls
 *             HCNutri.setGoal, which stores it (hc.nutri.goal) and refreshes the summary, plan, fuelling,
 *             rings, builder and the kcal chip. No HCNutri or no options -> the section is omitted.
 *             On the LAN page (window.HCSettings ready, client/settings.js) the goal is also stored on
 *             the server and the section adds a "Target weight" field (kg, HCSettings.parseTarget = the
 *             food forms' parser; an inline error; saved on change, which fires on blur), one status
 *             line for both saves, and the Progreso line (window.HCProgress.line, client/progress.js);
 *   Language — LAN page only (HCSettings ready): Español / English radios, the stored settings.locale checked
 *             (none stored = the language this page was built in, LOCALE); a change saves it
 *             (HCSettings.saveLocale) and then presses the page's Sync button, so the next build is in that
 *             language (web/src/env.mjs); its own status line says the page is rebuilding;
 *   Events  — profile.json events: upcoming soonest first with the days left (viewer's clock), past
 *             ones folded; omitted when there are none;
 *   Body    — height (manual) + the latest weigh-in with its date (never Strava's weight);
 *   Gear    — bikes and shoes from Strava with km (1 decimal), retired ones folded, a gentle hint on
 *             shoes past SHOE_REPLACE_KM, or a note when the token lacks the profile:read_all scope;
 *   Devices — manual devices + those seen on Strava activities (deduped at build time, hiddenDevices
 *             left out), a "Manual" link per device with a manual PDF (revealed on the LAN page only);
 *   Supplements — profile.json supplements with dose + meal (also shown in Nutrición's Plan de hoy);
 *   Strava  — focus + the snapshot date.
 * Nothing known at all -> the onboarding hint.
 *
 * Classic script (is:inline), inlined BEFORE detail.js. Reads PROFILE (lib/profile/read.mjs
 * loadProfile -> profile.mjs buildProfile, baked by Avatar.astro with `photo` as a flag: the data URI
 * is baked ONCE, in the button's <img id="avatar-img">, and copied from there) + I18N_PROFILE, and
 * window.HC (util.js). The age is computed here on the viewer's clock, so builds stay byte-identical.
 */
(function () {
  var P = typeof PROFILE === 'undefined' || !PROFILE ? null : PROFILE;
  var T = typeof I18N_PROFILE === 'undefined' || !I18N_PROFILE ? null : I18N_PROFILE;
  if (!P || !T || typeof window === 'undefined') return;
  var esc = HC.esc, format = HC.format;
  var PHOTO_RE = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/;
  var ICON = '<svg class="pf-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4 20.5c1.4-4 4.4-6 8-6s6.6 2 8 6"/></svg>';

  function list(v) {
    return Array.isArray(v) ? v : [];
  }
  function fin(v) {
    return typeof v === 'number' && isFinite(v);
  }
  // whole years between an ISO birthdate and an ISO day (the shared HC.ageOn, client/util.js)
  var ageOn = HC.ageOn;
  function photoSrc() {
    if (!P.photo) return null;
    var img = document.getElementById ? document.getElementById('avatar-img') : null;
    var src = img && img.getAttribute ? img.getAttribute('src') : null;
    return typeof src === 'string' && PHOTO_RE.test(src) ? src : null;
  }
  function avatarHtml() {
    var src = photoSrc();
    if (src) return '<img class="pf-photo" src="' + src + '" alt="" width="72" height="72">';
    if (P.initials) return '<span class="pf-ini" aria-hidden="true">' + esc(P.initials) + '</span>';
    return ICON;
  }
  function section(heading, inner) {
    return '<section class="pf-sec"><h3 class="pf-h">' + esc(heading) + '</h3>' + inner + '</section>';
  }
  function note(text, cls) {
    return '<p class="pf-note' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</p>';
  }
  function stat(label, value, unit, sub) {
    return '<div class="pf-stat"><span class="pf-lbl">' + esc(label) + '</span><span class="pf-num"><b class="pf-val">' + esc(value) + '</b>' +
      (unit ? '<small>' + esc(unit) + '</small>' : '') + '</span>' + (sub ? '<small class="pf-sub">' + esc(sub) + '</small>' : '') + '</div>';
  }

  function headHtml() {
    var meta = [];
    var age = ageOn(P.birthdate, HC.todayIso());
    if (age != null) meta.push(format(T.age, { n: age }));
    if (P.location) meta.push(P.location);
    return '<div class="pf-id"><span class="pf-avatar">' + avatarHtml() + '</span><div class="pf-who">' +
      (P.name ? '<div class="pf-name">' + esc(P.name) + '</div>' : '') +
      (meta.length ? '<div class="pf-meta">' + esc(meta.join(' · ')) + '</div>' : '') + '</div>' + onbHtml() + '</div>';
  }

  function bodyHtml() {
    var B = T.body, out = [];
    if (fin(P.heightCm)) out.push(stat(B.height, HC.num(P.heightCm, 0), 'cm'));
    if (P.weight && fin(P.weight.kg)) out.push(stat(B.weight, HC.num(P.weight.kg, 1), 'kg', format(B.weighIn, { date: HC.fmtDate(P.weight.date) })));
    return section(B.heading, out.length ? '<div class="pf-stats">' + out.join('') + '</div>' : note(B.empty));
  }

  function gearItem(g, kind) {
    var G = T.gear, bits = [];
    if (g.detail) bits.push(g.detail);
    if (kind === 'bike' && g.frame && G.frames[g.frame]) bits.push(G.frames[g.frame]);
    if (kind === 'bike' && fin(g.weightKg)) bits.push(format(G.weightKg, { value: HC.num(g.weightKg, 1) }));
    return '<li class="pf-item"><div class="pf-item-main"><span class="pf-item-name">' + esc(g.name) + '</span>' +
      (g.primary && !g.retired ? '<span class="pf-badge">' + esc(G.primary) + '</span>' : '') +
      (bits.length ? '<small class="pf-item-sub">' + esc(bits.join(' · ')) + '</small>' : '') +
      (g.replace ? '<small class="pf-hint">' + esc(G.replace) + '</small>' : '') + '</div>' +
      (fin(g.km) ? '<span class="pf-num"><b class="pf-km">' + esc(HC.num(g.km, 1)) + '</b><small>km</small></span>' : '') + '</li>';
  }
  function gearGroup(title, items, kind) {
    if (!items.length) return '';
    var active = items.filter(function (g) { return !g.retired; });
    var retired = items.filter(function (g) { return g.retired; });
    var li = function (arr) { return arr.map(function (g) { return gearItem(g, kind); }).join(''); };
    return '<h4 class="pf-sub-h">' + esc(title) + '</h4>' +
      (active.length ? '<ul class="pf-list">' + li(active) + '</ul>' : '') +
      (retired.length ? '<details class="pf-retired"><summary>' + esc(format(T.gear.retired, { n: retired.length })) + '</summary><ul class="pf-list">' + li(retired) + '</ul></details>' : '');
  }
  function gearHtml() {
    var G = T.gear, bikes = list(P.bikes), shoes = list(P.shoes);
    if (!P.strava && !bikes.length && !shoes.length) return '';
    var inner = gearGroup(G.bikes, bikes, 'bike') + gearGroup(G.shoes, shoes, 'shoe');
    if (P.gearScopeMissing) inner += note(G.scopeMissing, 'pf-note-warn');
    else if (!inner) inner = note(G.none);
    return section(G.heading, inner);
  }

  // Device manuals (profile.json devices[].manual): the LAN page serves them as /manuales/<file>.pdf
  // (loop-web, refresh.sh publishes them). The link ships `hidden` and is revealed only once a HEAD of
  // the file answers 200 with a PDF, so the claude.ai artifact, file:// and the example build (no such
  // file, or an HTML fallback page) never show it. One probe per file per page load.
  var MANUAL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.pdf$/;
  // kept apart from the markup so the built page holds no literal root-relative href (output guard)
  var MANUAL_BASE = '/manuales/';
  var PROBE_MS = 10000; // the manual HEAD probe: a hung server counts as no manual
  var manualState = {};
  function manualFile(d) {
    var f = d && d.manual;
    return typeof f === 'string' && MANUAL_RE.test(f) && f.indexOf('..') < 0 ? f : null;
  }
  function revealManual(file) {
    var links = document.querySelectorAll ? document.querySelectorAll('a.pf-manual') : [];
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('data-manual') === file) links[i].removeAttribute('hidden');
    }
  }
  function probeManuals(devs) {
    if (typeof fetch !== 'function' || !HC.lan()) return;
    devs.forEach(function (d) {
      var file = manualFile(d);
      if (!file || manualState[file]) return;
      manualState[file] = 'pending';
      try {
        HC.fetchTimeout(MANUAL_BASE + encodeURIComponent(file), { method: 'HEAD', cache: 'no-store' }, PROBE_MS).then(function (res) {
          var type = res && res.headers && typeof res.headers.get === 'function' ? String(res.headers.get('content-type') || '') : '';
          manualState[file] = res && res.status === 200 && /^application\/pdf\b/i.test(type) ? 'ok' : 'no';
          if (manualState[file] === 'ok') revealManual(file);
        }, function () { manualState[file] = 'no'; });
      } catch (e) {
        manualState[file] = 'no';
      }
    });
  }
  function manualHtml(d) {
    var file = manualFile(d);
    if (!file) return '';
    return '<a class="pf-manual" href="' + MANUAL_BASE + esc(encodeURIComponent(file)) + '" target="_blank" rel="noopener" data-manual="' + esc(file) + '"' +
      ' aria-label="' + esc(format(T.devices.manualLabel, { name: d.name })) + '"' + (manualState[file] === 'ok' ? '' : ' hidden') + '>' + esc(T.devices.manual) + '</a>';
  }
  function deviceHtml(d) {
    var D = T.devices, bits = [D.types[d.type] || D.types.other];
    if (d.since) bits.push(format(D.since, { month: HC.fmtMonth(d.since + '-01') }));
    if (d.source === 'strava') bits.push(D.fromStrava);
    var usage = fin(d.count) && d.count > 0 ? format(HC.isoDate(d.lastUsed) ? D.usage : D.usageNoDate, { n: d.count, date: HC.fmtDate(d.lastUsed) }) : '';
    return '<li class="pf-item"><div class="pf-item-main"><span class="pf-item-name">' + esc(d.name) + '</span>' +
      '<small class="pf-item-sub">' + esc(bits.join(' · ')) + '</small>' +
      (usage ? '<small class="pf-item-sub">' + esc(usage) + '</small>' : '') + '</div>' + manualHtml(d) + '</li>';
  }
  function devicesHtml() {
    var devs = list(P.devices);
    probeManuals(devs);
    return section(T.devices.heading, devs.length ? '<ul class="pf-list">' + devs.map(deviceHtml).join('') + '</ul>' : note(T.devices.none));
  }

  // supplements (profile.json): name, dose and the meal they go with; no macros, no advice
  function supplementsHtml() {
    var S = T.supplements, items = list(P.supplements);
    if (!items.length) return '';
    return section(S.heading, '<ul class="pf-list">' + items.map(function (s) {
      var bits = [];
      if (s.dose) bits.push(s.dose);
      if (S.meals[s.meal]) bits.push(S.meals[s.meal]);
      return '<li class="pf-item"><div class="pf-item-main"><span class="pf-item-name">' + esc(s.name) + '</span>' +
        (bits.length ? '<small class="pf-item-sub">' + esc(bits.join(' · ')) + '</small>' : '') + '</div></li>';
    }).join('') + '</ul>');
  }

  // events (profile.json): upcoming soonest first with the days left on the viewer's clock (nothing
  // time-based is baked); past ones folded, newest first
  function eventItem(e, when) {
    var E = T.events, bits = [E.types[e.type] || E.types.other, HC.fmtDate(e.date)];
    if (e.location) bits.push(e.location);
    return '<li class="pf-item"><div class="pf-item-main"><span class="pf-item-name">' + esc(e.name) + '</span>' +
      '<small class="pf-item-sub">' + esc(bits.join(' · ')) + '</small></div>' +
      (when ? '<span class="pf-ev-left">' + esc(when) + '</span>' : '') + '</li>';
  }
  function eventsHtml() {
    var E = T.events, items = list(P.events), up = [], past = [];
    if (!items.length) return '';
    items.forEach(function (e) {
      var ago = HC.daysOld(e.date);
      if (ago == null) return;
      if (ago <= 0) up.push({ e: e, left: -ago });
      else past.push(e);
    });
    var when = function (n) { return n === 0 ? E.today : n === 1 ? E.tomorrow : format(E.inDays, { n: n }); };
    var inner = up.length
      ? '<ul class="pf-list">' + up.map(function (x) { return eventItem(x.e, when(x.left)); }).join('') + '</ul>'
      : note(E.none);
    if (past.length) {
      inner += '<details class="pf-retired pf-ev-past"><summary>' + esc(format(E.past, { n: past.length })) + '</summary><ul class="pf-list">' +
        past.reverse().map(function (e) { return eventItem(e, ''); }).join('') + '</ul></details>';
    }
    return section(E.heading, inner);
  }

  function stravaHtml() {
    var S = T.strava, out = [];
    if (P.focus && S.focusValues[P.focus]) out.push('<div class="pf-row"><span class="pf-lbl">' + esc(S.focus) + '</span><b class="pf-row-val">' + esc(S.focusValues[P.focus]) + '</b></div>');
    if (P.stravaAsOf) out.push(note(format(S.asOf, { date: HC.fmtDate(P.stravaAsOf) })));
    return out.length ? section(S.heading, out.join('')) : '';
  }

  // the plan's goal: owned by client/nutri-day.js (window.HCNutri); a ready-made description per option
  function nutri() {
    var n = window.HCNutri;
    return n && typeof n.setGoal === 'function' && typeof n.state === 'function' ? n : null;
  }
  function goalDesc(o) {
    var G = T.goal;
    if (o.goal === 'maintain') return G.maintain;
    if (!fin(o.kcal) || o.kcal === 0) return G.same;
    var kcal = (o.kcal < 0 ? '\u2212' : '+') + HC.num(Math.abs(o.kcal), 0);
    var key = (o.kcal < 0 ? 'deficit' : 'surplus') + (o.bikeKept ? 'BikeKept' : '');
    return format(G[key], { kcal: kcal });
  }
  // the server-side settings (client/settings.js), only once the LAN API answered
  function settings() {
    var st = window.HCSettings;
    return st && typeof st.ready === 'function' && st.ready() ? st : null;
  }
  function targetHtml(st) {
    var G = T.goal, L = st.limits(), v = st.targetWeight();
    return '<div class="food-field pf-target"><label class="food-lbl" for="pf-target">' + esc(G.target) + '</label>' +
      '<div class="food-in-wrap"><input class="food-in" id="pf-target" type="text" inputmode="decimal" autocomplete="off" value="' +
      (fin(v) ? esc(HC.numInput(v, 1)) : '') + '" aria-describedby="pf-target-hint pf-target-err"><span class="food-suffix" aria-hidden="true">kg</span></div>' +
      '<small class="pf-goal-desc" id="pf-target-hint">' + esc(format(G.targetHint, { min: L.min, max: L.max })) + '</small>' +
      '<small class="food-err" id="pf-target-err"></small></div>';
  }
  function progressText() {
    var p = window.HCProgress;
    try { return p && typeof p.line === 'function' ? p.line() : ''; } catch (e) { return ''; }
  }
  function goalHtml() {
    var n = nutri(), G = T.goal;
    var opts = list(P.goals).filter(function (o) { return o && G.options[o.goal]; });
    if (!n || !opts.length) return '';
    var cur = n.state().goal, st = settings(), prog = progressText();
    return '<section class="pf-sec pf-goal-sec"><fieldset class="pf-goal" id="pf-goal"><legend class="pf-h">' + esc(G.heading) + '</legend>' +
      opts.map(function (o) {
        return '<label class="pf-goal-opt"><input type="radio" name="pf-goal" value="' + esc(o.goal) + '"' + (o.goal === cur ? ' checked' : '') + '>' +
          '<span class="pf-goal-txt"><b class="pf-goal-name">' + esc(G.options[o.goal]) + '</b><small class="pf-goal-desc">' + esc(goalDesc(o)) + '</small></span></label>';
      }).join('') + '</fieldset>' +
      (st ? targetHtml(st) + '<p class="pf-note pf-status" id="pf-goal-msg" role="status" aria-live="polite"></p>' : '') +
      (prog ? '<p class="pf-note pf-progress" id="pf-progress"><span class="pf-lbl">' + esc(G.progress) + '</span> <span id="pf-progress-txt">' + esc(prog) + '</span></p>' : '') +
      '</section>';
  }
  function el(id) {
    return document.getElementById ? document.getElementById(id) : null;
  }
  function setText(id, text) {
    var x = el(id);
    if (x) x.textContent = text;
  }
  // the one status line of the goal section: the last goal / target save
  function statusText(s) {
    var G = T.goal, last = s && s.last, pend = s && s.pending ? ' ' + G.pending : '';
    if (!last) return s && s.pending ? G.pending : '';
    if (last.status === 'saving') return G.saving;
    if (last.status === 'saved') return (last.what === 'goal' ? G.savedGoal : G.saved) + pend;
    return format(G.failed, { reason: G.reasons[last.code] || G.reasons.generic }) + pend;
  }
  function targetError(kind) {
    var input = el('pf-target'), G = T.goal, st = settings();
    var L = st ? st.limits() : { min: '', max: '' };
    setText('pf-target-err', kind ? format(G.targetErr[kind] || G.targetErr.number, { min: L.min, max: L.max }) : '');
    if (input && input.setAttribute) {
      if (kind) input.setAttribute('aria-invalid', 'true');
      else if (input.removeAttribute) input.removeAttribute('aria-invalid');
    }
  }
  if (document.addEventListener) {
    document.addEventListener('change', function (e) {
      var t = e && e.target;
      if (!t) return;
      if (t.id === 'pf-target') {
        var st = settings();
        if (!st) return;
        var r = st.parseTarget(t.value);
        if (r.error) { targetError(r.error); return; }
        targetError(null);
        if (r.value === st.targetWeight()) return;
        st.saveTarget(r.value).catch(function () { /* the status line says why */ });
        return;
      }
      if (t.name === 'pf-lang') { saveLang(t.value); return; }
      if (t.name !== 'pf-goal') return;
      var n = nutri(), ok = list(P.goals).some(function (o) { return o && o.goal === t.value; });
      if (n && ok) n.setGoal(t.value);
    });
  }
  var ST = window.HCSettings;
  if (ST && typeof ST.onChange === 'function') {
    ST.onChange(function (s) {
      if (s && s.last && s.last.what === 'locale') { setText('pf-lang-msg', langStatusText(s.last)); return; }
      setText('pf-goal-msg', statusText(s));
      var prog = progressText();
      if (prog) setText('pf-progress-txt', prog);
    });
  }

  // the page language (LAN page only): stored on the server, used by the next build
  var LANGS = ['es', 'en'];
  function pageLang() {
    return typeof LOCALE !== 'undefined' && LANGS.indexOf(LOCALE) >= 0 ? LOCALE : 'en';
  }
  function currentLang(st) {
    var l = st && typeof st.locale === 'function' ? st.locale() : null;
    return LANGS.indexOf(l) >= 0 ? l : pageLang();
  }
  function langHtml() {
    var st = settings(), L = T.language;
    if (!st || !L || typeof st.saveLocale !== 'function') return '';
    var cur = currentLang(st);
    return '<section class="pf-sec pf-lang-sec"><fieldset class="pf-goal" id="pf-lang"><legend class="pf-h">' + esc(L.heading) + '</legend>' +
      LANGS.map(function (l) {
        return '<label class="pf-goal-opt"><input type="radio" name="pf-lang" value="' + l + '"' + (l === cur ? ' checked' : '') + '>' +
          '<span class="pf-goal-txt"><b class="pf-goal-name" lang="' + l + '">' + esc(L.options[l]) + '</b></span></label>';
      }).join('') + '</fieldset>' +
      '<small class="pf-goal-desc">' + esc(L.hint) + '</small>' +
      '<p class="pf-note pf-status" id="pf-lang-msg" role="status" aria-live="polite"></p></section>';
  }
  function langStatusText(last) {
    var G = T.goal, L = T.language;
    if (last.status === 'saving') return G.saving;
    if (last.status === 'saved') return L.rebuilding;
    return format(G.failed, { reason: G.reasons[last.code] || G.reasons.generic });
  }
  function saveLang(v) {
    var st = settings();
    if (!st || typeof st.saveLocale !== 'function' || LANGS.indexOf(v) < 0 || v === currentLang(st)) return;
    Promise.resolve(st.saveLocale(v)).then(function () {
      // the normal refresh: the next build reads the new language (a hidden button = the hourly build picks it up)
      var b = el('sync-btn');
      if (b && !b.hidden && typeof b.click === 'function') b.click();
    }).catch(function () { /* the status line says why */ });
  }

  // the in-page onboarding's entry (client/onboarding.js registers the view; LAN page only)
  // the in-page onboarding's opener: a short chip at the end of the header row (LAN page only: it saves to
  // the ingest service)
  function onbHtml() {
    var O = typeof I18N_ONB !== 'undefined' ? I18N_ONB : null, V = window.HCViews;
    if (!O || !V || !V.onboarding || !HC.lan()) return '';
    return '<button type="button" class="chip pf-edit" data-onb-open="">' + esc(O.edit) + '</button>';
  }
  function render() {
    if (!P.hasData) return { head: headHtml(), body: goalHtml() + langHtml() + note(T.onboarding, 'pf-onboard') };
    return { head: headHtml(), body: goalHtml() + langHtml() + eventsHtml() + bodyHtml() + gearHtml() + devicesHtml() + supplementsHtml() + stravaHtml() + note(T.note, 'pf-foot') };
  }

  HC.registerView('profile', { title: function () { return T.title; }, render: render });
  window.HCProfile = { ageOn: ageOn, render: render };
})();
