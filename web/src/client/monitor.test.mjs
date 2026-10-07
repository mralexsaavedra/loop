/* Tests for the Inicio health monitor renderer (web/src/client/monitor.js): runs the classic script in
 * a vm with baked SCORES/I18N_SCORE/LOCALE globals and a controllable clock. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorFromInputs } from '../../../lib/score/monitor.mjs';
import { es as esT, en as enT } from '../i18n/score-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'monitor.js'), 'utf8');

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ASOF = '2026-09-29';
const wig = (i) => ((i * 7) % 5) - 2;
const series = ({ n = 43, base, amp, last, asOf = ASOF }) => Array.from({ length: n }, (_, i) => ({
  date: addDays(asOf, i - (n - 1)),
  value: i === n - 1 && last != null ? last : base + wig(i) * amp,
}));

function monitor() {
  return monitorFromInputs({
    respiratory: series({ base: 14.5, amp: 0.2, last: 18 }), // high, change signal -> watch
    rhr: series({ base: 50, amp: 1, last: 50 }), // normal
    hrv: series({ n: 10, base: 60, amp: 2 }), // building
    wristTemp: null, // none
    sleep: series({ base: 7.5, amp: 0.2, last: 5, asOf: addDays(ASOF, -3) }), // low, older date
  });
}

function render(mon, { locale = 'en', now = ASOF, healthNav = false, detail = false, tiles = null } = {}) {
  const host = { innerHTML: '' };
  const RealDate = Date;
  class FakeDate extends RealDate {
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  const ctx = {
    document: { getElementById: (id) => (id === 'monitor' ? host : id === 'home-tiles' ? tiles : id === 't-health' && healthNav ? {} : null) },
    SCORES: mon === undefined ? undefined : { monitor: mon }, I18N_SCORE: locale === 'es' ? esT : enT, LOCALE: locale,
    Date: FakeDate, Math, String, Number, Array, Object, JSON,
  };
  if (detail) ctx.DETAIL = { metrics: {} };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return host.innerHTML;
}
const cardOf = (html, key) => {
  const at = html.indexOf(`data-hm="${key}"`);
  assert.ok(at !== -1, `missing card ${key}`);
  const i = html.lastIndexOf('<div class="hm-card', at);
  return html.slice(i, html.indexOf('<!--/hm-->', i));
};

test('five cards in order under a Health monitor heading; no scripts or external refs', () => {
  const html = render(monitor());
  assert.ok(html.includes(enT.monitor.heading));
  const order = ['respiratory', 'rhr', 'hrv', 'wristTemp', 'sleep'].map((k) => html.indexOf(`data-hm="${k}"`));
  assert.ok(order.every((v, i) => v !== -1 && (i === 0 || v > order[i - 1])), 'fixed order');
  assert.doesNotMatch(html, /<script|src=|href=|NaN|undefined/);
});

test('status word + tone class: respiratory out of band is watch (not bad), resting HR normal, sleep low = bad', () => {
  const html = render(monitor());
  const resp = cardOf(html, 'respiratory');
  assert.match(resp, /hm-tone-watch/);
  assert.ok(resp.includes(`>${enT.monitor.status.high}<`));
  const rhr = cardOf(html, 'rhr');
  assert.match(rhr, /hm-tone-normal/);
  assert.ok(rhr.includes(`>${enT.monitor.status.normal}<`));
  assert.ok(rhr.includes('<b class="hm-num">50</b>'));
  assert.ok(rhr.includes(enT.monitor.units.rhr));
  const sleep = cardOf(html, 'sleep');
  assert.match(sleep, /hm-tone-bad/);
  assert.ok(sleep.includes(`>${enT.monitor.status.low}<`));
});

test('the range bar is an inline SVG with the band and the marker; the normal range is written out one decimal finer than the value', () => {
  const html = render(monitor());
  const rhr = cardOf(html, 'rhr');
  assert.match(rhr, /<svg class="hm-bar"[^>]*aria-hidden="true"/);
  assert.match(rhr, /class="hm-band"/);
  assert.match(rhr, /class="hm-mark"/);
  const c = monitor().cards.find((x) => x.key === 'rhr');
  assert.ok(rhr.includes(enT.monitor.rangeLbl.replace('{lo}', c.band.lo.toFixed(1)).replace('{hi}', c.band.hi.toFixed(1))));
  assert.doesNotMatch(rhr, /style=/, 'geometry via SVG attributes, not inline styles');
});

test('building baseline: value shown, status "building", no bar; missing series: "No data"', () => {
  const html = render(monitor());
  const hrv = cardOf(html, 'hrv');
  assert.ok(hrv.includes(enT.monitor.status.building));
  assert.doesNotMatch(hrv, /hm-bar/);
  assert.match(hrv, /class="hm-num">\d+</);
  const temp = cardOf(html, 'wristTemp');
  assert.ok(temp.includes(enT.monitor.status.none));
  assert.match(temp, /hm-none/);
  assert.doesNotMatch(temp, /hm-num/);
});

test('a value from last night carries no date; an older one shows its date', () => {
  const html = render(monitor());
  assert.doesNotMatch(cardOf(html, 'rhr'), /hm-date/);
  assert.match(cardOf(html, 'sleep'), /<div class="hm-date">Sat 26 Sep<\/div>/, 'the shared display date, never ISO');
  assert.match(cardOf(render(monitor(), { locale: 'es' }), 'sleep'), /<div class="hm-date">sáb 26 sept<\/div>/);
  assert.match(cardOf(render(monitor(), { now: addDays(ASOF, 1) }), 'rhr'), /hm-date/, 'yesterday-dated reading is not last night');
});

test('es: Alto / Bajo / Normal, decimal comma, Spanish units', () => {
  const html = render(monitor(), { locale: 'es' });
  assert.ok(cardOf(html, 'respiratory').includes('>Alto<'));
  assert.ok(cardOf(html, 'sleep').includes('>Bajo<'));
  assert.ok(cardOf(html, 'rhr').includes('>Normal<'));
  assert.ok(cardOf(html, 'respiratory').includes('18,0'));
  assert.ok(cardOf(html, 'rhr').includes(esT.monitor.units.rhr));
});

test('every card (also an empty or stale one) opens its detail view, whatever tabs are hidden; no jump into another tab', () => {
  for (const nav of [true, false]) {
    const linked = render(monitor(), { healthNav: nav, detail: true });
    for (const k of ['respiratory', 'rhr', 'hrv', 'wristTemp', 'sleep']) {
      assert.match(cardOf(linked, k), new RegExp(`data-hm="${k}" data-detail="${k}" role="button" tabindex="0" aria-haspopup="dialog"`), k);
    }
    assert.doesNotMatch(linked, /jumpOr|onclick/);
  }
  assert.doesNotMatch(render(monitor()), /data-detail/, 'no detail sheet baked: plain cards');
});

test('per-card staleness: a card whose own date is > 3 days old loses its tone and says "no recent data"', () => {
  const html = render(monitor(), { now: addDays(ASOF, 1) }); // sleep is now 4 days old, the rest 1 day
  const sleep = cardOf(html, 'sleep');
  assert.match(sleep, /hm-stale/);
  assert.doesNotMatch(sleep, /hm-tone-/);
  assert.ok(sleep.includes(enT.monitor.status.stale));
  assert.ok(!sleep.includes(`>${enT.monitor.status.low}<`), 'no Low for an old reading');
  assert.match(cardOf(html, 'respiratory'), /hm-tone-watch/, 'fresh cards keep their tone');
});

test('resilience: a throwing card falls back to its empty state; a missing monitor dict renders nothing', () => {
  const mon = monitor();
  Object.defineProperty(mon.cards[1], 'value', { get() { throw new Error('boom'); } });
  const html = render(mon);
  assert.match(cardOf(html, 'rhr'), /hm-none/);
  assert.match(cardOf(html, 'hrv'), /hm-num/, 'the other cards still render');
  const host = { innerHTML: '' };
  const ctx = { document: { getElementById: (id) => (id === 'monitor' ? host : null) }, SCORES: { monitor: monitor() }, I18N_SCORE: {}, LOCALE: 'en', Date, Math, String, Number, Array, Object, JSON };
  vm.createContext(ctx);
  loadUtil(ctx);
  assert.doesNotThrow(() => vm.runInContext(source, ctx));
  assert.equal(host.innerHTML, '');
});

test('stale monitor (> 3 days) is greyed; absent SCORES or host never throws', () => {
  assert.match(render(monitor(), { now: addDays(ASOF, 5) }), /hm sc-card sc-stale|sc-stale/);
  assert.doesNotThrow(() => render(undefined));
  assert.equal(render(undefined), '');
  const empty = render(monitorFromInputs({}));
  assert.equal((empty.match(/hm-none/g) || []).length, 5, 'all five say No data');
});

/* ---- Inicio monitor tiles (#home-tiles): a summary tile + the HRV tile, from the SAME baked cards ---- */
const tilesOf = (mon, opts = {}) => { const tiles = { innerHTML: '' }; render(mon, { ...opts, tiles }); return tiles.innerHTML; };
const tileText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('tile 1 = the monitor summary: out-of-range count chip, "n/5 metrics" in range, a button that jumps to the full monitor', () => {
  const html = tilesOf(monitor());
  // respiratory High + sleep Low are out of range; resting HR in range; HRV building; wrist temp no data
  assert.match(html, /<button type="button" class="hmt hmt-sum" onclick="jump\('monitor'\)">/);
  const sum = html.match(/<button type="button" class="hmt hmt-sum"[\s\S]*?<\/button>/)[0];
  assert.ok(sum.includes(`<span class="hmt-lbl">${enT.monitor.heading}<span class="hmt-chev" aria-hidden="true">›</span></span>`));
  assert.match(sum, /<span class="hmt-chip hmt-out">/);
  assert.ok(sum.includes(enT.monitor.tile.out.replace('{n}', '2')));
  assert.ok(sum.includes(enT.monitor.tile.metrics.replace('{n}', '1').replace('{total}', '5')));
  assert.doesNotMatch(html, /NaN|undefined|<script|src=|href=/);
});

test('tile 1: every fresh signal in range -> the teal "within range" chip with a check; nothing fresh -> "no data"', () => {
  const ok = monitorFromInputs({ rhr: series({ base: 50, amp: 1, last: 50 }), hrv: series({ base: 60, amp: 2, last: 60 }) });
  const html = tilesOf(ok);
  assert.match(html, /<span class="hmt-chip hmt-in"><svg class="hmt-ico"[^>]*aria-hidden="true">/);
  assert.ok(html.includes(enT.monitor.tile.inRange));
  assert.ok(html.includes(enT.monitor.tile.metrics.replace('{n}', '2').replace('{total}', '5')));
  const none = tilesOf(monitorFromInputs({}));
  assert.match(none, /hmt-chip hmt-none/);
  assert.ok(none.includes(enT.monitor.tile.none));
  // a stale reading never counts as in or out of range
  const later = tilesOf(monitor(), { now: addDays(ASOF, 1) }); // sleep is 4 days old now
  assert.ok(later.includes(enT.monitor.tile.out.replace('{n}', '1')));
});

test('tile 2 = HRV (a real baked value, no invented stress score): value + unit chip, status word, opens the HRV sheet', () => {
  const mon = monitorFromInputs({ hrv: series({ base: 60, amp: 2, last: 61 }) });
  const html = tilesOf(mon, { detail: true });
  const t = html.match(/<div class="hmt hmt-hrv[^"]*"[\s\S]*?<!--\/hmt-->/)[0];
  assert.match(t, /data-detail="hrv" role="button"/);
  assert.ok(t.includes(`<span class="hmt-lbl">${enT.monitor.labels.hrv}<span class="hmt-chev" aria-hidden="true">›</span></span>`));
  assert.ok(t.includes(`<span class="hmt-val"><b>61</b><small>${enT.monitor.units.hrv}</small></span>`));
  assert.ok(t.includes(`>${enT.monitor.status.normal}<`));
  assert.match(html, /class="hm-tiles"/, 'two columns');
  assert.doesNotMatch(html, /hm-tiles-one/);
});

test('tile 2 is left out when HRV has no fresh value: tile 1 goes full width', () => {
  for (const mon of [monitorFromInputs({ rhr: series({ base: 50, amp: 1 }) }), monitorFromInputs({ hrv: series({ base: 60, amp: 2, asOf: addDays(ASOF, -6) }) })]) {
    const html = tilesOf(mon);
    assert.doesNotMatch(html, /hmt-hrv/);
    assert.match(html, /class="hm-tiles hm-tiles-one"/);
  }
});

test('es tiles: Spanish copy, decimal comma', () => {
  const html = tilesOf(monitor(), { locale: 'es' });
  assert.ok(html.includes(esT.monitor.tile.out.replace('{n}', '2')));
  assert.ok(html.includes(esT.monitor.tile.metrics.replace('{n}', '1').replace('{total}', '5')));
  assert.equal(esT.monitor.tile.inRange, 'En rango');
});
