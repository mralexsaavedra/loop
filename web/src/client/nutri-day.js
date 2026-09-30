/* Nutrición day blocks — Resumen de hoy (goal + day type + today's target), Plan de hoy (the day's
 * meals scaled to that target) and Avituallamiento (bike day types only) — plus Inicio's "today you
 * eat" card. Classic script (is:inline). Reads NUTRI (lib/nutrition/today.mjs: the 12 precomputed
 * goal × day type plans, fuelling rates, detection thresholds, latest weigh-in) + I18N_NUTRI, baked
 * by web/src/tabs/Dia.astro, and SCORES.timeline / TRAINING (Bake.astro) for today's workouts and
 * programmed session. Everything time-based is decided HERE on the viewer's clock, so builds stay
 * byte-identical.
 *
 * - Day type: detectDayType ports lib/nutrition/daytype.mjs over the baked NUTRI.detect (a test runs
 *   both over the same cases). A manual override is kept in localStorage WITH its date, so it expires
 *   the next day; the goal is kept too. Storage is a per-viewer convenience: every access is wrapped
 *   and the page works without it.
 * - Fuelling: fuelPlan ports lib/nutrition/fuel.mjs over NUTRI.fuel.rates (pinned by a test). The ride
 *   duration = today's recorded ride when there is one, else the picker (default 2 h / 3.5 h).
 * - The chosen day type drives the legacy train/rest state (core.js setDay: Registro, intake rings), and
 *   window.nutriTarget() hands the intake rings today's target.
 * Each block renders in its own try/catch: a failure shows a one-line message there, never a blank tab. */
(function () {
  var N = typeof NUTRI === 'undefined' || !NUTRI ? null : NUTRI;
  var T = typeof I18N_NUTRI === 'undefined' || !I18N_NUTRI ? null : I18N_NUTRI;
  if (!N || !T) return;
  var esc = HC.esc, format = HC.format, todayIso = HC.todayIso;
  var KEY_GOAL = 'hc.nutri.goal', KEY_DAY = 'hc.nutri.dayType';
  var RANK = { rest: 0, gym: 1, bike: 2, bikeLong: 3 };
  var state = { goal: N.goal, override: null, auto: null, rideMin: null };

  function $(id) { return document.getElementById(id); }
  function kf(n) { // thousands separator: 3.050 (es) / 3,050 (en)
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, HC.isEs() ? '.' : ',');
  }
  function dur(min) { return HC.duration(min, T.units); }
  function isBike(d) { return d === 'bike' || d === 'bikeLong'; }

  /* ---------- storage (per-viewer convenience, never required) ---------- */
  function store() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }
  function load(key) {
    try { var s = store(); return s ? s.getItem(key) : null; } catch (e) { return null; }
  }
  function save(key, value) {
    try { var s = store(); if (!s) return; if (value == null) s.removeItem(key); else s.setItem(key, value); } catch (e) { /* ignored */ }
  }

  /* ---------- day type detection (port of lib/nutrition/daytype.mjs) ---------- */
  function rideType(min) {
    if (min >= N.detect.bikeLongMin) return 'bikeLong';
    if (min >= N.detect.bikeMin) return 'bike';
    if (min >= N.detect.rideMin) return 'gym';
    return null;
  }
  function itemType(it) {
    if (!it || typeof it.dur !== 'number' || !(it.dur > 0)) return null;
    if (it.modality === 'bike') return rideType(it.dur);
    if (it.modality === 'other') return it.dur >= N.detect.otherMin ? 'gym' : null;
    return it.dur >= N.detect.gymMin ? 'gym' : null;
  }
  function ofWorkouts(items) {
    var best = null;
    (items || []).forEach(function (it) {
      var type = itemType(it);
      if (!type) return;
      var rideMin = isBike(type) ? Math.round(it.dur) : null;
      if (!best || RANK[type] > RANK[best.type]) best = { type: type, rideMin: rideMin };
    });
    return best;
  }
  function ofProgram(s) {
    if (!s || typeof s !== 'object') return null;
    if (s.kind !== 'bike') return 'gym';
    return typeof s.durationMin === 'number' && s.durationMin > 0 ? rideType(s.durationMin) : 'bike';
  }
  function detectDayType(input) {
    var done = ofWorkouts(input.items), plan = ofProgram(input.programmed);
    if (done && !(plan && RANK[plan] > RANK[done.type])) return { type: done.type, why: done.rideMin != null ? 'ride' : 'workout', rideMin: done.rideMin };
    if (plan) return { type: plan, why: 'programmed', rideMin: null };
    return { type: 'rest', why: 'none', rideMin: null };
  }
  function todayInput(today) {
    var S = typeof SCORES === 'undefined' ? null : SCORES;
    var days = S && S.timeline && S.timeline.days ? S.timeline.days : [];
    var items = [];
    days.forEach(function (d) { if (d && d.date === today) items = d.items || []; });
    var TR = typeof TRAINING === 'undefined' || !TRAINING ? {} : TRAINING;
    return { items: items, programmed: TR[today] || null };
  }

  /* ---------- fuelling (port of lib/nutrition/fuel.mjs) ---------- */
  function fuelPlan(o) {
    if (!isBike(o.dayType)) return null;
    var F = N.fuel.rates, U = F.units;
    var min = isFinite(o.minutes) && o.minutes > 0 ? Math.round(o.minutes) : N.fuel.defaults[o.dayType];
    var h = min / 60;
    var kg = isFinite(o.weightKg) && o.weightKg > 0 ? o.weightKg : null;
    var step = function (v, s) { return Math.round(v / s) * s; };
    var range = function (r, mul, s) { return [step(r[0] * mul, s), step(r[1] * mul, s)]; };
    var gPerH = F.during.gPerH[o.dayType];
    var planG = step(((gPerH[0] + gPerH[1]) / 2) * h, F.roundG);
    var bottleMid = (U.bottleG[0] + U.bottleG[1]) / 2;
    var bottles = Math.max(0, Math.min(Math.ceil(h), Math.floor(planG / bottleMid)));
    return {
      minutes: min,
      before: { hoursBefore: F.before.hoursBefore, gPerKg: F.before.gPerKg, carbsG: kg ? range(F.before.gPerKg, kg, F.roundG) : null, lastHourG: F.before.lastHourG },
      during: {
        gPerH: gPerH,
        carbsG: range(gPerH, h, F.roundG),
        planG: planG,
        fluidsMl: range(F.during.fluidMlPerH, h, F.roundMl),
        sodiumMg: range(F.during.sodiumMgPerH, h, F.roundMg),
        equiv: {
          gels: Math.ceil(planG / U.gelG),
          bananas: Math.ceil(planG / U.bananaG),
          bars: Math.ceil(planG / U.barG),
          bottles: [Math.ceil(planG / U.bottleG[1]), Math.ceil(planG / U.bottleG[0])],
        },
        mix: { bottles: bottles, gels: Math.ceil(Math.max(0, planG - bottles * bottleMid) / U.gelG) },
      },
      after: { withinH: F.after.withinH, gPerKg: F.after.gPerKg, carbsG: kg ? range(F.after.gPerKg, kg, F.roundG) : null, proteinG: F.after.proteinG },
      kcal: planG * F.kcalPerG,
    };
  }

  /* ---------- state ---------- */
  function dayType() { return state.override || (state.auto ? state.auto.type : 'rest'); }
  function current() { return N.plans[state.goal][dayType()]; }
  function rideMinutes() {
    var d = dayType();
    if (!isBike(d)) return null;
    if (state.rideMin) return state.rideMin;
    if (state.auto && state.auto.rideMin && state.auto.type === d) return state.auto.rideMin;
    return N.fuel.defaults[d];
  }
  function fuelNow() {
    var w = N.weight;
    return fuelPlan({ dayType: dayType(), minutes: rideMinutes(), weightKg: w ? w.kg : null });
  }
  function init() {
    var today = todayIso();
    state.auto = detectDayType(todayInput(today));
    var g = load(KEY_GOAL);
    if (N.goals.indexOf(g) >= 0) state.goal = g;
    try {
      var o = JSON.parse(load(KEY_DAY) || 'null');
      if (o && o.date === today && N.dayTypes.indexOf(o.type) >= 0 && o.type !== state.auto.type) state.override = o.type;
    } catch (e) { /* a broken stored value is ignored */ }
  }

  /* ---------- blocks ---------- */
  function guard(host, fn) {
    if (!host) return;
    try { fn(host); } catch (e) { host.innerHTML = '<p class="nutri-failed">' + esc(T.failed) + '</p>'; }
  }
  function setChecked(name, value) {
    (document.querySelectorAll('[name="' + name + '"]') || []).forEach(function (inp) {
      inp.checked = inp.getAttribute('value') === value;
    });
  }
  function renderControls() {
    setChecked('nutri-goal', state.goal);
    setChecked('nutri-day', dayType());
    var src = $('nutri-daytype-src');
    if (src) src.textContent = state.override ? T.chosen : T.auto;
    var btn = $('nutri-auto');
    if (btn) {
      btn.hidden = !state.override;
      btn.textContent = format(T.backToAuto, { type: T.dayTypes[state.auto.type] });
    }
    var why = $('nutri-why');
    if (why) why.textContent = format(T.why[state.auto.why], { dur: state.auto.rideMin ? dur(state.auto.rideMin) : '' });
  }
  function macroCell(label, value, cls) {
    return '<div class="nt-mac ' + cls + '"><b>' + esc(kf(value)) + ' g</b><span>' + esc(label) + '</span></div>';
  }
  function remainderHtml(x, fuel) {
    var tol = N.tolerance;
    var rem = fuel ? x.t.kcal - x.tot.k - fuel.kcal : x.rem;
    if (Math.abs(rem) <= tol) return '';
    var k = kf(Math.abs(rem)), g = Math.round(Math.abs(rem) / 4 / 5) * 5;
    var tpl = rem > 0 ? (fuel ? T.remShortBike : T.remShort) : (fuel ? T.remOverBike : T.remOver);
    return '<p class="nt-rem ' + (rem > 0 ? 'nt-short' : 'nt-over') + '">' + esc(format(tpl, { k: k, g: g })) + '</p>';
  }
  function macroOffHtml(x) {
    var out = '';
    [['p', x.tot.p, x.t.p], ['f', x.tot.g, x.t.f]].forEach(function (m) {
      if (Math.abs(m[1] - m[2]) > N.macroTol) out += '<p class="nt-off">' + esc(format(T.macroOff, { macro: T.macroNames[m[0]], plan: m[1], target: m[2] })) + '</p>';
    });
    return out;
  }
  function renderTarget(host) {
    var x = current(), t = x.t, d = dayType();
    var fuel = isBike(d) ? fuelNow() : null;
    var line = fuel
      ? format(T.planLineBike, { k: kf(x.tot.k), fuel: kf(fuel.kcal), total: kf(x.tot.k + fuel.kcal) })
      : format(T.planLine, { k: kf(x.tot.k), p: x.tot.p, c: x.tot.c, f: x.tot.g });
    host.innerHTML =
      '<div class="nt-head"><span class="nt-lbl">' + esc(T.target.heading) + '</span>' +
      '<span class="nt-day">' + esc(T.dayIcons[d] + ' ' + T.dayTypes[d] + ' · ' + T.goals[state.goal]) + '</span></div>' +
      '<div class="nt-kcal"><b>' + esc(kf(t.kcal)) + '</b><span>' + esc(T.target.kcal) + '</span></div>' +
      '<div class="nt-macros">' + macroCell(T.target.p, t.p, 'nt-p') + macroCell(T.target.f, t.f, 'nt-f') + macroCell(T.target.c, t.c, 'nt-c') + '</div>' +
      '<p class="nt-cnote">' + esc(T.target.cNote) + '</p>' +
      '<p class="nt-plan">' + esc(line) + '</p>' + remainderHtml(x, fuel) + macroOffHtml(x);
  }
  function suppLine(s) {
    return '<div class="meal-supp">' + esc(T.plan.suppIcon + ' ' + s.name + (s.dose ? ' ' + s.dose : '')) + '</div>';
  }
  function renderPlan(host) {
    var x = current(), base = N.base[x.base];
    if (!base || !base.meals.length) { host.innerHTML = '<p class="nutri-empty">' + esc(T.plan.empty) + '</p>'; return; }
    var supps = (N.supplements || []).slice();
    var used = {};
    var fi = 0;
    var html = base.meals.map(function (meal, i) {
      var m = x.meals[i];
      var parts = meal.parts.map(function (p) {
        var q = p.x ? x.flex[fi++] : p.q;
        return '<li class="mp' + (p.x ? ' mp-flex' : '') + '"><span class="mp-l">' + esc(p.l) + '</span>' +
          '<span class="mp-q">' + esc(q) + '</span>' +
          (p.x ? '<span class="mp-tag" title="' + esc(T.plan.flexAria) + '">' + esc(T.plan.flexTag) + '</span>' : '') + '</li>';
      }).join('');
      var mine = '';
      if (meal.s && !used[meal.s]) {
        used[meal.s] = true;
        supps.forEach(function (s) { if (s.meal === meal.s) mine += suppLine(s); });
      }
      return '<div class="meal"><div class="meal-top"><div class="meal-name">' + esc(meal.n) + '</div>' +
        '<div class="meal-kcal">~' + esc(kf(m[0])) + ' kcal</div></div>' +
        '<ul class="meal-parts">' + parts + '</ul>' +
        (meal.pcf ? '<div class="meal-pcf"><span><b>' + m[1] + '</b> P</span><span><b>' + m[2] + '</b> C</span><span><b>' + m[3] + '</b> G</span></div>' : '') +
        mine + '</div>';
    }).join('');
    var others = supps.filter(function (s) { return !used[s.meal]; });
    if (others.length) {
      html += '<div class="meal meal-others"><div class="meal-name">' + esc(T.plan.otherSupps) + '</div>' +
        others.map(function (s) {
          return '<div class="meal-supp">' + esc(T.plan.suppIcon + ' ' + s.name + (s.dose ? ' ' + s.dose : '') + ' (' + (T.plan.meals[s.meal] || s.meal) + ')') + '</div>';
        }).join('') + '</div>';
    }
    var ftpl = x.clamp === 'max' ? T.plan.factorMax : x.clamp === 'min' ? T.plan.factorMin : T.plan.factor;
    if (x.factor !== 1 || x.clamp) html += '<p class="nutri-factor">' + esc(format(ftpl, { factor: HC.nf(x.factor) })) + '</p>';
    host.innerHTML = html;
  }
  function renderRidePicker(host) {
    var d = dayType(), rec = state.auto && state.auto.rideMin && state.auto.type === d ? state.auto.rideMin : null;
    var sel = rideMinutes();
    var opts = '';
    if (rec) opts += '<option value="' + rec + '"' + (sel === rec ? ' selected' : '') + '>' + esc(format(T.fuel.recorded, { dur: dur(rec) })) + '</option>';
    N.fuel.durations.forEach(function (m) {
      if (m === rec) return;
      opts += '<option value="' + m + '"' + (sel === m ? ' selected' : '') + '>' + esc(dur(m)) + '</option>';
    });
    host.innerHTML = '<label class="fuel-dur" for="nutri-ride">' + esc(T.fuel.durationLabel) + '</label><select id="nutri-ride" class="fuel-select">' + opts + '</select>';
  }
  function li(text) { return '<li>' + esc(text) + '</li>'; }
  function renderFuelBody(host) {
    var f = fuelNow(), F = T.fuel, U = N.fuel.rates.units;
    var b = f.before, du = f.during, a = f.after;
    var before = b.carbsG
      ? format(F.beforeCarbs, { hmin: b.hoursBefore[0], hmax: b.hoursBefore[1], lo: b.carbsG[0], hi: b.carbsG[1], kgLo: HC.nf(b.gPerKg[0]), kgHi: HC.nf(b.gPerKg[1]) })
      : format(F.beforeCarbsNoKg, { hmin: b.hoursBefore[0], hmax: b.hoursBefore[1], kgLo: HC.nf(b.gPerKg[0]), kgHi: HC.nf(b.gPerKg[1]) });
    var rate = du.gPerH[0] === du.gPerH[1] ? String(du.gPerH[0]) : du.gPerH[0] + '–' + du.gPerH[1];
    var total = du.carbsG[0] === du.carbsG[1] ? du.carbsG[0] + ' g' : du.carbsG[0] + '–' + du.carbsG[1] + ' g (~' + du.planG + ' g)';
    var after = a.carbsG
      ? format(F.afterCarbs, { lo: a.carbsG[0], hi: a.carbsG[1], kgLo: HC.nf(a.gPerKg[0]), kgHi: HC.nf(a.gPerKg[1]), pLo: a.proteinG[0], pHi: a.proteinG[1] })
      : format(F.afterCarbsNoKg, { kgLo: HC.nf(a.gPerKg[0]), kgHi: HC.nf(a.gPerKg[1]), pLo: a.proteinG[0], pHi: a.proteinG[1] });
    var rates = N.fuel.rates.during;
    host.innerHTML =
      '<div class="fuel-grid">' +
      '<section class="fuel-win"><h3>' + esc(F.before) + '</h3><ul>' + li(before) + li(format(F.lastHour, { lo: b.lastHourG[0], hi: b.lastHourG[1] })) + '</ul></section>' +
      '<section class="fuel-win fuel-during"><h3>' + esc(F.during) + '</h3><ul>' +
      li(format(F.duringCarbs, { rate: rate, total: total })) +
      li(format(F.duringEquiv, { gels: du.equiv.gels, gelG: U.gelG, bananas: du.equiv.bananas, bananaG: U.bananaG, bars: du.equiv.bars, barG: U.barG, bLo: du.equiv.bottles[0], bHi: du.equiv.bottles[1], ml: U.bottleMl, pLo: U.bottlePct[0], pHi: U.bottlePct[1], gLo: U.bottleG[0], gHi: U.bottleG[1] })) +
      li(format(F.duringMix, { bottles: du.mix.bottles, gels: du.mix.gels })) +
      li(format(F.fluids, { lo: kf(du.fluidsMl[0]), hi: kf(du.fluidsMl[1]), rLo: rates.fluidMlPerH[0], rHi: rates.fluidMlPerH[1] })) +
      li(format(F.sodium, { lo: kf(du.sodiumMg[0]), hi: kf(du.sodiumMg[1]), rLo: rates.sodiumMgPerH[0], rHi: rates.sodiumMgPerH[1] })) +
      '</ul></section>' +
      '<section class="fuel-win"><h3>' + esc(F.after) + '</h3><ul>' + li(after) + '</ul></section>' +
      '</div>' +
      (N.weight ? '<p class="fuel-note">' + esc(format(F.weightNote, { kg: HC.num(N.weight.kg, 1), date: HC.fmtDate(N.weight.date) })) + '</p>' : '') +
      '<p class="fuel-note">' + esc(F.inDay) + '</p>' +
      '<p class="fuel-note fuel-disclaimer">' + esc(F.disclaimer) + '</p>';
  }
  function renderEat(host) {
    var x = current(), t = x.t, d = dayType(), E = T.eat;
    host.innerHTML =
      '<div class="eat-day-type">' + esc(format(E.dayGoal, { day: T.dayIcons[d] + ' ' + T.dayTypes[d] + ' ' + (state.override ? T.chosen : T.auto), goal: T.goals[state.goal] })) + '</div>' +
      '<div class="eat-kcal">~' + esc(kf(t.kcal)) + '<span>kcal</span></div>' +
      '<div class="eat-macros">' +
      '<div class="eat-mac"><b>' + t.p + ' g</b><span>' + esc(T.target.p) + '</span></div>' +
      '<div class="eat-mac"><b>' + t.c + ' g</b><span>' + esc(T.target.c) + '</span></div>' +
      '<div class="eat-mac"><b>' + t.f + ' g</b><span>' + esc(T.target.f) + '</span></div></div>';
  }

  function syncLegacyDay() {
    // Registro and the intake rings still think in train / rest (core.js setDay)
    if (typeof window.setDay !== 'function') return;
    try { window.setDay(dayType() === 'rest' ? 'rest' : 'train'); } catch (e) { /* the legacy toggle is optional */ }
  }
  function renderFuel(full) {
    var block = $('nutri-fuel-block'), bike = isBike(dayType());
    if (block) block.hidden = !bike;
    if (!bike) return;
    if (full) guard($('nutri-ride-wrap'), renderRidePicker);
    guard($('nutri-fuel-body'), renderFuelBody);
  }
  function renderAll() {
    try { renderControls(); } catch (e) { /* controls keep their server-rendered state */ }
    guard($('nutri-target'), renderTarget);
    guard($('nutri-plan'), renderPlan);
    renderFuel(true);
    guard($('eat-body'), renderEat);
  }
  function refresh() {
    renderAll();
    syncLegacyDay();
  }

  /* ---------- events ---------- */
  function on(id, evt, fn) {
    var el = $(id);
    if (el && el.addEventListener) el.addEventListener(evt, fn);
  }
  on('nutri-goal', 'change', function (e) {
    var v = e && e.target && e.target.value;
    if (N.goals.indexOf(v) < 0) return;
    state.goal = v;
    save(KEY_GOAL, v);
    refresh();
  });
  on('nutri-daytype', 'change', function (e) {
    var v = e && e.target && e.target.value;
    if (N.dayTypes.indexOf(v) < 0) return;
    state.override = v === state.auto.type ? null : v;
    state.rideMin = null;
    save(KEY_DAY, state.override ? JSON.stringify({ date: todayIso(), type: state.override }) : null);
    refresh();
  });
  on('nutri-auto', 'click', function () {
    state.override = null;
    state.rideMin = null;
    save(KEY_DAY, null);
    refresh();
  });
  on('nutri-ride-wrap', 'change', function (e) {
    var v = e && e.target ? Number(e.target.value) : NaN;
    if (!(v > 0)) return;
    state.rideMin = v;
    guard($('nutri-target'), renderTarget);
    renderFuel(false);
  });

  window.nutriTarget = function () {
    var x = current(), d = dayType();
    return { k: x.t.kcal, p: x.t.p, c: x.t.c, g: x.t.f, label: T.target.heading + ' · ' + T.dayTypes[d] + ' · ' + T.goals[state.goal] };
  };
  window.HCNutri = {
    detectDayType: detectDayType,
    fuelPlan: fuelPlan,
    state: function () { return { goal: state.goal, dayType: dayType(), override: state.override, auto: state.auto, rideMin: rideMinutes() }; },
  };

  try { init(); } catch (e) { state.auto = { type: 'rest', why: 'none', rideMin: null }; }
  refresh();
})();
