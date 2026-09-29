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

function render(mon, { locale = 'en', now = ASOF, healthNav = false } = {}) {
  const host = { innerHTML: '' };
  const RealDate = Date;
  class FakeDate extends RealDate {
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  const ctx = {
    document: { getElementById: (id) => (id === 'monitor' ? host : id === 't-health' && healthNav ? {} : null) },
    SCORES: mon === undefined ? undefined : { monitor: mon }, I18N_SCORE: locale === 'es' ? esT : enT, LOCALE: locale,
    Date: FakeDate, Math, String, Number, Array, Object, JSON,
  };
  vm.createContext(ctx);
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
  assert.ok(cardOf(html, 'sleep').includes(addDays(ASOF, -3)));
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

test('cards jump to their Salud trend via jumpOr only when the Salud tab is reachable', () => {
  const linked = render(monitor(), { healthNav: true });
  for (const k of ['respiratory', 'rhr', 'hrv', 'wristTemp', 'sleep']) {
    assert.match(cardOf(linked, k), new RegExp(`onclick="jumpOr\\('hl-${k}','health'\\)"`), k);
  }
  assert.doesNotMatch(render(monitor()), /jumpOr/);
});

test('stale monitor (> 3 days) is greyed; absent SCORES or host never throws', () => {
  assert.match(render(monitor(), { now: addDays(ASOF, 5) }), /hm sc-card sc-stale|sc-stale/);
  assert.doesNotThrow(() => render(undefined));
  assert.equal(render(undefined), '');
  const empty = render(monitorFromInputs({}));
  assert.equal((empty.match(/hm-none/g) || []).length, 5, 'all five say No data');
});
