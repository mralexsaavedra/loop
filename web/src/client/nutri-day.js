/* Nutrición day blocks — Resumen de hoy (day type + today's target), Plan de hoy (a PORTION GUIDE for
 * today's target) and Avituallamiento (bike day types only) — plus Inicio's "today you eat" card.
 * Classic script (is:inline). Reads NUTRI (lib/nutrition/today.mjs: the 12 goal × day type targets, one
 * scaling model per base day, the guide's defaults, fuelling rates, detection thresholds, latest
 * weigh-in) + I18N_NUTRI, baked by web/src/tabs/Dia.astro, FOOD_BASICS (the public food DB, the guide's
 * example foods; baked once for the food log too) and SCORES.timeline / TRAINING (Bake.astro) for
 * today's workouts and programmed session. Everything time-based is decided HERE on the viewer's clock,
 * so builds stay byte-identical.
 *
 * - Day type: detectDayType ports lib/nutrition/daytype.mjs over the baked NUTRI.detect (a test runs
 *   both over the same cases). A manual override is kept in localStorage WITH its date (so it expires
 *   the next day) and the type detected when it was picked: an override LESS demanding than a type
 *   detected later that day (picked gym, then a long ride synced) is dropped with a one-line note; a
 *   more demanding one (planning a ride) stays. Storage is a per-viewer convenience: every access is
 *   wrapped and the page works without it.
 * - Goal: set in the profile sheet (client/profile.js, "Objetivo") through window.HCNutri.setGoal, kept
 *   in localStorage (hc.nutri.goal, falling back to page.goal); on the LAN page also on the server
 *   (client/settings.js: the server copy wins on load via HCNutri.applyGoal, the local one is the cache). Resumen de hoy shows it only as a small
 *   chip next to today's kcal; a tap opens the profile sheet (#profile) focused on that setting.
 * - Plan: planFor / solveScale port lib/nutrition/scale.mjs over the baked models (parity test): the
 *   meals aim at target − ride fuel for the ride's minutes (a recorded ride's real minutes, else the
 *   picker, kept per date like the override, else the default). fuelPlan ports lib/nutrition/fuel.mjs.
 * - Plan de hoy = the portion guide (guideBudgets / exampleAmount / remaining / dayRemaining / capByDay / mealState / isCovered /
 *   roleOptions port lib/nutrition/guide.mjs, parity tests): ALWAYS breakfast, lunch, dinner + Extras.
 *   Each main meal's budget = the solved plan meals of its slot (a cooking-oil meal split between lunch
 *   and dinner, NUTRI.guide.oil); Extras = the meals target − the three.
 *   A main meal is a plate by parts (protein / carbs / vegetables free / fat), each macro with ONE
 *   example food (a select of the basics of its categories + the owner's products, view time only) and
 *   the amount of it that supplies the macro; the picked examples persist per viewer (hc.nutri.guide =
 *   {picks: {<slot>.<role>: 'b:<key>' | 'p:<id>'}}, a preference, not daily). With the food log (LAN
 *   page: window.HCFood.groupTotals) each meal shows what is LEFT, capped by what the DAY still allows
 *   ("Left today"; covered by the day at <= 10 % left), a "+" logs the example amount
 *   (window.HCFood.addGuide) and "Left today" closes the guide; without it, budgets only.
 * - Today's target is the ONE source for the rest of Nutrición: window.nutriTarget() hands the intake
 *   rings (client/intake.js) the MEALS target (on bike days the day target minus the ride fuel, with
 *   the fuel as its own figure), and every goal / day type / duration change refreshes them directly.
 *   HCNutri.targetFor(date) = the same for an earlier logged day: THAT day's detected type (timeline,
 *   else DETAIL.sessions, + programme; its recorded ride minutes) x the current goal, null when the
 *   type cannot be determined (no session, no sleep reading, nothing programmed).
 * - Model lines are read through LINE + the accessors (mirrors of lib/nutrition/amounts.mjs), never a bare index.
 * - Logged intake: the dial + bars fill from today's page food log (window.foodTotals, client/food-*.js,
 *   LAN page only) when it has entries, else from the Apple Health day (INTAKE); HCNutri.refresh() is
 *   the food log's hook after every add / delete, and re-renders the guide too.
 * Each block renders in its own try/catch: a failure shows a one-line message there, never a blank tab. */
(function () {
  var N = typeof NUTRI === 'undefined' || !NUTRI ? null : NUTRI;
  var T = typeof I18N_NUTRI === 'undefined' || !I18N_NUTRI ? null : I18N_NUTRI;
  if (!N || !T) return;
  var esc = HC.esc, format = HC.format, todayIso = HC.todayIso;
  var KEY_GOAL = 'hc.nutri.goal', KEY_DAY = 'hc.nutri.dayType', KEY_RIDE = 'hc.nutri.rideMin', KEY_GUIDE = 'hc.nutri.guide', KEY_PLAN_OPEN = 'hc.nutri.planOpen';
  // the removed choosable blocks kept their picks here; nothing reads it any more (cleared on load)
  var KEY_OLD_PICKS = 'hc.nutri.picks';
  // a goal picked here and not yet confirmed by the settings server (client/settings.js retries it)
  var KEY_GOAL_PENDING = 'hc.nutri.goalPending';
  var RANK = { rest: 0, gym: 1, bike: 2, bikeLong: 3 };
  // icons (inline SVG line icons, no emoji): the supplement pill of Plan de hoy
  var PILL_SVG = '<svg class="supp-ico" viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(-45 12 12)"><rect x="3" y="8.5" width="18" height="7" rx="3.5"/><path d="M12 8.5v7"/></g></svg>';
  var state = { goal: N.goal, override: null, auto: null, ride: null, raised: null, guide: {} };

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
  // a date's detection input (port of lib/nutrition/daytype.mjs dayInputFor): the timeline (SCORES,
  // the last 3 data days) wins its dates; any other date takes its workouts from DETAIL.sessions (one
  // per date + modality, minutes) + its programmed session (TRAINING); `known` = a timeline row, a
  // session, a sleep reading (the Watch was worn) or a programmed session, so its day type rests on
  // data — a date with none of them cannot be told from a day without the Watch
  function hasValue(m, date) {
    if (!m || !HC.isoDate(m.start) || !Array.isArray(m.v)) return false;
    var i = Math.round((HC.parseIso(date) - HC.parseIso(m.start)) / HC.MS_PER_DAY);
    var v = i >= 0 && i < m.v.length ? m.v[i] : null;
    return typeof v === 'number' && isFinite(v);
  }
  function dayInputFor(date, data) {
    var o = data || {};
    var programmed = (o.training && o.training[date]) || null;
    var row = null;
    (Array.isArray(o.timeline) ? o.timeline : []).forEach(function (d) { if (!row && d && d.date === date) row = d; });
    if (row) {
      var rowItems = Array.isArray(row.items) ? row.items : [];
      return { items: rowItems, programmed: programmed, known: true, inferred: rowItems.length === 0 && !programmed };
    }
    var items = (Array.isArray(o.sessions) ? o.sessions : []).filter(function (x) { return x && x.d === date; })
      .map(function (x) { return { modality: x.m, dur: x.min }; });
    var known = items.length > 0 || hasValue(o.sleep, date) || !!programmed;
    return { items: items, programmed: programmed, known: known, inferred: known && items.length === 0 && !programmed };
  }
  function dayInput(date) {
    var S = typeof SCORES === 'undefined' ? null : SCORES;
    var D = typeof DETAIL === 'undefined' || !DETAIL ? null : DETAIL;
    return dayInputFor(date, {
      timeline: S && S.timeline && S.timeline.days ? S.timeline.days : [],
      sessions: D && Array.isArray(D.sessions) ? D.sessions : [],
      sleep: D && D.metrics ? D.metrics.sleep : null,
      training: typeof TRAINING === 'undefined' || !TRAINING ? {} : TRAINING,
    });
  }

  /* ---------- fuelling (port of lib/nutrition/fuel.mjs) ---------- */
  var OWN_START_MIN = 30, OWN_MIN_EVERY = 10;
  function fuelStep(v, s) { return Math.round(v / s) * s; }
  function pickFuelItem(items, kind) {
    var i = -1, j;
    for (j = 0; j < items.length && i < 0; j++) if (items[j].k === kind) i = j;
    for (j = 0; j < items.length && i < 0; j++) if (items[j].k == null) i = j;
    return i < 0 ? 0 : i;
  }
  function ownDuring(items, min, gPerH, topG, planG, roundG) {
    var eat = min - OWN_START_MIN;
    if (eat <= 0) return null;
    var targetG = fuelStep(((gPerH[0] + gPerH[1]) / 2) * eat / 60, roundG);
    var slow = pickFuelItem(items, 'slow'), fast = pickFuelItem(items, 'fast');
    var maxN = Math.max(1, Math.floor(eat / OWN_MIN_EVERY));
    var best = null;
    for (var n = 1; n <= maxN; n++) {
      var seq = [], total = 0;
      for (var j = 0; j < n; j++) {
        var i = 2 * j * eat < (min - 2 * OWN_START_MIN) * n ? slow : fast;
        seq.push(i);
        total += items[i].c;
      }
      total = Math.round(total * 10) / 10;
      if (total > topG) continue;
      if (!best || Math.abs(total - targetG) < Math.abs(best.total - targetG)) best = { n: n, seq: seq, total: total };
    }
    if (!best) return null;
    var every = eat / best.n, slots = [];
    best.seq.forEach(function (i, j) {
      var last = slots[slots.length - 1];
      if (last && last.i === i) last.count++;
      else slots.push({ i: i, count: 1, fromMin: Math.round(OWN_START_MIN + j * every), everyMin: Math.round(every) });
    });
    return { startMin: OWN_START_MIN, targetG: targetG, slots: slots, totalG: best.total, gapG: Math.max(0, fuelStep(planG - best.total, roundG)) };
  }
  function ownBefore(items, r) {
    var i = pickFuelItem(items, 'fast'), c = items[i].c, mid = (r[0] + r[1]) / 2, best = null;
    for (var k = 1; k * c <= r[1]; k++) {
      var g = Math.round(k * c * 10) / 10;
      if (g < r[0]) continue;
      if (!best || Math.abs(g - mid) < Math.abs(best.g - mid)) best = { i: i, count: k, g: g };
    }
    return best;
  }
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
    var out = {
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
    var items = o.items;
    if (items && items.length) {
      out.during.own = ownDuring(items, min, gPerH, out.during.carbsG[1], planG, F.roundG);
      out.before.own = ownBefore(items, F.before.lastHourG);
    }
    return out;
  }

  /* ---------- portion scaling (port of lib/nutrition/amounts.mjs, units.mjs fmtPieces, scale.mjs
   * solveScale / planFor) ---------- */
  function round2(v) { return Math.round(v * 100) / 100; }
  function stepAmount(amt, unit, st) {
    var ud = N.scale.ud; // lib/nutrition/units.mjs UD_AMT (one unit)
    if (unit === 'ud') return Math.max(ud, Math.round(amt / ud) * ud);
    if (st > 0) return Math.max(st, Math.round(amt / st) * st);
    return Math.max(N.scale.step, Math.round(amt / N.scale.step) * N.scale.step);
  }
  // the model line [unit, amt, k, p, c, g, step?, key?, cap?]: mirrors lib/nutrition/amounts.mjs LINE and
  // its accessors (a test pins LINE equal); never read by a bare index
  var LINE = { UNIT: 0, AMT: 1, K: 2, P: 3, C: 4, G: 5, STEP: 6, KEY: 7, CAP: 8 };
  function lineUnit(l) { return l[LINE.UNIT]; }
  function lineAmt(l) { return l[LINE.AMT]; }
  function lineStep(l) { return l[LINE.STEP]; }
  function lineKey(l) { return l[LINE.KEY]; }
  function lineCap(l) { return l[LINE.CAP] > 0 ? l[LINE.CAP] : null; }
  function capFactor(l) { return lineCap(l) ? lineCap(l) / lineAmt(l) : Infinity; }
  var GRID_EPS = 1e-9; // lib/nutrition/amounts.mjs GRID_EPS (a test pins it equal)
  function floorToStep(cap, st) { return Math.max(st, Math.floor(cap / st + GRID_EPS) * st); }
  function capAmount(amt, l) {
    var cap = lineCap(l);
    if (!cap || amt <= cap) return amt;
    var st = lineUnit(l) === 'ud' ? N.scale.ud : lineStep(l) > 0 ? lineStep(l) : N.scale.step;
    return floorToStep(cap, st);
  }
  function pieceOf(pieces, l) { return lineKey(l) && pieces ? pieces[lineKey(l)] || null : null; }
  function isDiscrete(l) { return lineUnit(l) === 'ud' || lineStep(l) > 0; }
  function fmtFactor(f, dec) { return f.toFixed(2).replace('.', dec); }
  function fmtHalf(h) {
    var whole = Math.floor(h), half = h - whole >= 0.5;
    return (whole ? String(whole) : '') + (half ? '½' : '') || '0';
  }
  function fmtPieces(amt, unit, pc) {
    var n = amt / pc.a;
    var grid = N.scale.grid; // lib/nutrition/units.mjs PIECE_GRID (half pieces)
    var h = Math.max(grid, Math.round(n / grid) * grid);
    var exact = Math.abs(n - h) < 1e-9;
    var name = h > 1 ? pc.m : pc.o;
    var ref;
    if (unit === 'ud') ref = pc.r ? '~' + Math.round(n * pc.r) + ' g' : null;
    else ref = (exact ? '~' : '') + round2(amt) + ' ' + unit;
    return (exact ? '' : '~') + fmtHalf(h) + ' ' + name + (ref ? ' (' + ref + ')' : '');
  }
  function fmtAmt(amt, unit, units, pc) {
    if (pc) return fmtPieces(amt, unit, pc);
    return unit === 'ud' ? round2(amt / N.scale.ud) + ' ' + units.ud : round2(amt) + ' ' + (units[unit] || unit);
  }
  // water-filling (port of lib/nutrition/fill.mjs waterFill, the carb solve): one common
  // factor bounded by clamp ([min, max]; none = floored at 0), an item past its cap held there and the
  // factor re-solved over the rest until stable; start = the factor when nothing is free to fill
  function bound(f, clamp) {
    if (!clamp) return [Math.max(0, f), null];
    if (f < clamp[0]) return [clamp[0], 'min'];
    if (f > clamp[1]) return [clamp[1], 'max'];
    return [f, null];
  }
  function waterFill(items, need, opts) {
    var clamp = opts && opts.clamp ? opts.clamp : null;
    var held = items.map(function () { return false; });
    var heldK = 0, f = opts && opts.start != null ? opts.start : 0, hit = null;
    for (;;) {
      var freeK = 0;
      items.forEach(function (it, i) { if (!held[i]) freeK += it.k; });
      if (!(freeK > 0)) break;
      var b = bound((need - heldK) / freeK, clamp);
      f = b[0];
      hit = b[1];
      var more = false;
      items.forEach(function (it, i) {
        if (!held[i] && it.cap < f) { held[i] = true; heldK += it.k * it.cap; more = true; }
      });
      if (!more) break;
    }
    if (items.length && held.every(Boolean)) {
      f = Math.max.apply(null, items.map(function (it) { return it.cap; }));
      hit = null;
    }
    return { f: round2(f), clamp: hit, held: held };
  }
  // the carb solve's bounds (lib/nutrition/scale.mjs SCALE_FILL)
  function scaleFill() { return { clamp: [N.scale.min, N.scale.max], start: 1 }; }
  function solveScale(model, target, fmt) {
    var units = fmt.units, dec = fmt.dec, pieces = fmt.pieces || null;
    var fixedK = 0, udK = 0, contK = 0;
    var all = [];
    model.fixed.forEach(function (f) { fixedK += f[0]; });
    model.flex.forEach(function (x) {
      if (x.mb) { contK += x.mb[0]; all.push({ k: x.mb[0], cap: Infinity, ud: false }); return; }
      x.ln.forEach(function (l) {
        var ud = isDiscrete(l);
        if (ud) udK += l[LINE.K]; else contK += l[LINE.K];
        all.push({ k: l[LINE.K], cap: capFactor(l), ud: ud });
      });
    });
    var w0 = waterFill(all, target - fixedK, scaleFill());
    var f0 = w0.f, clamp = w0.clamp, held = w0.held;
    var amountAt = function (l, s) { return s === 1 ? lineAmt(l) : capAmount(stepAmount(lineAmt(l) * s, lineUnit(l), lineStep(l)), l); };
    var factor = f0;
    if (udK > 0 && contK > 0) {
      var udNowK = 0;
      model.flex.forEach(function (x) {
        if (x.ln) x.ln.forEach(function (l) { if (isDiscrete(l)) udNowK += l[LINE.K] * (amountAt(l, Math.min(f0, capFactor(l))) / lineAmt(l)); });
      });
      var w1 = waterFill(all.filter(function (it) { return !it.ud; }), target - fixedK - udNowK, scaleFill());
      factor = w1.f;
      clamp = w1.clamp;
      var ci = 0;
      held = all.map(function (it, i) { return it.ud ? w0.held[i] : w1.held[ci++]; });
    }
    var meals = model.fixed.map(function (f) { return f.slice(); });
    var q = [], qa = [], dir = [];
    var capped = false, allCapped = all.length > 0, ii = 0;
    model.flex.forEach(function (x) {
      var m = meals[x.m], i;
      if (x.mb) {
        ii++;
        allCapped = false; // a manual block has no cap: it could still grow
        var bm = x.mb.map(function (v) { return v * factor; });
        for (i = 0; i < 4; i++) m[i] += bm[i];
        var t = factor === 1 ? x.q : (x.q + ' ×' + fmtFactor(factor, dec)).trim();
        q.push(t);
        qa.push([t]);
        dir.push(Math.sign(factor - 1));
        return;
      }
      var baseK = 0, nowK = 0;
      var amts = x.ln.map(function (l) {
        var cf = capFactor(l);
        var f = isDiscrete(l) ? f0 : factor;
        if (held[ii++] || f >= cf) capped = true;
        else allCapped = false;
        var amt = amountAt(l, Math.min(f, cf));
        var r = amt / lineAmt(l);
        for (var j = 0; j < 4; j++) m[j] += l[LINE.K + j] * r;
        baseK += l[LINE.K];
        nowK += l[LINE.K] * r;
        return fmtAmt(amt, lineUnit(l), units, pieceOf(pieces, l));
      });
      q.push(amts.join(' + '));
      qa.push(amts);
      dir.push(Math.abs(nowK - baseK) < 0.5 ? 0 : Math.sign(nowK - baseK));
    });
    var totals = { k: 0, p: 0, c: 0, g: 0 };
    meals.forEach(function (m) { totals.k += m[0]; totals.p += m[1]; totals.c += m[2]; totals.g += m[3]; });
    return { factor: factor, clamp: clamp, udOnly: udK > 0 && contK === 0, capped: capped, allCapped: allCapped, meals: meals, q: q, qa: qa, dir: dir, totals: totals, rem: Math.round(target) - Math.round(totals.k) };
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
      tot: tot,
      factor: s.factor,
      clamp: s.clamp,
      udOnly: s.udOnly,
      capped: s.capped,
      allCapped: s.allCapped,
      rem: x.t.kcal - fuelK - tot.k,
    };
  }

  /* ---------- the portion guide (port of lib/nutrition/guide.mjs) ---------- */
  var G = N.guide || null;
  var MACS = ['k', 'p', 'c', 'f'];
  var ROLE_KEYS = ['p', 'c', 'f'];
  function zero4() { return { k: 0, p: 0, c: 0, f: 0 }; }
  function finite(v) { return typeof v === 'number' && isFinite(v); }
  var OIL_SLOTS = ['lunch', 'dinner']; // lib/nutrition/guide.mjs OIL_SLOTS
  function guideBudgets(x, slots, mains, oil) {
    var meals = {};
    mains.forEach(function (s) { meals[s] = zero4(); });
    var oilTo = OIL_SLOTS.filter(function (s) { return meals[s] && slots.indexOf(s) >= 0; });
    x.meals.forEach(function (row, i) {
      if (oil && oil.indexOf(i) >= 0 && oilTo.length) { // a cooking-oil meal: half to lunch, the rest to dinner
        MACS.forEach(function (m, j) {
          var first = oilTo.length > 1 ? Math.round(row[j] / 2) : row[j];
          meals[oilTo[0]][m] += first;
          if (oilTo.length > 1) meals[oilTo[1]][m] += row[j] - first;
        });
        return;
      }
      var b = meals[slots[i]];
      if (!b) return;
      MACS.forEach(function (m, j) { b[m] += row[j]; });
    });
    var total = { k: Math.round(x.mt.k), p: Math.round(x.mt.p), c: Math.round(x.mt.c), f: Math.round(x.mt.f) };
    var extras = zero4(), clamped = false;
    MACS.forEach(function (m) {
      var left = total[m];
      mains.forEach(function (s) { left -= meals[s][m]; });
      if (left < 0) clamped = true;
      extras[m] = Math.max(0, left);
    });
    return { meals: meals, extras: extras, total: total, clamped: clamped };
  }
  function exampleAmount(food, role, grams, grid) {
    var r = G && G.roles[role];
    if (!food || !r || !food.m || !finite(grams) || !(grams > 0)) return null;
    var per = food.m[r.at];
    if (!finite(per) || !(per > 0)) return null;
    var raw = (grams * 100) / per;
    var st = food.u === 'ud' ? grid.ud : food.pc && food.pc.a > 0 ? food.pc.a * grid.grid : grid.step;
    var amt = Math.max(st, Math.round(raw / st) * st);
    var cap = finite(food.x) && food.x > 0 ? food.x : null;
    if (cap && amt > cap) return { amt: floorToStep(cap, st), capped: true };
    return { amt: amt, capped: false };
  }
  function remaining(budget, logged) {
    var out = {};
    MACS.forEach(function (m) {
      var l = logged && finite(logged[m]) ? logged[m] : 0;
      out[m] = Math.max(0, Math.round(budget[m] - l));
    });
    return out;
  }
  function mealState(budget, logged) {
    var k = logged && finite(logged.k) ? logged.k : 0;
    if (!(k > 0)) return null;
    return k >= G.done * budget.k ? 'done' : 'partial';
  }
  function isCovered(left, budget) {
    return !(budget > 0) || left <= G.covered * budget;
  }
  function dayRemaining(total, groups, mains) { // lib/nutrition/guide.mjs dayRemaining ("Left today")
    if (!groups) return null;
    var all = zero4();
    mains.forEach(function (sl) { addMac(all, groups.meals && groups.meals[sl]); });
    addMac(all, groups.addon);
    return remaining(total, all);
  }
  function capByDay(mealLeft, dayLeft, dayTotal) { // lib/nutrition/guide.mjs capByDay
    if (!finite(dayLeft)) return { left: mealLeft, byDay: false };
    return { left: Math.min(mealLeft, dayLeft), byDay: isCovered(dayLeft, dayTotal) };
  }
  function fold(s) { // lib/nutrition/names.mjs foldName
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function roleOptions(basics, products, role) {
    var r = G.roles[role];
    var b = (basics || []).filter(function (x) {
      return x && r.cats.indexOf(x.c) >= 0 && Array.isArray(x.m) && finite(x.m[r.at]) && x.m[r.at] > 0;
    }).map(function (x) { return { id: 'b:' + x.k, n: x.n, food: x }; });
    var p = [];
    (products || []).forEach(function (x) {
      var v = x && x.per100;
      if (!v || (x.unit !== 'g' && x.unit !== 'ml') || !finite(v.kcal)) return;
      var m = [v.kcal, v.protein, v.carbs, v.fat].map(function (n) { return finite(n) ? n : null; });
      if (!(m[r.at] > 0)) return;
      p.push({ id: 'p:' + x.id, n: String(x.name || ''), food: { u: x.unit, m: m } });
    });
    var sort = function (list) { return list.sort(function (x, y) { return cmp(fold(x.n), fold(y.n)) || cmp(x.id, y.id); }); };
    return { basics: sort(b), products: sort(p) };
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
    return fuelPlan({ dayType: dayType(), minutes: rideMinutes(), weightKg: w ? w.kg : null, items: N.fuel.items || null });
  }
  function init() {
    save(KEY_OLD_PICKS, null); // a no-op once gone; save() wraps every storage access
    var today = todayIso();
    state.auto = detectDayType(dayInput(today));
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
    // the guide's example picks ({<slot>.<role>: 'b:<key>' | 'p:<id>'}): a preference, not daily; one
    // no longer listed is ignored when rendering (the default example shows)
    try {
      var gp = JSON.parse(load(KEY_GUIDE) || 'null');
      var picks = gp && typeof gp === 'object' && gp.picks && typeof gp.picks === 'object' ? gp.picks : {};
      Object.keys(picks).forEach(function (k) { if (typeof picks[k] === 'string') state.guide[k] = picks[k]; });
    } catch (e) { /* a broken value is ignored */ }
  }
  function saveGuide() {
    save(KEY_GUIDE, Object.keys(state.guide).length ? JSON.stringify({ picks: state.guide }) : null);
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
    setChecked('nutri-day', dayType());
    // the DETECTED type's segment carries a subtle mark (a dot), whichever type is picked
    (document.querySelectorAll('[name="nutri-day"]') || []).forEach(function (inp) {
      var lab = inp.parentElement;
      if (lab && lab.classList) lab.classList.toggle('seg-auto', inp.getAttribute('value') === state.auto.type);
    });
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
  var OVER_RATIO = 1.1; // past 110 % of the target a bar is flagged (--mid), like the intake rings
  // intake logged TODAY: first the page's own food log (window.foodTotals, client/food-*.js: today's
  // entries on the LAN page, src 'log'), else the Apple Health day (INTAKE, baked by
  // components/Bake.astro); the date is checked on the viewer's clock. Only then do the dial and the
  // bars fill. Never from the target.
  // On the LAN page the food API boot decides, exactly as for the rings (client/intake.js): while it
  // is in flight and INTAKE.bootGraceMs has not elapsed (window.intakeWaiting) nothing; once it
  // answered (HCFood.ready) the food log only, never the Apple Health day; a failure or the grace's end
  // -> the Apple Health day (a late answer still switches: food-log.js refreshes us).
  function intakeToday() {
    var W = window.intakeWaiting, H = window.HCFood, lan = false, F = null;
    try { if (typeof W === 'function' && W()) return null; } catch (e) { /* no wait known: go on */ }
    try { lan = !!(H && typeof H.ready === 'function' && H.ready()); } catch (e) { lan = false; }
    if (typeof window.foodTotals === 'function') {
      try { F = window.foodTotals(); } catch (e) { F = null; }
    }
    if (F) return F; // foodTotals already means "today, >= 1 entry" (see its contract in food-*.js)
    if (lan) return null;
    var I = typeof INTAKE === 'undefined' || !INTAKE ? null : INTAKE;
    var L = I && I.latest;
    return L && L.date === todayIso() && L.k > 0 ? L : null;
  }
  function pctOf(v, t) { return Math.round(Math.min(1, Math.max(0, v / t)) * 100); }
  // 270 degree kcal dial: the track is the baked arc (NUTRI_ARC, view/dial.mjs OPEN_ARC); the fill reuses it with pathLength 100, so any fraction needs no geometry here
  function dialHtml(t, L) {
    var arc = typeof NUTRI_ARC === 'string' ? NUTRI_ARC : '';
    var k = kf(t.kcal);
    var aria = L ? format(T.target.loggedAria, { v: kf(L.k), k: k }) : format(T.target.dialAria, { k: k });
    var pct = L ? pctOf(L.k, t.kcal) : 0;
    var over = L && L.k / t.kcal > OVER_RATIO;
    var svg = arc
      ? '<svg class="nt-dial-svg" viewBox="0 0 120 120" aria-hidden="true"><path class="nt-dial-track" d="' + esc(arc) + '"/>' +
        (pct > 0 ? '<path class="nt-dial-fill" pathLength="100" stroke-dasharray="' + pct + ' 100" d="' + esc(arc) + '"/>' : '') + '</svg>'
      : '';
    return '<figure class="nt-dial' + (over ? ' nt-dial-over' : '') + '" role="img" aria-label="' + esc(aria) + '">' + svg +
      '<div class="nt-dial-c" aria-hidden="true"><b class="nt-kcal">' + esc(k) + '</b><span class="nt-unit">' + esc(T.target.kcal) + '</span>' +
      (L ? '<span class="nt-logged"><b>' + esc(kf(L.k)) + '</b> ' + esc(T.target.logged) + '</span>' : '') + '</div></figure>';
  }
  // one macro bar: grams in --num; with intake today "logged / target" and a fill, else the target only
  // min = some of today's food-log entries lack this macro: the logged sum is a minimum ("≥")
  function barHtml(label, target, L, logged, min) {
    var has = L && logged != null && target > 0;
    var over = has && logged / target > OVER_RATIO;
    var val = L ? '<b>' + (logged != null ? (min ? '≥ ' : '') + esc(kf(logged)) : '—') + '</b> / ' + esc(kf(target)) + ' g' : '<b>' + esc(kf(target)) + '</b> g';
    var pct = has ? pctOf(logged, target) : 0;
    return '<div class="nt-bar' + (over ? ' nt-bar-over' : '') + '"><div class="nt-bar-top"><span class="nt-bar-lbl">' + esc(label) + '</span>' +
      '<span class="nt-bar-val">' + val + '</span></div><div class="nt-bar-track">' +
      (pct > 0 ? '<span class="nt-bar-fill" style="width:' + pct + '%"></span>' : '') + '</div></div>';
  }
  function minOf(L, macro) {
    return !!(L && L.missing && L.missing[macro]);
  }
  function target() { return N.plans[state.goal][dayType()].t; }
  // the goal as a low-emphasis chip next to today's kcal; it opens the profile sheet's goal setting
  function goalChipHtml() {
    var g = T.goals[state.goal];
    return '<button type="button" class="nt-goal" id="nutri-goal-chip" aria-haspopup="dialog" aria-label="' + esc(format(T.goalChip, { goal: g })) + '">' + esc(g) + '</button>';
  }
  // the dial (.nt-top) and the bars + notes (.nt-side): stacked on phones, two columns >= 900 px (nutri.css)
  function renderTarget(host, x) {
    var t = target(), L = intakeToday();
    // bike days: the guide's meals target + the ride fuel = the day target (Avituallamiento below)
    var line = x && x.fuelK > 0 ? format(T.planLineBike, { k: kf(x.mt.k), fuel: kf(x.fuelK), total: kf(x.mt.k + x.fuelK) }) : '';
    host.innerHTML =
      '<div class="nt-top">' + dialHtml(t, L) + goalChipHtml() + '</div>' +
      '<div class="nt-side"><div class="nt-bars">' + barHtml(T.target.p, t.p, L, L && L.p, minOf(L, 'protein')) + barHtml(T.target.c, t.c, L, L && L.c, minOf(L, 'carbs')) + barHtml(T.target.f, t.f, L, L && L.g, minOf(L, 'fat')) + '</div>' +
      (L ? '<p class="nt-cnote">' + esc(L.src === 'log' ? T.target.loggedFoodNote : T.target.loggedNote) + '</p>' : '') +
      (L && L.missing && (L.missing.protein || L.missing.carbs || L.missing.fat) ? '<p class="nt-cnote">' + esc(T.target.loggedFoodMissing) + '</p>' : '') +
      '<p class="nt-cnote">' + esc(T.target.cNote) + '</p>' +
      (line ? '<p class="nt-plan">' + esc(line) + '</p>' : '') + '</div>';
  }
  function suppLine(text) {
    return '<div class="meal-supp">' + PILL_SVG + '<span>' + esc(text) + '</span></div>';
  }
  // the food log's hooks (client/food-*.js, LAN page only): null when the API is not reachable here
  function foodHook(name) {
    var F = window.HCFood;
    if (!F || typeof F[name] !== 'function') return null;
    try { return F[name](); } catch (e) { return null; }
  }
  function basicsList() { return typeof FOOD_BASICS !== 'undefined' && Array.isArray(FOOD_BASICS) ? FOOD_BASICS : []; }
  function findOpt(o, id) {
    var all = o.basics.concat(o.products);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  // the example of a role in a main meal: the viewer's pick while it is listed (a product only when the
  // food API answered), else the food the base plan uses there (NUTRI.guide.defaults), else the fallback
  function exampleFor(slot, role, o, day) {
    var picked = state.guide[slot + '.' + role];
    var hit = typeof picked === 'string' ? findOpt(o, picked) : null;
    if (hit) return hit;
    var d = G.defaults[day] && G.defaults[day][slot] ? G.defaults[day][slot][role] : null;
    return (d && findOpt(o, 'b:' + d)) || findOpt(o, 'b:' + G.fallback[role]) || o.basics[0] || null;
  }
  // an example amount as a person reads it: pieces with the grams reference, else "~120 g"
  function amountText(food, amt) {
    if (food.pc) return fmtPieces(amt, food.u, food.pc);
    return '~' + fmtAmt(amt, food.u, N.fmt.units, null);
  }
  function optionsHtml(o, cur) {
    var opt = function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === cur ? ' selected' : '') + '>' + esc(x.n) + '</option>'; };
    if (!o.products.length) return o.basics.map(opt).join('');
    return '<optgroup label="' + esc(T.guide.basics) + '">' + o.basics.map(opt).join('') + '</optgroup>' +
      '<optgroup label="' + esc(T.guide.products) + '">' + o.products.map(opt).join('') + '</optgroup>';
  }
  // one macro row of a plate: what is left of the meal's grams (all of it without a log), one example
  // food (a select) and the amount of it that supplies that; covered when <= 10 % is left
  // With the food log the row is also capped by the DAY (capByDay over dayRemaining): never more than
  // the day still allows, and covered by the day (no example, no "+") when the day has <= 10 % left.
  function roleRowHtml(slot, role, budgetG, mealLeftG, logged, o, day, canAdd, dayCap) {
    var G2 = T.guide, mealName = T.plan.meals[slot];
    var head = '<div class="gd-top"><span class="gd-l">' + esc(G2.roles[role]) + '</span>';
    if (!(budgetG > 0)) return '<li class="gd-row">' + head + '<span class="gd-g">—</span></div></li>';
    if (logged && isCovered(mealLeftG, budgetG)) return '<li class="gd-row gd-done">' + head + '<span class="gd-ok">' + esc(G2.covered) + '</span></div></li>';
    var cap = dayCap ? capByDay(mealLeftG, dayCap.left[role], dayCap.total[role]) : { left: mealLeftG, byDay: false };
    if (cap.byDay) return '<li class="gd-row gd-done gd-day">' + head + '<span class="gd-ok">' + esc(G2.coveredDay) + '</span></div></li>';
    var leftG = cap.left;
    // "of 45 g" only once something is logged in this meal (before that, what is left IS the budget)
    head += '<span class="gd-g"><b>~' + esc(kf(leftG)) + '</b> g' + (logged && logged.k > 0 ? ' <span class="gd-of">' + esc(format(G2.of, { g: kf(budgetG) })) + '</span>' : '') + '</span></div>';
    var ex = exampleFor(slot, role, o, day);
    if (!ex) return '<li class="gd-row">' + head + '</li>';
    var a = exampleAmount(ex.food, role, leftG, N.scale);
    var key = slot + '.' + role;
    var sel = '<select class="gd-pick" data-guide="' + esc(key) + '" aria-label="' + esc(format(G2.pickAria, { role: G2.roles[role], meal: mealName })) + '">' + optionsHtml(o, ex.id) + '</select>';
    var amt = a ? amountText(ex.food, a.amt) : '';
    var add = canAdd && a
      ? '<button type="button" class="gd-add" data-guide-add="' + esc(key) + '" data-food="' + esc(ex.id) + '" data-amt="' + a.amt + '" data-meal="' + esc(slot) + '" aria-label="' + esc(format(G2.addAria, { amount: amt.replace(/^~/, ''), food: ex.n, meal: mealName })) + '">+</button>'
      : '';
    return '<li class="gd-row">' + head + '<div class="gd-ex">' + sel +
      (a ? '<span class="gd-amt">' + esc(amt) + (a.capped ? ' <span class="gd-max">' + esc(G2.max) + '</span>' : '') + '</span>' : '') + add + '</div>' +
      (a && a.capped ? '<p class="gd-more">' + esc(G2.more) + '</p>' : '') + '</li>';
  }
  function pcfHtml(m) {
    var A = T.plan.macroAbbr;
    return '<div class="meal-pcf"><span><b>' + m.p + '</b> ' + A.p + '</span><span><b>' + m.c + '</b> ' + A.c + '</span><span><b>' + m.f + '</b> ' + A.f + '</span></div>';
  }
  function suppText(s, withSlot) {
    return s.name + (s.dose ? ' ' + s.dose : '') + (withSlot ? ' (' + (T.plan.meals[s.meal] || s.meal) + ')' : '');
  }
  function mealGuideHtml(slot, b, logged, opts, day, canAdd, dayCap) {
    var G2 = T.guide, st = mealState(b, logged), left = remaining(b, logged);
    var status = st === 'done' ? '<p class="gd-state gd-state-done">' + esc(format(G2.done, { k: kf(logged.k) })) + '</p>'
      : st === 'partial' ? '<p class="gd-state">' + esc(format(G2.partial, { k: kf(logged.k) })) + '</p>' : '';
    var rows = roleRowHtml(slot, 'p', b.p, left.p, logged, opts.p, day, canAdd, dayCap) +
      roleRowHtml(slot, 'c', b.c, left.c, logged, opts.c, day, canAdd, dayCap) +
      '<li class="gd-row gd-veg"><div class="gd-top"><span class="gd-l">' + esc(G2.roles.v) + '</span><span class="gd-free">' + esc(G2.free) + '</span></div></li>' +
      roleRowHtml(slot, 'f', b.f, left.f, logged, opts.f, day, canAdd, dayCap);
    var supps = (N.supplements || []).filter(function (s) { return s.meal === slot; }).map(function (s) { return suppLine(suppText(s, false)); }).join('');
    return '<div class="meal gd-meal" data-slot="' + esc(slot) + '"><div class="meal-top"><div class="meal-name">' + esc(T.plan.meals[slot]) + '</div>' +
      '<div class="meal-kcal"><b>' + esc(kf(b.k)) + '</b> kcal</div></div>' + status +
      '<ul class="gd-rows">' + rows + '</ul>' + pcfHtml(b) + supps + '</div>';
  }
  // Extras: with the food log, what is left of it capped by the day (covered by the day at <= 10 % of the
  // day's kcal left); its P / C / G line then shows that capped remainder too.
  function extrasHtml(B, logged, d, dayCap) {
    var G2 = T.guide, e = B.extras, pcf = e, budget;
    if (logged) {
      var r = remaining(e, logged);
      if (dayCap) MACS.forEach(function (m) { r[m] = capByDay(r[m], dayCap.left[m], dayCap.total[m]).left; });
      pcf = r;
      budget = dayCap && capByDay(r.k, dayCap.left.k, dayCap.total.k).byDay ? G2.coveredDay
        : format(G2.extrasLeft, { k: kf(r.k), total: kf(e.k) });
    } else budget = format(G2.extrasBudget, { k: kf(e.k) });
    var items = (G.extras || []).map(function (x) { return format(G2.extrasItem, { name: G2.extrasItems[x.id] || x.id, k: kf(x.k) }); });
    var mains = N.mainSlots || [];
    var supps = (N.supplements || []).filter(function (s) { return mains.indexOf(s.meal) < 0; }).map(function (s) { return suppLine(suppText(s, true)); }).join('');
    return '<div class="meal gd-extras"><div class="meal-top"><div class="meal-name">' + esc(G2.extras) + '</div>' +
      '<div class="meal-kcal"><b>' + esc(kf(e.k)) + '</b> kcal</div></div>' +
      '<p class="gd-budget">' + esc(budget) + '</p>' +
      '<p class="gd-hint">' + esc(G2.extrasCovers) + '</p>' +
      (items.length ? '<p class="gd-hint">' + esc(format(G2.extrasHint, { list: items.join(' · ') })) + '</p>' : '') +
      (d !== 'rest' ? '<p class="gd-hint">' + esc(G2.extrasSplit) + '</p>' : '') +
      (B.clamped ? '<p class="gd-hint">' + esc(G2.clamped) + '</p>' : '') +
      pcfHtml(pcf) + supps + '</div>';
  }
  function addMac(a, b) {
    MACS.forEach(function (m) { a[m] += b && finite(b[m]) ? b[m] : 0; });
    return a;
  }
  // Plan de hoy: the same four meal groups every day (breakfast, lunch, dinner, Extras); the day type and
  // the goal only change the amounts. With today's food log (LAN page) each group shows what is left.
  function renderGuide(host, x) {
    var base = N.base[x.base];
    if (!G || !base || !base.sl || !base.sl.length) { host.innerHTML = '<p class="nutri-empty">' + esc(T.plan.empty) + '</p>'; return; }
    var mains = N.mainSlots || [];
    var B = guideBudgets(x, base.sl, mains, G.oil ? G.oil[x.base] : null);
    var L = foodHook('groupTotals'); // {meals: {<slot>: {k, p, c, f}}, addon} | null (no food log here)
    var canAdd = !!L && !!window.HCFood && typeof window.HCFood.addGuide === 'function';
    var prods = L ? foodHook('products') : null;
    var opts = {};
    ROLE_KEYS.forEach(function (r) { opts[r] = roleOptions(basicsList(), prods, r); });
    var dayLeft = dayRemaining(B.total, L, mains); // the "Left today" line; null without the food log
    var dayCap = dayLeft ? { left: dayLeft, total: B.total } : null;
    var html = mains.map(function (slot) { return mealGuideHtml(slot, B.meals[slot], L ? L.meals[slot] || zero4() : null, opts, x.base, canAdd, dayCap); }).join('');
    html += extrasHtml(B, L ? L.addon || zero4() : null, dayType(), dayCap);
    if (L) {
      var left = dayLeft, A = T.plan.macroAbbr;
      html += '<p class="gd-left"><span class="gd-left-lbl">' + esc(T.guide.left) + '</span> <b>' + esc(kf(left.k)) + '</b> kcal · ' +
        A.p + ' <b>' + left.p + '</b> · ' + A.c + ' <b>' + left.c + '</b> · ' + A.f + ' <b>' + left.f + '</b></p>';
    }
    html += '<p class="nutri-factor">' + esc(T.guide.note) + '</p>';
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
    var nf = HC.nf;
    var keyBefore = b.carbsG ? b.carbsG[0] + '–' + b.carbsG[1] + ' g' : nf(b.gPerKg[0]) + '–' + nf(b.gPerKg[1]) + ' ' + F.perKg;
    var keyAfter = a.carbsG ? a.carbsG[0] + '–' + a.carbsG[1] + ' g' : nf(a.gPerKg[0]) + '–' + nf(a.gPerKg[1]) + ' ' + F.perKg;
    // the owner's own fuel items (NUTRI.fuel.items) replace the generic gel / bar equivalents
    var items = N.fuel.items || [], own = du.own, bo = b.own;
    var lastHour = bo
      ? format(F.lastHourOwn, { lo: b.lastHourG[0], hi: b.lastHourG[1], count: bo.count, name: items[bo.i].n, g: nf(bo.g) })
      : format(F.lastHour, { lo: b.lastHourG[0], hi: b.lastHourG[1] });
    var bLo = du.equiv.bottles[0], bHi = du.equiv.bottles[1];
    var duringUnits;
    if (own) {
      var segs = own.slots.map(function (sl) {
        return format(sl.count > 1 ? F.ownSegMany : F.ownSegOne, { count: sl.count, name: items[sl.i].n, from: sl.fromMin, every: sl.everyMin });
      }).join(F.ownThen);
      duringUnits = li(format(F.ownMix, { mix: segs, total: nf(own.totalG) })) +
        li(format(F.ownStart, { start: own.startMin })) +
        (own.gapG > 0 ? li(format(F.ownGap, { gap: own.gapG, plan: du.planG, bananaG: U.bananaG })) : '') +
        li(format(F.ownAlt, { bottles: bLo === bHi ? String(bLo) : bLo + '–' + bHi, ml: U.bottleMl, pLo: U.bottlePct[0], pHi: U.bottlePct[1], gLo: U.bottleG[0], gHi: U.bottleG[1] }));
    } else {
      duringUnits = li(format(F.duringEquiv, { gels: du.equiv.gels, gelG: U.gelG, bananas: du.equiv.bananas, bananaG: U.bananaG, bars: du.equiv.bars, barG: U.barG, bLo: bLo, bHi: bHi, ml: U.bottleMl, pLo: U.bottlePct[0], pHi: U.bottlePct[1], gLo: U.bottleG[0], gHi: U.bottleG[1] })) +
        li(format(F.duringMix, { bottles: du.mix.bottles, gels: du.mix.gels }));
    }
    // Antes -> Durante -> Después as a 3-step timeline, one key number per step
    function step(key, title, num, items) {
      return '<li class="fuel-step fuel-step-' + key + '"><div class="fuel-step-head"><h3>' + esc(title) + '</h3><b class="fuel-key">' + esc(num) + '</b></div><ul>' + items + '</ul></li>';
    }
    host.innerHTML =
      '<ol class="fuel-steps">' +
      step('before', F.before, keyBefore, li(before) + li(lastHour)) +
      step('during', F.during, rate + ' ' + F.perHour,
      li(format(F.duringCarbs, { rate: rate, total: total })) + duringUnits +
      li(format(F.fluids, { lo: kf(du.fluidsMl[0]), hi: kf(du.fluidsMl[1]), rLo: rates.fluidMlPerH[0], rHi: rates.fluidMlPerH[1] })) +
      li(format(F.sodium, { lo: kf(du.sodiumMg[0]), hi: kf(du.sodiumMg[1]), rLo: rates.sodiumMgPerH[0], rHi: rates.sodiumMgPerH[1] }))) +
      step('after', F.after, keyAfter, li(after)) +
      '</ol>' +
      (N.weight ? '<p class="fuel-note">' + esc(format(F.weightNote, { kg: HC.num(N.weight.kg, 1), date: HC.fmtDate(N.weight.date) })) + '</p>' : '') +
      '<p class="fuel-note">' + esc(F.inDay) + '</p>' +
      '<p class="fuel-note fuel-disclaimer">' + esc(F.disclaimer) + '</p>';
  }
  function renderEat(host) {
    var t = target(), d = dayType(), E = T.eat;
    host.innerHTML =
      '<div class="eat-day-type">' + esc(format(E.dayGoal, { day: T.dayTypes[d] + ' ' + (state.override ? T.chosen : T.auto), goal: T.goals[state.goal] })) + '</div>' +
      '<div class="eat-kcal">~' + esc(kf(t.kcal)) + '<span>kcal</span></div>' +
      '<div class="eat-macros">' +
      '<div class="eat-mac"><b>' + t.p + ' g</b><span>' + esc(T.target.p) + '</span></div>' +
      '<div class="eat-mac"><b>' + t.c + ' g</b><span>' + esc(T.target.c) + '</span></div>' +
      '<div class="eat-mac"><b>' + t.f + ' g</b><span>' + esc(T.target.f) + '</span></div></div>';
  }

  // the intake rings read nutriTarget(); a failure there shows a one-line message, never a stale ring
  function refreshDependents() {
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
    guard($('nutri-plan'), withPlan(renderGuide));
    var pk = $('nutri-plan-kcal');
    if (pk) pk.textContent = x ? kf(x.mt.k) + ' ' + T.target.kcal : '';
    renderFuel(picker !== false);
    guard($('eat-body'), renderEat);
    refreshDependents();
    // Progreso and Constancia read the goal (client/progress.js, client/adherence.js; absent before load)
    ['HCProgress', 'HCAdherence'].forEach(function (k) {
      var v = window[k];
      if (v && typeof v.render === 'function') { try { v.render(); } catch (e) { /* each block guards its own host */ } }
    });
  }

  /* ---------- events ---------- */
  function on(id, evt, fn) {
    var el = $(id);
    if (el && el.addEventListener) el.addEventListener(evt, fn);
  }
  // the goal is changed from the profile sheet (client/profile.js); false = not a known goal. With the
  // settings API (client/settings.js, LAN page) the server copy is the source of truth: the goal is
  // saved there too, and hc.nutri.goal stays the offline cache / fallback
  function applyGoal(v) {
    if (N.goals.indexOf(v) < 0) return false;
    state.goal = v;
    save(KEY_GOAL, v);
    refresh();
    return true;
  }
  function setGoal(v) {
    if (!applyGoal(v)) return false;
    // pending until the server confirms it: settings.js retries it on its next load / visibility and
    // prefers it over the server's goal meanwhile
    save(KEY_GOAL_PENDING, v);
    var S = window.HCSettings;
    if (S && typeof S.ready === 'function' && S.ready() && typeof S.saveGoal === 'function') {
      try {
        var p = S.saveGoal(v);
        if (p && typeof p.then === 'function') p.then(null, function () { /* stays pending; the profile says so */ });
      } catch (e) { /* the local goal already applies; settings.js reports failures */ }
    }
    return true;
  }
  function pendingGoal() {
    var g = load(KEY_GOAL_PENDING);
    return N.goals.indexOf(g) >= 0 ? g : null;
  }
  // the server stored `g`: a pending goal equal to it is done (a newer pick stays pending)
  function clearPending(g) {
    if (pendingGoal() === g) save(KEY_GOAL_PENDING, null);
  }
  // the goal this viewer stored (hc.nutri.goal), or null: settings.js pushes it once to a server that has none
  function storedGoal() {
    var g = load(KEY_GOAL);
    return N.goals.indexOf(g) >= 0 ? g : null;
  }
  on('nutri-target', 'click', function (e) {
    var t = e && e.target;
    var chip = t && t.closest ? t.closest('#nutri-goal-chip') : null;
    if (!chip || !window.HCDetail || typeof window.HCDetail.open !== 'function') return;
    window.HCDetail.open('profile', null, { focus: '#pf-goal input:checked' });
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
  // an example pick (the food a macro row shows): a per-viewer preference, not daily; focus stays on it
  function setGuidePick(key, id) {
    var parts = String(key).split('.');
    if (parts.length !== 2 || (N.mainSlots || []).indexOf(parts[0]) < 0 || ROLE_KEYS.indexOf(parts[1]) < 0) return false;
    if (!/^[bp]:/.test(id)) return false;
    state.guide[key] = id;
    saveGuide();
    refresh(false);
    return true;
  }
  function refocus(sel) {
    try {
      var el = document.querySelector ? document.querySelector(sel) : null;
      if (el && el.focus) el.focus();
    } catch (e) { /* focus is a convenience */ }
  }
  on('nutri-plan', 'change', function (e) {
    var t = e && e.target;
    var key = t && t.getAttribute ? t.getAttribute('data-guide') : null;
    if (!key || typeof t.value !== 'string') return;
    if (setGuidePick(key, t.value)) refocus('select[data-guide="' + key.replace(/["\\]/g, '') + '"]');
  });
  // "+": log the example amount (for what is left) into that meal through the food log's add flow
  on('nutri-plan', 'click', function (e) {
    var t = e && e.target;
    var btn = t && t.closest ? t.closest('[data-guide-add]') : null;
    var F = window.HCFood;
    if (!btn || btn.disabled || !F || typeof F.addGuide !== 'function') return;
    var amt = Number(btn.getAttribute('data-amt'));
    if (!(amt > 0)) return;
    btn.disabled = true;
    var p;
    try { p = F.addGuide({ group: btn.getAttribute('data-meal'), food: btn.getAttribute('data-food'), amt: amt }); } catch (err) { p = null; }
    var undo = function () { btn.disabled = false; };
    if (p && typeof p.then === 'function') p.then(null, undo);
    else undo();
  });
  // Plan de hoy is a native <details>, collapsed by default; its open state is a per-viewer convenience
  // (hc.nutri.planOpen = '1' / '0'). The guide is rendered either way.
  function initPlanFold() {
    var fold = $('nutri-plan-fold');
    if (!fold) return;
    fold.open = load(KEY_PLAN_OPEN) === '1';
    if (fold.addEventListener) fold.addEventListener('toggle', function () { save(KEY_PLAN_OPEN, fold.open ? '1' : '0'); });
  }
  on('nutri-ride-wrap', 'change', function (e) {
    var v = e && e.target ? Number(e.target.value) : NaN;
    var d = dayType();
    if (!(v > 0) || !isBike(d)) return;
    state.ride = { type: d, min: v };
    save(KEY_RIDE, JSON.stringify({ date: todayIso(), type: d, min: v }));
    refresh(false); // keep the select (and its focus) in place
  });

  /** Today's MEALS target for the intake rings: on bike days the day target minus the ride fuel (all
   * carbs), with the fuel handed over separately; `day` = the base day (train / rest); fatMax = the
   * fat target + the plan tolerance. */
  function ringTarget(x, d, past) {
    var head = x.fuelK > 0 ? (past ? T.target.pastMealsHeading : T.target.mealsHeading) : past ? T.target.pastHeading : T.target.heading;
    return {
      k: x.mt.k, p: x.mt.p, c: x.mt.c, g: x.mt.f, fatMax: x.mt.f + N.macroTol, fuelK: x.fuelK,
      day: x.base, dayType: d, label: head + ' · ' + T.dayTypes[d] + ' · ' + T.goals[state.goal],
    };
  }
  window.nutriTarget = function () { return ringTarget(current(), dayType(), false); };
  /** The MEALS target of `date` for the intake rings (same shape as nutriTarget): today = nutriTarget();
   * a past day = THAT day's detected day type (its recorded ride minutes, else the default) with the
   * current goal — today's override and picked ride minutes never apply to it. null when the day type
   * cannot be determined (no timeline row and no programmed session), for a future or a non-ISO date. */
  function targetFor(date) {
    var iso = HC.isoDate(date), today = todayIso();
    if (!iso || iso > today) return null;
    if (iso === today) return window.nutriTarget();
    var input = dayInput(iso);
    if (!input.known) return null;
    var det = detectDayType(input);
    var t = ringTarget(planFor(N, state.goal, det.type, det.rideMin), det.type, true);
    // a rest day assumed from sleep alone (no session, nothing programmed): Constancia counts it apart
    t.inferred = !!input.inferred;
    return t;
  }
  window.HCNutri = {
    setGoal: setGoal,
    // the server's goal (client/settings.js): applied and cached locally, never sent back
    applyGoal: applyGoal,
    storedGoal: storedGoal,
    pendingGoal: pendingGoal,
    clearPending: clearPending,
    dayInputFor: dayInputFor,
    // the food log (client/food-*.js) calls this after every add / delete: the dial, bars, rings and guide
    refresh: function () { refresh(false); },
    detectDayType: detectDayType,
    targetFor: targetFor,
    fuelPlan: fuelPlan,
    waterFill: waterFill,
    floorToStep: floorToStep,
    GRID_EPS: GRID_EPS,
    solveScale: solveScale,
    planFor: planFor,
    guideBudgets: guideBudgets,
    exampleAmount: exampleAmount,
    remaining: remaining,
    mealState: mealState,
    isCovered: isCovered,
    dayRemaining: dayRemaining,
    capByDay: capByDay,
    roleOptions: roleOptions,
    LINE: LINE,
    setGuidePick: function (key, id) { return typeof key === 'string' && typeof id === 'string' ? setGuidePick(key, id) : false; },
    state: function () { return { goal: state.goal, dayType: dayType(), override: state.override, auto: state.auto, rideMin: rideMinutes(), raised: state.raised, guide: JSON.parse(JSON.stringify(state.guide)) }; },
  };

  try { init(); } catch (e) { state.auto = { type: 'rest', why: 'none', rideMin: null }; }
  try { initPlanFold(); } catch (e) { /* the fold keeps its server-rendered (collapsed) state */ }
  refresh();
})();
