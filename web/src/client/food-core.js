/* Nutrición food log (part 2) — Registrar (one day's log in four groups: Desayuno / Comida / Cena /
 * Añadidos, inside the `dia` section; a ‹ date › navigator on top opens on today and walks to past days,
 * never persisted), the
 * add sheet (a view of the detail sheet modal), Mis productos and Mis recetas (folds before Tablas).
 * Four classic scripts (is:inline), inlined in this order after nutri-day.js and before intake.js:
 * food-core.js (this file: the formula port, parseNum, the API client, the shared state S and the
 * small helpers, handed to the others as window.HCFoodInternal), food-sheet.js (the add sheet),
 * food-catalog.js (Mis productos / Mis recetas) and food-log.js (Registrar + its day navigator, the
 * events, the boot and the public window.HCFood / window.foodTotals). Reads
 * I18N_FOOD + FOOD_CONST (meal slots / stores / units from lib/nutrition/foodlog.mjs), baked by
 * web/src/tabs/Dia.astro, and window.HC (util.js).
 *
 * LAN only, decided at VIEW time like freshness.js: every host ships `hidden` and appears only when
 * GET /api/food/products answers (plan-web proxies /api/food/ to the ingest service). The claude.ai
 * artifact, file:// and the example build never reach it, so they show nothing new and builds stay
 * byte-identical. Every request carries `X-HC-Food: 1` (the ingest service refuses anything else) and
 * writes send JSON. Nothing of the log is kept in the browser: the server is the one copy.
 *
 * Data honesty: macros come from the user's products / recipes (per-100 values from the label or Open
 * Food Facts, confirmed by the user) and the live preview uses a line-by-line port of
 * lib/nutrition/foodlog.mjs (window.HCFood; food.test.mjs runs it over the shared FOODLOG_CASES).
 * A quick entry without macros counts its kcal only; unknown macros are never filled in.
 *
 * Basics (the add sheet's "Mis productos" search): the public food DB (data/nutrition/ingredients.json),
 * baked as FOOD_BASICS by Dia.astro (lib/nutrition/basics.mjs). Typing also lists the matching basics, in a
 * "Básicos" group after the user's products (accent- and case-insensitive); a pick takes an amount in
 * the food's natural unit (pieces / ml / g, pieces <-> grams for a countable food) and is logged as ONE
 * quick entry with its four macros (a port of lib/nutrition/foodlog.mjs basicEntry / basicLabel; average
 * table values, marked as such). Mis recetas' ingredient picker searches the same way (its products
 * under "Mis productos", then the basics); a basic ingredient is saved as a SNAPSHOT of its FOOD_BASICS
 * row (basicIngredient), so a later table change never alters a saved recipe.
 *
 * Plan de hoy's portion guide (nutri-day.js) reads today's log per group (HCFood.groupTotals), the
 * owner's products (HCFood.products) and logs an example amount with its "+" (HCFood.addGuide: a basic
 * as ONE quick entry through the same basics formula, a product as a product entry; same request-id /
 * ambiguous-retry rules as the add sheet).
 *
 * Wiring: window.foodTotals() = today's logged totals ({date, k, p, c, g, n, missing, src: 'log'}) when
 * the server answered and today has >= 1 entry, else null — TODAY only, whatever day Registrar shows
 * (today's log is kept apart from a viewed past day; adds / deletes on a past day never touch it). Resumen de hoy's dial + macro bars
 * (nutri-day.js) and the intake rings (intake.js) prefer it over the Apple Health intake; after every
 * add / delete this script calls HCNutri.refresh() (which also refreshes the rings),
 * and HCFood.recentDay(days) gives the rings a PAST food-log day when today has none (a lazy log summary read),
 * each hook in its own try/catch. Errors are one line from the server's coarse codes. */
(function () {
  var T = typeof I18N_FOOD === 'undefined' || !I18N_FOOD ? null : I18N_FOOD;
  var K = typeof FOOD_CONST === 'undefined' || !FOOD_CONST ? null : FOOD_CONST;
  // the public basics (lib/nutrition/basics.mjs): [{k, n, u, m: [kcal, p, c, f] per 100 of u, pc?, v?, h?}]
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
  // snack). The stored slot enum (K.meals) is unchanged: an add-on is stored as K.addonSlot.
  var GROUPS = K.groups || [];
  var MAIN = K.mainSlots || [];
  var ADDON = K.addonGroup;
  // a fresh add sheet's group by the viewer's hour: before 11 breakfast, before 16 lunch, before 20 an add-on, else dinner
  var MEAL_HOUR_CUTS = [[11, 'breakfast'], [16, 'lunch'], [20, ADDON]];
  // before this hour (lib/nutrition/slots.mjs LATE_NIGHT_HOUR) the evening still belongs to the day
  // before: the navigator opens on it and a fresh sheet guesses dinner (absent = never late night)
  var LATE_NIGHT_HOUR = K.lateNightHour;
  // log = TODAY's log (the one foodTotals / groupTotals read); view = the day Registrar shows (null =
  // follow today, so a midnight roll moves with it), dayLog / dayFail = that past day's log / load error
  var S = { ok: false, boot: true, products: [], recipes: [], log: null, view: null, autoView: false, dayLog: null, dayFail: null, sheet: null, pform: null, rform: null, confirm: null };

  /* ---------- the formula: a line-by-line port of lib/nutrition/foodlog.mjs ---------- */
  var ATWATER_TOL = 0.25;
  var ATWATER_ABS_KCAL = 10;
  var MACROS = ['protein', 'carbs', 'fat'];
  var BASIC_UD_AMT = 100; // one unit of a 'ud' basic on the per-100 scale (lib/nutrition/foodlog.mjs)
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
  function knownMacros(m) {
    return !!m && fin(m.kcal) && fin(m.protein) && fin(m.carbs) && fin(m.fat);
  }
  // a product ({productId, amount}) or a basic snapshot ({basic, name, unit, amount, per100}; 'ud' = per unit)
  function ingredientBasis(ing, byId) {
    if (!ing || !fin(ing.amount) || ing.amount <= 0) return null;
    if (ing.basic != null) {
      if (!knownMacros(ing.per100)) return null;
      var ud = ing.unit === 'ud';
      return { per100: ing.per100, amount: ud ? ing.amount * BASIC_UD_AMT : ing.amount, weight: ud ? 0 : ing.amount };
    }
    var p = byId ? byId[ing.productId] : null;
    if (!p || !p.per100) return null;
    return { per100: p.per100, amount: ing.amount, weight: ing.amount };
  }
  function recipeBasis(recipe, byId) {
    var totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    var missing = [];
    var raw = 0;
    var n = 0;
    (recipe && recipe.ingredients ? recipe.ingredients : []).forEach(function (ing) {
      var x = ingredientBasis(ing, byId);
      if (!x) { missing.push(ing && ing.basic != null ? ing.basic : ing && ing.productId); return; }
      var m = scaleMacros(x.per100, x.amount);
      totals = { kcal: totals.kcal + m.kcal, protein: totals.protein + m.protein, carbs: totals.carbs + m.carbs, fat: totals.fat + m.fat };
      raw += x.weight;
      n++;
    });
    var complete = missing.length === 0 && n > 0;
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
  // a basic as a recipe ingredient: the snapshot the recipe keeps, amount in its own unit (1 decimal)
  function basicIngredient(b, amount, mode) {
    var a = basicAmount(b, amount, mode);
    if (a == null) return null;
    var v = round1(b.u === 'ud' ? a / BASIC_UD_AMT : a);
    if (!(v > 0)) return null;
    return { basic: b.k, name: String(b.n).slice(0, LIM.nameMax || 120), unit: b.u, amount: v, per100: { kcal: b.m[0], protein: b.m[1], carbs: b.m[2], fat: b.m[3] } };
  }

  /* ---------- small helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function kf(n) { // a whole number, grouped: 3.050 (es) / 3,050 (en) — the one formatter (HC.int)
    return HC.int(n);
  }
  function val(id) {
    var el = $(id);
    return el && el.value != null ? String(el.value) : '';
  }
  // the words the user may type after a number ("30 g", "30g", "250 ml", "130 kcal"), by unit
  var UNIT_WORDS = { g: ['g', 'gr', 'grs', 'gramo', 'gramos', 'gram', 'grams'], ml: ['ml'], kcal: ['kcal'], kg: ['kg', 'kilo', 'kilos'] };
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
  // the slot stored for a group: a main group is its slot, the add-ons group K.addonSlot
  function slotFor(group) {
    return group !== ADDON ? group : K.addonSlot;
  }
  function lateNight() {
    return typeof LATE_NIGHT_HOUR === 'number' && new Date().getHours() < LATE_NIGHT_HOUR;
  }
  function guessMeal() {
    var h = new Date().getHours();
    if (lateNight()) return 'dinner';
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

  // the log summary of the rings' window (the last `days` days ending at the viewer's today), read lazily
  // when the rings ask and today has no entry; key = the window it covers (a new day = a new read),
  // days = the last answer (kept while a re-read is in flight, so the rings never flicker)
  var R = { key: null, days: null, seq: 0 };
  // any add / delete, on any day: Constancia (client/adherence.js) re-reads its summary, and the rings'
  // window is re-read when they had read it (a past-day change never refreshes Resumen de hoy)
  function logChanged() {
    if (R.key) {
      R.key = null;
      if (typeof window.intakeRefresh === 'function') {
        try { window.intakeRefresh(); } catch (e) { /* the rings keep their last state */ }
      }
    }
    var a = window.HCAdherence;
    if (a && typeof a.reload === 'function') {
      try { a.reload(); } catch (e) { /* the adherence block guards its own host */ }
    }
  }
  function refreshDependents() {
    var n = window.HCNutri;
    if (n && typeof n.refresh === 'function') {
      try { n.refresh(); return; } catch (e) { /* the rings below still refresh */ }
    }
    if (typeof window.intakeRefresh === 'function') {
      try { window.intakeRefresh(); } catch (e) { /* the rings keep their last state */ }
    }
  }

  var DEL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  /* ---------- the viewed day (the day navigator; never persisted: the page always opens on today) ---------- */
  function onToday() { return S.view == null || S.view >= HC.todayIso(); }
  function viewDate() { return onToday() ? HC.todayIso() : S.view; }
  // the log Registrar shows: today's (shared with foodTotals) or the viewed past day's; null while loading
  function viewLog() {
    if (onToday()) return S.log && S.log.date === HC.todayIso() ? S.log : null;
    return S.dayLog && S.dayLog.date === S.view ? S.dayLog : null;
  }
  // the in-memory log of a date, if it is loaded (today's or the viewed day's)
  function logFor(date) {
    if (S.log && S.log.date === date) return S.log;
    if (S.dayLog && S.dayLog.date === date) return S.dayLog;
    return null;
  }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  // the basics whose name contains the search (accent- and case-insensitive), names that START with it first;
  // a hidden basic (h: the food is logged as one of your own products instead) is never listed, findBasic still knows it
  function basicMatches(q) {
    var hits = BASICS.filter(function (b) { return !b.h && norm(b.n).indexOf(q) >= 0; });
    var first = hits.filter(function (b) { return norm(b.n).indexOf(q) === 0; });
    return first.concat(hits.filter(function (b) { return norm(b.n).indexOf(q) !== 0; })).slice(0, BASIC_RESULTS_MAX);
  }
  // "88 kcal por 100 g · valor medio" (a unit food: "por ud"; a verified label of the DB: "etiqueta")
  function basicSub(b) {
    var per = b.u === 'ud' ? T.sheet.perUnit : format(T.sheet.per100, { unit: T.units[b.u] || b.u });
    return per + ' · ' + (b.v ? T.sheet.basicLabelSrc : T.sheet.basicAvg);
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
  // the shared click actions (data-food-act): each script registers its own; food-log.js dispatches them
  var ACTS = {};
  function addActs(o) {
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ACTS[k] = o[k];
  }

  // the internal namespace of food-sheet.js / food-catalog.js / food-log.js (absent when this script
  // bailed out above, so they bail out too). pendingMeal = the group the next add sheet opens on;
  // renderLog / loadDay are added by food-log.js (the sheet calls them only after boot)
  window.HCFoodInternal = {
    pendingMeal: null,
    T: T, K: K, BASICS: BASICS, LIM: LIM, BARCODE_RE: BARCODE_RE, GROUPS: GROUPS, MAIN: MAIN, ADDON: ADDON,
    S: S, MACROS: MACROS, fin: fin, round1: round1, roundMacros: roundMacros, productEntry: productEntry,
    recipeBasis: recipeBasis, entryFromBasis: entryFromBasis, recipeEntry: recipeEntry,
    dayTotals: dayTotals, atwaterOk: atwaterOk, basicModes: basicModes, basicAmount: basicAmount,
    basicEntry: basicEntry, basicLabel: basicLabel, basicConvert: basicConvert,
    basicIngredient: basicIngredient, '$': $, kf: kf, val: val, parseNum: parseNum, numKind: numKind,
    setText: setText, setHtml: setHtml, focus: focus, fieldErr: fieldErr, clearErrs: clearErrs,
    showErrs: showErrs, serverFieldErr: serverFieldErr, byId: byId, find: find, pcf: pcf,
    macroLine: macroLine, amountText: amountText, errText: errText, groupOf: groupOf, asGroup: asGroup,
    slotFor: slotFor, lateNight: lateNight, guessMeal: guessMeal, newRequestId: newRequestId,
    ambiguous: ambiguous, api: api, R: R, logChanged: logChanged, refreshDependents: refreshDependents,
    DEL_SVG: DEL_SVG, onToday: onToday, viewDate: viewDate, viewLog: viewLog, logFor: logFor, norm: norm,
    basicMatches: basicMatches, basicSub: basicSub, findBasic: findBasic, basicWords: basicWords,
    basicModeText: basicModeText, modeUnits: modeUnits, modeDefault: modeDefault, field: field,
    numField: numField, ACTS: ACTS, addActs: addActs,
  };
})();
