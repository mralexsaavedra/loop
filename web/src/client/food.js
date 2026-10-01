/* Nutrición food log (part 2) — Registrar (today's log in four groups: Desayuno / Comida / Cena /
 * Añadidos, inside the `dia` section), the
 * add sheet (a view of the detail sheet modal), Mis productos and Mis recetas (folds before Tablas).
 * Classic script (is:inline), inlined after nutri-day.js and before intake.js. Reads
 * I18N_FOOD + FOOD_CONST (meal slots / stores / units from lib/nutrition/foodlog.mjs), baked by
 * web/src/tabs/Dia.astro, and window.HC (util.js).
 *
 * LAN only, decided at VIEW time like freshness.js: every host ships `hidden` and appears only when
 * GET /api/food/products answers (plan-web proxies /api/food/ to the ingest service). The claude.ai
 * artifact, file:// and the example build never reach it, so they show nothing new and builds stay
 * byte-identical. Every request carries `X-HC-Food: 1` (the ingest service refuses anything else) and
 * writes send JSON. Nothing of the log is kept in the browser: the server is the one copy.
 *
 * Data honesty: macros come from the owner's products / recipes (per-100 values from the label or Open
 * Food Facts, confirmed by him) and the live preview uses a line-by-line port of
 * lib/nutrition/foodlog.mjs (window.HCFood; food.test.mjs runs it over the shared FOODLOG_CASES).
 * A quick entry without macros counts its kcal only; unknown macros are never filled in.
 *
 * Basics (the add sheet's "Mis productos" search): the public food DB (data/nutrition/ingredients.json),
 * baked as FOOD_BASICS by Dia.astro (lib/nutrition/basics.mjs). Typing also lists the matching basics, in a
 * "Básicos" group after the owner's products (accent- and case-insensitive); a pick takes an amount in
 * the food's natural unit (pieces / ml / g, pieces <-> grams for a countable food) and is logged as ONE
 * quick entry with its four macros (a port of lib/nutrition/foodlog.mjs basicEntry / basicLabel; average
 * table values, marked as such).
 *
 * "Del plan" (the add sheet's plan tab): today's Plan de hoy meals from window.HCNutri.todayPlan()
 * (nutri-day.js, read-only: the same goal × day type × ride minutes and scaled amounts the page shows;
 * nothing is re-computed here). The whole meal or one of its items is logged as ONE quick entry
 * ("Plan · <name>") with its four macros. No plan (no hook, an empty plan, a throw) = no tab.
 *
 * Wiring: window.foodTotals() = today's logged totals ({date, k, p, c, g, n, missing, src: 'log'}) when
 * the server answered and today has >= 1 entry, else null. Resumen de hoy's dial + macro bars
 * (nutri-day.js) and the intake rings (intake.js) prefer it over the Apple Health intake; after every
 * add / delete this script calls HCNutri.refresh() (which also refreshes the rings),
 * each hook in its own try/catch. Errors are one line from the server's coarse codes. */
(function () {
  var T = typeof I18N_FOOD === 'undefined' || !I18N_FOOD ? null : I18N_FOOD;
  var K = typeof FOOD_CONST === 'undefined' || !FOOD_CONST ? null : FOOD_CONST;
  // the public basics (lib/nutrition/basics.mjs): [{k, n, u, m: [kcal, p, c, f] per 100 of u, pc?, v?}]
  var BASICS = typeof FOOD_BASICS !== 'undefined' && Array.isArray(FOOD_BASICS) ? FOOD_BASICS : [];
  var BASIC_RESULTS_MAX = 25; // a short list: typing narrows it
  window.foodTotals = function () { return null; };
  if (!T || !K || typeof fetch !== 'function' || typeof document === 'undefined') return;
  var esc = HC.esc, format = HC.format, nf = HC.nf;
  // shared input limits, baked from lib/nutrition/foodlog.mjs FOOD_LIMITS (the ingest checks the same)
  var LIM = K.limits || {};
  var BARCODE_RE = new RegExp(LIM.barcodePattern || '^$');
  var API = '/api/food';
  var TIMEOUT_MS = 15000; // a request that hangs is an ambiguous failure, like offline
  // Registrar shows FOUR groups (lib/nutrition/slots.mjs, baked in FOOD_CONST): the main slots
  // breakfast / lunch / dinner + ONE add-ons group for every other stored slot (pre / post workout,
  // snack). The stored slot enum (K.meals) is unchanged: an add-on is stored as K.addonSlot unless it
  // comes from a plan add-on with its own slot (pre / post workout).
  var GROUPS = K.groups || [];
  var MAIN = K.mainSlots || [];
  var ADDON = K.addonGroup;
  // a fresh add sheet's group by the viewer's hour: before 11 breakfast, before 16 lunch, before 20 an add-on, else dinner
  var MEAL_HOUR_CUTS = [[11, 'breakfast'], [16, 'lunch'], [20, ADDON]];
  var S = { ok: false, products: [], recipes: [], log: null, sheet: null, pform: null, rform: null, confirm: null };
  var pendingMeal = null;

  /* ---------- the formula: a line-by-line port of lib/nutrition/foodlog.mjs ---------- */
  var ATWATER_TOL = 0.25;
  var ATWATER_ABS_KCAL = 10;
  var MACROS = ['protein', 'carbs', 'fat'];
  function fin(v) {
    return typeof v === 'number' && isFinite(v);
  }
  function round1(v) {
    return Math.round(v * 10 + 1e-9) / 10;
  }
  function roundKcal(v) {
    return Math.round(v + 1e-9);
  }
  function roundMacros(m) {
    if (!m) return null;
    return {
      kcal: fin(m.kcal) ? roundKcal(m.kcal) : null,
      protein: fin(m.protein) ? round1(m.protein) : null,
      carbs: fin(m.carbs) ? round1(m.carbs) : null,
      fat: fin(m.fat) ? round1(m.fat) : null,
    };
  }
  function scaleMacros(per100, amount) {
    var f = amount / 100;
    return { kcal: per100.kcal * f, protein: per100.protein * f, carbs: per100.carbs * f, fat: per100.fat * f };
  }
  function times(m, f) {
    return { kcal: m.kcal * f, protein: m.protein * f, carbs: m.carbs * f, fat: m.fat * f };
  }
  function productAmount(product, amount, unit) {
    if (!product || !product.per100 || !fin(amount) || amount <= 0) return null;
    if (unit === 'serving') return fin(product.servingSize) && product.servingSize > 0 ? amount * product.servingSize : null;
    return unit === product.unit ? amount : null;
  }
  function productEntry(product, amount, unit) {
    var a = productAmount(product, amount, unit);
    return a == null ? null : roundMacros(scaleMacros(product.per100, a));
  }
  function recipeBasis(recipe, byId) {
    var totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    var missing = [];
    var raw = 0;
    (recipe && recipe.ingredients ? recipe.ingredients : []).forEach(function (ing) {
      var p = byId ? byId[ing.productId] : null;
      if (!p || !p.per100 || !fin(ing.amount) || ing.amount <= 0) { missing.push(ing.productId); return; }
      var m = scaleMacros(p.per100, ing.amount);
      totals = { kcal: totals.kcal + m.kcal, protein: totals.protein + m.protein, carbs: totals.carbs + m.carbs, fat: totals.fat + m.fat };
      raw += ing.amount;
    });
    var complete = missing.length === 0 && raw > 0;
    var perServing = null, per100 = null;
    if (complete && recipe.kind === 'serving' && fin(recipe.servings) && recipe.servings >= 1) perServing = times(totals, 1 / recipe.servings);
    if (complete && recipe.kind === 'batch' && fin(recipe.cookedWeightG) && recipe.cookedWeightG > 0) per100 = times(totals, 100 / recipe.cookedWeightG);
    return { complete: complete && (perServing != null || per100 != null), missing: missing, rawWeight: raw, totals: totals, perServing: perServing, per100: per100 };
  }
  function entryFromBasis(basis, kind, amount, unit) {
    if (!basis || !fin(amount) || amount <= 0) return null;
    if (kind === 'serving' && unit === 'serving' && basis.perServing) return roundMacros(times(basis.perServing, amount));
    if (kind === 'batch' && unit === 'g' && basis.per100) return roundMacros(times(basis.per100, amount / 100));
    return null;
  }
  function recipeEntry(recipe, byId, amount, unit) {
    if (!fin(amount) || amount <= 0) return null;
    var b = recipeBasis(recipe, byId);
    if (!b.complete) return null;
    return entryFromBasis(b, recipe.kind, amount, unit);
  }
  function dayTotals(entries) {
    var t = { kcal: 0, protein: 0, carbs: 0, fat: 0, count: 0, missing: { protein: false, carbs: false, fat: false } };
    (entries || []).forEach(function (e) {
      t.count++;
      if (fin(e.kcal)) t.kcal += e.kcal;
      MACROS.forEach(function (k) {
        if (fin(e[k])) t[k] += e[k];
        else t.missing[k] = true;
      });
    });
    t.kcal = roundKcal(t.kcal);
    MACROS.forEach(function (k) { t[k] = round1(t[k]); });
    return t;
  }
  function atwaterOk(m) {
    var est = 4 * m.protein + 4 * m.carbs + 9 * m.fat;
    return Math.abs(est - m.kcal) <= Math.max(ATWATER_TOL * m.kcal, ATWATER_ABS_KCAL);
  }
  // basics (lib/nutrition/foodlog.mjs basicModes … basicConvert; food.test.mjs runs BASIC_CASES)
  function round2(v) {
    return Math.round(v * 100 + 1e-9) / 100;
  }
  function pieceWeight(b, mode) {
    var pc = b && b.pc;
    if (!pc) return null;
    if (b.u === 'ud') return mode === 'g' && fin(pc.r) && pc.r > 0 ? pc.r : null;
    return mode === b.u && fin(pc.a) && pc.a > 0 ? pc.a : null;
  }
  function basicModes(b) {
    if (!b) return [];
    if (b.u === 'ud') return pieceWeight(b, 'g') ? ['piece', 'g'] : ['piece'];
    return b.pc ? ['piece', b.u] : [b.u];
  }
  function basicAmount(b, amount, mode) {
    if (!b || !b.m || !fin(amount) || amount <= 0) return null;
    if (mode === 'piece') {
      if (b.u === 'ud') return amount * (b.pc && fin(b.pc.a) ? b.pc.a : 100);
      return b.pc && fin(b.pc.a) ? amount * b.pc.a : null;
    }
    if (mode === b.u) return amount;
    var w = b.u === 'ud' ? pieceWeight(b, mode) : null;
    return w ? (amount / w) * 100 : null;
  }
  function basicEntry(b, amount, mode) {
    var a = basicAmount(b, amount, mode);
    return a == null ? null : roundMacros(scaleMacros({ kcal: b.m[0], protein: b.m[1], carbs: b.m[2], fat: b.m[3] }, a));
  }
  function basicLabel(b, amount, mode, w) {
    if (basicAmount(b, amount, mode) == null) return null;
    var num = function (x) { return String(round2(x)).replace('.', w.dec); };
    var s;
    if (mode === 'piece') {
      var unit = b.u === 'ud' ? 'g' : b.u;
      var pw = pieceWeight(b, unit);
      s = num(amount) + ' ' + w.ud + (pw ? ' (~' + Math.round(amount * pw + 1e-9) + ' ' + w[unit] + ')' : '');
    } else {
      s = num(amount) + ' ' + w[mode];
    }
    return (b.n + ' · ' + s).slice(0, LIM.nameMax || 120);
  }
  function basicConvert(b, amount, from, to) {
    var a = basicAmount(b, amount, from);
    if (a == null || basicModes(b).indexOf(to) < 0) return null;
    if (from === to) return amount;
    var per = basicAmount(b, 1, to);
    var v = a / per;
    return to === 'piece' ? round2(v) : Math.round(v + 1e-9);
  }

  /* ---------- small helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function kf(n) { // thousands separator: 3.050 (es) / 3,050 (en)
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, HC.isEs() ? '.' : ',');
  }
  function val(id) {
    var el = $(id);
    return el && el.value != null ? String(el.value) : '';
  }
  // the words the owner may type after a number ("30 g", "30g", "250 ml", "130 kcal"), by unit
  var UNIT_WORDS = { g: ['g', 'gr', 'grs', 'gramo', 'gramos', 'gram', 'grams'], ml: ['ml'], kcal: ['kcal'] };
  function unitOfWord(w) {
    for (var u in UNIT_WORDS) if (Object.prototype.hasOwnProperty.call(UNIT_WORDS, u) && UNIT_WORDS[u].indexOf(w) >= 0) return u;
    return null;
  }
  /** THE parser of every numeric field (product form, recipe form, add sheet): trimmed, a decimal comma
   * is fine, and a trailing unit the field takes is dropped (`units`: e.g. ['g']; null = a count, no
   * unit). null = empty or ONLY a unit word ("g": an optional field is then simply not set); NaN =
   * anything else that is not a plain non-negative number, including another unit (never g <-> ml). */
  function parseNum(v, units) {
    var s = String(v == null ? '' : v).trim();
    var m = /^(.*?)\s*([A-Za-z]+)\.?$/.exec(s);
    if (m) {
      var u = unitOfWord(m[2].toLowerCase());
      if (!u) return NaN;
      if (m[1] === '') return null;
      if (!units || units.indexOf(u) < 0) return NaN;
      s = m[1];
    }
    s = s.replace(',', '.');
    if (s === '') return null;
    return /^(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN;
  }
  // a parsed value's error kind (T.fieldErrors), or null when it is fine
  function numKind(v, required, positive) {
    if (v == null) return required ? 'required' : null;
    if (!fin(v)) return 'number';
    if (positive && !(v > 0)) return 'positive';
    return null;
  }
  function g1(v) { return v == null ? '—' : nf(round1(v)); }
  function setText(id, s) { var el = $(id); if (el) el.textContent = s; }
  function setHtml(id, s) { var el = $(id); if (el) el.innerHTML = s; }
  function focus(id) { var el = $(id); if (el && typeof el.focus === 'function') el.focus(); }

  /* ---------- inline field errors ---------- */
  // every field renders an empty <small id="<id>-err"> its input is described by; an error fills it
  // and marks the input aria-invalid
  function fieldErr(id, msg) {
    setText(id + '-err', msg);
    var el = $(id);
    if (!el || typeof el.setAttribute !== 'function') return;
    el.setAttribute('aria-invalid', 'true');
    var d = el.getAttribute('aria-describedby') || '';
    if ((' ' + d + ' ').indexOf(' ' + id + '-err ') < 0) el.setAttribute('aria-describedby', (d ? d + ' ' : '') + id + '-err');
  }
  function clearErrs(ids) {
    ids.forEach(function (id) {
      setText(id + '-err', '');
      var el = $(id);
      if (el && typeof el.removeAttribute === 'function') el.removeAttribute('aria-invalid');
    });
  }
  // errs = [{id, key (T.fields), kind (T.fieldErrors)}]: each under its field, focus on the first;
  // returns the form's status line, which names the first field
  function showErrs(errs) {
    errs.forEach(function (e) { fieldErr(e.id, T.fieldErrors[e.kind] || T.fieldErrors.invalid); });
    focus(errs[0].id);
    return format(T.errors.invalid, { field: T.fields[errs[0].key] || errs[0].key });
  }
  // a server answer that names a field ({error: 'invalid', field}) also lands under that field
  function serverFieldErr(err, ids) {
    var key = err && (err.code === 'invalid' ? err.field : err.code === 'barcode_exists' ? 'barcode' : null);
    var id = key && Object.prototype.hasOwnProperty.call(ids, key) ? ids[key] : null;
    if (!id || !$(id)) return;
    fieldErr(id, err.code === 'invalid' ? T.fieldErrors.invalid : errText(err));
    focus(id);
  }
  function byId(list) {
    var out = {};
    list.forEach(function (x) { out[x.id] = x; });
    return out;
  }
  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
    return null;
  }
  function pcf(m) {
    var A = T.macroAbbr;
    return A.p + ' ' + g1(m.protein) + ' · ' + A.c + ' ' + g1(m.carbs) + ' · ' + A.f + ' ' + g1(m.fat);
  }
  function macroLine(m) {
    return '<b>' + esc(kf(m.kcal)) + '</b> ' + esc(T.kcal) + ' · ' + esc(pcf(m));
  }
  function amountText(amount, unit) {
    var u = unit === 'serving' ? (amount === 1 ? T.units.serving : T.units.servings) : T.units[unit] || unit;
    return nf(amount) + ' ' + u;
  }
  function errText(e) {
    var code = e && e.code;
    if (code === 'invalid') return format(T.errors.invalid, { field: (e.field && T.fields[e.field]) || e.field || '' });
    return T.errors[code] || T.errors.generic;
  }
  // the group of a stored slot (or of a group key): a main slot is its own group, anything else add-ons
  function groupOf(slot) {
    return MAIN.indexOf(slot) >= 0 ? slot : ADDON;
  }
  // a group key, a stored slot (mapped to its group), else null
  function asGroup(v) {
    if (GROUPS.indexOf(v) >= 0) return v;
    return K.meals.indexOf(v) >= 0 ? groupOf(v) : null;
  }
  // the slot stored for a group: a main group is its slot; an add-on keeps a plan add-on's own slot
  // (pre / post workout), else K.addonSlot
  function slotFor(group, planMeal) {
    if (group !== ADDON) return group;
    var s = planMeal && planMeal.slot;
    return s && K.meals.indexOf(s) >= 0 && MAIN.indexOf(s) < 0 ? s : K.addonSlot;
  }
  function guessMeal() {
    var h = new Date().getHours();
    for (var i = 0; i < MEAL_HOUR_CUTS.length; i++) if (h < MEAL_HOUR_CUTS[i][0]) return MEAL_HOUR_CUTS[i][1];
    return 'dinner';
  }
  // one id per pending add (the server stores it with a unique index, so a retry is idempotent).
  // crypto.randomUUID needs a secure context, which plain http on the LAN is not: fall back to
  // getRandomValues (available everywhere), then Math.random, formatted as a v4 UUID
  function newRequestId() {
    var c = typeof crypto !== 'undefined' ? crypto : window.crypto;
    if (c && typeof c.randomUUID === 'function') {
      try { return c.randomUUID(); } catch (e) { /* insecure context: fall through */ }
    }
    var b = [], i;
    if (c && typeof c.getRandomValues === 'function' && typeof Uint8Array !== 'undefined') {
      var a = c.getRandomValues(new Uint8Array(16));
      for (i = 0; i < 16; i++) b.push(a[i]);
    } else {
      for (i = 0; i < 16; i++) b.push(Math.floor(Math.random() * 256));
    }
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = b.map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  // no answer, a timeout or a 5xx: the write may or may not have landed
  function ambiguous(err) {
    return !err || err.code === 'offline' || !(err.status > 0) || err.status >= 500;
  }

  /* ---------- API ---------- */
  // resolves the JSON body of a 2xx; rejects {code, field?, status}: the server's coarse code, or
  // 'offline' (no answer / timed out, status 0)
  function api(method, path, body) {
    var headers = { 'X-HC-Food': '1' };
    var init = { method: method, headers: headers, cache: 'no-store', credentials: 'same-origin' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    var timer = null;
    if (typeof AbortController === 'function') {
      var ctl = new AbortController();
      init.signal = ctl.signal;
      timer = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
    }
    var done = function () { if (timer) clearTimeout(timer); };
    return fetch(API + path, init).then(function (res) {
      done();
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.ok) return data || {};
        throw { code: (data && typeof data.error === 'string' && data.error) || 'generic', field: data && data.field, status: res.status };
      });
    }, function () {
      done();
      throw { code: 'offline', status: 0 };
    });
  }

  /* ---------- today's totals for Resumen de hoy + the rings ---------- */
  /** THE contract nutri-day.js and intake.js rely on (they do not re-check it): null unless the food API
   * answered AND today (the viewer's local date) has >= 1 entry. Otherwise {date: today, k, p, c, g,
   * n (entries), missing, src: 'log'}: a macro NO entry states is null (a dash, never 0); missing[m] is
   * true when at least one entry lacks it, so a non-null value is then a minimum. */
  window.foodTotals = function () {
    var L = S.log;
    if (!S.ok || !L || L.date !== HC.todayIso() || !L.entries.length) return null;
    var t = L.totals;
    var known = function (k) { return L.entries.some(function (e) { return fin(e[k]); }) ? t[k] : null; };
    return { date: L.date, k: t.kcal, p: known('protein'), c: known('carbs'), g: known('fat'), n: t.count, missing: t.missing, src: 'log' };
  };
  function refreshDependents() {
    var n = window.HCNutri;
    if (n && typeof n.refresh === 'function') {
      try { n.refresh(); return; } catch (e) { /* the rings below still refresh */ }
    }
    if (typeof window.intakeRefresh === 'function') {
      try { window.intakeRefresh(); } catch (e) { /* the rings keep their last state */ }
    }
  }

  /* ---------- Registrar ---------- */
  var DEL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  // an add-on entry carries its stored slot as a tiny muted tag (Pre-entreno, Snack…)
  function entryHtml(e) {
    var tag = groupOf(e.meal) === ADDON && T.meals[e.meal] ? '<span class="fe-slot">' + esc(T.meals[e.meal]) + '</span>' : '';
    return '<li class="fe"><div class="fe-main"><span class="fe-label">' + esc(e.label) + '</span>' + tag +
      '<span class="fe-amt">' + esc(amountText(e.amount, e.unit)) + '</span></div>' +
      '<div class="fe-side"><span class="fe-kcal"><b>' + esc(kf(e.kcal)) + '</b> ' + esc(T.kcal) + '</span>' +
      '<span class="fe-pcf">' + esc(pcf(e)) + '</span></div>' +
      '<button type="button" class="food-icon-btn" data-food-act="del" data-id="' + esc(e.id) + '" aria-label="' + esc(format(T.delAria, { label: e.label })) + '">' + DEL_SVG + '</button></li>';
  }
  function renderLog() {
    var host = $('food-log');
    if (!host) return;
    try {
      var L = S.log || { entries: [], totals: dayTotals([]) };
      var t = L.totals;
      var miss = t.missing && (t.missing.protein || t.missing.carbs || t.missing.fat);
      var html = '<div class="food-sum"><span class="food-sum-lbl">' + esc(T.dayTotal) + '</span> ' + macroLine(t) + '</div>' +
        (miss ? '<p class="food-note">' + esc(T.missingNote) + '</p>' : '') +
        (L.entries.length ? '' : '<p class="food-note">' + esc(T.empty) + '</p>');
      html += '<div class="food-meals">' + GROUPS.map(function (m) {
        var list = L.entries.filter(function (e) { return groupOf(e.meal) === m; });
        var k = list.reduce(function (s, e) { return s + (fin(e.kcal) ? e.kcal : 0); }, 0);
        return '<section class="food-meal" aria-labelledby="fm-h-' + m + '"><div class="food-meal-top">' +
          '<h3 class="food-meal-name" id="fm-h-' + m + '">' + esc(T.groups[m]) + '</h3>' +
          (list.length ? '<span class="food-meal-kcal"><b>' + esc(kf(k)) + '</b> ' + esc(T.kcal) + '</span>' : '') + '</div>' +
          (list.length ? '<ul class="food-entries">' + list.map(entryHtml).join('') + '</ul>' : '') +
          '<button type="button" class="food-add" id="food-add-' + m + '" data-food-act="add" data-meal="' + m + '" aria-label="' + esc(format(T.addAria, { meal: T.groups[m] })) + '">+ ' + esc(T.add) + '</button></section>';
      }).join('') + '</div>';
      host.innerHTML = html;
    } catch (e) {
      host.innerHTML = '<p class="food-note">' + esc(T.errors.generic) + '</p>';
    }
  }
  function delEntry(el) {
    var id = el.getAttribute('data-id');
    var e = S.log && find(S.log.entries, id);
    if (!e) return;
    el.disabled = true;
    var drop = function () {
      S.log.entries = S.log.entries.filter(function (x) { return x !== e; });
      S.log.totals = dayTotals(S.log.entries);
      renderLog();
      refreshDependents();
    };
    api('DELETE', '/log/' + encodeURIComponent(id)).then(function () {
      drop();
      setText('food-msg', format(T.deleted, { label: e.label }));
    }, function (err) {
      // 404: it is already gone (a double tap, another device): just drop the row
      if (err && err.status === 404) { drop(); return; }
      el.disabled = false;
      setText('food-msg', errText(err));
    });
  }

  /* ---------- add sheet (window.HCViews['food-add'], rendered by detail.js) ---------- */
  function newSheet(meal) {
    var m = asGroup(meal) || guessMeal();
    var plan = todayPlan();
    return { meal: m, tab: 'products', q: '', pick: null, busy: false, reqId: null, plan: plan, planMeal: plan ? planMealFor(plan, m, 0) : 0, planItem: -1 };
  }
  /* ---------- Del plan: today's Plan de hoy meals (window.HCNutri.todayPlan, nutri-day.js) ---------- */
  // [{name, slot, kcal, p, c, g, items: [{name, amount, kcal, p, c, g, components?}]}], or null when Plan
  // de hoy is not available (no hook, no meals, a throw): the tab is then omitted
  function todayPlan() {
    var n = window.HCNutri;
    if (!n || typeof n.todayPlan !== 'function') return null;
    try {
      var p = n.todayPlan();
      return Array.isArray(p) && p.length ? p : null;
    } catch (e) { return null; }
  }
  function tabKeys() {
    return S.sheet && S.sheet.plan ? ['products', 'recipes', 'plan', 'quick'] : ['products', 'recipes', 'quick'];
  }
  // the plan meal for a group (the sheet's meal select): `current` when it already belongs to that
  // group, else the first plan meal of the group (Añadido: the first add-on), else `fallback`
  function planMealFor(plan, group, fallback, current) {
    var inGroup = function (m) { return !!m && groupOf(m.slot) === group; };
    if (current >= 0 && inGroup(plan[current])) return current;
    for (var i = 0; i < plan.length; i++) if (inGroup(plan[i])) return i;
    return fallback;
  }
  // the chip order: the main meals, then the add-ons (each in day order), like Plan de hoy
  function planOrder(plan) {
    var idx = plan.map(function (m, i) { return i; });
    var main = function (i) { return !!plan[i] && MAIN.indexOf(plan[i].slot) >= 0; };
    return idx.filter(main).concat(idx.filter(function (i) { return !main(i); }));
  }
  /** What the plan tab would log: {label, kcal, protein, carbs, fat} (a macro the plan lacks stays
   * unset), or null. The whole meal = its scaled totals as Plan de hoy shows them; an item = its own. */
  function planEntry() {
    var sh = S.sheet;
    var meal = sh && sh.plan ? sh.plan[sh.planMeal] : null;
    if (!meal) return null;
    var item = sh.planItem >= 0 ? (meal.items || [])[sh.planItem] : null;
    var src = item || meal;
    if (!fin(src.kcal) || src.kcal < 0) return null;
    var label = item
      ? (item.amount ? format(T.sheet.planItemLabel, { name: item.name, amount: item.amount }) : format(T.sheet.planLabel, { name: item.name }))
      : format(T.sheet.planLabel, { name: meal.name });
    var e = { label: label.replace(/\s+/g, ' ').trim().slice(0, LIM.nameMax || 120), kcal: roundKcal(src.kcal) };
    [['protein', 'p'], ['carbs', 'c'], ['fat', 'g']].forEach(function (x) { if (fin(src[x[1]])) e[x[0]] = round1(src[x[1]]); });
    return e;
  }
  function planMacros(x) {
    return { kcal: x.kcal, protein: fin(x.p) ? x.p : null, carbs: fin(x.c) ? x.c : null, fat: fin(x.g) ? x.g : null };
  }
  function planOpt(suffix, value, checked, nameHtml, src) {
    var id = 'fa-plan-item-' + suffix;
    return '<li class="fa-plan-opt"><input type="radio" name="fa-plan-item" id="' + id + '" value="' + value + '"' + (checked ? ' checked' : '') + '>' +
      '<label class="fa-plan-lbl" for="' + id + '">' + nameHtml + '<span class="fa-item-sub">' + macroLine(planMacros(src)) + '</span></label></li>';
  }
  function planHtml() {
    var sh = S.sheet, plan = sh.plan, meal = plan[sh.planMeal];
    var meals = '<div class="fa-plan-meals" role="group" aria-label="' + esc(T.sheet.planMeals) + '">' + planOrder(plan).map(function (i) {
      var m = plan[i];
      return '<button type="button" class="fa-plan-meal" id="fa-plan-meal-' + i + '" data-food-act="plan-meal" data-i="' + i + '" aria-pressed="' + (i === sh.planMeal) + '">' +
        '<span class="fa-item-name">' + esc(m.name) + '</span><span class="fa-item-sub">' + esc(kf(m.kcal)) + ' ' + esc(T.kcal) + '</span></button>';
    }).join('') + '</div>';
    var items = (meal.items || []).map(function (it, j) {
      var sub = it.components && it.components.length
        ? it.components.map(function (c) { return esc(c.name + (c.amount ? ' ' + c.amount : '')); }).join(' · ')
        : it.amount ? esc(it.amount) : '';
      return planOpt(j, j, sh.planItem === j, '<span class="fa-item-name">' + esc(it.name) + '</span>' + (sub ? ' <span class="fa-plan-amt">' + sub + '</span>' : ''), it);
    }).join('');
    return '<div class="fa-plan">' + meals +
      '<fieldset class="fa-plan-items"><legend class="food-lbl">' + esc(T.sheet.planWhat) + '</legend><ul class="fa-items">' +
      planOpt('all', -1, sh.planItem < 0, '<span class="fa-item-name">' + esc(T.sheet.planWhole) + '</span> <span class="fa-plan-amt">' + esc(meal.name) + '</span>', meal) + items +
      '</ul></fieldset>' +
      '<p class="fa-prev" id="fa-prev" aria-live="polite"></p>' +
      '<p class="food-note">' + esc(T.sheet.planNote) + '</p>' +
      '<button type="button" class="food-btn" id="fa-save" data-food-act="save">' + esc(T.sheet.save) + '</button></div>';
  }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function listHtml() {
    var sh = S.sheet;
    if (sh.tab === 'recipes') {
      if (!S.recipes.length) return '<p class="food-note">' + esc(T.sheet.noRecipes) + '</p>';
      return '<ul class="fa-items">' + S.recipes.map(function (r) {
        var b = r.kind === 'serving' ? r.perServing : r.per100;
        var basis = r.kind === 'serving' ? T.sheet.perServing : T.sheet.per100Cooked;
        return '<li><button type="button" class="fa-item" data-food-act="pick" data-kind="recipe" data-id="' + esc(r.id) + '"' + (r.complete ? '' : ' disabled') + '>' +
          '<span class="fa-item-name">' + esc(r.name) + '</span><span class="fa-item-sub">' +
          (b && r.complete ? esc(kf(b.kcal)) + ' ' + esc(T.kcal) + ' ' + esc(basis) : esc(T.sheet.incomplete)) + '</span></button></li>';
      }).join('') + '</ul>';
    }
    var q = norm(sh.q).trim();
    var hint = BASICS.length ? '<p class="food-note">' + esc(T.sheet.typeToSearch) + '</p>' : '';
    // an empty search lists the owner's products only (the basics appear once he types, so the list stays short)
    if (!q) return (S.products.length ? productGroupsHtml(S.products) : '<p class="food-note">' + esc(T.sheet.noProducts) + '</p>') + hint;
    var shown = S.products.filter(function (p) { return norm(p.name + ' ' + (p.brand || '')).indexOf(q) >= 0; });
    var basics = basicMatches(q);
    if (!shown.length && !basics.length) return '<p class="food-note">' + esc(T.sheet.noMatch) + '</p>';
    return productGroupsHtml(shown) + basicsHtml(basics);
  }
  // the basics whose name contains the search (accent- and case-insensitive), names that START with it first
  function basicMatches(q) {
    var hits = BASICS.filter(function (b) { return norm(b.n).indexOf(q) >= 0; });
    var first = hits.filter(function (b) { return norm(b.n).indexOf(q) === 0; });
    return first.concat(hits.filter(function (b) { return norm(b.n).indexOf(q) !== 0; })).slice(0, BASIC_RESULTS_MAX);
  }
  // "88 kcal por 100 g · valor medio" (a unit food: "por ud"; a verified label of the DB: "etiqueta")
  function basicSub(b) {
    var per = b.u === 'ud' ? T.sheet.perUnit : format(T.sheet.per100, { unit: T.units[b.u] || b.u });
    return per + ' · ' + (b.v ? T.sheet.basicLabelSrc : T.sheet.basicAvg);
  }
  function basicsHtml(list) {
    if (!list.length) return '';
    return '<h4 class="fa-store">' + esc(T.sheet.basics) + '</h4><ul class="fa-items">' + list.map(function (b) {
      return '<li><button type="button" class="fa-item" data-food-act="pick" data-kind="basic" data-id="' + esc(b.k) + '">' +
        '<span class="fa-item-name">' + esc(b.n) + '</span>' +
        '<span class="fa-item-sub">' + esc(kf(b.m[0])) + ' ' + esc(T.kcal) + ' ' + esc(basicSub(b)) + '</span></button></li>';
    }).join('') + '</ul>';
  }
  function productGroupsHtml(shown) {
    return K.stores.map(function (s) {
      var list = shown.filter(function (p) { return p.store === s; });
      if (!list.length) return '';
      return '<h4 class="fa-store">' + esc(T.stores[s]) + '</h4><ul class="fa-items">' + list.map(function (p) {
        return '<li><button type="button" class="fa-item" data-food-act="pick" data-kind="product" data-id="' + esc(p.id) + '">' +
          '<span class="fa-item-name">' + esc(p.name) + (p.brand ? ' <span class="fa-item-brand">' + esc(p.brand) + '</span>' : '') + '</span>' +
          '<span class="fa-item-sub">' + esc(kf(p.per100.kcal)) + ' ' + esc(T.kcal) + ' ' + esc(format(T.sheet.per100, { unit: T.units[p.unit] })) + '</span></button></li>';
      }).join('') + '</ul>';
    }).join('');
  }
  function pickedItem() {
    var pk = S.sheet && S.sheet.pick;
    if (!pk) return null;
    if (pk.kind === 'basic') return findBasic(pk.id);
    return pk.kind === 'recipe' ? find(S.recipes, pk.id) : find(S.products, pk.id);
  }
  function findBasic(key) {
    for (var i = 0; i < BASICS.length; i++) if (BASICS[i].k === key) return BASICS[i];
    return null;
  }
  // the label's words: the viewer's decimal mark and the unit words of the copy
  function basicWords() {
    return { dec: HC.isEs() ? ',' : '.', g: T.units.g, ml: T.units.ml, ud: T.units.ud };
  }
  // a mode's option text: "huevos (~50 g)", "plátanos medianos (~120 g)"; g / ml as their unit word
  function basicModeText(b, mode) {
    if (mode !== 'piece') return T.units[mode] || mode;
    var pc = b.pc;
    if (!pc) return T.units.ud;
    var unit = b.u === 'ud' ? 'g' : b.u;
    var w = pieceWeight(b, unit);
    return w ? format(T.sheet.pieceOpt, { name: pc.m, w: nf(w) + ' ' + T.units[unit] }) : pc.m;
  }
  // a mode's amount parser units (a piece is a count) and its prefill: ONE piece, else 100 g / ml
  function modeUnits(mode) { return mode === 'piece' ? null : [mode]; }
  function modeDefault(mode) { return mode === 'piece' ? '1' : '100'; }
  function basicPickHtml(b) {
    var modes = basicModes(b);
    var per = { kcal: b.m[0], protein: b.m[1], carbs: b.m[2], fat: b.m[3] };
    S.sheet.basicMode = modes[0];
    return '<div class="fa-pick"><div class="fa-pick-top"><div><div class="fa-item-name">' + esc(b.n) + '</div>' +
      '<div class="fa-item-sub">' + macroLine(per) + ' ' + esc(basicSub(b)) + '</div></div>' +
      '<button type="button" class="food-btn food-btn-ghost" data-food-act="unpick">' + esc(T.sheet.change) + '</button></div>' +
      '<div class="food-row">' + numField('fa-amt', T.sheet.amount, modeDefault(modes[0])) +
      field('fa-unit', T.sheet.unit, '<select class="food-in" id="fa-unit">' + modes.map(function (u, i) {
        return '<option value="' + u + '"' + (i === 0 ? ' selected' : '') + '>' + esc(basicModeText(b, u)) + '</option>';
      }).join('') + '</select>') + '</div>' +
      '<p class="fa-prev" id="fa-prev" aria-live="polite"></p>' +
      '<p class="food-note">' + esc(b.v ? T.sheet.basicLabelNote : T.sheet.basicNote) + '</p>' +
      '<button type="button" class="food-btn" id="fa-save" data-food-act="save">' + esc(T.sheet.save) + '</button></div>';
  }
  // pieces <-> grams keeps the same food: the typed amount converted, else the new mode's prefill
  function switchBasicMode() {
    var sh = S.sheet, b = pickedItem();
    var to = val('fa-unit');
    if (!b || basicModes(b).indexOf(to) < 0) return;
    var from = sh.basicMode || to;
    var v = basicConvert(b, parseNum(val('fa-amt'), modeUnits(from)), from, to);
    var el = $('fa-amt');
    if (el && from !== to) el.value = v != null ? nf(v) : modeDefault(to);
    sh.basicMode = to;
  }
  // the units a picked item can be logged in: a product in its own unit (+ servings when it states a
  // serving size), a per-serving recipe in servings, a batch recipe in grams of cooked food
  function unitsOf(kind, item) {
    if (kind === 'recipe') return item.kind === 'serving' ? ['serving'] : ['g'];
    return item.servingSize > 0 ? [item.unit, 'serving'] : [item.unit];
  }
  function errSlot(id) { return '<small class="food-err" id="' + id + '-err"></small>'; }
  function field(id, label, input) {
    return '<div class="food-field"><label class="food-lbl" for="' + id + '">' + esc(label) + '</label>' + input + errSlot(id) + '</div>';
  }
  /** a numeric field: label, the input with its unit as a visible suffix (o.unit; '' = an empty suffix a
   * later choice fills, undefined = none), an optional placeholder (o.ph), the "missing in Open Food
   * Facts" hint (o.miss) and the inline error slot; the input is described by all of them */
  function numField(id, label, value, o) {
    o = o || {};
    var hasUnit = o.unit != null;
    var desc = (hasUnit ? id + '-unit ' : '') + (o.miss ? id + '-miss ' : '') + id + '-err';
    return '<div class="food-field' + (o.miss ? ' is-missing' : '') + '"><label class="food-lbl" for="' + id + '">' + esc(label) + '</label>' +
      '<div class="food-in-wrap"><input class="food-in" id="' + id + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(value == null ? '' : value) + '"' +
      (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + ' aria-describedby="' + desc + '">' +
      (hasUnit ? '<span class="food-suffix" id="' + id + '-unit">' + esc(o.unit) + '</span>' : '') + '</div>' +
      (o.miss ? '<small class="food-miss" id="' + id + '-miss">' + esc(o.miss) + '</small>' : '') + errSlot(id) + '</div>';
  }
  function pickHtml() {
    var pk = S.sheet.pick, item = pickedItem();
    if (!item) return '';
    if (pk.kind === 'basic') return basicPickHtml(item);
    var units = unitsOf(pk.kind, item);
    var sub = pk.kind === 'recipe'
      ? (item.kind === 'serving' ? T.sheet.perServing : T.sheet.per100Cooked)
      : format(T.sheet.per100, { unit: T.units[item.unit] }) + (item.servingSize > 0 ? ' · ' + format(T.sheet.serving, { n: nf(item.servingSize), unit: T.units[item.unit] }) : '');
    var m = pk.kind === 'recipe' ? (item.kind === 'serving' ? item.perServing : item.per100) : item.per100;
    return '<div class="fa-pick"><div class="fa-pick-top"><div><div class="fa-item-name">' + esc(item.name) + '</div>' +
      '<div class="fa-item-sub">' + (m ? macroLine(m) + ' ' : '') + esc(sub) + '</div></div>' +
      '<button type="button" class="food-btn food-btn-ghost" data-food-act="unpick">' + esc(T.sheet.change) + '</button></div>' +
      '<div class="food-row">' + numField('fa-amt', T.sheet.amount, units[0] === 'serving' ? '1' : '') +
      field('fa-unit', T.sheet.unit, '<select class="food-in" id="fa-unit">' + units.map(function (u, i) {
        return '<option value="' + u + '"' + (i === 0 ? ' selected' : '') + '>' + esc(T.units[u]) + '</option>';
      }).join('') + '</select>') + '</div>' +
      '<p class="fa-prev" id="fa-prev" aria-live="polite"></p>' +
      '<button type="button" class="food-btn" id="fa-save" data-food-act="save">' + esc(T.sheet.save) + '</button></div>';
  }
  function quickHtml() {
    return '<div class="fa-quick">' + field('fa-label', T.sheet.label, '<input class="food-in" id="fa-label" type="text" maxlength="' + LIM.nameMax + '" autocomplete="off">') +
      '<div class="food-row">' + numField('fa-kcal', T.sheet.kcal, '', { unit: T.kcal }) + '</div>' +
      '<div class="food-row food-row-3">' + numField('fa-p', T.sheet.protein, '', { unit: T.units.g }) + numField('fa-c', T.sheet.carbs, '', { unit: T.units.g }) +
      numField('fa-f', T.sheet.fat, '', { unit: T.units.g }) + '</div>' +
      '<p class="food-note">' + esc(T.sheet.quickNote) + '</p>' +
      '<button type="button" class="food-btn" id="fa-save" data-food-act="save">' + esc(T.sheet.save) + '</button></div>';
  }
  function panelHtml() {
    var sh = S.sheet;
    if (sh.tab === 'quick') return quickHtml();
    if (sh.tab === 'plan') return planHtml();
    if (sh.pick) return pickHtml();
    var search = sh.tab === 'products' && (S.products.length || BASICS.length)
      ? field('fa-q', T.sheet.search, '<input class="food-in" id="fa-q" type="search" autocomplete="off" placeholder="' + esc(T.sheet.searchPh) + '" value="' + esc(sh.q) + '">')
      : '';
    return search + '<div id="fa-list" class="fa-list">' + listHtml() + '</div>';
  }
  function tabsHtml() {
    return '<div class="fa-tabs" role="group" aria-label="' + esc(T.sheet.tabsLabel) + '">' + tabKeys().map(function (k) {
      return '<button type="button" class="fa-tab" data-food-act="tab" data-tab="' + k + '" aria-pressed="' + (S.sheet.tab === k) + '">' + esc(T.sheet.tabs[k]) + '</button>';
    }).join('') + '</div>';
  }
  function renderSheet() {
    S.sheet = newSheet(pendingMeal);
    pendingMeal = null;
    var sh = S.sheet;
    var meals = '<select class="food-in" id="fa-meal">' + GROUPS.map(function (m) {
      return '<option value="' + m + '"' + (m === sh.meal ? ' selected' : '') + '>' + esc(T.groupOption[m]) + '</option>';
    }).join('') + '</select>';
    return {
      head: '',
      body: '<div class="fa">' + field('fa-meal', T.sheet.meal, meals) + tabsHtml() +
        '<div id="fa-panel" class="fa-panel">' + panelHtml() + '</div>' +
        '<p class="food-msg" id="fa-msg" role="status" aria-live="polite"></p></div>',
    };
  }
  function redrawPanel(focusId) {
    S.sheet.reqId = null; // another item or tab: a new add
    setHtml('fa-panel', panelHtml());
    var tabs = document.querySelectorAll ? document.querySelectorAll('.fa-tab') : [];
    for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute('aria-pressed', String(tabs[i].getAttribute('data-tab') === S.sheet.tab));
    setText('fa-msg', '');
    if (focusId) focus(focusId);
  }
  function sheetPreview() {
    var pk = S.sheet && S.sheet.pick, item = pickedItem();
    if (!item) return null;
    if (pk.kind === 'basic') {
      var mode = val('fa-unit') || S.sheet.basicMode || basicModes(item)[0];
      var n = parseNum(val('fa-amt'), modeUnits(mode));
      return { amount: n, unit: mode, m: basicEntry(item, n, mode), label: basicLabel(item, n, mode, basicWords()) };
    }
    var unit = val('fa-unit') || unitsOf(pk.kind, item)[0];
    var amount = parseNum(val('fa-amt'), unit === 'serving' ? null : [unit]);
    if (pk.kind === 'product') return { amount: amount, unit: unit, m: productEntry(item, amount, unit) };
    // the recipe's basis from the listed products; when one of them is archived (not listed), the
    // server's computed basis on the recipe row (the server still has the product)
    var b = recipeBasis(item, byId(S.products));
    return { amount: amount, unit: unit, m: entryFromBasis(b.complete ? b : item, item.kind, amount, unit) };
  }
  function updatePreview() {
    if (S.sheet && S.sheet.tab === 'plan') {
      var e = planEntry();
      setHtml('fa-prev', e ? macroLine(e) : '');
      return;
    }
    var p = sheetPreview();
    setHtml('fa-prev', p && p.m ? (p.label ? '<span class="fa-prev-lbl">' + esc(p.label) + '</span> ' : '') + macroLine(p.m) : '');
  }
  // a basic entry over what one quick entry may hold (the server's quick limits, or the amount cap)
  function tooBig(p) {
    if (p.amount > (LIM.amountMax || 5000) || p.m.kcal > (LIM.quickKcalMax || 5000)) return true;
    return MACROS.some(function (k) { return p.m[k] > (LIM.quickMacroMax || 500); });
  }
  function sheetMsg(s, force) {
    var el = $('fa-msg');
    if (!el) return;
    if (force) el.innerHTML = esc(s) + ' <button type="button" class="food-btn food-btn-ghost" data-food-act="save-force">' + esc(T.sheet.saveAnyway) + '</button>';
    else el.textContent = s;
  }
  var SHEET_FIELDS = { amount: 'fa-amt', label: 'fa-label', kcal: 'fa-kcal', protein: 'fa-p', carbs: 'fa-c', fat: 'fa-f' };
  var SHEET_IDS = ['fa-amt', 'fa-label', 'fa-kcal', 'fa-p', 'fa-c', 'fa-f'];
  function saveSheet(force) {
    var sh = S.sheet;
    if (!sh || sh.busy) return;
    var group = asGroup(val('fa-meal')) || sh.meal;
    var meal = slotFor(group, sh.tab === 'plan' && sh.plan ? sh.plan[sh.planMeal] : null);
    var date = HC.todayIso();
    var body;
    clearErrs(SHEET_IDS);
    if (sh.tab === 'quick') {
      var label = val('fa-label').replace(/\s+/g, ' ').trim();
      var kcal = parseNum(val('fa-kcal'), ['kcal']);
      var errs = [];
      if (!label) errs.push({ id: 'fa-label', key: 'label', kind: 'required' });
      var kk = numKind(kcal, true, false);
      if (kk) errs.push({ id: 'fa-kcal', key: 'kcal', kind: kk });
      body = { date: date, meal: meal, refType: 'quick', label: label, kcal: kcal };
      [['protein', 'fa-p'], ['carbs', 'fa-c'], ['fat', 'fa-f']].forEach(function (x) {
        var v = parseNum(val(x[1]), ['g']);
        var k = numKind(v, false, false);
        if (k) errs.push({ id: x[1], key: x[0], kind: k });
        else if (v != null) body[x[0]] = v;
      });
      if (errs.length) { sheetMsg(showErrs(errs)); return; }
    } else if (sh.tab === 'plan') {
      var pe = planEntry();
      if (!pe) { sheetMsg(T.errors.generic); return; }
      body = { date: date, meal: meal, refType: 'quick', label: pe.label, kcal: pe.kcal };
      MACROS.forEach(function (k) { if (pe[k] != null) body[k] = pe[k]; });
    } else {
      var p = sheetPreview();
      if (!p || !p.m) {
        var ak = p ? numKind(p.amount, true, true) : null;
        fieldErr('fa-amt', T.fieldErrors[ak] || T.sheet.previewNone);
        focus('fa-amt');
        sheetMsg(T.sheet.previewNone);
        return;
      }
      if (sh.pick.kind === 'basic') {
        // a basic is ONE quick entry: its four macros computed here, the amount named in the label
        if (tooBig(p)) { sheetMsg(showErrs([{ id: 'fa-amt', key: 'amount', kind: 'tooBig' }])); return; }
        body = { date: date, meal: meal, refType: 'quick', label: p.label, kcal: p.m.kcal, protein: p.m.protein, carbs: p.m.carbs, fat: p.m.fat };
      } else {
        body = { date: date, meal: meal, refType: sh.pick.kind, refId: Number(sh.pick.id), amount: p.amount, unit: p.unit };
      }
    }
    if (force) body.force = true;
    sh.reqId = sh.reqId || newRequestId();
    body.requestId = sh.reqId;
    sh.busy = true;
    var btn = $('fa-save');
    if (btn) btn.disabled = true;
    api('POST', '/log', body).then(function (data) {
      sh.busy = false;
      sh.reqId = null;
      var e = data.entry;
      if (S.log && S.log.date === date && e) {
        // a replayed add (same request id) may already be in the list from a re-read: replace it
        S.log.entries = S.log.entries.filter(function (x) { return String(x.id) !== String(e.id); }).concat([e]);
        S.log.totals = data.totals || dayTotals(S.log.entries);
      }
      if (window.HCDetail && typeof window.HCDetail.close === 'function') window.HCDetail.close();
      renderLog();
      refreshDependents();
      setText('food-msg', e ? format(T.added, { label: e.label, k: kf(e.kcal) }) : '');
      focus('food-add-' + meal);
      if (!S.log || S.log.date !== date) loadLog();
    }, function (err) {
      sh.busy = false;
      if (btn) btn.disabled = false;
      sheetMsg(errText(err), err && err.code === 'atwater');
      serverFieldErr(err, SHEET_FIELDS);
      // it may have been saved after all: show the server's list (the retry keeps the same id)
      if (ambiguous(err)) loadLog();
    });
  }

  /* ---------- Mis productos ---------- */
  var PF = [['fpf-kcal', 'kcal', 'per100.kcal'], ['fpf-p', 'protein', 'per100.protein'], ['fpf-c', 'carbs', 'per100.carbs'], ['fpf-f', 'fat', 'per100.fat']];
  function productRow(p) {
    var name = p.name;
    var armed = S.confirm === 'p:' + p.id;
    return '<li class="fp-item"><div class="fp-main"><span class="fe-label">' + esc(name) + (p.brand ? ' <span class="fa-item-brand">' + esc(p.brand) + '</span>' : '') + '</span>' +
      '<span class="fe-pcf">' + macroLine(p.per100) + ' ' + esc(format(T.products.per100, { unit: T.units[p.unit] })) +
      (p.servingSize > 0 ? ' · ' + esc(format(T.products.serving, { n: nf(p.servingSize), unit: T.units[p.unit] })) : '') + '</span></div>' +
      '<div class="fp-acts"><button type="button" class="food-btn food-btn-ghost" data-food-act="p-edit" data-id="' + esc(p.id) + '" aria-label="' + esc(format(T.products.editAria, { name: name })) + '">' + esc(T.products.edit) + '</button>' +
      (armed
        ? '<button type="button" class="food-btn food-btn-warn" data-food-act="p-archive-ok" data-id="' + esc(p.id) + '" aria-label="' + esc(format(T.products.confirmAria, { name: name })) + '">' + esc(T.products.confirm) + '</button>'
        : '<button type="button" class="food-btn food-btn-ghost" data-food-act="p-archive" data-id="' + esc(p.id) + '" aria-label="' + esc(format(T.products.archiveAria, { name: name })) + '">' + esc(T.products.archive) + '</button>') +
      '</div></li>';
  }
  function productListHtml() {
    if (!S.products.length) return '<p class="food-note">' + esc(T.products.empty) + '</p>';
    return K.stores.map(function (s) {
      var list = S.products.filter(function (p) { return p.store === s; });
      if (!list.length) return '';
      return '<h3 class="fp-store">' + esc(T.stores[s]) + '</h3><ul class="fp-list">' + list.map(productRow).join('') + '</ul>';
    }).join('');
  }
  function offCardHtml(r, i) {
    var P = r.per100 || {};
    var cell = function (label, v) {
      return '<span class="' + (v == null ? 'is-missing' : '') + '">' + esc(label) + ' ' + (v == null ? esc(T.products.missingShort) : esc(nf(v))) + '</span>';
    };
    return '<li class="off-card"><div class="fe-label">' + esc(r.name || r.code) + (r.brand ? ' <span class="fa-item-brand">' + esc(r.brand) + '</span>' : '') + '</div>' +
      (r.stores ? '<div class="fa-item-sub">' + esc(r.stores) + '</div>' : '') +
      '<div class="off-vals">' + cell(T.kcal, P.kcal) + cell(T.macroAbbr.p, P.protein) + cell(T.macroAbbr.c, P.carbs) + cell(T.macroAbbr.f, P.fat) +
      ' <span class="fa-item-sub">' + esc(format(T.products.per100, { unit: T.units[r.unit] || r.unit })) + '</span></div>' +
      '<button type="button" class="food-btn food-btn-ghost" data-food-act="p-use" data-i="' + i + '">' + esc(T.products.use) + '</button></li>';
  }
  function productFormHtml() {
    var f = S.pform.form || {};
    var miss = S.pform.missing || {};
    var opt = function (list, cur, labels) {
      return list.map(function (v) { return '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + esc(labels[v]) + '</option>'; }).join('');
    };
    var unit = f.unit === 'ml' ? 'ml' : 'g';
    var pf = function (id, label, key, o) {
      o = o || {};
      if (miss[key]) o.miss = T.products.offMissing;
      return numField(id, label, f[key], o);
    };
    var F = T.products.form;
    return '<div class="fp-form">' +
      (S.pform.source === 'off' ? '<p class="food-note">' + esc(T.products.offIntro) + '</p>' : '') +
      field('fpf-name', F.name, '<input class="food-in" id="fpf-name" type="text" maxlength="' + LIM.nameMax + '" autocomplete="off" value="' + esc(f.name || '') + '">') +
      field('fpf-brand', F.brand, '<input class="food-in" id="fpf-brand" type="text" maxlength="' + LIM.brandMax + '" autocomplete="off" value="' + esc(f.brand || '') + '">') +
      '<div class="food-row">' + field('fpf-store', F.store, '<select class="food-in" id="fpf-store">' + opt(K.stores, f.store || 'mercadona', T.stores) + '</select>') +
      field('fpf-unit', F.unit, '<select class="food-in" id="fpf-unit">' + opt(K.units, f.unit || 'g', T.units) + '</select>') + '</div>' +
      field('fpf-code', F.barcode, '<input class="food-in" id="fpf-code" type="text" inputmode="numeric" maxlength="14" autocomplete="off" value="' + esc(f.barcode || '') + '">') +
      '<div class="food-row food-row-2">' + pf('fpf-kcal', F.kcal, 'kcal', { unit: T.kcal }) + pf('fpf-p', F.protein, 'protein', { unit: T.units.g }) +
      pf('fpf-c', F.carbs, 'carbs', { unit: T.units.g }) + pf('fpf-f', F.fat, 'fat', { unit: T.units.g }) + '</div>' +
      '<div class="food-row">' + pf('fpf-serv', F.serving, 'servingSize', { unit: T.units[unit], ph: F.servingPh }) + '</div>' +
      '<div class="food-btns"><button type="button" class="food-btn" id="fp-save" data-food-act="p-save">' + esc(T.products.save) + '</button>' +
      '<button type="button" class="food-btn food-btn-ghost" data-food-act="p-cancel">' + esc(T.products.cancel) + '</button></div>' +
      formMsgHtml('fp-form-msg') + '</div>';
  }
  function productSearchHtml() {
    var P = T.products;
    return '<div class="fp-search"><div class="food-row">' +
      field('fp-code', P.barcode, '<input class="food-in" id="fp-code" type="text" inputmode="numeric" maxlength="14" autocomplete="off">') +
      '<button type="button" class="food-btn food-btn-ghost food-btn-end" data-food-act="p-code">' + esc(P.barcodeBtn) + '</button></div>' +
      '<div class="food-row">' + field('fp-q', P.query, '<input class="food-in" id="fp-q" type="search" maxlength="' + LIM.queryMax + '" autocomplete="off">') +
      '<button type="button" class="food-btn food-btn-ghost food-btn-end" data-food-act="p-search">' + esc(P.queryBtn) + '</button></div>' +
      '<ul class="off-results" id="fp-results" aria-live="polite"></ul>' +
      '<div class="food-btns"><button type="button" class="food-btn food-btn-ghost" data-food-act="p-label">' + esc(P.fromLabel) + '</button>' +
      '<button type="button" class="food-btn food-btn-ghost" data-food-act="p-cancel">' + esc(P.cancel) + '</button></div>' +
      formMsgHtml('fp-form-msg') + '</div>';
  }
  // a form's own status line, right under its buttons (save results stay announced: role="status")
  function formMsgHtml(id) {
    return '<p class="food-msg" id="' + id + '" role="status" aria-live="polite"></p>';
  }
  function renderProducts() {
    var host = $('fp-body');
    if (!host) return;
    try {
      var top = !S.pform
        ? '<div class="food-btns"><button type="button" class="food-btn" data-food-act="p-new">' + esc(T.products.add) + '</button></div>'
        : S.pform.mode === 'form' ? productFormHtml() : productSearchHtml();
      host.innerHTML = top + '<div class="fp-all">' + productListHtml() + '</div>';
    } catch (e) {
      host.innerHTML = '<p class="food-note">' + esc(T.errors.generic) + '</p>';
    }
  }
  /** one status line per section: inside the open form / search panel (formId, next to its buttons),
   * else the section's own line (listId, above the list); the other one is cleared. `force` = the
   * "save anyway" action (data-food-act) next to the text */
  function sectionMsg(formId, listId, open, s, force, forceLabel) {
    var el = open ? $(formId) || $(listId) : $(listId);
    var other = el === $(listId) ? $(formId) : $(listId);
    if (other) other.textContent = '';
    if (!el) return;
    if (force) el.innerHTML = esc(s) + ' <button type="button" class="food-btn food-btn-ghost" data-food-act="' + force + '">' + esc(forceLabel) + '</button>';
    else el.textContent = s;
  }
  function prodMsg(s, force) {
    sectionMsg('fp-form-msg', 'fp-msg', !!S.pform, s, force ? 'p-save-force' : null, T.products.saveAnyway);
  }
  function openProductForm(source, form, missing, editId, offCode) {
    S.pform = { mode: 'form', source: source, form: form || {}, missing: missing || {}, editId: editId || null, offCode: offCode || null };
    renderProducts();
    prodMsg('');
    focus('fpf-name');
  }
  function offLookup(kind) {
    var q = kind === 'code' ? val('fp-code').replace(/\s+/g, '') : val('fp-q').replace(/\s+/g, ' ').trim();
    if (kind === 'code' && !BARCODE_RE.test(q)) { prodMsg(format(T.errors.invalid, { field: T.fields.barcode })); return; }
    if (kind === 'q' && (q.length < LIM.queryMin || q.length > LIM.queryMax)) { prodMsg(format(T.errors.invalid, { field: T.fields.name })); return; }
    prodMsg(T.products.searching);
    api('GET', '/off?' + (kind === 'code' ? 'barcode=' : 'q=') + encodeURIComponent(q)).then(function (data) {
      var list = kind === 'code' ? (data.product ? [data.product] : []) : data.results || [];
      S.pform.results = list;
      setHtml('fp-results', list.length ? list.map(offCardHtml).join('') : '<li class="food-note">' + esc(T.products.noResults) + '</li>');
      prodMsg('');
    }, function (err) {
      prodMsg(errText(err));
    });
  }
  function useOff(i) {
    var r = S.pform && S.pform.results && S.pform.results[i];
    if (!r) return;
    var P = r.per100 || {};
    var missing = { kcal: P.kcal == null, protein: P.protein == null, carbs: P.carbs == null, fat: P.fat == null };
    var store = /mercadona/i.test(r.stores || '') ? 'mercadona' : /\bdia\b/i.test(r.stores || '') ? 'dia' : /eroski/i.test(r.stores || '') ? 'eroski' : 'other';
    openProductForm('off', {
      name: r.name || '', brand: r.brand || '', store: store, unit: r.unit === 'ml' ? 'ml' : 'g', barcode: BARCODE_RE.test(r.code || '') ? r.code : '',
      kcal: P.kcal, protein: P.protein, carbs: P.carbs, fat: P.fat, servingSize: r.servingSize,
    }, missing, null, /^[0-9]{1,14}$/.test(r.code || '') ? r.code : null);
  }
  // every invalid field at once ({errs: [{id, key, kind}]}), else {body}
  function readProductForm() {
    var errs = [];
    var name = val('fpf-name').replace(/\s+/g, ' ').trim();
    if (!name) errs.push({ id: 'fpf-name', key: 'name', kind: 'required' });
    var body = { name: name, store: val('fpf-store'), unit: val('fpf-unit'), per100: {}, source: S.pform.source };
    var brand = val('fpf-brand').replace(/\s+/g, ' ').trim();
    if (brand) body.brand = brand;
    var code = val('fpf-code').replace(/\s+/g, '');
    if (code) {
      if (!BARCODE_RE.test(code)) errs.push({ id: 'fpf-code', key: 'barcode', kind: 'invalid' });
      body.barcode = code;
    }
    // body key order: name, brand, store, barcode, unit, per100, servingSize, source, offCode
    var ordered = { name: body.name };
    if (body.brand) ordered.brand = body.brand;
    ordered.store = body.store;
    if (body.barcode) ordered.barcode = body.barcode;
    ordered.unit = body.unit;
    ordered.per100 = {};
    for (var i = 0; i < PF.length; i++) {
      var v = parseNum(val(PF[i][0]), [PF[i][1] === 'kcal' ? 'kcal' : 'g']);
      var k = numKind(v, true, false);
      if (k) errs.push({ id: PF[i][0], key: PF[i][2], kind: k });
      else ordered.per100[PF[i][1]] = v;
    }
    // optional: empty or a bare unit ("g") = no serving size
    var serv = parseNum(val('fpf-serv'), [body.unit]);
    var sk = numKind(serv, false, true);
    if (sk) errs.push({ id: 'fpf-serv', key: 'servingSize', kind: sk });
    else if (serv != null) ordered.servingSize = serv;
    ordered.source = body.source;
    if (S.pform.offCode) ordered.offCode = S.pform.offCode;
    return errs.length ? { errs: errs } : { body: ordered };
  }
  var PRODUCT_FIELDS = { name: 'fpf-name', brand: 'fpf-brand', barcode: 'fpf-code', store: 'fpf-store', unit: 'fpf-unit', 'per100.kcal': 'fpf-kcal', 'per100.protein': 'fpf-p', 'per100.carbs': 'fpf-c', 'per100.fat': 'fpf-f', servingSize: 'fpf-serv' };
  var PRODUCT_IDS = Object.keys(PRODUCT_FIELDS).map(function (k) { return PRODUCT_FIELDS[k]; });
  function saveProduct(force) {
    if (!S.pform || S.pform.busy) return;
    clearErrs(PRODUCT_IDS);
    var r = readProductForm();
    if (r.errs) { prodMsg(showErrs(r.errs)); return; }
    if (force) r.body.force = true;
    var edit = S.pform.editId;
    S.pform.busy = true;
    api(edit ? 'PUT' : 'POST', edit ? '/products/' + encodeURIComponent(edit) : '/products', r.body).then(function (data) {
      var p = data.product;
      if (p) S.products = S.products.filter(function (x) { return String(x.id) !== String(p.id); }).concat([p]);
      S.products.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      S.pform = null;
      renderProducts();
      prodMsg(T.products.saved);
    }, function (err) {
      S.pform.busy = false;
      prodMsg(errText(err), err && err.code === 'atwater');
      serverFieldErr(err, PRODUCT_FIELDS);
    });
  }
  function editProduct(id) {
    var p = find(S.products, id);
    if (!p) return;
    openProductForm(p.source, {
      name: p.name, brand: p.brand || '', store: p.store, unit: p.unit, barcode: p.barcode || '',
      kcal: p.per100.kcal, protein: p.per100.protein, carbs: p.per100.carbs, fat: p.per100.fat, servingSize: p.servingSize,
    }, null, p.id, p.offCode);
  }
  function archive(kind, id) {
    var isP = kind === 'p';
    api('DELETE', (isP ? '/products/' : '/recipes/') + encodeURIComponent(id)).then(function () {
      S.confirm = null;
      if (isP) {
        S.products = S.products.filter(function (x) { return String(x.id) !== String(id); });
        renderProducts();
        setText('fp-msg', T.products.archived); // about the list, not the open form
        renderRecipes(); // a recipe editor lists products
      } else {
        S.recipes = S.recipes.filter(function (x) { return String(x.id) !== String(id); });
        renderRecipes();
        setText('fr-msg', T.recipes.archived);
      }
    }, function (err) {
      S.confirm = null;
      if (isP) { renderProducts(); setText('fp-msg', errText(err)); } else { renderRecipes(); setText('fr-msg', errText(err)); }
    });
  }

  /* ---------- Mis recetas ---------- */
  function recMsg(s) { sectionMsg('fr-form-msg', 'fr-msg', !!S.rform, s, null, ''); }
  function recipeRow(r) {
    var b = r.kind === 'serving' ? r.perServing : r.per100;
    var basis = r.kind === 'serving' ? T.recipes.perServing : T.recipes.per100;
    var armed = S.confirm === 'r:' + r.id;
    return '<li class="fp-item"><div class="fp-main"><span class="fe-label">' + esc(r.name) + '</span>' +
      '<span class="fe-pcf">' + (r.complete && b ? esc(basis) + ': ' + macroLine(b) : esc(T.sheet.incomplete)) + ' · ' + esc(format(T.recipes.count, { n: r.ingredients.length })) + '</span></div>' +
      '<div class="fp-acts"><button type="button" class="food-btn food-btn-ghost" data-food-act="r-edit" data-id="' + esc(r.id) + '" aria-label="' + esc(format(T.recipes.editAria, { name: r.name })) + '">' + esc(T.recipes.edit) + '</button>' +
      (armed
        ? '<button type="button" class="food-btn food-btn-warn" data-food-act="r-archive-ok" data-id="' + esc(r.id) + '" aria-label="' + esc(format(T.recipes.confirmAria, { name: r.name })) + '">' + esc(T.recipes.confirm) + '</button>'
        : '<button type="button" class="food-btn food-btn-ghost" data-food-act="r-archive" data-id="' + esc(r.id) + '" aria-label="' + esc(format(T.recipes.archiveAria, { name: r.name })) + '">' + esc(T.recipes.archive) + '</button>') +
      '</div></li>';
  }
  function recipeFormHtml() {
    var f = S.rform, R = T.recipes;
    var kinds = ['serving', 'batch'].map(function (k) { return '<option value="' + k + '"' + (k === f.kind ? ' selected' : '') + '>' + esc(R.kinds[k]) + '</option>'; }).join('');
    var rows = f.rows.map(function (row, i) {
      var n = i + 1;
      var opts = '<option value="">' + esc(R.pick) + '</option>' + S.products.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (String(p.id) === String(row.productId) ? ' selected' : '') + '>' + esc(p.name + (p.brand ? ' · ' + p.brand : '')) + ' (' + esc(T.units[p.unit]) + ')</option>';
      }).join('');
      return '<div class="fr-ing">' + field('frf-ing-' + i, format(R.ingredient, { n: n }), '<select class="food-in" id="frf-ing-' + i + '">' + opts + '</select>') +
        numField('frf-amt-' + i, format(R.amount, { n: n }), row.amount, { unit: rowUnit(row) ? T.units[rowUnit(row)] : '' }) +
        '<button type="button" class="food-icon-btn" data-food-act="r-del-ing" data-i="' + i + '" aria-label="' + esc(format(R.removeAria, { n: n })) + '">' + DEL_SVG + '</button></div>';
    }).join('');
    return '<div class="fp-form">' +
      field('frf-name', R.name, '<input class="food-in" id="frf-name" type="text" maxlength="' + LIM.nameMax + '" autocomplete="off" value="' + esc(f.name || '') + '">') +
      '<div class="food-row">' + field('frf-kind', R.kind, '<select class="food-in" id="frf-kind">' + kinds + '</select>') +
      (f.kind === 'serving'
        ? numField('frf-serv', R.servings, f.servings)
        : numField('frf-cooked', R.cooked, f.cooked, { unit: T.units.g })) + '</div>' +
      '<h4 class="fa-store">' + esc(R.ingredients) + '</h4>' + rows +
      '<div class="food-btns"><button type="button" class="food-btn food-btn-ghost" data-food-act="r-add-ing">' + esc(R.addIngredient) + '</button></div>' +
      '<p class="fa-prev" id="frf-prev" aria-live="polite"></p>' +
      '<div class="food-btns"><button type="button" class="food-btn" data-food-act="r-save">' + esc(R.save) + '</button>' +
      '<button type="button" class="food-btn food-btn-ghost" data-food-act="r-cancel">' + esc(R.cancel) + '</button></div>' +
      formMsgHtml('fr-form-msg') + '</div>';
  }
  // the unit of an ingredient row's product (g / ml), null until one is picked
  function rowUnit(row) {
    var p = row && row.productId !== '' && row.productId != null ? find(S.products, row.productId) : null;
    return p ? p.unit : null;
  }
  function renderRecipes() {
    var host = $('fr-body');
    if (!host) return;
    try {
      var top;
      if (S.rform) top = recipeFormHtml();
      else if (!S.products.length) top = '<p class="food-note">' + esc(T.recipes.needProducts) + '</p>';
      else top = '<div class="food-btns"><button type="button" class="food-btn" data-food-act="r-new">' + esc(T.recipes.add) + '</button></div>';
      var list = S.recipes.length ? '<ul class="fp-list">' + S.recipes.map(recipeRow).join('') + '</ul>' : '<p class="food-note">' + esc(T.recipes.empty) + '</p>';
      host.innerHTML = top + '<div class="fp-all">' + list + '</div>';
      if (S.rform) updateRecipePreview();
    } catch (e) {
      host.innerHTML = '<p class="food-note">' + esc(T.errors.generic) + '</p>';
    }
  }
  // the editor's state from its inputs (the DOM is the source while it is open)
  function syncRecipeForm() {
    var f = S.rform;
    if (!f) return;
    if ($('frf-name')) f.name = val('frf-name');
    if ($('frf-kind')) f.kind = val('frf-kind') === 'batch' ? 'batch' : 'serving';
    if ($('frf-serv')) f.servings = val('frf-serv');
    if ($('frf-cooked')) f.cooked = val('frf-cooked');
    f.rows.forEach(function (row, i) {
      if ($('frf-ing-' + i)) row.productId = val('frf-ing-' + i);
      if ($('frf-amt-' + i)) row.amount = val('frf-amt-' + i);
    });
  }
  function recipeFromForm() {
    var f = S.rform;
    var r = { name: String(f.name || '').replace(/\s+/g, ' ').trim(), kind: f.kind };
    if (f.kind === 'serving') r.servings = parseNum(f.servings, null);
    else r.cookedWeightG = parseNum(f.cooked, ['g']);
    r.ingredients = f.rows.map(function (row) {
      var u = rowUnit(row);
      return { productId: row.productId === '' || row.productId == null ? null : Number(row.productId), amount: parseNum(row.amount, u ? [u] : ['g', 'ml']) };
    });
    return r;
  }
  function updateRecipePreview() {
    syncRecipeForm();
    S.rform.rows.forEach(function (row, i) { setText('frf-amt-' + i + '-unit', rowUnit(row) ? T.units[rowUnit(row)] : ''); });
    var r = recipeFromForm();
    var b = recipeBasis(r, byId(S.products));
    var m = r.kind === 'serving' ? b.perServing : b.per100;
    setHtml('frf-prev', b.complete && m
      ? esc(r.kind === 'serving' ? T.recipes.perServing : T.recipes.per100) + ': ' + macroLine(roundMacros(m))
      : esc(T.recipes.previewNone));
  }
  function openRecipeForm(r) {
    S.rform = r
      ? { editId: r.id, name: r.name, kind: r.kind, servings: r.servings == null ? '' : String(r.servings), cooked: r.cookedWeightG == null ? '' : String(r.cookedWeightG), rows: r.ingredients.map(function (i) { return { productId: String(i.productId), amount: String(i.amount) }; }) }
      : { editId: null, name: '', kind: 'serving', servings: '1', cooked: '', rows: [{ productId: '', amount: '' }] };
    renderRecipes();
    recMsg('');
    focus('frf-name');
  }
  function saveRecipe() {
    var f = S.rform;
    if (!f || f.busy) return;
    syncRecipeForm();
    var r = recipeFromForm();
    var ids = ['frf-name', 'frf-serv', 'frf-cooked'];
    f.rows.forEach(function (row, i) { ids.push('frf-ing-' + i, 'frf-amt-' + i); });
    clearErrs(ids);
    var errs = [];
    if (!r.name) errs.push({ id: 'frf-name', key: 'name', kind: 'required' });
    if (r.kind === 'serving') {
      var sk = numKind(r.servings, true, true) || (r.servings === Math.round(r.servings) ? null : 'whole');
      if (sk) errs.push({ id: 'frf-serv', key: 'servings', kind: sk });
    } else {
      var ck = numKind(r.cookedWeightG, true, true);
      if (ck) errs.push({ id: 'frf-cooked', key: 'cookedWeightG', kind: ck });
    }
    r.ingredients.forEach(function (ing, i) {
      if (!(ing.productId > 0)) errs.push({ id: 'frf-ing-' + i, key: 'ingredients.productId', kind: 'required' });
      var ak = numKind(ing.amount, true, true);
      if (ak) errs.push({ id: 'frf-amt-' + i, key: 'ingredients.amount', kind: ak });
    });
    if (errs.length) { recMsg(showErrs(errs)); return; }
    f.busy = true;
    api(f.editId ? 'PUT' : 'POST', f.editId ? '/recipes/' + encodeURIComponent(f.editId) : '/recipes', r).then(function (data) {
      var saved = data.recipe;
      if (saved) S.recipes = S.recipes.filter(function (x) { return String(x.id) !== String(saved.id); }).concat([saved]);
      S.recipes.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      S.rform = null;
      renderRecipes();
      recMsg(T.recipes.saved);
    }, function (err) {
      f.busy = false;
      recMsg(errText(err));
      serverFieldErr(err, { name: 'frf-name', servings: 'frf-serv', cookedWeightG: 'frf-cooked' });
    });
  }

  /* ---------- events ---------- */
  var ACTS = {
    add: function (el) {
      pendingMeal = el.getAttribute('data-meal');
      if (window.HCDetail && typeof window.HCDetail.open === 'function') window.HCDetail.open('food-add', null, { opener: el, focus: '#fa-meal' });
    },
    del: delEntry,
    tab: function (el) {
      var k = el.getAttribute('data-tab');
      if (!S.sheet || tabKeys().indexOf(k) < 0) return;
      S.sheet.tab = k;
      S.sheet.pick = null;
      redrawPanel(k === 'quick' ? 'fa-label' : k === 'products' ? 'fa-q' : k === 'plan' ? 'fa-plan-meal-' + S.sheet.planMeal : null);
      if (k === 'plan') updatePreview();
    },
    'plan-meal': function (el) {
      var sh = S.sheet, i = Number(el.getAttribute('data-i'));
      if (!sh || !sh.plan || !(i >= 0 && i < sh.plan.length)) return;
      sh.planMeal = i;
      sh.planItem = -1; // another meal: back to the whole meal
      redrawPanel('fa-plan-meal-' + i);
      updatePreview();
    },
    pick: function (el) {
      if (!S.sheet) return;
      var kind = el.getAttribute('data-kind');
      S.sheet.pick = { kind: kind === 'recipe' || kind === 'basic' ? kind : 'product', id: el.getAttribute('data-id') };
      redrawPanel('fa-amt');
      updatePreview();
    },
    unpick: function () {
      if (!S.sheet) return;
      S.sheet.pick = null;
      redrawPanel(S.sheet.tab === 'products' ? 'fa-q' : null);
    },
    save: function () { saveSheet(false); },
    'save-force': function () { saveSheet(true); },
    'p-new': function () { S.pform = { mode: 'search' }; renderProducts(); prodMsg(''); focus('fp-code'); },
    'p-code': function () { offLookup('code'); },
    'p-search': function () { offLookup('q'); },
    'p-label': function () { openProductForm('label', { store: 'mercadona', unit: 'g' }); },
    'p-use': function (el) { useOff(Number(el.getAttribute('data-i'))); },
    'p-save': function () { saveProduct(false); },
    'p-save-force': function () { saveProduct(true); },
    'p-cancel': function () { S.pform = null; renderProducts(); prodMsg(''); },
    'p-edit': function (el) { editProduct(el.getAttribute('data-id')); },
    'p-archive': function (el) { S.confirm = 'p:' + el.getAttribute('data-id'); renderProducts(); },
    'p-archive-ok': function (el) { archive('p', el.getAttribute('data-id')); },
    'r-new': function () { openRecipeForm(null); },
    'r-edit': function (el) { var r = find(S.recipes, el.getAttribute('data-id')); if (r) openRecipeForm(r); },
    'r-add-ing': function () { syncRecipeForm(); S.rform.rows.push({ productId: '', amount: '' }); renderRecipes(); focus('frf-ing-' + (S.rform.rows.length - 1)); },
    'r-del-ing': function (el) {
      syncRecipeForm();
      var i = Number(el.getAttribute('data-i'));
      if (S.rform.rows.length > 1) S.rform.rows.splice(i, 1);
      renderRecipes();
      focus('frf-ing-' + Math.max(0, Math.min(i, S.rform.rows.length - 1)));
    },
    'r-save': saveRecipe,
    'r-cancel': function () { S.rform = null; renderRecipes(); recMsg(''); },
    'r-archive': function (el) { S.confirm = 'r:' + el.getAttribute('data-id'); renderRecipes(); },
    'r-archive-ok': function (el) { archive('r', el.getAttribute('data-id')); },
  };
  function idOf(t) {
    return t && t.getAttribute ? t.getAttribute('id') || '' : '';
  }
  function onInput(e) {
    var id = idOf(e && e.target);
    if (!id) return;
    if (id === 'fa-q' && S.sheet) {
      S.sheet.q = val('fa-q');
      setHtml('fa-list', listHtml());
    } else if (id === 'fa-amt' || id === 'fa-unit') {
      if (id === 'fa-unit' && S.sheet && S.sheet.pick && S.sheet.pick.kind === 'basic') switchBasicMode();
      updatePreview();
    }
    else if (id === 'fa-meal' && S.sheet) {
      S.sheet.meal = asGroup(val('fa-meal')) || S.sheet.meal;
      // the plan tab follows the group when the plan has a meal in it
      var sh = S.sheet, i = sh.tab === 'plan' && sh.plan ? planMealFor(sh.plan, sh.meal, -1, sh.planMeal) : -1;
      if (i >= 0 && i !== sh.planMeal) {
        sh.planMeal = i;
        sh.planItem = -1;
        redrawPanel(null);
        updatePreview();
      }
    } else if (id.indexOf('fa-plan-item-') === 0 && S.sheet && S.sheet.plan) {
      var v = Number(val(id));
      var meal = S.sheet.plan[S.sheet.planMeal];
      S.sheet.planItem = meal && v >= 0 && v < (meal.items || []).length ? v : -1;
      S.sheet.reqId = null; // another item: a new add
      updatePreview();
    }
    else if (id === 'fpf-unit') setText('fpf-serv-unit', T.units[val('fpf-unit')] || ''); // the serving suffix follows "Se mide en"
    else if (id.indexOf('frf-') === 0 && S.rform) {
      if (id === 'frf-kind') { syncRecipeForm(); renderRecipes(); focus('frf-kind'); } else updateRecipePreview();
    }
  }
  document.addEventListener('click', function (e) {
    var t = e && e.target;
    var el = t && t.closest ? t.closest('[data-food-act]') : null;
    if (!el || !S.ok || el.disabled) return;
    var fn = ACTS[el.getAttribute('data-food-act')];
    if (!fn) return;
    if (e.preventDefault) e.preventDefault();
    try { fn(el); } catch (err) { setText('food-msg', T.errors.generic); }
  });
  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  // Enter in a single-line field runs its form's action
  document.addEventListener('keydown', function (e) {
    if (!e || e.key !== 'Enter' || !S.ok) return;
    var id = idOf(e.target);
    var quick = ['fa-label', 'fa-kcal', 'fa-p', 'fa-c', 'fa-f'].indexOf(id) >= 0;
    var act = id === 'fp-code' ? 'p-code' : id === 'fp-q' ? 'p-search' : id === 'fa-amt' || quick ? 'save' : null;
    if (!act) return;
    if (e.preventDefault) e.preventDefault();
    ACTS[act]();
  });

  /* ---------- boot ---------- */
  function loadLog() {
    var date = HC.todayIso();
    return api('GET', '/log?date=' + date).then(function (data) {
      S.log = { date: date, entries: Array.isArray(data.entries) ? data.entries : [], totals: data.totals || dayTotals(data.entries) };
      renderLog();
      refreshDependents();
    }, function (err) {
      setText('food-msg', errText(err));
    });
  }
  function show(id) { var el = $(id); if (el) el.hidden = false; }
  api('GET', '/products').then(function (data) {
    S.ok = true;
    S.products = Array.isArray(data.products) ? data.products : [];
    window.HCViews = window.HCViews || {};
    window.HCViews['food-add'] = { title: function () { return T.sheet.title; }, render: renderSheet };
    ['food-log-block', 'food-products', 'food-recipes'].forEach(show);
    renderLog();
    renderProducts();
    renderRecipes();
    api('GET', '/recipes').then(function (d) {
      S.recipes = Array.isArray(d.recipes) ? d.recipes : [];
      renderRecipes();
    }, function (err) { recMsg(errText(err)); });
    loadLog();
    // a page left open past midnight starts the new day's log when it comes back
    if (document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && S.log && S.log.date !== HC.todayIso()) loadLog();
      });
    }
  }, function () { /* no food API here: every host stays hidden */ });

  window.HCFood = {
    productEntry: productEntry,
    recipeBasis: recipeBasis,
    recipeEntry: recipeEntry,
    entryFromBasis: entryFromBasis,
    dayTotals: dayTotals,
    atwaterOk: atwaterOk,
    roundMacros: roundMacros,
    parseNum: parseNum,
    basicModes: basicModes,
    basicAmount: basicAmount,
    basicEntry: basicEntry,
    basicLabel: basicLabel,
    basicConvert: basicConvert,
    state: function () { return S; }, // test-only: the tests read the in-memory state
  };
})();
