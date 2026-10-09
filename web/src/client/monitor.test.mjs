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

function render(mon, { locale = 'en', now = ASOF, healthNav = false, detail = false, tiles = null, day = null, days = null, stress = null } = {}) {
  const host = { innerHTML: '' };
  const RealDate = Date;
  class FakeDate extends RealDate {
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  const ctx = {
    document: { getElementById: (id) => (id === 'monitor' ? host : id === 'home-tiles' ? tiles : id === 't-health' && healthNav ? {} : null) },
    SCORES: mon === undefined ? undefined : { monitor: mon, days, stress }, I18N_SCORE: locale === 'es' ? esT : enT, LOCALE: locale,
    Date: FakeDate, Math, String, Number, Array, Object, JSON,
  };
  if (detail) ctx.DETAIL = { metrics: {} };
  if (day) ctx.HCDay = day;
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return host.innerHTML;
}
const cardOf = (html, key) => {
  const at = html.indexOf(`data-hm="${key}"`);
  assert.ok(at !== -1, `missing card ${key}`);
  const i = html.lastIndexOf('<li class="db-row', at);
  return html.slice(i, html.indexOf('</li>', i) + 5);
};

test('five metric rows in order under an uppercase Health monitor label with a status chip; no scripts or external refs', () => {
  const html = render(monitor());
  assert.ok(html.includes(`<h3 class="hs-lbl">${enT.monitor.heading}</h3>`));
  // respiratory High + sleep Low are out of range: the header chip says so
  assert.match(html, /<div class="hs-head"><h3 class="hs-lbl">[^<]*<\/h3><span class="hmt-chip hmt-out">/);
  assert.ok(html.includes(enT.monitor.tile.out.replace('{n}', '2')));
  // rows = the shared metric row (icon · NAME · value · marker), the same .db-* styles as My dashboard
  assert.match(html, /<ul class="db-list hm-list">/);
  assert.equal((html.match(/<li class="db-row hm-row/g) || []).length, 5);
  assert.match(cardOf(html, 'rhr'), /<svg class="db-ico"[^>]*aria-hidden="true">/);
  const order = ['respiratory', 'rhr', 'hrv', 'wristTemp', 'sleep'].map((k) => html.indexOf(`data-hm="${k}"`));
  assert.ok(order.every((v, i) => v !== -1 && (i === 0 || v > order[i - 1])), 'fixed order');
  assert.doesNotMatch(html, /<script|src=|href=|NaN|undefined/);
});

test('status word + tone class: respiratory out of band is watch (not bad), resting HR normal, sleep low = bad', () => {
  const html = render(monitor());
  const resp = cardOf(html, 'respiratory');
  assert.match(resp, /hm-tone-watch/);
  assert.match(resp, /aria-label="[^"]*High/, 'the status word is in the row label');
  assert.match(resp, /<span class="db-arr db-watch" aria-hidden="true">▲<\/span>/, 'above the range: ▲, watch colour');
  const rhr = cardOf(html, 'rhr');
  assert.match(rhr, /hm-tone-normal/);
  assert.match(rhr, /aria-label="[^"]*Normal/);
  assert.match(rhr, /<span class="db-arr db-flat" aria-hidden="true">•<\/span>/, 'inside the range: a grey dot');
  assert.ok(rhr.includes('<b class="hm-num">50</b>'));
  assert.ok(rhr.includes(enT.monitor.units.rhr));
  const sleep = cardOf(html, 'sleep');
  assert.match(sleep, /hm-tone-bad/);
  assert.match(sleep, /aria-label="[^"]*Low/);
  assert.match(sleep, /<span class="db-arr db-bad" aria-hidden="true">▼<\/span>/);
});

test('the normal range is the small line under the value, written one decimal finer than the value', () => {
  const html = render(monitor());
  const rhr = cardOf(html, 'rhr');
  const c = monitor().cards.find((x) => x.key === 'rhr');
  const lo = c.band.lo.toFixed(1), hi = c.band.hi.toFixed(1);
  // short enough for one line next to a long name at 390 px: the bare range, the word lives in the label
  assert.ok(rhr.includes(`<span class="db-base">${lo}–${hi}</span>`), rhr);
  assert.equal(enT.monitor.rangeLbl, '{lo}–{hi}');
  assert.ok(rhr.includes(enT.monitor.rangeAria.replace('{lo}', lo).replace('{hi}', hi)), 'the screen reader still hears "Normal range"');
  assert.match(enT.monitor.rangeAria, /^Normal range /);
  assert.match(esT.monitor.rangeAria, /^Rango normal /);
  assert.doesNotMatch(rhr, /style=/);
});

test('the monitor note is behind an ⓘ toggle (collapsed), never lost', () => {
  const html = render(monitor());
  assert.match(html, /<button type="button" class="hs-i" data-hs-info="hm-info" aria-expanded="false" aria-controls="hm-info" aria-label="[^"]+">/);
  assert.ok(html.includes(`<div class="hs-info" id="hm-info" hidden><p>${enT.monitor.note}</p></div>`));
});

test('building baseline: value shown, status "building", no bar; missing series: "No data"', () => {
  const html = render(monitor());
  const hrv = cardOf(html, 'hrv');
  assert.ok(hrv.includes(`<span class="db-base">${enT.monitor.status.building}</span>`));
  assert.doesNotMatch(hrv, /db-arr/, 'no marker without a band');
  assert.match(hrv, /class="hm-num">\d+</);
  const temp = cardOf(html, 'wristTemp');
  assert.ok(temp.includes(enT.monitor.status.none));
  assert.match(temp, /hm-none/);
  assert.doesNotMatch(temp, /hm-num/);
});

test('a value from last night carries no date; an older one shows its date', () => {
  const html = render(monitor());
  assert.doesNotMatch(cardOf(html, 'rhr'), /Sep</);
  assert.match(cardOf(html, 'sleep'), /<span class="db-base">[^<]* · 26 Sep<\/span>/, 'the shared display date (no weekday), never ISO');
  assert.match(cardOf(render(monitor(), { locale: 'es' }), 'sleep'), / · 26 sept<\/span>/);
  assert.match(cardOf(render(monitor(), { now: addDays(ASOF, 1) }), 'rhr'), / · 29 Sep<\/span>/, 'yesterday-dated reading is not last night');
});

test('es: Alto / Bajo / Normal, decimal comma, Spanish units', () => {
  const html = render(monitor(), { locale: 'es' });
  assert.match(cardOf(html, 'respiratory'), /aria-label="[^"]*Alto/);
  assert.match(cardOf(html, 'sleep'), /aria-label="[^"]*Bajo/);
  assert.match(cardOf(html, 'rhr'), /aria-label="[^"]*Normal/);
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
  assert.doesNotMatch(sleep, /hm-tone-|db-arr/);
  assert.ok(sleep.includes(`<span class="db-base">${enT.monitor.status.stale}</span>`));
  assert.doesNotMatch(sleep, /Low/, 'no Low for an old reading');
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
  assert.ok(sum.includes(`<span class="hmt-lbl">${enT.monitor.heading}<span class="chev" aria-hidden="true">›</span></span>`));
  assert.match(sum, /<span class="hmt-srow"><span class="hmt-sq hmt-out" aria-hidden="true">!<\/span><span class="hmt-body"><span class="hmt-chip hmt-out">/, 'an orange "!" square left of the status');
  assert.ok(sum.includes(enT.monitor.tile.out.replace('{n}', '2')));
  assert.ok(sum.includes(enT.monitor.tile.metrics.replace('{n}', '1').replace('{total}', '5')));
  assert.doesNotMatch(html, /NaN|undefined|<script|src=|href=/);
});

test('tile 1: every fresh signal in range -> a teal check square + "within range"; nothing fresh -> "no data", no square', () => {
  const ok = monitorFromInputs({ rhr: series({ base: 50, amp: 1, last: 50 }), hrv: series({ base: 60, amp: 2, last: 60 }) });
  const html = tilesOf(ok);
  assert.match(html, /<span class="hmt-sq hmt-in" aria-hidden="true"><svg class="hmt-ico"[^>]*aria-hidden="true">[\s\S]*?<\/svg><\/span><span class="hmt-body"><span class="hmt-chip hmt-in">Within range/, 'a teal check square left of the status, no second check in the chip');
  assert.ok(html.includes(enT.monitor.tile.inRange));
  assert.ok(html.includes(enT.monitor.tile.metrics.replace('{n}', '2').replace('{total}', '5')));
  const none = tilesOf(monitorFromInputs({}));
  assert.match(none, /hmt-chip hmt-none/);
  assert.doesNotMatch(none, /hmt-sq/, 'no status square without fresh data');
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
  assert.ok(t.includes(`<span class="hmt-lbl">${enT.monitor.labels.hrv}<span class="chev" aria-hidden="true">›</span></span>`));
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

/* ---- day stepping (the top bar's ‹ TODAY ›): the Inicio tiles follow the selected day ---- */
const PAST = '2026-09-25';
const DAYS = { from: '2026-09-16', to: ASOF, days: [
  { date: PAST, monitor: { inR: 3, out: 1, total: 5, hrv: { value: 58, dec: 0, status: 'low', tone: 'bad', date: '2026-09-24' } } },
  { date: '2026-09-26', monitor: { inR: 4, out: 0, total: 5, hrv: null } },
] };
function stepper(sel) {
  const subs = [];
  return { sel: () => sel, on: (fn) => subs.push(fn), go: (x) => { sel = x; subs.forEach((fn) => fn(x)); } };
}

test('day stepping: today selected renders the tiles byte-identically', () => {
  const a = { innerHTML: '' }, b = { innerHTML: '' };
  render(monitor(), { tiles: a, detail: true });
  render(monitor(), { tiles: b, detail: true, day: stepper(null), days: DAYS });
  assert.equal(b.innerHTML, a.innerHTML);
});

test('day stepping: a past day shows THAT day\'s summary and HRV card (dated when older), opening on that day; the Salud list stays the latest', () => {
  const tiles = { innerHTML: '' };
  const list = render(monitor(), { tiles, detail: true, day: stepper(PAST), days: DAYS });
  const h = tiles.innerHTML;
  assert.ok(h.includes(enT.monitor.tile.out.replace('{n}', '1')));
  assert.ok(h.includes(enT.monitor.tile.metrics.replace('{n}', '3').replace('{total}', '5')));
  assert.match(h, /hmt-hrv hm-tone-bad" data-detail="hrv" data-date="2026-09-25"/);
  assert.match(h, /<b>58<\/b>/);
  assert.ok(h.includes('Thu 24 Sep'), 'the card\'s own date, not the day shown');
  assert.equal(list, render(monitor(), { detail: true }), 'the Salud list is untouched');
});

test('day stepping: a past day without HRV spans one tile; one without an entry reads "No data"; a change re-renders', () => {
  const tiles = { innerHTML: '' };
  const day = stepper('2026-09-26');
  render(monitor(), { tiles, day, days: DAYS });
  assert.match(tiles.innerHTML, /hm-tiles hm-tiles-one/);
  assert.ok(tiles.innerHTML.includes(enT.monitor.tile.inRange));
  day.go('2026-09-20');
  assert.ok(tiles.innerHTML.includes(enT.monitor.tile.none));
  assert.doesNotMatch(tiles.innerHTML, /hmt-hrv/);
  const today = { innerHTML: '' };
  render(monitor(), { tiles: today });
  day.go(null);
  assert.equal(tiles.innerHTML, today.innerHTML);
});

/* ---- tile 2 = the stress monitor (lib/score/stress.mjs, SCORES.stress) when a day has a value ---- */
const sday = (date, v, band, t = '14', avg = 1.4) => ({ date, rhr: 50, n: 8, avg, band: 'medium', now: { t, v, band }, mins: { low: 120, medium: 300, high: 60 }, hours: [] });
const STRESS = { ok: true, asOf: ASOF, maxHr: 190, minHours: 6, days: [
  sday('2026-09-25', 2.4, 'high', '20'),
  { date: '2026-09-26', rhr: 50, n: 3, avg: null, band: null, now: null, mins: null, hours: [] },
  sday(ASOF, 1.8, 'medium'),
] };
const stressTile = (html) => (html.match(/<div class="hmt hmt-stress[\s\S]*?<!--\/hmt-->/) || [''])[0];

test('tile 2 = Stress monitor: the latest hour\'s value chip, its band word in the band colour, the hour; opens the stress page', () => {
  const html = tilesOf(monitor(), { detail: true, stress: STRESS });
  const t = stressTile(html);
  assert.ok(t, 'stress tile rendered');
  assert.match(t, /class="hmt hmt-stress hmt-sb-medium" data-detail="stress" role="button"/);
  assert.ok(t.includes(`<span class="hmt-lbl">${enT.monitor.stress.label}<span class="chev" aria-hidden="true">›</span></span>`));
  assert.ok(t.includes('<span class="hmt-sv">1.8</span>'));
  assert.ok(t.includes(`<span class="hmt-band">${enT.monitor.stress.bands.medium}</span>`));
  assert.ok(t.includes('<span class="hmt-sub">14:00</span>'));
  assert.doesNotMatch(html, /hmt-hrv/, 'stress replaces the HRV tile');
  assert.match(html, /class="hm-tiles"/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('tile 2 falls back to HRV without a stress value: none baked, too few hours, or older than 3 days', () => {
  const mon = monitorFromInputs({ hrv: series({ base: 60, amp: 2, last: 61 }) });
  for (const stress of [null, { ok: false, reason: 'noMaxHr', asOf: ASOF }, { ...STRESS, days: STRESS.days.slice(0, 2) }]) {
    const html = tilesOf(mon, { detail: true, stress });
    assert.doesNotMatch(html, /hmt-stress/);
    assert.match(html, /hmt-hrv/);
  }
  // the newest day is 4 days old: no stress tile
  assert.doesNotMatch(tilesOf(mon, { stress: STRESS, now: addDays(ASOF, 4) }), /hmt-stress/);
  // 1 day old: still shown, dated
  const y = stressTile(tilesOf(mon, { stress: STRESS, now: addDays(ASOF, 1), detail: true }));
  assert.ok(y.includes('Tue 29 Sep · 14:00'));
});

test('day stepping: a past day with a stress value shows it (opening that day); one without falls back to its HRV', () => {
  const tiles = { innerHTML: '' };
  const day = stepper('2026-09-25');
  render(monitor(), { tiles, day, days: DAYS, stress: STRESS, detail: true });
  const t = stressTile(tiles.innerHTML);
  assert.match(t, /hmt-sb-high" data-detail="stress" data-date="2026-09-25"/);
  assert.ok(t.includes('<span class="hmt-sv">2.4</span>'));
  assert.ok(t.includes('<span class="hmt-sub">20:00</span>'));
  day.go('2026-09-26');
  assert.doesNotMatch(tiles.innerHTML, /hmt-stress/);
});

test('es stress tile: Spanish copy, decimal comma', () => {
  const t = stressTile(tilesOf(monitor(), { locale: 'es', stress: STRESS, detail: true }));
  assert.ok(t.includes('<span class="hmt-sv">1,8</span>'));
  assert.ok(t.includes(`>${esT.monitor.stress.bands.medium}<`));
  assert.equal(esT.monitor.stress.bands.medium, 'Medio');
});
