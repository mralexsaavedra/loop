/* "Hoy / Today" tab — today's PROGRAMMED training session (a three-branch empty state: before the first
 * day, after the last, a rest day). Reads TRAINING / TRAINING_META / LOCALE from the globals baked by
 * web/src/components/Bake.astro and its copy from I18N_HOY (web/src/i18n/hoy-templates.mjs).
 * Module script (bundled into the page, docs/plan-page.md → Module scripts).
 *
 * `esc()` is the browser idiom `document.createElement('div');
 * d.textContent=s; return d.innerHTML;` — escapes `&`/`<`/`>` from
 * untrusted training-data.json prose (focus/block titles/lines/meta): training strings are NOT trusted.
 * See web/test/dom-stub.mjs for the vm/test-time implementation of this
 * exact behavior.
 */
import type { PageGlobals } from './page-globals';

// the page globals this script reads (baked by the build or provided by an earlier script; manifest.mjs)
declare const HC: PageGlobals['HC'];
declare const I18N_HOY: PageGlobals['I18N_HOY'];
declare const TRAINING: PageGlobals['TRAINING'];
declare const TRAINING_META: PageGlobals['TRAINING_META'];

/** One block of a programmed session (lib/training/program.mjs). */
type Block = import('../../../lib/training/program.mjs').ProgramBlock;
/** A programmed session (TRAINING[date]). */
type Session = import('../../../lib/training/program.mjs').ProgramSession;

(function () {
  var goalLineRe = new RegExp(I18N_HOY.goalLineRe, 'i');

  function iso(d: Date): string {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function esc(s: string): string {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  // the ONE display-date formatter (util.ts): "Tue 29 Sep" / "mar 29 sept"
  function fmtLong(isoStr: string): string {
    return HC.fmtDate(isoStr);
  }
  function blockHtml(b: Block): string {
    var lines = b.lines
      .map(function (l: string) {
        return '<li' + (goalLineRe.test(l) ? ' class="goal"' : '') + '>' + esc(l) + '</li>';
      })
      .join('');
    var label = b.label ? '<span class="blabel">' + esc(b.label) + '</span>' : '';
    return '<div class="train-block"><div class="train-block-top">' + label + '<h3>' + esc(b.title) + '</h3></div><ul>' + lines + '</ul></div>';
  }
  // Inicio shows the programmed session as a row of "Today's activities" (client/timeline.ts reads
  // window.HCProgram) and opens this markup as a registered detail view ('hoy-session', client/detail.ts);
  // #sec-hoy is a hidden source, and page.hideTabs ["hoy"] (the section `hidden`) turns both off.
  function expose(today: string, s: Session | undefined, host: HTMLElement) {
    if (typeof window === 'undefined') return;
    var sec = document.getElementById('sec-hoy');
    var on = !!(s && sec && !sec.hidden);
    window.HCProgram = on ? { date: today, kind: (s as Session).kind || 'gym', focus: String((s as Session).focus || '') } : null;
    if (!on) return;
    HC.registerView('hoy-session', {
      title: function () { return I18N_HOY.viewTitle; },
      render: function () { return { head: '', body: host.innerHTML }; },
    });
  }
  function render() {
    var host = document.getElementById('train-today');
    if (!host) return;
    var today = iso(new Date());
    var s: Session | undefined = TRAINING[today];
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
  function format(tpl: string, vars: Record<string, string>): string {
    return tpl.replace(/\{(\w+)\}/g, function (_: string, k: string) {
      return vars && vars[k] != null ? vars[k] : '';
    });
  }

  render();
})();
