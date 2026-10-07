/* "Hoy / Today" tab — today's PROGRAMMED training session. Ported
 * verbatim (same DOM contract, same three-branch empty-state logic) from
 * the legacy `<script>` IIFE of the pre-Astro generated page (deleted at
 * the astro-plan-web cutover), adapted to read TRAINING/TRAINING_META/LOCALE
 * from globals baked by web/src/components/Bake.astro instead of a
 * hand-typed JS literal, and
 * I18N_HOY (web/src/i18n/hoy-templates.mjs) instead of hardcoded English
 * strings — same "deliberate documented duplicate" pattern already used by
 * client/nutri-day.js (classic script, is:inline, no ES modules — see
 * spec: Single self-contained output).
 *
 * `esc()` is the browser idiom `document.createElement('div');
 * d.textContent=s; return d.innerHTML;` — escapes `&`/`<`/`>` from
 * untrusted training-data.json prose (focus/block titles/lines/meta),
 * per design's Trusted markup row ("training strings" are NOT trusted).
 * See web/test/dom-stub.mjs for the vm/test-time implementation of this
 * exact behavior.
 */
(function () {
  var goalLineRe = new RegExp(I18N_HOY.goalLineRe, 'i');

  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  // the ONE display-date formatter (util.js): "Tue 29 Sep" / "mar 29 sept"
  function fmtLong(isoStr) {
    return HC.fmtDate(isoStr);
  }
  function blockHtml(b) {
    var lines = b.lines
      .map(function (l) {
        return '<li' + (goalLineRe.test(l) ? ' class="goal"' : '') + '>' + esc(l) + '</li>';
      })
      .join('');
    var label = b.label ? '<span class="blabel">' + esc(b.label) + '</span>' : '';
    return '<div class="train-block"><div class="train-block-top">' + label + '<h3>' + esc(b.title) + '</h3></div><ul>' + lines + '</ul></div>';
  }
  // Inicio shows the programmed session as a row of "Today's activities" (client/timeline.js reads
  // window.HCProgram) and opens this markup as a registered detail view ('hoy-session', client/detail.js);
  // #sec-hoy is a hidden source, and page.hideTabs ["hoy"] (the section `hidden`) turns both off.
  function expose(today, s, host) {
    if (typeof window === 'undefined') return;
    var sec = document.getElementById('sec-hoy');
    var on = !!(s && sec && !sec.hidden);
    window.HCProgram = on ? { date: today, kind: s.kind || 'gym', focus: String(s.focus || '') } : null;
    if (!on) return;
    var views = window.HCViews = window.HCViews || {};
    views['hoy-session'] = {
      title: function () { return I18N_HOY.viewTitle; },
      render: function () { return { head: '', body: host.innerHTML }; },
    };
  }
  function render() {
    var host = document.getElementById('train-today');
    if (!host) return;
    var today = iso(new Date());
    var s = TRAINING[today];
    expose(today, s, host);
    var meta = TRAINING_META.program
      ? '<p class="train-meta">' + esc(TRAINING_META.program) + (TRAINING_META.coach ? ' · ' + esc(TRAINING_META.coach) : '') + '<br>' + I18N_HOY.sourceLabel + ' ' + esc(TRAINING_META.source) + '</p>'
      : '';
    var head = '<div class="train-head"><div class="train-day">' + esc(fmtLong(today)) + '</div>';
    if (s) {
      head += '<div class="train-focus">' + (s.kind === 'run' ? '🏃' : s.kind === 'bike' ? '🚴' : '🏋️') + ' ' + esc(s.focus) + '</div></div>';
      host.innerHTML = head + s.blocks.map(blockHtml).join('') + meta;
    } else {
      head += '</div>';
      var first = TRAINING_META.first;
      var last = TRAINING_META.last;
      var msg = last && today > last
        ? format(I18N_HOY.afterLastMsg, { last: esc(fmtLong(last)) })
        : first && today < first
          ? I18N_HOY.beforeFirstMsg
          : I18N_HOY.restDayMsg;
      host.innerHTML = head + '<div class="train-empty">' + msg + '</div>' + meta;
    }
  }
  function format(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) {
      return vars && vars[k] != null ? vars[k] : '';
    });
  }

  render();
})();
