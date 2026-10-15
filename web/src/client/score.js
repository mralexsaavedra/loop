/* Home tab: recovery = last night as a % RANK within the previous 90 days (recovery.today.pct; under 21
 * prior days the composite in units of the user's typical spread, I18N_SCORE recovery.unit) + its 7-day TREND + per-modality load,
 * rendered client-side from SCORES / I18N_SCORE / LOCALE baked by components/Bake.astro.
 *
 * Classic script (is:inline, no module scope). Only `asOf` is baked: staleness is computed here
 * from Date.now(), so consecutive builds stay byte-identical. Colour is used only on the
 * direction arrows and the dials' meaning colours. Advice uses the same templates and number formatting as
 * lib/score/advice-copy.mjs (a test asserts the two sentences are identical).
 *
 * Dials (Sleep / Recovery / Load): all geometry comes pre-computed in DIALS (web/src/view/dial.mjs,
 * baked by components/Bake.astro); this file only formats the baked numbers and joins SVG strings.
 * Today first: recovery = last night's % (or composite) with the 7-day trend underneath, load = the day's
 * RE vs the typical training day with acute/chronic as the caption. The "last night" / "today" /
 * "yesterday" words are decided here from Date.now(), never baked.
 *
 * Day strain (DIALS.strain, lib/score/strain.mjs, when calibrated): the third dial is the day's strain
 * 0-21 ("12.4" inside, the load label, strain blue), opening the strain deep-dive; no modality pills
 * (per-modality Relative Effort stays in Entreno's load cards and the load deep-dives). Without a
 * calibrated strain the third dial is the per-modality load dial with its pills, exactly as before.
 *
 * Day stepping (the top bar's "‹ TODAY ›", client/today-date.js window.HCDay): on a PAST day the dials
 * and the collapsed row show that day — sleep + recovery from DIALS.days (lib/score/days.mjs, scored
 * on that day), load from the modality's baked recent `days` — open their deep-dive on that day
 * (data-date), are never greyed as stale, and the advice (it reads the current 7-day trend) is hidden.
 * Today goes through exactly the code it always did (VIEW = null), so its markup is unchanged.
 */
// Load dial modality switch: shows the chosen modality's dial on Inicio, hides the others. The gym /
// run / bike pills live in the load deep-dive (client/deepdive.js modSwitch: each opens that
// modality's page and, through data-mod, sets this dial), not under the dials; the collapsed dial row (#home-mini) carries
// the same data-dmod items, so it follows too. A missing host is skipped. No bare page global: the setter is
// window.HCScore.setMod (deepdive.js feature-detects it), and the load pages' pills carry data-mod="<modality>"
// (no inline onclick: the page's CSP blocks them); a click on one follows Inicio's dial through the delegated
// listener below, the pill's own data-detail still opens its page (detail.js)
(function () {
  function setMod(key) {
    ['home-dials', 'home-advice', 'home-mini'].forEach(function (id) {
      var host = document.getElementById(id);
      if (!host || !host.querySelectorAll) return;
      host.querySelectorAll('[data-dmod]').forEach(function (el) {
        el.hidden = el.getAttribute('data-dmod') !== key;
      });
    });
  }
  if (typeof window !== 'undefined') window.HCScore = { setMod: setMod };
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', function (e) {
      var b = e && e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-mod]') : null;
      if (b) setMod(b.getAttribute('data-mod'));
    });
  }
})();
(function () {
  var host = document.getElementById('home-advice');
  if (!host) return;
  var T = I18N_SCORE;
  var S = typeof SCORES === 'undefined' ? null : SCORES;
  var STALE_DAYS = HC.STALE_DAYS; // older data is greyed and gets no advice (baked)
  var ES = HC.isEs();

  // shared helpers (web/src/client/util.js)
  var esc = HC.esc, format = HC.format, num = HC.num, isoDate = HC.isoDate, daysOld = HC.daysOld, todayIso = HC.todayIso;
  function pct(x) {
    return HC.pct(x, true);
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
  // the recovery trend's glyph: THE trend glyph (docs/design-system.md), its colour from the shared tone
  // classes — above baseline = better (▲ db-good), below = worse (▼ db-bad), at = the grey •
  var GLYPH = { above: '▲', below: '▼', at: '•' };
  var GLYPH_TONE = { above: 'good', below: 'bad', at: 'flat' };
  function arrow(band) {
    var b = Object.prototype.hasOwnProperty.call(GLYPH, band) ? band : 'at';
    return '<span class="sc-arrow db-' + GLYPH_TONE[b] + '" aria-hidden="true">' + GLYPH[b] + '</span>';
  }
  function asOfHtml(iso) {
    iso = isoDate(iso);
    return iso ? '<span class="sc-asof">' + esc(format(T.asOfLbl, { date: HC.fmtDate(iso) })) + '</span>' : '';
  }
  function staleHtml(iso) {
    var days = { days: daysOld(iso) };
    return HC.staleMark('sc-stale-note', format(T.staleShort, days), format(T.staleNote, days));
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
  // Whoop-style detail: headline (last night, big number + band word, one short 7-day trend line) |
  // 14-day sparkline | compact contributors (name, latest value, ±SD); the raw last-14-days lists are
  // folded into a <details>. The long lines (what the baseline is, the full trend sentence with the
  // week-on-week change, confidence, the SDNN caveat, the unit in words, each contributor's baseline
  // and n, missing / lowest signal) are the card's notes: they go behind the Salud Recovery section's
  // ⓘ (#hs-info-recovery, client/health.js) when it exists, else behind the card's own ⓘ (#rec-info).
  // Every number is the same as the glance on Inicio.
  function compDec(c) {
    return c.unit === 'min' ? 0 : 1;
  }
  // a contributor's value: hours as h:mm (no unit), anything else at its decimals
  function compVal(c, v) {
    return c.unit === 'h' ? HC.hours(v) : num(v, compDec(c), false);
  }
  function compUnit(c) {
    return c.unit === 'h' ? '' : c.unit;
  }
  function recHeadline(R, rt) {
    var out = [];
    if (R.today) {
      // "Last night" only when that day has a sleep-duration reading AND is dated the viewer's today;
      // otherwise the night's date (+ "no sleep data")
      var d = HC.fmtDate(R.today.date);
      var when = R.today.sleep === false ? format(rt.whenNoSleep, { date: d })
        : daysOld(R.today.date) === 0 ? rt.whenLastNight
        : format(rt.whenDate, { date: d });
      out.push('<div class="rec-when">' + esc(when) + '</div>');
      var pct = typeof R.today.pct === 'number';
      var band = pct ? R.today.pctBand : R.today.band;
      // THE carried-value rule (HC.carried): a night from an earlier day (dated just above) is dimmed;
      // a stale card's grey is the stronger state
      var c = HC.carried(R.today.date, null, { stale: isStale(R.asOf) });
      out.push('<div class="rec-big sc-band-' + esc(band) + c.cls + '"><b class="rec-num">' + esc(pct ? String(R.today.pct) : num(R.today.value, 1, true)) +
        '<small class="rec-unit">' + esc(pct ? '%' : rt.unit) + '</small></b><span class="rec-band">' + esc(pct ? rt.pctBands[band] : rt.bands[band]) + '</span></div>');
    } else {
      out.push('<div class="sc-note">' + esc(rt.noToday) + '</div>');
    }
    out.push('<div class="rec-trend">' + arrow(R.band) + esc(format(rt.trendShort, { value: num(R.trend7, 1, true) })) +
      ' · <span class="sc-band-' + esc(R.band) + '">' + esc(rt.bands[R.band]) + '</span></div>');
    // no HRV in the score (lib/score/recovery.mjs noHrv / hrvPending): partial, said in one short line
    if (R.noHrv || R.hrvPending) out.push('<div class="sc-note rec-partial">' + esc(rt.partialShort) + '</div>');
    return '<div class="rec-head">' + out.join('') + '</div>';
  }
  // the card's notes (plain text, escaped by recInfoHtml), in reading order
  function recNotes(R, rt) {
    var out = [];
    if (R.today && typeof R.today.pct === 'number') {
      out.push(rt.pctNote);
      out.push(format(rt.sdLbl, { value: num(R.today.value, 1, true), band: rt.bands[R.today.band] }));
    }
    if (R.today) out.push(rt.vsBaseLbl);
    out.push(format(rt.trendLbl, { value: num(R.trend7, 1, true) }) + ' · ' + rt.bands[R.band] +
      (R.delta7 != null ? ' · ' + format(rt.deltaLbl, { value: num(R.delta7, 1, true) }) : ''));
    // what the card's sparkline shows (no caption under it: the reference app's cards carry no prose)
    if (R.spark && R.spark.v && R.spark.v.length) out.push(rt.sparkLbl);
    (R.components || []).forEach(function (c) {
      out.push(rt.components[c.key] + ': ' + format(rt.baselineLbl, { value: compVal(c, c.baseline), unit: compUnit(c) }).trim() + ' · ' + format(rt.nLbl, { n: c.n }));
    });
    // the composite's unit in plain words (rt.unit = the ONE recovery unit, also the dial's and the sheet's)
    out.push(rt.unitNote);
    out.push(format(rt.confLbl, { level: rt.confLevels[R.confidence.level] }) + ' · ' + rt.sdnnLbl);
    if (R.noHrv) out.push(rt.partialNote);
    if (R.hrvPending) out.push(rt.partialPendingNote);
    if (R.rhrDerived) out.push(rt.rhrDerivedNote);
    if (R.missing && R.missing.length) out.push(format(rt.missingLbl, { list: R.missing.map(function (k) { return rt.components[k]; }).join(', ') }));
    if (R.driver) out.push(format(rt.driverLbl, { name: rt.components[R.driver] }));
    return out;
  }
  function recInfoHtml(notes) {
    return notes.map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('');
  }
  // the Salud Recovery section's ⓘ block: the card's notes are (re)written into their own child,
  // after the section's notes, so a re-render replaces them instead of stacking them
  function intoSectionInfo(notes) {
    var box = document.getElementById('hs-info-recovery');
    if (!box) return false;
    var own = String(box.innerHTML || '').replace(/<div class="rec-info-notes">[\s\S]*<\/div>$/, '');
    box.innerHTML = own + '<div class="rec-info-notes">' + recInfoHtml(notes) + '</div>';
    return true;
  }
  // a contributor in THE contributor row (HC.contribRow, the recovery sheet's look): its latest value,
  // the 7-day ±SD as the small sub line, and ▲ / ▼ = which way its 7-day mean sits from the baseline
  // (the raw direction: a lower resting HR is ▼), coloured by what that means — band above = better,
  // below = worse — or • at baseline (docs/design-system.md → Contributor row)
  var COMP_ICON = { hrv: 'hrv', rhr: 'rhr', sleepDur: 'sleep', sleepCons: 'cons' };
  var COMP_TONE = { above: 'better', below: 'worse', at: 'typical' };
  function recContributor(c, rt) {
    var last = c.daily && c.daily.length ? c.daily[c.daily.length - 1] : null;
    var tone = COMP_TONE[c.band];
    var side = c.band === 'above' ? (c.dir || 1) : c.band === 'below' ? -(c.dir || 1) : 0;
    return HC.contribRow({
      row: c.key, icon: COMP_ICON[c.key] || 'hrv', label: rt.components[c.key], sub: num(c.trend7, 1, true) + ' ' + rt.unit,
      value: last ? compVal(c, last.value) + (compUnit(c) ? ' ' + compUnit(c) : '') : '—',
      mark: tone ? { glyph: side > 0 ? '▲' : side < 0 ? '▼' : '•', tone: tone, said: rt.cmp[tone] } : null,
    });
  }
  function recRaw(comps, rt) {
    return '<details class="rec-raw"><summary>' + esc(rt.rawSummary) + '</summary>' + comps.map(function (c) {
      var lbl = compUnit(c) ? format(rt.rawCompLbl, { name: rt.components[c.key], unit: c.unit }) : rt.components[c.key];
      return '<div class="sc-raw"><span class="sc-raw-lbl">' + esc(lbl) + '</span>' +
        c.daily.map(function (d) { return '<span class="sc-raw-v">' + esc(compVal(c, d.value)) + '</span>'; }).join('') + '</div>';
    }).join('') + '</details>';
  }
  function recoveryHtml(R) {
    var stale = isStale(R.asOf);
    var rt = T.recovery;
    var out = ['<div class="sc-card sc-recovery' + (stale ? ' sc-stale' : '') + '">'];
    // the card holds a <details> fold, so it is not itself an opener: a real button opens the history
    var hist = HC.detailAttrs('recovery', null, { plain: true });
    var notes = R.gated ? [] : recNotes(R, rt);
    var own = notes.length && !intoSectionInfo(notes);
    // no card title: the card is the only one under Salud's "Recovery" section heading, so its head
    // keeps only what is its own (the as-of date, History, the ⓘ) — docs/design-system.md → Section heading
    out.push('<div class="sc-head">' + asOfHtml(R.asOf) +
      (hist ? HC.cta(rt.historyBtn, hist + ' aria-haspopup="dialog"') : '') +
      (own ? HC.infoBtn('rec-info', format(rt.infoLbl, { section: rt.heading })) : '') + '</div>');
    if (own) out.push('<div class="hs-info" id="rec-info" hidden>' + recInfoHtml(notes) + '</div><!--/rec-info-->');
    if (stale) out.push(staleHtml(R.asOf));
    if (R.gated) {
      out.push('<div class="sc-insufficient">' + esc(rt.insufficient) + '</div></div>');
      return out.join('');
    }
    var comps = R.components || [];
    out.push('<div class="rec-layout">' + recHeadline(R, rt) +
      '<div class="sc-spark rec-spark">' + sparkSvg(R.spark && R.spark.v) + '</div>' +
      '<ul class="dd-rows rec-contrib">' + comps.map(function (c) { return recContributor(c, rt); }).join('') + '</ul></div>');
    if (comps.length) out.push(recRaw(comps, rt));
    out.push('</div>');
    return out.join('');
  }

  /* ---- load (Entreno #score-load) ---- */
  // One compact card per modality: the last scored session's Relative Effort (big, strain blue) in a
  // small ring drawn from the dial's own baked arc for that day (DIALS, so it never disagrees with the
  // Inicio dial or the deep-dive), "LOAD · <date>", and a pill for the 7-day vs 42-day trend. A tap
  // opens that modality's deep-dive (load-<m>). The relative score, coverage, other activities and the
  // caveats sit behind the section's ⓘ (nothing dropped, only moved).
  var LOAD_TONE = { steady: 'flat', above: 'good', below: 'good', ramping: 'bad', wellBelow: 'bad' };
  var LOAD_ARROW = { steady: '•', above: '▲', ramping: '▲', below: '▼', wellBelow: '▼' };
  function loadDialOf(key) {
    var out = null;
    var list = D && D.load && Array.isArray(D.load.modalities) ? D.load.modalities : [];
    list.forEach(function (x) { if (x && x.key === key) out = x; });
    return out;
  }
  function miniRing(fill) {
    if (!D || !D.track) return '';
    var tick = D.load && D.load.tick;
    return '<svg class="ld-ring" viewBox="0 0 120 120" aria-hidden="true"><path class="ld-track" d="' + attr(D.track) + '"/>' +
      (fill ? '<path class="ld-fill" d="' + attr(fill) + '"/>' : '') +
      (tick ? '<line class="ld-tick" x1="' + attr(tick.x1) + '" y1="' + attr(tick.y1) + '" x2="' + attr(tick.x2) + '" y2="' + attr(tick.y2) + '"/>' : '') + '</svg>';
  }
  function loadCard(m) {
    var lt = T.load, dl = T.dials.load;
    var name = lt.modalities[m.key] || m.key;
    var dm = loadDialOf(m.key);
    var gated = dm ? dm.state !== 'ok' : !(m.trend && m.trend.ok);
    var last = m.last && isoDate(m.last.date) ? m.last : dm && dm.last && isoDate(dm.last.date) ? dm.last : null;
    var fill = null;
    if (last && dm) (dm.days || []).forEach(function (x) { if (x.date === last.date && x.fill) fill = x.fill; });
    var when = last ? (last.date === todayIso() ? lt.today : HC.fmtDate(last.date, { weekday: false })) : '';
    var val = last && !gated ? HC.num(last.re, 0, false) : "—";
    // no value ("—": no session in the data) = no delta pill either: "▼ -64%" beside "—" read as a value
    var tr = m.trend && m.trend.ok && last && !gated ? m.trend : null;
    var pill = tr ? '<span class="ld-pill ld-' + LOAD_TONE[tr.band] + '">' + esc(LOAD_ARROW[tr.band] + ' ' + pct(tr.trendPct)) + '</span>'
      : gated ? '<span class="ld-pill ld-flat">' + esc(dl.gated) + '</span>' : '';
    var aria = [format(lt.cardAria, { modality: name })];
    aria.push(last && !gated ? format(lt.lastAria, { date: HC.fmtDate(last.date), re: val }) : gated ? lt.gated[(m.trend && m.trend.reason) || 'baselineBuilding'] : lt.noSession);
    if (tr) aria.push(format(lt.trendLbl, { pct: pct(tr.trendPct) }) + ', ' + lt.bands[tr.band]);
    return '<div class="ld-card' + (gated ? ' ld-off' : '') + '" data-mod="' + esc(m.key) + '"' + HC.detailAttrs('load-' + m.key) + ' aria-label="' + attr(aria.join('. ')) + '">' +
      '<span class="ld-mod" aria-hidden="true">' + esc(name) + '</span>' +
      '<span class="ld-mid" aria-hidden="true"><b class="ld-num">' + esc(val) + '</b>' + miniRing(gated ? null : fill) + '</span>' +
      '<span class="ld-lbl" aria-hidden="true">' + esc(dl.label) + (when && !gated ? ' · ' + esc(when) : '') + '</span>' +
      (pill ? '<span class="ld-foot" aria-hidden="true">' + pill + '</span>' : '') + '</div>';
  }
  // the notes behind the section's ⓘ: as-of date, one line per modality (relative score, trend band
  // or why it is gated, sessions without effort), other activities, coverage, the epoch, the caveats
  function loadInfo(L) {
    var lt = T.load, out = [];
    var asOf = isoDate(L.asOf) ? format(T.asOfLbl, { date: HC.fmtDate(L.asOf) }) : '';
    if (asOf) out.push('<p>' + esc(asOf.charAt(0).toUpperCase() + asOf.slice(1)) + '. ' + esc(lt.pillHelp) + '</p>');
    L.modalities.forEach(function (m) {
      var parts = [m.relScore != null ? format(lt.relLbl, { score: m.relScore, modality: ADV_MOD[m.key] }) : lt.noRel];
      if (m.trend && m.trend.ok) parts.push(format(lt.trendLbl, { pct: pct(m.trend.trendPct) }) + ' · ' + lt.bands[m.trend.band]);
      else parts.push(lt.gated[(m.trend && m.trend.reason) || 'baselineBuilding']);
      if (m.unscoredAcute > 0) parts.push(format(lt.unscoredNote, { n: m.unscoredAcute }));
      out.push('<p class="sc-mod-line"><b>' + esc(lt.modalities[m.key] || m.key) + ':</b> ' + esc(parts.join(' · ')) + '</p>');
    });
    var o = L.other || {};
    out.push('<p class="sc-other">' + esc(format(lt.otherLine, { days: o.windowDays || 28, minutes: num(o.minutes || 0, 0, false), re: num(o.re || 0, 0, false), sessions: o.sessions || 0 })) + '</p>');
    var c = L.coverage || {};
    out.push('<p class="sc-cov"><b>' + esc(lt.coverageHeading) + ':</b> ' +
      ['scored', 'unscored', 'invalid', 'droppedJunk', 'superseded', 'preEpoch'].map(function (k) {
        return '<span><b class="sc-cov-' + k + '">' + (c[k] || 0) + '</b> ' + esc(lt.coverage[k]) + '</span>';
      }).join(' · ') + '</p>');
    out.push('<p>' + esc(isoDate(L.reEpoch) ? format(lt.preEpochNote, { date: HC.fmtDate(L.reEpoch) }) : lt.noEpochNote) + '</p>');
    return out.join('') + caveatsHtml();
  }
  function loadHtml(L) {
    var lt = T.load;
    var stale = isStale(L.asOf);
    return '<section class="hs-sec sc-load' + (stale ? ' sc-stale' : '') + '" aria-labelledby="ld-h"><div class="hs-head"><h3 class="hs-lbl" id="ld-h">' + esc(lt.heading) + '</h3>' +
      HC.infoBtn('ld-info', format(lt.infoLbl, { section: lt.heading })) + '</div>' +
      '<div class="hs-info" id="ld-info" hidden>' + loadInfo(L) + '</div>' +
      (stale ? staleHtml(L.asOf) : '') +
      '<div class="ld-cards">' + L.modalities.map(loadCard).join('') + '</div></section>';
  }

  function caveatsHtml() {
    var keys = ['re', 'notComparable', 'gymLabel', 'noEpoch', 'residual', 'sdnn', 'notMedical'];
    return '<p class="sc-caveats-h"><b>' + esc(T.caveatsHeading) + '</b></p><ul class="sc-caveats">' +
      keys.map(function (k) { return '<li class="sc-caveat">' + esc(T.caveats[k]) + '</li>'; }).join('') + '</ul>';
  }


  /* ---- dials ---- */
  var D = typeof DIALS === 'undefined' ? null : DIALS;
  // the past day Inicio shows (null = the viewer's today), set from HCDay before each dial render
  var DAY = typeof HCDay !== 'undefined' && HCDay ? HCDay : null;
  var VIEW = null;
  function dayIso() {
    return VIEW || todayIso();
  }
  // a past day is the day the viewer asked for: never greyed as stale
  function dialStale(iso) {
    return VIEW ? false : isStale(iso);
  }
  // that day's sleep + recovery dials (DIALS.days), "No data" when the day has no entry
  function pastDials() {
    var out = null;
    (D.days || []).forEach(function (x) { if (x && x.date === VIEW) out = x; });
    return out || { date: VIEW, sleep: { state: 'none' }, recovery: { state: 'none' } };
  }
  function attr(v) { return esc(String(v)); }
  // parts: fill d, mid {x,y} (the baseline / typical-day tick); paths are baked, never computed here.
  // The fill takes ONE colour end to end (the figure's --dial-c: recovery = its band's state colour)
  function dialSvg(parts) {
    var out = ['<svg class="dial-svg" viewBox="0 0 120 120" aria-hidden="true">'];
    out.push('<path class="dial-track" d="' + attr(D.track) + '"/>');
    if (parts.fill) out.push('<path class="dial-fill" pathLength="100" d="' + attr(parts.fill) + '"/>');
    if (parts.mid) out.push('<circle class="dial-mid" cx="' + attr(parts.mid.x) + '" cy="' + attr(parts.mid.y) + '" r="2"/>');
    out.push('</svg>');
    return out.join('');
  }
  // Whoop-style drill-down: the dial is the glance, a tap opens its detail sheet (client/detail.js);
  // a load dial opens its own modality (detailKey), the no-load placeholder opens training time
  var DIAL_DETAIL = { 'dial-sleep': 'sleep', 'dial-rec': 'recovery', 'dial-load': 'workouts' };
  // Collapsed dial row (Inicio, shown once the dials scroll away): every dialFig call also queues a
  // mini ring = the SAME svg string (baked geometry, colour class), its label and its detail opener —
  // nothing recomputed. dialsHtml() resets the queue, render() writes it to #home-mini.
  var MINI = [];
  function miniItem(cls, stale, extra, aria, svg, label, to) {
    MINI.push('<div class="dm ' + cls + (stale ? ' sc-stale' : '') + '"' + (extra || '') + (to ? HC.detailAttrs(to, VIEW) : '') +
      ' aria-label="' + attr(aria || label) + '"><span class="dm-ring">' + svg + '</span><span class="dm-lbl">' + esc(label) + '</span></div>');
  }
  function miniHtml() {
    return MINI.length && T.dials ? '<div class="dm-row" role="group" aria-label="' + attr(T.dials.ariaLabel) + '">' + MINI.join('') + '</div>' : '';
  }
  // One dial = the ring with its value INSIDE (big number, small unit) and its label BELOW ("SLEEP ›",
  // uppercase in CSS). No caption under it: "last night" / the night's date, the 7-day trend, the sleep
  // target, the load scale and acute/chronic context live in the dial's detail sheet (client/detail.js)
  // and in the accessible name.
  function dialFig(cls, stale, extra, aria, svg, centre, label, detailKey) {
    var to = detailKey || DIAL_DETAIL[cls.split(' ')[0]];
    miniItem(cls, stale, extra, aria, svg, label, to);
    return '<figure class="dial ' + cls + (stale ? ' sc-stale' : '') + '"' + (extra || '') + (to ? HC.detailAttrs(to, VIEW) : '') + '>' +
      '<div class="dial-ring"' + (aria ? ' role="img" aria-label="' + attr(aria) + '"' : '') + '>' + svg +
      '<div class="dial-centre" aria-hidden="true">' + centre + '</div></div>' +
      '<figcaption class="dial-lbl">' + esc(label) + '<span class="chev dial-chev" aria-hidden="true">›</span></figcaption></figure>';
  }
  function numCentre(value, unit) {
    return '<b class="dial-num">' + esc(value) + '<small>' + esc(unit) + '</small></b>';
  }
  function offCentre(word) {
    return '<span class="dial-word">' + esc(word) + '</span>';
  }
  // THE carried-value rule (HC.carried, docs/design-system.md → Carried values): a dial value dated
  // before the shown day (the viewer's today or the stepped-to day) names that date inside the ring
  // (no weekday: it must fit a 360 px ring) and is dimmed, the mini ring too; `stale` (> STALE_DAYS,
  // the stronger grey) keeps the date without stacking the dim
  function carry(iso, stale) {
    var c = HC.carried(iso, dayIso(), { weekday: false, stale: stale });
    c.html = c.carried ? '<span class="carried-date">' + esc(c.label) + '</span>' : '';
    return c;
  }
  function sleepDial(d, dt) {
    var target = d.target != null ? HC.hours(d.target) : '';
    if (d.state !== 'ok') return dialFig('dial-sleep dial-off', false, '', '', dialSvg({}), offCentre(dt.none), dt.sleep.label);
    var h = HC.hours(d.hours);
    // sleep performance % (DIALS pct: asleep / need = the target, capped at 100); hours without it
    // a past day names its night by date instead of "last night"
    var P = VIEW && dt.past ? dt.past : null;
    var date = P ? HC.fmtDate(d.date) : '';
    var stale = dialStale(d.date), c = carry(d.date, stale);
    // a carried night: the past-day arias, which name the night's date instead of "last night"
    if (c.carried && dt.past) { P = dt.past; date = HC.fmtDate(d.date); }
    if (typeof d.pct === 'number' && dt.sleep.ariaPct) {
      return dialFig('dial-sleep' + c.cls, stale, '', format(P ? P.sleepAriaPct : dt.sleep.ariaPct, { pct: d.pct, value: h, target: target, date: date }),
        dialSvg({ fill: d.fill }), numCentre(String(d.pct), '%') + c.html, dt.sleep.label);
    }
    return dialFig('dial-sleep' + c.cls, stale, '', format(P ? P.sleepAria : dt.sleep.aria, { value: h, target: target, date: date }),
      dialSvg({ fill: d.fill }), numCentre(h, '') + c.html, dt.sleep.label);
  }
  // "Last night" only when the night's data is dated today AND has a sleep reading; else its date
  function nightLbl(iso, hasSleep, rt) {
    return daysOld(iso) === 0 && hasSleep ? rt.lastNight : format(T.asOfLbl, { date: HC.fmtDate(iso) });
  }
  // one modality's state for the viewer's today: 'trained' (RE > 0), 'noEffort' (rows, no RE), 'rest'
  function loadToday(m) {
    var t = dayIso();
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
      return dialFig('dial-rec dial-off', dialStale(d.asOf), '', '', dialSvg({}), offCentre(word), rt.label);
    }
    var today = d.mode === 'today';
    var when = today ? nightLbl(d.date, d.sleep !== false, rt) : '';
    // a night carried from an earlier day (today's is not complete yet: lib/score/recovery.mjs falls
    // back up to 2 days) names that day and is dimmed (carry), so it never reads as today's
    var stale = dialStale(d.asOf), c = carry(today ? d.date : null, stale), asof = c.html;
    // the % headline (its rank within the previous 90 days), else the SD composite (fallback)
    if (today && typeof d.pct === 'number') {
      return dialFig('dial-rec dial-band-' + esc(d.band) + c.cls, stale, '', format(rt.ariaPct, { when: when, value: d.pct, band: T.recovery.pctBands[d.band] }),
        dialSvg({ fill: d.fill }), numCentre(String(d.pct), '%') + asof, rt.label);
    }
    var v = num(d.value, 1, true);
    var aria = today
      ? format(rt.aria, { when: when, value: v, band: rt.bands[d.band] })
      : format(rt.ariaTrend, { value: v, band: rt.bands[d.band] });
    return dialFig('dial-rec dial-band-' + esc(d.band) + c.cls, stale, '', aria,
      dialSvg({ fill: d.fill, mid: d.mid }), numCentre(v, T.recovery.unit) + asof, rt.label);
  }
  // The modality the load dial opens on, for the VIEWER's today (never baked): the modality with a
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
  // the day strain dial: the viewer's day (or the stepped-to day) from DIALS.strain.days; a day the
  // data does not reach yet reads "No data" (never a made-up 0.0)
  function strainDialHtml(d, dt) {
    var t = dayIso(), day = null, st = dt.strain || {};
    (d.days || []).forEach(function (x) { if (x.date === t) day = x; });
    if (!day) return dialFig('dial-load dial-strain dial-off', dialStale(d.asOf), '', format(st.ariaNone || '', { date: HC.fmtDate(t) }), dialSvg({}), offCentre(dt.none), dt.load.label, 'strain');
    var v = num(day.s, 1, false);
    return dialFig('dial-load dial-strain', dialStale(d.asOf), '', format(VIEW ? st.ariaPast : st.aria, { value: v, date: HC.fmtDate(t) }),
      dialSvg({ fill: day.fill }), numCentre(v, ''), dt.load.label, 'strain');
  }
  function loadDials(d, dt) {
    var lt = dt.load;
    var stale = dialStale(d.asOf);
    var open = openKey(d);
    // a past day: "No session" (not "yet") and the arias name the day
    var P = VIEW && dt.past ? dt.past : null;
    var on = P ? HC.fmtDate(VIEW) : '';
    var figs = d.modalities.map(function (m) {
      var hid = m.key === open ? '' : ' hidden';
      var extra = ' data-dmod="' + attr(m.key) + '"' + hid;
      var mod = T.load.modalities[m.key] || m.key;
      var dk = 'load-' + m.key;
      if (m.state !== 'ok') {
        return dialFig('dial-load dial-off', stale, extra, format(lt.ariaGated, { modality: mod }), dialSvg({ mid: d.mid }), offCentre(lt.gated), lt.label, dk);
      }
      var typ = num(m.typical, 0, false);
      var td = loadToday(m);
      if (td.kind === 'noEffort') {
        return dialFig('dial-load dial-noeffort', stale, extra, format(P ? P.ariaNoEffort : lt.ariaNoEffort, { modality: mod, typical: typ, date: on }),
          dialSvg({ mid: d.mid }), offCentre(lt.noEffort), lt.label, dk);
      }
      if (td.kind === 'rest') {
        return dialFig('dial-load dial-rest', stale, extra, format(P ? P.ariaRest : lt.ariaRest, { modality: mod, typical: typ, date: on }),
          dialSvg({ mid: d.mid }), offCentre(P ? P.rest : lt.rest), lt.label, dk);
      }
      var day = num(td.day.re, 0, false);
      return dialFig('dial-load', stale, extra, format(P ? P.aria : lt.aria, { modality: mod, day: day, typical: typ, date: on }),
        dialSvg({ fill: td.day.fill, mid: d.mid }), numCentre(day, lt.unit), lt.label, dk);
    });
    return figs.join('');
  }
  // the ONE marker that stays under the dials: the newest data is too old (HC.staleMark)
  function staleLine() {
    if (VIEW) return '';
    var ages = [D.sleep && D.sleep.state === 'ok' ? D.sleep.date : null, D.recovery ? D.recovery.asOf : null, D.strain ? D.strain.asOf : D.load ? D.load.asOf : null]
      .map(function (iso) { return isStale(iso) ? daysOld(iso) : null; })
      .filter(function (n) { return n != null; });
    if (!ages.length) return '';
    var days = { days: Math.min.apply(null, ages) };
    return HC.staleMark('dial-stale', format(T.staleShort, days), format(T.staleNote, days));
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
    MINI = [];
    var hasStrain = !!(D.strain && D.strain.state === 'ok');
    var hasLoad = !hasStrain && D.load && D.load.state === 'ok';
    var day = VIEW ? pastDials() : { sleep: D.sleep, recovery: D.recovery };
    // in dial order: each dialFig call also queues its collapsed-row ring (MINI)
    var first = sleepDial(day.sleep || {}, dt) + recDial(day.recovery || {}, dt);
    var third = hasStrain ? strainDialHtml(D.strain, dt)
      : hasLoad ? loadDials(D.load, dt) : dialFig('dial-load dial-off', false, '', '', dialSvg({}), offCentre(dt.none), dt.load.label);
    return '<div class="sc-card sc-dials" role="group" aria-label="' + attr(dt.ariaLabel) + '"><div class="dials">' + first + third +
      '</div>' + staleLine() + caveatLines(dt, hasLoad) + '</div>';
  }

  // #home-mini (fixed under the top edge) turns on while the dials are scrolled ABOVE the viewport;
  // CSS fades / slides it (no motion under prefers-reduced-motion) and `visibility` keeps it out of
  // the tab order and the accessibility tree while off. No IntersectionObserver: the row stays off.
  function watchMini(dialsHost) {
    var mini = document.getElementById('home-mini');
    if (!mini || !dialsHost || typeof IntersectionObserver !== 'function') return;
    try {
      new IntersectionObserver(function (entries) {
        var e = entries[entries.length - 1];
        mini.classList.toggle('is-on', !e.isIntersecting && e.boundingClientRect.top < 0 && mini.innerHTML !== '');
      }).observe(dialsHost);
    } catch (e) { /* the row simply stays off */ }
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
  var OUTLOOK_ICO = '<svg class="outlook-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/>' +
    '<path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>';
  // the advice sentence for the viewer's today, '' when there is none (a past day, stale data, no rule).
  // Also window.HCAdvice: the recovery deep-dive (client/deepdive.js) leads its insight card with it,
  // the full text behind the one-line outlook bar.
  function currentAdvice() {
    if (VIEW) return '';
    var anyStale = (S.recovery && isStale(S.recovery.asOf)) || (S.load && isStale(S.load.asOf));
    if (!S.advice || anyStale || !T.advice[S.advice.key]) return '';
    return adviceText(S.advice);
  }
  if (typeof window !== 'undefined') window.HCAdvice = function () { try { return S && S.hasData ? currentAdvice() : ''; } catch (e) { return ''; } };
  function adviceHtml() {
    var txt = currentAdvice();
    if (!txt) return '';
    // "My day" outlook bar: icon, ONE line, a chevron; every rule reads the recovery trend, so a tap
    // opens the recovery sheet, whose insight card leads with the sentence. With a sheet the bar shows
    // the short title (the sentence is its accessible name); without one, the sentence itself.
    var link = HC.detailAttrs('recovery');
    var title = link && T.home && T.home.outlook;
    return '<div class="sc-advice outlook"' + link + (title ? ' aria-label="' + attr(title + ': ' + txt) + '"' : '') + '>' + OUTLOOK_ICO +
      '<span class="outlook-txt">' + esc(title || txt) + '</span><span class="chev outlook-chev" aria-hidden="true">›</span></div>';
  }

  // the blocks that follow the selected day (HCDay): the dials, the collapsed row, the advice
  function renderDay(dialsHost) {
    VIEW = DAY && typeof DAY.sel === 'function' ? DAY.sel() || null : null;
    if (dialsHost) write(dialsHost, function () { return safe(dialsHtml); });
    // the collapsed row mirrors the dials just written (empty when they threw or there are none)
    if (dialsHost) write('home-mini', function () { return dialsHost.innerHTML.indexOf('sc-dials') !== -1 ? miniHtml() : ''; });
    // the advice sentence reads as the conclusion of the dials above it
    write(host, function () { return (dialsHost ? '' : safe(dialsHtml)) + safe(adviceHtml, null, ''); });
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
      write('home-mini', function () { return ''; });
      return;
    }
    // Home.astro gives the dials their own host above the health monitor; without it they lead #home-advice
    var dialsHost = document.getElementById('home-dials');
    renderDay(dialsHost);
    watchMini(dialsHost);
    // a day change (the top bar's ‹ ›) re-renders only the day's blocks: dials, collapsed row, advice
    if (DAY && typeof DAY.on === 'function') DAY.on(function () { renderDay(dialsHost); });
    if (S.recovery) write('score-recovery', function () { return safe(recoveryHtml, S.recovery); });
    write('score-load', function () { return S.load ? safe(loadHtml, S.load) : emptyHtml(); });
  }
  render();
})();
