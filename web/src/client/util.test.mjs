/* Tests for the shared client helpers (web/src/client/util.js, inlined FIRST so every other classic
 * script reads window.HC): run in a vm with a controllable clock and the baked HC_CONST. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UTIL_SOURCE, HC_CONST_BAKE } from '../../test/client-util.mjs';
import { STALE_DAYS } from '../../../lib/stale.mjs';
import { es as esDate, en as enDate } from '../i18n/date-templates.mjs';

function load({ locale = 'en', at = '2026-09-29T12:00:00', HC_CONST = HC_CONST_BAKE, I18N_DATE = locale === 'es' ? esDate : enDate } = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [at])); }
    static now() { return new RealDate(at).getTime(); }
  }
  const ctx = { LOCALE: locale, HC_CONST, I18N_DATE, Date: FakeDate, Math, String, Number, Array, Object, JSON };
  vm.createContext(ctx);
  vm.runInContext(UTIL_SOURCE, ctx);
  return ctx.HC;
}

test('HC_CONST is baked from lib (no client literal): STALE_DAYS', () => {
  assert.equal(STALE_DAYS, 3);
  assert.deepEqual(HC_CONST_BAKE, { staleDays: STALE_DAYS });
  assert.equal(load().STALE_DAYS, STALE_DAYS);
  assert.equal(load().MS_PER_DAY, 86400000);
});

test('esc escapes markup and quotes; format fills {keys} and blanks missing ones', () => {
  const HC = load();
  assert.equal(HC.esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(HC.format('{a} · {b}', { a: 1 }), '1 · ');
});

test('isoDate accepts only real ISO dates; todayIso / daysOld use the viewer\'s LOCAL calendar', () => {
  const HC = load({ at: '2026-09-29T23:59:00' });
  assert.equal(HC.isoDate('2026-09-29'), '2026-09-29');
  assert.equal(HC.isoDate('29/09/2026'), null);
  assert.equal(HC.isoDate(null), null);
  // the shape alone is not enough: the date must round-trip through the calendar
  assert.equal(HC.isoDate('2026-02-31'), null);
  assert.equal(HC.isoDate('2026-13-01'), null);
  assert.equal(HC.isoDate('2026-00-10'), null);
  assert.equal(HC.isoDate('2024-02-29'), '2024-02-29');
  assert.equal(HC.todayIso(), '2026-09-29');
  assert.equal(HC.daysOld('2026-09-26'), 3);
  assert.equal(HC.daysOld('2026-09-30'), -1);
  assert.equal(HC.daysOld('bad'), null);
  assert.equal(load({ at: '2026-09-30T00:01:00' }).todayIso(), '2026-09-30');
  assert.equal(HC.shiftIso('2026-03-01', -1), '2026-02-28');
});

test('numbers: nf swaps the decimal point in es; num fixes decimals, drops the sign of a rounded zero, optional "+"', () => {
  assert.equal(load({ locale: 'es' }).nf(75.6), '75,6');
  assert.equal(load().nf(75.6), '75.6');
  const es = load({ locale: 'es' });
  assert.equal(es.num(1.25, 1, true), '+1,3');
  assert.equal(es.num(-0.04, 1, true), '0,0');
  assert.equal(load().num(-1.5, 1, true), '-1.5');
});

test('duration: one formatter, h:mm (lib/format/numbers.mjs via HC_FMT)', () => {
  const HC = load();
  assert.equal(HC.duration(45), '0:45');
  assert.equal(HC.duration(60), '1:00');
  assert.equal(HC.duration(105.4), '1:45');
  assert.equal(HC.duration(0), '0:00');
  assert.equal(HC.hours(7.999), '8:00');
  assert.equal(HC.hours(-0.5, true), '-0:30');
});

test('numbers: grouping for every value >= 1000, one percent rule, "—" when absent, input values never grouped', () => {
  const es = load({ locale: 'es' }), en = load();
  assert.equal(es.num(2500, 0), '2.500');
  assert.equal(es.int(13463), '13.463');
  assert.equal(en.int(2500), '2,500');
  assert.equal(es.nf(1234.5), '1.234,5');
  assert.equal(es.pct(97), '97%');
  assert.equal(en.pct(12, true), '+12%');
  assert.equal(es.num(null, 1), '—');
  assert.equal(es.int(NaN), '—');
  assert.equal(es.numInput(1234.5, 1), '1234,5');
  assert.equal(en.numInput(1000), '1000');
});

test('fmtDate: one shared date formatter, "lun 29 sept" in es / "Mon 29 Sep" in en; names from the baked I18N_DATE', () => {
  assert.equal(load({ locale: 'es' }).fmtDate('2026-09-29'), 'mar 29 sept');
  assert.equal(load().fmtDate('2026-09-28'), 'Mon 28 Sep');
  assert.equal(load({ locale: 'es' }).fmtDate('2026-05-04'), 'lun 4 may');
  assert.equal(load().fmtDate('2026-09-28', { weekday: false }), '28 Sep');
  assert.equal(load({ locale: 'es' }).fmtMonth('2026-09-01'), 'septiembre 2026');
  assert.equal(load().fmtMonth('2026-01-15'), 'January 2026');
  // never "undefined" / "NaN": a bad date or a missing dict renders empty / the ISO date itself
  assert.equal(load().fmtDate('bad'), '');
  assert.equal(load().fmtDate(null), '');
  assert.equal(load({ I18N_DATE: null }).fmtDate('2026-09-28'), '2026-09-28');
  assert.equal(load({ I18N_DATE: null }).fmtMonth('2026-09-28'), '2026-09');
});

test('detailAttrs: the ONE opener markup for the detail sheet (data-detail [+ data-date], a 44px button role), empty when the sheet is not baked', () => {
  const RealDate = Date;
  const ctx = { LOCALE: 'en', HC_CONST: HC_CONST_BAKE, DETAIL: { metrics: {} }, Date: RealDate, Math, String, Number, Array, Object, JSON };
  vm.createContext(ctx);
  vm.runInContext(UTIL_SOURCE, ctx);
  assert.equal(ctx.HC.detailAttrs('sleep'), ' data-detail="sleep" role="button" tabindex="0" aria-haspopup="dialog"');
  assert.equal(ctx.HC.detailAttrs('load-run', '2026-09-20'), ' data-detail="load-run" data-date="2026-09-20" role="button" tabindex="0" aria-haspopup="dialog"');
  assert.equal(ctx.HC.detailAttrs('hrv', 'bad'), ' data-detail="hrv" role="button" tabindex="0" aria-haspopup="dialog"', 'a non-ISO date is dropped');
  // on an element that is already focusable (a <button>) or a mouse-only target (an SVG cell, a table row)
  assert.equal(ctx.HC.detailAttrs('workouts', '2026-09-20', { plain: true }), ' data-detail="workouts" data-date="2026-09-20"');
  assert.equal(ctx.HC.detailAttrs('a"b'), ' data-detail="a&quot;b" role="button" tabindex="0" aria-haspopup="dialog"');
  assert.equal(load().detailAttrs('sleep'), '', 'no DETAIL baked: no opener');
});

test('weekdayIndex is Monday-first (0 = Monday … 6 = Sunday)', () => {
  const HC = load();
  assert.equal(HC.weekdayIndex('2026-09-28'), 0);
  assert.equal(HC.weekdayIndex('2026-10-04'), 6);
});

test('the client scripts share HC instead of redefining the helpers or hard-coding the baked constants', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  for (const f of ['timeline.js', 'training-activity.js', 'monitor.js', 'score.js', 'health.js', 'intake.js', 'food-core.js', 'food-sheet.js', 'food-catalog.js', 'food-log.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const name of ['esc', 'format', 'daysOld', 'todayIso', 'isoDate', 'nf']) {
      assert.doesNotMatch(src, new RegExp(`function ${name}\\(`), `${f} redefines ${name}()`);
    }
    assert.doesNotMatch(src, /86400000/, `${f} hard-codes the ms per day`);
    assert.doesNotMatch(src, /STALE_DAYS = \d/, `${f} hard-codes STALE_DAYS`);
    assert.match(src, /\bHC\./, `${f} reads the shared helpers`);
  }
  const act = fs.readFileSync(path.join(dir, 'training-activity.js'), 'utf8');
  assert.doesNotMatch(act, /WINDOW = \d|LEVEL_MIN = \[/, 'calendar window and level cuts come baked from lib/training/activity.mjs');
});

test('rolloverAction: reload once the viewer\'s day differs from the day the page loaded on, deferred while the detail sheet is open', () => {
  const HC = load();
  // same day: nothing to do, sheet open or not
  assert.equal(HC.rolloverAction('2026-10-01', '2026-10-01', false, false), 'none');
  assert.equal(HC.rolloverAction('2026-10-01', '2026-10-01', true, false), 'none');
  // a new day with the sheet closed: reload; with it open (an unsaved food form): defer
  assert.equal(HC.rolloverAction('2026-10-01', '2026-10-02', false, false), 'reload');
  assert.equal(HC.rolloverAction('2026-10-01', '2026-10-02', true, false), 'defer');
  // a hidden page waits for the next visibility change
  assert.equal(HC.rolloverAction('2026-10-01', '2026-10-02', false, true), 'none');
  // a clock moved back is a different day too
  assert.equal(HC.rolloverAction('2026-10-02', '2026-10-01', false, false), 'reload');
  // no usable dates: never reload
  assert.equal(HC.rolloverAction(null, '2026-10-02', false, false), 'none');
  assert.equal(HC.rolloverAction('2026-10-01', 'bad', false, false), 'none');
});

test('one date format: no client script formats a date with toLocale*String / Intl (HC.fmtDate / fmtMonth only)', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const scripts = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(scripts.length > 10, 'the client scripts are found');
  for (const f of scripts) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /\.toLocale(Date|Time)?String\(/, `${f} formats a date with toLocale*String: use HC.fmtDate`);
    assert.doesNotMatch(src, /Intl\.DateTimeFormat/, `${f} formats a date with Intl: use HC.fmtDate`);
    assert.doesNotMatch(src, /DATE_LOCALE/, `${f} keeps its own date locale`);
  }
});

test('cta is the one CTA link: a .cta button, the label escaped, the arrow hidden from screen readers', () => {
  const HC = load();
  assert.equal(HC.cta('See <more>', ' data-detail="sleep"'), '<button type="button" class="cta" data-detail="sleep">See &lt;more&gt;<span aria-hidden="true"> →</span></button>');
  assert.equal(HC.cta('Go'), '<button type="button" class="cta">Go<span aria-hidden="true"> →</span></button>');
});

test('trendTone / metricRow: a ▲ ▼ is never grey — no good direction reads neutral, only the • is flat', () => {
  const HC = load();
  assert.equal(HC.trendTone('up', 'good'), 'good');
  assert.equal(HC.trendTone('down', 'bad'), 'bad');
  assert.equal(HC.trendTone('up', 'watch'), 'watch');
  for (const t of [undefined, null, 'flat', 'normal']) assert.equal(HC.trendTone('down', t), 'neutral', String(t));
  assert.equal(HC.trendTone('flat', 'good'), 'flat', 'the typical dot stays grey whatever the tone');
  const row = (arrow, tone) => /<span class="db-arr db-(\w+)" aria-hidden="true">(.)<\/span>/.exec(HC.metricRow({ key: 'weight', name: 'W', value: '1', arrow, tone })).slice(1).join(' ');
  assert.equal(row('up', 'flat'), 'neutral ▲');
  assert.equal(row('down'), 'neutral ▼');
  assert.equal(row('flat', 'flat'), 'flat •');
  assert.equal(row('up', 'good'), 'good ▲');
});

test('contribRow is THE contributor row: icon, escaped label + sub, value, the glyph with its tone and words', () => {
  const HC = load();
  const row = HC.contribRow({ row: 'rhr', icon: 'rhr', label: 'Resting <HR>', sub: '+0.4 SD', value: '52 bpm', mark: { glyph: '▼', tone: 'better', said: 'better than usual' } });
  assert.match(row, /^<li class="dd-row" data-row="rhr"><svg class="dd-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="[^"]+"\/><\/svg>/);
  assert.ok(row.includes('<span class="dd-row-lbl">Resting &lt;HR&gt; <small class="dd-row-sub">+0.4 SD</small></span><b class="dd-row-val">52 bpm</b>'));
  assert.ok(row.endsWith('<span class="dd-mk dd-better" aria-hidden="true">▼</span><span class="sr-only">better than usual</span></li>'));
  const bare = HC.contribRow({ icon: 'cons', label: 'Regularity', value: '19 min' });
  assert.doesNotMatch(bare, /data-row|dd-row-sub|dd-mk/, 'no row key, sub line or glyph when not given');
  assert.equal(HC.contribIcon('cons'), HC.contribRow({ icon: 'cons', label: '', value: '' }).match(/<svg[\s\S]*?<\/svg>/)[0]);
});

test('switchBtn is THE switch: role=switch, aria-checked, the label escaped, no visible word', () => {
  const HC = load();
  assert.equal(HC.switchBtn(true, 'Show <HRV>', ' data-key="hrv"'),
    '<button type="button" class="sw" role="switch" aria-checked="true" aria-label="Show &lt;HRV&gt;" data-key="hrv"><span class="sw-knob" aria-hidden="true"></span></button>');
  assert.match(HC.switchBtn(false, 'x'), /aria-checked="false"/);
});

test('carried: a value dated before the shown day names its date and is dimmed; the shown day\'s own value is normal; stale keeps the date, drops the dim', () => {
  const HC = load({ at: '2026-10-09T08:00:00' });
  assert.deepEqual({ ...HC.carried('2026-10-07') }, { carried: true, label: 'Wed 7 Oct', cls: ' carried' });
  assert.deepEqual({ ...HC.carried('2026-10-07', null, { weekday: false }) }, { carried: true, label: '7 Oct', cls: ' carried' });
  assert.deepEqual({ ...HC.carried('2026-10-09') }, { carried: false, label: '', cls: '' }, "today's value");
  // a stepped-to past day: its own value is normal, an earlier one is carried
  assert.equal(HC.carried('2026-10-05', '2026-10-05').carried, false);
  assert.equal(HC.carried('2026-10-04', '2026-10-05').label, 'Sun 4 Oct');
  // the stronger stale state keeps the date, never stacks the dim
  assert.deepEqual({ ...HC.carried('2026-10-01', null, { stale: true }) }, { carried: true, label: 'Thu 1 Oct', cls: '' });
  // no date / ahead of the clock: never carried
  assert.equal(HC.carried(null).carried, false);
  assert.equal(HC.carried('2026-10-10').carried, false);
  assert.equal(load({ locale: 'es', at: '2026-10-09T08:00:00' }).carried('2026-10-07', null, { weekday: false }).label, '7 oct');
});

test('lan: LAN fetches only when served (http/https or no location); a file:// page skips them', () => {
  assert.equal(load().lan(), true, 'no location (a vm, the build) = served');
  const at = (loc) => {
    const ctx = { LOCALE: 'en', HC_CONST: HC_CONST_BAKE, I18N_DATE: enDate, Date, Math, String, Number, Array, Object, JSON, ...loc };
    vm.createContext(ctx);
    vm.runInContext(UTIL_SOURCE, ctx);
    return ctx.HC.lan();
  };
  assert.equal(at({ location: { protocol: 'http:' } }), true);
  assert.equal(at({ location: { protocol: 'https:' } }), true);
  assert.equal(at({ location: { protocol: 'file:' } }), false);
  assert.equal(at({ window: { location: { protocol: 'file:' } } }), false, 'window.location counts too');
});

/* ---------- HC.registerView / HC.view: the detail sheet's registered views (window.HCViews) ---------- */
function loadWithWindow() {
  const ctx = { LOCALE: 'en', HC_CONST: HC_CONST_BAKE, I18N_DATE: enDate, Math, String, Number, Array, Object, JSON, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(UTIL_SOURCE, ctx);
  return ctx;
}

test('HC.registerView: creates window.HCViews on first use; HC.view reads own keys only', () => {
  const ctx = loadWithWindow();
  assert.equal(ctx.HCViews, undefined, 'nothing registered, no registry');
  assert.equal(ctx.HC.view('profile'), null);
  const v = { title: () => 'P', render: () => ({ head: '', body: '' }) };
  ctx.HC.registerView('profile', v);
  assert.equal(ctx.HCViews.profile, v);
  assert.equal(ctx.HC.view('profile'), v);
  assert.equal(ctx.HC.view('toString'), null, 'no inherited keys');
});

test('HC.registerView: registering the same name again replaces the view (never throws on the live page)', () => {
  const ctx = loadWithWindow();
  ctx.HC.registerView('journal', { render: () => ({}) });
  const second = { render: () => ({}) };
  assert.doesNotThrow(() => ctx.HC.registerView('journal', second));
  assert.equal(ctx.HC.view('journal'), second);
});

test('each registered view key belongs to ONE client script, always a string literal (static scan)', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const owner = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'util.js')) {
    // comments may name the API (`HC.registerView(<key>, …)`); code may not hide a key in a variable
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/\bregisterView\s*\(\s*([^,)]*)/g)) {
      const lit = /^(['"])([\w-]+)\1$/.exec(m[1].trim());
      assert.ok(lit, `${f}: HC.registerView(${m[1].trim()}, …) must use a string literal key`);
      const prev = owner.get(lit[2]);
      assert.ok(!prev || prev === f, `view "${lit[2]}" registered by both ${prev} and ${f}`);
      owner.set(lit[2], f);
    }
  }
  assert.deepEqual([...owner.keys()].sort(), ['dash-edit', 'food-add', 'hoy-session', 'journal', 'journal-insights', 'profile', 'tonight']);
});

test('only util.js writes window.HCViews: every other client script registers through HC.registerView', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const writers = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'util.js')
    .filter((f) => /\bHCViews\s*(\[[^\]]*\]|\.[\w$]+)?\s*=(?!=)|\bvar\s+\w+\s*=\s*window\.HCViews\b/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(writers, []);
});
