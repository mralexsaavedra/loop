/* Tablas (the equivalence reference fold of Nutrición, web/src/tabs/Tablas.astro): paints the
 * `tb-*` table bodies (protein tiers, lunch / dinner carbs, post-workout, protein anchor, fruit +
 * dessert, vegetables, cheeses) from the DATA / EXTRAS / VEG_KEYS / QUESO_KEYS / FRUIT_SUMMARY /
 * I18N_TABLAS globals baked by web/src/components/Bake.astro. Breakfasts are server-rendered there.
 * Classic script (is:inline). It used to live inside the day builder (client/nutrition.js), removed
 * when the food log's "Del plan" tab replaced it; the tables are unchanged. A missing host (a fixture
 * DOM) is skipped, never a throw. */
(function () {
  function el(id) { return document.getElementById(id); }

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
})();
