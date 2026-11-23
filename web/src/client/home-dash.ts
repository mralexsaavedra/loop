/* Inicio "My dashboard" (#my-dash, after "My plan"): a stack of single-row metric cards (60px) — icon ·
 * UPPERCASE full metric name (I18N_SCORE.home.dash.names, else the sheet's title) · the latest value
 * (22px, the unit at half that) on the right, the 30-day baseline under it and an arrow vs that
 * baseline (▲▼ --up better / --down worse by the metric's good direction, --ink for a neutral metric (HC.trendTone),
 * a grey dot when within ±FLAT_SHARE). Only metrics present in the baked DETAIL (lib/detail/detail.mjs);
 * the same series, titles and units as the detail sheet (I18N_DETAIL), so nothing new is computed
 * beyond the baseline mean. A row opens that metric's detail sheet.
 *
 * Value = the newest day with data up to the viewer's today (a daily total skips today, still filling
 * up, and so does day strain); baseline = the mean of the BASE_DAYS (30) days before that day, with at least MIN_BASE (7) days
 * of data (MIN_BASE_SPARSE (2) readings for a sparse series such as weight); no baseline → no arrow.
 *
 * "Customize ✎" opens a registered sheet ('dash-edit', client/detail.js modal) to show / hide and move
 * rows: the shared HC.orderList (client/util.js) — the switch, ↑ / ↓ and the ≡ drag; preferences in
 * localStorage (PREFS_KEY) as {order, hidden}, working the same without storage (in memory).
 *
 * Module script (bundled into the page, docs/plan-page.md → Module scripts) in layouts/Plan.astro's end-of-body list, right after client/home-week.ts and before
 * detail.js (its `dash-edit` sheet is registered before detail.js runs); its own try/catch hides the section on a throw. */
import { fin } from '../../../lib/nutrition/num.mjs';
import type { PageGlobals } from './page-globals';

// the page globals this script reads (baked by the build or provided by an earlier script; manifest.mjs)
declare const HC: PageGlobals['HC'];
declare const DETAIL: PageGlobals['DETAIL'];
declare const SCORES: PageGlobals['SCORES'];
declare const I18N_SCORE: PageGlobals['I18N_SCORE'];
declare const I18N_DETAIL: PageGlobals['I18N_DETAIL'];

/** A DETAIL metric (lib/detail/detail.mjs): a daily series from `start`, plus the row's display hints. */
type Metric = { start: string; v: (number | null)[]; week?: unknown; kind?: string; dir?: number; lo?: number; hi?: number; dec?: number };
type Arrow = 'up' | 'down' | 'flat';
type Tone = 'good' | 'bad' | 'flat';
/** One SCORES.stress day with a latest scored hour (`now`: value + hour clock). */
type StressDay = { date: string; now: { v: number; t: unknown }; hours: unknown };
type RowValue = { value: number; date: string; base: number | null; arrow: Arrow | null; tone: Tone };

(function () {
  function boot() {
    var TS = typeof I18N_SCORE !== 'undefined' && I18N_SCORE && I18N_SCORE.home ? I18N_SCORE.home.dash : null;
    var TD = typeof I18N_DETAIL !== 'undefined' && I18N_DETAIL ? I18N_DETAIL : null;
    var D = typeof DETAIL !== 'undefined' && DETAIL && DETAIL.metrics ? DETAIL : null;
    if (!TS || !TD || typeof HC === 'undefined') return;
    var esc = HC.esc, format = HC.format;
    // 'stress' is the one chart card (the reference dashboard's stress monitor), from SCORES.stress
    var CATALOG = ['rhr', 'hrv', 'sleep', 'weight', 'steps', 'vo2max', 'fitnessAge', 'walkingHr', 'exercise',
      'energy', 'strain', 'respiratory', 'wristTemp', 'bodyfat', 'waist', 'zones13', 'zones45', 'gymTime', 'stress'];
    var DEFAULT_ON = ['rhr', 'hrv', 'sleep', 'weight', 'steps', 'stress'];
    var PREFS_KEY = 'hc-dash-v1';
    var BASE_DAYS = 30, MIN_BASE = 7, MIN_BASE_SPARSE = 2, FLAT_SHARE = 0.02;
    // a weekly metric (DETAIL `week`): the last WEEK full days' total, a week counted with WEEK_MIN days
    // of data; its baseline = the mean of up to BASE_WEEKS earlier weekly totals, at least MIN_WEEKS of them
    var WEEK = 7, WEEK_MIN = 5, BASE_WEEKS = 4, MIN_WEEKS = 2;

    function own(o: unknown, k: string): boolean {
      return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
    }

    /* ---------- pure: one row's numbers ---------- */
    function at(m: Metric, iso: string): number | null {
      var i = HC.dayDiff(m.start, iso);
      var v = i >= 0 && i < m.v.length ? m.v[i] : null;
      return fin(v) ? v : null;
    }
    // the arrow + tone of a value vs its baseline (null baseline = no arrow)
    function arrowOf(m: Metric, value: number, base: number | null): { arrow: Arrow | null; tone: Tone } {
      var arrow: Arrow | null = null, tone: Tone = 'flat';
      if (base != null) {
        var rel = base ? (value - base) / Math.abs(base) : value - base;
        arrow = Math.abs(rel) < FLAT_SHARE ? 'flat' : rel > 0 ? 'up' : 'down';
        if (arrow !== 'flat' && m.dir) tone = (arrow === 'up') === (m.dir > 0) ? 'good' : 'bad';
      }
      return { arrow: arrow, tone: tone };
    }
    // the total of the WEEK days ending at `last` -> null (under WEEK_MIN days with data) | {sum, date}
    function weekSum(m: Metric, last: string): { sum: number; date: string } | null {
      var sum = 0, n = 0, date: string | null = null;
      for (var k = 0; k < WEEK; k++) {
        var d = HC.shiftIso(last, -k), v = at(m, d);
        if (v != null) { sum += v; n++; if (!date) date = d; }
      }
      return n >= WEEK_MIN ? { sum: sum, date: date as string } : null;
    }
    // a weekly metric: the last WEEK full days (today still fills up) vs the earlier weeks' mean
    function weekValue(m: Metric, today: string): RowValue | null {
      var last = HC.shiftIso(today, -1), cur = weekSum(m, last);
      if (!cur) return null;
      var s = 0, n = 0;
      for (var w = 1; w <= BASE_WEEKS; w++) {
        var p = weekSum(m, HC.shiftIso(last, -WEEK * w));
        if (p) { s += p.sum; n++; }
      }
      var base = n >= MIN_WEEKS ? s / n : null, a = arrowOf(m, cur.sum, base);
      return { value: cur.sum, date: cur.date, base: base, arrow: a.arrow, tone: a.tone };
    }
    // m: a DETAIL metric, today: the viewer's ISO day -> null | {value, date, base, arrow, tone}
    function rowValue(m: Metric | null | undefined, today: string): RowValue | null {
      if (!m || !Array.isArray(m.v) || !HC.isoDate(m.start) || !HC.isoDate(today)) return null;
      if (m.week) return weekValue(m, today);
      // today's total (and today's strain) is still filling up: the last full day
      var end = m.kind === 'total' || m.kind === 'strain' ? HC.shiftIso(today, -1) : today;
      var date: string | null = null;
      for (var d = end, k = 0; d >= m.start && k < m.v.length + 400; d = HC.shiftIso(d, -1), k++) {
        if (at(m, d) != null) { date = d; break; }
      }
      if (!date) return null;
      var value = at(m, date) as number, s = 0, n = 0;
      for (var j = 1; j <= BASE_DAYS; j++) {
        var b = at(m, HC.shiftIso(date, -j));
        if (b != null) { s += b; n++; }
      }
      var base = n >= (m.kind === 'sparse' ? MIN_BASE_SPARSE : MIN_BASE) ? s / n : null, a = arrowOf(m, value, base);
      return { value: value, date: date, base: base, arrow: a.arrow, tone: a.tone };
    }

    /* ---------- render ---------- */
    function icon(key: string): string {
      return HC.metricIcon(key); // the shared row icons (client/util.js)
    }
    // the row's full name (TS.names: "Resting heart rate"), else the detail sheet's title
    function titleOf(key: string): string {
      if (own(TS.names, key)) return TS.names[key];
      return own(TD.metrics, key) && TD.metrics[key].title ? TD.metrics[key].title : key;
    }
    function unitOf(key: string): string {
      return own(TD.metrics, key) && TD.metrics[key].unit ? TD.metrics[key].unit : '';
    }
    function fmt(key: string, m: Metric, v: number): string {
      if (key === 'sleep') return HC.hours(v); // hours → 7:32
      if (m.week) return HC.hours(v / 60); // a weekly total of minutes → 2:22
      if (key === 'fitnessAge') { // whole years; a value at the reference curve's clamp = that age or beyond
        if (fin(m.lo) && v <= m.lo) return '≤ ' + m.lo;
        if (fin(m.hi) && v >= m.hi) return '≥ ' + m.hi;
        return HC.num(v, 0);
      }
      return HC.num(v, m.dec || 0);
    }
    function rowHtml(key: string, m: Metric, r: RowValue): string {
      var unit = key === 'sleep' || m.week ? '' : unitOf(key);
      var stale = HC.daysOld(r.date) > HC.STALE_DAYS;
      // named by its content (name + value); the date, the 30-day average and the trend in words after them
      var sr = [HC.fmtDate(r.date)].concat(r.base != null ? [format(TS.baseAria, { base: fmt(key, m, r.base) + (unit ? ' ' + unit : '') }), TS.dirs[r.arrow as Arrow]] : []).join(' · ');
      return HC.metricRow({ key: key, cls: stale ? 'db-stale' : '', attrs: HC.detailAttrs(key), sr: sr, name: titleOf(key), value: fmt(key, m, r.value), unit: unit,
        arrow: r.arrow, tone: r.tone, base: r.base != null ? fmt(key, m, r.base) : null });
    }
    // the stress card's day: the newest with a latest scored hour (as Inicio's stress tile, client/monitor.ts)
    function stressDay() {
      var S = typeof SCORES !== 'undefined' && SCORES && SCORES.stress && SCORES.stress.ok && Array.isArray(SCORES.stress.days) ? SCORES.stress : null;
      if (!S) return null;
      for (var i = S.days.length - 1; i >= 0; i--) if (S.days[i] && S.days[i].now) return S.days[i];
      return null;
    }
    function stressCard(d: StressDay): string {
      var P = TD.deep.stress, n = d.now, band = HC.stressBand(n.v), time = String(n.t).slice(0, 2) + ':00';
      var value = HC.num(n.v, 1), when = format(P.updated, { time: time }) + (d.date !== HC.todayIso() ? ' · ' + HC.fmtDate(d.date) : '');
      // the button role on an inner <div>: the <li> stays a list item of the dashboard list; named by its content
      // (WCAG 2.5.3 Label in Name): "Stress monitor Latest hour 23:00 Low 0.4" (the chart is decorative)
      return '<li><div class="db-card db-stress ds-' + band + '"' + HC.detailAttrs('stress', d.date) + '>' +
        // the chevron is the shared opener's (base.css [data-detail][role=button]:after)
        '<div class="db-card-head"><span class="db-card-t">' + esc(titleOf('stress')) + '</span></div>' +
        '<div class="db-card-sub"><span class="db-card-when">' + esc(when) + '</span><span><span class="ds-band">' + esc(P.bands[band]) + '</span><b class="db-card-v">' + esc(value) + '</b></span></div>' +
        HC.stressChart(d.hours, P, function (v: number, dec: number) { return HC.num(v, dec); }, true) + '</div></li>';
    }
    function available() {
      var out = D ? CATALOG.filter(function (k) { return own(D.metrics, k) && D.metrics[k] && Array.isArray(D.metrics[k].v); }) : [];
      if (stressDay()) out.push('stress');
      return out;
    }
    function renderDash() {
      var sec = document.getElementById('my-dash'), host = document.getElementById('home-dash');
      if (!sec || !host) return;
      try {
        var today = HC.todayIso(), rows: string[] = [];
        var list = current();
        list.forEach(function (p: { key: string; on: boolean }) {
          if (!p.on) return;
          if (p.key === 'stress') { var sd = stressDay(); if (sd) rows.push(stressCard(sd)); return; }
          var m = D.metrics[p.key], r = rowValue(m, today);
          if (r) rows.push(rowHtml(p.key, m, r));
        });
        host.innerHTML = rows.length ? '<ul class="db-list">' + rows.join('') + '</ul>' : '<p class="db-empty">' + esc(TS.empty) + '</p>';
        // the section shows whenever a metric exists, so "Customize" can bring a hidden row back
        sec.hidden = !list.length;
      } catch (e) {
        host.innerHTML = '';
        sec.hidden = true;
      }
    }

    // the customize sheet (HC.orderList, client/util.js): one row per available metric — show / hide, up,
    // down, drag. The row shows the SHORT name (the trend sheet's title: "HRV", "Resting HR"), so it fits
    // 1-2 lines at 360 px beside its controls; the full name stays in the buttons' accessible names.
    function shortOf(key: string): string {
      return own(TD.metrics, key) && TD.metrics[key].title ? TD.metrics[key].title : titleOf(key);
    }
    var OL = HC.orderList({
      view: 'dash-edit', attr: 'dash', key: PREFS_KEY, catalog: CATALOG, defaultOn: DEFAULT_ON, available: available,
      title: function () { return TS.editTitle; },
      row: function (key: string) { return { icon: icon(key), name: shortOf(key), full: titleOf(key) }; },
      aria: { show: TS.showAria, up: TS.upAria, down: TS.downAria },
      changed: function () { renderDash(); },
    });
    HC.registerView('dash-edit', OL.sheet);
    function current() {
      return OL.current();
    }

    window.HCDash = { prefsFrom: OL.prefsFrom, serialize: OL.serialize, edit: OL.edit, move: OL.move, rowValue: rowValue, render: renderDash, CATALOG: CATALOG, DEFAULT_ON: DEFAULT_ON, PREFS_KEY: PREFS_KEY };
    renderDash();
  }
  boot();
})();
