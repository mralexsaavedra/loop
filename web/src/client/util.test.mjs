/* Tests for the shared client helpers (web/src/client/util.js, inlined FIRST so every other classic
 * script reads window.HC): run in a vm with a controllable clock and the baked HC_CONST. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UTIL_SOURCE, HC_CONST_BAKE } from '../../test/client-util.mjs';
import { stripComments } from '../../../lib/format/js-scan.mjs';
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

test('esc: an absent value (null / undefined) renders as empty, never "null" / "undefined"; 0 and false stay', () => {
  const HC = load();
  assert.equal(HC.esc(null), '');
  assert.equal(HC.esc(undefined), '');
  assert.equal(HC.esc(0), '0');
  assert.equal(HC.esc(false), 'false');
});

/* HC.jsonApi(base, header, timeoutMs): the ONE fetch wrapper of the LAN APIs (food-core.js, journal.js) */
function apiCtx({ fetch, protocol = 'http:', anySignal = true } = {}) {
  const ctx = { LOCALE: 'en', HC_CONST: HC_CONST_BAKE, I18N_DATE: enDate, Math, String, Number, Array, Object, JSON, Promise, setTimeout, clearTimeout, AbortController, fetch, location: { protocol } };
  // anySignal false: a browser without AbortSignal.any (the caller's signal is relayed by hand)
  if (anySignal) ctx.AbortSignal = AbortSignal;
  vm.createContext(ctx);
  vm.runInContext(UTIL_SOURCE, ctx);
  return ctx.HC;
}
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: () => (body === undefined ? Promise.reject(new Error('no json')) : Promise.resolve(body)) });

test('jsonApi: sends its own required header (+ JSON body), resolves a 2xx body ({} when empty)', async () => {
  const calls = [];
  const HC = apiCtx({ fetch: (url, init) => { calls.push([url, init]); return Promise.resolve(res(200, calls.length === 1 ? { a: 1 } : undefined)); } });
  const food = HC.jsonApi('/api/food', 'X-HC-Food', 15000);
  assert.deepEqual({ ...(await food('POST', '/log', { x: 1 })) }, { a: 1 });
  const [url, init] = calls[0];
  assert.equal(url, '/api/food/log');
  assert.equal(init.method, 'POST');
  assert.deepEqual({ ...init.headers }, { 'X-HC-Food': '1', 'Content-Type': 'application/json' });
  assert.equal(init.body, '{"x":1}');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.credentials, 'same-origin');
  assert.ok(init.signal, 'abortable (timeout)');
  const journal = HC.jsonApi('/api/journal', 'X-HC-Journal', 15000);
  assert.deepEqual({ ...(await journal('GET', '/settings')) }, {}, 'a 2xx without a JSON body = {}');
  assert.deepEqual({ ...calls[1][1].headers }, { 'X-HC-Journal': '1' }, 'no body: no Content-Type');
  assert.equal(calls[1][1].body, undefined);
});

test('jsonApi: rejects {code, field, status} on an error answer, {code: offline, status: 0} without one or from file://', async () => {
  let HC = apiCtx({ fetch: () => Promise.resolve(res(400, { error: 'invalid', field: 'goal' })) });
  await assert.rejects(HC.jsonApi('/api/food', 'X-HC-Food', 1000)('PUT', '/settings', {}), (e) => e.code === 'invalid' && e.field === 'goal' && e.status === 400);
  HC = apiCtx({ fetch: () => Promise.resolve(res(500)) });
  await assert.rejects(HC.jsonApi('/api/food', 'X-HC-Food', 1000)('GET', '/x'), (e) => e.code === 'generic' && e.status === 500);
  HC = apiCtx({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
  await assert.rejects(HC.jsonApi('/api/journal', 'X-HC-Journal', 1000)('GET', '/x'), (e) => e.code === 'offline' && e.status === 0);
  let fetched = false;
  HC = apiCtx({ fetch: () => { fetched = true; }, protocol: 'file:' });
  await assert.rejects(HC.jsonApi('/api/journal', 'X-HC-Journal', 1000)('GET', '/x'), (e) => e.code === 'offline' && e.status === 0);
  assert.equal(fetched, false, 'never fetched from a file');
});

/* HC.fetchTimeout(url, init, ms): the ONE timed fetch (jsonApi, freshness.js, profile.js) */
test('fetchTimeout: passes the answer through; a request that never settles rejects after ms and is aborted', async () => {
  const seen = [];
  let HC = apiCtx({ fetch: (url, init) => { seen.push([url, init]); return Promise.resolve(res(200, {})); } });
  const r = await HC.fetchTimeout('/status.json', { cache: 'no-store' }, 1000);
  assert.equal(r.status, 200);
  assert.equal(seen[0][0], '/status.json');
  assert.equal(seen[0][1].cache, 'no-store', 'the caller\'s init is kept');
  assert.ok(seen[0][1].signal, 'abortable');
  let signal = null;
  HC = apiCtx({ fetch: (url, init) => { signal = init.signal; return new Promise(() => {}); } });
  const t0 = Date.now();
  await assert.rejects(HC.fetchTimeout('/api/sync', { method: 'POST' }, 30), (e) => e && e.name === 'TimeoutError');
  assert.ok(Date.now() - t0 < 1000, 'gave up after its timeout');
  assert.equal(signal.aborted, true, 'the hanging request is aborted');
  HC = apiCtx({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
  await assert.rejects(HC.fetchTimeout('/x', {}, 1000), TypeError, 'a network error stays a rejection');
});

test('jsonApi: a request that never answers times out as offline', async () => {
  const HC = apiCtx({ fetch: () => new Promise(() => {}) });
  await assert.rejects(HC.jsonApi('/api/food', 'X-HC-Food', 30)('GET', '/x'), (e) => e.code === 'offline' && e.status === 0);
});

test('jsonApi + fetchJson: the timeout also covers a body that never arrives (headers came, res.json() stalls)', async () => {
  let signal = null;
  const stalled = (url, init) => { signal = init.signal; return Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) }); };
  let HC = apiCtx({ fetch: stalled });
  const t0 = Date.now();
  await assert.rejects(HC.jsonApi('/api/food', 'X-HC-Food', 30)('GET', '/x'), (e) => e.code === 'offline' && e.status === 0);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(signal.aborted, true, 'the stalled body is aborted');
  HC = apiCtx({ fetch: stalled });
  await assert.rejects(HC.fetchJson('/status.json', { cache: 'no-store' }, 30), (e) => e && e.name === 'TimeoutError');
  HC = apiCtx({ fetch: () => Promise.resolve(res(200, { commit: 'abc' })) });
  assert.deepEqual({ ...(await HC.fetchJson('/status.json', {}, 1000)) }, { commit: 'abc' });
  HC = apiCtx({ fetch: () => Promise.resolve(res(503, { error: 'x' })) });
  assert.equal(await HC.fetchJson('/status.json', {}, 1000), null, 'a non-2xx answer = null');
});

test('fetchTimeout: a caller\'s signal is combined with the timeout (never overwritten), with or without AbortSignal.any', async () => {
  for (const anySignal of [true, false]) {
    let signal = null;
    const HC = apiCtx({ anySignal, fetch: (url, init) => { signal = init.signal; return new Promise(() => {}); } });
    const caller = new AbortController();
    const init = { method: 'GET', signal: caller.signal };
    const p = HC.fetchTimeout('/x', init, 5000);
    assert.equal(init.signal, caller.signal, 'the caller\'s init is not mutated');
    assert.notEqual(signal, caller.signal, 'the request carries a combined signal');
    assert.equal(signal.aborted, false);
    const t0 = Date.now();
    caller.abort();
    await assert.rejects(p, (e) => e && e.name === 'AbortError');
    assert.ok(Date.now() - t0 < 1000, 'the caller abort ends it at once, not at the timeout');
    assert.equal(signal.aborted, true, 'the request is aborted by the caller');
    // and the timeout still aborts a request that carries a caller signal
    let s2 = null;
    const HC2 = apiCtx({ anySignal, fetch: (url, i) => { s2 = i.signal; return new Promise(() => {}); } });
    await assert.rejects(HC2.fetchTimeout('/x', { signal: new AbortController().signal }, 30), (e) => e && e.name === 'TimeoutError');
    assert.equal(s2.aborted, true);
  }
});

test('freshness.js and profile.js fetch only through HC.fetchTimeout / HC.fetchJson (no request without a timeout)', () => {
  for (const f of ['freshness.js', 'profile.js']) {
    const src = stripComments(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), f), 'utf8'));
    assert.doesNotMatch(src.replace(/HC\.fetch(Timeout|Json)\(/g, ''), /\bfetch\(/, f);
    assert.match(src, /HC\.fetch(Timeout|Json)\(/, f);
  }
  // freshness reads JSON bodies: through fetchJson, so the timeout covers the body too
  const fr = stripComments(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'freshness.js'), 'utf8'));
  assert.doesNotMatch(fr, /\.json\(\)/, 'no res.json() outside the timeout');
});

test('food-core.js and journal.js share HC.jsonApi: no fetch of their own', () => {
  for (const f of ['food-core.js', 'journal.js']) {
    const src = stripComments(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), f), 'utf8'));
    assert.doesNotMatch(src, /\bfetch\(/, f);
    assert.match(src, /HC\.jsonApi\(/, f);
  }
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

test('staleMark is THE stale-data marker: a <details>, short line + ⓘ as summary, the sentence inside, all escaped', () => {
  const HC = load();
  assert.equal(HC.staleMark('own', 'Data <5> d old', 'Old & greyed.'),
    '<details class="stale-mk own"><summary>Data &lt;5&gt; d old' + HC.infoSvg + '</summary><p>Old &amp; greyed.</p></details>');
  assert.ok(HC.staleMark('', 'a', 'b').startsWith('<details class="stale-mk"><summary>'));
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
  // an opener row keeps its <li> a list item: the button role sits on an inner <div class="db-row">
  const open = HC.metricRow({ key: 'weight', cls: 'db-stale', attrs: ' id="hl-w" data-detail="weight" role="button" tabindex="0" aria-haspopup="dialog"', aria: 'Weight', name: 'W', value: '1' });
  assert.match(open, /^<li><div class="db-row db-stale" id="hl-w" data-detail="weight" role="button" tabindex="0" aria-haspopup="dialog" aria-label="Weight"><svg class="db-ico"/);
  assert.ok(open.endsWith('</span></div></li>'));
  assert.match(HC.metricRow({ key: 'weight', name: 'W', value: '1' }), /^<li class="db-row"><svg[\s\S]*<\/li>$/, 'a row that opens nothing stays a plain <li>');
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

/** The first argument of every HC.registerView(…) call in CODE: comments may name the API
 * (`HC.registerView(<key>, …)`), so they are stripped first by a string-aware scanner (a `"http://…"`
 * or `'/*'` string is not a comment); string contents are kept (the keys are string literals).
 * Returns each argument's source text, trimmed. */
function registerViewArgs(src) {
  return [...stripComments(src).matchAll(/\bregisterView\s*\(\s*([^,)]*)/g)].map((m) => m[1].trim());
}

/** Every client script under web/src/client, subdirectories included (tests and util.js excluded),
 * as paths relative to it. */
function clientScripts() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  return walk(dir).map((p) => path.relative(dir, p).split(path.sep).join('/'))
    .filter((f) => f.endsWith('.js') && !/\.test\.m?js$/.test(f) && f !== 'util.js').sort()
    .map((f) => ({ f, src: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

test('registerViewArgs: comments are skipped, strings are not mistaken for comments', () => {
  assert.deepEqual(registerViewArgs('var u = "http://x"; HC.registerView(\'k\', v);'), ["'k'"]);
  assert.deepEqual(registerViewArgs("var s = '/*'; HC.registerView('a', v); var t = '*/';"), ["'a'"]);
  assert.deepEqual(registerViewArgs('go(); // then HC.registerView(name, …)\nHC.registerView("b", v);'), ['"b"']);
  assert.deepEqual(registerViewArgs('/* HC.registerView(<key>, …) */ HC.registerView(key, v);'), ['key']);
});

test('each registered view key belongs to ONE client script, always a string literal (static scan)', () => {
  const owner = new Map();
  const scripts = clientScripts();
  assert.ok(scripts.length > 20, 'the walk finds the client scripts');
  for (const { f, src } of scripts) {
    // code may not hide a key in a variable
    for (const arg of registerViewArgs(src)) {
      const lit = /^(['"])([\w-]+)\1$/.exec(arg);
      assert.ok(lit, `${f}: HC.registerView(${arg}, …) must use a string literal key`);
      const prev = owner.get(lit[2]);
      assert.ok(!prev || prev === f, `view "${lit[2]}" registered by both ${prev} and ${f}`);
      owner.set(lit[2], f);
    }
  }
  assert.deepEqual([...owner.keys()].sort(), ['dash-edit', 'food-add', 'hoy-session', 'journal', 'journal-insights', 'onboarding', 'profile', 'tonight']);
});

test('only util.js writes window.HCViews: every other client script registers through HC.registerView', () => {
  const writers = clientScripts().map(({ f, src }) => ({ f, code: stripComments(src) }))
    .filter(({ code }) => /\bHCViews\s*(\[[^\]]*\]|\.[\w$]+)?\s*=(?!=)|\bvar\s+\w+\s*=\s*window\.HCViews\b/.test(code)).map(({ f }) => f);
  assert.deepEqual(writers, []);
});
