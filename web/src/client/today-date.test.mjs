/* web/src/client/today-date.js — the top bar's "‹ TODAY ›" pill: the viewer's local today written with
 * the one date formatter (HC.fmtDate, nothing baked), and Inicio's day stepping (window.HCDay): the
 * bounds from the baked history (SCORES.days), the #d=YYYY-MM-DD hash, the listeners, the keyboard. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { es as esDate, en as enDate } from '../i18n/date-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';
import { DAY_HASH } from '../../../lib/nav/tabs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'today-date.js'), 'utf8');

const HIST = { from: '2026-09-15', to: '2026-09-28', days: [] };

function run({ locale = 'en', at = '2026-09-29T09:00:00', withHost = true, pill = true, days = HIST, hash = '', tab = 'home', sheetOpen = false } = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(at); }
    static now() { return new RealDate(at).getTime(); }
  }
  const doc = new StubDocument();
  const el = withHost ? doc.el('today-date', { tag: 'time' }) : null;
  const ui = {};
  if (pill) {
    ui.pill = doc.el('date-pill');
    ui.prev = doc.el('day-prev', { tag: 'button', hidden: true });
    ui.next = doc.el('day-next', { tag: 'button', hidden: true });
    ui.lbl = doc.el('day-lbl', { tag: 'button', attrs: { 'data-back': locale === 'es' ? 'Volver a hoy' : 'Back to today' } });
    ui.word = doc.el('day-word', { tag: 'span', textContent: locale === 'es' ? 'Hoy' : 'Today' });
  }
  if (sheetOpen) doc.el('detail', { hidden: false });
  const writes = [];
  const loc = { hash, pathname: '/', search: '' };
  const win = { listeners: {}, addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); } };
  const ctx = {
    document: doc, window: win, location: loc, LOCALE: locale, I18N_DATE: locale === 'es' ? esDate : enDate, Date: FakeDate, Math, String, Number, Array,
    NAV: { day: DAY_HASH }, SCORES: days === undefined ? undefined : { days },
    currentTab: () => tab,
    history: { replaceState: (s, t, url) => { writes.push(url); loc.hash = url.slice(url.indexOf('#')); } },
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return { el, ui, writes, ctx, D: win.HCDay, win, loc };
}
const key = (r, k) => r.ui.pill._listeners.keydown[0]({ key: k, preventDefault() {} });

test('writes the viewer\'s local today: "mié 30 sept" (es) / "Wed 30 Sep" (en), with a machine-readable datetime', () => {
  const es = run({ locale: 'es', at: '2026-09-30T08:00:00' }).el;
  assert.equal(es.textContent, 'mié 30 sept');
  assert.equal(es.getAttribute('datetime'), '2026-09-30');
  const en = run({ locale: 'en', at: '2026-09-30T23:59:00' }).el;
  assert.equal(en.textContent, 'Wed 30 Sep');
});

test('no date host on the page: does nothing, never throws', () => {
  assert.doesNotThrow(() => run({ withHost: false, pill: false }));
});

test('bounds: today = no past day, "‹" reaches the oldest baked day, "›" is off on today', () => {
  const r = run();
  assert.equal(r.D.sel(), null);
  assert.equal(r.D.iso(), '2026-09-29');
  assert.equal(r.D.oldest(), '2026-09-15');
  assert.equal(r.ui.prev.hidden, false);
  assert.equal(r.ui.next.hidden, false);
  assert.equal(r.ui.prev.disabled, false);
  assert.equal(r.ui.next.disabled, true, '› disabled on the viewer\'s today');
  assert.equal(r.ui.lbl.getAttribute('aria-disabled'), 'true');
  for (let i = 0; i < 20; i++) r.D.step(-1);
  assert.equal(r.D.sel(), '2026-09-15', 'never past the oldest baked day');
  assert.equal(r.ui.prev.disabled, true);
  for (let i = 0; i < 20; i++) r.D.step(1);
  assert.equal(r.D.sel(), null, '› stops on today');
});

test('a past day: the label shows its date (CSS uppercases it), the <time> carries it; tapping the label returns to today', () => {
  const r = run({ locale: 'es' });
  r.D.step(-1);
  assert.equal(r.D.sel(), '2026-09-28');
  assert.equal(r.ui.word.textContent, 'lun 28 sept');
  assert.equal(r.el.textContent, 'lun 28 sept');
  assert.equal(r.el.getAttribute('datetime'), '2026-09-28');
  assert.equal(r.ui.next.disabled, false);
  assert.equal(r.ui.lbl.getAttribute('aria-disabled'), null);
  assert.match(r.ui.lbl.getAttribute('aria-label'), /lun 28 sept.*Volver a hoy/);
  r.ui.lbl._listeners.click[0]();
  assert.equal(r.D.sel(), null);
  assert.equal(r.ui.word.textContent, 'Hoy');
  assert.equal(r.el.textContent, 'mar 29 sept');
  assert.equal(r.ui.lbl.getAttribute('aria-label'), null);
});

test('the history caps the reach: data far behind the clock = no stepping (no dead chevrons); no history = none', () => {
  const far = run({ at: '2026-12-01T09:00:00' });
  assert.equal(far.D.oldest(), null);
  assert.equal(far.ui.prev.hidden, true);
  assert.equal(far.ui.next.hidden, true);
  assert.equal(far.D.set('2026-09-20'), false);
  const none = run({ days: null });
  assert.equal(none.D.oldest(), null);
  assert.equal(none.ui.prev.hidden, true);
  // the cap applies even when the history is older than it
  const capped = run({ at: '2026-10-20T09:00:00' });
  assert.equal(capped.D.oldest(), '2026-09-20', 'today − maxDays');
});

test('hash: a step writes #d=YYYY-MM-DD (replace, never push), today writes #home; never while the sheet is open or off Inicio', () => {
  const r = run();
  r.D.step(-1);
  r.D.step(-1);
  assert.deepEqual(r.writes, ['/#d=2026-09-28', '/#d=2026-09-27']);
  r.D.set(null);
  assert.equal(r.writes.at(-1), '/#home');
  assert.equal(r.D.hash(), '');
  r.D.step(-1);
  assert.equal(r.D.hash(), '#d=2026-09-28');
  const sheet = run({ sheetOpen: true });
  sheet.D.step(-1);
  assert.deepEqual(sheet.writes, []);
  const off = run({ tab: 'health' });
  off.D.step(-1);
  assert.deepEqual(off.writes, []);
});

test('hash round trip: #d= opens on that day; an unreachable one falls back to today and names #home', () => {
  const r = run({ hash: '#d=2026-09-24' });
  assert.equal(r.D.sel(), '2026-09-24');
  assert.equal(r.ui.word.textContent, 'Thu 24 Sep');
  assert.deepEqual(r.writes, []);
  for (const h of ['#d=2026-09-01', '#d=2026-09-29', '#d=2026-10-03', '#d=2026-02-30']) {
    const x = run({ hash: h });
    assert.equal(x.D.sel(), null, h);
    assert.deepEqual(x.writes, ['/#home'], h);
  }
  // a later hash navigation (Back, an edited URL) moves the day without writing
  r.loc.hash = '#d=2026-09-20';
  r.win.listeners.hashchange.forEach((fn) => fn());
  assert.equal(r.D.sel(), '2026-09-20');
  r.loc.hash = '#home';
  r.win.listeners.hashchange.forEach((fn) => fn());
  assert.equal(r.D.sel(), null);
  assert.deepEqual(r.writes, []);
});

test('listeners hear every change once with the selected day (null = today); one throwing listener never stops the others', () => {
  const r = run();
  const heard = [];
  r.D.on(() => { throw new Error('boom'); });
  r.D.on((d) => heard.push(d));
  r.D.step(-1);
  r.D.set('2026-09-28'); // no change: silent
  r.D.set(null);
  assert.deepEqual(heard, ['2026-09-28', null]);
});

test('keyboard: ← / → on the focused pill step; focus leaves a chevron that just turned off', () => {
  const r = run();
  let focused = null;
  r.ui.lbl.focus = () => { focused = 'lbl'; };
  r.ctx.document.activeElement = r.ui.next;
  key(r, 'ArrowLeft');
  key(r, 'ArrowLeft');
  assert.equal(r.D.sel(), '2026-09-27');
  key(r, 'ArrowRight');
  key(r, 'ArrowRight');
  assert.equal(r.D.sel(), null);
  assert.equal(focused, 'lbl', '› is disabled on today: focus moves to the label');
  key(r, 'Enter');
  assert.equal(r.D.sel(), null, 'other keys are left alone');
});
