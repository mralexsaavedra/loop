/* "Salud / Health" tab sections (recovery, fitness, sleep, body composition, activity/NEAT, energy:
 * metric rows via HC.metricRow, notes behind an ⓘ toggle per section) plus Entreno's
 * running / cycling list rows and load vs recovery (#health-train, see render()). Reads HEALTH / LOCALE
 * from the globals baked by web/src/components/Bake.astro and its copy from I18N_HEALTH
 * (web/src/i18n/health-templates.mjs) — same pattern as client/training-today.ts and
 * client/training-dash.ts.
 *
 * `esc()` / `format()` / `daysOld()` are the shared helpers of client/util.ts (window.HC). `esc()` wraps
 * every data value (dates, source names, titles); the static I18N_HEALTH copy is generic, tracked text,
 * never user input, so it is NOT re-escaped.
 *
 * `HC.num()` / `HC.hours()` / `HC.pct()` are the one number formatter (lib/format/numbers.mjs via
 * HC_FMT, docs/design-system.md → "Numbers"): decimal comma in es, every value >= 1000 grouped
 * ("2.532"), sleep hours as h:mm, percents without a space.
 *
 * `ago()` depends on `Date.now()` (real wall-clock time, not a baked value): HEALTH is a precomputed
 * snapshot, and `ago()` is only the relative-time label of the "last logged" caveat in the energy section.
 *
 * Module script (bundled into the page, docs/plan-page.md → Module scripts).
 */
import type { PageGlobals } from './page-globals';

// the page globals this script reads (baked by the build or provided by an earlier script; manifest.mjs)
declare const HC: PageGlobals['HC'];
declare const DETAIL: PageGlobals['DETAIL'];
declare const HEALTH: PageGlobals['HEALTH'];
declare const I18N_HEALTH: PageGlobals['I18N_HEALTH'];
declare const PROFILE: PageGlobals['PROFILE'];
declare const SCORES: PageGlobals['SCORES'];

// a fitness-age plural template pair (I18N_HEALTH.fitnessAge.younger / older)
type Plural = { one: string; other: string };
// a row builder: the row's HTML, '' = no row (safeRows skips it)
type RowFn = () => string;

(function () {
  var T = I18N_HEALTH;
  // shared helpers (web/src/client/util.ts)
  var esc = HC.esc, nf = HC.nf, format = HC.format, daysOld = HC.daysOld;
  // the ONE display-date formatter (util.ts), without the weekday: "22 Jun" / "22 jun"
  function fmtD(iso: string): string {
    return HC.fmtDate(iso, { weekday: false });
  }
  function ago(iso: string): string {
    if (!iso) return '';
    var d = Math.round((Date.now() - (new Date(iso + 'T00:00:00') as unknown as number)) / HC.MS_PER_DAY);
    if (d < 45) return format(T.agoDaysTpl, { d: d });
    var m = Math.round(d / 30);
    if (m < 12) return format(m > 1 ? T.agoMonthsTpl : T.agoMonthTpl, { m: m });
    return format(T.agoYearsTpl, { y: nf(Math.round((m / 12) * 10) / 10) });
  }
  var fin = HC.fin;
  // decimals of a baked value (1 at most): the baseline is shown at the value's own precision
  function decOf(v: number): number {
    return Math.round(v) === v ? 0 : 1;
  }
  function round(v: number, dec: number): number {
    var f = Math.pow(10, dec);
    return Math.round(v * f) / f;
  }
  var FLAT_SHARE = 0.02; // within ±2 % of the baseline = a grey dot (as Inicio's My dashboard)
  // One Salud metric row (the shared HC.metricRow: icon · NAME · value + unit · ▲▼• · a small line).
  // Today first: the value is the NEWEST one; the small line is its 30-day baseline (`o.base`, with
  // the arrow vs it) or, for a sparse measurement, its change (`o.delta`, arrow by its sign); `o.dir`
  // = the good direction (1 up, -1 down, 0 none -> a neutral --ink arrow, HC.trendTone). A daily total dated the viewer's today
  // (`o.soFar`) is partial: "today, so far", no arrow. A row whose date is more than STALE_DAYS old
  // is greyed with "no recent data" and no arrow (decided at view time; `o.noStale` for a sparse
  // manual measurement dated in its own line). `o.id` = an hl-<key> anchor, `o.detail` = the detail
  // sheet a tap opens. The date and the baseline are spelled out in the row's screen-reader words (HC.metricRow sr).
  function mrow(key: string, title: string, unit: string, o: any): string {
    if (!fin(o.value)) throw new Error('no value');
    var age = o.date ? daysOld(o.date) : null;
    var stale = !o.noStale && age != null && age > HC.STALE_DAYS;
    var partial = !!o.soFar && age === 0;
    // hours (sleep) read as h:mm and carry no unit; anything else = the baked value + its unit
    var hm = unit === 'h';
    if (hm) unit = '';
    var show = function (v: number, signed?: boolean) { return hm ? HC.hours(v, signed) : (signed && v > 0 ? '+' : '') + nf(v); };
    var value = o.text || show(o.value), u = unit ? ' ' + unit : '';
    // sr: the row's small line in words, read after the name and value (HC.metricRow: named by its content)
    var base = '', arrow: string | null = null, sr = [o.date ? (partial ? T.soFar : fmtD(o.date)) : '', o.when || ''];
    if (fin(o.base)) {
      base = hm ? HC.hours(o.base) : nf(round(o.base, decOf(o.value)));
      sr.push(format(o.baseTpl || T.avg30Tpl, { value: base + u }));
      if (!partial) {
        var rel = o.base ? (o.value - o.base) / Math.abs(o.base) : o.value - o.base;
        arrow = Math.abs(rel) < FLAT_SHARE ? 'flat' : rel > 0 ? 'up' : 'down';
      }
    } else if (fin(o.delta)) {
      base = 'Δ ' + show(hm ? o.delta : round(o.delta, 1), true) + (o.deltaUnit || '');
      sr.push(format(T.deltaAriaTpl, { value: base.slice(2) }));
      arrow = o.delta === 0 ? 'flat' : o.delta > 0 ? 'up' : 'down';
    } else if (o.sub) {
      base = o.sub;
      sr.push(o.sub);
    }
    if (o.when) base = [o.when, base].filter(Boolean).join(' · ');
    if (partial) base = [base, T.soFar].filter(Boolean).join(' · ');
    if (stale) {
      base = T.staleNote;
      arrow = null;
      sr.push(T.staleNote);
    }
    var tone = arrow && arrow !== 'flat' && o.dir ? ((arrow === 'up') === (o.dir > 0) ? 'good' : 'bad') : 'flat';
    if (arrow && T.dirs) sr.push(T.dirs[arrow]);
    return HC.metricRow({ key: o.icon || key, cls: stale ? 'db-stale' : '', attrs: (o.id ? ' id="hl-' + o.id + '"' : '') + (o.detail ? HC.detailAttrs(o.detail) : ''),
      sr: parts(sr), name: title, value: value, unit: unit, arrow: arrow, tone: tone, base: base });
  }
  // Fitness age (SCORES.fitnessAge, lib/score/fitness-age.mjs) vs the chronological age (PROFILE.birthdate on
  // the viewer's clock): a full ring with the fitness age in whole years (or "< 25" / "> 75" at the
  // reference curve's bounds) and how many years younger / older, coloured --up / --down; then the
  // chronological age and the fitness age's change over 90 (else 30) days as rows. Missing sex,
  // birthdate or VO2max -> no number, the reason. {before, rows, note}; null = no block (an old bake).
  function fitnessAgeBlock(SC: any): { before: string; rows: RowFn[]; note: string } | null {
    var F = SC && SC.fitnessAge, FT = T.fitnessAge, P: Partial<typeof PROFILE> = typeof PROFILE === 'undefined' || !PROFILE ? {} : PROFILE;
    if (!F || !FT) return null;
    if (!F.ok) return { before: note(F.reason === 'no-sex' ? FT.noSex : FT.noVo2), rows: [], note: FT.noteHtml };
    var ca = HC.ageOn(P.birthdate, HC.todayIso());
    if (ca == null) return { before: note(FT.noBirth), rows: [], note: FT.noteHtml };
    var fa = Math.round(F.age), plural = function (o: Plural, n: number) { return format(n === 1 ? o.one : o.other, { n: n }); };
    var num = F.bound === 'below' ? '< ' + fa : F.bound === 'above' ? '> ' + fa : String(fa);
    var diff = '', tone = 'flat';
    if (F.bound === 'below') { if (ca > fa) { diff = format(FT.atLeastYounger, { n: ca - fa }); tone = 'good'; } }
    else if (F.bound === 'above') { if (ca < fa) { diff = format(FT.atLeastOlder, { n: fa - ca }); tone = 'bad'; } }
    else if (ca > fa) { diff = plural(FT.younger, ca - fa); tone = 'good'; }
    else if (ca < fa) { diff = plural(FT.older, fa - ca); tone = 'bad'; }
    else diff = FT.same;
    var v = F.vo2 || {};
    var basis = format(FT.basisTpl, { vo2: nf(v.value), date: fmtD(v.date), src: v.source || '' }).replace(/ · $/, '');
    var aria = format(FT.ariaTpl, { fa: num, ca: ca, diff: diff || '—' });
    var ring = '<figure class="dial fa fa-' + tone + '"' + HC.detailAttrs('fitnessAge') + '><div class="dial-ring" role="img" aria-label="' + esc(aria) + '">' +
      '<svg class="dial-svg" viewBox="0 0 120 120" aria-hidden="true"><circle class="dial-track" cx="60" cy="60" r="55"/><circle class="dial-fill" pathLength="100" cx="60" cy="60" r="55"/></svg>' +
      '<div class="dial-centre" aria-hidden="true"><b class="dial-num">' + esc(num) + '</b><span class="dial-word">' + FT.label + '</span></div></div>' +
      '<figcaption class="dial-lbl">' + (diff ? '<b class="ld-' + tone + '">' + esc(diff) + '</b>' : '') + '<span>' + esc(basis) + '</span></figcaption></figure>';
    var rows: RowFn[] = [function () { return mrow('fitnessAge', FT.chrono, FT.unit, { value: ca, noStale: true }); }];
    var tr = F.trend || {}, prev = tr.d90 ? [tr.d90, 90] : tr.d30 ? [tr.d30, 30] : null;
    if (prev && !F.bound && !prev[0].bound && fin(prev[0].age)) {
      rows.push(function () {
        return mrow('fitnessAge', format(FT.trend, { days: prev![1] }), FT.unit, { value: fa, delta: round(F.age - prev![0].age, 1), dir: -1, date: v.date, detail: 'fitnessAge' });
      });
    }
    return { before: ring, rows: rows, note: FT.noteHtml };
  }

  // the newest staged night (lib/health/aggregate.mjs sleep.stages): REM / deep / core / awake hours
  // (+ % of asleep) and efficiency, each vs the mean of the staged nights among the last 30; none
  // when the extract has no stages
  function stageRows(st: any, SCd: any): RowFn[] {
    if (!st || !SCd.stages) return [];
    var L = SCd.stages, sh = st.shares || {};
    // each row its own icon (one set, util.ts): REM a wave, deep the moon, core the stages, awake a clock
    var ICO: Record<string, string> = { rem: 'restor', deep: 'sleep', core: 'stages', awake: 'clock' };
    var hrow = function (k: string, dir: number): RowFn {
      return function () {
        return fin(st[k]) ? mrow('sleep', L[k], 'h', { icon: ICO[k], value: st[k], base: st.avg[k], baseTpl: T.avgNightsTpl, dir: dir, date: st.date, detail: 'sleep',
          when: fin(sh[k]) ? HC.pct(sh[k]) : '' }) : '';
      };
    };
    return [hrow('rem', 1), hrow('deep', 1), hrow('core', 0), hrow('awake', -1), function () {
      return fin(st.eff) ? mrow('sleep', L.eff, '%', { icon: 'eff', value: st.eff, base: st.avg.eff, baseTpl: T.avgNightsTpl, dir: 1, date: st.date, detail: 'sleep' }) : '';
    }];
  }
  function note(html: string): string {
    return '<div class="dash-note">' + html + '</div>';
  }

  // Entreno run / ride rows (HC.metricRow): ONE template for both lists — icon · the date (UPPERCASE) ·
  // the distance big on the right with the small lines under it (run: time · pace; ride: time · climb,
  // then a second line HR · effort · kJ — the ride's work is shown nowhere else). Nothing under the date.
  // A run's HR, effort and watch dynamics stay in the screen-reader words and the day the row opens (they would
  // wrap to 2-3 lines at 390 px). A dash never stands in for a missing value: a field the source did not
  // record is left out (the ⓘ says which source records what). The row opens that day in its load view
  // (client/detail.ts); without the detail sheet it is a plain row (no fake link).
  function parts(list: Array<string | null | undefined>): string {
    return list.filter(function (x) { return x != null && x !== ''; }).join(' · ');
  }
  // note = the run's numbers kept off the row (screen-reader words only); base2 = the ride's second small line
  function sessionRow(key: string, icon: string, r: any, base: string, note: string, base2?: string): string {
    var name = HC.fmtDate(r.date);
    var value = r.dist != null ? nf(r.dist) : '—';
    return HC.metricRow({ key: icon, attrs: HC.detailAttrs(key, r.date), name: name, value: value, unit: r.dist != null ? 'km' : '', base: base, base2: base2 || '',
      sr: parts([base, note]) });
  }
  function runRow(r: any): string {
    var RT = T.runningTable, u = T.trend.rhr.unit;
    var base = parts([r.time, r.pace ? r.pace + '/km' : null]);
    var note = parts([r.hrAvg != null ? r.hrAvg + ' ' + u : null, r.re != null ? RT.reH + ' ' + r.re : null, r.elev != null ? '↑' + nf(r.elev) + ' m' : null,
      r.power != null ? nf(r.power) + ' W' : null, r.gct != null ? RT.gctH + ' ' + nf(r.gct) + ' ms' : null,
      r.vosc != null ? RT.oscH + ' ' + nf(r.vosc) + ' cm' : null, r.stride != null ? RT.strideH + ' ' + nf(r.stride) + ' m' : null]);
    return sessionRow('load-run', 'run', r, base, note);
  }
  function rideRow(r: any): string {
    var CT = T.cyclingTable, u = T.trend.rhr.unit;
    var base = parts([r.time, r.elev != null ? '↑' + nf(r.elev) + ' m' : null]);
    var note = parts([r.hrAvg != null ? r.hrAvg + ' ' + u : null, r.re != null ? CT.reH + ' ' + r.re : null, r.kj != null ? nf(r.kj) + ' kJ' : null]);
    return sessionRow('load-bike', 'bike', r, base, note, note);
  }

  // A Salud section: UPPERCASE label (the hl-<key> anchor is the section itself), an ⓘ toggle
  // holding its notes (collapsed, nothing lost), an optional block before the rows (the recovery
  // card host), then the rows.
  function section(key: string, rows: string[], notes?: string[], before?: string): string {
    var info = (notes || []).filter(Boolean), id = 'hs-info-' + key, name = T.sections[key];
    if (!rows.length && !before) return '';
    return '<section class="hs-sec hs-sec-' + key + '" id="hl-' + key + '" aria-labelledby="hs-h-' + key + '"><div class="hs-head"><h3 class="hs-lbl" id="hs-h-' + key + '">' + name + '</h3>' +
      (info.length ? HC.infoBtn(id, format(T.infoTpl, { section: name })) : '') + '</div>' +
      (info.length ? '<div class="hs-info" id="' + id + '" hidden>' + info.map(function (n) { return '<p>' + n + '</p>'; }).join('') + '</div>' : '') +
      (before || '') + (rows.length ? '<ul class="db-list">' + rows.join('') + '</ul>' : '') + '</section>';
  }

  // One renderer, three hosts (four-tab layout, one question per tab):
  //   #health-body (Salud: "how is my body")  recovery (+ #score-recovery, filled by score.ts), sleep,
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
  // Salud, top to bottom (under the health monitor list, client/monitor.ts): Recovery (+ the recovery
  // card host #score-recovery, filled by score.ts), Fitness, Sleep, Body composition, Activity, Energy.
  // each row builder runs alone: one broken row is skipped, never the tab
  function safeRows(list: RowFn[]): string[] {
    var r: string[] = [];
    list.forEach(function (fn) {
      try {
        var h = fn();
        if (h) r.push(h);
      } catch (e) {
        /* skip this row */
      }
    });
    return r;
  }
  // a recovery signal's row builder: the newest value vs its 30-day mean
  function signalRow(R: any, k: string, dir: number, id: boolean): RowFn {
    var TR = T.trend;
    return function () {
      var m = R[k];
      return m ? mrow(k, TR[k].title, TR[k].unit, { value: m.latest, base: m.avg30, dir: dir, date: m.latestDate, id: id ? k : null, detail: k }) : '';
    };
  }
  /* recovery: the recovery dial's detail card lands in #score-recovery, right under the label; a
     signal the health monitor at the top of Salud already lists (client/monitor.ts) is not repeated
     here, one it lacks keeps its row */
  function recoverySection(R: any, SC: any): string {
    var inMonitor: Record<string, boolean> = {};
    (SC && SC.monitor && Array.isArray(SC.monitor.cards) ? SC.monitor.cards : []).forEach(function (c: any) {
      if (c && c.key) inMonitor[c.key] = true;
    });
    var recSigs = ([['rhr', -1], ['hrv', 1], ['respiratory', 0], ['wristTemp', 0]] as Array<[string, number]>).filter(function (x) {
      return !inMonitor[x[0]];
    }).map(function (x) {
      return signalRow(R, x[0], x[1], true);
    });
    return section('recovery', R.hasData ? safeRows(recSigs) : [],
      R.hasData ? [T.recoveryNoteHtml] : [], '<div id="score-recovery"></div>');
  }
  /* healthspan habits, first on Salud: DETAIL.habits (lib/score/healthspan.mjs: the last 28 full days, the
     cited references in `ref`) + the fitness age vs the real age. One row per habit with data: met = hb-ok,
     not met = hb-off; an own-baseline habit (resting HR, sleep regularity) without a baseline yet stays
     uncoloured and uncounted. A "met of n" line leads; the sources and the zone approximation sit under ⓘ.
     Never folded into an age (that needs weights nobody publishes). */
  function habitsSection(SC: any): string {
    var H = (typeof DETAIL !== 'undefined' && DETAIL && DETAIL.habits ? DETAIL.habits : null)!, TH = T.habits;
    if (!H || !H.ref || !TH) return '';
    var R = H.ref, U = TH.units, P: Partial<typeof PROFILE> = typeof PROFILE === 'undefined' || !PROFILE ? {} : PROFILE;
    var age = HC.ageOn(P.birthdate, HC.todayIso());
    var rows: string[] = [], met = 0, n = 0;
    function add(k: string, ok: boolean | null, o: any) {
      if (ok != null) { n++; if (ok) met++; }
      var sr = parts([ok == null ? '' : ok ? TH.met : TH.notMet, o.base, o.base2]);
      rows.push(HC.metricRow({ key: o.icon, attrs: (o.detail ? HC.detailAttrs(o.detail) : '') + ' data-habit="' + k + '"', sr: sr,
        name: TH.names[k], value: o.value, unit: o.unit, numCls: ok == null ? '' : ok ? 'hb-ok' : 'hb-off', base: o.base, base2: o.base2 }));
    }
    if (H.sleep) add('sleep', H.sleep.mean >= R.sleepH, { icon: 'sleep', detail: 'sleep', value: HC.hours(H.sleep.mean), unit: '', base: TH.ref.sleep });
    if (H.activity) {
      add('activity', H.activity.eq >= R.actMin, { icon: 'zones13', detail: 'zones13', value: HC.num(H.activity.eq, 0), unit: U.minWk,
        base: TH.ref.activity, base2: format(TH.mix, { mod: HC.num(H.activity.mod, 0), vig: HC.num(H.activity.vig, 0) }) });
    }
    if (H.strength) add('strength', H.strength.perWeek >= R.strengthDays, { icon: 'gymTime', detail: 'gymTime', value: HC.num(H.strength.perWeek, 1), unit: U.daysWk, base: TH.ref.strength });
    if (H.steps) {
      var older = age != null && age >= R.ageSplit, band = older ? R.steps.from60 : R.steps.under60;
      add('steps', H.steps.mean >= band[0], { icon: 'steps', detail: 'steps', value: HC.num(H.steps.mean, 0), unit: '',
        base: format(TH.ref.steps, { lo: HC.num(band[0], 0), hi: HC.num(band[1], 0), group: older ? TH.from60 : TH.under60 }) });
    }
    var F = SC && SC.fitnessAge;
    if (F && F.ok && fin(F.age) && age != null) {
      var fa = Math.round(F.age), shown = F.bound === 'below' ? '< ' + fa : F.bound === 'above' ? '> ' + fa : String(fa);
      add('fitness', F.age <= age, { icon: 'fitnessAge', detail: 'fitnessAge', value: shown, unit: U.years, base: format(TH.ref.fitness, { age: age }) });
    }
    [['rhr', 'rhr', 'rhr', U.bpm], ['cons', 'cons', 'sleep', U.min]].forEach(function (x) {
      var h = H[x[0] as 'rhr' | 'cons'];
      if (!h || !fin(h.now)) return;
      add(x[0], fin(h.base) ? h.now <= h.base : null, { icon: x[1], detail: x[2], value: HC.num(h.now, 0), unit: x[3],
        base: fin(h.base) ? format(TH.ref.before, { value: HC.num(h.base, 0) + ' ' + x[3] }) : TH.ref.noBase });
    });
    if (!rows.length) return '';
    var lead = n ? '<p class="hb-sum">' + esc(format(TH.summary, { met: met, n: n })) + '</p>' : '';
    return section('habits', rows, TH.notes, lead);
  }
  /* fitness: the fitness-age ring (+ chronological age and its trend), VO2max (change since the
     first reading) and walking HR */
  function fitnessSection(R: any, SC: any): string {
    var TR = T.trend, fab;
    try { fab = fitnessAgeBlock(SC); } catch (e) { fab = null; /* a broken block never blanks the section */ }
    return section('fitness', safeRows((fab ? fab.rows : []).concat([
      function () { var m = R.vo2max; return m ? mrow('vo2max', TR.vo2max.title, TR.vo2max.unit, { value: m.latest, delta: fin(m.first) ? round(m.latest - m.first, 1) : null, dir: 1, date: m.latestDate, detail: 'vo2max' }) : ''; },
      signalRow(R, 'walkingHr', -1, false),
    ])), fab ? [fab.note, T.fitnessNoteHtml] : [T.fitnessNoteHtml], fab ? fab.before : '');
  }
  /* sleep: last night vs the 30-night mean, then the consistency rows; the section is hl-sleep */
  function sleepSection(sl: any): string {
    var TR = T.trend, SCd = T.sleepCards;
    return section('sleep', safeRows([
      // an in-bed-only night (lib/health/aggregate.mjs latestEstimated) says so next to its value
      function () { return mrow('sleep', TR.sleep.title, TR.sleep.unit, { value: sl.latest, base: sl.avg, baseTpl: T.avgNightsTpl, dir: 1, date: sl.latestDate, detail: 'sleep', when: sl.latestEstimated ? SCd.estimated : '' }); },
      function () { return fin(sl.pctTarget) ? mrow('sleep', format(SCd.nightsTargetLbl, { target: HC.hours(sl.target) }), '%', { icon: 'vsTarget', value: sl.pctTarget, detail: 'sleep' }) : ''; },
      function () { return fin(sl.sd) ? mrow('sleep', SCd.sdLbl, 'h', { icon: 'cons', value: sl.sd, text: '±' + HC.hours(sl.sd), detail: 'sleep' }) : ''; },
      function () { return sl.bedtime ? mrow('sleep', SCd.bedtimeLbl, '', { icon: 'bed', value: 0, text: sl.bedtime, sub: '±' + sl.bedtimeSd + '′', detail: 'sleep' }) : ''; },
      function () { return sl.wake ? mrow('sleep', SCd.wakeLbl, '', { icon: 'wake', value: 0, text: sl.wake, sub: '±' + sl.wakeSd + '′', detail: 'sleep' }) : ''; },
    ].concat(stageRows(sl.stages, SCd))), [T.sleepNoteHtml].concat(sl.stages && T.sleepStagesNoteHtml ? [T.sleepStagesNoteHtml] : [],
      sl.estimatedNights ? [format(T.sleepEstimatedNoteHtml, { count: sl.estimatedNights })] : []));
  }
  /* body composition: weight Δ vs ~30 days ago, body fat / lean mass Δ in their scale window, waist */
  function bodySection(B: any): string {
    var TB = T.trend;
    var bcPts = function (k: string) { var m = B[k]; return m && m.windowPoints != null && m.windowDays != null ? '<b>' + TB[k].title + '</b>: ' + esc(format(T.bodyCompPointsTpl, { n: m.windowPoints, days: m.windowDays })) : ''; };
    var wsrc = B.weight ? B.weight.source : '', bsrc = B.bodyfat ? B.bodyfat.source : '';
    var sourcesClause = B.weight ? format(T.bodyNote.sourcesClause, { n: B.weight.sources }) : '';
    var wsrcClause = wsrc ? format(T.bodyNote.sourceClause, { src: esc(wsrc) }) : '';
    var bsrcClause = bsrc ? format(T.bodyNote.sourceClause, { src: esc(bsrc) }) : '';
    var bodyNotes = [format(T.bodyNote.main, { sourcesClause: sourcesClause, sourceClause: wsrcClause, bfSourceClause: bsrcClause }), bcPts('bodyfat'), bcPts('lean'),
      B.waist ? format(T.waist.noteTpl, { n: B.waist.points, first: esc(fmtD(B.waist.firstDate)) }) : T.waist.emptyHtml];
    var bc = function (k: string, dir: number): RowFn {
      return function () { var m = B[k]; return m ? mrow(k, TB[k].title, TB[k].unit, { value: m.latest, delta: k === 'weight' ? m.d30 : m.delta, deltaUnit: TB[k].deltaUnit, dir: dir, date: m.latestDate, detail: k }) : ''; };
    };
    return section('body', safeRows([bc('weight', 0), bc('bodyfat', -1), bc('lean', 1),
      function () { var w = B.waist; return w ? mrow('waist', T.waist.title, T.waist.unit, { value: w.latest, delta: w.delta, deltaUnit: T.waist.deltaUnit, dir: -1, date: w.latestDate, when: fmtD(w.latestDate), noStale: true, detail: 'waist' }) : ''; },
    ]), bodyNotes);
  }
  /* activity / NEAT: the latest day vs its 30-day average (today = so far, no arrow) */
  function activitySection(A: any): string {
    return section('activity', safeRows(['steps', 'exercise', 'distance', 'flights'].map(function (k) {
      return function () { var a = A[k], tt = T.trend[k]; return a ? mrow(k, tt.title, tt.unit, { value: a.latest, base: a.avg30, dir: 1, date: a.latestDate, soFar: true, detail: k }) : ''; };
    })), [T.activityNoteHtml]);
  }
  /* energy: expenditure (TDEE) only; the intake balance + macro split are Nutrición's Balance
     (renderBalance); every caveat sits behind ⓘ */
  function energySection(E: any): string {
    var en: string[] = [];
    // a power-meter ride day (lib/health/ride-energy.mjs): the headline day's active energy was corrected
    if (T.energyRide && E.latestCorrected) en.push(esc(T.energyRide.latest));
    else if (T.energyRide && E.latestUncovered) en.push(esc(T.energyRide.uncovered));
    if (E.correctedDays > 0 && T.energyRide) en.push(format(T.energyRide.days, { n: E.correctedDays }));
    if (E.uncoveredDays > 0 && T.energyRide) en.push(format(T.energyRide.uncoveredDays, { n: E.uncoveredDays }));
    en.push(format(T.energyTdeeNote, { tdeeDays: E.tdeeDays }));
    return section('energy', safeRows([function () {
      return E.tdeeLatest != null ? mrow('energy', T.trend.expenditure.title, T.trend.expenditure.unit, { value: E.tdeeLatest, base: E.tdeeAvg, dir: 0, date: E.tdeeLatestDate, soFar: true, detail: 'energy' }) : '';
    }]), en);
  }

  function renderSalud(host: HTMLElement): void {
    var B = HEALTH.body || {}, A = HEALTH.activity || {}, E = HEALTH.energy || {}, R = HEALTH.recovery || {};
    var SC = typeof SCORES === 'undefined' || !SCORES ? null : SCORES;
    var recScore = !!(SC && SC.recovery);
    if (!B.hasData && !A.hasData && !E.hasData && !R.hasData && !recScore) {
      host.innerHTML = '<div class="train-empty">' + T.emptyMsg + '</div>';
      return;
    }
    var out: string[] = [];
    try { out.push(habitsSection(SC)); } catch (e) { /* a broken habits card never blanks the tab */ }
    if (R.hasData || recScore) out.push(recoverySection(R, SC));
    if (R.hasData) {
      out.push(fitnessSection(R, SC));
      if (R.sleep) out.push(sleepSection(R.sleep));
    }
    if (B.hasData) out.push(bodySection(B));
    if (A.hasData) out.push(activitySection(A));
    if (E.hasData) out.push(energySection(E));
    host.innerHTML = out.join('');
  }

  // Nutrición → Balance (HEALTH.energy, lib/health/aggregate.mjs aggEnergy): the intake average vs the
  // expenditure average over ONE fixed window (the paired days of the last BALANCE_WINDOW, anchored to
  // the newest expenditure day; the bake has no other period, so no W / M / 6M), labelled by its dates,
  // as metric rows (avg intake, avg burn -> the expenditure sheet, deficit / surplus a day), then the
  // average macro split as one stacked bar (Entreno's modality bar) with a counted legend. The window
  // and "historical" caveat sit behind ⓘ. Too few logged days -> a short empty line, the why behind ⓘ.
  // No expenditure at all -> '' (the host hides).
  var MACROS: string[][] = [['p', 'p', 'proteinLbl'], ['c', 'c', 'carbsLbl'], ['f', 'g', 'fatLbl']];
  function renderBalance(): string {
    var E = HEALTH.energy || {}, TB = T.balance;
    if (!E.hasData || !TB) return '';
    var b = E.balance, m = b ? E.macros : null, notes: string[] = [], body;
    if (b) {
      notes.push(format(T.energyBalanceNote.main, { from: esc(fmtD(b.from)), to: esc(fmtD(b.to)), days: b.days, macroClause: m ? T.energyBalanceNote.macroClause : '' }));
      var u = T.trend.expenditure.unit;
      var net = (b.net < 0 ? '' : '+') + nf(b.net), netLbl = b.net < 0 ? TB.deficitLbl : TB.surplusLbl;
      body = '<p class="nb-win">' + esc(format(TB.winTpl, { from: fmtD(b.from), to: fmtD(b.to), days: b.days })) + '</p><ul class="db-list">' +
        HC.metricRow({ key: 'food', name: TB.intakeLbl, value: nf(b.intakeAvg), unit: u }) +
        HC.metricRow({ key: 'energy', attrs: HC.detailAttrs('energy'), name: TB.burnLbl, value: nf(b.tdeeAvg), unit: u }) +
        HC.metricRow({ key: 'balance', name: netLbl, value: net, unit: u }) + '</ul>' +
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
  function splitHtml(m: any): string {
    var TB = T.balance, pcts: Record<string, number> = { p: m.pPct, c: m.cPct, f: m.gPct };
    var sum = pcts.p + pcts.c + pcts.f;
    if (!(sum > 0)) return '';
    var x = 0, segs: string[] = [], items: string[] = [], aria: string[] = [];
    MACROS.forEach(function (k) {
      var w = 100 * pcts[k[0]] / sum, name = TB[k[2]], g = m[k[1]];
      segs.push('<rect class="nb-m-' + k[0] + '" x="' + x.toFixed(2) + '" y="0" width="' + w.toFixed(2) + '" height="8"/>');
      x += w;
      items.push('<li><span class="act-sw nb-m-' + k[0] + '" aria-hidden="true"></span><b>' + esc(nf(g)) + ' g</b> ' + esc(name) + ' <small>' + HC.pct(pcts[k[0]]) + '</small></li>');
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
  function renderEntreno(train: HTMLElement): void {
    var Run = HEALTH.running || {}, LR = HEALTH.loadRecovery || {}, Cyc = HEALTH.cycling || {};
    if (!Run.hasData && !Cyc.hasData && !LR.hasData) {
      train.innerHTML = '<div class="train-empty">' + T.trainEmptyMsg + '</div>';
      return;
    }
    var out: string[] = [];
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
      var s = LR.series, lmax = Math.max.apply(null, s.map(function (x: any) { return x.load; })) || 1;
      var lbars = s
        .map(function (x: any) {
          var h = Math.round((100 * x.load) / lmax);
          // the reference's trend bars: the week's value on top, the bar in a fixed-height track
          return '<div class="wbar' + (x.load ? '' : ' zero') + '" title="' + esc(format(T.loadSec.barTitleTpl, { date: fmtD(x.w), load: x.load })) + '">' +
            '<span class="wbar-v">' + esc(nf(x.load)) + '</span><span class="wbar-t"><i style="height:' + h + '%"></i></span></div>';
        })
        .join('');
      var lax = '<div class="waxis"><span>' + esc(fmtD(s[0].w)) + '</span><span>' + esc(fmtD(s[s.length - 1].w)) + '</span></div>';
      var bars = '<div class="lvr-card"><span class="dt-trend-lbl">' + esc(T.loadSec.heading) + '</span><div class="wbars">' + lbars + '</div>' + lax + '</div>';
      var rows: string[] = [];
      var sp: { hrvHigh?: number | null; hrvLow?: number | null; rhrHigh?: number | null; rhrLow?: number | null } = LR.split || {};
      var C = T.loadCards;
      if (sp.hrvHigh != null && sp.hrvLow != null) rows.push(splitRow('hrv', C.hrvHighLbl, C.hrvLowLbl, sp.hrvHigh, sp.hrvLow, 'ms', 1));
      if (sp.rhrHigh != null && sp.rhrLow != null) rows.push(splitRow('rhr', C.rhrHighLbl, C.rhrLowLbl, sp.rhrHigh, sp.rhrLow, T.trend.rhr.unit, -1));
      out.push(section('load', rows, [format(T.loadSec.hint, { weeks: LR.weeks }), T.loadNoteHtml], bars));
    }
    train.innerHTML = out.join('');
  }
  // one higher-load vs easy weeks row: the higher-load value, the easy one as the small line
  function splitRow(icon: string, name: string, easyName: string, high: number, low: number, unit: string, dir: number): string {
    var arrow = high === low ? 'flat' : high > low ? 'up' : 'down';
    var tone = arrow === 'flat' ? 'flat' : (arrow === 'up') === (dir > 0) ? 'good' : 'bad';
    var easy = format(T.loadCards.easyTpl, { value: nf(low) + ' ' + unit });
    return HC.metricRow({ key: icon, name: name, value: nf(high), unit: unit, arrow: arrow, tone: tone, base: easy,
      sr: parts([easyName + ': ' + nf(low) + ' ' + unit, T.dirs ? T.dirs[arrow] : '']) });
  }

  render();

  // the Salud title's ⓘ (tabs/Salud.astro leaves a slot): the one shared button markup, HC.infoBtn
  var introSlot = document.getElementById('hs-intro-i');
  if (introSlot) introSlot.innerHTML = HC.infoBtn('hs-intro', introSlot.getAttribute('data-label') || '');

  // ⓘ toggles of Salud (the monitor list, client/monitor.ts, and each section): a button
  // [data-hs-info="<id>"] shows / hides the block #<id> in place and mirrors it in aria-expanded.
  // One delegated listener for the page; the block stays in the DOM (hidden), so its text is never lost.
  function toggleInfo(btn: Element): void {
    var id = btn.getAttribute('data-hs-info'), box = id && document.getElementById(id);
    if (!box) return;
    box.hidden = !box.hidden;
    btn.setAttribute('aria-expanded', box.hidden ? 'false' : 'true');
  }
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', function (e) {
      var t = e && (e.target as Element | null);
      var btn = t && typeof t.closest === 'function' ? t.closest('[data-hs-info]') : null;
      if (btn) toggleInfo(btn);
    });
  }
})();
