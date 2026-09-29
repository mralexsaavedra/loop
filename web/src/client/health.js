/* "Salud / Health" tab — body composition, activity (NEAT), energy balance,
 * running performance and recovery, ported verbatim from the legacy
 * `<script>` IIFE ("health") of the pre-Astro generated page (deleted at
 * the astro-plan-web cutover), adapted to read HEALTH/LOCALE from globals
 * baked by web/src/components/Bake.astro and I18N_HEALTH
 * (web/src/i18n/health-templates.mjs) instead of hardcoded English
 * strings — same pattern as client/training-today.js and
 * client/training-dash.js.
 *
 * `esc()` calls sit at EXACTLY the same spots as the legacy source
 * (fmtD()/source strings/titles) — static I18N_HEALTH copy is trusted the
 * same way legacy's hardcoded literals were, so it is NOT re-escaped (see
 * design's Trusted markup row: dict content is generic/tracked, never user
 * input).
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

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  function nf(n) {
    return LOCALE === 'es' ? String(n).replace('.', ',') : String(n);
  }
  function format(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) {
      return vars && vars[k] != null ? vars[k] : '';
    });
  }
  function fmtD(iso) {
    var p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(DATE_LOCALE, { day: 'numeric', month: 'short' });
  }
  function ago(iso) {
    if (!iso) return '';
    var d = Math.round((Date.now() - new Date(iso + 'T00:00:00')) / 86400000);
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
    if (d == null) return '';
    var dir = d < 0 ? -1 : d > 0 ? 1 : 0, cls = goodDir === 0 || dir === 0 ? 'flat' : dir === goodDir ? 'good' : 'bad';
    return '<span class="dlt ' + cls + '">' + (d > 0 ? '▲ +' : d < 0 ? '▼ ' : '■ ') + nf(Math.round(d * 10) / 10) + (unit || '') + '</span>';
  }
  function trend(title, valHtml, deltaHtml, sp) {
    var ax = sp ? '<div class="spark-ax"><span>' + esc(fmtD(sp.from)) + '</span><span>' + esc(fmtD(sp.to)) + '</span></div>' : '';
    return (
      '<div class="mtrend"><div class="mtrend-top"><h4>' + esc(title) + '</h4>' +
      '<div class="mtrend-val">' + valHtml + (deltaHtml || '') + '</div></div>' + sparkSvg(sp) + ax + '</div>'
    );
  }
  function card(num, lbl) {
    return '<div class="dash-card"><div class="dash-num">' + esc(num) + '</div><div class="dash-lbl">' + esc(lbl) + '</div></div>';
  }
  function note(html) {
    return '<div class="dash-note">' + html + '</div>';
  }

  function runsTable(s) {
    var RT = T.runningTable;
    var head = '<tr><th>' + RT.dateH + '</th><th>' + RT.distH + '</th><th>' + RT.paceH + '</th><th>' + RT.powerH + '</th><th>' + RT.gctH + '</th><th>' + RT.oscH + '</th><th>' + RT.strideH + '</th></tr>';
    var rows = s
      .map(function (r) {
        var d = function (v, u) { return v != null ? nf(v) + u : '—'; };
        return '<tr><td>' + esc(fmtD(r.date)) + '</td><td>' + d(r.dist, ' km') + '</td><td>' + esc(r.pace) + '/km</td><td>' + d(r.power, ' W') + '</td><td>' + d(r.gct, ' ms') + '</td><td>' + d(r.vosc, ' cm') + '</td><td>' + d(r.stride, ' m') + '</td></tr>';
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
        return '<tr><td>' + esc(fmtD(r.date)) + '</td><td>' + d(r.dist, ' km') + '</td><td>' + esc(r.time) + '</td><td>' + d(r.elev, ' m') + '</td><td>' + d(r.hrAvg, ' ' + T.trend.rhr.unit) + '</td><td>' + d(r.re, '') + '</td><td>' + d(r.kj, ' kJ') + '</td></tr>';
      })
      .join('');
    return '<div class="run-tbl-wrap"><table class="run-tbl">' + head + rows + '</table></div>';
  }

  // section sub-heading with a stable `hl-<key>` anchor (jump target for Inicio's score cards)
  function sub(key) {
    return '<div class="hsub" id="hl-' + key + '">' + T.sections[key] + '</div>';
  }

  function render() {
    var host = document.getElementById('health');
    if (!host) return;
    var B = HEALTH.body || {}, A = HEALTH.activity || {}, E = HEALTH.energy || {}, Run = HEALTH.running || {}, R = HEALTH.recovery || {}, LR = HEALTH.loadRecovery || {}, Cyc = HEALTH.cycling || {}, out = [];
    if (!B.hasData && !A.hasData && !E.hasData && !Run.hasData && !Cyc.hasData && !R.hasData && !LR.hasData) {
      host.innerHTML = '<div class="train-empty">' + T.emptyMsg + '</div>';
      return;
    }
    /* body composition */
    if (B.hasData) {
      out.push(sub('body'));
      if (B.weight) out.push(trend(T.trend.weight.title, nf(B.weight.latest) + '<small>' + T.trend.weight.unit + '</small>', delta(B.weight.d30, T.trend.weight.deltaUnit, 0), B.weight.spark));
      if (B.bodyfat) out.push(trend(T.trend.bodyfat.title, nf(B.bodyfat.latest) + '<small>' + T.trend.bodyfat.unit + '</small>', delta(B.bodyfat.delta, T.trend.bodyfat.deltaUnit, -1), B.bodyfat.spark));
      if (B.lean) out.push(trend(T.trend.lean.title, nf(B.lean.latest) + '<small>' + T.trend.lean.unit + '</small>', delta(B.lean.delta, T.trend.lean.deltaUnit, 1), B.lean.spark));
      if (B.waist) out.push(trend(format(T.waist.titleTpl, { date: fmtD(B.waist.latestDate) }), nf(B.waist.latest) + '<small>' + T.waist.unit + '</small>', delta(B.waist.delta, T.waist.deltaUnit, -1), B.waist.spark));
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
      if (A.steps) out.push(trend(T.trend.steps.title, nf(A.steps.avg30) + '<small>' + T.trend.steps.unit + '</small>', delta(A.steps.d30, T.trend.steps.deltaUnit, 1), A.steps.spark));
      if (A.exercise) out.push(trend(T.trend.exercise.title, nf(A.exercise.avg30) + '<small>' + T.trend.exercise.unit + '</small>', delta(A.exercise.d30, T.trend.exercise.deltaUnit, 1), A.exercise.spark));
      if (A.distance) out.push(trend(T.trend.distance.title, nf(A.distance.avg30) + '<small>' + T.trend.distance.unit + '</small>', delta(A.distance.d30, T.trend.distance.deltaUnit, 1), A.distance.spark));
      if (A.flights) out.push(trend(T.trend.flights.title, nf(A.flights.avg30) + '<small>' + T.trend.flights.unit + '</small>', delta(A.flights.d30, T.trend.flights.deltaUnit, 1), A.flights.spark));
      out.push(note(T.activityNoteHtml));
    }
    /* energy */
    if (E.hasData) {
      out.push(sub('energy'));
      if (E.tdeeAvg != null) out.push(trend(T.trend.expenditure.title, nf(E.tdeeAvg) + '<small>' + T.trend.expenditure.unit + '</small>', '', E.spark));
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
    /* recovery */
    if (R.hasData) {
      out.push(sub('recovery'));
      if (R.rhr) out.push(trend(T.trend.rhr.title, R.rhr.latest + '<small>' + T.trend.rhr.unit + '</small>', delta(R.rhr.d30, T.trend.rhr.deltaUnit, -1), R.rhr.spark));
      if (R.hrv) out.push(trend(T.trend.hrv.title, R.hrv.latest + '<small>' + T.trend.hrv.unit + '</small>', delta(R.hrv.d30, T.trend.hrv.deltaUnit, 1), R.hrv.spark));
      if (R.vo2max) out.push(trend(T.trend.vo2max.title, nf(R.vo2max.latest) + '<small>' + T.trend.vo2max.unit + '</small>', delta(Math.round((R.vo2max.latest - R.vo2max.first) * 10) / 10, '', 1), R.vo2max.spark));
      if (R.walkingHr) out.push(trend(T.trend.walkingHr.title, R.walkingHr.latest + '<small>' + T.trend.walkingHr.unit + '</small>', delta(R.walkingHr.d30, T.trend.walkingHr.deltaUnit, -1), R.walkingHr.spark));
      if (R.respiratory) out.push(trend(T.trend.respiratory.title, nf(R.respiratory.latest) + '<small>' + T.trend.respiratory.unit + '</small>', delta(R.respiratory.d30, '', 0), R.respiratory.spark));
      if (R.wristTemp) out.push(trend(T.trend.wristTemp.title, nf(R.wristTemp.latest) + '<small>' + T.trend.wristTemp.unit + '</small>', '', R.wristTemp.spark));
      if (R.sleep) {
        out.push(trend(T.trend.sleep.title, nf(R.sleep.avg) + '<small>' + T.trend.sleep.unit + '</small>', '', R.sleep.spark));
        var sl = R.sleep, c2 = [];
        if (sl.pctTarget != null) c2.push(card(sl.pctTarget + '%', format(T.sleepCards.nightsTargetLbl, { target: nf(sl.target) })));
        if (sl.sd != null) c2.push(card('±' + nf(sl.sd) + ' h', T.sleepCards.sdLbl));
        if (sl.bedtime) c2.push(card(sl.bedtime + ' ±' + sl.bedtimeSd + '′', T.sleepCards.bedtimeLbl));
        if (sl.wake) c2.push(card(sl.wake + ' ±' + sl.wakeSd + '′', T.sleepCards.wakeLbl));
        if (c2.length) out.push('<div class="dash-cards c2">' + c2.join('') + '</div>');
      }
      out.push(note(T.recoveryNoteHtml));
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
    host.innerHTML = '<p class="dash-as">' + T.introMsg + '</p>' + out.join('');
  }

  render();
})();
