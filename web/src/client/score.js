/* "Inicio / Home" tab: recovery TREND (MAD units, never a 0-100 grade) + per-modality load,
 * rendered client-side from SCORES / I18N_SCORE / LOCALE baked by components/Bake.astro.
 *
 * Classic script (is:inline, no module scope). Only `asOf` is baked: staleness is computed here
 * from Date.now(), so consecutive builds stay byte-identical. Colour is used only on the
 * direction arrows. Advice uses the same templates and number formatting as
 * lib/score/advice-copy.mjs (a test asserts the two sentences are identical).
 */
(function () {
  var host = document.getElementById('home');
  if (!host) return;
  var T = I18N_SCORE;
  var S = typeof SCORES === 'undefined' ? null : SCORES;
  var STALE_DAYS = 3;
  var ES = LOCALE === 'es';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function format(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) {
      return vars && vars[k] != null ? vars[k] : '';
    });
  }
  // fixed decimals, optional leading "+"; a value that rounds to zero carries no sign
  function num(x, dec, signed) {
    var s = Number(x).toFixed(dec);
    if (Number(s) === 0) s = (0).toFixed(dec);
    else if (signed && Number(s) > 0) s = '+' + s;
    return ES ? s.replace('.', ',') : s;
  }
  function pct(x) {
    return num(x, 0, true) + (ES ? ' %' : '%');
  }
  function daysOld(iso) {
    if (!iso) return null;
    var p = iso.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var n = new Date(Date.now());
    n = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    return Math.round((n - d) / 86400000);
  }
  function isStale(iso) {
    var d = daysOld(iso);
    return d != null && d > STALE_DAYS;
  }
  function sparkSvg(values) {
    var v = (values || []).filter(function (x) { return x != null; });
    if (v.length < 2) return '';
    var n = v.length, mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), rng = mx - mn || 1, pad = 10;
    var pts = v.map(function (y, i) {
      return (100 * i / (n - 1)).toFixed(2) + ',' + (pad + (100 - 2 * pad) * (1 - (y - mn) / rng)).toFixed(2);
    });
    return (
      '<svg class="spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="area" d="M0,100 L' + pts.join(' L') + ' L100,100 Z"/>' +
      '<path class="line" d="M' + pts.join(' L') + '"/></svg>'
    );
  }
  function arrow(band) {
    var g = band === 'above' || band === 'ramping' ? '▲' : band === 'below' || band === 'detraining' ? '▼' : '■';
    return '<span class="sc-arrow sc-arrow-' + esc(band) + '" aria-hidden="true">' + g + '</span>';
  }
  function asOfHtml(iso) {
    return iso ? '<span class="sc-asof">' + esc(format(T.asOfLbl, { date: iso })) + '</span>' : '';
  }
  function staleHtml(iso) {
    return '<div class="sc-stale-note">' + esc(format(T.staleNote, { days: daysOld(iso) })) + '</div>';
  }

  /* ---- advice (mirror of lib/score/advice-copy.mjs renderAdvice) ---- */
  function adviceText(a) {
    var v = a.vars || {};
    var fill = {
      trend7: v.trend7 == null ? '' : num(v.trend7, 1, true),
      trend7Abs: v.trend7 == null ? '' : num(Math.abs(v.trend7), 1, false),
      delta7: v.delta7 == null ? '' : num(v.delta7, 1, true),
      trendPct: v.trendPct == null ? '' : pct(v.trendPct),
      modality: ADV_MOD[v.modality] || v.modality || '',
    };
    return T.advice[a.key].replace(/\{(\w+)\}/g, function (_, k) { return k in fill ? fill[k] : ''; });
  }
  var ADV_MOD = ES ? { gym: 'gimnasio', run: 'carrera', bike: 'bici' } : { gym: 'gym', run: 'run', bike: 'bike' };

  /* ---- recovery ---- */
  function recoveryHtml(R) {
    var stale = isStale(R.asOf);
    var rt = T.recovery;
    var out = ['<div class="sc-card sc-recovery' + (stale ? ' sc-stale' : '') + '">'];
    out.push('<div class="sc-head"><h3>' + esc(rt.heading) + '</h3>' + asOfHtml(R.asOf) + '</div>');
    if (stale) out.push(staleHtml(R.asOf));
    if (R.gated) {
      out.push('<div class="sc-insufficient">' + esc(rt.insufficient) + '</div></div>');
      return out.join('');
    }
    out.push('<div class="sc-val">' + arrow(R.band) + '<span class="sc-num">' + esc(format(rt.trendLbl, { value: num(R.trend7, 1, true) })) + '</span></div>');
    out.push('<div class="sc-sub sc-band-' + esc(R.band) + '">' + esc(rt.bands[R.band]) +
      (R.delta7 != null ? ' · ' + esc(format(rt.deltaLbl, { value: num(R.delta7, 1, true) })) : '') + '</div>');
    out.push('<div class="sc-spark">' + sparkSvg(R.spark && R.spark.v) + '<div class="sc-spark-lbl">' + esc(rt.sparkLbl) + '</div></div>');
    out.push('<div class="sc-chips"><span class="sc-chip">' + esc(format(rt.confLbl, { level: rt.confLevels[R.confidence.level] })) + '</span>' +
      '<span class="sc-chip">' + esc(rt.sdnnLbl) + '</span></div>');
    (R.components || []).forEach(function (c) {
      var dec = c.unit === 'h' ? 2 : c.unit === 'min' ? 0 : 1;
      out.push('<div class="sc-comp"><div class="sc-comp-top">' + arrow(c.band) +
        '<b>' + esc(rt.components[c.key]) + '</b>' +
        '<span class="sc-comp-val">' + esc(num(c.trend7, 1, true)) + ' MAD</span>' +
        '<span class="sc-comp-base">' + esc(format(rt.baselineLbl, { value: num(c.baseline, dec, false), unit: c.unit })) + ' · ' + esc(format(rt.nLbl, { n: c.n })) + '</span></div>' +
        '<div class="sc-raw"><span class="sc-raw-lbl">' + esc(format(rt.last14Lbl, { unit: c.unit })) + '</span>' +
        c.daily.map(function (d) { return '<span class="sc-raw-v">' + esc(num(d.value, dec, false)) + '</span>'; }).join('') +
        '</div></div>');
    });
    if (R.missing && R.missing.length) {
      out.push('<div class="sc-note">' + esc(format(rt.missingLbl, { list: R.missing.map(function (k) { return rt.components[k]; }).join(', ') })) + '</div>');
    }
    if (R.driver) out.push('<div class="sc-note">' + esc(format(rt.driverLbl, { name: rt.components[R.driver] })) + '</div>');
    out.push('</div>');
    return out.join('');
  }

  /* ---- load ---- */
  function loadCard(m) {
    var lt = T.load;
    var out = ['<div class="sc-load-card" data-mod="' + esc(m.key) + '">'];
    out.push('<div class="sc-comp-top"><b>' + esc(lt.modalities[m.key]) + '</b><span class="sc-comp-val">' + esc(format(lt.dayRe, { value: num(m.load, 0, false) })) + '</span></div>');
    out.push('<div class="sc-sub">' + (m.relScore != null
      ? esc(format(lt.relLbl, { score: m.relScore, modality: ADV_MOD[m.key] }))
      : esc(lt.noRel)) + '</div>');
    if (m.trend && m.trend.ok) {
      out.push('<div class="sc-sub">' + arrow(m.trend.band) + esc(format(lt.trendLbl, { pct: pct(m.trend.trendPct) })) + ' · ' + esc(lt.bands[m.trend.band]) + '</div>');
    } else {
      out.push('<div class="sc-gated">' + esc(lt.gated[(m.trend && m.trend.reason) || 'baselineBuilding']) + '</div>');
    }
    out.push('<div class="sc-spark">' + sparkSvg(m.spark && m.spark.v) + '</div>');
    out.push('</div>');
    return out.join('');
  }
  function loadHtml(L) {
    var lt = T.load;
    var stale = isStale(L.asOf);
    var out = ['<div class="sc-card sc-load' + (stale ? ' sc-stale' : '') + '">'];
    out.push('<div class="sc-head"><h3>' + esc(lt.heading) + '</h3>' + asOfHtml(L.asOf) + '</div>');
    if (stale) out.push(staleHtml(L.asOf));
    out.push(L.modalities.map(loadCard).join(''));
    var o = L.other || {};
    out.push('<div class="sc-other">' + esc(format(lt.otherLine, { days: o.windowDays || 28, minutes: num(o.minutes || 0, 0, false), re: num(o.re || 0, 0, false), sessions: o.sessions || 0 })) + '</div>');
    var c = L.coverage || {};
    out.push('<div class="sc-cov"><b>' + esc(lt.coverageHeading) + ':</b> ' +
      ['scored', 'unscored', 'invalid', 'droppedJunk', 'preEpoch'].map(function (k) {
        return '<span><b class="sc-cov-' + k + '">' + (c[k] || 0) + '</b> ' + esc(lt.coverage[k]) + '</span>';
      }).join(' · ') + '</div>');
    out.push('<div class="sc-note">' + esc(L.reEpoch ? format(lt.preEpochNote, { date: L.reEpoch }) : lt.noEpochNote) + '</div>');
    out.push('</div>');
    return out.join('');
  }

  function caveatsHtml() {
    var keys = ['re', 'notComparable', 'gymLabel', 'noEpoch', 'residual', 'sdnn', 'notMedical'];
    return '<div class="sc-card"><div class="sc-head"><h3>' + esc(T.caveatsHeading) + '</h3></div><ul class="sc-caveats">' +
      keys.map(function (k) { return '<li class="sc-caveat">' + esc(T.caveats[k]) + '</li>'; }).join('') + '</ul></div>';
  }

  function render() {
    if (!S || !S.hasData) {
      host.innerHTML = '<div class="train-empty">' + esc(T.emptyMsg) + '</div>';
      return;
    }
    var out = [];
    var anyStale = (S.recovery && isStale(S.recovery.asOf)) || (S.load && isStale(S.load.asOf));
    if (S.advice && !anyStale && T.advice[S.advice.key]) {
      out.push('<div class="sc-card sc-advice">' + esc(adviceText(S.advice)) + '</div>');
    }
    if (S.recovery) out.push(recoveryHtml(S.recovery));
    if (S.load) out.push(loadHtml(S.load));
    out.push(caveatsHtml());
    host.innerHTML = out.join('');
  }
  render();
})();
