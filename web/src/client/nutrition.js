/* Registro day-builder — ported from the legacy day-builder IIFE in
 * data/nutrition/plan-web.html's `<script>` block, adapted to read its
 * DATA/EXTRAS/TARGET/etc from globals baked by web/src/components/Bake.astro
 * (see lib/nutrition/macros.mjs's buildNutrition() extraKeys/extraNames/
 * indulge/alcoholKeys/mealReplaceKeys) instead of hand-typed X/XN objects.
 *
 * Classic script (is:inline, no ES modules — see spec: Single self-contained
 * output), so this cannot `import` lib/nutrition/calc.mjs. The verdict
 * calculation below is a DELIBERATE, DOCUMENTED DUPLICATE of
 * lib/nutrition/calc.mjs's calcDay() algorithm (kept in sync by hand — that
 * file is the unit-tested source of truth for the algorithm itself; this
 * copy substitutes I18N_VERDICT/I18N_LOG format-string templates instead of
 * function calls since baked globals must be JSON-safe).
 *
 * "None" placeholder options (`{l:'— none —', none:1, ...}`) are detected
 * via `option.dataset.none === '1'` (set below in mkOpt from the baked
 * item's `none` field) instead of legacy's locale-fragile
 * `/ninguno|none/i.test(optionText)` regex.
 */
(function () {
  var X = {};
  EXTRA_KEYS.forEach(function (k) { X[k] = 0; });
  var LAST = { k: 0, p: 0, c: 0, g: 0 };

  function el(id) { return document.getElementById(id); }

  function format(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) {
      return vars && vars[k] != null ? vars[k] : '';
    });
  }

  function mkOpt(o) {
    var e = document.createElement('option');
    e.textContent = o.l;
    e.dataset.k = o.k;
    e.dataset.p = o.p;
    e.dataset.c = o.c;
    e.dataset.g = o.g;
    e.dataset.none = o.none ? '1' : '';
    return e;
  }
  function fill(id, arr) {
    var s = el(id);
    if (!s) return;
    s.innerHTML = '';
    arr.forEach(function (o) { s.appendChild(mkOpt(o)); });
  }
  function val(id) {
    var s = el(id);
    var o = s && s.options[s.selectedIndex];
    return o ? { k: +o.dataset.k, p: +o.dataset.p, c: +o.dataset.c, g: +o.dataset.g } : { k: 0, p: 0, c: 0, g: 0 };
  }
  function day() {
    var r = el('b-rest');
    return r && r.getAttribute('aria-pressed') === 'true' ? 'rest' : 'train';
  }
  function repopDay() {
    var d = day();
    fill('bld-carbo-comida', DATA.carboComida[d]);
    fill('bld-carbo-cena', DATA.carboCena[d]);
    fill('bld-postentreno', d === 'train' ? DATA.postentreno : DATA.anclaje);
    var lbl = el('bld-pe-label');
    if (lbl) lbl.textContent = d === 'train' ? PE_LABEL.train : PE_LABEL.rest;
  }
  function mac(l, n) { return '<div class="mac"><span class="lbl">' + l + '</span><b>' + n + ' g</b></div>'; }

  window.bump = function (key, delta) {
    X[key] = Math.max(0, (X[key] || 0) + delta);
    var cnt = el('x-' + key);
    if (cnt) cnt.textContent = X[key];
    recalc();
  };
  // core.js's generic bump() (DOM-only) is not used for THIS tab's steppers —
  // Registro registers the richer window.bump above (keeps X in sync for
  // buildDayText's extras summary) and core.js's bldRecalc hook is unused
  // here since bump is fully overridden. Kept only for setDay's bldRefresh.

  var indulgeSet = {};
  INDULGE.forEach(function (k) { indulgeSet[k] = 1; });

  function calcDay() {
    var d = day();
    var t = TARGET[d];
    var tot = { k: 0, p: 0, c: 0, g: 0 };
    ['bld-desayuno', 'bld-prot-comida', 'bld-carbo-comida', 'bld-postre-comida', 'bld-postentreno', 'bld-prot-cena', 'bld-carbo-cena', 'bld-postre-cena'].forEach(function (id) {
      var v = val(id);
      tot.k += v.k; tot.p += v.p; tot.c += v.c; tot.g += v.g;
    });
    var postreK = val('bld-postre-comida').k + val('bld-postre-cena').k;
    var exK = 0;
    EXTRA_KEYS.forEach(function (key) {
      var n = X[key] || 0;
      if (!n) return;
      var e = EXTRAS[key];
      if (!e) return;
      tot.k += n * e.k; tot.p += n * e.p; tot.c += n * e.c; tot.g += n * e.g;
      if (indulgeSet[key]) exK += n * e.k;
    });
    var rk = Math.round(tot.k), rp = Math.round(tot.p), rc = Math.round(tot.c), rg = Math.round(tot.g);

    var verdict = [];
    if (rp >= t.p - 10) verdict.push(['ok', format(I18N_VERDICT.proteinOk, { p: rp })]);
    else if (rp >= t.p - 40) verdict.push(['warn', format(I18N_VERDICT.proteinShort, { p: rp, t: t.p })]);
    else verdict.push(['bad', format(I18N_VERDICT.proteinVeryShort, { p: rp, t: t.p })]);

    var diff = rk - t.k;
    if (diff > 200) {
      var cuts = [];
      if (exK > 0) cuts.push(format(I18N_VERDICT.cutExtras, { kcal: Math.round(exK) }));
      if (postreK > 120) cuts.push(I18N_VERDICT.cutDessert);
      cuts.push(I18N_VERDICT.cutDinnerCarb);
      verdict.push(['bad', format(I18N_VERDICT.overBudget, { diff: diff, cuts: cuts.join(' · ') })]);
    } else if (diff < -300) {
      verdict.push(['warn', format(I18N_VERDICT.underBudget, { under: -diff })]);
    } else {
      verdict.push(['ok', format(I18N_VERDICT.onTarget, { signedDiff: (diff >= 0 ? '+' : '') + diff })]);
    }

    if (rg > t.fatMax) verdict.push(['warn', format(I18N_VERDICT.fatHigh, { g: rg })]);

    ALCOHOL_KEYS.forEach(function (key) {
      var n = X[key] || 0;
      if (n <= 0) return;
      var e = EXTRAS[key];
      if (!e) return;
      verdict.push(['warn', format(I18N_VERDICT.alcohol, { n: n, name: EXTRA_NAMES[key] || key, kcal: Math.round(n * e.k) })]);
    });

    var treatKeys = INDULGE.filter(function (k) { return ALCOHOL_KEYS.indexOf(k) === -1 && MEAL_REPLACE_KEYS.indexOf(k) === -1; });
    if (treatKeys.some(function (k) { return (X[k] || 0) > 0; })) verdict.push(['warn', I18N_VERDICT.sweetTreats]);

    MEAL_REPLACE_KEYS.forEach(function (key) {
      var n = X[key] || 0;
      if (n > 0) verdict.push(['warn', format(I18N_VERDICT.mealReplace, { name: EXTRA_NAMES[key] || key })]);
    });

    return { totals: { k: rk, p: rp, c: rc, g: rg }, verdict: verdict, target: t };
  }

  function recalc() {
    var res = calcDay();
    var t = res.target;
    el('r-kcal').innerHTML = res.totals.k + ' <span>' + format(I18N_LOG.kcalSuffix, { t: t.k }) + '</span>';
    el('r-macros').innerHTML = mac('Prot', res.totals.p) + mac('Carb', res.totals.c) + mac('Grasa', res.totals.g);
    el('r-verdict').innerHTML = res.verdict.map(function (x) { return '<div class="v-' + x[0] + '">' + x[1] + '</div>'; }).join('');
    LAST = res.totals;
  }

  /* ---- paint the equivalence tables from the SAME DATA/EXTRAS ----
     Table ids (tb-prot-lean, tb-cc-train, ...) live in the Tablas tab
     (web/src/tabs/Tablas.astro, astro-plan-web slice 4). el()/paint() stay
     a no-op via the `if(t)` guard whenever an id is absent (e.g. running
     this script against a fixture DOM that only has Registro's elements) —
     same graceful-degrade pattern as legacy. */
  function fnum(n) { return ('' + n).replace('.', ','); }
  function rowHtml(o) {
    var name = o.n + (o.note ? ' <small>' + o.note + '</small>' : '');
    return '<tr><td>' + name + '</td><td>' + (o.q || '') + '</td><td class="kc">' + o.k + '</td><td>' + fnum(o.p) + '</td><td>' + fnum(o.c) + '</td><td>' + fnum(o.g) + '</td></tr>';
  }
  function paint(id, arr) { var t = el(id); if (t) t.innerHTML = arr.map(rowHtml).join(''); }
  function eatable(arr) { return arr.filter(function (o) { return !o.none; }); }
  function byTier(t) { return DATA.proteina.filter(function (o) { return o.t === t; }); }
  /* The Postre/Dessert table's first row is a computed fruit-range summary
   * (kcal/carb min-max + average protein/fat over every fruit-cat postre
   * item — see lib/nutrition/macros.mjs's fruitSummary), not a single
   * DATA.postre entry, so it does not fit rowHtml()'s single-value shape.
   * FRUIT_SUMMARY is null when the plan has no fruit items (degrade to no
   * summary row, same convention as elsewhere). */
  function fruitSummaryRowHtml(fs) {
    if (!fs) return '';
    var label = '<button class="lnk" onclick="jump(\'acc-fruta\')">' + I18N_TABLAS.fruitPortionLabel + '</button>';
    return '<tr><td>' + label + '</td><td>' + I18N_TABLAS.fruitPortionQty + '</td><td class="kc">' + fs.kMin + '–' + fs.kMax + '</td><td>' + fnum(fs.p) + '</td><td>' + fs.cMin + '–' + fs.cMax + '</td><td>' + fnum(fs.g) + '</td></tr>';
  }

  paint('tb-prot-lean', byTier('lean'));
  paint('tb-prot-mod', byTier('mod'));
  paint('tb-prot-fat', byTier('fat'));
  paint('tb-cc-train', eatable(DATA.carboComida.train));
  paint('tb-cc-rest', eatable(DATA.carboComida.rest));
  paint('tb-cce-train', eatable(DATA.carboCena.train));
  paint('tb-cce-rest', eatable(DATA.carboCena.rest));
  paint('tb-pe', eatable(DATA.postentreno));
  paint('tb-anclaje', eatable(DATA.anclaje));
  paint('tb-fruta', DATA.postre.filter(function (o) { return o.cat === 'fruit'; }));
  var tbPostre = el('tb-postre');
  if (tbPostre) tbPostre.innerHTML = fruitSummaryRowHtml(FRUIT_SUMMARY) + DATA.postre.filter(function (o) { return o.cat === 'yogurt'; }).map(rowHtml).join('');
  paint('tb-verduras', VEG_KEYS.map(function (k) { return EXTRAS[k]; }));
  paint('tb-quesos', QUESO_KEYS.map(function (k) { return EXTRAS[k]; }));

  fill('bld-desayuno', DATA.desayuno);
  fill('bld-prot-comida', DATA.proteina);
  fill('bld-prot-cena', DATA.proteina);
  fill('bld-postre-comida', DATA.postre);
  fill('bld-postre-cena', DATA.postre);
  repopDay();
  window.bldRefresh = function () { repopDay(); recalc(); };
  ['bld-desayuno', 'bld-prot-comida', 'bld-carbo-comida', 'bld-postre-comida', 'bld-postentreno', 'bld-prot-cena', 'bld-carbo-cena', 'bld-postre-cena'].forEach(function (id) {
    var elm = el(id);
    if (elm) elm.addEventListener('change', recalc);
  });

  /* ---- copy the day's selections + computed totals as plain text ---- */
  function todayStr() {
    var dt = new Date(), m = ('0' + (dt.getMonth() + 1)).slice(-2), da = ('0' + dt.getDate()).slice(-2);
    return dt.getFullYear() + '-' + m + '-' + da;
  }
  function pick(id) {
    var s = el(id);
    var o = s && s.options[s.selectedIndex];
    if (!o || o.dataset.none === '1') return null;
    return o.textContent;
  }
  function combine() {
    var parts = Array.prototype.slice.call(arguments).map(pick).filter(Boolean);
    return parts.length ? parts.join(' + ') : null;
  }
  function bldMsg(t) {
    var m = el('bld-msg');
    if (!m) return;
    m.textContent = t;
    if (t) setTimeout(function () { if (m.textContent === t) m.textContent = ''; }, 5000);
  }
  function buildDayText() {
    recalc();
    var d = day(), t = TARGET[d];
    var dayLabel = d === 'train' ? I18N_LOG.dayLabelTrain : I18N_LOG.dayLabelRest;
    var lines = [format(I18N_LOG.header, { date: todayStr(), dayLabel: dayLabel })];
    var des = pick('bld-desayuno'); if (des) lines.push(format(I18N_LOG.breakfast, { v: des }));
    var com = combine('bld-prot-comida', 'bld-carbo-comida', 'bld-postre-comida'); if (com) lines.push(format(I18N_LOG.lunch, { v: com }));
    var pe = pick('bld-postentreno');
    if (pe) {
      var peLbl = el('bld-pe-label');
      var lbl = peLbl ? peLbl.textContent : '';
      lines.push(lbl ? lbl + ': ' + pe : pe);
    }
    var cen = combine('bld-prot-cena', 'bld-carbo-cena', 'bld-postre-cena'); if (cen) lines.push(format(I18N_LOG.dinner, { v: cen }));
    var ex = EXTRA_KEYS.filter(function (k) { return (X[k] || 0) > 0; }).map(function (k) { return X[k] + '× ' + (EXTRA_NAMES[k] || k); });
    if (ex.length) lines.push(format(I18N_LOG.extras, { v: ex.join(', ') }));
    var notesEl = el('bld-notes');
    var notes = notesEl ? notesEl.value.trim() : '';
    if (notes) lines.push(format(I18N_LOG.offPlan, { v: notes }));
    lines.push(format(I18N_LOG.total, { k: LAST.k, p: LAST.p, c: LAST.c, g: LAST.g, tk: t.k, tp: t.p }));
    return lines.join('\n');
  }
  function copyDay() {
    var text = buildDayText();
    var ta = el('bld-output');
    ta.style.display = 'block';
    ta.value = text;
    ta.focus();
    ta.select();
    function fallback() {
      try { document.execCommand('copy'); bldMsg(COPY_MSG); } catch (e) { bldMsg(COPY_FALLBACK_MSG); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { bldMsg(COPY_MSG); }, fallback);
    } else {
      fallback();
    }
  }
  var copyBtn = el('bld-copy');
  if (copyBtn) copyBtn.addEventListener('click', copyDay);

  recalc();
})();
