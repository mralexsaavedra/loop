/* Nutrición food log (part 2) — Registrar (today's log by meal slot, inside the `dia` section), the
 * add sheet (a view of the detail sheet modal), Mis productos and Mis recetas (folds next to the day
 * builder). Classic script (is:inline), inlined after nutri-day.js and before intake.js. Reads
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
 * Wiring: window.foodTotals() = today's logged totals ({date, k, p, c, g, n, missing, src: 'log'}) when
 * the server answered and today has >= 1 entry, else null. Resumen de hoy's dial + macro bars
 * (nutri-day.js) and the intake rings (intake.js) prefer it over the Apple Health intake; after every
 * add / delete this script calls HCNutri.refresh() (which also refreshes the rings and the builder),
 * each hook in its own try/catch. Errors are one line from the server's coarse codes. */
(function () {
  var T = typeof I18N_FOOD === 'undefined' || !I18N_FOOD ? null : I18N_FOOD;
  var K = typeof FOOD_CONST === 'undefined' || !FOOD_CONST ? null : FOOD_CONST;
  window.foodTotals = function () { return null; };
  if (!T || !K || typeof fetch !== 'function' || typeof document === 'undefined') return;
  var esc = HC.esc, format = HC.format, nf = HC.nf;
  var API = '/api/food';
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
  function recipeEntry(recipe, byId, amount, unit) {
    if (!fin(amount) || amount <= 0) return null;
    var b = recipeBasis(recipe, byId);
    if (!b.complete) return null;
    if (recipe.kind === 'serving' && unit === 'serving') return roundMacros(times(b.perServing, amount));
    if (recipe.kind === 'batch' && unit === 'g') return roundMacros(times(b.per100, amount / 100));
    return null;
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

  /* ---------- small helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function kf(n) { // thousands separator: 3.050 (es) / 3,050 (en)
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, HC.isEs() ? '.' : ',');
  }
  function val(id) {
    var el = $(id);
    return el && el.value != null ? String(el.value) : '';
  }
  // a typed number (a decimal comma is fine); null = empty, NaN = not a number
  function numIn(v) {
    var s = String(v == null ? '' : v).trim().replace(',', '.');
    if (s === '') return null;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function g1(v) { return v == null ? '—' : nf(round1(v)); }
  function setText(id, s) { var el = $(id); if (el) el.textContent = s; }
  function setHtml(id, s) { var el = $(id); if (el) el.innerHTML = s; }
  function focus(id) { var el = $(id); if (el && typeof el.focus === 'function') el.focus(); }
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
  function guessMeal() {
    var h = new Date(Date.now()).getHours();
    return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 20 ? 'snack' : 'dinner';
  }

  /* ---------- API ---------- */
  // resolves the JSON body of a 2xx; rejects {code, field?}: the server's coarse code, or 'offline'
  function api(method, path, body) {
    var headers = { 'X-HC-Food': '1' };
    var init = { method: method, headers: headers, cache: 'no-store', credentials: 'same-origin' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(API + path, init).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.ok) return data || {};
        throw { code: (data && typeof data.error === 'string' && data.error) || 'generic', field: data && data.field };
      });
    }, function () {
      throw { code: 'offline' };
    });
  }

  /* ---------- today's totals for Resumen de hoy + the rings ---------- */
  window.foodTotals = function () {
    var L = S.log;
    if (!S.ok || !L || L.date !== HC.todayIso() || !L.entries.length) return null;
    var t = L.totals;
    return { date: L.date, k: t.kcal, p: t.protein, c: t.carbs, g: t.fat, n: t.count, missing: t.missing, src: 'log' };
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
  function entryHtml(e) {
    return '<li class="fe"><div class="fe-main"><span class="fe-label">' + esc(e.label) + '</span>' +
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
      html += '<div class="food-meals">' + K.meals.map(function (m) {
        var list = L.entries.filter(function (e) { return e.meal === m; });
        var k = list.reduce(function (s, e) { return s + (fin(e.kcal) ? e.kcal : 0); }, 0);
        return '<section class="food-meal" aria-labelledby="fm-h-' + m + '"><div class="food-meal-top">' +
          '<h3 class="food-meal-name" id="fm-h-' + m + '">' + esc(T.meals[m]) + '</h3>' +
          (list.length ? '<span class="food-meal-kcal"><b>' + esc(kf(k)) + '</b> ' + esc(T.kcal) + '</span>' : '') + '</div>' +
          (list.length ? '<ul class="food-entries">' + list.map(entryHtml).join('') + '</ul>' : '') +
          '<button type="button" class="food-add" id="food-add-' + m + '" data-food-act="add" data-meal="' + m + '" aria-label="' + esc(format(T.addAria, { meal: T.meals[m] })) + '">+ ' + esc(T.add) + '</button></section>';
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
    api('DELETE', '/log/' + encodeURIComponent(id)).then(function () {
      S.log.entries = S.log.entries.filter(function (x) { return x !== e; });
      S.log.totals = dayTotals(S.log.entries);
      renderLog();
      refreshDependents();
      setText('food-msg', format(T.deleted, { label: e.label }));
    }, function (err) {
      el.disabled = false;
      setText('food-msg', errText(err));
    });
  }

  /* ---------- add sheet (window.HCViews['food-add'], rendered by detail.js) ---------- */
  function newSheet(meal) {
    return { meal: K.meals.indexOf(meal) >= 0 ? meal : guessMeal(), tab: 'products', q: '', pick: null, busy: false };
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
    if (!S.products.length) return '<p class="food-note">' + esc(T.sheet.noProducts) + '</p>';
    var q = norm(sh.q).trim();
    var shown = S.products.filter(function (p) { return !q || norm(p.name + ' ' + (p.brand || '')).indexOf(q) >= 0; });
    if (!shown.length) return '<p class="food-note">' + esc(T.sheet.noMatch) + '</p>';
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
    return pk.kind === 'recipe' ? find(S.recipes, pk.id) : find(S.products, pk.id);
  }
  // the units a picked item can be logged in: a product in its own unit (+ servings when it states a
  // serving size), a per-serving recipe in servings, a batch recipe in grams of cooked food
  function unitsOf(kind, item) {
    if (kind === 'recipe') return item.kind === 'serving' ? ['serving'] : ['g'];
    return item.servingSize > 0 ? [item.unit, 'serving'] : [item.unit];
  }
  function field(id, label, input) {
    return '<div class="food-field"><label class="food-lbl" for="' + id + '">' + esc(label) + '</label>' + input + '</div>';
  }
  function numInput(id, value, extra) {
    return '<input class="food-in" id="' + id + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(value == null ? '' : value) + '"' + (extra || '') + '>';
  }
  function pickHtml() {
    var pk = S.sheet.pick, item = pickedItem();
    if (!item) return '';
    var units = unitsOf(pk.kind, item);
    var sub = pk.kind === 'recipe'
      ? (item.kind === 'serving' ? T.sheet.perServing : T.sheet.per100Cooked)
      : format(T.sheet.per100, { unit: T.units[item.unit] }) + (item.servingSize > 0 ? ' · ' + format(T.sheet.serving, { n: nf(item.servingSize), unit: T.units[item.unit] }) : '');
    var m = pk.kind === 'recipe' ? (item.kind === 'serving' ? item.perServing : item.per100) : item.per100;
    return '<div class="fa-pick"><div class="fa-pick-top"><div><div class="fa-item-name">' + esc(item.name) + '</div>' +
      '<div class="fa-item-sub">' + (m ? macroLine(m) + ' ' : '') + esc(sub) + '</div></div>' +
      '<button type="button" class="food-btn food-btn-ghost" data-food-act="unpick">' + esc(T.sheet.change) + '</button></div>' +
      '<div class="food-row">' + field('fa-amt', T.sheet.amount, numInput('fa-amt', units[0] === 'serving' ? '1' : '')) +
      field('fa-unit', T.sheet.unit, '<select class="food-in" id="fa-unit">' + units.map(function (u, i) {
        return '<option value="' + u + '"' + (i === 0 ? ' selected' : '') + '>' + esc(T.units[u]) + '</option>';
      }).join('') + '</select>') + '</div>' +
      '<p class="fa-prev" id="fa-prev" aria-live="polite"></p>' +
      '<button type="button" class="food-btn" id="fa-save" data-food-act="save">' + esc(T.sheet.save) + '</button></div>';
  }
  function quickHtml() {
    return '<div class="fa-quick">' + field('fa-label', T.sheet.label, '<input class="food-in" id="fa-label" type="text" maxlength="120" autocomplete="off">') +
      '<div class="food-row">' + field('fa-kcal', T.sheet.kcal, numInput('fa-kcal', '')) + '</div>' +
      '<div class="food-row food-row-3">' + field('fa-p', T.sheet.protein, numInput('fa-p', '')) + field('fa-c', T.sheet.carbs, numInput('fa-c', '')) +
      field('fa-f', T.sheet.fat, numInput('fa-f', '')) + '</div>' +
      '<p class="food-note">' + esc(T.sheet.quickNote) + '</p>' +
      '<button type="button" class="food-btn" id="fa-save" data-food-act="save">' + esc(T.sheet.save) + '</button></div>';
  }
  function panelHtml() {
    var sh = S.sheet;
    if (sh.tab === 'quick') return quickHtml();
    if (sh.pick) return pickHtml();
    var search = sh.tab === 'products' && S.products.length
      ? field('fa-q', T.sheet.search, '<input class="food-in" id="fa-q" type="search" autocomplete="off" placeholder="' + esc(T.sheet.searchPh) + '" value="' + esc(sh.q) + '">')
      : '';
    return search + '<div id="fa-list" class="fa-list">' + listHtml() + '</div>';
  }
  function tabsHtml() {
    return '<div class="fa-tabs" role="group" aria-label="' + esc(T.sheet.tabsLabel) + '">' + ['products', 'recipes', 'quick'].map(function (k) {
      return '<button type="button" class="fa-tab" data-food-act="tab" data-tab="' + k + '" aria-pressed="' + (S.sheet.tab === k) + '">' + esc(T.sheet.tabs[k]) + '</button>';
    }).join('') + '</div>';
  }
  function renderSheet() {
    S.sheet = newSheet(pendingMeal);
    pendingMeal = null;
    var sh = S.sheet;
    var meals = '<select class="food-in" id="fa-meal">' + K.meals.map(function (m) {
      return '<option value="' + m + '"' + (m === sh.meal ? ' selected' : '') + '>' + esc(T.meals[m]) + '</option>';
    }).join('') + '</select>';
    return {
      head: '',
      body: '<div class="fa">' + field('fa-meal', T.sheet.meal, meals) + tabsHtml() +
        '<div id="fa-panel" class="fa-panel">' + panelHtml() + '</div>' +
        '<p class="food-msg" id="fa-msg" role="status" aria-live="polite"></p></div>',
    };
  }
  function redrawPanel(focusId) {
    setHtml('fa-panel', panelHtml());
    var tabs = document.querySelectorAll ? document.querySelectorAll('.fa-tab') : [];
    for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute('aria-pressed', String(tabs[i].getAttribute('data-tab') === S.sheet.tab));
    setText('fa-msg', '');
    if (focusId) focus(focusId);
  }
  function sheetPreview() {
    var pk = S.sheet && S.sheet.pick, item = pickedItem();
    if (!item) return null;
    var amount = numIn(val('fa-amt')), unit = val('fa-unit') || unitsOf(pk.kind, item)[0];
    var m = pk.kind === 'recipe' ? recipeEntry(item, byId(S.products), amount, unit) : productEntry(item, amount, unit);
    // a recipe row carries its computed basis; the products it needs may be archived (not listed):
    // fall back to the server's basis so the preview matches what will be logged
    if (!m && pk.kind === 'recipe' && fin(amount) && amount > 0) {
      if (item.kind === 'serving' && unit === 'serving' && item.perServing) m = roundMacros(times(item.perServing, amount));
      if (item.kind === 'batch' && unit === 'g' && item.per100) m = roundMacros(times(item.per100, amount / 100));
    }
    return { amount: amount, unit: unit, m: m };
  }
  function updatePreview() {
    var p = sheetPreview();
    setHtml('fa-prev', p && p.m ? macroLine(p.m) : '');
  }
  function sheetMsg(s, force) {
    var el = $('fa-msg');
    if (!el) return;
    if (force) el.innerHTML = esc(s) + ' <button type="button" class="food-btn food-btn-ghost" data-food-act="save-force">' + esc(T.sheet.saveAnyway) + '</button>';
    else el.textContent = s;
  }
  function saveSheet(force) {
    var sh = S.sheet;
    if (!sh || sh.busy) return;
    var meal = val('fa-meal') || sh.meal;
    if (K.meals.indexOf(meal) < 0) meal = sh.meal;
    var date = HC.todayIso();
    var body;
    if (sh.tab === 'quick') {
      var label = val('fa-label').replace(/\s+/g, ' ').trim();
      var kcal = numIn(val('fa-kcal'));
      if (!label) { sheetMsg(format(T.errors.invalid, { field: T.fields.label })); return; }
      if (!fin(kcal) || kcal < 0) { sheetMsg(format(T.errors.invalid, { field: T.fields.kcal })); return; }
      body = { date: date, meal: meal, refType: 'quick', label: label, kcal: kcal };
      var bad = null;
      [['protein', 'fa-p'], ['carbs', 'fa-c'], ['fat', 'fa-f']].forEach(function (x) {
        var v = numIn(val(x[1]));
        if (v == null) return;
        if (!fin(v) || v < 0) bad = bad || x[0];
        else body[x[0]] = v;
      });
      if (bad) { sheetMsg(format(T.errors.invalid, { field: T.fields[bad] })); return; }
    } else {
      var p = sheetPreview();
      if (!p || !p.m) { sheetMsg(T.sheet.previewNone); return; }
      body = { date: date, meal: meal, refType: sh.pick.kind, refId: Number(sh.pick.id), amount: p.amount, unit: p.unit };
    }
    if (force) body.force = true;
    sh.busy = true;
    var btn = $('fa-save');
    if (btn) btn.disabled = true;
    api('POST', '/log', body).then(function (data) {
      sh.busy = false;
      var e = data.entry;
      if (S.log && S.log.date === date && e) {
        S.log.entries.push(e);
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
    var numField = function (id, label, key) {
      var m = miss[key];
      return '<div class="food-field' + (m ? ' is-missing' : '') + '"><label class="food-lbl" for="' + id + '">' + esc(label) + '</label>' +
        numInput(id, f[key], m ? ' aria-describedby="' + id + '-miss"' : '') +
        (m ? '<small class="food-miss" id="' + id + '-miss">' + esc(T.products.offMissing) + '</small>' : '') + '</div>';
    };
    var F = T.products.form;
    return '<div class="fp-form">' +
      (S.pform.source === 'off' ? '<p class="food-note">' + esc(T.products.offIntro) + '</p>' : '') +
      field('fpf-name', F.name, '<input class="food-in" id="fpf-name" type="text" maxlength="120" autocomplete="off" value="' + esc(f.name || '') + '">') +
      field('fpf-brand', F.brand, '<input class="food-in" id="fpf-brand" type="text" maxlength="80" autocomplete="off" value="' + esc(f.brand || '') + '">') +
      '<div class="food-row">' + field('fpf-store', F.store, '<select class="food-in" id="fpf-store">' + opt(K.stores, f.store || 'mercadona', T.stores) + '</select>') +
      field('fpf-unit', F.unit, '<select class="food-in" id="fpf-unit">' + opt(K.units, f.unit || 'g', T.units) + '</select>') + '</div>' +
      field('fpf-code', F.barcode, '<input class="food-in" id="fpf-code" type="text" inputmode="numeric" maxlength="14" autocomplete="off" value="' + esc(f.barcode || '') + '">') +
      '<div class="food-row food-row-2">' + numField('fpf-kcal', F.kcal, 'kcal') + numField('fpf-p', F.protein, 'protein') + numField('fpf-c', F.carbs, 'carbs') + numField('fpf-f', F.fat, 'fat') + '</div>' +
      '<div class="food-row">' + numField('fpf-serv', F.serving, 'servingSize') + '</div>' +
      '<div class="food-btns"><button type="button" class="food-btn" id="fp-save" data-food-act="p-save">' + esc(T.products.save) + '</button>' +
      '<button type="button" class="food-btn food-btn-ghost" data-food-act="p-cancel">' + esc(T.products.cancel) + '</button></div></div>';
  }
  function productSearchHtml() {
    var P = T.products;
    return '<div class="fp-search"><div class="food-row">' +
      field('fp-code', P.barcode, '<input class="food-in" id="fp-code" type="text" inputmode="numeric" maxlength="14" autocomplete="off">') +
      '<button type="button" class="food-btn food-btn-ghost food-btn-end" data-food-act="p-code">' + esc(P.barcodeBtn) + '</button></div>' +
      '<div class="food-row">' + field('fp-q', P.query, '<input class="food-in" id="fp-q" type="search" maxlength="80" autocomplete="off">') +
      '<button type="button" class="food-btn food-btn-ghost food-btn-end" data-food-act="p-search">' + esc(P.queryBtn) + '</button></div>' +
      '<ul class="off-results" id="fp-results" aria-live="polite"></ul>' +
      '<div class="food-btns"><button type="button" class="food-btn food-btn-ghost" data-food-act="p-label">' + esc(P.fromLabel) + '</button>' +
      '<button type="button" class="food-btn food-btn-ghost" data-food-act="p-cancel">' + esc(P.cancel) + '</button></div></div>';
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
  function prodMsg(s, force) {
    var el = $('fp-msg');
    if (!el) return;
    if (force) el.innerHTML = esc(s) + ' <button type="button" class="food-btn food-btn-ghost" data-food-act="p-save-force">' + esc(T.products.saveAnyway) + '</button>';
    else el.textContent = s;
  }
  function openProductForm(source, form, missing, editId, offCode) {
    S.pform = { mode: 'form', source: source, form: form || {}, missing: missing || {}, editId: editId || null, offCode: offCode || null };
    renderProducts();
    prodMsg('');
    focus('fpf-name');
  }
  function offLookup(kind) {
    var q = kind === 'code' ? val('fp-code').replace(/\s+/g, '') : val('fp-q').replace(/\s+/g, ' ').trim();
    if (kind === 'code' && !/^[0-9]{8,14}$/.test(q)) { prodMsg(format(T.errors.invalid, { field: T.fields.barcode })); return; }
    if (kind === 'q' && (q.length < 2 || q.length > 80)) { prodMsg(format(T.errors.invalid, { field: T.fields.name })); return; }
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
      name: r.name || '', brand: r.brand || '', store: store, unit: r.unit === 'ml' ? 'ml' : 'g', barcode: /^[0-9]{8,14}$/.test(r.code || '') ? r.code : '',
      kcal: P.kcal, protein: P.protein, carbs: P.carbs, fat: P.fat, servingSize: r.servingSize,
    }, missing, null, /^[0-9]{1,14}$/.test(r.code || '') ? r.code : null);
  }
  function readProductForm() {
    var name = val('fpf-name').replace(/\s+/g, ' ').trim();
    if (!name) return { err: 'name' };
    var body = { name: name, store: val('fpf-store'), unit: val('fpf-unit'), per100: {}, source: S.pform.source };
    var brand = val('fpf-brand').replace(/\s+/g, ' ').trim();
    if (brand) body.brand = brand;
    var code = val('fpf-code').replace(/\s+/g, '');
    if (code) {
      if (!/^[0-9]{8,14}$/.test(code)) return { err: 'barcode' };
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
      var v = numIn(val(PF[i][0]));
      if (!fin(v) || v < 0) return { err: PF[i][2] };
      ordered.per100[PF[i][1]] = v;
    }
    var serv = numIn(val('fpf-serv'));
    if (serv != null) {
      if (!fin(serv) || serv <= 0) return { err: 'servingSize' };
      ordered.servingSize = serv;
    }
    ordered.source = body.source;
    if (S.pform.offCode) ordered.offCode = S.pform.offCode;
    return { body: ordered };
  }
  function saveProduct(force) {
    if (!S.pform || S.pform.busy) return;
    var r = readProductForm();
    if (r.err) { prodMsg(format(T.errors.invalid, { field: T.fields[r.err] || r.err })); return; }
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
        prodMsg(T.products.archived);
        renderRecipes(); // a recipe editor lists products
      } else {
        S.recipes = S.recipes.filter(function (x) { return String(x.id) !== String(id); });
        renderRecipes();
        recMsg(T.recipes.archived);
      }
    }, function (err) {
      S.confirm = null;
      if (isP) { renderProducts(); prodMsg(errText(err)); } else { renderRecipes(); recMsg(errText(err)); }
    });
  }

  /* ---------- Mis recetas ---------- */
  function recMsg(s) { setText('fr-msg', s); }
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
        field('frf-amt-' + i, format(R.amount, { n: n }), numInput('frf-amt-' + i, row.amount)) +
        '<button type="button" class="food-icon-btn" data-food-act="r-del-ing" data-i="' + i + '" aria-label="' + esc(format(R.removeAria, { n: n })) + '">' + DEL_SVG + '</button></div>';
    }).join('');
    return '<div class="fp-form">' +
      field('frf-name', R.name, '<input class="food-in" id="frf-name" type="text" maxlength="120" autocomplete="off" value="' + esc(f.name || '') + '">') +
      '<div class="food-row">' + field('frf-kind', R.kind, '<select class="food-in" id="frf-kind">' + kinds + '</select>') +
      (f.kind === 'serving'
        ? field('frf-serv', R.servings, numInput('frf-serv', f.servings))
        : field('frf-cooked', R.cooked, numInput('frf-cooked', f.cooked))) + '</div>' +
      '<h4 class="fa-store">' + esc(R.ingredients) + '</h4>' + rows +
      '<div class="food-btns"><button type="button" class="food-btn food-btn-ghost" data-food-act="r-add-ing">' + esc(R.addIngredient) + '</button></div>' +
      '<p class="fa-prev" id="frf-prev" aria-live="polite"></p>' +
      '<div class="food-btns"><button type="button" class="food-btn" data-food-act="r-save">' + esc(R.save) + '</button>' +
      '<button type="button" class="food-btn food-btn-ghost" data-food-act="r-cancel">' + esc(R.cancel) + '</button></div></div>';
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
    if (f.kind === 'serving') r.servings = numIn(f.servings);
    else r.cookedWeightG = numIn(f.cooked);
    r.ingredients = f.rows.map(function (row) { return { productId: row.productId === '' || row.productId == null ? null : Number(row.productId), amount: numIn(row.amount) }; });
    return r;
  }
  function updateRecipePreview() {
    syncRecipeForm();
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
    if (!r.name) { recMsg(format(T.errors.invalid, { field: T.fields.name })); return; }
    if (r.kind === 'serving' && !(fin(r.servings) && r.servings >= 1 && r.servings === Math.round(r.servings))) { recMsg(format(T.errors.invalid, { field: T.fields.servings })); return; }
    if (r.kind === 'batch' && !(fin(r.cookedWeightG) && r.cookedWeightG > 0)) { recMsg(format(T.errors.invalid, { field: T.fields.cookedWeightG })); return; }
    if (!r.ingredients.length || r.ingredients.some(function (i) { return !(i.productId > 0) || !(fin(i.amount) && i.amount > 0); })) {
      recMsg(format(T.errors.invalid, { field: T.fields.ingredients }));
      return;
    }
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
      if (!S.sheet || ['products', 'recipes', 'quick'].indexOf(k) < 0) return;
      S.sheet.tab = k;
      S.sheet.pick = null;
      redrawPanel(k === 'quick' ? 'fa-label' : k === 'products' ? 'fa-q' : null);
    },
    pick: function (el) {
      if (!S.sheet) return;
      S.sheet.pick = { kind: el.getAttribute('data-kind') === 'recipe' ? 'recipe' : 'product', id: el.getAttribute('data-id') };
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
    } else if (id === 'fa-amt' || id === 'fa-unit') updatePreview();
    else if (id === 'fa-meal' && S.sheet) S.sheet.meal = val('fa-meal') || S.sheet.meal;
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
    dayTotals: dayTotals,
    atwaterOk: atwaterOk,
    roundMacros: roundMacros,
    state: function () { return S; },
  };
})();
