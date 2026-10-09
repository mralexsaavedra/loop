/* Nutrición food log — Mis productos (list by store, Open Food Facts lookup, the product form, archive)
 * and Mis recetas (list, the editor with its ingredient search over products + basics, the live preview).
 * Classic script (is:inline), inlined after food-sheet.js and before food-log.js, which renders both
 * at boot. See food-core.js for the whole food log. */
(function () {
  var FI = window.HCFoodInternal;
  if (!FI) return;
  var esc = HC.esc, format = HC.format, nf = HC.nf;
  var T = FI.T, K = FI.K, BASICS = FI.BASICS, LIM = FI.LIM, BARCODE_RE = FI.BARCODE_RE, S = FI.S,
    fin = FI.fin, roundMacros = FI.roundMacros, recipeBasis = FI.recipeBasis, basicModes = FI.basicModes,
    basicConvert = FI.basicConvert, basicIngredient = FI.basicIngredient, $ = FI.$, kf = FI.kf,
    val = FI.val, parseNum = FI.parseNum, numKind = FI.numKind, setText = FI.setText,
    setHtml = FI.setHtml, focus = FI.focus, clearErrs = FI.clearErrs, showErrs = FI.showErrs,
    serverFieldErr = FI.serverFieldErr, byId = FI.byId, find = FI.find, macroLine = FI.macroLine,
    errText = FI.errText, api = FI.api, DEL_SVG = FI.DEL_SVG, norm = FI.norm,
    basicMatches = FI.basicMatches, basicSub = FI.basicSub, findBasic = FI.findBasic,
    basicModeText = FI.basicModeText, modeUnits = FI.modeUnits, modeDefault = FI.modeDefault,
    field = FI.field, numField = FI.numField, addActs = FI.addActs;

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
  function recMsg(s, force) { sectionMsg('fr-form-msg', 'fr-msg', !!S.rform, s, force ? 'r-save-force' : null, T.recipes.saveAnyway); }
  // one listed ingredient: "Avena 80 g", a basic "Huevo 2 ud" + the average-value tag (amount in its own unit)
  function ingText(i) {
    var u = T.units[i.unit] || i.unit || '';
    return esc((i.name || '—') + ' ' + (fin(i.amount) ? nf(i.amount) : '—') + (u ? ' ' + u : '')) +
      (i.basic != null ? ' <span class="food-tag">' + esc(T.recipes.avgTag) + '</span>' : '');
  }
  function recipeRow(r) {
    var b = r.kind === 'serving' ? r.perServing : r.per100;
    var basis = r.kind === 'serving' ? T.recipes.perServing : T.recipes.per100;
    var armed = S.confirm === 'r:' + r.id;
    return '<li class="fp-item"><div class="fp-main"><span class="fe-label">' + esc(r.name) + '</span>' +
      '<span class="fe-pcf">' + (r.complete && b ? esc(basis) + ': ' + macroLine(b) : esc(T.sheet.incomplete)) + ' · ' + esc(format(T.recipes.count, { n: r.ingredients.length })) + '</span>' +
      '<span class="fe-ings">' + r.ingredients.map(ingText).join(' · ') + '</span></div>' +
      '<div class="fp-acts"><button type="button" class="food-btn food-btn-ghost" data-food-act="r-edit" data-id="' + esc(r.id) + '" aria-label="' + esc(format(T.recipes.editAria, { name: r.name })) + '">' + esc(T.recipes.edit) + '</button>' +
      (armed
        ? '<button type="button" class="food-btn food-btn-warn" data-food-act="r-archive-ok" data-id="' + esc(r.id) + '" aria-label="' + esc(format(T.recipes.confirmAria, { name: r.name })) + '">' + esc(T.recipes.confirm) + '</button>'
        : '<button type="button" class="food-btn food-btn-ghost" data-food-act="r-archive" data-id="' + esc(r.id) + '" aria-label="' + esc(format(T.recipes.archiveAria, { name: r.name })) + '">' + esc(T.recipes.archive) + '</button>') +
      '</div></li>';
  }
  // an ingredient row = {productId, amount} (a product), {basic: snapshot, mode, amount} (a basic of the
  // public food DB) or {productId: '', q} (not picked yet: its search)
  function rowPicked(row) { return !!row && (!!row.basic || (row.productId !== '' && row.productId != null)); }
  function rowProduct(row) { return row && !row.basic && rowPicked(row) ? find(S.products, row.productId) : null; }
  // the unit of a product row (g / ml), null until one is picked; an archived product keeps the unit the server listed
  function rowUnit(row) {
    var p = rowProduct(row);
    return p ? p.unit : row && !row.basic && row.punit ? row.punit : null;
  }
  // a basic row as a basics-table entry: the stored SNAPSHOT's name / unit / macros (never refreshed from
  // FOOD_BASICS), plus the CURRENT table's piece when that food still exists in that unit (pieces <-> g)
  function rowBasic(row) {
    var sn = row && row.basic;
    if (!sn || !sn.per100) return null;
    var b = { k: sn.basic, n: sn.name, u: sn.unit, m: [sn.per100.kcal, sn.per100.protein, sn.per100.carbs, sn.per100.fat] };
    var cur = findBasic(sn.basic);
    if (cur && cur.u === sn.unit && cur.pc) b.pc = cur.pc;
    return b;
  }
  function snapOf(b) {
    return { basic: b.k, name: String(b.n).slice(0, LIM.nameMax || 120), unit: b.u, per100: { kcal: b.m[0], protein: b.m[1], carbs: b.m[2], fat: b.m[3] } };
  }
  function modeWord(mode) { return mode === 'piece' ? T.units.ud : T.units[mode] || mode; }
  // the picker list of row i: the owner's products ("Mis productos") first, then — once he types — the
  // matching basics ("Básicos · valor medio"), the add sheet's search rules (accent- and case-insensitive)
  function ingListHtml(i, query) {
    var R = T.recipes, q = norm(query).trim();
    var item = function (kind, id, name, sub) {
      return '<li><button type="button" class="fa-item" data-food-act="r-pick" data-i="' + i + '" data-kind="' + kind + '" data-id="' + esc(id) + '">' +
        '<span class="fa-item-name">' + name + '</span><span class="fa-item-sub">' + esc(sub) + '</span></button></li>';
    };
    var prods = q ? S.products.filter(function (p) { return norm(p.name + ' ' + (p.brand || '')).indexOf(q) >= 0; }) : S.products;
    var basics = q ? basicMatches(q) : [];
    var html = prods.length ? '<h4 class="fa-store">' + esc(R.mine) + '</h4><ul class="fa-items">' + prods.map(function (p) {
      return item('product', p.id, esc(p.name) + (p.brand ? ' <span class="fa-item-brand">' + esc(p.brand) + '</span>' : ''),
        kf(p.per100.kcal) + ' ' + T.kcal + ' ' + format(T.sheet.per100, { unit: T.units[p.unit] }));
    }).join('') + '</ul>' : '';
    if (!q) return (html || '<p class="food-note">' + esc(T.sheet.noProducts) + '</p>') + (BASICS.length ? '<p class="food-note">' + esc(T.sheet.typeToSearch) + '</p>' : '');
    if (!prods.length && !basics.length) return '<p class="food-note">' + esc(R.noMatch) + '</p>';
    if (basics.length) html += '<h4 class="fa-store">' + esc(R.basics) + '</h4><ul class="fa-items">' + basics.map(function (b) {
      return item('basic', b.k, esc(b.n), kf(b.m[0]) + ' ' + T.kcal + ' ' + basicSub(b));
    }).join('') + '</ul>';
    return html;
  }
  function ingRowHtml(row, i) {
    var R = T.recipes, n = i + 1;
    var del = '<button type="button" class="food-icon-btn" data-food-act="r-del-ing" data-i="' + i + '" aria-label="' + esc(format(R.removeAria, { n: n })) + '">' + DEL_SVG + '</button>';
    if (!rowPicked(row)) {
      return '<div class="fr-ing fr-ing-find">' + field('frf-ing-' + i, format(R.ingredient, { n: n }),
        '<input class="food-in" id="frf-ing-' + i + '" type="search" autocomplete="off" placeholder="' + esc(R.searchPh) + '" value="' + esc(row.q || '') + '">') + del +
        '<div id="frf-list-' + i + '" class="fa-list fr-list">' + ingListHtml(i, row.q || '') + '</div></div>';
    }
    var b = rowBasic(row), p = b ? null : rowProduct(row);
    var name = b ? b.n : p ? p.name + (p.brand ? ' · ' + p.brand : '') : row.pname || '—';
    var head = '<div class="fr-pick"><div><span class="food-lbl">' + esc(format(R.ingredient, { n: n })) + '</span> <span class="fa-item-name">' + esc(name) + '</span>' +
      (b ? ' <span class="food-tag">' + esc(R.avgTag) + '</span>' : '') + '</div>' +
      '<button type="button" class="food-btn food-btn-ghost" data-food-act="r-unpick" data-i="' + i + '" aria-label="' + esc(format(R.changeAria, { n: n })) + '">' + esc(R.change) + '</button></div>';
    var amt, mode = '';
    if (b) {
      var modes = basicModes(b);
      if (modes.length > 1) {
        amt = numField('frf-amt-' + i, format(R.amount, { n: n }), row.amount);
        mode = field('frf-mode-' + i, format(R.mode, { n: n }), '<select class="food-in" id="frf-mode-' + i + '">' + modes.map(function (u) {
          return '<option value="' + u + '"' + (u === row.mode ? ' selected' : '') + '>' + esc(basicModeText(b, u)) + '</option>';
        }).join('') + '</select>');
      } else {
        amt = numField('frf-amt-' + i, format(R.amount, { n: n }), row.amount, { unit: modeWord(modes[0]) });
      }
    } else {
      amt = numField('frf-amt-' + i, format(R.amount, { n: n }), row.amount, { unit: rowUnit(row) ? T.units[rowUnit(row)] : '' });
    }
    return '<div class="fr-ing fr-ing-picked">' + head + '<div class="food-row">' + amt + mode + '</div>' + del + '</div>';
  }
  function recipeFormHtml() {
    var f = S.rform, R = T.recipes;
    var kinds = ['serving', 'batch'].map(function (k) { return '<option value="' + k + '"' + (k === f.kind ? ' selected' : '') + '>' + esc(R.kinds[k]) + '</option>'; }).join('');
    return '<div class="fp-form">' +
      field('frf-name', R.name, '<input class="food-in" id="frf-name" type="text" maxlength="' + LIM.nameMax + '" autocomplete="off" value="' + esc(f.name || '') + '">') +
      '<div class="food-row">' + field('frf-kind', R.kind, '<select class="food-in" id="frf-kind">' + kinds + '</select>') +
      (f.kind === 'serving'
        ? numField('frf-serv', R.servings, f.servings)
        : numField('frf-cooked', R.cooked, f.cooked, { unit: T.units.g })) + '</div>' +
      '<h4 class="fa-store">' + esc(R.ingredients) + '</h4>' + f.rows.map(ingRowHtml).join('') +
      '<div class="food-btns"><button type="button" class="food-btn food-btn-ghost" data-food-act="r-add-ing">' + esc(R.addIngredient) + '</button></div>' +
      '<p class="fa-prev" id="frf-prev" aria-live="polite"></p>' +
      '<div class="food-btns"><button type="button" class="food-btn" data-food-act="r-save">' + esc(R.save) + '</button>' +
      '<button type="button" class="food-btn food-btn-ghost" data-food-act="r-cancel">' + esc(R.cancel) + '</button></div>' +
      formMsgHtml('fr-form-msg') + '</div>';
  }
  // the field to focus in row i: its search when nothing is picked, else its amount
  function rowFocusId(i) {
    var row = S.rform && S.rform.rows[i];
    return (rowPicked(row) ? 'frf-amt-' : 'frf-ing-') + i;
  }
  // pieces <-> grams of a basic row keeps the same food amount (the add sheet's switchBasicMode)
  function switchRowMode(i) {
    var row = S.rform.rows[i], b = rowBasic(row);
    if (!b) return;
    var to = val('frf-mode-' + i);
    if (basicModes(b).indexOf(to) < 0) return;
    var from = row.mode || to;
    if (from !== to) {
      var v = basicConvert(b, parseNum(val('frf-amt-' + i), modeUnits(from)), from, to);
      var txt = v != null ? HC.numInput(v) : modeDefault(to);
      var el = $('frf-amt-' + i);
      if (el) el.value = txt;
      row.amount = txt;
    }
    row.mode = to;
  }
  function renderRecipes() {
    var host = $('fr-body');
    if (!host) return;
    try {
      var top;
      if (S.rform) top = recipeFormHtml();
      else if (!S.products.length && !BASICS.length) top = '<p class="food-note">' + esc(T.recipes.needProducts) + '</p>';
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
      if (!rowPicked(row)) {
        if ($('frf-ing-' + i)) row.q = val('frf-ing-' + i);
        return;
      }
      if (row.basic && $('frf-mode-' + i)) {
        var m = val('frf-mode-' + i);
        if (basicModes(rowBasic(row)).indexOf(m) >= 0) row.mode = m;
      }
      if ($('frf-amt-' + i)) row.amount = val('frf-amt-' + i);
    });
  }
  function recipeFromForm() {
    var f = S.rform;
    var r = { name: String(f.name || '').replace(/\s+/g, ' ').trim(), kind: f.kind };
    if (f.kind === 'serving') r.servings = parseNum(f.servings, null);
    else r.cookedWeightG = parseNum(f.cooked, ['g']);
    r.ingredients = f.rows.map(function (row) {
      var b = rowBasic(row);
      if (b) {
        // the snapshot in the basic's own unit (basicIngredient); an unusable amount keeps its error kind
        var n = parseNum(row.amount, modeUnits(row.mode));
        var ing = fin(n) && n > 0 ? basicIngredient(b, n, row.mode) : null;
        var sn = row.basic;
        return ing || { basic: sn.basic, name: sn.name, unit: sn.unit, amount: n == null || !fin(n) ? n : 0, per100: sn.per100 };
      }
      var u = rowUnit(row);
      return { productId: rowPicked(row) ? Number(row.productId) : null, amount: parseNum(row.amount, u ? [u] : ['g', 'ml']) };
    });
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
  // a saved ingredient back in the editor: a basic keeps its snapshot and opens in its own unit (a 'ud'
  // food in pieces); a product keeps the name / unit the server listed (an archived one is not in the list)
  function editRow(i) {
    if (i.basic != null) return { basic: { basic: i.basic, name: i.name, unit: i.unit, per100: i.per100 }, mode: i.unit === 'ud' ? 'piece' : i.unit, amount: String(i.amount) };
    return { productId: String(i.productId), amount: String(i.amount), pname: i.name, punit: i.unit };
  }
  function openRecipeForm(r) {
    S.rform = r
      ? { editId: r.id, name: r.name, kind: r.kind, servings: r.servings == null ? '' : String(r.servings), cooked: r.cookedWeightG == null ? '' : String(r.cookedWeightG), rows: r.ingredients.map(editRow) }
      : { editId: null, name: '', kind: 'serving', servings: '1', cooked: '', rows: [{ productId: '', amount: '', q: '' }] };
    renderRecipes();
    recMsg('');
    focus('frf-name');
  }
  function saveRecipe(force) {
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
      if (ing.basic == null && !(ing.productId > 0)) { errs.push({ id: 'frf-ing-' + i, key: 'ingredients.productId', kind: 'required' }); return; }
      var ak = numKind(ing.amount, true, true);
      if (ak) errs.push({ id: 'frf-amt-' + i, key: 'ingredients.amount', kind: ak });
    });
    if (errs.length) { recMsg(showErrs(errs)); return; }
    if (force) r.force = true;
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
      recMsg(errText(err), err && err.code === 'atwater');
      serverFieldErr(err, { name: 'frf-name', servings: 'frf-serv', cookedWeightG: 'frf-cooked' });
    });
  }
  addActs({
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
    'r-add-ing': function () { syncRecipeForm(); S.rform.rows.push({ productId: '', amount: '', q: '' }); renderRecipes(); focus('frf-ing-' + (S.rform.rows.length - 1)); },
    'r-pick': function (el) {
      syncRecipeForm();
      var i = Number(el.getAttribute('data-i'));
      if (!S.rform.rows[i]) return;
      if (el.getAttribute('data-kind') === 'basic') {
        var b = findBasic(el.getAttribute('data-id'));
        if (!b) return;
        var m0 = basicModes(b)[0];
        S.rform.rows[i] = { basic: snapOf(b), mode: m0, amount: modeDefault(m0) };
      } else {
        S.rform.rows[i] = { productId: el.getAttribute('data-id'), amount: '' };
      }
      renderRecipes();
      focus('frf-amt-' + i);
    },
    'r-unpick': function (el) {
      syncRecipeForm();
      var i = Number(el.getAttribute('data-i'));
      if (!S.rform.rows[i]) return;
      S.rform.rows[i] = { productId: '', amount: '', q: '' };
      renderRecipes();
      focus('frf-ing-' + i);
    },
    'r-del-ing': function (el) {
      syncRecipeForm();
      var i = Number(el.getAttribute('data-i'));
      if (S.rform.rows.length > 1) S.rform.rows.splice(i, 1);
      renderRecipes();
      focus(rowFocusId(Math.max(0, Math.min(i, S.rform.rows.length - 1))));
    },
    'r-save': function () { saveRecipe(false); },
    'r-save-force': function () { saveRecipe(true); },
    'r-cancel': function () { S.rform = null; renderRecipes(); recMsg(''); },
    'r-archive': function (el) { S.confirm = 'r:' + el.getAttribute('data-id'); renderRecipes(); },
    'r-archive-ok': function (el) { archive('r', el.getAttribute('data-id')); },
  });
  FI.renderProducts = renderProducts;
  FI.renderRecipes = renderRecipes;
  FI.recMsg = recMsg;
  FI.syncRecipeForm = syncRecipeForm;
  FI.rowPicked = rowPicked;
  FI.ingListHtml = ingListHtml;
  FI.switchRowMode = switchRowMode;
  FI.updateRecipePreview = updateRecipePreview;
})();
