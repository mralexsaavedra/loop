/* Entreno: 30-day activity calendar + cumulative training time (last 30 days vs the previous 30),
 * rendered from ACTIVITY (lib/training/activity.mjs) + I18N_ACTIVITY, both baked by
 * tabs/TrainingDetail.astro.
 *
 * Classic script (is:inline, no module scope). ACTIVITY holds one entry per active day of the last
 * 63 data days; both windows end HERE at the viewer's today (from Date.now(), never baked, so builds
 * stay byte-identical) — or at the data's own date when that is more than STALE_DAYS old, greyed
 * with a note. Colour = one sequential hue (--strain, via .cal-l1…4 in training.css) for total
 * minutes; every cell and chart day carries an SVG <title> for hover. Geometry lives in attributes
 * (no inline styles). A throw renders the empty state, never a blank tab.
 */
(function () {
  var host = document.getElementById('train-activity');
  if (!host) return;
  var A = typeof ACTIVITY === 'undefined' ? null : ACTIVITY;
  var T = typeof I18N_ACTIVITY === 'undefined' ? null : I18N_ACTIVITY;
  if (!T) return;
  var WINDOW = 30;
  var STALE_DAYS = 3;
  var MS_PER_DAY = 86400000;
  // total-minute level cuts: < 30, 30–59, 60–89, 90+ (a "session" is ~45–75 min)
  var LEVEL_MIN = [1, 30, 60, 90];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function format(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) {
      return vars && vars[k] != null ? vars[k] : '';
    });
  }
  function hm(min) {
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min';
  }
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parse(s) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function shift(s, n) {
    var d = parse(s);
    d.setDate(d.getDate() + n);
    return iso(d);
  }
  function level(min) {
    var l = 0;
    LEVEL_MIN.forEach(function (cut, i) { if (min >= cut) l = i + 1; });
    return l;
  }

  function calendar(dates, byDate) {
    var CELL = 16, GAP = 4, STEP = CELL + GAP, HEAD = 14;
    var offset = (parse(dates[0]).getDay() + 6) % 7; // Monday = 0
    var rows = Math.ceil((offset + dates.length) / 7);
    var out = ['<svg class="cal-svg" viewBox="0 0 ' + (7 * STEP - GAP) + ' ' + (HEAD + rows * STEP - GAP) + '" role="img" aria-label="' + esc(T.calAria) + '">'];
    T.weekdays.forEach(function (w, i) {
      out.push('<text class="cal-wd" x="' + (i * STEP + CELL / 2) + '" y="10" text-anchor="middle">' + esc(w) + '</text>');
    });
    dates.forEach(function (date, i) {
      var k = offset + i, d = byDate[date];
      var min = d ? d.min : 0;
      var mods = d ? Object.keys(d.mods).map(function (m) { return (T.modalityLabels[m] || m) + ' ' + hm(d.mods[m]); }).join(', ') : '';
      var title = min > 0 ? format(T.cellTitle, { date: date, time: hm(min) }) + (Object.keys(d.mods).length > 1 ? ' (' + mods + ')' : '') : format(T.cellRest, { date: date });
      out.push('<rect class="cal-cell cal-l' + level(min) + '" x="' + ((k % 7) * STEP) + '" y="' + (HEAD + Math.floor(k / 7) * STEP) + '" width="' + CELL + '" height="' + CELL + '" rx="4"><title>' + esc(title) + '</title></rect>');
    });
    out.push('</svg>');
    return out.join('');
  }

  function cumulative(cur, prev) {
    var W = 300, H = 110, PAD = 6;
    var max = Math.max(cur[cur.length - 1], prev[prev.length - 1]) || 1;
    function pts(v) {
      return v.map(function (y, i) {
        return (PAD + (W - 2 * PAD) * i / (v.length - 1)).toFixed(1) + ',' + (PAD + (H - 2 * PAD) * (1 - y / max)).toFixed(1);
      });
    }
    var out = ['<svg class="cum-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(format(T.cumAria, { cur: hm(cur[cur.length - 1]), prev: hm(prev[prev.length - 1]) })) + '">'];
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
    var today = iso(new Date(Date.now()));
    var age = Math.round((parse(today) - parse(A.asOf)) / MS_PER_DAY);
    var stale = age > STALE_DAYS;
    var end = stale ? A.asOf : today;
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
      '<div class="dash-sec"><h3>' + esc(T.calHeading) + '</h3><p class="hint">' + esc(format(T.calHint, { days: active })) + '</p>' +
      calendar(dates, byDate) + '<div class="cal-legend">' + legend + '</div></div>' +
      '<div class="dash-sec"><h3>' + esc(T.cumHeading) + '</h3><p class="hint">' + esc(T.cumHint) + '</p>' +
      '<div class="cum-legend"><span class="cum-key"><span class="cum-sw cum-cur"></span>' + esc(T.cur) + ' <b>' + esc(hm(cur[cur.length - 1])) + '</b></span>' +
      '<span class="cum-key"><span class="cum-sw cum-prev"></span>' + esc(T.prev) + ' <b>' + esc(hm(prev[prev.length - 1])) + '</b></span></div>' +
      cumulative(cur, prev) + '</div>' +
      '<div class="dash-note">' + esc(T.note) + '</div></div>';
  }

  try {
    host.innerHTML = html();
  } catch (e) {
    host.innerHTML = '<div class="train-empty">' + T.empty + '</div>';
  }
})();
