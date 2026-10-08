/* "Salud / Health" tab sections (recovery, fitness, sleep, body composition, activity/NEAT, energy:
 * metric rows via HC.metricRow, notes behind an ⓘ toggle per section) plus Entreno's
 * running / cycling list rows and load vs recovery (#health-train, see render()), ported from the legacy
 * `<script>` IIFE ("health") of the pre-Astro generated page (deleted at
 * the astro-plan-web cutover), adapted to read HEALTH/LOCALE from globals
 * baked by web/src/components/Bake.astro and I18N_HEALTH
 * (web/src/i18n/health-templates.mjs) instead of hardcoded English
 * strings — same pattern as client/training-today.js and
 * client/training-dash.js.
 *
 * `esc()` / `nf()` / `format()` / `daysOld()` are the shared helpers of
 * client/util.js (window.HC). `esc()` calls sit at EXACTLY the same spots as
 * the legacy source (fmtD()/source strings/titles) — static I18N_HEALTH copy
 * is trusted the same way legacy's hardcoded literals were, so it is NOT
 * re-escaped (see design's Trusted markup row: dict content is
 * generic/tracked, never user input).
 *
 * `nf()` (decimal-comma display) is the one LOCALE-sensitive number format
 * here, same rationale as training-dash.js's `hc()`: the tracked English
 * template never localizes the decimal separator, but the owner's live
 * Spanish page does (`75.6` -> `75,6`). Applied at every call site where the
 * legacy Spanish page applies it (real-valued fields); integer-only fields
 * (Math.round results with no decimals — e.g. resting HR, HRV, the
 * load-vs-recovery HRV split cards) are left unwrapped, matching the
 * legacy page exactly.
 *
 * `ago()` depends on `Date.now()` (real wall-clock time, not a baked
 * value) — unlike training-today.js this is NOT about "what day is it"
 * (HEALTH is a fully precomputed snapshot baked at build time), it is
 * purely a relative-time label for the "last logged" caveat in the energy
 * section. Both the legacy/golden script and this one compute it against
 * the SAME real `Date.now()` when executed together, so it stays
 * deterministic for parity tests (see web/test/parity.test.mjs).
 */
(function () {
  var T = I18N_HEALTH;
  // shared helpers (web/src/client/util.js)
  var esc = HC.esc, nf = HC.nf, format = HC.format, daysOld = HC.daysOld;
  // the ONE display-date formatter (util.js), without the weekday: "22 Jun" / "22 jun"
  function fmtD(iso) {
    return HC.fmtDate(iso, { weekday: false });
  }
  function ago(iso) {
    if (!iso) return '';
    var d = Math.round((Date.now() - new Date(iso + 'T00:00:00')) / HC.MS_PER_DAY);
    if (d < 45) return format(T.agoDaysTpl, { d: d });
    var m = Math.round(d / 30);
    if (m < 12) return format(m > 1 ? T.agoMonthsTpl : T.agoMonthTpl, { m: m });
    return format(T.agoYearsTpl, { y: nf(Math.round((m / 12) * 10) / 10) });
  }
  function fin(x) {
    return typeof x === 'number' && isFinite(x);
  }
  // decimals of a baked value (1 at most): the baseline is shown at the value's own precision
  function decOf(v) {
    return Math.round(v) === v ? 0 : 1;
  }
  function round(v, dec) {
    var f = Math.pow(10, dec);
    return Math.round(v * f) / f;
  }
  var FLAT_SHARE = 0.02; // within ±2 % of the baseline = a grey dot (as Inicio's My dashboard)
  // One Salud metric row (the shared HC.metricRow: icon · NAME · value + unit · ▲▼• · a small line).
  // Today first: the value is the NEWEST one; the small line is its 30-day baseline (`o.base`, with
  // the arrow vs it) or, for a sparse measurement, its change (`o.delta`, arrow by its sign); `o.dir`
  // = the good direction (1 up, -1 down, 0 none -> grey). A daily total dated the viewer's today
  // (`o.soFar`) is partial: "today, so far", no arrow. A row whose date is more than STALE_DAYS old
  // is greyed with "no recent data" and no arrow (decided at view time; `o.noStale` for a sparse
  // manual measurement dated in its own line). `o.id` = an hl-<key> anchor, `o.detail` = the detail
  // sheet a tap opens. The date and the baseline are spelled out in the row's aria-label.
  function mrow(key, title, unit, o) {
    if (!fin(o.value)) throw new Error('no value');
    var age = o.date ? daysOld(o.date) : null;
    var stale = !o.noStale && age != null && age > HC.STALE_DAYS;
    var partial = !!o.soFar && age === 0;
    var value = o.text || nf(o.value), u = unit ? ' ' + unit : '';
    var base = '', arrow = null, aria = [title + ': ' + value + u + (o.date ? ', ' + (partial ? T.soFar : fmtD(o.date)) : '')];
    if (fin(o.base)) {
      base = nf(round(o.base, decOf(o.value)));
      aria.push(format(o.baseTpl || T.avg30Tpl, { value: base + u }));
      if (!partial) {
        var rel = o.base ? (o.value - o.base) / Math.abs(o.base) : o.value - o.base;
        arrow = Math.abs(rel) < FLAT_SHARE ? 'flat' : rel > 0 ? 'up' : 'down';
      }
    } else if (fin(o.delta)) {
      base = 'Δ ' + (o.delta > 0 ? '+' : '') + nf(round(o.delta, 1)) + (o.deltaUnit || '');
      aria.push(format(T.deltaAriaTpl, { value: base.slice(2) }));
      arrow = o.delta === 0 ? 'flat' : o.delta > 0 ? 'up' : 'down';
    } else if (o.sub) {
      base = o.sub;
      aria.push(o.sub);
    }
    if (o.when) base = [o.when, base].filter(Boolean).join(' · ');
    if (partial) base = [base, T.soFar].filter(Boolean).join(' · ');
    if (stale) {
      base = T.staleNote;
      arrow = null;
      aria.push(T.staleNote);
    }
    var tone = arrow && arrow !== 'flat' && o.dir ? ((arrow === 'up') === (o.dir > 0) ? 'good' : 'bad') : 'flat';
    if (arrow && T.dirs) aria.push(T.dirs[arrow]);
    return HC.metricRow({ key: o.icon || key, cls: stale ? 'db-stale' : '', attrs: (o.id ? ' id="hl-' + o.id + '"' : '') + (o.detail ? HC.detailAttrs(o.detail) : ''),
      aria: aria.join(' · '), name: title, value: value, unit: unit, arrow: arrow, tone: tone, base: base });
  }
  function note(html) {
    return '<div class="dash-note">' + html + '</div>';
  }

  // Entreno run / ride rows (HC.metricRow): icon · the date (UPPERCASE) with the session's other
  // numbers as a small line under it · the distance big on the right with time and pace / climb under
  // it. A dash never stands in for a missing value: a field the source did not record is left out of
  // the small lines (the ⓘ says which source records what). The row opens that day in its load view
  // (client/detail.js); without the detail sheet it is a plain row (no fake link).
  function parts(list) {
    return list.filter(function (x) { return x != null && x !== ''; }).join(' · ');
  }
  function sessionRow(key, icon, r, base, note) {
    var name = HC.fmtDate(r.date);
    var value = r.dist != null ? nf(r.dist) : '—';
    return HC.metricRow({ key: icon, attrs: HC.detailAttrs(key, r.date), name: name, note: note, value: value, unit: r.dist != null ? 'km' : '', base: base,
      aria: parts([name, r.dist != null ? nf(r.dist) + ' km' : '', base, note]) });
  }
  function runRow(r) {
    var RT = T.runningTable, u = T.trend.rhr.unit;
    var base = parts([r.time, r.pace ? r.pace + '/km' : null]);
    var note = parts([r.hrAvg != null ? r.hrAvg + ' ' + u : null, r.re != null ? RT.reH + ' ' + r.re : null, r.elev != null ? '↑' + nf(r.elev) + ' m' : null,
      r.power != null ? nf(r.power) + ' W' : null, r.gct != null ? RT.gctH + ' ' + nf(r.gct) + ' ms' : null,
      r.vosc != null ? RT.oscH + ' ' + nf(r.vosc) + ' cm' : null, r.stride != null ? RT.strideH + ' ' + nf(r.stride) + ' m' : null]);
    return sessionRow('load-run', 'run', r, base, note);
  }
  function rideRow(r) {
    var CT = T.cyclingTable, u = T.trend.rhr.unit;
    var base = parts([r.time, r.elev != null ? '↑' + nf(r.elev) + ' m' : null]);
    var note = parts([r.hrAvg != null ? r.hrAvg + ' ' + u : null, r.re != null ? CT.reH + ' ' + r.re : null, r.kj != null ? nf(r.kj) + ' kJ' : null]);
    return sessionRow('load-bike', 'bike', r, base, note);
  }

  // A Salud section: UPPERCASE label (the hl-<key> anchor is the section itself), an ⓘ toggle
  // holding its notes (collapsed, nothing lost), an optional block before the rows (the recovery
  // card host), then the rows.
  function section(key, rows, notes, before) {
    var info = (notes || []).filter(Boolean), id = 'hs-info-' + key, name = T.sections[key];
    if (!rows.length && !before) return '';
    return '<section class="hs-sec hs-sec-' + key + '" id="hl-' + key + '" aria-labelledby="hs-h-' + key + '"><div class="hs-head"><h3 class="hs-lbl" id="hs-h-' + key + '">' + name + '</h3>' +
      (info.length ? HC.infoBtn(id, format(T.infoTpl, { section: name })) : '') + '</div>' +
      (info.length ? '<div class="hs-info" id="' + id + '" hidden>' + info.map(function (n) { return '<p>' + n + '</p>'; }).join('') + '</div>' : '') +
      (before || '') + (rows.length ? '<ul class="db-list">' + rows.join('') + '</ul>' : '') + '</section>';
  }

  // One renderer, three hosts (four-tab layout, one question per tab):
  //   #health-body (Salud: "how is my body")  recovery (+ #score-recovery, filled by score.js), sleep,
  //                                      body composition, activity, energy (expenditure only)
  //   #health-train (Entreno)            running, cycling, load vs recovery
  //   #nutri-balance (Nutrición)         Balance: intake vs expenditure + the macro split
  // A missing host skips its part; each part has its own empty state (Balance: none, host hidden).
  // Each part renders inside its own try/catch: a throw in one never blanks another, and the
  // broken part falls back to its own empty state.
  function render() {
    var host = document.getElementById('health-body');
    if (host) {
      try {
        renderSalud(host);
      } catch (e) {
        host.innerHTML = '<div class="train-empty">' + T.emptyMsg + '</div>';
      }
    }
    var train = document.getElementById('health-train');
    if (train) {
      try {
        renderEntreno(train);
      } catch (e) {
        train.innerHTML = '<div class="train-empty">' + T.trainEmptyMsg + '</div>';
      }
    }
    var bal = document.getElementById('nutri-balance');
    if (bal) {
      try {
        bal.innerHTML = renderBalance();
      } catch (e) {
        bal.innerHTML = '';
      }
      bal.hidden = !bal.innerHTML;
    }
  }
  // one broken trend card must never blank the tab: it is skipped, the rest still render
  function adder(out) {
    return function (fn) {
      try {
        out.push(fn());
      } catch (e) {
        /* skip this card */
      }
    };
  }

  // Salud, top to bottom (under the health monitor list, client/monitor.js): Recovery (+ the recovery
  // card host #score-recovery, filled by score.js), Fitness, Sleep, Body composition, Activity, Energy.
  function renderSalud(host) {
    var B = HEALTH.body || {}, A = HEALTH.activity || {}, E = HEALTH.energy || {}, R = HEALTH.recovery || {};
    var SC = typeof SCORES === 'undefined' || !SCORES ? null : SCORES;
    var recScore = !!(SC && SC.recovery);
    if (!B.hasData && !A.hasData && !E.hasData && !R.hasData && !recScore) {
      host.innerHTML = '<div class="train-empty">' + T.emptyMsg + '</div>';
      return;
    }
    var TR = T.trend, out = [];
    function rows(list) {
      var r = [];
      list.forEach(function (fn) {
        try {
          var h = fn();
          if (h) r.push(h);
        } catch (e) {
          /* one broken row is skipped, never the tab */
        }
      });
      return r;
    }
    function sig(k, dir, id) {
      return function () {
        var m = R[k];
        return m ? mrow(k, TR[k].title, TR[k].unit, { value: m.latest, base: m.avg30, dir: dir, date: m.latestDate, id: id ? k : null, detail: k }) : '';
      };
    }
    /* recovery: the recovery dial's detail card lands in #score-recovery, right under the label */
    if (R.hasData || recScore) {
      out.push(section('recovery', R.hasData ? rows([sig('rhr', -1, true), sig('hrv', 1, true), sig('respiratory', 0, true), sig('wristTemp', 0, true)]) : [],
        R.hasData ? [T.recoveryNoteHtml] : [], '<div id="score-recovery"></div>'));
    }
    if (R.hasData) {
      /* fitness: VO2max (change since the first reading) and walking HR */
      out.push(section('fitness', rows([
        function () { var m = R.vo2max; return m ? mrow('vo2max', TR.vo2max.title, TR.vo2max.unit, { value: m.latest, delta: fin(m.first) ? round(m.latest - m.first, 1) : null, dir: 1, date: m.latestDate, detail: 'vo2max' }) : ''; },
        sig('walkingHr', -1, false),
      ]), [T.fitnessNoteHtml]));
      /* sleep: last night vs the 30-night mean, then the consistency rows; the section is hl-sleep */
      var sl = R.sleep, SCd = T.sleepCards;
      if (sl) {
        out.push(section('sleep', rows([
          function () { return mrow('sleep', TR.sleep.title, TR.sleep.unit, { value: sl.latest, base: sl.avg, baseTpl: T.avgNightsTpl, dir: 1, date: sl.latestDate, detail: 'sleep' }); },
          function () { return fin(sl.pctTarget) ? mrow('sleep', format(SCd.nightsTargetLbl, { target: nf(sl.target) }), '%', { value: sl.pctTarget, detail: 'sleep' }) : ''; },
          function () { return fin(sl.sd) ? mrow('sleep', SCd.sdLbl, 'h', { value: sl.sd, text: '±' + nf(sl.sd), detail: 'sleep' }) : ''; },
          function () { return sl.bedtime ? mrow('sleep', SCd.bedtimeLbl, '', { value: 0, text: sl.bedtime, sub: '±' + sl.bedtimeSd + '′', detail: 'sleep' }) : ''; },
          function () { return sl.wake ? mrow('sleep', SCd.wakeLbl, '', { value: 0, text: sl.wake, sub: '±' + sl.wakeSd + '′', detail: 'sleep' }) : ''; },
        ]), [T.sleepNoteHtml]));
      }
    }
    /* body composition: weight Δ vs ~30 days ago, body fat / lean mass Δ in their scale window, waist */
    if (B.hasData) {
      var TB = T.trend;
      var bcPts = function (k) { var m = B[k]; return m && m.windowPoints != null && m.windowDays != null ? '<b>' + TB[k].title + '</b>: ' + esc(format(T.bodyCompPointsTpl, { n: m.windowPoints, days: m.windowDays })) : ''; };
      var wsrc = B.weight ? B.weight.source : '', bsrc = B.bodyfat ? B.bodyfat.source : '';
      var sourcesClause = B.weight ? format(T.bodyNote.sourcesClause, { n: B.weight.sources }) : '';
      var wsrcClause = wsrc ? format(T.bodyNote.sourceClause, { src: esc(wsrc) }) : '';
      var bsrcClause = bsrc ? format(T.bodyNote.sourceClause, { src: esc(bsrc) }) : '';
      var bodyNotes = [format(T.bodyNote.main, { sourcesClause: sourcesClause, sourceClause: wsrcClause, bfSourceClause: bsrcClause }), bcPts('bodyfat'), bcPts('lean'),
        B.waist ? format(T.waist.noteTpl, { n: B.waist.points, first: esc(fmtD(B.waist.firstDate)) }) : T.waist.emptyHtml];
      var bc = function (k, dir) {
        return function () { var m = B[k]; return m ? mrow(k, TB[k].title, TB[k].unit, { value: m.latest, delta: k === 'weight' ? m.d30 : m.delta, deltaUnit: TB[k].deltaUnit, dir: dir, date: m.latestDate, detail: k }) : ''; };
      };
      out.push(section('body', rows([bc('weight', 0), bc('bodyfat', -1), bc('lean', 1),
        function () { var w = B.waist; return w ? mrow('waist', T.waist.title, T.waist.unit, { value: w.latest, delta: w.delta, deltaUnit: T.waist.deltaUnit, dir: -1, date: w.latestDate, when: fmtD(w.latestDate), noStale: true, detail: 'waist' }) : ''; },
      ]), bodyNotes));
    }
    /* activity / NEAT: the latest day vs its 30-day average (today = so far, no arrow) */
    if (A.hasData) {
      out.push(section('activity', rows(['steps', 'exercise', 'distance', 'flights'].map(function (k) {
        return function () { var a = A[k], tt = T.trend[k]; return a ? mrow(k, tt.title, tt.unit, { value: a.latest, base: a.avg30, dir: 1, date: a.latestDate, soFar: true, detail: k }) : ''; };
      })), [T.activityNoteHtml]));
    }
    /* energy: expenditure (TDEE) only; the intake balance + macro split are Nutrición's Balance
       (renderBalance); every caveat sits behind ⓘ */
    if (E.hasData) {
      var en = [];
      // a power-meter ride day (lib/health/ride-energy.mjs): the headline day's active energy was corrected
      if (T.energyRide && E.latestCorrected) en.push(esc(T.energyRide.latest));
      else if (T.energyRide && E.latestUncovered) en.push(esc(T.energyRide.uncovered));
      if (E.correctedDays > 0 && T.energyRide) en.push(format(T.energyRide.days, { n: E.correctedDays }));
      if (E.uncoveredDays > 0 && T.energyRide) en.push(format(T.energyRide.uncoveredDays, { n: E.uncoveredDays }));
      en.push(format(T.energyTdeeNote, { tdeeDays: E.tdeeDays }));
      out.push(section('energy', rows([function () {
        return E.tdeeLatest != null ? mrow('energy', T.trend.expenditure.title, T.trend.expenditure.unit, { value: E.tdeeLatest, base: E.tdeeAvg, dir: 0, date: E.tdeeLatestDate, soFar: true, detail: 'energy' }) : '';
      }]), en));
    }
    host.innerHTML = out.join('');
  }

  // Nutrición → Balance (HEALTH.energy, lib/health/aggregate.mjs aggEnergy): the intake average vs the
  // expenditure average over ONE fixed window (the paired days of the last BALANCE_WINDOW, anchored to
  // the newest expenditure day; the bake has no other period, so no W / M / 6M), labelled by its dates,
  // as metric rows (avg intake, avg burn -> the expenditure sheet, deficit / surplus a day), then the
  // average macro split as one stacked bar (Entreno's modality bar) with a counted legend. The window
  // and "historical" caveat sit behind ⓘ. Too few logged days -> a short empty line, the why behind ⓘ.
  // No expenditure at all -> '' (the host hides).
  var MACROS = [['p', 'p', 'proteinLbl'], ['c', 'c', 'carbsLbl'], ['f', 'g', 'fatLbl']];
  function renderBalance() {
    var E = HEALTH.energy || {}, TB = T.balance;
    if (!E.hasData || !TB) return '';
    var b = E.balance, m = b ? E.macros : null, notes = [], body;
    if (b) {
      notes.push(format(T.energyBalanceNote.main, { from: esc(fmtD(b.from)), to: esc(fmtD(b.to)), days: b.days, macroClause: m ? T.energyBalanceNote.macroClause : '' }));
      var u = T.trend.expenditure.unit;
      var net = (b.net < 0 ? '' : '+') + nf(b.net), netLbl = b.net < 0 ? TB.deficitLbl : TB.surplusLbl;
      body = '<p class="nb-win">' + esc(format(TB.winTpl, { from: fmtD(b.from), to: fmtD(b.to), days: b.days })) + '</p><ul class="db-list">' +
        HC.metricRow({ key: 'food', name: TB.intakeLbl, value: nf(b.intakeAvg), unit: u, aria: TB.intakeLbl + ': ' + nf(b.intakeAvg) + ' ' + u }) +
        HC.metricRow({ key: 'energy', attrs: HC.detailAttrs('energy'), name: TB.burnLbl, value: nf(b.tdeeAvg), unit: u, aria: TB.burnLbl + ': ' + nf(b.tdeeAvg) + ' ' + u }) +
        HC.metricRow({ key: 'balance', name: netLbl, value: net, unit: u, aria: netLbl + ': ' + net + ' ' + u }) + '</ul>' +
        (m ? splitHtml(m) : '');
    } else {
      var clause = E.lastIntake ? format(T.balanceNoIntakeNote.lastIntakeClause, { date: esc(fmtD(E.lastIntake)), ago: ago(E.lastIntake) }) : '';
      notes.push(format(T.balanceNoIntakeNote.main, { lastIntakeClause: clause }));
      body = '<p class="nb-empty">' + esc(TB.empty) + '</p>';
    }
    return '<section class="hs-sec nb" aria-labelledby="nb-h"><div class="hs-head"><h2 class="hs-lbl" id="nb-h">' + esc(TB.heading) + '</h2>' +
      HC.infoBtn('nb-info', format(T.infoTpl, { section: TB.heading })) + '</div>' +
      '<div class="hs-info" id="nb-info" hidden>' + notes.map(function (n) { return '<p>' + n + '</p>'; }).join('') + '</div>' + body + '</section>';
  }
  // the average macro split: segment widths = each macro's share of the three (normalised, so the
  // rounded percentages never leave a gap); colour is never alone, the legend names each macro
  function splitHtml(m) {
    var TB = T.balance, pcts = { p: m.pPct, c: m.cPct, f: m.gPct };
    var sum = pcts.p + pcts.c + pcts.f;
    if (!(sum > 0)) return '';
    var x = 0, segs = [], items = [], aria = [];
    MACROS.forEach(function (k) {
      var w = 100 * pcts[k[0]] / sum, name = TB[k[2]], g = m[k[1]];
      segs.push('<rect class="nb-m-' + k[0] + '" x="' + x.toFixed(2) + '" y="0" width="' + w.toFixed(2) + '" height="8"/>');
      x += w;
      items.push('<li><span class="act-sw nb-m-' + k[0] + '" aria-hidden="true"></span><b>' + esc(nf(g)) + ' g</b> ' + esc(name) + ' <small>' + pcts[k[0]] + '%</small></li>');
      aria.push(format(TB.splitItem, { name: name, g: nf(g), pct: pcts[k[0]] }));
    });
    return '<div class="nutri-card nb-split"><span class="dt-trend-lbl">' + esc(TB.splitLbl) + '</span>' +
      '<svg class="act-bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="' + esc(TB.splitLbl + ': ' + aria.join(', ')) + '">' + segs.join('') + '</svg>' +
      '<ul class="act-legend">' + items.join('') + '</ul></div>';
  }

  // Entreno: Running and Cycling as list rows, then Load vs recovery — each a section with its notes
  // behind ⓘ (the shared section()); the weekly load bars (strain blue) and HRV / resting HR in the
  // higher-load vs the easy weeks as two metric rows (▲▼ = the higher-load weeks vs the easy ones,
  // coloured by the signal's good direction: ↑ HRV, ↓ resting HR).
  function renderEntreno(train) {
    var Run = HEALTH.running || {}, LR = HEALTH.loadRecovery || {}, Cyc = HEALTH.cycling || {};
    if (!Run.hasData && !Cyc.hasData && !LR.hasData) {
      train.innerHTML = '<div class="train-empty">' + T.trainEmptyMsg + '</div>';
      return;
    }
    var out = [];
    /* running + cycling: a pair with the same row style and budget, so run and bike carry equal
       weight; when only one has data the other states its empty case */
    if (Run.hasData || Cyc.hasData) {
      out.push(Run.hasData && Run.sessions.length ? section('running', Run.sessions.map(runRow), [format(T.runningNote, { count: Run.count })])
        : section('running', [], [], note(T.runningEmptyHtml)));
      out.push(Cyc.hasData && Cyc.sessions.length ? section('cycling', Cyc.sessions.map(rideRow), [format(T.cyclingNote, { count: Cyc.count })])
        : section('cycling', [], [], note(T.cyclingEmptyHtml)));
    }
    /* load vs recovery (cross-tab) */
    if (LR.hasData) {
      var s = LR.series, lmax = Math.max.apply(null, s.map(function (x) { return x.load; })) || 1;
      var lbars = s
        .map(function (x) {
          var h = Math.round((100 * x.load) / lmax);
          return '<div class="wbar' + (x.load ? '' : ' zero') + '" title="' + esc(format(T.loadSec.barTitleTpl, { date: fmtD(x.w), load: x.load })) + '"><i style="height:' + h + '%"></i></div>';
        })
        .join('');
      var lax = '<div class="waxis"><span>' + esc(fmtD(s[0].w)) + '</span><span>' + esc(fmtD(s[s.length - 1].w)) + '</span></div>';
      var bars = '<div class="lvr-card"><span class="dt-trend-lbl">' + esc(T.loadSec.heading) + '</span><div class="wbars">' + lbars + '</div>' + lax + '</div>';
      var rows = [];
      var sp = LR.split || {};
      var C = T.loadCards;
      if (sp.hrvHigh != null && sp.hrvLow != null) rows.push(splitRow('hrv', C.hrvHighLbl, C.hrvLowLbl, sp.hrvHigh, sp.hrvLow, 'ms', 1));
      if (sp.rhrHigh != null && sp.rhrLow != null) rows.push(splitRow('rhr', C.rhrHighLbl, C.rhrLowLbl, sp.rhrHigh, sp.rhrLow, T.trend.rhr.unit, -1));
      out.push(section('load', rows, [format(T.loadSec.hint, { weeks: LR.weeks }), T.loadNoteHtml], bars));
    }
    train.innerHTML = out.join('');
  }
  // one higher-load vs easy weeks row: the higher-load value, the easy one as the small line
  function splitRow(icon, name, easyName, high, low, unit, dir) {
    var arrow = high === low ? 'flat' : high > low ? 'up' : 'down';
    var tone = arrow === 'flat' ? 'flat' : (arrow === 'up') === (dir > 0) ? 'good' : 'bad';
    var easy = format(T.loadCards.easyTpl, { value: nf(low) + ' ' + unit });
    return HC.metricRow({ key: icon, name: name, value: nf(high), unit: unit, arrow: arrow, tone: tone, base: easy,
      aria: name + ': ' + nf(high) + ' ' + unit + ' · ' + easyName + ': ' + nf(low) + ' ' + unit + (T.dirs ? ' · ' + T.dirs[arrow] : '') });
  }

  render();

  // the Salud title's ⓘ (tabs/Salud.astro leaves a slot): the one shared button markup, HC.infoBtn
  var introSlot = document.getElementById('hs-intro-i');
  if (introSlot) introSlot.innerHTML = HC.infoBtn('hs-intro', introSlot.getAttribute('data-label') || '');

  // ⓘ toggles of Salud (the monitor list, client/monitor.js, and each section): a button
  // [data-hs-info="<id>"] shows / hides the block #<id> in place and mirrors it in aria-expanded.
  // One delegated listener for the page; the block stays in the DOM (hidden), so its text is never lost.
  function toggleInfo(btn) {
    var id = btn.getAttribute('data-hs-info'), box = id && document.getElementById(id);
    if (!box) return;
    box.hidden = !box.hidden;
    btn.setAttribute('aria-expanded', box.hidden ? 'false' : 'true');
  }
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', function (e) {
      var t = e && e.target;
      var btn = t && typeof t.closest === 'function' ? t.closest('[data-hs-info]') : null;
      if (btn) toggleInfo(btn);
    });
  }
})();
