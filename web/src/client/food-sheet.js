/* Nutrición food log — the add sheet (window.HCViews['food-add'], rendered by detail.js): meal group,
 * Mis productos (products + basics search) / Mis recetas / Rápido tabs, the live preview and the save
 * (request id kept across ambiguous retries). Classic script (is:inline), inlined after food-core.js
 * (window.HCFoodInternal) and before food-log.js, which registers the view at boot and provides
 * renderLog / loadDay. See food-core.js for the whole food log. */
(function () {
  var FI = window.HCFoodInternal;
  if (!FI) return;
  var esc = HC.esc, format = HC.format, nf = HC.nf;
  var T = FI.T, K = FI.K, BASICS = FI.BASICS, LIM = FI.LIM, GROUPS = FI.GROUPS, S = FI.S,
    MACROS = FI.MACROS, productEntry = FI.productEntry, recipeBasis = FI.recipeBasis,
    entryFromBasis = FI.entryFromBasis, dayTotals = FI.dayTotals, basicModes = FI.basicModes,
    basicEntry = FI.basicEntry, basicLabel = FI.basicLabel, basicConvert = FI.basicConvert, $ = FI.$,
    kf = FI.kf, val = FI.val, parseNum = FI.parseNum, numKind = FI.numKind, setText = FI.setText,
    setHtml = FI.setHtml, focus = FI.focus, fieldErr = FI.fieldErr, clearErrs = FI.clearErrs,
    showErrs = FI.showErrs, serverFieldErr = FI.serverFieldErr, byId = FI.byId, find = FI.find,
    macroLine = FI.macroLine, errText = FI.errText, asGroup = FI.asGroup, slotFor = FI.slotFor,
    guessMeal = FI.guessMeal, newRequestId = FI.newRequestId, ambiguous = FI.ambiguous, api = FI.api,
    logChanged = FI.logChanged, refreshDependents = FI.refreshDependents, onToday = FI.onToday,
    logFor = FI.logFor, norm = FI.norm, basicMatches = FI.basicMatches, basicSub = FI.basicSub,
    findBasic = FI.findBasic, basicWords = FI.basicWords, basicModeText = FI.basicModeText,
    modeUnits = FI.modeUnits, modeDefault = FI.modeDefault, field = FI.field, numField = FI.numField,
    addActs = FI.addActs;

  /* ---------- add sheet (window.HCViews['food-add'], rendered by detail.js) ---------- */
  function newSheet(meal) {
    var m = asGroup(meal) || guessMeal();
    // a sheet opened on a past day keeps that date; one opened on "today" stays null and logs to the
    // today of the save (a sheet opened at 23:58 and saved at 00:02 logs to the new day)
    return { meal: m, date: onToday() ? null : S.view, tab: 'products', q: '', pick: null, busy: false, reqId: null };
  }
  var TAB_KEYS = ['products', 'recipes', 'quick'];
  function tabKeys() {
    return TAB_KEYS;
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
    // an empty search lists the user's products only (the basics appear once they type, so the list stays short)
    if (!q) return (S.products.length ? productGroupsHtml(S.products) : '<p class="food-note">' + esc(T.sheet.noProducts) + '</p>') + hint;
    var shown = S.products.filter(function (p) { return norm(p.name + ' ' + (p.brand || '')).indexOf(q) >= 0; });
    var basics = basicMatches(q);
    if (!shown.length && !basics.length) return '<p class="food-note">' + esc(T.sheet.noMatch) + '</p>';
    return productGroupsHtml(shown) + basicsHtml(basics);
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
      '<button type="button" class="save-btn" id="fa-save" data-food-act="save">' + esc(T.sheet.save) + '</button></div>';
  }
  // pieces <-> grams keeps the same food: the typed amount converted, else the new mode's prefill
  function switchBasicMode() {
    var sh = S.sheet, b = pickedItem();
    var to = val('fa-unit');
    if (!b || basicModes(b).indexOf(to) < 0) return;
    var from = sh.basicMode || to;
    var v = basicConvert(b, parseNum(val('fa-amt'), modeUnits(from)), from, to);
    var el = $('fa-amt');
    if (el && from !== to) el.value = v != null ? HC.numInput(v) : modeDefault(to);
    sh.basicMode = to;
  }
  // a product switched to servings starts at 1 serving; back to its own unit, at one serving in that
  // unit (servingSize), so a number typed for one unit is never read in the other (25 g != 25 servings)
  function switchProductUnit() {
    var pk = S.sheet.pick, item = pickedItem();
    var to = val('fa-unit');
    if (!item || unitsOf('product', item).indexOf(to) < 0) return;
    var from = pk.unit || unitsOf('product', item)[0];
    var el = $('fa-amt');
    if (el && from !== to) el.value = to === 'serving' ? '1' : HC.numInput(item.servingSize);
    pk.unit = to;
  }
  // the units a picked item can be logged in: a product in its own unit (+ servings when it states a
  // serving size), a per-serving recipe in servings, a batch recipe in grams of cooked food
  function unitsOf(kind, item) {
    if (kind === 'recipe') return item.kind === 'serving' ? ['serving'] : ['g'];
    return item.servingSize > 0 ? [item.unit, 'serving'] : [item.unit];
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
      '<button type="button" class="save-btn" id="fa-save" data-food-act="save">' + esc(T.sheet.save) + '</button></div>';
  }
  function quickHtml() {
    return '<div class="fa-quick">' + field('fa-label', T.sheet.label, '<input class="food-in" id="fa-label" type="text" maxlength="' + LIM.nameMax + '" autocomplete="off">') +
      '<div class="food-row">' + numField('fa-kcal', T.sheet.kcal, '', { unit: T.kcal }) + '</div>' +
      '<div class="food-row food-row-3">' + numField('fa-p', T.sheet.protein, '', { unit: T.units.g }) + numField('fa-c', T.sheet.carbs, '', { unit: T.units.g }) +
      numField('fa-f', T.sheet.fat, '', { unit: T.units.g }) + '</div>' +
      '<p class="food-note">' + esc(T.sheet.quickNote) + '</p>' +
      '<button type="button" class="save-btn" id="fa-save" data-food-act="save">' + esc(T.sheet.save) + '</button></div>';
  }
  function panelHtml() {
    var sh = S.sheet;
    if (sh.tab === 'quick') return quickHtml();
    if (sh.pick) return pickHtml();
    var search = sh.tab === 'products' && (S.products.length || BASICS.length)
      ? field('fa-q', T.sheet.search, '<input class="food-in" id="fa-q" type="search" autocomplete="off" placeholder="' + esc(T.sheet.searchPh) + '" value="' + esc(sh.q) + '">')
      : '';
    return search + '<div id="fa-list" class="fa-list">' + listHtml() + '</div>';
  }
  function tabsHtml() {
    return '<div class="dt-range dt-range-fill fa-tabs" role="group" aria-label="' + esc(T.sheet.tabsLabel) + '">' + tabKeys().map(function (k) {
      return '<button type="button" class="fa-tab" data-food-act="tab" data-tab="' + k + '" aria-pressed="' + (S.sheet.tab === k) + '">' + esc(T.sheet.tabs[k]) + '</button>';
    }).join('') + '</div>';
  }
  function renderSheet() {
    S.sheet = newSheet(FI.pendingMeal);
    FI.pendingMeal = null;
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
    var meal = slotFor(group);
    var date = sh.date || HC.todayIso(); // resolved at EVERY save / retry: a "today" sheet follows the clock
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
      // the stored row names its own day (a replay of an add first sent before midnight keeps that day)
      if (e && HC.isoDate(e.date)) date = e.date;
      var L = logFor(date);
      if (L && e) {
        // a replayed add (same request id) may already be in the list from a re-read: replace it
        L.entries = L.entries.filter(function (x) { return String(x.id) !== String(e.id); }).concat([e]);
        L.totals = data.totals || dayTotals(L.entries);
      }
      if (window.HCDetail && typeof window.HCDetail.close === 'function') window.HCDetail.close();
      FI.renderLog();
      if (date === HC.todayIso()) refreshDependents(); // a past day never feeds Resumen de hoy
      logChanged();
      setText('food-msg', e ? format(T.added, { label: e.label, k: kf(e.kcal) }) : '');
      focus('food-add-' + group);
      if (!L) FI.loadDay(date);
    }, function (err) {
      sh.busy = false;
      if (btn) btn.disabled = false;
      sheetMsg(errText(err), err && err.code === 'atwater');
      serverFieldErr(err, SHEET_FIELDS);
      // it may have been saved after all: show the server's list of THAT day (the retry keeps the same id)
      if (ambiguous(err)) FI.loadDay(date);
    });
  }
  function sheetTitle() {
    var d = S.sheet && S.sheet.date;
    return d && d !== HC.todayIso() ? format(T.sheet.titleDate, { date: HC.fmtDate(d) }) : T.sheet.title;
  }
  addActs({
    tab: function (el) {
      var k = el.getAttribute('data-tab');
      if (!S.sheet || tabKeys().indexOf(k) < 0) return;
      S.sheet.tab = k;
      S.sheet.pick = null;
      redrawPanel(k === 'quick' ? 'fa-label' : k === 'products' ? 'fa-q' : null);
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
  });
  FI.renderSheet = renderSheet;
  FI.sheetTitle = sheetTitle;
  FI.listHtml = listHtml;
  FI.switchBasicMode = switchBasicMode;
  FI.switchProductUnit = switchProductUnit;
  FI.updatePreview = updatePreview;
})();
