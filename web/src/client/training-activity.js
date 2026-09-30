/* Entreno: 30-day activity calendar + cumulative training time (last 30 days vs the previous 30),
 * rendered from ACTIVITY (lib/training/activity.mjs) + I18N_ACTIVITY, both baked by
 * tabs/TrainingDetail.astro.
 *
 * Classic script (is:inline, no module scope). ACTIVITY holds one entry per active day of the last
 * 63 data days; both windows end HERE at the viewer's today (from Date.now(), never baked, so builds
 * stay byte-identical) — or at the data's own date when that is more than STALE_DAYS old (greyed
 * with a note) or AFTER the viewer's today (clock / timezone skew: its sessions stay visible). Colour = one sequential hue (--strain, via .cal-l1…4 in training.css) for total
 * minutes; every cell and chart day carries an SVG <title> for hover. Geometry lives in attributes
 * (no inline styles). A throw renders the empty state, never a blank tab. Both blocks open the
 * training-time detail sheet (HC.detailAttrs -> client/detail.js); a tap on a day cell opens that day.
 */
(function () {
  var host = document.getElementById('train-activity');
  if (!host) return;
  var A = typeof ACTIVITY === 'undefined' ? null : ACTIVITY;
  var T = typeof I18N_ACTIVITY === 'undefined' ? null : I18N_ACTIVITY;
  if (!T) return;
  // calendar geometry (SVG user units): square cells with a gap, a weekday header row on top
  var CAL_CELL = 16, CAL_GAP = 4, CAL_STEP = CAL_CELL + CAL_GAP, CAL_HEAD = 14, CAL_WD_Y = 10, CAL_RX = 4;
  // cumulative chart geometry: viewBox width / height and the inner padding
  var CUM_W = 300, CUM_H = 110, CUM_PAD = 6;
  // shared helpers (web/src/client/util.js); window and level cuts are baked in ACTIVITY
  var esc = HC.esc, format = HC.format, shift = HC.shiftIso, parse = HC.parseIso;

  function hm(min) {
    return HC.duration(min, T.units);
  }
  function level(min, cuts) {
    var l = 0;
    cuts.forEach(function (cut, i) { if (min >= cut) l = i + 1; });
    return l;
  }

  function calendar(dates, byDate) {
    var CELL = CAL_CELL, GAP = CAL_GAP, STEP = CAL_STEP, HEAD = CAL_HEAD;
    var offset = (parse(dates[0]).getDay() + 6) % 7; // Monday = 0
    var rows = Math.ceil((offset + dates.length) / 7);
    var out = ['<svg class="cal-svg" viewBox="0 0 ' + (7 * STEP - GAP) + ' ' + (HEAD + rows * STEP - GAP) + '" role="img" aria-label="' + esc(T.calAria) + '">'];
    T.weekdays.forEach(function (w, i) {
      out.push('<text class="cal-wd" x="' + (i * STEP + CELL / 2) + '" y="' + CAL_WD_Y + '" text-anchor="middle">' + esc(w) + '</text>');
    });
    dates.forEach(function (date, i) {
      var k = offset + i, d = byDate[date];
      var min = d ? d.min : 0;
      var mods = d ? Object.keys(d.mods).map(function (m) { return (T.modalityLabels[m] || m) + ' ' + hm(d.mods[m]); }).join(', ') : '';
      var title = min > 0 ? format(T.cellTitle, { date: date, time: hm(min) }) + (Object.keys(d.mods).length > 1 ? ' (' + mods + ')' : '') : format(T.cellRest, { date: date });
      out.push('<rect class="cal-cell cal-l' + level(min, A.levelMin) + '"' + HC.detailAttrs('workouts', date, { plain: true }) + ' x="' + ((k % 7) * STEP) + '" y="' + (HEAD + Math.floor(k / 7) * STEP) + '" width="' + CELL + '" height="' + CELL + '" rx="' + CAL_RX + '"><title>' + esc(title) + '</title></rect>');
    });
    out.push('</svg>');
    return out.join('');
  }

  function cumulative(cur, prev) {
    var W = CUM_W, H = CUM_H, PAD = CUM_PAD;
    var max = Math.max(cur[cur.length - 1], prev[prev.length - 1]) || 1;
    function pts(v) {
      return v.map(function (y, i) {
        return (PAD + (W - 2 * PAD) * i / (v.length - 1)).toFixed(1) + ',' + (PAD + (H - 2 * PAD) * (1 - y / max)).toFixed(1);
      });
    }
    var out = ['<svg class="cum-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(format(T.cumAria, { cur: hm(cur[cur.length - 1]), prev: hm(prev[prev.length - 1]) })) + '">'];
    out.push('<line class="cum-base" x1="' + PAD + '" y1="' + (H - PAD) + '" x2="' + (W - PAD) + '" y2="' + (H - PAD) + '"/>');
    out.push('<path class="cum-line cum-prev" d="M' + pts(prev).join(' L') + '"/>');
    out.push('<path class="cum-line cum-cur" d="M' + pts(cur).join(' L') + '"/>');
    var slot = (W - 2 * PAD) / cur.length;
    cur.forEach(function (v, i) {
      out.push('<rect class="cum-hit" x="' + (PAD + i * slot).toFixed(1) + '" y="0" width="' + slot.toFixed(1) + '" height="' + H + '"><title>' + esc(format(T.dayTitle, { n: i + 1, cur: hm(v), prev: hm(prev[i]) })) + '</title></rect>');
    });
    out.push('</svg>');
    return out.join('');
  }

  function html() {
    if (!A || !A.hasData || !Array.isArray(A.days)) return '<div class="train-empty">' + T.empty + '</div>';
    var today = HC.todayIso();
    var age = HC.daysOld(A.asOf);
    var stale = age > HC.STALE_DAYS;
    var WINDOW = A.windowDays;
    var end = stale || age < 0 ? A.asOf : today;
    var byDate = {};
    A.days.forEach(function (d) { byDate[d.date] = d; });
    var dates = [], prevDates = [];
    for (var i = WINDOW - 1; i >= 0; i--) {
      dates.push(shift(end, -i));
      prevDates.push(shift(end, -i - WINDOW));
    }
    var active = dates.filter(function (d) { return byDate[d] && byDate[d].min > 0; }).length;
    function cum(ds) {
      var s = 0;
      return ds.map(function (d) { s += byDate[d] ? byDate[d].min : 0; return s; });
    }
    var cur = cum(dates), prev = cum(prevDates);
    var legend = T.levels.map(function (lbl, l) {
      return '<span class="cal-legend-item"><span class="cal-legend-sw cal-l' + l + '"></span>' + esc(lbl) + '</span>';
    }).join('');
    return '<div class="act' + (stale ? ' act-stale' : '') + '">' +
      (stale ? '<p class="hint">' + esc(format(T.staleNote, { days: age, date: A.asOf })) + '</p>' : '') +
      '<div class="act-pair"><div class="dash-sec act-cal"' + HC.detailAttrs('workouts') + '><h3>' + esc(T.calHeading) + '</h3><p class="hint">' + esc(format(T.calHint, { days: active })) + '</p>' +
      calendar(dates, byDate) + '<div class="cal-legend">' + legend + '</div></div>' +
      '<div class="dash-sec act-cum"' + HC.detailAttrs('workouts') + '><h3>' + esc(T.cumHeading) + '</h3><p class="hint">' + esc(T.cumHint) + '</p>' +
      '<div class="cum-legend"><span class="cum-key"><span class="cum-sw cum-cur"></span>' + esc(T.cur) + ' <b>' + esc(hm(cur[cur.length - 1])) + '</b></span>' +
      '<span class="cum-key"><span class="cum-sw cum-prev"></span>' + esc(T.prev) + ' <b>' + esc(hm(prev[prev.length - 1])) + '</b></span></div>' +
      cumulative(cur, prev) + '</div></div>' +
      '<div class="dash-note">' + esc(T.note) + '</div></div>';
  }

  try {
    host.innerHTML = html();
  } catch (e) {
    host.innerHTML = '<div class="train-empty">' + T.empty + '</div>';
  }
})();
