/* Profile sheet: registers the `profile` view of the detail sheet (window.HCViews.profile, rendered by
 * client/detail.js in its modal, deep link #profile), opened by the avatar button in the top bar
 * (components/Avatar.astro, data-detail="profile"). Strava-style card, honest data only:
 *   header  — photo (or initials, or a generic icon), full name, age, location;
 *   Body    — height (manual) + the latest weigh-in with its date (never Strava's weight);
 *   Gear    — bikes and shoes from Strava with km (1 decimal), retired ones folded, a gentle hint on
 *             shoes past SHOE_REPLACE_KM, or a note when the token lacks the profile:read_all scope;
 *   Devices — manual devices + those seen on Strava activities (deduped at build time);
 *   Strava  — focus + the snapshot date.
 * Nothing known at all -> the onboarding hint.
 *
 * Classic script (is:inline), inlined BEFORE detail.js. Reads PROFILE (lib/profile/profile.mjs, baked by
 * Avatar.astro with `photo` as a flag: the data URI is baked ONCE, in the button's <img id="avatar-img">,
 * and copied from there) + I18N_PROFILE, and window.HC (util.js). The age is computed here on the viewer's
 * clock, so builds stay byte-identical.
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
  // whole years between an ISO birthdate and an ISO day; null when either is not a date or birth > day
  function ageOn(birth, day) {
    birth = HC.isoDate(birth);
    day = HC.isoDate(day);
    if (!birth || !day || birth > day) return null;
    var age = +day.slice(0, 4) - +birth.slice(0, 4);
    if (day.slice(5) < birth.slice(5)) age--;
    return age;
  }
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
      (meta.length ? '<div class="pf-meta">' + esc(meta.join(' · ')) + '</div>' : '') + '</div></div>';
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

  function deviceHtml(d) {
    var D = T.devices, bits = [D.types[d.type] || D.types.other];
    if (d.since) bits.push(format(D.since, { month: HC.fmtMonth(d.since + '-01') }));
    if (d.source === 'strava') bits.push(D.fromStrava);
    var usage = fin(d.count) && d.count > 0 ? format(HC.isoDate(d.lastUsed) ? D.usage : D.usageNoDate, { n: d.count, date: HC.fmtDate(d.lastUsed) }) : '';
    return '<li class="pf-item"><div class="pf-item-main"><span class="pf-item-name">' + esc(d.name) + '</span>' +
      '<small class="pf-item-sub">' + esc(bits.join(' · ')) + '</small>' +
      (usage ? '<small class="pf-item-sub">' + esc(usage) + '</small>' : '') + '</div></li>';
  }
  function devicesHtml() {
    var devs = list(P.devices);
    return section(T.devices.heading, devs.length ? '<ul class="pf-list">' + devs.map(deviceHtml).join('') + '</ul>' : note(T.devices.none));
  }

  function stravaHtml() {
    var S = T.strava, out = [];
    if (P.focus && S.focusValues[P.focus]) out.push('<div class="pf-row"><span class="pf-lbl">' + esc(S.focus) + '</span><b class="pf-row-val">' + esc(S.focusValues[P.focus]) + '</b></div>');
    if (P.stravaAsOf) out.push(note(format(S.asOf, { date: HC.fmtDate(P.stravaAsOf) })));
    return out.length ? section(S.heading, out.join('')) : '';
  }

  function render() {
    if (!P.hasData) return { head: headHtml(), body: note(T.onboarding, 'pf-onboard') };
    return { head: headHtml(), body: bodyHtml() + gearHtml() + devicesHtml() + stravaHtml() + note(T.note, 'pf-foot') };
  }

  window.HCViews = window.HCViews || {};
  window.HCViews.profile = { title: function () { return T.title; }, render: render };
  window.HCProfile = { ageOn: ageOn, render: render };
})();
