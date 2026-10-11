/* Nutrición food log — Registrar (one day's log in four groups, the ‹ date › navigator, the late-night
 * rule), the shared event listeners (click actions registered by every food script, input / change /
 * Enter), the boot (GET /api/food/products reveals the hosts) and the public hooks: window.foodTotals,
 * window.HCFood (groupTotals, recentDay, products, addGuide, showDay, the formula port, api). Classic
 * script (is:inline), the LAST food script: inlined after food-catalog.js and before settings.js.
 * See food-core.js for the whole food log. */
(function () {
  var FI = window.HCFoodInternal;
  if (!FI) return;
  var esc = HC.esc, format = HC.format;
  var T = FI.T, LIM = FI.LIM, GROUPS = FI.GROUPS, MAIN = FI.MAIN, ADDON = FI.ADDON, S = FI.S, fin = FI.fin,
    round1 = FI.round1, roundMacros = FI.roundMacros, productEntry = FI.productEntry,
    recipeBasis = FI.recipeBasis, entryFromBasis = FI.entryFromBasis, recipeEntry = FI.recipeEntry,
    dayTotals = FI.dayTotals, atwaterOk = FI.atwaterOk, basicModes = FI.basicModes,
    basicAmount = FI.basicAmount, basicEntry = FI.basicEntry, basicLabel = FI.basicLabel,
    basicConvert = FI.basicConvert, basicIngredient = FI.basicIngredient, $ = FI.$, kf = FI.kf,
    val = FI.val, parseNum = FI.parseNum, setText = FI.setText, setHtml = FI.setHtml, focus = FI.focus,
    find = FI.find, pcf = FI.pcf, macroLine = FI.macroLine, amountText = FI.amountText,
    errText = FI.errText, groupOf = FI.groupOf, asGroup = FI.asGroup, slotFor = FI.slotFor,
    lateNight = FI.lateNight, newRequestId = FI.newRequestId, ambiguous = FI.ambiguous, api = FI.api,
    R = FI.R, logChanged = FI.logChanged, refreshDependents = FI.refreshDependents, DEL_SVG = FI.DEL_SVG,
    onToday = FI.onToday, viewDate = FI.viewDate, viewLog = FI.viewLog, logFor = FI.logFor,
    findBasic = FI.findBasic, basicWords = FI.basicWords, ACTS = FI.ACTS, addActs = FI.addActs;
  var renderSheet = FI.renderSheet, sheetTitle = FI.sheetTitle, listHtml = FI.listHtml, switchBasicMode = FI.switchBasicMode,
    switchProductUnit = FI.switchProductUnit, updatePreview = FI.updatePreview;
  var renderProducts = FI.renderProducts, renderRecipes = FI.renderRecipes, recMsg = FI.recMsg, syncRecipeForm = FI.syncRecipeForm,
    rowPicked = FI.rowPicked, ingListHtml = FI.ingListHtml, switchRowMode = FI.switchRowMode, updateRecipePreview = FI.updateRecipePreview;
  var viewSeq = 0; // one per past-day read: a slower answer for a day already left is dropped
  FI.renderLog = renderLog;
  FI.loadDay = loadDay;

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
  /* ---------- the intake rings' past day (intake.js) ---------- */
  function loadRecent(from, to) {
    var mine = ++R.seq;
    R.key = from + '|' + to;
    api('GET', '/log/summary?from=' + from + '&to=' + to).then(function (d) {
      if (mine !== R.seq) return;
      R.days = d && Array.isArray(d.days) ? d.days : [];
      if (typeof window.intakeRefresh === 'function') {
        try { window.intakeRefresh(); } catch (e) { /* the rings keep their last state */ }
      }
    }, function () {
      if (mine !== R.seq) return;
      R.days = []; // no data, no retry until the window or the log changes
    });
  }
  /** The most recent day WITH food-log entries in the last `days` days ending at the viewer's today
   * (today included), in foodTotals()'s shape ({date, k, p, c, g, n, missing, src: 'log'}), or null:
   * no food API, nothing logged in the window, or the summary not read yet (it is then read once and
   * the rings re-render when it answers). */
  function recentDay(days) {
    if (!S.ok) return null;
    var n = days >= 0 ? Math.floor(days) : 3;
    var to = HC.todayIso(), from = HC.shiftIso(to, -n);
    if (R.key !== from + '|' + to) loadRecent(from, to);
    var best = null;
    (R.days || []).forEach(function (d) {
      if (!d || typeof d.date !== 'string' || d.date < from || d.date > to || !(d.n > 0) || !fin(d.k)) return;
      if (!best || d.date > best.date) best = d;
    });
    if (!best) return null;
    var m = best.missing || {};
    var num = function (v) { return fin(v) ? v : null; };
    return { date: best.date, k: best.k, p: num(best.p), c: num(best.c), g: num(best.f), n: best.n, missing: { protein: !!m.p, carbs: !!m.c, fat: !!m.f }, src: 'log' };
  }
  /* ---------- Registrar ---------- */
  // a list row: the name with the amount as secondary text (an add-on entry also carries its stored
  // slot as a tiny muted tag: Pre-entreno, Snack…) and the macros as the small line under them; the kcal
  // alone on the right, then the delete button
  function entryHtml(e) {
    var tag = groupOf(e.meal) === ADDON && T.meals[e.meal] ? '<span class="fe-slot">' + esc(T.meals[e.meal]) + '</span>' : '';
    return '<li class="fe"><div class="fe-main"><span class="fe-label">' + esc(e.label) + '</span>' + tag +
      '<span class="fe-amt">' + esc(amountText(e.amount, e.unit)) + '</span><span class="fe-pcf">' + esc(pcf(e)) + '</span></div>' +
      '<div class="fe-side"><span class="fe-kcal"><b>' + esc(kf(e.kcal)) + '</b> ' + esc(T.kcal) + '</span></div>' +
      '<button type="button" class="food-icon-btn" data-food-act="del" data-id="' + esc(e.id) + '" aria-label="' + esc(format(T.delAria, { label: e.label })) + '">' + DEL_SVG + '</button></li>';
  }
  function renderNav() {
    var on = onToday();
    setText('food-day-label', on ? T.day.today : HC.fmtDate(S.view));
    var next = $('food-day-next');
    if (next) next.disabled = on; // no future days
    var back = $('food-day-today');
    if (back) back.hidden = on;
  }
  // show a day (null / today or later = today): today's log is already there, a past day is read each time
  function goDay(date, auto) {
    S.view = date && date < HC.todayIso() ? date : null;
    S.autoView = !!auto && S.view != null; // set by the late-night rule, cleared by any other move
    S.dayFail = null;
    if (S.view == null) S.dayLog = null;
    else if (!S.dayLog || S.dayLog.date !== S.view) S.dayLog = null;
    setText('food-msg', '');
    renderLog();
    if (S.view != null) loadDay(S.view);
    else if (!S.log || S.log.date !== HC.todayIso()) loadLog();
  }

  function renderLog() {
    renderNav();
    var host = $('food-log');
    if (!host) return;
    try {
      var on = onToday();
      var L = viewLog();
      if (!L) {
        var fail = !on && S.dayFail && S.dayFail.date === S.view ? S.dayFail.msg : null;
        host.innerHTML = '<p class="food-note">' + esc(fail || T.day.loading) + '</p>' +
          (fail ? '<button type="button" class="food-btn food-btn-ghost" id="food-day-retry" data-food-act="day-retry">' + esc(T.day.retry) + '</button>' : '');
        return;
      }
      var t = L.totals;
      var miss = t.missing && (t.missing.protein || t.missing.carbs || t.missing.fat);
      var html = '<div class="food-sum"><span class="food-sum-lbl">' + esc(on ? T.dayTotal : T.dayTotalPast) + '</span> ' + macroLine(t) + '</div>' +
        (miss ? '<p class="food-note">' + esc(T.missingNote) + '</p>' : '') +
        (L.entries.length ? '' : '<p class="food-note">' + esc(on ? T.empty : T.emptyPast) + '</p>');
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
    var L = viewLog(); // the day on screen (today's log, or a past day's)
    var e = L && find(L.entries, id);
    if (!e) return;
    el.disabled = true;
    var date = L.date;
    var drop = function () {
      // the day may have been re-read while the delete was in flight: drop the row from the CURRENT log
      var C = logFor(date);
      if (!C) { renderLog(); return; }
      C.entries = C.entries.filter(function (x) { return String(x.id) !== String(id); });
      C.totals = dayTotals(C.entries);
      renderLog();
      if (C === S.log) refreshDependents(); // only today's log feeds Resumen de hoy / the guide
      logChanged();
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
  /* ---------- events ---------- */
  addActs({
    add: function (el) {
      FI.pendingMeal = el.getAttribute('data-meal');
      if (window.HCDetail && typeof window.HCDetail.open === 'function') window.HCDetail.open('food-add', null, { opener: el, focus: '#fa-q, #fa-label' });
    },
    del: delEntry,
    'day-prev': function () { goDay(HC.shiftIso(viewDate(), -1)); },
    'day-next': function () {
      if (onToday()) return;
      goDay(HC.shiftIso(S.view, 1));
      if (onToday()) focus('food-day-prev'); // next just went disabled: keep focus in the navigator
    },
    'day-retry': function () {
      if (onToday()) return;
      S.dayFail = null;
      setText('food-msg', '');
      renderLog();
      loadDay(S.view);
    },
    'day-today': function () {
      if (onToday()) return;
      goDay(null);
      focus('food-day-prev'); // the button just hid itself
    },
  });
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
      else if (id === 'fa-unit' && S.sheet && S.sheet.pick && S.sheet.pick.kind === 'product') switchProductUnit();
      updatePreview();
    }
    else if (id === 'fa-meal' && S.sheet) S.sheet.meal = asGroup(val('fa-meal')) || S.sheet.meal;
    else if (id === 'fpf-unit') setText('fpf-serv-unit', T.units[val('fpf-unit')] || ''); // the serving suffix follows "Se mide en"
    else if (id.indexOf('frf-') === 0 && S.rform) {
      var qi = /^frf-ing-(\d+)$/.exec(id), mi = /^frf-mode-(\d+)$/.exec(id);
      if (id === 'frf-kind') { syncRecipeForm(); renderRecipes(); focus('frf-kind'); }
      else if (qi) {
        // typing in an ingredient's search redraws only its list (the field keeps focus)
        var row = S.rform.rows[Number(qi[1])];
        if (row && !rowPicked(row)) { row.q = val(id); setHtml('frf-list-' + qi[1], ingListHtml(Number(qi[1]), row.q)); }
      }
      else if (mi) { switchRowMode(Number(mi[1])); updateRecipePreview(); }
      else updateRecipePreview();
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
  /** Read one day's log. Today's goes to S.log (foodTotals / groupTotals / the portion guide) and
   * refreshes Resumen de hoy; a past day's goes to S.dayLog only while that day is still on screen and
   * this is its newest read (a slower answer for a day already left never overwrites the view). */
  function loadDay(date) {
    var today = date === HC.todayIso();
    var seq = today ? 0 : ++viewSeq;
    var current = function () { return seq === viewSeq && !onToday() && S.view === date; };
    return api('GET', '/log?date=' + date).then(function (data) {
      var L = { date: date, entries: Array.isArray(data.entries) ? data.entries : [], totals: data.totals || dayTotals(data.entries) };
      if (today) {
        S.log = L;
        renderLog();
        refreshDependents();
      } else if (current()) {
        S.dayLog = L;
        S.dayFail = null;
        renderLog();
      }
    }, function (err) {
      if (!today && !current()) return;
      if (!today) {
        S.dayFail = { date: date, msg: errText(err) };
        renderLog();
      }
      setText('food-msg', errText(err));
    });
  }
  function loadLog() { return loadDay(HC.todayIso()); }
  function show(id) { var el = $(id); if (el) el.hidden = false; }
  // the rings (intake.js) wait for this boot answer (HCFood.pending()) instead of flashing the Apple Health day
  function bootDone() {
    S.boot = false;
    if (typeof window.intakeRefresh === 'function') {
      try { window.intakeRefresh(); } catch (e) { /* the rings keep their last state */ }
    }
  }
  api('GET', '/products').then(function (data) {
    S.ok = true;
    bootDone();
    S.products = Array.isArray(data.products) ? data.products : [];
    // detail.js asks for the title after render(), so it names the sheet's own day when it is not today
    HC.registerView('food-add', { title: sheetTitle, render: renderSheet });
    // the dock's "+" can now offer "add food" (client/nav-actions.js)
    if (window.HCActions) {
      try { window.HCActions.refresh(); } catch (e) { /* the "+" keeps its last state */ }
    }
    ['food-log-block', 'food-products', 'food-recipes'].forEach(show);
    loadLog(); // today's log feeds foodTotals / groupTotals whatever day is on screen
    if (lateNight()) goDay(HC.shiftIso(HC.todayIso(), -1), true); // 00:00–03:59: open on the evening before
    else renderLog();
    renderProducts();
    renderRecipes();
    api('GET', '/recipes').then(function (d) {
      S.recipes = Array.isArray(d.recipes) ? d.recipes : [];
      renderRecipes();
    }, function (err) { recMsg(errText(err)); });
    // a page left open past midnight starts the new day's log when it comes back: a viewer on "today"
    // moves to the new today (S.view is null; before LATE_NIGHT_HOUR to the evening before), one looking at a past day stays there
    if (document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        var stale = !!S.log && S.log.date !== HC.todayIso();
        // the late-night rule moves a viewer who was on "today" when the day rolled, and its own automatic
        // view (it follows the clock and expires at LATE_NIGHT_HOUR); a day picked by hand never moves
        var follow = S.autoView || (S.view == null && stale);
        if (follow && lateNight()) {
          if (stale) loadLog();
          goDay(HC.shiftIso(HC.todayIso(), -1), true); // 00:00–03:59: stay on the evening being logged
        } else if (follow && S.autoView) goDay(null); // reads today's log itself when it is stale
        else if (stale) loadLog();
      });
    }
  }, function () {
    // no food API here: every host stays hidden; the dial, bars and rings fall back to the Apple Health
    // day (HCNutri.refresh re-renders Resumen de hoy, which refreshes the rings itself)
    S.boot = false;
    refreshDependents();
  });

  /* ---------- Plan de hoy's portion guide (nutri-day.js) ---------- */
  function zero4() { return { k: 0, p: 0, c: 0, f: 0 }; }
  /** Today's logged sums per Registrar group, {meals: {breakfast, lunch, dinner: {k, p, c, f}}, addon} (a
   * macro an entry lacks counts as 0; kcal whole, macros to 1 decimal), or null unless the food API
   * answered and today's log is loaded. */
  function groupTotals() {
    var L = S.log;
    if (!S.ok || !L || L.date !== HC.todayIso()) return null;
    var out = { meals: {}, addon: zero4() };
    MAIN.forEach(function (m) { out.meals[m] = zero4(); });
    L.entries.forEach(function (e) {
      var g = groupOf(e.meal), t = g === ADDON ? out.addon : out.meals[g];
      if (!t) return;
      t.k += fin(e.kcal) ? e.kcal : 0;
      t.p += fin(e.protein) ? e.protein : 0;
      t.c += fin(e.carbs) ? e.carbs : 0;
      t.f += fin(e.fat) ? e.fat : 0;
    });
    var tidy = function (t) { return { k: Math.round(t.k), p: round1(t.p), c: round1(t.c), f: round1(t.f) }; };
    MAIN.forEach(function (m) { out.meals[m] = tidy(out.meals[m]); });
    out.addon = tidy(out.addon);
    return out;
  }
  /** The user's active products (a copy: id, name, brand, unit, per100), or null without the food API. */
  function guideProducts() {
    if (!S.ok) return null;
    return S.products.map(function (p) {
      var v = p.per100 || {};
      return { id: p.id, name: p.name, brand: p.brand || null, unit: p.unit, per100: { kcal: v.kcal, protein: v.protein, carbs: v.carbs, fat: v.fat } };
    });
  }
  var guidePending = {}; // one request id per pending guide add (same meal, food and amount), kept across ambiguous retries
  /** Log a guide example: {group: a main meal, food: 'b:<basic key>' | 'p:<product id>', amt (the food's
   * amount scale: g / ml, a 'ud' food 100 per unit)}. A basic is ONE quick entry (basicEntry / basicLabel,
   * in pieces when the food has them); a product a product entry (the server applies the formula).
   * Resolves the saved entry; rejects on a refusal (one line in Registrar's status). */
  function addGuide(o) {
    var fail = function (code) { setText('food-msg', T.errors[code] || T.errors.generic); return Promise.reject({ code: code }); };
    if (!S.ok || !o) return fail('generic');
    var group = asGroup(o.group);
    var id = String(o.food || ''), amt = Number(o.amt);
    if (!group || group === ADDON || !(amt > 0) || amt > (LIM.amountMax || 5000)) return fail('generic');
    var body = { date: HC.todayIso(), meal: slotFor(group) };
    if (id.indexOf('b:') === 0) {
      var b = findBasic(id.slice(2));
      if (!b) return fail('generic');
      var mode = b.pc || b.u === 'ud' ? 'piece' : b.u;
      var n = mode === 'piece' ? amt / (b.pc && fin(b.pc.a) && b.pc.a > 0 ? b.pc.a : 100) : amt;
      var m = basicEntry(b, n, mode), label = basicLabel(b, n, mode, basicWords());
      if (!m || !label) return fail('generic');
      body.refType = 'quick';
      body.label = label;
      body.kcal = m.kcal;
      body.protein = m.protein;
      body.carbs = m.carbs;
      body.fat = m.fat;
      // the macros come from the food DB's own values, nothing typed: the Atwater typo guard does not apply
      body.force = true;
    } else if (id.indexOf('p:') === 0) {
      var p = find(S.products, id.slice(2));
      if (!p) return fail('generic');
      body.refType = 'product';
      body.refId = Number(p.id);
      body.amount = amt;
      body.unit = p.unit;
    } else return fail('generic');
    var key = body.meal + '|' + id + '|' + amt;
    body.requestId = guidePending[key] || (guidePending[key] = newRequestId());
    return api('POST', '/log', body).then(function (data) {
      delete guidePending[key];
      var e = data.entry;
      if (S.log && S.log.date === body.date && e) {
        S.log.entries = S.log.entries.filter(function (x) { return String(x.id) !== String(e.id); }).concat([e]);
        S.log.totals = data.totals || dayTotals(S.log.entries);
      }
      renderLog();
      refreshDependents();
      logChanged();
      setText('food-msg', e ? format(T.added, { label: e.label, k: kf(e.kcal) }) : '');
      if (!S.log || S.log.date !== body.date) loadLog();
      return e;
    }, function (err) {
      setText('food-msg', errText(err));
      // it may have been saved after all: re-read, and keep the id so a retry is the same add
      if (ambiguous(err)) loadLog();
      else delete guidePending[key];
      throw err;
    });
  }

  /** Constancia's day cells (client/adherence.js): Registrar shows `date` (a past day, or today) and
   * scrolls into view; false without the food API. */
  function showDay(date) {
    var d = HC.isoDate(date);
    if (!S.ok || !d) return false;
    goDay(d);
    var block = $('food-log-block');
    if (block && typeof block.scrollIntoView === 'function') block.scrollIntoView({ block: 'start' });
    var label = $('food-day-label');
    if (label && typeof label.focus === 'function') {
      if (label.setAttribute && !(label.hasAttribute && label.hasAttribute('tabindex'))) label.setAttribute('tabindex', '-1');
      label.focus();
    }
    return true;
  }

  window.HCFood = {
    // the one food API client (X-HC-Food, JSON, timeout, coarse codes): client/settings.js and
    // client/adherence.js reuse it, so every /api/food request carries the same layers
    api: api,
    ready: function () { return !!S.ok; },
    // the boot request (GET /products) has not answered yet: the intake rings render nothing meanwhile
    pending: function () { return !!S.boot; },
    showDay: showDay,
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
    basicIngredient: basicIngredient,
    groupTotals: groupTotals,
    recentDay: recentDay,
    products: guideProducts,
    addGuide: addGuide,
    state: function () { return S; }, // test-only: the tests read the in-memory state
  };
})();
