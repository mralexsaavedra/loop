/* Home tab: recovery TREND (MAD units, never a 0-100 grade) + per-modality load,
 * rendered client-side from SCORES / I18N_SCORE / LOCALE baked by components/Bake.astro.
 *
 * Classic script (is:inline, no module scope). Only `asOf` is baked: staleness is computed here
 * from Date.now(), so consecutive builds stay byte-identical. Colour is used only on the
 * direction arrows and the dials' meaning colours. Advice uses the same templates and number formatting as
 * lib/score/advice-copy.mjs (a test asserts the two sentences are identical).
 *
 * Dials (Sleep / Recovery / Load): all geometry comes pre-computed in DIALS (web/src/view/dial.mjs,
 * baked by components/Bake.astro); this file only formats the baked numbers and joins SVG strings.
 * Today first: recovery = last night's composite with the 7-day trend underneath, load = the day's
 * RE vs the typical training day with acute/chronic as the caption. The "last night" / "today" /
 * "yesterday" words are decided here from Date.now(), never baked.
 */
// Load dial modality switch: shows the chosen modality's dial + caption, hides the others.
function scMod(key, btn) {
  var root = btn && btn.closest ? btn.closest('.sc-dials') : null;
  if (!root) return;
  root.querySelectorAll('[data-dmod]').forEach(function (el) {
    if (el.classList.contains('dial-mod')) el.setAttribute('aria-pressed', el === btn ? 'true' : 'false');
    else el.hidden = el.getAttribute('data-dmod') !== key;
  });
}
(function () {
  var host = document.getElementById('home');
  if (!host) return;
  var T = I18N_SCORE;
  var S = typeof SCORES === 'undefined' ? null : SCORES;
  var STALE_DAYS = HC.STALE_DAYS; // older data is greyed and gets no advice (baked)
  var ES = HC.isEs();
  // score cards open their detail (Salud / Entreno) — only when that tab is reachable (its nav
  // button exists, i.e. page.hideTabs does not hide it)
  function linkAttrs(id, tab) {
    tab = tab || 'health';
    if (!document.getElementById('t-' + tab)) return '';
    var call = "jumpOr('" + id + "','" + tab + "')";
    return ' role="button" tabindex="0" onclick="' + call + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + call + '}"';
  }

  // shared helpers (web/src/client/util.js)
  var esc = HC.esc, format = HC.format, num = HC.num, isoDate = HC.isoDate, daysOld = HC.daysOld, todayIso = HC.todayIso;
  function pct(x) {
    return num(x, 0, true) + (ES ? ' %' : '%');
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
  var GLYPH = { above: '▲', ramping: '▲', below: '▼', detraining: '▼', at: '■', steady: '■' };
  function arrow(band) {
    var g = GLYPH[band] || GLYPH.at;
    return '<span class="sc-arrow sc-arrow-' + esc(band) + '" aria-hidden="true">' + g + '</span>';
  }
  function asOfHtml(iso) {
    iso = isoDate(iso);
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
    if (R.today) {
      // "Last night" only when that day has a sleep-duration reading; otherwise the date + "no sleep data"
      // ...and only when it is dated the viewer's today; an older night carries its date
      var tv = { date: isoDate(R.today.date) || '', value: num(R.today.value, 1, true) };
      var tl = R.today.sleep === false ? format(rt.todayNoSleepLbl, tv)
        : daysOld(R.today.date) === 0 ? format(rt.todayLbl, tv)
        : format(rt.todayDateLbl, tv);
      out.push('<div class="sc-today sc-band-' + esc(R.today.band) + '">' + esc(tl) + ' · ' + esc(rt.bands[R.today.band]) + '</div>');
    } else {
      out.push('<div class="sc-note">' + esc(rt.noToday) + '</div>');
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
      ['scored', 'unscored', 'invalid', 'droppedJunk', 'superseded', 'preEpoch'].map(function (k) {
        return '<span><b class="sc-cov-' + k + '">' + (c[k] || 0) + '</b> ' + esc(lt.coverage[k]) + '</span>';
      }).join(' · ') + '</div>');
    out.push('<div class="sc-note">' + esc(isoDate(L.reEpoch) ? format(lt.preEpochNote, { date: L.reEpoch }) : lt.noEpochNote) + '</div>');
    out.push('</div>');
    return out.join('');
  }

  function caveatsHtml() {
    var keys = ['re', 'notComparable', 'gymLabel', 'noEpoch', 'residual', 'sdnn', 'notMedical'];
    return '<div class="sc-card"><div class="sc-head"><h3>' + esc(T.caveatsHeading) + '</h3></div><ul class="sc-caveats">' +
      keys.map(function (k) { return '<li class="sc-caveat">' + esc(T.caveats[k]) + '</li>'; }).join('') + '</ul></div>';
  }


  /* ---- dials ---- */
  var D = typeof DIALS === 'undefined' ? null : DIALS;
  function attr(v) { return esc(String(v)); }
  // parts: zones [{cls, d}], fill d, dot {x,y}, mid {x,y}; paths are baked, never computed here
  function dialSvg(parts) {
    var out = ['<svg class="dial-svg" viewBox="0 0 120 120" aria-hidden="true">'];
    out.push('<path class="dial-track" d="' + attr(D.track) + '"/>');
    (parts.zones || []).forEach(function (z) {
      if (z.d) out.push('<path class="dial-zone ' + attr(z.cls) + '" d="' + attr(z.d) + '"/>');
    });
    if (parts.fill) out.push('<path class="dial-fill" pathLength="100" d="' + attr(parts.fill) + '"/>');
    if (parts.mid) out.push('<circle class="dial-mid" cx="' + attr(parts.mid.x) + '" cy="' + attr(parts.mid.y) + '" r="2"/>');
    if (parts.dot) out.push('<circle class="dial-dot" cx="' + attr(parts.dot.x) + '" cy="' + attr(parts.dot.y) + '" r="6.5"/>');
    out.push('</svg>');
    return out.join('');
  }
  // Whoop-style drill-down: the dial is the glance, a tap opens its detail in another tab
  var DIAL_LINK = { 'dial-sleep': ['hl-sleep', 'health'], 'dial-rec': ['hl-recovery', 'health'], 'dial-load': ['score-load', 'entreno'] };
  function dialFig(cls, stale, extra, aria, svg, centre, label, sub) {
    var to = DIAL_LINK[cls.split(' ')[0]];
    return '<figure class="dial ' + cls + (stale ? ' sc-stale' : '') + '"' + (extra || '') + (to ? linkAttrs(to[0], to[1]) : '') + '>' +
      '<div class="dial-ring"' + (aria ? ' role="img" aria-label="' + attr(aria) + '"' : '') + '>' + svg +
      '<div class="dial-centre" aria-hidden="true">' + centre + '</div></div>' +
      '<figcaption class="dial-lbl">' + esc(label) + '</figcaption>' +
      (sub ? '<div class="dial-sub">' + sub + '</div>' : '') + '</figure>';
  }
  function offCentre(word) {
    return '<span class="dial-word">' + esc(word) + '</span>';
  }
  function sleepDial(d, dt) {
    var target = d.target != null ? num(d.target, 1, false) : '';
    if (d.state !== 'ok') return dialFig('dial-sleep dial-off', false, '', '', dialSvg({}), offCentre(dt.none), dt.sleep.label, '');
    var h = num(d.hours, 1, false);
    return dialFig('dial-sleep', isStale(d.date), '', format(dt.sleep.aria, { value: h, target: target }),
      dialSvg({ fill: d.fill, dot: d.marker }),
      '<b class="dial-num">' + esc(h) + '<small> h</small></b>',
      dt.sleep.label, esc(format(dt.sleep.target, { value: target })));
  }
  // "Last night" only when the night's data is dated today AND has a sleep reading; else its date
  function nightLbl(iso, hasSleep, rt) {
    return daysOld(iso) === 0 && hasSleep ? rt.lastNight : format(T.asOfLbl, { date: isoDate(iso) || '' });
  }
  // one modality's state for the viewer's today: 'trained' (RE > 0), 'noEffort' (rows, no RE), 'rest'
  function loadToday(m) {
    var t = todayIso();
    var day = null;
    (m.days || []).forEach(function (x) { if (x.date === t) day = x; });
    if (day && day.re > 0) return { kind: 'trained', day: day };
    if (day && day.unscored > 0) return { kind: 'noEffort', day: day };
    return { kind: 'rest', day: null };
  }
  function recDial(d, dt) {
    var rt = dt.recovery;
    if (d.state !== 'ok') {
      var word = d.state === 'gated' ? rt.gated : dt.none;
      return dialFig('dial-rec dial-off', isStale(d.asOf), '', '', dialSvg({}), offCentre(word), rt.label, esc(rt.sub));
    }
    var v = num(d.value, 1, true);
    var zones = d.zones.map(function (z) { return { cls: 'dial-zone-' + z.band, d: z.d }; });
    var tr = d.trend || {};
    var trendTxt = tr.dir && rt.dirs[tr.dir]
      ? format(rt.trendLine, { dir: rt.dirs[tr.dir], value: num(tr.value, 1, true) })
      : format(rt.trendLineNoDir, { value: num(tr.value, 1, true) });
    var today = d.mode === 'today';
    var when = today ? nightLbl(d.date, d.sleep !== false, rt) : '';
    var sub = today
      ? '<span class="dial-when">' + esc(when) + '</span>' + (d.sleep === false ? '<span class="dial-when dial-nodata">' + esc(rt.noSleep) + '</span>' : '') +
        '<span class="dial-trend">' + esc(trendTxt) + '</span>'
      : '<span class="dial-when dial-nodata">' + esc(rt.noLastNight) + '</span>';
    var aria = today
      ? format(rt.aria, { when: when, value: v, band: rt.bands[d.band] })
      : format(rt.ariaTrend, { value: v, band: rt.bands[d.band] });
    return dialFig('dial-rec dial-band-' + esc(d.band), isStale(d.asOf), '', aria,
      dialSvg({ zones: zones, fill: d.fill, dot: d.marker }),
      '<span class="dial-word">' + esc(rt.bands[d.band]) + '</span><b class="dial-num dial-num-sm">' + esc(format(rt.delta, { value: v })) + '</b>',
      rt.label, sub);
  }
  // The modality the switch opens on, for the VIEWER's today (never baked): the modality with a
  // session today, gated or not (a gated one opens in its gated state) — highest RE first, ties by
  // modality order, a session without RE still beats nothing — else the baked default (the first
  // ungated one).
  function openKey(d) {
    var best = null, bestRe = -1;
    d.modalities.forEach(function (m) {
      var td = loadToday(m);
      var re = td.kind === 'trained' ? td.day.re : td.kind === 'noEffort' ? 0 : -1;
      if (re > bestRe) { best = m.key; bestRe = re; }
    });
    return best || d.defaultKey;
  }
  function loadDials(d, dt) {
    var lt = dt.load;
    var stale = isStale(d.asOf);
    var open = openKey(d);
    var figs = d.modalities.map(function (m) {
      var hid = m.key === open ? '' : ' hidden';
      var extra = ' data-dmod="' + attr(m.key) + '"' + hid;
      var mod = T.load.modalities[m.key] || m.key;
      if (m.state !== 'ok') {
        return dialFig('dial-load dial-off', stale, extra, '', dialSvg({ mid: d.mid }), offCentre(lt.gated), lt.label, esc(mod));
      }
      var typ = num(m.typical, 0, false);
      var td = loadToday(m);
      if (td.kind === 'noEffort') {
        return dialFig('dial-load dial-noeffort', stale, extra, format(lt.ariaNoEffort, { modality: mod, typical: typ }),
          dialSvg({ mid: d.mid }), offCentre(lt.noEffort), lt.label, esc(mod));
      }
      if (td.kind === 'rest') {
        return dialFig('dial-load dial-rest', stale, extra, format(lt.ariaRest, { modality: mod, typical: typ }),
          dialSvg({ mid: d.mid }), offCentre(lt.rest), lt.label, esc(mod));
      }
      var day = num(td.day.re, 0, false);
      return dialFig('dial-load', stale, extra, format(lt.aria, { modality: mod, day: day, typical: typ }),
        dialSvg({ fill: td.day.fill, dot: td.day.marker, mid: d.mid }),
        '<b class="dial-num">' + esc(day) + '</b><span class="dial-word">' + esc(lt.unit) + '</span>',
        lt.label, esc(mod));
    });
    return figs.join('');
  }
  function loadSwitch(d, dt) {
    var open = openKey(d);
    var btns = d.modalities.map(function (m) {
      return '<button type="button" class="dial-mod" data-dmod="' + attr(m.key) + '" aria-pressed="' + (m.key === open ? 'true' : 'false') +
        '" onclick="scMod(\'' + attr(m.key) + '\',this)">' + esc(T.load.modalities[m.key] || m.key) + '</button>';
    }).join('');
    // caption per modality: the day vs its typical day, then the acute/chronic trend as context;
    // a gated modality keeps its existing copy
    var lt = dt.load;
    var caps = d.modalities.map(function (m) {
      var txt;
      if (m.state === 'ok') {
        var typ = num(m.typical, 0, false);
        var td = loadToday(m);
        var head = td.kind === 'trained' ? format(lt.dayLine, { day: num(td.day.re, 0, false), typical: typ })
          : td.kind === 'noEffort' ? format(lt.noEffortLine, { typical: typ })
          : m.last && isoDate(m.last.date) ? format(lt.restLastLine, { date: m.last.date, re: num(m.last.re, 0, false), typical: typ })
          : format(lt.restLine, { typical: typ });
        txt = head + ' · ' + format(T.load.trendLbl, { pct: pct(m.trendPct) }) + ' · ' + T.load.bands[m.band];
      } else {
        txt = T.load.gated[m.reason] || T.load.gated.baselineBuilding;
      }
      return '<div class="dial-cap" data-dmod="' + attr(m.key) + '"' + (m.key === open ? '' : ' hidden') + '>' + esc(txt) + '</div>';
    }).join('');
    return '<div class="dial-foot"><div class="dial-switch" role="group" aria-label="' + attr(dt.load.switchLabel) + '">' +
      '<span class="dial-switch-lbl">' + esc(dt.load.label) + '</span>' + btns + '</div>' +
      '<div class="dial-scale">' + esc(dt.load.scale) + '</div>' + caps + '</div>';
  }
  // Data honesty: the full caveats live with each dial's detail (load: Entreno #score-load,
  // recovery: Salud). When page.hideTabs makes that detail unreachable (tab hidden, or Entreno's
  // load section hidden), a compact caveat line goes under the dials instead.
  function detailReachable(tab, sectionId) {
    if (!document.getElementById('t-' + tab)) return false;
    var sec = sectionId ? document.getElementById(sectionId) : null;
    return !(sec && sec.hidden);
  }
  function caveatLines(dt, hasLoad) {
    var out = '';
    if (D.recovery && D.recovery.state === 'ok' && !detailReachable('health') && dt.recovery.caveatLine) {
      out += '<div class="dial-caveat dial-caveat-rec">' + esc(dt.recovery.caveatLine) + '</div>';
    }
    if (hasLoad && !detailReachable('entreno', 'sec-load') && dt.load.caveatLine) {
      out += '<div class="dial-caveat dial-caveat-load">' + esc(dt.load.caveatLine) + '</div>';
    }
    return out;
  }
  function dialsHtml() {
    if (!D || !T.dials) return '';
    var dt = T.dials;
    var hasLoad = D.load && D.load.state === 'ok';
    return '<div class="sc-card sc-dials" role="group" aria-label="' + attr(dt.ariaLabel) + '"><div class="dials">' +
      sleepDial(D.sleep || {}, dt) + recDial(D.recovery || {}, dt) +
      (hasLoad ? loadDials(D.load, dt) : dialFig('dial-load dial-off', false, '', '', dialSvg({}), offCentre(dt.none), dt.load.label, '')) +
      '</div>' + (hasLoad ? loadSwitch(D.load, dt) : '') + caveatLines(dt, hasLoad) + '</div>';
  }

  // one broken block must never blank Inicio: render it as an empty state instead (or `fallback`,
  // e.g. '' for the optional advice sentence)
  function safe(fn, arg, fallback) {
    try {
      return fn(arg);
    } catch (e) {
      return fallback != null ? fallback : '<div class="sc-card sc-card-error">' + esc((T.recovery && T.recovery.cardError) || '') + '</div>';
    }
  }

  // Writes one host inside its own try/catch: a throwing block or host never stops the others.
  function write(id, fn) {
    var el = typeof id === 'string' ? document.getElementById(id) : id;
    if (!el) return;
    try {
      el.innerHTML = fn();
    } catch (e) {
      /* this host keeps whatever it had; the other blocks still render */
    }
  }
  function emptyHtml() {
    return '<div class="train-empty">' + esc(T.emptyMsg) + '</div>';
  }
  function adviceHtml() {
    var anyStale = (S.recovery && isStale(S.recovery.asOf)) || (S.load && isStale(S.load.asOf));
    if (!S.advice || anyStale || !T.advice[S.advice.key]) return '';
    return '<div class="sc-card sc-advice">' + esc(adviceText(S.advice)) + '</div>';
  }

  // Glance vs detail (Whoop): Inicio keeps the dials + the advice sentence; the recovery card is the
  // detail behind the recovery dial (Salud, #score-recovery), the per-modality load cards + caveats
  // the detail behind the load dial (Entreno, #score-load). A missing host skips its block; with no
  // data every host gets the empty state.
  function render() {
    if (!S || !S.hasData) {
      write(host, emptyHtml);
      write('score-recovery', emptyHtml);
      write('score-load', emptyHtml);
      return;
    }
    // Home.astro gives the dials their own host above the health monitor; without it they lead #home
    var dialsHost = document.getElementById('home-dials');
    if (dialsHost) write(dialsHost, function () { return safe(dialsHtml); });
    // the advice sentence reads as the conclusion of the dials above it
    write(host, function () { return (dialsHost ? '' : safe(dialsHtml)) + safe(adviceHtml, null, ''); });
    if (S.recovery) write('score-recovery', function () { return safe(recoveryHtml, S.recovery); });
    write('score-load', function () { return (S.load ? safe(loadHtml, S.load) : '') + safe(caveatsHtml); });
  }
  render();
})();
