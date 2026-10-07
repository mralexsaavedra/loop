/* Dial deep-dive pages: the detail sheet of the three Inicio dials (sleep, recovery, load-<modality>)
 * laid out as one page — a "‹ TODAY ⓘ" header, the big hero ring (the SAME baked geometry as the dial,
 * view/dial.mjs via the DIALS global), an insight card (the dial's former captions in 2–4 plain lines +
 * a "View trend →" link down to the history chart) and, collapsed under ⓘ, the long notes (bands,
 * scale, rules). Same data and rules as the dial and the rest of the sheet: nothing new is computed
 * here, only read from DETAIL / DIALS and laid out.
 *
 * Classic script (is:inline), inlined right BEFORE client/detail.js, which calls it: window.HCDeep =
 * {isDial(key), render(key, m, end, X) -> {head, top}}. X = the sheet's own helpers (copy, series
 * access, number formatting, the band notes), injected so both files read one set of rules. The
 * header's back button is the sheet's close button (data-dt-act="close"); ⓘ (data-dt-act="info") and
 * the CTA (data-dt-act="trend") are handled by detail.js's one delegated listener.
 */
(function () {
  var esc = HC.esc, format = HC.format, isoDate = HC.isoDate;
  // the hero ring's track when no DIALS geometry is baked: the dial's own circle (view/dial.mjs DIAL)
  var RING = { c: 60, r: 54 };
  var BAND_CLS = { above: 'good', at: 'mid', below: 'low' };
  var BAND_STATE = { above: 'good', at: 'normal', below: 'bad' };

  function isDial(key) {
    return key === 'sleep' || key === 'recovery' || /^load-[a-z]+$/.test(String(key));
  }
  function dials() {
    return typeof DIALS !== 'undefined' && DIALS ? DIALS : null;
  }
  function loadDialOf(mod) {
    var D = dials(), out = null;
    var list = D && D.load && Array.isArray(D.load.modalities) ? D.load.modalities : [];
    list.forEach(function (x) { if (x && x.key === mod) out = x; });
    return out;
  }
  function stale(iso) {
    var d = isoDate(iso);
    return !!d && HC.daysOld(d) > HC.STALE_DAYS;
  }
  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /* ---------- header ---------- */
  function headHtml(key, X) {
    var P = X.T.deep;
    return '<div class="dt-head dd-head">' +
      '<button type="button" class="dd-back" data-dt-act="close" aria-label="' + esc(P.back) + '">‹</button>' +
      '<span class="dd-today" aria-hidden="true">' + esc(P.today) + '</span>' +
      '<h2 class="sr-only" id="dt-title">' + esc(X.titleOf(key)) + '</h2>' +
      '<button type="button" class="dd-info-btn" data-dt-act="info" aria-expanded="false" aria-controls="dd-info" aria-label="' + esc(P.info) + '">i</button>' +
      '</div>';
  }

  /* ---------- hero ring ---------- */
  // h: {cls (colour), fill (baked path | null), tick (load: typical day), num + unit | word, label, stale}
  function heroHtml(h, X) {
    var D = dials();
    var track = D && D.track ? '<path class="dd-track" d="' + esc(D.track) + '"/>' : '<circle class="dd-track" cx="' + RING.c + '" cy="' + RING.c + '" r="' + RING.r + '"/>';
    var svg = '<svg class="dd-svg" viewBox="0 0 120 120" aria-hidden="true">' + track +
      (h.fill ? '<path class="dd-fill" pathLength="100" d="' + esc(h.fill) + '"/>' : '') +
      (h.tick ? '<line class="dd-tick" x1="' + esc(h.tick.x1) + '" y1="' + esc(h.tick.y1) + '" x2="' + esc(h.tick.x2) + '" y2="' + esc(h.tick.y2) + '"/>' : '') +
      '</svg>';
    var centre = h.num != null
      ? '<b class="dd-num">' + esc(h.num) + (h.unit ? '<small>' + esc(h.unit) + '</small>' : '') + '</b>'
      : '<span class="dd-word">' + esc(h.word) + '</span>';
    var aria = format(X.T.deep.heroAria, { label: h.label, value: h.num != null ? h.num + (h.unit ? ' ' + h.unit : '') : h.word });
    return '<section class="dd-hero dd-' + esc(h.cls) + (h.fill ? '' : ' dd-off') + (h.stale ? ' dd-stale' : '') + '">' +
      '<div class="dd-ring" role="img" aria-label="' + esc(aria) + '">' + svg +
      '<div class="dd-centre" aria-hidden="true">' + centre + '<span class="dd-lbl">' + esc(h.label) + '</span></div></div></section>';
  }
  // recovery: exactly the dial (view/dial.mjs recoveryDial + score.js recDial): last night's composite,
  // its band as the ONE colour of the whole fill; gated / none = an empty ring with the dial's word
  function recoveryHero(m, X) {
    var P = X.T.deep, h = m.head, d = dials() && dials().recovery;
    var label = P.label.recovery;
    if (!h || !isNum(h.value)) return { cls: 'off', label: label, word: d && d.state === 'none' ? P.words.none : P.words.gated, stale: false };
    return {
      cls: BAND_CLS[h.band] || 'mid', label: label, num: X.signed(h.value, 1), unit: X.unitOf('recovery'),
      fill: d && d.state === 'ok' ? d.fill : null, stale: stale((d && d.asOf) || X.D.asOf),
    };
  }
  // sleep: last night's hours over the stated target (the dial's fill); the night's date sets staleness
  function sleepHero(m, end, X) {
    var P = X.T.deep, d = dials() && dials().sleep;
    var date = d && d.state === 'ok' ? d.date : X.lastDataDate(m, end);
    var v = d && d.state === 'ok' ? d.hours : date ? X.valueOf(m, date) : null;
    if (!isNum(v)) return { cls: 'off', label: P.label.sleep, word: P.words.none };
    return { cls: 'sleep', label: P.label.sleep, num: X.fmt(v, 1), unit: 'h', fill: d && d.state === 'ok' ? d.fill : null, stale: stale(date) };
  }
  // load: the dial's today logic (score.js loadToday): today's RE fills to its baked arc, the typical
  // day is the white tick at the ring's midpoint; no RE today = the dial's word, an empty ring
  function loadHero(key, m, X) {
    var P = X.T.deep, D = dials(), dm = loadDialOf(X.modOf(key));
    var tick = D && D.load && D.load.tick ? D.load.tick : null;
    var base = { label: P.label.load, tick: tick, stale: stale((D && D.load && D.load.asOf) || X.D.asOf) };
    var hero = function (o) { for (var k in base) if (!(k in o)) o[k] = base[k]; return o; };
    if (m.gate || (dm && dm.state !== 'ok')) return hero({ cls: 'off', word: P.words.loadGated });
    var t = HC.todayIso(), v = X.at(m.v, m, t), i = X.dayDiff(m.start, t);
    if (v != null && v > 0) {
      var fill = null;
      (dm && dm.days || []).forEach(function (x) { if (x.date === t && x.fill) fill = x.fill; });
      return hero({ cls: 'strain', num: X.fmt(v, 0), unit: X.unitOf(key), fill: fill });
    }
    if (i >= 0 && i < m.v.length && m.v[i] === null) return hero({ cls: 'off', word: P.words.noEffort });
    return hero({ cls: 'off', word: P.words.rest });
  }

  /* ---------- insight card: the dial's former captions, condensed ---------- */
  // lines: [{text, cls?}] — 2–4 short plain lines; the long notes go under ⓘ (infoLines)
  function recoveryLines(m, X) {
    var R = X.T.rec, h = m.head;
    if (!h || !isNum(h.value)) return [{ text: R.gated }];
    var tr = h.trend || {};
    var trendTxt = tr.dir && R.dirs[tr.dir] ? format(R.trendLine, { dir: R.dirs[tr.dir], value: X.signed(tr.value, 1) }) : format(R.trendLineNoDir, { value: X.signed(tr.value, 1) });
    var trend = { cls: 'dt-c-' + (BAND_STATE[tr.band] || 'normal'), text: trendTxt + (X.T.day.bands[tr.band] ? ' · ' + X.T.day.bands[tr.band] : '') };
    var band = X.T.day.bands[h.band] || '';
    if (h.mode !== 'today') return [{ text: R.noLastNight }, { text: band }, trend];
    var d = isoDate(h.date);
    // "Last night" only when the night is dated the viewer's today AND has a sleep reading (as the dial)
    var when = HC.daysOld(d) === 0 && h.sleep !== false ? R.lastNight : HC.fmtDate(d);
    var out = [{ text: format(X.T.deep.nightLine, { when: when, band: band }) }];
    if (h.sleep === false) out.push({ cls: 'dt-nodata', text: R.noSleep });
    out.push(trend);
    return out;
  }
  function sleepLines(m, end, X) {
    var d = X.lastDataDate(m, end);
    var out = [];
    if (m.target != null) out.push({ text: format(X.T.bands.target, { value: X.fmt(m.target, 1), unit: 'h' }) });
    if (!d) return out.concat([{ text: X.T.noData }]);
    var v = X.valueOf(m, d);
    var when = HC.daysOld(d) === 0 ? X.T.rec.lastNight : HC.fmtDate(d);
    if (m.target != null) out.push({ text: format(X.T.deep.sleepLine, { when: when, value: X.fmt(v, 1), delta: X.signed(v - m.target, 1), target: X.fmt(m.target, 1) }) });
    else out.push({ text: format(X.T.latestLbl, { date: HC.fmtDate(d) }) });
    return out;
  }
  // load: the dial's today line, the ring scale and the 7-day vs 42-day context (baked DIALS)
  function loadLines(key, m, X) {
    var L = X.T.load;
    if (m.gate) return [{ text: L.gated[m.gate] || L.gated.baselineBuilding }];
    var t = HC.todayIso(), i = X.dayDiff(m.start, t), v = X.at(m.v, m, t), typ = X.fmt(m.typical, 0);
    var out = [];
    if (v != null && v > 0) out.push({ text: format(L.dayLine, { day: X.fmt(v, 0), typical: typ }) });
    else if (i >= 0 && i < m.v.length && m.v[i] === null) out.push({ text: format(L.noEffortLine, { typical: typ }) });
    else {
      var last = m.last && isoDate(m.last.date) ? m.last : null;
      out.push({ text: last ? format(L.restLastLine, { date: HC.fmtDate(last.date), re: X.fmt(last.re, 0), typical: typ }) : format(L.restLine, { typical: typ }) });
    }
    if (L.scale) out.push({ cls: 'dt-scale', text: L.scale });
    var dm = loadDialOf(X.modOf(key));
    if (dm && dm.state === 'ok' && isNum(dm.trendPct)) out.push({ text: format(L.trendLbl, { pct: X.pct(dm.trendPct) }) + (L.bands[dm.band] ? ' · ' + L.bands[dm.band] : '') });
    return out;
  }
  // the notes that are not essential: the band / cut rules (detail.js bandText) and, for load, the
  // sessions-without-effort count
  function infoHtml(key, m, X) {
    var extra = '';
    var dm = m.kind === 'load' ? loadDialOf(X.modOf(key)) : null;
    if (dm && dm.state === 'ok' && dm.unscored > 0) extra = '<div class="dt-band-txt">' + esc(format(X.T.load.unscoredNote, { n: dm.unscored })) + '</div>';
    if (key === 'sleep') extra = '<div class="dt-band-txt">' + esc(X.T.day.stagesNote) + '</div>';
    return '<div class="dd-info" id="dd-info" hidden>' + X.bandText(key, m) + extra + '</div>';
  }
  function insightHtml(lines, X) {
    return '<div class="dd-insight">' + lines.map(function (l) {
      return '<p class="dd-ln' + (l.cls ? ' ' + esc(l.cls) : '') + '">' + esc(l.text) + '</p>';
    }).join('') +
      '<button type="button" class="dd-cta" data-dt-act="trend">' + esc(X.T.deep.cta) + '<span aria-hidden="true"> →</span></button></div>';
  }

  function render(key, m, end, X) {
    var hero = key === 'recovery' ? recoveryHero(m, X) : key === 'sleep' ? sleepHero(m, end, X) : loadHero(key, m, X);
    var lines = key === 'recovery' ? recoveryLines(m, X) : key === 'sleep' ? sleepLines(m, end, X) : loadLines(key, m, X);
    return {
      head: headHtml(key, X),
      top: infoHtml(key, m, X) + heroHtml(hero, X) + insightHtml(lines, X),
    };
  }

  window.HCDeep = { isDial: isDial, render: render };
})();
