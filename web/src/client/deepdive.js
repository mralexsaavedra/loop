/* Dial deep-dive pages: the detail sheet of the three Inicio dials (sleep, recovery, strain or
 * load-<modality>)
 * laid out as one page — a "‹ TODAY ⓘ" header, the big hero ring (the SAME baked geometry as the dial,
 * view/dial.mjs via the DIALS global), an insight card (the dial's former captions in 2–4 plain lines +
 * a "View trend →" link down to the history chart) and, collapsed under ⓘ, the long notes (bands,
 * scale, rules). Same data and rules as the dial and the rest of the sheet: nothing new is scored
 * here, only read from DETAIL / DIALS and laid out (the sleep page only adds REM + deep and stage
 * shares of the baked stage hours).
 *
 * Classic script (is:inline), inlined right BEFORE client/detail.js, which calls it: window.HCDeep =
 * {isDial(key), render(key, m, end, X) -> {head, top}}. X = the sheet's own helpers (copy, series
 * access, number formatting, the band notes), injected so both files read one set of rules. The
 * header's back button is the sheet's close button (data-dt-act="close"); ⓘ (data-dt-act="info") and
 * the CTA (data-dt-act="trend") are handled by detail.js's one delegated listener.
 */
(function () {
  var esc = HC.esc, format = HC.format, isoDate = HC.isoDate, shiftIso = HC.shiftIso;
  // contributors: today vs the middle half (p25–p75) of the PRIOR_DAYS before it — the same "usual
  // day" idea as the Salud totals' quartile band; fewer than PRIOR_MIN prior values = no marker
  var PRIOR_DAYS = 30, PRIOR_MIN = 7;
  var WEEK = 7;
  // the recovery composite's scale (view/dial.mjs recoveryFrac: -3..+3 MAD), for the weekly bars
  var Z = 3;
  // 24-unit stroked icons (currentColor), one per contributor row
  var ICONS = {
    hrv: 'M2 12h4l2-5 4 10 2-5h8',
    rhr: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
    sleep: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    need: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    perf: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    resp: 'M12 3v8M12 11l-3 3M12 11l3 3M9 7c-3 0-6 4-6 10 0 2 1 3 3 3s3-1 3-3zM15 7c3 0 6 4 6 10 0 2-1 3-3 3s-3-1-3-3z',
    vsTarget: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8',
    bed: 'M3 18v-8M3 14h18v4M21 14a3 3 0 0 0-3-3h-7v3M7 12.5a1.5 1.5 0 1 0 0-.01',
    wake: 'M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
    re: 'M13 2 4 14h7l-1 8 9-12h-7z',
    acute: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    sessions: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    typical: 'M3 12h4M17 12h4M12 3v4M12 17v4M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8',
    eff: 'M3 19h18M6 19v-5M10 19V9M14 19v-7M18 19V5',
    cons: 'M4 7h16M4 12h16M4 17h16M8 5v4M15 10v4M11 15v4',
    restor: 'M3 15c3-6 6-6 9 0s6 6 9 0',
  };
  // the stages bar, top to bottom of the night's hypnogram order: awake, REM, core, deep (+ the
  // Asleep-unspecified remainder when a night has some)
  var STAGES = ['awake', 'rem', 'core', 'deep', 'unspec'];
  // the hero ring's track when no DIALS geometry is baked: the dial's own circle (view/dial.mjs DIAL)
  var RING = { c: 60, r: 54 };
  var BAND_CLS = { above: 'good', at: 'mid', below: 'low' };
  var BAND_STATE = { above: 'good', at: 'normal', below: 'bad' };

  function isDial(key) {
    return key === 'sleep' || key === 'recovery' || key === 'strain' || /^load-[a-z]+$/.test(String(key));
  }
  // SCORES.strain (lib/score/strain.mjs): K, the 95th-percentile day, and the recent days with each
  // contributor's share of the strain; DIALS.strain: the same days' ring arcs
  function strainBake() {
    var S = typeof SCORES !== 'undefined' && SCORES ? SCORES.strain : null;
    return S && S.ok ? S : null;
  }
  function strainDayOf(list, iso) {
    var out = null;
    (list || []).forEach(function (x) { if (x && x.date === iso) out = x; });
    return out;
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
    return HC.sheetHead({ title: X.titleOf(key), back: P.back, info: { controls: 'dd-info', label: P.info } });
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
  // the dial's % when it scores the SAME night as the sheet's headline (DETAIL head), else null
  function pctOf(h) {
    var d = dials() && dials().recovery;
    return h && h.mode === 'today' && d && d.state === 'ok' && d.mode === 'today' && d.date === h.date && isNum(d.pct) ? d.pct : null;
  }
  // recovery: exactly the dial (view/dial.mjs recoveryDial + score.js recDial): last night's composite,
  // its band as the ONE colour of the whole fill; gated / none = an empty ring with the dial's word
  function recoveryHero(m, X) {
    var P = X.T.deep, h = m.head, d = dials() && dials().recovery;
    var label = P.label.recovery;
    if (!h || !isNum(h.value)) return { cls: 'off', label: label, word: d && d.state === 'none' ? P.words.none : P.words.gated, stale: false };
    // the % headline (DIALS: the night's rank within the previous 90 days) when the dial has one
    if (pctOf(h) != null) {
      return { cls: d.band, label: label, num: String(d.pct), unit: '%', fill: d.fill, stale: stale(d.asOf || X.D.asOf) };
    }
    return {
      cls: BAND_CLS[h.band] || 'mid', label: label, num: X.signed(h.value, 1), unit: X.unitOf('recovery'),
      fill: d && d.state === 'ok' ? d.fill : null, stale: stale((d && d.asOf) || X.D.asOf),
    };
  }
  // sleep: last night's sleep performance % (DIALS pct = asleep / need, the dial's fill); without a
  // baked % (no DIALS) the night's hours; the night's date sets staleness
  function sleepHero(m, end, X) {
    var P = X.T.deep, d = dials() && dials().sleep;
    var date = d && d.state === 'ok' ? d.date : X.lastDataDate(m, end);
    var v = d && d.state === 'ok' ? d.hours : date ? X.valueOf(m, date) : null;
    if (!isNum(v)) return { cls: 'off', label: P.label.sleep, word: P.words.none };
    if (d && d.state === 'ok' && isNum(d.pct)) return { cls: 'sleep', label: P.label.sleepPerf, num: String(d.pct), unit: '%', fill: d.fill, stale: stale(date) };
    return { cls: 'sleep', label: P.label.sleep, num: X.fmt(v, 1), unit: 'h', fill: d && d.state === 'ok' ? d.fill : null, stale: stale(date) };
  }
  // the night the sleep page describes: the dial's night, else the metric's newest day
  function sleepNight(m, end, X) {
    var d = dials() && dials().sleep;
    return d && d.state === 'ok' && isoDate(d.date) ? d.date : X.lastDataDate(m, end);
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
    var pct = pctOf(h);
    var out = [{ text: format(X.T.deep.nightLine, { when: when, band: pct != null ? R.pctBands[dials().recovery.band] : band }) }];
    // with a % headline the night's SD value moves under ⓘ (infoHtml), so the insight carries ONE band
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
    var txt = function (t) { return '<div class="dt-band-txt">' + esc(t) + '</div>'; };
    if (key === 'sleep') {
      var N = X.T.deep.sleepNotes;
      extra = txt(format(N.perf, { target: X.fmt(m.target, 1) })) + txt(N.eff) + txt(N.cons) + txt(N.stages);
    }
    if (key === 'recovery' && pctOf(m.head) != null) {
      var h = m.head, R = X.T.rec;
      extra = txt(R.pctNote) + txt(format(R.sdLbl, { value: X.signed(h.value, 1), band: R.sdBands[h.band] || '' }));
    }
    if (key === 'recovery' && X.T.deep.respNote) extra += txt(X.T.deep.respNote);
    return '<div class="dd-info" id="dd-info" hidden>' + X.bandText(key, m) + extra + '</div>';
  }
  function insightHtml(lines, X) {
    return '<div class="dd-insight">' + lines.map(function (l) {
      return '<p class="dd-ln' + (l.cls ? ' ' + esc(l.cls) : '') + '">' + esc(l.text) + '</p>';
    }).join('') +
      '<button type="button" class="dd-cta" data-dt-act="trend">' + esc(X.T.deep.cta) + '<span aria-hidden="true"> →</span></button></div>';
  }

  /* ---------- contributors: today vs the prior 30 days ---------- */
  function quart(sorted, p) {
    var i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  // get(iso) -> number | null. Returns null when there is no value on `iso` (the row is hidden), else
  // {v, side: 1 above / -1 below / 0 within the prior p25–p75 / null too few prior days, tone}: tone
  // better / worse by the metric's good direction (dir 1 = higher is better, -1 = lower), neutral for
  // a metric without one (dir 0: bedtime, load), typical inside the band. `keep` filters the prior
  // values (load: training days only).
  function compare(get, iso, dir, keep) {
    var v = get(iso);
    if (!isNum(v)) return null;
    var prior = [];
    for (var k = 1; k <= PRIOR_DAYS; k++) {
      var x = get(shiftIso(iso, -k));
      if (isNum(x) && (!keep || keep(x))) prior.push(x);
    }
    if (prior.length < PRIOR_MIN) return { v: v, side: null, tone: null };
    prior.sort(function (a, b) { return a - b; });
    var lo = quart(prior, 0.25), hi = quart(prior, 0.75);
    var side = v > hi ? 1 : v < lo ? -1 : 0;
    var tone = side === 0 ? 'typical' : !dir ? 'neutral' : side === dir ? 'better' : 'worse';
    return { v: v, side: side, tone: tone, lo: lo, hi: hi };
  }
  function seriesGet(X, mk, arr) {
    return function (iso) { return mk ? X.at(arr || mk.v, mk, iso) : null; };
  }
  // a bedtime after midnight (00:30) continues the evening (24.5), so 23:50 vs 00:10 compares right
  function wrapBed(v) {
    return isNum(v) && v < 12 ? v + 24 : v;
  }
  function markHtml(c, X) {
    if (!c || c.side == null) return '';
    var C = X.T.deep.contrib.cmp;
    var glyph = c.side > 0 ? '▲' : c.side < 0 ? '▼' : '•';
    var said = c.tone === 'neutral' ? (c.side > 0 ? C.above : C.below) : C[c.tone];
    return '<span class="dd-mk dd-' + esc(c.tone) + '" aria-hidden="true">' + glyph + '</span><span class="sr-only">' + esc(said) + '</span>';
  }
  function iconHtml(k) {
    return '<svg class="dd-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICONS[k] + '"/></svg>';
  }
  // rows: [{k (icon + label key), val (string) | null = hidden, cmp}]; at most 4
  function contribHtml(rows, X) {
    var P = X.T.deep.contrib;
    var shown = rows.filter(function (r) { return r.val != null; }).slice(0, 4);
    if (!shown.length) return '';
    var marked = shown.some(function (r) { return r.cmp && r.cmp.side != null; });
    return '<section class="dd-contrib" aria-label="' + esc(P.aria) + '"><ul class="dd-rows">' + shown.map(function (r) {
      return '<li class="dd-row" data-row="' + esc(r.k) + '">' + iconHtml(r.k) + '<span class="dd-row-lbl">' + esc(P.rows[r.k]) + '</span>' +
        '<b class="dd-row-val">' + esc(r.val) + '</b>' + markHtml(r.cmp, X) + '</li>';
    }).join('') + '</ul>' +
      (marked ? '<p class="dd-legend"><span class="dd-mk dd-better" aria-hidden="true">▲</span><span class="dd-mk dd-worse" aria-hidden="true">▼</span><b>' +
        esc(P.legendToday) + '</b> ' + esc(P.legendRest) + '</p>' : '') + '</section>';
  }
  // the night the dial scores: recovery = its headline night, else each input's own newest day
  function nightOf(X, mk, end, ref) {
    return ref || (mk ? X.lastDataDate(mk, end) : null);
  }
  function valRow(k, X, mk, iso, dec, unit, dir, arr, keep) {
    if (!mk || !iso) return { k: k, val: null };
    var get = seriesGet(X, mk, arr);
    var c = compare(get, iso, dir, keep);
    return { k: k, val: c ? X.fmt(c.v, dec) + (unit ? ' ' + unit : '') : null, cmp: c };
  }
  // recovery, the reference's four rows (display only — the composite is unchanged): HRV, resting HR,
  // respiratory rate (context, NOT a composite input; dir 0 = no good direction, so a neutral ▲▼
  // outside the usual range and a grey dot inside) and the night's sleep performance % (lib/score/
  // sleep.mjs perf, baked on the sleep metric). Each on the scored night; a missing value hides its row.
  function recoveryRows(m, end, X) {
    var h = m.head, ref = h && h.mode === 'today' ? isoDate(h.date) : null;
    var hrv = X.metric('hrv'), rhr = X.metric('rhr'), rsp = X.metric('respiratory'), sl = X.metric('sleep');
    var perf = sl && Array.isArray(sl.perf) ? valRow('perf', X, sl, nightOf(X, sl, end, ref), 0, '%', 1, sl.perf) : { k: 'perf', val: null };
    return [
      valRow('hrv', X, hrv, nightOf(X, hrv, end, ref), hrv ? hrv.dec : 0, X.unitOf('hrv'), hrv ? hrv.dir : 0),
      valRow('rhr', X, rhr, nightOf(X, rhr, end, ref), rhr ? rhr.dec : 0, X.unitOf('rhr'), rhr ? rhr.dir : 0),
      valRow('resp', X, rsp, nightOf(X, rsp, end, ref), rsp ? rsp.dec : 1, X.unitOf('respiratory'), 0),
      perf,
    ];
  }
  // REM + deep hours of a night (DETAIL stage arrays), null when the night has no stages
  function restorOf(X, m, iso) {
    var r = Array.isArray(m.rem) ? X.at(m.rem, m, iso) : null, dp = Array.isArray(m.deep) ? X.at(m.deep, m, iso) : null;
    return isNum(r) && isNum(dp) ? r + dp : null;
  }
  // sleep: hours vs need (the target), efficiency, consistency (minutes, lower = better), REM + deep
  // (hours · % of asleep); a row without data that night is hidden and bedtime / wake time fill in
  function sleepRows(m, end, X) {
    var iso = sleepNight(m, end, X);
    var hours = valRow('need', X, m, iso, 1, 'h', m.dir || 1);
    if (hours.val != null && isNum(m.target)) hours.val = X.fmt(hours.cmp.v, 1) + ' / ' + X.fmt(m.target, 1) + ' h';
    var eff = Array.isArray(m.eff) ? valRow('eff', X, m, iso, 0, '%', 1, m.eff) : { k: 'eff', val: null };
    var cons = Array.isArray(m.cons) ? valRow('cons', X, m, iso, 0, 'min', -1, m.cons) : { k: 'cons', val: null };
    var restor = { k: 'restor', val: null };
    var rc = iso ? compare(function (x) { return restorOf(X, m, x); }, iso, 1) : null;
    var asleep = iso ? X.valueOf(m, iso) : null;
    if (rc) restor = { k: 'restor', val: X.fmt(rc.v, 1) + ' h' + (isNum(asleep) && asleep > 0 ? ' · ' + Math.round((100 * rc.v) / asleep) + '%' : ''), cmp: rc };
    var clockRow = function (k, arr, wrap) {
      if (!iso || !Array.isArray(arr)) return { k: k, val: null };
      var c = compare(function (x) { var b = X.at(arr, m, x); return wrap ? wrapBed(b) : b; }, iso, 0);
      return { k: k, val: c ? X.clock(c.v) : null, cmp: c };
    };
    return [hours, eff, cons, restor, clockRow('bed', m.bed, true), clockRow('wake', m.wake, false)];
  }
  // the night's stages as one stacked horizontal bar (awake / REM / core / deep, by hours) + a legend
  // with the hours and, for the asleep stages, their % of the time asleep; no stages = nothing
  function stagesHtml(m, end, X) {
    var iso = sleepNight(m, end, X), P = X.T.deep.stages;
    if (!iso || !Array.isArray(m.rem)) return '';
    var asleep = X.valueOf(m, iso), core = Array.isArray(m.core) ? X.at(m.core, m, iso) : null;
    var h = { awake: Array.isArray(m.awake) ? X.at(m.awake, m, iso) : null, rem: X.at(m.rem, m, iso), core: core, deep: Array.isArray(m.deep) ? X.at(m.deep, m, iso) : null };
    if (!isNum(h.rem) || !isNum(h.deep) || !isNum(h.core)) return '';
    // the asleep remainder no stage covers (Asleep-unspecified segments), shown only when it is real
    var rest = isNum(asleep) ? asleep - h.rem - h.deep - h.core : 0;
    h.unspec = rest >= 0.05 ? rest : null;
    var keys = STAGES.filter(function (k) { return isNum(h[k]) && h[k] > 0; });
    var tot = keys.reduce(function (a, k) { return a + h[k]; }, 0);
    if (!(tot > 0)) return '';
    var bar = keys.map(function (k) {
      return '<i class="dd-st dd-st-' + k + '" style="width:' + (Math.round((1000 * h[k]) / tot) / 10) + '%"></i>';
    }).join('');
    var legend = keys.map(function (k) {
      var share = k !== 'awake' && isNum(asleep) && asleep > 0 ? ' · ' + Math.round((100 * h[k]) / asleep) + '%' : '';
      return '<li><i class="dd-sw dd-st-' + k + '" aria-hidden="true"></i>' + esc(P[k]) + ' <b>' + esc(X.fmt(h[k], 1) + ' h' + share) + '</b></li>';
    }).join('');
    return '<section class="dd-stages" aria-label="' + esc(P.aria) + '"><div class="dd-stbar" aria-hidden="true">' + bar + '</div>' +
      '<ul class="dd-stleg">' + legend + '</ul></section>';
  }
  function sessionsIn(X, mod, from, to) {
    return (X.D.sessions || []).filter(function (x) { return x.m === mod && x.d >= from && x.d <= to; });
  }
  // load: today's RE (vs the prior 30 days' training days), the 7-day vs 42-day trend (DIALS), the
  // sessions of the last 7 days, the typical training day
  function loadRows(key, m, end, X) {
    var t = HC.todayIso(), mod = X.modOf(key), dm = loadDialOf(mod);
    var re = valRow('re', X, m, t, 0, X.unitOf(key), 0, null, function (x) { return x > 0; });
    if (!(re.cmp && re.cmp.v > 0)) re = { k: 're', val: null };
    var acute = { k: 'acute', val: dm && dm.state === 'ok' && isNum(dm.trendPct) ? X.pct(dm.trendPct) : null };
    var sessions = { k: 'sessions', val: Array.isArray(X.D.sessions) && !m.gate ? String(sessionsIn(X, mod, shiftIso(end, -(WEEK - 1)), end).length) : null };
    var typical = { k: 'typical', val: isNum(m.typical) ? X.fmt(m.typical, 0) + ' ' + X.unitOf(key) : null };
    return [re, acute, sessions, typical];
  }

  /* ---------- weekly trends: one card per input, the 7 days ending at the view's last day ---------- */
  function weekOf(end) {
    var out = [];
    for (var k = WEEK - 1; k >= 0; k--) out.push(shiftIso(end, -k));
    return out;
  }
  // card: {title, get(iso) -> number|null, text(v), cls(v) -> colour class, frac(v, max) -> 0..1}
  function weeklyCard(card, days, X) {
    var vals = days.map(card.get);
    if (!vals.some(isNum)) return '';
    var max = Math.max.apply(null, vals.map(function (v) { return isNum(v) ? Math.abs(v) : 0; })) || 1;
    var today = HC.todayIso();
    var N = typeof I18N_DATE !== 'undefined' && I18N_DATE && I18N_DATE.weekdaysMin ? I18N_DATE.weekdaysMin : null;
    var cols = days.map(function (iso, i) {
      var v = vals[i];
      var f = isNum(v) ? Math.max(0, Math.min(1, card.frac ? card.frac(v) : v / max)) : 0;
      var bar = isNum(v) && f > 0 ? '<i class="dd-bar dd-c-' + esc(card.cls(v)) + '" style="height:' + Math.round(f * 100) + '%"></i>' : '';
      return '<li class="dd-col' + (iso === today ? ' dd-now' : '') + '"><span class="dd-val">' + esc(isNum(v) ? card.text(v) : '—') + '</span>' +
        '<span class="dd-track-col">' + bar + '</span><span class="dd-wd">' + esc(N ? N[HC.weekdayIndex(iso)] : HC.fmtDate(iso)) + '</span>' +
        '<span class="sr-only">' + esc(HC.fmtDate(iso)) + '</span></li>';
    }).join('');
    return '<section class="dd-wk" aria-label="' + esc(format(X.T.deep.weekly.aria, { title: card.title })) + '"><h4 class="dd-wk-t">' + esc(card.title) + '</h4>' +
      '<ol class="dd-cols">' + cols + '</ol></section>';
  }
  function plain(cls) {
    return function () { return cls; };
  }
  function weeklyCards(key, m, X) {
    var cards = [];
    var simple = function (k, cls) {
      var mk = X.metric(k);
      if (!mk) return;
      cards.push({ title: X.titleOf(k), get: seriesGet(X, mk), text: function (v) { return X.fmt(v, k === 'sleep' ? 1 : mk.dec); }, cls: plain(cls) });
    };
    if (key === 'recovery') {
      // each day by its own day band (the calendar's colours), on the dial's -3..+3 scale
      cards.push({
        title: X.titleOf('recovery'), get: seriesGet(X, m), text: function (v) { return X.signed(v, 1); },
        cls: function (v) { return v >= m.cut ? 'good' : v <= -m.cut ? 'low' : 'mid'; },
        frac: function (v) { return (Math.max(-Z, Math.min(Z, v)) + Z) / (2 * Z); },
      });
      simple('hrv', 'trend');
      simple('rhr', 'trend');
      simple('sleep', 'sleep');
    } else if (key === 'sleep') {
      simple('sleep', 'sleep');
      // performance % per night (baked, 0..100) and REM + deep hours, when the extract has them
      if (Array.isArray(m.perf)) {
        cards.push({ title: X.T.deep.weekly.perf, get: seriesGet(X, m, m.perf), text: function (v) { return X.fmt(v, 0); }, cls: plain('sleep'), frac: function (v) { return v / 100; } });
      }
      if (Array.isArray(m.rem) && Array.isArray(m.deep)) {
        cards.push({ title: X.T.deep.weekly.restor, get: function (iso) { return restorOf(X, m, iso); }, text: function (v) { return X.fmt(v, 1); }, cls: plain('sleep') });
      }
    } else if (key === 'strain') {
      cards.push({ title: X.titleOf('strain'), get: seriesGet(X, m), text: function (v) { return X.fmt(v, 1); }, cls: plain('strain'), frac: function (v) { return v / STRAIN_MAX; } });
    } else {
      var mod = X.modOf(key);
      cards.push({ title: X.titleOf(key), get: seriesGet(X, m), text: function (v) { return X.fmt(v, 0); }, cls: plain('strain') });
      // minutes of this modality per day (the sessions after the same-day rule); a day after the data's
      // asOf is unknown, not rest
      var asOf = isoDate(X.D.asOf);
      cards.push({
        title: X.T.deep.weekly.minutes, text: function (v) { return X.fmt(v, 0); }, cls: plain('strain'),
        get: function (iso) {
          if (!asOf || iso > asOf || iso < m.start) return null;
          return sessionsIn(X, mod, iso, iso).reduce(function (s, x) { return s + (isNum(x.min) ? x.min : 0); }, 0);
        },
      });
    }
    return cards;
  }
  function weeklyHtml(key, m, end, X) {
    var days = weekOf(end);
    var html = weeklyCards(key, m, X).map(function (c) { return weeklyCard(c, days, X); }).join('');
    return html ? '<section class="dd-weekly"><h3 class="dd-sec">' + esc(X.T.deep.weekly.title) + '</h3>' + html + '</section>' : '';
  }

  /* ---------- day strain (key 'strain') ---------- */
  var STRAIN_MAX = 21;
  // the reference's bands on our 0-21 scale (DETAIL strain levels: 10 / 14 / 18)
  function strainBand(v) {
    return v >= 18 ? 'allOut' : v >= 14 ? 'high' : v >= 10 ? 'moderate' : 'light';
  }
  // the day the page describes: the day it was opened on (a stepped-to Inicio day, a day tap), else the view end
  function strainIso(end, X) {
    return X.sel && isoDate(X.sel) ? X.sel : end;
  }
  function strainHero(m, end, X) {
    var P = X.T.deep, iso = strainIso(end, X), v = X.at(m.v, m, iso);
    var D = dials(), dd = D && D.strain ? strainDayOf(D.strain.days, iso) : null;
    if (!isNum(v)) return { cls: 'off', label: P.label.strain, word: P.words.none };
    return { cls: 'strain', label: P.label.strain, num: X.fmt(v, 1), fill: dd ? dd.fill : null, stale: stale(D && D.strain && D.strain.asOf) && !X.sel };
  }
  function strainLines(m, end, X) {
    var P = X.T.deep.strain, iso = strainIso(end, X), v = X.at(m.v, m, iso);
    if (!isNum(v)) return [{ text: format(P.noDay, { date: HC.fmtDate(iso) }) }];
    var b = strainBand(v), out = [{ text: P.bands[b] }];
    // the usual day: the median of the 30 days before, when 7+ of them have a strain
    var c = compare(function (x) { return X.at(m.v, m, x); }, iso, 0);
    if (c && c.side != null) {
      var prior = [];
      for (var k = 1; k <= PRIOR_DAYS; k++) { var x = X.at(m.v, m, shiftIso(iso, -k)); if (isNum(x)) prior.push(x); }
      prior.sort(function (a, z) { return a - z; });
      out.push({ text: format(P.usual, { value: X.fmt(quart(prior, 0.5), 1) }) });
    }
    var S = strainBake();
    if (S) out.push({ cls: 'dt-scale', text: format(P.scale, { days: S.windowDays }) });
    return out;
  }
  // contributors: the day's activities (strain share, minutes x zone load) + the all-day remainder
  function strainContribHtml(m, end, X) {
    var P = X.T.deep.strain, S = strainBake(), d = S ? strainDayOf(S.days, strainIso(end, X)) : null;
    if (!d) return '';
    var rows = d.acts.map(function (a) {
      return { icon: 're', lbl: P.mods[a.m] || a.t, val: X.fmt(a.s, 1), sub: format(P.loadLbl, { load: X.fmt(a.load, 0) }) };
    });
    rows.push({ icon: 'acute', lbl: P.allDay, val: X.fmt(d.alls, 1), sub: format(P.loadLbl, { load: X.fmt(d.all, 0) }) });
    return '<section class="dd-contrib" aria-label="' + esc(P.contribAria) + '"><ul class="dd-rows">' + rows.map(function (r) {
      return '<li class="dd-row">' + iconHtml(r.icon) + '<span class="dd-row-lbl">' + esc(r.lbl) + ' <small class="dd-row-sub">' + esc(r.sub) + '</small></span>' +
        '<b class="dd-row-val">' + esc(r.val) + '</b></li>';
    }).join('') + '</ul><p class="dd-legend">' + esc(P.shareNote) + '</p></section>';
  }
  // the long notes (ⓘ): the formula, this owner's K and 95th-percentile day, the max HR, the coverage
  function strainNotes(X) {
    var P = X.T.deep.strain, S = strainBake();
    var txt = function (t) { return '<div class="dt-band-txt">' + esc(t) + '</div>'; };
    var out = txt(P.notes.formula) + txt(P.notes.sources);
    if (S) out += txt(format(P.notes.calib, { p95: X.fmt(S.p95, 0), k: X.fmt(S.K, 1), n: S.n, days: S.windowDays, max: X.fmt(S.maxHr, 0) }));
    return out + txt(P.notes.estimate);
  }
  // Relative Effort per modality stays one tap away: the Entreno load deep-dives
  function reLinksHtml(X) {
    var P = X.T.deep.strain, mods = ['gym', 'run', 'bike'].filter(function (k) { return !!X.metric('load-' + k); });
    if (!mods.length) return '';
    return '<section class="dd-re"><h3 class="dd-sec">' + esc(P.reTitle) + '</h3><div class="dd-re-links">' + mods.map(function (k) {
      return '<span class="dd-re-link"' + HC.detailAttrs('load-' + k) + '>' + esc(X.titleOf('load-' + k)) + '</span>';
    }).join('') + '</div></section>';
  }

  function render(key, m, end, X) {
    if (key === 'strain') {
      return {
        head: headHtml(key, X),
        top: '<div class="dd-info" id="dd-info" hidden>' + X.bandText(key, m) + strainNotes(X) + '</div>' + heroHtml(strainHero(m, end, X), X) +
          strainContribHtml(m, end, X) + insightHtml(strainLines(m, end, X), X) + weeklyHtml(key, m, end, X) + reLinksHtml(X),
      };
    }
    var hero = key === 'recovery' ? recoveryHero(m, X) : key === 'sleep' ? sleepHero(m, end, X) : loadHero(key, m, X);
    var lines = key === 'recovery' ? recoveryLines(m, X) : key === 'sleep' ? sleepLines(m, end, X) : loadLines(key, m, X);
    var rows = key === 'recovery' ? recoveryRows(m, end, X) : key === 'sleep' ? sleepRows(m, end, X) : loadRows(key, m, end, X);
    return {
      head: headHtml(key, X),
      top: infoHtml(key, m, X) + heroHtml(hero, X) + (key === 'sleep' ? stagesHtml(m, end, X) : '') + contribHtml(rows, X) + insightHtml(lines, X) + weeklyHtml(key, m, end, X),
    };
  }

  window.HCDeep = { isDial: isDial, render: render, compare: compare, weekOf: weekOf };
})();
