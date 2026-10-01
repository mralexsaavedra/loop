/* "Salud / Health" tab (recovery, sleep, body composition, activity/NEAT, energy) plus Entreno's
 * running / cycling / load-vs-recovery blocks (#health-train, see render()), ported from the legacy
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
  var DATE_LOCALE = LOCALE === 'es' ? 'es-ES' : 'en-GB';
  var T = I18N_HEALTH;
  // shared helpers (web/src/client/util.js)
  var esc = HC.esc, nf = HC.nf, format = HC.format, daysOld = HC.daysOld;
  function fmtD(iso) {
    var p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(DATE_LOCALE, { day: 'numeric', month: 'short' });
  }
  function ago(iso) {
    if (!iso) return '';
    var d = Math.round((Date.now() - new Date(iso + 'T00:00:00')) / HC.MS_PER_DAY);
    if (d < 45) return format(T.agoDaysTpl, { d: d });
    var m = Math.round(d / 30);
    if (m < 12) return format(m > 1 ? T.agoMonthsTpl : T.agoMonthTpl, { m: m });
    return format(T.agoYearsTpl, { y: nf(Math.round((m / 12) * 10) / 10) });
  }
  function sparkSvg(sp) {
    if (!sp || !sp.v || sp.v.length < 2) return '';
    var v = sp.v, n = v.length, mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), rng = mx - mn || 1, pad = 10;
    var pts = v.map(function (y, i) {
      var x = (100 * i) / (n - 1), yy = pad + (100 - 2 * pad) * (1 - (y - mn) / rng);
      return x.toFixed(2) + ',' + yy.toFixed(2);
    });
    return (
      '<svg class="spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="area" d="M0,100 L' + pts.join(' L') + ' L100,100 Z"/>' +
      '<path class="line" d="M' + pts.join(' L') + '"/></svg>'
    );
  }
  function delta(d, unit, goodDir) {
    // goodDir: -1 lower-better, 1 higher-better, 0 neutral
    if (d == null || !isFinite(d)) return '';
    var dir = d < 0 ? -1 : d > 0 ? 1 : 0, cls = goodDir === 0 || dir === 0 ? 'flat' : dir === goodDir ? 'good' : 'bad';
    return '<span class="dlt ' + cls + '">' + (d > 0 ? '▲ +' : d < 0 ? '▼ ' : '■ ') + nf(Math.round(d * 10) / 10) + (unit || '') + '</span>';
  }
  // Today first: the headline is the newest value; `opt.date` tags it with its date (a daily total
  // dated today reads "today, so far", since it is partial until midnight); `ctxHtml` (30-day mean
  // and/or Δ) is the context line under it; `opt.id` = an hl-<key> anchor for Inicio's monitor;
  // `opt.detail` = the detail-sheet metric a tap on the card opens (client/detail.js).
  function trend(title, valHtml, ctxHtml, sp, opt) {
    opt = opt || {};
    var ax = sp ? '<div class="spark-ax"><span>' + esc(fmtD(sp.from)) + '</span><span>' + esc(fmtD(sp.to)) + '</span></div>' : '';
    var when = opt.date ? (opt.soFar && daysOld(opt.date) === 0 ? T.soFar : fmtD(opt.date)) : '';
    return (
      '<div class="mtrend"' + (opt.id ? ' id="hl-' + opt.id + '"' : '') + (opt.detail ? HC.detailAttrs(opt.detail) : '') + '><div class="mtrend-top"><h4>' + esc(title) + '</h4>' +
      '<div class="mtrend-val">' + valHtml + (when ? '<span class="mtrend-date">' + esc(when) + '</span>' : '') + '</div></div>' +
      (ctxHtml ? '<div class="mtrend-ctx">' + ctxHtml + '</div>' : '') + sparkSvg(sp) + ax + '</div>'
    );
  }
  // context line: "30-day avg X" and the Δ badge, whichever exist
  function ctx(avgTpl, avg, unit, deltaHtml) {
    var a = avg != null && isFinite(avg) ? esc(format(avgTpl, { value: nf(avg) + (unit || '') })) : '';
    return [a, deltaHtml || ''].filter(Boolean).join(' · ');
  }
  function card(num, lbl) {
    return '<div class="dash-card"><div class="dash-num">' + esc(num) + '</div><div class="dash-lbl">' + esc(lbl) + '</div></div>';
  }
  function note(html) {
    return '<div class="dash-note">' + html + '</div>';
  }

  // A run / ride row opens that day in its load view (client/detail.js): the whole row is a mouse
  // target and the date cell holds a real button for keyboards. Plain '<tr><td>date' when the detail
  // sheet is not baked. Returns the row up to the opening of its second cell.
  function rowOpen(key, date) {
    var attrs = HC.detailAttrs(key, date, { plain: true });
    if (!attrs) return '<tr><td>' + esc(fmtD(date)) + '</td><td>';
    return '<tr' + attrs + '><td class="dt-cell"><button type="button" class="dt-row-btn"' + attrs + ' aria-haspopup="dialog">' + esc(fmtD(date)) + '</button></td><td>';
  }

  function runsTable(s) {
    var RT = T.runningTable;
    // same leading columns as the rides table (workouts.csv), then the watch running dynamics
    var head = '<tr><th>' + RT.dateH + '</th><th>' + RT.distH + '</th><th>' + RT.timeH + '</th><th>' + RT.paceH + '</th><th>' + RT.hrH + '</th><th>' + RT.reH + '</th><th>' + RT.elevH + '</th><th>' + RT.powerH + '</th><th>' + RT.gctH + '</th><th>' + RT.oscH + '</th><th>' + RT.strideH + '</th></tr>';
    var rows = s
      .map(function (r) {
        var d = function (v, u) { return v != null ? nf(v) + u : '—'; };
        return rowOpen('load-run', r.date) + d(r.dist, ' km') + '</td><td>' + esc(r.time) + '</td><td>' + (r.pace ? esc(r.pace) + '/km' : '—') + '</td><td>' + d(r.hrAvg, ' ' + T.trend.rhr.unit) + '</td><td>' + d(r.re, '') + '</td><td>' + d(r.elev, ' m') + '</td><td>' + d(r.power, ' W') + '</td><td>' + d(r.gct, ' ms') + '</td><td>' + d(r.vosc, ' cm') + '</td><td>' + d(r.stride, ' m') + '</td></tr>';
      })
      .join('');
    return '<div class="run-tbl-wrap"><table class="run-tbl">' + head + rows + '</table></div>';
  }

  function ridesTable(s) {
    var CT = T.cyclingTable;
    var head = '<tr><th>' + CT.dateH + '</th><th>' + CT.distH + '</th><th>' + CT.timeH + '</th><th>' + CT.elevH + '</th><th>' + CT.hrH + '</th><th>' + CT.reH + '</th><th>' + CT.kjH + '</th></tr>';
    var rows = s
      .map(function (r) {
        var d = function (v, u) { return v != null ? nf(v) + u : '—'; };
        return rowOpen('load-bike', r.date) + d(r.dist, ' km') + '</td><td>' + esc(r.time) + '</td><td>' + d(r.elev, ' m') + '</td><td>' + d(r.hrAvg, ' ' + T.trend.rhr.unit) + '</td><td>' + d(r.re, '') + '</td><td>' + d(r.kj, ' kJ') + '</td></tr>';
      })
      .join('');
    return '<div class="run-tbl-wrap"><table class="run-tbl">' + head + rows + '</table></div>';
  }

  // section sub-heading with a stable `hl-<key>` anchor (jump target for Inicio's score cards)
  function sub(key) {
    return '<div class="hsub" id="hl-' + key + '">' + T.sections[key] + '</div>';
  }

  // One renderer, two hosts (four-tab layout, one question per tab):
  //   #health (Salud: "how is my body")  recovery (+ #score-recovery, filled by score.js), sleep,
  //                                      body composition, activity, energy
  //   #health-train (Entreno)            running, cycling, load vs recovery
  // A missing host skips its half; each half has its own empty state.
  // Each half renders inside its own try/catch: a throw in one never blanks the other, and the
  // broken half falls back to its own empty state.
  function render() {
    var host = document.getElementById('health');
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

  function renderSalud(host) {
    var B = HEALTH.body || {}, A = HEALTH.activity || {}, E = HEALTH.energy || {}, R = HEALTH.recovery || {};
    var SC = typeof SCORES === 'undefined' || !SCORES ? null : SCORES;
    var recScore = !!(SC && SC.recovery);
    var out = [];
    var add = adder(out);
    if (!B.hasData && !A.hasData && !E.hasData && !R.hasData && !recScore) {
      host.innerHTML = '<div class="train-empty">' + T.emptyMsg + '</div>';
    } else {
      /* recovery: the recovery dial's detail card lands in #score-recovery, right under the heading */
      if (R.hasData || recScore) {
        out.push(sub('recovery'));
        out.push('<div id="score-recovery"></div>');
      }
      var TR = T.trend;
      if (R.hasData) {
        if (R.rhr) add(function () { return trend(TR.rhr.title, R.rhr.latest + '<small>' + TR.rhr.unit + '</small>', ctx(T.avg30Tpl, R.rhr.avg30, ' ' + TR.rhr.unit, delta(R.rhr.d30, TR.rhr.deltaUnit, -1)), R.rhr.spark, { date: R.rhr.latestDate, id: 'rhr', detail: 'rhr' }); });
        if (R.hrv) add(function () { return trend(TR.hrv.title, R.hrv.latest + '<small>' + TR.hrv.unit + '</small>', ctx(T.avg30Tpl, R.hrv.avg30, ' ' + TR.hrv.unit, delta(R.hrv.d30, TR.hrv.deltaUnit, 1)), R.hrv.spark, { date: R.hrv.latestDate, id: 'hrv', detail: 'hrv' }); });
        if (R.vo2max) add(function () { return trend(TR.vo2max.title, nf(R.vo2max.latest) + '<small>' + TR.vo2max.unit + '</small>', delta(Math.round((R.vo2max.latest - R.vo2max.first) * 10) / 10, '', 1), R.vo2max.spark, { date: R.vo2max.latestDate, detail: 'vo2max' }); });
        if (R.walkingHr) add(function () { return trend(TR.walkingHr.title, R.walkingHr.latest + '<small>' + TR.walkingHr.unit + '</small>', ctx(T.avg30Tpl, R.walkingHr.avg30, ' ' + TR.walkingHr.unit, delta(R.walkingHr.d30, TR.walkingHr.deltaUnit, -1)), R.walkingHr.spark, { date: R.walkingHr.latestDate, detail: 'walkingHr' }); });
        if (R.respiratory) add(function () { return trend(TR.respiratory.title, nf(R.respiratory.latest) + '<small>' + TR.respiratory.unit + '</small>', ctx(T.avg30Tpl, R.respiratory.avg30, ' ' + TR.respiratory.unit, delta(R.respiratory.d30, '', 0)), R.respiratory.spark, { date: R.respiratory.latestDate, id: 'respiratory', detail: 'respiratory' }); });
        if (R.wristTemp) add(function () { return trend(TR.wristTemp.title, nf(R.wristTemp.latest) + '<small>' + TR.wristTemp.unit + '</small>', ctx(T.avg30Tpl, R.wristTemp.avg30, ' ' + TR.wristTemp.unit, ''), R.wristTemp.spark, { date: R.wristTemp.latestDate, id: 'wristTemp', detail: 'wristTemp' }); });
        /* sleep: its own section; the heading is the hl-sleep anchor (sleep dial + monitor card) */
        if (R.sleep) {
          out.push(sub('sleep'));
          add(function () { return trend(TR.sleep.title, nf(R.sleep.latest) + '<small>' + TR.sleep.unit + '</small>', ctx(T.avgNightsTpl, R.sleep.avg, ' ' + TR.sleep.unit, ''), R.sleep.spark, { date: R.sleep.latestDate, detail: 'sleep' }); });
          var sl = R.sleep, c2 = [];
          if (sl.pctTarget != null) c2.push(card(sl.pctTarget + '%', format(T.sleepCards.nightsTargetLbl, { target: nf(sl.target) })));
          if (sl.sd != null) c2.push(card('±' + nf(sl.sd) + ' h', T.sleepCards.sdLbl));
          if (sl.bedtime) c2.push(card(sl.bedtime + ' ±' + sl.bedtimeSd + '′', T.sleepCards.bedtimeLbl));
          if (sl.wake) c2.push(card(sl.wake + ' ±' + sl.wakeSd + '′', T.sleepCards.wakeLbl));
          if (c2.length) out.push('<div class="dash-cards c2">' + c2.join('') + '</div>');
        }
        out.push(note(T.recoveryNoteHtml));
      }
      /* body composition */
      if (B.hasData) {
        out.push(sub('body'));
        if (B.weight) add(function () { return trend(T.trend.weight.title, nf(B.weight.latest) + '<small>' + T.trend.weight.unit + '</small>', delta(B.weight.d30, T.trend.weight.deltaUnit, 0), B.weight.spark, { date: B.weight.latestDate, detail: 'weight' }); });
        // bioimpedance: the Δ and sparkline cover only the recent window, so say how many readings it holds
        var bcPts = function (m) { return m.windowPoints != null && m.windowDays != null ? esc(format(T.bodyCompPointsTpl, { n: m.windowPoints, days: m.windowDays })) : ''; };
        if (B.bodyfat) add(function () { return trend(T.trend.bodyfat.title, nf(B.bodyfat.latest) + '<small>' + T.trend.bodyfat.unit + '</small>', [delta(B.bodyfat.delta, T.trend.bodyfat.deltaUnit, -1), bcPts(B.bodyfat)].filter(Boolean).join(' · '), B.bodyfat.spark, { date: B.bodyfat.latestDate, detail: 'bodyfat' }); });
        if (B.lean) add(function () { return trend(T.trend.lean.title, nf(B.lean.latest) + '<small>' + T.trend.lean.unit + '</small>', [delta(B.lean.delta, T.trend.lean.deltaUnit, 1), bcPts(B.lean)].filter(Boolean).join(' · '), B.lean.spark, { date: B.lean.latestDate, detail: 'lean' }); });
        if (B.waist) add(function () { return trend(format(T.waist.titleTpl, { date: fmtD(B.waist.latestDate) }), nf(B.waist.latest) + '<small>' + T.waist.unit + '</small>', delta(B.waist.delta, T.waist.deltaUnit, -1), B.waist.spark, { detail: 'waist' }); });
        var wsrc = B.weight ? B.weight.source : '', bsrc = B.bodyfat ? B.bodyfat.source : '';
        var sourcesClause = B.weight ? format(T.bodyNote.sourcesClause, { n: B.weight.sources }) : '';
        var wsrcClause = wsrc ? format(T.bodyNote.sourceClause, { src: esc(wsrc) }) : '';
        var bsrcClause = bsrc ? format(T.bodyNote.sourceClause, { src: esc(bsrc) }) : '';
        out.push(note(format(T.bodyNote.main, { sourcesClause: sourcesClause, sourceClause: wsrcClause, bfSourceClause: bsrcClause })));
        out.push(note(B.waist ? format(T.waist.noteTpl, { n: B.waist.points, first: esc(fmtD(B.waist.firstDate)) }) : T.waist.emptyHtml));
      }
      /* activity / NEAT */
      if (A.hasData) {
        out.push(sub('activity'));
        ['steps', 'exercise', 'distance', 'flights'].forEach(function (k) {
          var a = A[k], tt = T.trend[k];
          if (!a) return;
          add(function () { return trend(tt.title, nf(a.latest) + '<small>' + tt.unit + '</small>', ctx(T.avg30Tpl, a.avg30, tt.avgUnit, delta(a.d30, tt.deltaUnit, 1)), a.spark, { date: a.latestDate, soFar: true, detail: k }); });
        });
        out.push(note(T.activityNoteHtml));
      }
      /* energy */
      if (E.hasData) {
        out.push(sub('energy'));
        // a power-meter ride day (lib/health/ride-energy.mjs): the headline says its active energy was corrected
        var rideCtx = E.latestCorrected && T.energyRide ? esc(T.energyRide.latest) : '';
        if (E.tdeeLatest != null) add(function () { return trend(T.trend.expenditure.title, nf(E.tdeeLatest) + '<small>' + T.trend.expenditure.unit + '</small>', [ctx(T.avg30Tpl, E.tdeeAvg, T.trend.expenditure.avgUnit, ''), rideCtx].filter(Boolean).join(' · '), E.spark, { date: E.tdeeLatestDate, soFar: true, detail: 'energy' }); });
        if (E.correctedDays > 0 && T.energyRide) out.push(note(format(T.energyRide.days, { n: E.correctedDays })));
        if (E.balance) {
          var b = E.balance;
          out.push(
            '<div class="dash-cards">' +
            card(nf(b.intakeAvg) + ' kcal', T.energyCards.intakeAvgLbl) +
            card(nf(b.tdeeAvg) + ' kcal', T.energyCards.tdeeAvgLbl) +
            card((b.net < 0 ? '' : '+') + nf(b.net), b.net < 0 ? T.energyCards.deficitLbl : T.energyCards.surplusLbl) +
            '</div>',
          );
          if (E.macros) {
            var m = E.macros;
            out.push(
              '<div class="dash-cards">' +
              card(m.p + ' g · ' + m.pPct + '%', T.energyCards.proteinLbl) +
              card(m.c + ' g · ' + m.cPct + '%', T.energyCards.carbsLbl) +
              card(m.g + ' g · ' + m.gPct + '%', T.energyCards.fatLbl) +
              '</div>',
            );
          }
          var macroClause = E.macros ? T.energyBalanceNote.macroClause : '';
          out.push(note(format(T.energyBalanceNote.main, { from: esc(fmtD(b.from)), to: esc(fmtD(b.to)), days: b.days, macroClause: macroClause })));
        } else {
          var lastIntakeClause = E.lastIntake ? format(T.energyExpenditureNote.lastIntakeClause, { date: esc(fmtD(E.lastIntake)), ago: ago(E.lastIntake) }) : '';
          out.push(note(format(T.energyExpenditureNote.main, { tdeeDays: E.tdeeDays, lastIntakeClause: lastIntakeClause })));
        }
      }
      host.innerHTML = '<p class="dash-as">' + T.introMsg + '</p>' + out.join('');
    }
  }

  function renderEntreno(train) {
    var Run = HEALTH.running || {}, LR = HEALTH.loadRecovery || {}, Cyc = HEALTH.cycling || {};
    var out = [];
    if (!Run.hasData && !Cyc.hasData && !LR.hasData) {
      train.innerHTML = '<div class="train-empty">' + T.trainEmptyMsg + '</div>';
    } else {
      /* running + cycling: rendered as a pair with the same table style and row budget, so run and
         bike carry equal weight; when only one has data the other states its empty case */
      if (Run.hasData || Cyc.hasData) {
        out.push(sub('running'));
        if (Run.hasData) {
          out.push(runsTable(Run.sessions));
          out.push(note(format(T.runningNote, { count: Run.count })));
        } else out.push(note(T.runningEmptyHtml));
        out.push(sub('cycling'));
        if (Cyc.hasData) {
          out.push(ridesTable(Cyc.sessions));
          out.push(note(format(T.cyclingNote, { count: Cyc.count })));
        } else out.push(note(T.cyclingEmptyHtml));
      }
      /* load vs recovery (cross-tab) */
      if (LR.hasData) {
        out.push(sub('load'));
        var s = LR.series, lmax = Math.max.apply(null, s.map(function (x) { return x.load; })) || 1;
        var lbars = s
          .map(function (x) {
            var h = Math.round((100 * x.load) / lmax);
            return '<div class="wbar' + (x.load ? '' : ' zero') + '" title="' + esc(format(T.loadSec.barTitleTpl, { date: fmtD(x.w), load: x.load })) + '"><i style="height:' + h + '%"></i></div>';
          })
          .join('');
        var lax = '<div class="waxis"><span>' + esc(fmtD(s[0].w)) + '</span><span>' + esc(fmtD(s[s.length - 1].w)) + '</span></div>';
        out.push('<div class="dash-sec"><h3>' + T.loadSec.heading + '</h3><p class="hint">' + format(T.loadSec.hint, { weeks: LR.weeks }) + '</p><div class="wbars">' + lbars + '</div>' + lax + '</div>');
        if (LR.split) {
          var sp = LR.split, cc = [];
          if (sp.hrvHigh != null) cc.push(card(sp.hrvHigh + ' ms', T.loadCards.hrvHighLbl));
          if (sp.hrvLow != null) cc.push(card(sp.hrvLow + ' ms', T.loadCards.hrvLowLbl));
          if (sp.rhrHigh != null) cc.push(card(nf(sp.rhrHigh) + ' ' + T.trend.rhr.unit, T.loadCards.rhrHighLbl));
          if (sp.rhrLow != null) cc.push(card(nf(sp.rhrLow) + ' ' + T.trend.rhr.unit, T.loadCards.rhrLowLbl));
          if (cc.length) out.push('<div class="dash-cards c2">' + cc.join('') + '</div>');
        }
        out.push(note(T.loadNoteHtml));
      }
      train.innerHTML = out.join('');
    }
  }

  render();
})();
