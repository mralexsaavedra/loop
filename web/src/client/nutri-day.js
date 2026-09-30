/* Nutrición day blocks — Resumen de hoy (goal + day type + today's target), Plan de hoy (the day's
 * meals scaled to that target) and Avituallamiento (bike day types only) — plus Inicio's "today you
 * eat" card. Classic script (is:inline). Reads NUTRI (lib/nutrition/today.mjs: the 12 goal × day type
 * targets, one scaling model per base day, fuelling rates, detection thresholds, latest weigh-in) +
 * I18N_NUTRI, baked by web/src/tabs/Dia.astro, and SCORES.timeline / TRAINING (Bake.astro) for today's
 * workouts and programmed session. Everything time-based is decided HERE on the viewer's clock, so
 * builds stay byte-identical.
 *
 * - Day type: detectDayType ports lib/nutrition/daytype.mjs over the baked NUTRI.detect (a test runs
 *   both over the same cases). A manual override is kept in localStorage WITH its date (so it expires
 *   the next day) and the type detected when it was picked: an override LESS demanding than a type
 *   detected later that day (picked gym, then a long ride synced) is dropped with a one-line note; a
 *   more demanding one (planning a ride) stays. The goal is kept too. Storage is a per-viewer
 *   convenience: every access is wrapped and the page works without it.
 * - Plan: planFor / solveScale port lib/nutrition/scale.mjs over the baked models (parity test): the
 *   meals aim at target − ride fuel for the ride's minutes (a recorded ride's real minutes, else the
 *   picker, kept per date like the override, else the default), so changing the duration re-scales
 *   Plan de hoy. fuelPlan ports lib/nutrition/fuel.mjs over NUTRI.fuel.rates.
 * - Today's target is the ONE source for the rest of Nutrición: window.nutriTarget() hands the day
 *   builder (client/nutrition.js) and the intake rings (client/intake.js) the MEALS target (on bike days
 *   the day target minus the ride fuel, with the fuel as its own figure), and every goal / day type /
 *   duration change refreshes both directly.
 * Each block renders in its own try/catch: a failure shows a one-line message there, never a blank tab. */
(function () {
  var N = typeof NUTRI === 'undefined' || !NUTRI ? null : NUTRI;
  var T = typeof I18N_NUTRI === 'undefined' || !I18N_NUTRI ? null : I18N_NUTRI;
  if (!N || !T) return;
  var esc = HC.esc, format = HC.format, todayIso = HC.todayIso;
  var KEY_GOAL = 'hc.nutri.goal', KEY_DAY = 'hc.nutri.dayType', KEY_RIDE = 'hc.nutri.rideMin';
  var RANK = { rest: 0, gym: 1, bike: 2, bikeLong: 3 };
  var state = { goal: N.goal, override: null, auto: null, ride: null, raised: null };

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
  function loadToday(key, today) { // a {date, …} value stored today, else null (yesterday's has expired)
    try {
      var o = JSON.parse(load(key) || 'null');
      return o && typeof o === 'object' && o.date === today ? o : null;
    } catch (e) { return null; }
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

  /* ---------- portion scaling (port of lib/nutrition/scale.mjs solveScale / planFor) ---------- */
  function round2(v) { return Math.round(v * 100) / 100; }
  function stepAmount(amt, unit) {
    if (unit === 'ud') return Math.max(100, Math.round(amt / 100) * 100);
    return Math.max(N.scale.step, Math.round(amt / N.scale.step) * N.scale.step);
  }
  function fmtFactor(f, dec) { return f.toFixed(2).replace('.', dec); }
  function fmtAmt(amt, unit, units) {
    return unit === 'ud' ? round2(amt / 100) + ' ' + units.ud : round2(amt) + ' ' + (units[unit] || unit);
  }
  function limit(f) {
    if (f < N.scale.min) return [N.scale.min, 'min'];
    if (f > N.scale.max) return [N.scale.max, 'max'];
    return [f, null];
  }
  function solveScale(model, target, fmt) {
    var units = fmt.units, dec = fmt.dec;
    var fixedK = 0, udK = 0, contK = 0;
    model.fixed.forEach(function (f) { fixedK += f[0]; });
    model.flex.forEach(function (x) {
      if (x.mb) contK += x.mb[0];
      else x.ln.forEach(function (l) { if (l[0] === 'ud') udK += l[2]; else contK += l[2]; });
    });
    var lc = udK + contK > 0 ? limit((target - fixedK) / (udK + contK)) : [1, null];
    var f0 = round2(lc[0]), clamp = lc[1];
    var amountAt = function (l, s) { return s === 1 ? l[1] : stepAmount(l[1] * s, l[0]); };
    var factor = f0;
    if (udK > 0 && contK > 0) {
      var udNowK = 0;
      model.flex.forEach(function (x) {
        if (x.ln) x.ln.forEach(function (l) { if (l[0] === 'ud') udNowK += l[2] * (amountAt(l, f0) / l[1]); });
      });
      lc = limit((target - fixedK - udNowK) / contK);
      factor = round2(lc[0]);
      clamp = lc[1];
    }
    var meals = model.fixed.map(function (f) { return f.slice(); });
    var q = [];
    model.flex.forEach(function (x) {
      var m = meals[x.m], i;
      if (x.mb) {
        for (i = 0; i < 4; i++) m[i] += x.mb[i] * factor;
        q.push(factor === 1 ? x.q : (x.q + ' ×' + fmtFactor(factor, dec)).trim());
        return;
      }
      q.push(x.ln.map(function (l) {
        var amt = amountAt(l, l[0] === 'ud' ? f0 : factor);
        var r = amt / l[1];
        for (var j = 0; j < 4; j++) m[j] += l[j + 2] * r;
        return fmtAmt(amt, l[0], units);
      }).join(' + '));
    });
    var totals = { k: 0, p: 0, c: 0, g: 0 };
    meals.forEach(function (m) { totals.k += m[0]; totals.p += m[1]; totals.c += m[2]; totals.g += m[3]; });
    return { factor: factor, clamp: clamp, udOnly: udK > 0 && contK === 0, meals: meals, q: q, totals: totals, rem: Math.round(target) - Math.round(totals.k) };
  }
  function planFor(bake, goal, d, minutes) {
    var x = bake.plans[goal][d];
    var fuel = isBike(d) ? fuelPlan({ dayType: d, minutes: minutes }) : null;
    var fuelK = fuel ? fuel.kcal : 0;
    var fuelC = fuel ? fuel.during.planG : 0;
    var s = solveScale(bake.base[x.base], x.t.kcal - fuelK, bake.fmt);
    var tot = { k: Math.round(s.totals.k), p: Math.round(s.totals.p), c: Math.round(s.totals.c), g: Math.round(s.totals.g) };
    return {
      base: x.base,
      t: x.t,
      minutes: fuel ? fuel.minutes : null,
      fuelK: fuelK,
      fuelC: fuelC,
      mt: { k: x.t.kcal - fuelK, p: x.t.p, c: x.t.c - fuelC, f: x.t.f },
      meals: s.meals.map(function (m) { return m.map(Math.round); }),
      flex: s.q,
      tot: tot,
      factor: s.factor,
      clamp: s.clamp,
      udOnly: s.udOnly,
      rem: x.t.kcal - fuelK - tot.k,
    };
  }

  /* ---------- state ---------- */
  function dayType() { return state.override || (state.auto ? state.auto.type : 'rest'); }
  function recordedMin(d) { return state.auto && state.auto.rideMin && state.auto.type === d ? state.auto.rideMin : null; }
  function rideMinutes() {
    var d = dayType();
    if (!isBike(d)) return null;
    var rec = recordedMin(d);
    if (rec) return rec; // a recorded ride's real minutes
    if (state.ride && state.ride.type === d) return state.ride.min;
    return N.fuel.defaults[d];
  }
  function current() { return planFor(N, state.goal, dayType(), rideMinutes()); }
  function fuelNow() {
    var w = N.weight;
    return fuelPlan({ dayType: dayType(), minutes: rideMinutes(), weightKg: w ? w.kg : null });
  }
  function init() {
    var today = todayIso();
    state.auto = detectDayType(todayInput(today));
    var g = load(KEY_GOAL);
    if (N.goals.indexOf(g) >= 0) state.goal = g;
    var o = loadToday(KEY_DAY, today);
    if (o && N.dayTypes.indexOf(o.type) >= 0 && o.type !== state.auto.type) {
      var detectedLater = !(o.auto in RANK) || RANK[state.auto.type] > RANK[o.auto];
      if (RANK[o.type] < RANK[state.auto.type] && detectedLater) {
        // picked gym, then a long ride synced: the detected (more demanding) type wins
        save(KEY_DAY, null);
        state.raised = state.auto.type;
      } else state.override = o.type;
    }
    var r = loadToday(KEY_RIDE, today);
    if (r && N.dayTypes.indexOf(r.type) >= 0 && typeof r.min === 'number' && r.min > 0) state.ride = { type: r.type, min: r.min };
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
    var note = $('nutri-note');
    if (note) {
      note.hidden = !state.raised;
      note.textContent = state.raised ? format(T.autoRaised[state.raised], { type: T.dayTypes[state.raised] }) : '';
    }
  }
  function macroCell(label, value, cls) {
    return '<div class="nt-mac ' + cls + '"><b>' + esc(kf(value)) + ' g</b><span>' + esc(label) + '</span></div>';
  }
  function remainderHtml(x) {
    var rem = x.rem, bike = x.fuelK > 0;
    if (Math.abs(rem) <= N.tolerance) return '';
    var k = kf(Math.abs(rem)), g = Math.round(Math.abs(rem) / 4 / 5) * 5;
    var tpl = rem > 0 ? (bike ? T.remShortBike : T.remShort) : (bike ? T.remOverBike : T.remOver);
    return '<p class="nt-rem ' + (rem > 0 ? 'nt-short' : 'nt-over') + '">' + esc(format(tpl, { k: k, g: g })) + '</p>';
  }
  function macroOffHtml(x) {
    var out = '';
    [['p', x.tot.p, x.t.p], ['f', x.tot.g, x.t.f]].forEach(function (m) {
      if (Math.abs(m[1] - m[2]) > N.macroTol) out += '<p class="nt-off">' + esc(format(T.macroOff, { macro: T.macroNames[m[0]], plan: m[1], target: m[2] })) + '</p>';
    });
    return out;
  }
  function target() { return N.plans[state.goal][dayType()].t; }
  function renderTarget(host, x) {
    var t = target(), d = dayType();
    var line = !x ? '' : x.fuelK > 0
      ? format(T.planLineBike, { k: kf(x.tot.k), fuel: kf(x.fuelK), total: kf(x.tot.k + x.fuelK) })
      : format(T.planLine, { k: kf(x.tot.k), p: x.tot.p, c: x.tot.c, f: x.tot.g });
    host.innerHTML =
      '<div class="nt-head"><span class="nt-lbl">' + esc(T.target.heading) + '</span>' +
      '<span class="nt-day">' + esc(T.dayIcons[d] + ' ' + T.dayTypes[d] + ' · ' + T.goals[state.goal]) + '</span></div>' +
      '<div class="nt-kcal"><b>' + esc(kf(t.kcal)) + '</b><span>' + esc(T.target.kcal) + '</span></div>' +
      '<div class="nt-macros">' + macroCell(T.target.p, t.p, 'nt-p') + macroCell(T.target.f, t.f, 'nt-f') + macroCell(T.target.c, t.c, 'nt-c') + '</div>' +
      '<p class="nt-cnote">' + esc(T.target.cNote) + '</p>' +
      (x ? '<p class="nt-plan">' + esc(line) + '</p>' + remainderHtml(x) + macroOffHtml(x) : '');
  }
  function suppLine(s) {
    return '<div class="meal-supp">' + esc(T.plan.suppIcon + ' ' + s.name + (s.dose ? ' ' + s.dose : '')) + '</div>';
  }
  function renderPlan(host, x) {
    var base = N.base[x.base];
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
    if (x.factor !== 1 || x.clamp) html += '<p class="nutri-factor">' + esc(format(ftpl, { factor: fmtFactor(x.factor, N.fmt.dec) })) + '</p>';
    if (x.udOnly && Math.abs(x.rem) > N.tolerance) html += '<p class="nutri-factor">' + esc(T.plan.unitsOnly) + '</p>';
    host.innerHTML = html;
  }
  function renderRidePicker(host) {
    var d = dayType(), rec = recordedMin(d);
    if (rec) {
      host.innerHTML = '<p class="fuel-dur">' + esc(T.fuel.durationLabel + ': ' + format(T.fuel.recorded, { dur: dur(rec) })) + '</p>';
      return;
    }
    var sel = rideMinutes();
    var opts = '';
    N.fuel.durations.forEach(function (m) {
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
    var t = target(), d = dayType(), E = T.eat;
    host.innerHTML =
      '<div class="eat-day-type">' + esc(format(E.dayGoal, { day: T.dayIcons[d] + ' ' + T.dayTypes[d] + ' ' + (state.override ? T.chosen : T.auto), goal: T.goals[state.goal] })) + '</div>' +
      '<div class="eat-kcal">~' + esc(kf(t.kcal)) + '<span>kcal</span></div>' +
      '<div class="eat-macros">' +
      '<div class="eat-mac"><b>' + t.p + ' g</b><span>' + esc(T.target.p) + '</span></div>' +
      '<div class="eat-mac"><b>' + t.c + ' g</b><span>' + esc(T.target.c) + '</span></div>' +
      '<div class="eat-mac"><b>' + t.f + ' g</b><span>' + esc(T.target.f) + '</span></div></div>';
  }

  // the day builder and the intake rings read nutriTarget(); refresh each one directly and on its
  // own, so a failure in one never leaves the other stale
  function refreshDependents() {
    if (typeof window.bldRefresh === 'function') {
      try { window.bldRefresh(); } catch (e) { var r = $('r-verdict'); if (r) r.innerHTML = '<p class="nutri-failed">' + esc(T.failed) + '</p>'; }
    }
    if (typeof window.intakeRefresh === 'function') {
      try { window.intakeRefresh(); } catch (e) { var h = $('intake'); if (h) h.innerHTML = '<p class="nutri-failed">' + esc(T.failed) + '</p>'; }
    }
  }
  function renderFuel(picker) {
    var block = $('nutri-fuel-block'), bike = isBike(dayType());
    if (block) block.hidden = !bike;
    if (!bike) return;
    if (picker) guard($('nutri-ride-wrap'), renderRidePicker);
    guard($('nutri-fuel-body'), renderFuelBody);
  }
  function refresh(picker) {
    try { renderControls(); } catch (e) { /* controls keep their server-rendered state */ }
    var x = null;
    try { x = current(); } catch (e) { x = null; }
    var withPlan = function (fn) { return function (host) { if (!x) throw new Error('no plan'); fn(host, x); }; };
    guard($('nutri-target'), function (host) { renderTarget(host, x); }); // the target shows even without a plan
    guard($('nutri-plan'), withPlan(renderPlan));
    renderFuel(picker !== false);
    guard($('eat-body'), renderEat);
    refreshDependents();
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
    state.raised = null;
    save(KEY_DAY, state.override ? JSON.stringify({ date: todayIso(), type: state.override, auto: state.auto.type }) : null);
    refresh();
  });
  on('nutri-auto', 'click', function () {
    state.override = null;
    state.raised = null;
    save(KEY_DAY, null);
    refresh();
  });
  on('nutri-ride-wrap', 'change', function (e) {
    var v = e && e.target ? Number(e.target.value) : NaN;
    var d = dayType();
    if (!(v > 0) || !isBike(d)) return;
    state.ride = { type: d, min: v };
    save(KEY_RIDE, JSON.stringify({ date: todayIso(), type: d, min: v }));
    refresh(false); // keep the select (and its focus) in place
  });

  /** Today's MEALS target for the day builder and the intake rings: on bike days the day target minus
   * the ride fuel (all carbs), with the fuel handed over separately; `day` = the base day (train /
   * rest) whose option lists the day builder offers; fatMax = the fat target + the plan tolerance. */
  window.nutriTarget = function () {
    var x = current(), d = dayType();
    var head = x.fuelK > 0 ? T.target.mealsHeading : T.target.heading;
    return {
      k: x.mt.k, p: x.mt.p, c: x.mt.c, g: x.mt.f, fatMax: x.mt.f + N.macroTol, fuelK: x.fuelK,
      day: x.base, dayType: d, label: head + ' · ' + T.dayTypes[d] + ' · ' + T.goals[state.goal],
    };
  };
  window.HCNutri = {
    detectDayType: detectDayType,
    fuelPlan: fuelPlan,
    solveScale: solveScale,
    planFor: planFor,
    state: function () { return { goal: state.goal, dayType: dayType(), override: state.override, auto: state.auto, rideMin: rideMinutes(), raised: state.raised }; },
  };

  try { init(); } catch (e) { state.auto = { type: 'rest', why: 'none', rideMin: null }; }
  refresh();
})();
