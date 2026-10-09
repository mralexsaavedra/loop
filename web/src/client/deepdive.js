/* Dial deep-dive pages: the detail sheet of the three Inicio dials (sleep, recovery, strain or
 * load-<modality>) and of the stress monitor tile (stress: a 0-3 gauge, the hourly curve, time per band)
 * and of the energy bank card (energy-bank: a 0-100 gauge, the intraday curve, what drained and recharged it)
 * laid out as one page — a "‹ TODAY ⓘ" header, the big hero ring (the SAME baked geometry as the dial,
 * view/dial.mjs via the DIALS global), an insight card (2–3 plain sentences from the numbers on the
 * page + a "See my recovery trend →" link down to the history chart) and, collapsed under ⓘ, the long notes (bands,
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

  // the stages bar, top to bottom of the night's hypnogram order: awake, REM, core, deep (+ the
  // Asleep-unspecified remainder when a night has some)
  var STAGES = ['awake', 'rem', 'core', 'deep', 'unspec'];
  // the hero ring's track when no DIALS geometry is baked: the dial's own circle (view/dial.mjs DIAL)
  var RING = { c: 60, r: 54 };
  var BAND_CLS = { above: 'good', at: 'mid', below: 'low' };

  function isDial(key) {
    return key === 'sleep' || key === 'recovery' || key === 'strain' || key === 'stress' || key === 'energy-bank' || /^load-[a-z]+$/.test(String(key));
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
  // the header names the DAY the page shows ("Today" / "Mon 28 Sep", upper-cased by CSS), the metric
  // lives in the ring's label (and stays the dialog's label for screen readers): strain = the day it
  // was opened on (Inicio's day stepping), the others = the view end (the viewer's today, or the
  // stale data's last day), the day their hero and insight describe
  function headDay(key, end, X) {
    return key === 'strain' || key === 'stress' || key === 'energy-bank' ? strainIso(end, X) : end;
  }
  function headHtml(key, end, X) {
    var P = X.T.deep, iso = headDay(key, end, X);
    var title = iso === HC.todayIso() ? P.today : HC.fmtDate(iso);
    return HC.sheetHead({ title: title, sr: X.titleOf(key), back: P.back, info: { controls: 'dd-info', label: P.info } });
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
    return { cls: 'sleep', label: P.label.sleep, num: HC.hours(v), unit: '', fill: d && d.state === 'ok' ? d.fill : null, stale: stale(date) };
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

  /* ---------- insight card: 2–3 plain sentences from the numbers the page already shows ---------- */
  // lines: [{text, cls?}] — each a <p>; the dial pages write ONE paragraph of 2–3 sentences, the
  // long notes go under ⓘ (infoHtml)
  function prose(parts) {
    var t = parts.filter(function (x) { return !!x; }).join(' ');
    return t ? [{ text: t }] : [];
  }
  // "Last night" when the night is the viewer's today, else "On Mon 28 Sep"
  function whenOf(iso, X, last) {
    var W = X.T.deep.prose;
    return HC.daysOld(iso) === 0 && last !== false ? W.lastNight : format(W.on, { date: HC.fmtDate(iso) });
  }
  // the contributors that were worse than the prior 30 days' middle half, in one sentence (no worse
  // one: "every contributor at or better than usual", only when some carry a marker)
  function contribSentence(rows, X) {
    var W = X.T.deep.prose, P = X.T.deep.contrib.rows;
    var shown = rows.filter(function (r) { return r.val != null; }).slice(0, 4);
    if (!shown.some(function (r) { return r.cmp && r.cmp.side != null; })) return '';
    var worse = shown.filter(function (r) { return r.cmp && r.cmp.tone === 'worse'; }).map(function (r, i) {
      var n = P[r.k];
      // later names start lower-case unless they open with an acronym ("REM + deep sleep")
      return i && !/^[A-Z]{2}/.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n;
    });
    if (!worse.length) return W.allOk;
    var names = worse.length === 1 ? worse[0] : worse.slice(0, -1).join(', ') + W.and + worse[worse.length - 1];
    return format(worse.length === 1 ? W.worse1 : W.worseN, { names: names });
  }
  // recovery: Inicio's outlook sentence (score.js window.HCAdvice, '' on a past day or stale data:
  // the bar's full text) leads, then the night in words; without it, the 7-day trend in words
  function recoveryLines(m, X) {
    var R = X.T.rec, W = X.T.deep.prose, h = m.head;
    if (!h || !isNum(h.value)) return [{ text: R.gated }];
    var tr = h.trend || {};
    var trendVars = { dir: W.dirs[tr.dir] || W.dirs.steady, value: X.signed(tr.value, 1) + ' ' + X.unitOf('recovery') };
    var adv = typeof window !== 'undefined' && typeof window.HCAdvice === 'function' ? window.HCAdvice() : '';
    if (h.mode !== 'today') return prose([adv, format(W.recNoNight, trendVars)]);
    var pct = pctOf(h);
    // with a % headline the night's SD value moves under ⓘ (infoHtml), so the card carries ONE band
    var band = pct != null ? W.recBands[dials().recovery.band] : W.recSd[h.band];
    var night = format(W.rec, { when: whenOf(isoDate(h.date), X, h.sleep), band: band || '' });
    return prose([adv, night, h.sleep === false ? W.noSleep : '', adv ? '' : format(W.recTrend, trendVars)]);
  }
  // sleep: last night vs the target, then the contributors that were worse than usual
  function sleepLines(m, end, X) {
    var W = X.T.deep.prose, d = X.lastDataDate(m, end);
    if (!d) return [{ text: X.T.noData }];
    var v = X.valueOf(m, d);
    var night = m.target != null
      ? format(W.sleep, { when: whenOf(d, X), value: HC.hours(v), delta: HC.hours(v - m.target, true), target: HC.hours(m.target) })
      : format(X.T.latestLbl, { date: HC.fmtDate(d) });
    return prose([night, contribSentence(sleepRows(m, end, X), X)]);
  }
  // load: the day (today's RE, or the last session) next to the typical day, then the 7-day vs 42-day
  // context (baked DIALS); the ring scale lives under ⓘ
  function loadLines(key, m, X) {
    var L = X.T.load, W = X.T.deep.prose;
    if (m.gate) return [{ text: L.gated[m.gate] || L.gated.baselineBuilding }];
    var t = HC.todayIso(), i = X.dayDiff(m.start, t), v = X.at(m.v, m, t), typ = X.fmt(m.typical, 0);
    var day;
    if (v != null && v > 0) day = format(W.loadDay, { day: X.fmt(v, 0), typical: typ });
    else if (i >= 0 && i < m.v.length && m.v[i] === null) day = format(W.loadNoEffort, { typical: typ });
    else {
      var last = m.last && isoDate(m.last.date) ? m.last : null;
      day = last ? format(W.loadRestLast, { date: HC.fmtDate(last.date), re: X.fmt(last.re, 0), typical: typ }) : format(W.loadRest, { typical: typ });
    }
    var dm = loadDialOf(X.modOf(key));
    var trend = dm && dm.state === 'ok' && isNum(dm.trendPct) && L.bands[dm.band] ? format(W.loadTrend, { band: L.bands[dm.band], pct: X.pct(dm.trendPct) }) : '';
    return prose([day, trend]);
  }
  // the notes that are not essential: the band / cut rules (detail.js bandText) and, for load, the
  // sessions-without-effort count
  function infoHtml(key, m, X) {
    var extra = '';
    var dm = m.kind === 'load' ? loadDialOf(X.modOf(key)) : null;
    var txt = function (t) { return '<div class="dt-band-txt">' + esc(t) + '</div>'; };
    // load: the ring scale (the dial's former caption) and the sessions-without-effort count
    if (m.kind === 'load' && X.T.load.scale) extra = txt(X.T.load.scale);
    if (dm && dm.state === 'ok' && dm.unscored > 0) extra += txt(format(X.T.load.unscoredNote, { n: dm.unscored }));
    if (key === 'sleep') {
      var N = X.T.deep.sleepNotes;
      extra = txt(format(N.perf, { target: HC.hours(m.target) })) + txt(N.eff) + txt(N.cons) + txt(N.stages);
    }
    if (key === 'recovery' && pctOf(m.head) != null) {
      var h = m.head, R = X.T.rec;
      extra = txt(R.pctNote) + txt(format(R.sdLbl, { value: X.signed(h.value, 1), band: R.sdBands[h.band] || '' }));
    }
    if (key === 'recovery' && X.T.deep.respNote) extra += txt(X.T.deep.respNote);
    return '<div class="dd-info" id="dd-info" hidden>' + X.bandText(key, m) + extra + '</div>';
  }
  // cta: the page's own CTA key (deep.ctas: "See my recovery trend"), else the generic "View trend"
  function insightHtml(lines, X, cta) {
    var C = X.T.deep.ctas;
    return '<div class="dd-insight">' + lines.map(function (l) {
      return '<p class="dd-ln' + (l.cls ? ' ' + esc(l.cls) : '') + '">' + esc(l.text) + '</p>';
    }).join('') +
      HC.cta((C && C[cta]) || X.T.deep.cta, ' data-dt-act="trend"') + '</div>';
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
  function markOf(c, X) {
    if (!c || c.side == null) return null;
    var C = X.T.deep.contrib.cmp;
    var glyph = c.side > 0 ? '▲' : c.side < 0 ? '▼' : '•';
    return { glyph: glyph, tone: c.tone, said: c.tone === 'neutral' ? (c.side > 0 ? C.above : C.below) : C[c.tone] };
  }
  // rows: [{k (icon + label key), val (string) | null = hidden, cmp}]; at most 4
  function contribHtml(rows, X) {
    var P = X.T.deep.contrib;
    var shown = rows.filter(function (r) { return r.val != null; }).slice(0, 4);
    if (!shown.length) return '';
    var marked = shown.some(function (r) { return r.cmp && r.cmp.side != null; });
    return '<section class="dd-contrib" aria-label="' + esc(P.aria) + '"><ul class="dd-rows">' + shown.map(function (r) {
      return HC.contribRow({ row: r.k, icon: r.k, label: P.rows[r.k], value: r.val, mark: markOf(r.cmp, X) });
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
    return { k: k, val: c ? (unit === '%' ? HC.pct(c.v, false, dec) : X.fmt(c.v, dec) + (unit ? ' ' + unit : '')) : null, cmp: c };
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
    var hours = valRow('need', X, m, iso, 1, '', m.dir || 1);
    if (hours.val != null) hours.val = HC.hours(hours.cmp.v) + (isNum(m.target) ? ' / ' + HC.hours(m.target) : '');
    var eff = Array.isArray(m.eff) ? valRow('eff', X, m, iso, 0, '%', 1, m.eff) : { k: 'eff', val: null };
    var cons = Array.isArray(m.cons) ? valRow('cons', X, m, iso, 0, 'min', -1, m.cons) : { k: 'cons', val: null };
    var restor = { k: 'restor', val: null };
    var rc = iso ? compare(function (x) { return restorOf(X, m, x); }, iso, 1) : null;
    var asleep = iso ? X.valueOf(m, iso) : null;
    if (rc) restor = { k: 'restor', val: HC.hours(rc.v) + (isNum(asleep) && asleep > 0 ? ' · ' + HC.pct((100 * rc.v) / asleep) : ''), cmp: rc };
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
      var share = k !== 'awake' && isNum(asleep) && asleep > 0 ? ' · ' + HC.pct((100 * h[k]) / asleep) : '';
      return '<li><i class="dd-sw dd-st-' + k + '" aria-hidden="true"></i>' + esc(P[k]) + ' <b>' + esc(HC.hours(h[k]) + share) + '</b></li>';
    }).join('');
    return '<section class="dd-stages"><h3 class="dd-sec">' + esc(P.aria) + '</h3><div class="dd-stbar" aria-hidden="true">' + bar + '</div>' +
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

  /* ---------- weekly trends: one card per input, the 7 days ending at the page's day ---------- */
  function weekOf(end) {
    var out = [];
    for (var k = WEEK - 1; k >= 0; k--) out.push(shiftIso(end, -k));
    return out;
  }
  // the day the week ends on and highlights: the day the page describes — recovery = its headline
  // night, sleep = the dial's night (when within the last week), strain = the day it was opened on —
  // else the view end; so the highlighted column carries the hero's value instead of an empty today
  function weekEnd(key, m, end, X) {
    var h = m.head;
    var d = key === 'recovery' ? (h && h.mode === 'today' ? isoDate(h.date) : null)
      : key === 'sleep' ? sleepNight(m, end, X) : key === 'strain' ? strainIso(end, X) : null;
    return d && d <= end && d > shiftIso(end, -WEEK) ? d : end;
  }
  // a night's recovery % (DIALS.days: the dial as it read THAT morning, lib/score/days.mjs; the newest
  // night from DIALS.recovery), null when that night has no % (no complete night, too few prior nights)
  function recPctOn(iso) {
    var D = dials(), out = null;
    if (!D) return null;
    (D.days || []).forEach(function (x) {
      var r = x && x.recovery;
      if (x.date === iso && r && r.state === 'ok' && r.mode === 'today' && r.date === iso && isNum(r.pct)) out = r.pct;
    });
    var r0 = D.recovery;
    if (out == null && r0 && r0.state === 'ok' && r0.mode === 'today' && r0.date === iso && isNum(r0.pct)) out = r0.pct;
    return out;
  }
  // the % band (lib/score/recovery.mjs PCT_GOOD 67 / PCT_LOW 33), the dial's colours
  function pctCls(v) {
    return v >= 67 ? 'good' : v <= 33 ? 'low' : 'mid';
  }
  // card: {title, get(iso) -> number|null, text(v), cls(v) -> colour class, frac(v, max) -> 0..1,
  // tone (the value is printed in its bar's colour)}; the LAST day is the page's day (highlighted)
  function weeklyCard(card, days, X) {
    var vals = days.map(card.get);
    if (!vals.some(isNum)) return '';
    var max = Math.max.apply(null, vals.map(function (v) { return isNum(v) ? Math.abs(v) : 0; })) || 1;
    var N = typeof I18N_DATE !== 'undefined' && I18N_DATE && I18N_DATE.weekdaysMin ? I18N_DATE.weekdaysMin : null;
    var cols = days.map(function (iso, i) {
      var v = vals[i];
      var f = isNum(v) ? Math.max(0, Math.min(1, card.frac ? card.frac(v) : v / max)) : 0;
      var bar = isNum(v) && f > 0 ? '<i class="dd-bar dd-c-' + esc(card.cls(v)) + '" style="height:' + Math.round(f * 100) + '%"></i>' : '';
      return '<li class="dd-col' + (i === days.length - 1 ? ' dd-now' : '') + '"><span class="dd-val' + (card.tone && isNum(v) ? ' dd-v-' + esc(card.cls(v)) : '') + '">' +
        esc(isNum(v) ? card.text(v) : '—') + '</span>' +
        '<span class="dd-track-col">' + bar + '</span><span class="dd-wd">' + esc(N ? N[HC.weekdayIndex(iso)] : HC.fmtDate(iso)) + '</span>' +
        '<span class="sr-only">' + esc(HC.fmtDate(iso)) + '</span></li>';
    }).join('');
    return '<section class="dd-wk" aria-label="' + esc(format(X.T.deep.weekly.aria, { title: card.title })) + '"><h4 class="dd-wk-t">' + esc(card.title) + '</h4>' +
      '<ol class="dd-cols">' + cols + '</ol></section>';
  }
  function plain(cls) {
    return function () { return cls; };
  }
  function weeklyCards(key, m, X, days) {
    var cards = [];
    var simple = function (k, cls) {
      var mk = X.metric(k);
      if (!mk) return;
      cards.push({ title: X.titleOf(k), get: seriesGet(X, mk), text: function (v) { return X.fmtM(mk, v, mk.dec); }, cls: plain(cls) });
    };
    if (key === 'recovery') {
      // each night's recovery % (the dial's number that morning), bar and value in its % band colour;
      // no % baked this week (too few prior nights, no DIALS): each day's composite by its own day band
      // (the calendar's colours), on the dial's -3..+3 scale
      if (days.some(function (d) { return recPctOn(d) != null; })) {
        cards.push({ title: X.titleOf('recovery'), get: recPctOn, text: function (v) { return HC.pct(v); }, cls: pctCls, frac: function (v) { return v / 100; }, tone: true });
      } else {
        cards.push({
          title: X.titleOf('recovery'), get: seriesGet(X, m), text: function (v) { return X.signed(v, 1); },
          cls: function (v) { return v >= m.cut ? 'good' : v <= -m.cut ? 'low' : 'mid'; },
          frac: function (v) { return (Math.max(-Z, Math.min(Z, v)) + Z) / (2 * Z); },
        });
      }
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
        cards.push({ title: X.T.deep.weekly.restor, get: function (iso) { return restorOf(X, m, iso); }, text: function (v) { return HC.hours(v); }, cls: plain('sleep') });
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
    var days = weekOf(weekEnd(key, m, end, X));
    var html = weeklyCards(key, m, X, days).map(function (c) { return weeklyCard(c, days, X); }).join('');
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
  // the band sentence, then the usual day (the median of the 30 days before, when 7+ of them have a
  // strain); the 0-21 scale's calibration lives under ⓘ (strainNotes)
  function strainLines(m, end, X) {
    var P = X.T.deep.strain, iso = strainIso(end, X), v = X.at(m.v, m, iso);
    if (!isNum(v)) return [{ text: format(P.noDay, { date: HC.fmtDate(iso) }) }];
    var usual = '';
    var c = compare(function (x) { return X.at(m.v, m, x); }, iso, 0);
    if (c && c.side != null) {
      var prior = [];
      for (var k = 1; k <= PRIOR_DAYS; k++) { var x = X.at(m.v, m, shiftIso(iso, -k)); if (isNum(x)) prior.push(x); }
      prior.sort(function (a, z) { return a - z; });
      usual = format(X.T.deep.prose.strainUsual, { value: X.fmt(quart(prior, 0.5), 1) });
    }
    return prose([P.bands[strainBand(v)], usual]);
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
      return HC.contribRow({ icon: r.icon, label: r.lbl, sub: r.sub, value: r.val });
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

  // load pages: the gym / run / bike pills (no longer under Inicio's dials): each opens that
  // modality's page and sets Inicio's load dial to it (score.js scMod, when loaded); the page's own
  // modality is the pressed one. Fewer than two modalities with a load series: no pills.
  function modSwitch(key, X) {
    var cur = X.modOf(key);
    var mods = ['gym', 'run', 'bike'].filter(function (k) { return !!X.metric('load-' + k); });
    if (mods.length < 2) return '';
    var set = typeof scMod === 'function';
    return '<div class="dial-switch" role="group" aria-label="' + esc(X.T.deep.modSwitch) + '">' + mods.map(function (k) {
      return '<button type="button" class="chip dial-mod" data-detail="load-' + k + '" aria-pressed="' + (k === cur) + '"' +
        (set ? ' onclick="scMod(\'' + k + '\')"' : '') + '>' + esc(X.T.modalities[k] || k) + '</button>';
    }).join('') + '</div>';
  }

  function render(key, m, end, X) {
    if (key === 'stress') return stressPage(key, m, end, X);
    if (key === 'energy-bank') return energyPage(key, m, end, X);
    if (key === 'strain') {
      return {
        head: headHtml(key, end, X),
        top: '<div class="dd-info" id="dd-info" hidden>' + X.bandText(key, m) + strainNotes(X) + '</div>' + heroHtml(strainHero(m, end, X), X) +
          strainContribHtml(m, end, X) + insightHtml(strainLines(m, end, X), X, 'strain') + weeklyHtml(key, m, end, X) + reLinksHtml(X),
      };
    }
    var hero = key === 'recovery' ? recoveryHero(m, X) : key === 'sleep' ? sleepHero(m, end, X) : loadHero(key, m, X);
    var lines = key === 'recovery' ? recoveryLines(m, X) : key === 'sleep' ? sleepLines(m, end, X) : loadLines(key, m, X);
    var rows = key === 'recovery' ? recoveryRows(m, end, X) : key === 'sleep' ? sleepRows(m, end, X) : loadRows(key, m, end, X);
    return {
      head: headHtml(key, end, X),
      // dial -> contributors -> insight, like the reference; the sleep stages bar follows the insight
      top: infoHtml(key, m, X) + heroHtml(hero, X) + contribHtml(rows, X) +
        (key === 'sleep' || key === 'recovery' ? '' : modSwitch(key, X)) + insightHtml(lines, X, key === 'recovery' || key === 'sleep' ? key : 'load') +
        (key === 'sleep' ? stagesHtml(m, end, X) : '') + weeklyHtml(key, m, end, X),
    };
  }

  /* ---------- stress monitor (key 'stress', SCORES.stress: lib/score/stress.mjs) ---------- */
  // A heart-rate-only ESTIMATE per waking hour, 0-3. Nothing is scored here: the hours, the latest
  // hour, the average and the minutes per band are baked; this only lays them out.
  var SB = ['low', 'medium', 'high'];
  function stressBake() {
    var S = typeof SCORES !== 'undefined' && SCORES ? SCORES.stress : null;
    return S && S.ok && Array.isArray(S.days) ? S : null;
  }
  function stressBand(v) {
    return v >= 2 ? 'high' : v >= 1 ? 'medium' : 'low';
  }
  function hhmm(t) {
    return String(t).slice(0, 2) + ':00';
  }
  // the hero: a 0-3 half gauge in the three band colours, a marker at the latest scored hour's value,
  // the value, its band word and the hour (an empty gauge + the dial's "no data" word without one)
  var GC = { x: 60, y: 60, r: 50 };
  function gaugePt(f, r) {
    var a = Math.PI * (1 - f);
    return (GC.x + r * Math.cos(a)).toFixed(1) + ' ' + (GC.y - r * Math.sin(a)).toFixed(1);
  }
  function gaugeArc(f0, f1) {
    return 'M' + gaugePt(f0, GC.r) + ' A' + GC.r + ' ' + GC.r + ' 0 0 1 ' + gaugePt(f1, GC.r);
  }
  function stressHero(d, X) {
    var P = X.T.deep.stress, n = d && d.now;
    var segs = SB.map(function (b, i) {
      return '<path class="ds-arc ds-' + b + '" d="' + gaugeArc(i / 3 + (i ? 0.01 : 0), (i + 1) / 3 - (i < 2 ? 0.01 : 0)) + '"/>';
    }).join('');
    var mark = n ? '<line class="dd-tick ds-mark" x1="' + gaugePt(n.v / 3, GC.r - 9).replace(' ', '" y1="') + '" x2="' + gaugePt(n.v / 3, GC.r + 6).replace(' ', '" y2="') + '"/>' : '';
    var ends = '<text class="ds-ylbl" x="10" y="72" text-anchor="middle">' + esc(X.fmt(0, 1)) + '</text><text class="ds-ylbl" x="110" y="72" text-anchor="middle">' + esc(X.fmt(3, 1)) + '</text>';
    var svg = '<svg class="ds-gauge" viewBox="0 0 120 74" aria-hidden="true">' + segs + mark + ends + '</svg>';
    var band = n ? stressBand(n.v) : null;
    var centre = n
      ? '<b class="dd-num">' + esc(X.fmt(n.v, 1)) + '</b><span class="ds-band">' + esc(P.bands[band]) + '</span>' +
        '<span class="ds-upd">' + esc(format(P.updated, { time: hhmm(n.t) })) + '</span>'
      : '<span class="dd-word">' + esc(X.T.deep.words.none) + '</span>';
    var aria = n ? format(P.heroAria, { value: X.fmt(n.v, 1), band: P.bands[band], time: hhmm(n.t) }) : X.T.deep.words.none;
    return '<section class="dd-hero dd-stress ds-' + (band || 'none') + '"><div class="ds-gwrap" role="img" aria-label="' + esc(aria) + '">' + svg +
      '<div class="ds-centre" aria-hidden="true">' + centre + '</div></div></section>';
  }
  // the day's curve: 24 h across, 0-3 up, the three bands shaded; one point per scored hour (at the
  // middle of its hour), joined while the hours are consecutive. Gaps = sleep, workouts or no data.
  var CV = { w: 320, h: 150, l: 22, r: 6, t: 8, b: 20 };
  function stressCurve(d, X) {
    var P = X.T.deep.stress, iw = CV.w - CV.l - CV.r, ih = CV.h - CV.t - CV.b;
    var x = function (h) { return CV.l + (iw * h) / 24; };
    var y = function (v) { return CV.t + ih * (1 - v / 3); };
    var out = SB.map(function (b, i) {
      return '<rect class="ds-zone ds-' + b + '" x="' + CV.l + '" y="' + y(i + 1).toFixed(1) + '" width="' + iw + '" height="' + (ih / 3).toFixed(1) + '"/>';
    }).join('');
    for (var k = 0; k <= 3; k++) {
      out += '<text class="ds-ylbl" x="' + (CV.l - 5) + '" y="' + (y(k) + 3).toFixed(1) + '" text-anchor="end">' + esc(X.fmt(k, 0)) + '</text>';
    }
    for (var h = 0; h <= 24; h += 6) {
      out += '<text class="ds-xlbl" x="' + x(h).toFixed(1) + '" y="' + (CV.h - 5) + '" text-anchor="' + (h === 0 ? 'start' : h === 24 ? 'end' : 'middle') + '">' + (h < 10 ? '0' : '') + h + ':00</text>';
    }
    var hours = (d && d.hours) || [], path = '', prev = null;
    hours.forEach(function (p) {
      var hh = parseInt(p.t, 10);
      if (!isFinite(hh) || !isNum(p.v)) return;
      path += (prev != null && hh === prev + 1 ? ' L' : (path ? ' M' : 'M')) + x(hh + 0.5).toFixed(1) + ' ' + y(p.v).toFixed(1);
      prev = hh;
    });
    if (path) out += '<path class="ds-line" d="' + path + '"/>';
    hours.forEach(function (p) {
      var hh = parseInt(p.t, 10);
      if (!isFinite(hh) || !isNum(p.v)) return;
      out += '<circle class="ds-pt ds-' + stressBand(p.v) + '" cx="' + x(hh + 0.5).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="2.6"><title>' +
        esc(format(P.ptTitle, { time: hhmm(p.t), value: X.fmt(p.v, 1), hr: X.fmt(p.hr, 0) })) + '</title></circle>';
    });
    return '<section class="ds-curve" aria-label="' + esc(P.curveAria) + '"><h3 class="dd-sec">' + esc(P.curveTitle) + '</h3>' +
      '<svg class="ds-chart" viewBox="0 0 ' + CV.w + ' ' + CV.h + '" role="img" aria-label="' + esc(format(P.curveSr, { n: hours.length })) + '">' + out + '</svg>' +
      '<p class="dd-legend">' + esc(P.gapNote) + '</p></section>';
  }
  // time in each band: one stacked bar + a row per band (minutes outside workouts, <= 60 per hour)
  function stressBands(d, X) {
    var P = X.T.deep.stress;
    if (!d || !d.mins) return '';
    var tot = SB.reduce(function (a, b) { return a + (d.mins[b] || 0); }, 0);
    if (!(tot > 0)) return '';
    var bar = SB.map(function (b) {
      var w = (100 * (d.mins[b] || 0)) / tot;
      return w > 0 ? '<i class="ds-seg ds-' + b + '" style="width:' + w.toFixed(1) + '%"></i>' : '';
    }).join('');
    var rows = SB.slice().reverse().map(function (b) {
      return '<li class="ds-brow"><span class="ds-dot ds-' + b + '" aria-hidden="true"></span><span class="ds-blbl">' + esc(P.bandRows[b]) + '</span>' +
        '<b class="ds-bmin">' + esc(HC.duration(d.mins[b] || 0)) + '</b></li>';
    }).join('');
    return '<section class="ds-bands" aria-label="' + esc(P.bandsTitle) + '"><h3 class="dd-sec">' + esc(P.bandsTitle) + '</h3>' +
      '<div class="ds-bar" aria-hidden="true">' + bar + '</div><ul class="ds-blist">' + rows + '</ul></section>';
  }
  function stressLines(d, iso, S, X) {
    var P = X.T.deep.stress;
    if (!d) return [{ text: format(P.noDay, { date: HC.fmtDate(iso) }) }];
    if (d.avg == null) return [{ text: format(P.few, { n: d.n, min: S.minHours }) }];
    var out = [{ text: format(P.avg, { value: X.fmt(d.avg, 1), band: P.bands[d.band].toLowerCase() }) }];
    if (d.mins) {
      var top = SB.reduce(function (a, b) { return d.mins[b] > d.mins[a] ? b : a; }, 'low');
      out.push({ text: P.most[top] });
    }
    out.push({ cls: 'dt-scale', text: P.estimateLine });
    return out;
  }
  function stressNotes(d, S, X) {
    var P = X.T.deep.stress, txt = function (t) { return '<div class="dt-band-txt">' + esc(t) + '</div>'; };
    var out = txt(P.notes.formula) + txt(P.notes.hours);
    if (d && d.rhr != null) out += txt(format(P.notes.inputs, { rhr: X.fmt(d.rhr, 1), max: X.fmt(S.maxHr, 0), min: S.minHours }));
    return out + txt(P.notes.limits) + txt(P.notes.estimate);
  }
  function stressPage(key, m, end, X) {
    var S = stressBake(), iso = strainIso(end, X);
    var d = S ? strainDayOf(S.days, iso) : null;
    return {
      head: headHtml(key, end, X),
      top: '<div class="dd-info" id="dd-info" hidden>' + X.bandText(key, m) + (S ? stressNotes(d, S, X) : '') + '</div>' +
        stressHero(d, X) + stressCurve(d, X) + stressBands(d, X) + insightHtml(S ? stressLines(d, iso, S, X) : [], X),
    };
  }

  /* ---------- energy bank (key 'energy-bank', SCORES.energy: lib/score/energy.mjs) ---------- */
  // OUR intraday 0-100 estimate: wake at the morning's recovery %, then per awake hour a baseline,
  // stress and heart-rate-load drain and a calm-hour recharge. Everything is baked; this lays it out.
  function energyBake() {
    var S = typeof SCORES !== 'undefined' && SCORES ? SCORES.energy : null;
    return S && S.ok && Array.isArray(S.days) ? S : null;
  }
  function energyBand(v) {
    return v >= 67 ? 'hi' : v >= 34 ? 'mid' : 'lo';
  }
  function wakeOf(d) {
    var m = /^(\d{2}):(\d{2})$/.exec(String(d.wake || ''));
    return m ? +m[1] + m[2] / 60 : null;
  }
  function nowTime(d) {
    return d.now.h != null ? hhmm(d.now.h) : d.wake;
  }
  // the hero: the 0-100 half gauge filled to the latest level in its band colour
  function energyHero(d, X) {
    var P = X.T.deep.energy, v = d && d.now ? d.now.lv : null;
    var b = v != null ? energyBand(v) : null;
    var svg = '<svg class="ds-gauge" viewBox="0 0 120 74" aria-hidden="true"><g class="ds-none"><path class="ds-arc" d="' + gaugeArc(0, 1) + '"/></g>' +
      (v > 0 ? '<path class="ds-arc" d="' + gaugeArc(0, Math.min(1, v / 100)) + '"/>' : '') +
      '<text class="ds-ylbl" x="10" y="72" text-anchor="middle">0</text><text class="ds-ylbl" x="110" y="72" text-anchor="middle">100</text></svg>';
    var centre = v != null
      ? '<b class="dd-num">' + esc(String(v)) + '</b><span class="ds-band">' + esc(P.bands[b]) + '</span><span class="ds-upd">' + esc(format(P.updated, { time: nowTime(d) })) + '</span>'
      : '<span class="dd-word">' + esc(X.T.deep.words.none) + '</span>';
    var aria = v != null ? format(P.heroAria, { value: v, band: P.bands[b], time: nowTime(d) }) : X.T.deep.words.none;
    return '<section class="dd-hero dd-stress de-' + (b || 'none') + '"><div class="ds-gwrap" role="img" aria-label="' + esc(aria) + '">' + svg +
      '<div class="ds-centre" aria-hidden="true">' + centre + '</div></div></section>';
  }
  // the day's curve: 24 h across, 0-100 up, the three level bands shaded; the line starts at the wake
  // level and steps at each hour's end. Dots: workout / heart-rate load hours (blue), high-stress hours (orange).
  function energyCurve(d, X) {
    var P = X.T.deep.energy, iw = CV.w - CV.l - CV.r, ih = CV.h - CV.t - CV.b, w0 = d ? wakeOf(d) : null;
    if (!d || !d.now || w0 == null) return '';
    var x = function (h) { return (CV.l + (iw * h) / 24).toFixed(1); };
    var y = function (v) { return (CV.t + ih * (1 - v / 100)).toFixed(1); };
    var out = [['lo', 0, 34], ['mid', 34, 67], ['hi', 67, 100]].map(function (z) {
      return '<rect class="ds-zone de-' + z[0] + '" x="' + CV.l + '" y="' + y(z[2]) + '" width="' + iw + '" height="' + ((ih * (z[2] - z[1])) / 100).toFixed(1) + '"/>';
    }).join('');
    [0, 50, 100].forEach(function (k) {
      out += '<text class="ds-ylbl" x="' + (CV.l - 5) + '" y="' + (+y(k) + 3).toFixed(1) + '" text-anchor="end">' + k + '</text>';
    });
    for (var h = 0; h <= 24; h += 6) {
      out += '<text class="ds-xlbl" x="' + x(h) + '" y="' + (CV.h - 5) + '" text-anchor="' + (h === 0 ? 'start' : h === 24 ? 'end' : 'middle') + '">' + (h < 10 ? '0' : '') + h + ':00</text>';
    }
    var hrs = d.hours || [], path = 'M' + x(w0) + ' ' + y(d.start), dots = '';
    hrs.forEach(function (p) {
      path += ' L' + x(p.h + 1) + ' ' + y(p.lv);
      var cls = p.wo || p.ld >= 5 ? 'ds-low' : isNum(p.st) && p.st >= 2 ? 'ds-high' : '';
      if (cls) {
        dots += '<circle class="ds-pt ' + cls + '" cx="' + x(p.h + 1) + '" cy="' + y(p.lv) + '" r="3"><title>' +
          esc(format(P.ptTitle, { time: hhmm(p.h), value: X.fmt(p.lv, 0), load: X.fmt(p.ld, 1), stress: isNum(p.st) ? X.fmt(p.st, 1) : '—' })) + '</title></circle>';
      }
    });
    out += '<path class="ds-line" d="' + path + '"/>' + dots;
    return '<section class="ds-curve" aria-label="' + esc(P.curveAria) + '"><h3 class="dd-sec">' + esc(P.curveTitle) + '</h3>' +
      '<svg class="ds-chart" viewBox="0 0 ' + CV.w + ' ' + CV.h + '" role="img" aria-label="' + esc(format(P.curveSr, { start: d.start, wake: d.wake, value: d.now.lv, time: nowTime(d) })) + '">' + out + '</svg>' +
      '<p class="dd-legend">' + esc(P.dotNote) + '</p></section>';
  }
  // start, what drained it, what recharged it, the low: the contributor rows' look
  function energyParts(d, X) {
    var P = X.T.deep.energy, R = P.rows;
    if (!d || !d.now) return '';
    var neg = function (v) { return v > 0 ? '−' + X.fmt(v, 1) : X.fmt(0, 0); };
    var rows = [
      ['wake', R.start, format(R.startSub, { wake: d.wake }), String(d.start)],
      ['clock', R.base, R.baseSub, neg(d.sum.base)],
      ['hrv', R.stress, R.stressSub, neg(d.sum.stress)],
      ['re', R.load, R.loadSub, neg(d.sum.load)],
      ['restor', R.charge, R.chargeSub, '+' + X.fmt(d.sum.charge, 0)],
      ['eff', R.low, d.min.h != null ? format(R.lowSub, { time: hhmm(d.min.h) }) : R.lowStart, String(d.min.lv)],
    ];
    return '<section class="dd-contrib" aria-label="' + esc(P.partsTitle) + '"><h3 class="dd-sec">' + esc(P.partsTitle) + '</h3><ul class="dd-rows">' + rows.map(function (r) {
      return HC.contribRow({ icon: r[0], label: r[1], sub: r[2], value: r[3] });
    }).join('') + '</ul><p class="dd-legend">' + esc(P.clampNote) + '</p></section>';
  }
  function energyLines(d, iso, X) {
    var P = X.T.deep.energy;
    if (!d) return [{ text: format(P.noDay, { date: HC.fmtDate(iso) }) }];
    if (!d.now) return [{ text: P.reasons[d.reason] || P.reasons.noRecovery }];
    var out = [{ text: format(P.line, { start: d.start, wake: d.wake, value: d.now.lv, time: nowTime(d) }) }];
    var top = ['base', 'stress', 'load'].reduce(function (a, k) { return d.sum[k] > d.sum[a] ? k : a; }, 'base');
    if (d.sum[top] > 0) out.push({ text: P.most[top] });
    out.push({ cls: 'dt-scale', text: P.estimateLine });
    return out;
  }
  function energyNotes(d, S, X) {
    var P = X.T.deep.energy, C = S.C || {}, txt = function (t) { return '<div class="dt-band-txt">' + esc(t) + '</div>'; };
    var out = txt(P.notes.model) + txt(format(P.notes.formula, {
      base: X.fmt(C.BASE_DRAIN, 1), stress: X.fmt(C.STRESS_DRAIN, 1), load: X.fmt(C.LOAD_DRAIN, 0), calm: X.fmt(C.CALM_STRESS, 1), charge: X.fmt(C.RECHARGE, 0),
    })) + txt(P.notes.hours);
    out += txt(format(P.notes.inputs, { k: X.fmt(S.K, 1), max: S.maxHr != null ? X.fmt(S.maxHr, 0) : '—' }));
    return out + txt(P.notes.limits);
  }
  function energyPage(key, m, end, X) {
    var S = energyBake(), iso = strainIso(end, X);
    var d = S ? strainDayOf(S.days, iso) : null;
    return {
      head: headHtml(key, end, X),
      top: '<div class="dd-info" id="dd-info" hidden>' + X.bandText(key, m) + (S ? energyNotes(d, S, X) : '') + '</div>' +
        energyHero(d, X) + energyCurve(d, X) + energyParts(d, X) + insightHtml(S ? energyLines(d, iso, X) : [], X),
    };
  }

  window.HCDeep = { isDial: isDial, render: render, compare: compare, weekOf: weekOf };
})();
