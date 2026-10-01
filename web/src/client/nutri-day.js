/* Nutrición day blocks — Resumen de hoy (day type + today's target), Plan de hoy (the day's
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
 *   more demanding one (planning a ride) stays. Storage is a per-viewer convenience: every access is
 *   wrapped and the page works without it.
 * - Goal: set in the profile sheet (client/profile.js, "Objetivo") through window.HCNutri.setGoal, kept
 *   in localStorage (hc.nutri.goal, falling back to page.goal). Resumen de hoy shows it only as a small
 *   chip next to today's kcal; a tap opens the profile sheet (#profile) focused on that setting.
 * - Plan: planFor / solveScale port lib/nutrition/scale.mjs over the baked models (parity test): the
 *   meals aim at target − ride fuel for the ride's minutes (a recorded ride's real minutes, else the
 *   picker, kept per date like the override, else the default), so changing the duration re-scales
 *   Plan de hoy. fuelPlan ports lib/nutrition/fuel.mjs over NUTRI.fuel.rates.
 * - Today's target is the ONE source for the rest of Nutrición: window.nutriTarget() hands the intake
 *   rings (client/intake.js) the MEALS target (on bike days the day target minus the ride fuel, with
 *   the fuel as its own figure), and every goal / day type / duration change refreshes them directly.
 * - Model lines are read through LINE + the accessors (mirrors of lib/nutrition/amounts.mjs), never a bare index.
 * - Blocks: a dayPlan part that points at an option list is a choosable block (lib/nutrition/blocks.mjs):
 *   its name is a select of that list (NUTRI.lists, grouped like the tables); a fixed food (`{ing}`
 *   part) is a select of the foods of its category (NUTRI.foods, lib/nutrition/categories.mjs) plus
 *   "none" where skipping is sensible; a pick is kept for TODAY
 *   in localStorage (hc.nutri.picks = {date, picks: {<block id>: <option key>}}, every access wrapped)
 *   and planFor re-solves the whole day with it (swapOption / swapIng / ingAmount / applyPicks port
 *   blocks.mjs: protein lists keep the default's protein grams, the rest take the option's own amounts,
 *   a food keeps its category's rule; parity test).
 * - Snack: a day still short after the solve (every plate at its cap) gets the automatic snack — waterFill /
 *   solveSnack / defaultSnack / snackFor / rideHeadroomK / withSnack port lib/nutrition/snack.mjs over
 *   NUTRI.snack (parity test): an add-on row "Snack" (or one more part of the plan's own snack-slot
 *   meal) with a select of the options, its pick kept like a block pick (id NUTRI.snack.id).
 * - Plan de hoy shows breakfast / lunch / dinner as cards (NUTRI.mainSlots = lib/nutrition/slots.mjs
 *   MAIN_SLOTS) and every other meal as a compact row of ONE add-ons card after them (display only).
 * - HCNutri.todayPlan() hands the food log's "Del plan" tab (client/food.js) today's Plan de hoy
 *   meals, read-only, exactly as rendered (same goal × day type × ride minutes × picks, same planFor).
 * - Logged intake: the dial + bars fill from today's page food log (window.foodTotals, client/food.js,
 *   LAN page only) when it has entries, else from the Apple Health day (INTAKE); HCNutri.refresh() is
 *   the food log's hook after every add / delete.
 * Each block renders in its own try/catch: a failure shows a one-line message there, never a blank tab. */
(function () {
  var N = typeof NUTRI === 'undefined' || !NUTRI ? null : NUTRI;
  var T = typeof I18N_NUTRI === 'undefined' || !I18N_NUTRI ? null : I18N_NUTRI;
  if (!N || !T) return;
  var esc = HC.esc, format = HC.format, todayIso = HC.todayIso;
  var KEY_GOAL = 'hc.nutri.goal', KEY_DAY = 'hc.nutri.dayType', KEY_RIDE = 'hc.nutri.rideMin', KEY_PICKS = 'hc.nutri.picks', KEY_PLAN_OPEN = 'hc.nutri.planOpen';
  var RANK = { rest: 0, gym: 1, bike: 2, bikeLong: 3 };
  var state = { goal: N.goal, override: null, auto: null, ride: null, raised: null, picks: {} };

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

  /* ---------- portion scaling (port of lib/nutrition/amounts.mjs, units.mjs fmtPieces, scale.mjs
   * solveScale / planFor and blocks.mjs applyPicks) ---------- */
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
  function capAmount(amt, l) {
    var cap = lineCap(l);
    if (!cap || amt <= cap) return amt;
    var st = lineUnit(l) === 'ud' ? N.scale.ud : lineStep(l) > 0 ? lineStep(l) : N.scale.step;
    return Math.max(st, Math.floor(cap / st + 1e-9) * st);
  }
  function pieceOf(pieces, l) { return lineKey(l) && pieces ? pieces[lineKey(l)] || null : null; }
  function scaleLine(l, amt) {
    var r = amt / lineAmt(l);
    return [lineUnit(l), amt, l[LINE.K] * r, l[LINE.P] * r, l[LINE.C] * r, l[LINE.G] * r].concat(l.slice(LINE.STEP));
  }
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
  // water-filling (port of lib/nutrition/fill.mjs waterFill, the carb solve's and the snack's): one common
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
    var q = [], qa = [], qn = [], dir = [], qm = [];
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
        qn.push([null]);
        dir.push(Math.sign(factor - 1));
        qm.push(bm);
        return;
      }
      var baseK = 0, nowK = 0;
      var pm = [0, 0, 0, 0], nums = [];
      var amts = x.ln.map(function (l) {
        var cf = capFactor(l);
        var f = isDiscrete(l) ? f0 : factor;
        if (held[ii++] || f >= cf) capped = true;
        else allCapped = false;
        var amt = amountAt(l, Math.min(f, cf));
        nums.push(amt);
        var r = amt / lineAmt(l);
        for (var j = 0; j < 4; j++) { m[j] += l[LINE.K + j] * r; pm[j] += l[LINE.K + j] * r; }
        baseK += l[LINE.K];
        nowK += l[LINE.K] * r;
        return fmtAmt(amt, lineUnit(l), units, pieceOf(pieces, l));
      });
      q.push(amts.join(' + '));
      qa.push(amts);
      qn.push(nums);
      dir.push(Math.abs(nowK - baseK) < 0.5 ? 0 : Math.sign(nowK - baseK));
      qm.push(pm);
    });
    var totals = { k: 0, p: 0, c: 0, g: 0 };
    meals.forEach(function (m) { totals.k += m[0]; totals.p += m[1]; totals.c += m[2]; totals.g += m[3]; });
    return { factor: factor, clamp: clamp, udOnly: udK > 0 && contK === 0, capped: capped, allCapped: allCapped, meals: meals, q: q, qa: qa, qn: qn, dir: dir, qm: qm, totals: totals, rem: Math.round(target) - Math.round(totals.k) };
  }
  function findOpt(list, key) {
    if (!list || !list.length) return null;
    for (var i = 0; i < list.length; i++) if (list[i].k === key) return list[i];
    return null;
  }
  function limitP(f) { return f < N.blocks.pMin ? N.blocks.pMin : f > N.blocks.pMax ? N.blocks.pMax : f; }
  function swapFactor(block, list, opt) {
    if (block.r !== 'protein') return 1;
    var def = findOpt(list, block.d);
    if (!def || !(def.pr > 0) || !(opt.pr > 0)) return 1;
    return round2(limitP(def.pr / opt.pr));
  }
  // the option's lines at swap factor s, every line clamped to its portion cap (port of blocks.mjs swapLines)
  function swapLines(opt, s) {
    var ln = s === 1 ? opt.ln : opt.ln.map(function (l) { return scaleLine(l, stepAmount(lineAmt(l) * s, lineUnit(l), lineStep(l))); });
    var capped = false;
    ln = ln.map(function (l) {
      var c = capAmount(lineAmt(l), l);
      if (c === lineAmt(l)) return l;
      capped = true;
      return scaleLine(l, c);
    });
    return { ln: ln, own: s === 1 && !capped };
  }
  function swapOption(b, list, key, fmt) {
    var opt = findOpt(list, key);
    var s = swapFactor(b, list, opt);
    var isFlex = b.fx === true && opt.fx === true;
    if (opt.mb) {
      var mb = opt.mb.map(function (v) { return v * s; });
      var q = s === 1 ? opt.q : (opt.q + ' ×' + s.toFixed(2).replace('.', fmt.dec || '.')).trim();
      if (isFlex) return { part: { l: opt.n, x: 1 }, flex: { mb: mb, q: q } };
      return { part: { l: opt.n, q: q, m: mb }, mac: mb };
    }
    var sl = swapLines(opt, s), ln = sl.ln, own = sl.own;
    if (isFlex) return { part: opt.c && !opt.q ? { l: opt.n, x: 1, c: opt.c } : { l: opt.n, x: 1 }, flex: { ln: ln } };
    var mac = [0, 0, 0, 0];
    ln.forEach(function (l) { for (var j = 0; j < 4; j++) mac[j] += l[LINE.K + j]; });
    var amts = ln.map(function (l) { return fmtAmt(lineAmt(l), lineUnit(l), fmt.units, pieceOf(fmt.pieces || null, l)); });
    if (opt.c && (!opt.q || !own)) return { part: { l: opt.n, q: amts.join(' + '), c: opt.c, a: amts, m: mac }, mac: mac, ln: ln };
    return { part: { l: opt.n, q: own && opt.q ? opt.q : amts.join(' + '), m: mac }, mac: mac, ln: ln };
  }
  // a FOOD block (port of lib/nutrition/blocks.mjs ingAmount / swapIng / isOption): the foods of the
  // block's category from NUTRI.foods, "none" (NONE_KEY) where the category rule allows skipping
  var NONE_KEY = 'none';
  var METRIC = { protein: LINE.P, carbs: LINE.C, fat: LINE.G, kcal: LINE.K }; // categories.mjs SWAP_BY -> line slot
  function gramsPer(e) { return e.gf || 1; }
  function ingAmount(rule, def, defAmt, opt) {
    var base = (defAmt * gramsPer(def)) / gramsPer(opt);
    var s = 1;
    var at = METRIC.hasOwnProperty(rule.by) ? METRIC[rule.by] : undefined;
    if (at !== undefined) {
      var dv = (def.l[at] * defAmt) / lineAmt(def.l);
      var ov = (opt.l[at] * base) / lineAmt(opt.l);
      if (dv > 0 && ov > 0) s = round2(limitP(dv / ov));
    }
    return capAmount(stepAmount(base * s, lineUnit(opt.l), lineStep(opt.l)), opt.l);
  }
  function swapIng(b, foods, key, fmt) {
    if (key === NONE_KEY) return { part: { l: '', z: 1, m: [0, 0, 0, 0] }, mac: [0, 0, 0, 0] };
    var opt = foods.ings[key];
    var amt = ingAmount(foods.rules[b.I], foods.ings[b.d], b.a, opt);
    var ln = scaleLine(opt.l, amt);
    if (b.fx === true && opt.fx === true) return { part: { l: opt.n, x: 1 }, flex: { ln: [ln] } };
    var mac = ln.slice(LINE.K, LINE.G + 1);
    return { part: { l: opt.n, q: fmtAmt(amt, lineUnit(ln), fmt.units, pieceOf(fmt.pieces || null, ln)), m: mac }, mac: mac, ln: [ln] };
  }
  function isOption(b, key, lists, foods) {
    if (!b.I) return !!findOpt(lists && lists[b.L], key);
    if (!foods || !foods.rules || !Object.prototype.hasOwnProperty.call(foods.rules, b.I)) return false;
    if (key === NONE_KEY) return foods.rules[b.I].skip === true;
    var ks = foods.cats[b.I];
    return !!ks && ks.indexOf(key) >= 0 && !!foods.ings[key];
  }
  function applyPicks(base, lists, picks, fmt, foods) {
    var blocks = base.blocks || {};
    var eff = {}, any = false;
    if (picks && typeof picks === 'object') {
      Object.keys(blocks).forEach(function (id) {
        var key = picks[id];
        if (typeof key !== 'string' || key === blocks[id].d || !isOption(blocks[id], key, lists, foods)) return;
        eff[id] = key;
        any = true;
      });
    }
    if (!any) return { fixed: base.fixed, flex: base.flex, meals: base.meals, picks: {} };
    var fixed = [], flex = [], fi = 0;
    var meals = base.meals.map(function (meal, m) {
      var touched = meal.parts.some(function (p) { return p.id && eff[p.id] !== undefined; });
      var f = touched ? [0, 0, 0, 0] : base.fixed[m].slice();
      var parts = meal.parts.map(function (p) {
        var key = p.id ? eff[p.id] : undefined, i, k;
        if (key === undefined) {
          if (p.x) flex.push(base.flex[fi++]);
          else if (touched) for (i = 0; i < 4; i++) f[i] += p.m[i];
          return p;
        }
        if (p.x) fi++; // the default's flex entry is replaced
        var b = blocks[p.id];
        var sw = b.I ? swapIng(b, foods, key, fmt) : swapOption(b, lists[b.L], key, fmt);
        if (sw.flex) {
          var entry = { m: m };
          for (k in sw.flex) entry[k] = sw.flex[k];
          flex.push(entry);
        } else for (i = 0; i < 4; i++) f[i] += sw.mac[i];
        sw.part.id = p.id;
        return sw.part;
      });
      fixed.push(f);
      return { n: meal.n, s: meal.s, pcf: meal.pcf, parts: parts };
    });
    return { fixed: fixed, flex: flex, meals: meals, picks: eff };
  }
  // the automatic snack (port of lib/nutrition/snack.mjs): a day still short after the solve gets a
  // snack option scaled to the shortfall (water-filling without a clamp, line caps), as an add-on meal
  function snackCapK(o) {
    var k = 0;
    o.ln.forEach(function (l) { k += l[LINE.K] * capFactor(l); });
    return k;
  }
  function defaultSnack(opts, need) {
    var best = null, bestK = -1;
    for (var i = 0; i < (opts || []).length; i++) {
      var k = snackCapK(opts[i]);
      if (k >= need) return opts[i].k;
      if (k > bestK) { best = opts[i].k; bestK = k; }
    }
    return best;
  }
  function solveSnack(o, need, fmt) {
    var all = o.ln.map(function (l) { return { k: l[LINE.K], cap: capFactor(l), ud: isDiscrete(l) }; });
    var amountAt = function (l, s) { return capAmount(stepAmount(lineAmt(l) * s, lineUnit(l), lineStep(l)), l); };
    var f0 = waterFill(all, need).f;
    var f = f0;
    if (all.some(function (it) { return it.ud; }) && all.some(function (it) { return !it.ud; })) {
      var udK = 0;
      o.ln.forEach(function (l) { if (isDiscrete(l)) udK += l[LINE.K] * (amountAt(l, Math.min(f0, capFactor(l))) / lineAmt(l)); });
      f = waterFill(all.filter(function (it) { return !it.ud; }), need - udK).f;
    }
    var mac = [0, 0, 0, 0], nums = [], capped = true;
    var amts = o.ln.map(function (l) {
      var cf = capFactor(l);
      var s = isDiscrete(l) ? f0 : f;
      if (s < cf) capped = false;
      var amt = amountAt(l, Math.min(s, cf));
      nums.push(amt);
      for (var i = 0; i < 4; i++) mac[i] += (l[LINE.K + i] * amt) / lineAmt(l);
      return fmtAmt(amt, lineUnit(l), fmt.units, pieceOf(fmt.pieces || null, l));
    });
    return { k: o.k, n: o.n, c: o.c || null, nums: nums, amts: amts, mac: mac, capped: capped };
  }
  function snackFor(sb, need, pick, fmt) {
    if (!sb || !sb.opts || !sb.opts.length) return null;
    var d = defaultSnack(sb.opts, need), o = null;
    sb.opts.forEach(function (x) { if (x.k === pick) o = x; });
    if (!o) sb.opts.forEach(function (x) { if (x.k === d) o = x; });
    var r = solveSnack(o, need, fmt);
    r.d = d;
    return r;
  }
  function rideHeadroomK(fuel) {
    if (!fuel) return 0;
    var top = fuel.during.gPerH[1] * (fuel.minutes / 60);
    return Math.max(0, Math.round((top - fuel.during.planG) * N.fuel.rates.kcalPerG));
  }
  function withSnack(view, meals, sn, sb) {
    var part = sn.c && sn.amts.length > 1
      ? { l: sn.n, id: sb.id, sn: 1, c: sn.c, a: sn.amts, m: sn.mac }
      : { l: sn.n, id: sb.id, sn: 1, q: sn.amts.join(' + '), m: sn.mac };
    var v = view.slice();
    var ms = meals.map(function (m) { return m.slice(); });
    var at = -1, i;
    for (i = 0; i < v.length && at < 0; i++) if (v[i] && v[i].s === sb.slot) at = i;
    if (at < 0) {
      v.push({ n: sb.n, s: sb.slot, pcf: true, parts: [part] });
      ms.push(sn.mac.slice());
    } else {
      var copy = {};
      for (var k in v[at]) copy[k] = v[at][k];
      copy.parts = v[at].parts.concat([part]);
      v[at] = copy;
      for (i = 0; i < 4; i++) ms[at][i] += sn.mac[i];
    }
    return { view: v, meals: ms };
  }
  function planFor(bake, goal, d, minutes, picks) {
    var x = bake.plans[goal][d];
    var fuel = isBike(d) ? fuelPlan({ dayType: d, minutes: minutes }) : null;
    var fuelK = fuel ? fuel.kcal : 0;
    var fuelC = fuel ? fuel.during.planG : 0;
    var mdl = applyPicks(bake.base[x.base], bake.lists || {}, picks, bake.fmt, bake.foods);
    var s = solveScale(mdl, x.t.kcal - fuelK, bake.fmt);
    var need = x.t.kcal - fuelK - Math.round(s.totals.k) - rideHeadroomK(fuel);
    var sb = bake.snack;
    var pick = picks && typeof picks === 'object' && sb ? picks[sb.id] : undefined;
    var sn = need > N.tolerance && mdl.meals.length ? snackFor(sb, need, pick, bake.fmt) : null;
    var view = mdl.meals, meals = s.meals;
    var totals = { k: s.totals.k, p: s.totals.p, c: s.totals.c, g: s.totals.g };
    if (sn) {
      var w = withSnack(view, meals, sn, sb);
      view = w.view;
      meals = w.meals;
      totals.k += sn.mac[0]; totals.p += sn.mac[1]; totals.c += sn.mac[2]; totals.g += sn.mac[3];
    }
    var tot = { k: Math.round(totals.k), p: Math.round(totals.p), c: Math.round(totals.c), g: Math.round(totals.g) };
    var outPicks = mdl.picks;
    if (sn && sn.k !== sn.d) {
      outPicks = {};
      for (var id in mdl.picks) outPicks[id] = mdl.picks[id];
      outPicks[sb.id] = sn.k;
    }
    return {
      base: x.base,
      t: x.t,
      minutes: fuel ? fuel.minutes : null,
      fuelK: fuelK,
      fuelC: fuelC,
      mt: { k: x.t.kcal - fuelK, p: x.t.p, c: x.t.c - fuelC, f: x.t.f },
      meals: meals.map(function (m) { return m.map(Math.round); }),
      flex: s.q,
      flexAmts: s.qa,
      flexN: s.qn,
      flexDir: s.dir,
      flexMac: s.qm,
      tot: tot,
      factor: s.factor,
      clamp: s.clamp,
      udOnly: s.udOnly,
      capped: s.capped,
      allCapped: s.allCapped,
      rem: x.t.kcal - fuelK - tot.k,
      snack: sn ? { k: sn.k, d: sn.d, n: sn.n, nums: sn.nums, mac: sn.mac, capped: sn.capped } : null,
      view: view,
      picks: outPicks,
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
  function current() { return planFor(N, state.goal, dayType(), rideMinutes(), state.picks); }
  function baseDay() { return N.plans[state.goal][dayType()].base; } // 'train' | 'rest', without solving
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
    // today's block picks ({id: option key}); a key not in today's list is ignored by applyPicks
    var pk = loadToday(KEY_PICKS, today);
    if (pk && pk.picks && typeof pk.picks === 'object') {
      Object.keys(pk.picks).forEach(function (id) { if (typeof pk.picks[id] === 'string') state.picks[id] = pk.picks[id]; });
    }
  }
  function savePicks() {
    var any = Object.keys(state.picks).length > 0;
    save(KEY_PICKS, any ? JSON.stringify({ date: todayIso(), picks: state.picks }) : null);
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
  // intake logged TODAY: first the page's own food log (window.foodTotals, client/food.js: today's
  // entries on the LAN page, src 'log'), else the Apple Health day (INTAKE, baked by
  // components/Bake.astro); the date is checked on the viewer's clock. Only then do the dial and the
  // bars fill. Never from the target.
  function intakeToday() {
    var F = null;
    if (typeof window.foodTotals === 'function') {
      try { F = window.foodTotals(); } catch (e) { F = null; }
    }
    if (F) return F; // foodTotals already means "today, >= 1 entry" (see its contract in food.js)
    var I = typeof INTAKE === 'undefined' || !INTAKE ? null : INTAKE;
    var L = I && I.latest;
    return L && L.date === todayIso() && L.k > 0 ? L : null;
  }
  function pctOf(v, t) { return Math.round(Math.min(1, Math.max(0, v / t)) * 100); }
  // 270 degree kcal dial in the Inicio dials' language: the track is the baked arc (NUTRI_ARC,
  // view/dial.mjs); the fill reuses it with pathLength 100, so any fraction needs no geometry here
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
  function remainderHtml(x) {
    var rem = x.rem, bike = x.fuelK > 0;
    if (Math.abs(rem) <= N.tolerance) return '';
    var k = kf(Math.abs(rem)), g = Math.round(Math.abs(rem) / 4 / 5) * 5;
    // every carb portion at its cap (or the factor at its maximum): a snack, never a bigger plate
    var full = x.allCapped || x.clamp === 'max';
    // with the automatic snack in the plan, what is still short is what the snack's caps leave over
    var tpl = rem > 0 ? (bike ? T.remShortBike : x.snack ? T.remSnackLeft : full ? T.remSnack : T.remShort) : (bike ? T.remOverBike : T.remOver);
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
  // the goal as a low-emphasis chip next to today's kcal; it opens the profile sheet's goal setting
  function goalChipHtml() {
    var g = T.goals[state.goal];
    return '<button type="button" class="nt-goal" id="nutri-goal-chip" aria-haspopup="dialog" aria-label="' + esc(format(T.goalChip, { goal: g })) + '">' + esc(g) + '</button>';
  }
  // the dial (.nt-top) and the bars + notes (.nt-side): stacked on phones, two columns >= 900 px (nutri.css)
  function renderTarget(host, x) {
    var t = target(), L = intakeToday();
    var line = !x ? '' : x.fuelK > 0
      ? format(T.planLineBike, { k: kf(x.tot.k), fuel: kf(x.fuelK), total: kf(x.tot.k + x.fuelK) })
      : format(T.planLine, { k: kf(x.tot.k), p: x.tot.p, c: x.tot.c, f: x.tot.g });
    host.innerHTML =
      '<div class="nt-top">' + dialHtml(t, L) + goalChipHtml() + '</div>' +
      '<div class="nt-side"><div class="nt-bars">' + barHtml(T.target.p, t.p, L, L && L.p, minOf(L, 'protein')) + barHtml(T.target.c, t.c, L, L && L.c, minOf(L, 'carbs')) + barHtml(T.target.f, t.f, L, L && L.g, minOf(L, 'fat')) + '</div>' +
      (L ? '<p class="nt-cnote">' + esc(L.src === 'log' ? T.target.loggedFoodNote : T.target.loggedNote) + '</p>' : '') +
      (L && L.missing && (L.missing.protein || L.missing.carbs || L.missing.fat) ? '<p class="nt-cnote">' + esc(T.target.loggedFoodMissing) + '</p>' : '') +
      '<p class="nt-cnote">' + esc(T.target.cNote) + '</p>' +
      (x ? '<p class="nt-plan">' + esc(line) + '</p>' + remainderHtml(x) + macroOffHtml(x) : '') + '</div>';
  }
  // a baked meal ({n, s}) is a main meal when its slot is one of NUTRI.mainSlots (lib/nutrition/slots.mjs
  // MAIN_SLOTS: breakfast / lunch / dinner); everything else is an add-on (a test pins it to isMainMeal)
  function isMainMeal(meal) {
    return !!meal && !!meal.s && (N.mainSlots || []).indexOf(meal.s) >= 0;
  }
  var PILL_SVG ='<svg class="supp-ico" viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(-45 12 12)"><rect x="3" y="8.5" width="18" height="7" rx="3.5"/><path d="M12 8.5v7"/></g></svg>';
  function suppLine(text) {
    return '<div class="meal-supp">' + PILL_SVG + '<span>' + esc(text) + '</span></div>';
  }
  // a scaled portion: a small muted arrow with an accessible label (no loud tag)
  function dirHtml(dir) {
    if (!dir) return '';
    var up = dir > 0;
    return '<span class="mp-dir" role="img" aria-label="' + esc(up ? T.plan.dirAria.up : T.plan.dirAria.down) + '">' + (up ? '↑' : '↓') + '</span>';
  }
  function row(cls, label, q) {
    return '<li class="' + cls + '"><span class="mp-l">' + label + '</span>' + (q != null ? '<span class="mp-q">' + esc(q) + '</span>' : '') + '</li>';
  }
  // a choosable block (lib/nutrition/blocks.mjs): its name is a select of the list's options, grouped
  // like the tables (protein lean / moderate / fatty, fruit / yogurt…), the current pick selected
  function groupLabel(gr) { return (T.plan.groups && T.plan.groups[gr]) || gr; }
  function noneLabel(cat) { return (T.plan.none && T.plan.none[cat]) || T.plan.noneAny; }
  // a fixed food's block: the foods of its category (the default under the plan's own label), then
  // "none" when the category allows skipping it
  function foodPickHtml(p, b, cur, mealName) {
    var F = N.foods;
    var keys = F && F.cats ? F.cats[b.I] : null;
    if (!keys || !F.rules[b.I]) return null;
    var body = keys.map(function (k) {
      var name = k === b.d && b.n ? b.n : F.ings[k].n;
      return '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(name) + '</option>';
    }).join('');
    if (F.rules[b.I].skip) body += '<option value="' + NONE_KEY + '"' + (cur === NONE_KEY ? ' selected' : '') + '>' + esc(noneLabel(b.I)) + '</option>';
    var item = p.z ? noneLabel(b.I) : p.l;
    return '<select class="mp-pick" data-block="' + esc(p.id) + '" aria-label="' + esc(format(T.plan.pickAria, { item: item, meal: mealName })) + '">' + body + '</select>';
  }
  // the automatic snack's select: every snack option (NUTRI.snack.opts), the current one selected
  function snackPickHtml(p, x, mealName) {
    var sb = N.snack;
    if (!sb || !sb.opts || sb.opts.length < 2 || !x.snack) return null;
    var body = sb.opts.map(function (o) {
      return '<option value="' + esc(o.k) + '"' + (o.k === x.snack.k ? ' selected' : '') + '>' + esc(o.n) + '</option>';
    }).join('');
    return '<select class="mp-pick" data-block="' + esc(p.id) + '" aria-label="' + esc(format(T.plan.pickAria, { item: p.l, meal: mealName })) + '">' + body + '</select>';
  }
  function pickHtml(p, x, mealName) {
    if (p.sn) return snackPickHtml(p, x, mealName);
    var base = N.base[x.base];
    var b = p.id && base.blocks ? base.blocks[p.id] : null;
    if (b && b.I) return foodPickHtml(p, b, (x.picks && x.picks[p.id]) || b.d, mealName);
    var list = b && N.lists ? N.lists[b.L] : null;
    if (!b || !list || list.length < 2) return null;
    var cur = (x.picks && x.picks[p.id]) || b.d;
    var groups = [], byGr = {};
    list.forEach(function (o) {
      var g = o.gr || '';
      if (!(g in byGr)) { byGr[g] = []; groups.push(g); }
      byGr[g].push(o);
    });
    var opt = function (o) { return '<option value="' + esc(o.k) + '"' + (o.k === cur ? ' selected' : '') + '>' + esc(o.n) + '</option>'; };
    var body = groups.map(function (g) {
      var opts = byGr[g].map(opt).join('');
      return g && groups.length > 1 ? '<optgroup label="' + esc(groupLabel(g)) + '">' + opts + '</optgroup>' : opts;
    }).join('');
    return '<select class="mp-pick" data-block="' + esc(p.id) + '" aria-label="' + esc(format(T.plan.pickAria, { item: p.l, meal: mealName })) + '">' + body + '</select>';
  }
  function partHtml(p, x, fi, mealName) {
    var q = p.x ? x.flex[fi] : p.q;
    var dir = p.x && x.flexDir ? x.flexDir[fi] : 0;
    var pick = p.id ? pickHtml(p, x, mealName) : null;
    var label = (pick || esc(p.l)) + dirHtml(dir);
    var flexCls = p.x ? ' mp-flex' : '';
    if (pick) flexCls += ' mp-block';
    if (p.z) flexCls += ' mp-none'; // a skipped food: its select (to undo it), no amount
    if (!p.c) return row('mp' + flexCls, label, q);
    // a composite: its name, then one readable sub-row per component (name, amount)
    var amts = p.x ? (x.flexAmts ? x.flexAmts[fi] : []) : p.a || [];
    return row('mp mp-comp' + flexCls, label, null) +
      p.c.map(function (name, i) { return row('mp-sub', esc(name), amts[i] != null ? amts[i] : ''); }).join('');
  }
  function renderPlan(host, x) {
    var base = N.base[x.base];
    var view = x.view || (base && base.meals);
    if (!base || !view || !view.length) { host.innerHTML = '<p class="nutri-empty">' + esc(T.plan.empty) + '</p>'; return; }
    var supps = (N.supplements || []).slice();
    var used = {};
    var fi = 0;
    var A = T.plan.macroAbbr;
    // walked in DAY order (the flex index and "first meal of a slot" for supplements follow it), then
    // grouped: the main meals as cards, every other meal as a compact row of ONE add-ons card after them
    var mains = '', rows = '', addonK = 0;
    view.forEach(function (meal, i) {
      var m = x.meals[i];
      var parts = meal.parts.map(function (p) { return partHtml(p, x, p.x ? fi++ : -1, meal.n); }).join('');
      var mine = '';
      if (meal.s && !used[meal.s]) {
        used[meal.s] = true;
        supps.forEach(function (s) { if (s.meal === meal.s) mine += suppLine(s.name + (s.dose ? ' ' + s.dose : '')); });
      }
      if (!isMainMeal(meal)) {
        addonK += m[0];
        rows += '<div class="addon"><div class="addon-top"><div class="addon-name">' + esc(meal.n) + '</div>' +
          '<div class="addon-kcal"><b>' + esc(kf(m[0])) + '</b> kcal</div></div>' +
          '<ul class="meal-parts">' + parts + '</ul>' + mine + '</div>';
        return;
      }
      mains += '<div class="meal"><div class="meal-top"><div class="meal-name">' + esc(meal.n) + '</div>' +
        '<div class="meal-kcal"><b>' + esc(kf(m[0])) + '</b> kcal</div></div>' +
        '<ul class="meal-parts">' + parts + '</ul>' +
        (meal.pcf ? '<div class="meal-pcf"><span><b>' + m[1] + '</b> ' + A.p + '</span><span><b>' + m[2] + '</b> ' + A.c + '</span><span><b>' + m[3] + '</b> ' + A.f + '</span></div>' : '') +
        mine + '</div>';
    });
    var html = mains + (rows
      ? '<div class="meal meal-addons"><div class="meal-top"><div class="meal-name">' + esc(T.plan.addons) + '</div>' +
        '<div class="meal-kcal"><b>' + esc(kf(addonK)) + '</b> kcal</div></div>' + rows + '</div>'
      : '');
    var others = supps.filter(function (s) { return !used[s.meal]; });
    if (others.length) {
      html += '<div class="meal meal-others"><div class="meal-name">' + esc(T.plan.otherSupps) + '</div>' +
        others.map(function (s) {
          return suppLine(s.name + (s.dose ? ' ' + s.dose : '') + ' (' + (T.plan.meals[s.meal] || s.meal) + ')');
        }).join('') + '</div>';
    }
    // honest with mixed factors: the common factor of the portions still free, and whether some (or
    // every) portion stopped at its maximum (lib/nutrition/scale.mjs portion caps)
    var ftpl = x.allCapped ? T.plan.factorAllCapped : x.capped ? T.plan.factorCapped : x.clamp === 'max' ? T.plan.factorMax : x.clamp === 'min' ? T.plan.factorMin : T.plan.factor;
    if (x.factor !== 1 || x.clamp || x.capped) html += '<p class="nutri-factor">' + esc(format(ftpl, { factor: fmtFactor(x.factor, N.fmt.dec) })) + '</p>';
    if (x.udOnly && Math.abs(x.rem) > N.tolerance) html += '<p class="nutri-factor">' + esc(T.plan.unitsOnly) + '</p>';
    if (x.snack) html += '<p class="nutri-factor nutri-snack">' + esc(T.plan.snackNote) + '</p>';
    if (x.picks && Object.keys(x.picks).length) {
      html += '<p class="nutri-factor nutri-picks">' + esc(T.plan.picksNote) + ' <button type="button" class="lnk nutri-picks-reset" id="nutri-picks-reset">' + esc(T.plan.picksReset) + '</button></p>';
    }
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
    // Antes -> Durante -> Después as a 3-step timeline, one key number per step
    function step(key, title, num, items) {
      return '<li class="fuel-step fuel-step-' + key + '"><div class="fuel-step-head"><h3>' + esc(title) + '</h3><b class="fuel-key">' + esc(num) + '</b></div><ul>' + items + '</ul></li>';
    }
    host.innerHTML =
      '<ol class="fuel-steps">' +
      step('before', F.before, keyBefore, li(before) + li(format(F.lastHour, { lo: b.lastHourG[0], hi: b.lastHourG[1] }))) +
      step('during', F.during, rate + ' ' + F.perHour,
      li(format(F.duringCarbs, { rate: rate, total: total })) +
      li(format(F.duringEquiv, { gels: du.equiv.gels, gelG: U.gelG, bananas: du.equiv.bananas, bananaG: U.bananaG, bars: du.equiv.bars, barG: U.barG, bLo: du.equiv.bottles[0], bHi: du.equiv.bottles[1], ml: U.bottleMl, pLo: U.bottlePct[0], pHi: U.bottlePct[1], gLo: U.bottleG[0], gHi: U.bottleG[1] })) +
      li(format(F.duringMix, { bottles: du.mix.bottles, gels: du.mix.gels })) +
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
    guard($('nutri-plan'), withPlan(renderPlan));
    var pk = $('nutri-plan-kcal');
    if (pk) pk.textContent = x ? kf(x.tot.k) + ' ' + T.target.kcal : '';
    renderFuel(picker !== false);
    guard($('eat-body'), renderEat);
    refreshDependents();
  }

  /* ---------- events ---------- */
  function on(id, evt, fn) {
    var el = $(id);
    if (el && el.addEventListener) el.addEventListener(evt, fn);
  }
  // the goal is changed from the profile sheet (client/profile.js); false = not a known goal
  function setGoal(v) {
    if (N.goals.indexOf(v) < 0) return false;
    state.goal = v;
    save(KEY_GOAL, v);
    refresh();
    return true;
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
  // a block pick: kept for today (hc.nutri.picks), the whole day re-solved; focus stays on the select
  function setPick(id, key) {
    var sb = N.snack;
    if (sb && id === sb.id) return setSnackPick(key);
    var base = N.base[baseDay()];
    var b = base && base.blocks ? base.blocks[id] : null;
    if (!b) return false;
    if (key === b.d) delete state.picks[id];
    else state.picks[id] = key;
    savePicks();
    refresh(false);
    return true;
  }
  // the automatic snack's pick: a known option; today's default (it depends on the shortfall) drops it
  function setSnackPick(key) {
    var sb = N.snack, known = false;
    (sb.opts || []).forEach(function (o) { if (o.k === key) known = true; });
    if (!known) return false;
    var x = null;
    try { x = current(); } catch (e) { x = null; }
    if (x && x.snack && key === x.snack.d) delete state.picks[sb.id];
    else state.picks[sb.id] = key;
    savePicks();
    refresh(false);
    return true;
  }
  function resetPicks() {
    state.picks = {};
    savePicks();
    refresh(false);
  }
  function refocus(sel) {
    try {
      var el = document.querySelector ? document.querySelector(sel) : null;
      if (el && el.focus) el.focus();
    } catch (e) { /* focus is a convenience */ }
  }
  on('nutri-plan', 'change', function (e) {
    var t = e && e.target;
    var id = t && t.getAttribute ? t.getAttribute('data-block') : null;
    if (!id || typeof t.value !== 'string') return;
    if (setPick(id, t.value)) refocus('select[data-block="' + id.replace(/["\\]/g, '') + '"]');
  });
  on('nutri-plan', 'click', function (e) {
    var t = e && e.target;
    var btn = t && t.closest ? t.closest('#nutri-picks-reset') : null;
    if (!btn) return;
    resetPicks();
    refocus('#nutri-plan select');
  });
  // Plan de hoy is a native <details>, collapsed by default; its open state is a per-viewer convenience
  // (hc.nutri.planOpen = '1' / '0'). The plan is rendered either way, so "Del plan" (todayPlan) and the
  // selects never depend on it being open.
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
  window.nutriTarget = function () {
    var x = current(), d = dayType();
    var head = x.fuelK > 0 ? T.target.mealsHeading : T.target.heading;
    return {
      k: x.mt.k, p: x.mt.p, c: x.mt.c, g: x.mt.f, fatMax: x.mt.f + N.macroTol, fuelK: x.fuelK,
      day: x.base, dayType: d, label: head + ' · ' + T.dayTypes[d] + ' · ' + T.goals[state.goal],
    };
  };
  /** Today's Plan de hoy meals for the food log's "Del plan" tab (client/food.js), READ-ONLY: the same
   * plan the page renders (current(): goal × day type × ride minutes through planFor), never
   * re-computed elsewhere. [{name, slot, kcal, p, c, g, items}] with the meal totals exactly as Plan de
   * hoy shows them (whole numbers) and per item {name, amount, kcal (whole), p, c, g (1 decimal),
   * components?} — a scaled item at its scaled amount; a composite lists its components (name,
   * amount) and has no amount of its own. A fresh copy each call; null when there is nothing to show. */
  function r1(v) { return Math.round(v * 10) / 10; }
  function todayPlan() {
    var x = current();
    var view = x && (x.view || (N.base[x.base] && N.base[x.base].meals));
    if (!view || !view.length) return null;
    var fi = 0;
    return view.map(function (meal, i) {
      var m = x.meals[i];
      var items = [];
      meal.parts.forEach(function (p) {
        var k = p.x ? fi++ : -1;
        if (p.z) return; // a skipped food ("none"): nothing to log
        var mac = p.x ? x.flexMac[k] : p.m;
        var it = { name: p.l, amount: null, kcal: Math.round(mac[0]), p: r1(mac[1]), c: r1(mac[2]), g: r1(mac[3]) };
        if (p.c) {
          var amts = p.x ? x.flexAmts[k] : p.a || [];
          it.components = p.c.map(function (name, n) { return { name: name, amount: amts[n] != null ? amts[n] : null }; });
        } else it.amount = (p.x ? x.flex[k] : p.q) || null;
        items.push(it);
      });
      return { name: meal.n, slot: meal.s || null, kcal: m[0], p: m[1], c: m[2], g: m[3], items: items };
    }).filter(function (meal) { return meal.items.length > 0; }); // every food of the meal skipped: nothing to log
  }
  window.HCNutri = {
    setGoal: setGoal,
    todayPlan: function () {
      try { return todayPlan(); } catch (e) { return null; }
    },
    // the food log (client/food.js) calls this after every add / delete: the dial, bars, rings
    refresh: function () { refresh(false); },
    detectDayType: detectDayType,
    fuelPlan: fuelPlan,
    waterFill: waterFill,
    solveScale: solveScale,
    planFor: planFor,
    applyPicks: applyPicks,
    snackFor: snackFor,
    swapOption: swapOption,
    swapIng: swapIng,
    isMainMeal: isMainMeal,
    LINE: LINE,
    setPick: function (id, key) { return typeof id === 'string' && typeof key === 'string' ? setPick(id, key) : false; },
    resetPicks: resetPicks,
    state: function () { return { goal: state.goal, dayType: dayType(), override: state.override, auto: state.auto, rideMin: rideMinutes(), raised: state.raised, picks: JSON.parse(JSON.stringify(state.picks)) }; },
  };

  try { init(); } catch (e) { state.auto = { type: 'rest', why: 'none', rideMin: null }; }
  try { initPlanFold(); } catch (e) { /* the fold keeps its server-rendered (collapsed) state */ }
  refresh();
})();
