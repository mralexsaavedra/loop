/* Tests for the Inicio energy bank card (web/src/client/energy.js): runs the classic script in a vm
 * with a baked SCORES.energy (SYNTHETIC values), I18N_SCORE and a controllable clock. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { es as esT, en as enT } from '../i18n/score-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'energy.js'), 'utf8');

const day = (date, start, levels, o = {}) => ({
  date, wake: '07:00', start,
  now: levels.length ? { h: 6 + levels.length, lv: Math.round(levels[levels.length - 1]) } : { h: null, lv: start },
  min: { h: 9, lv: Math.min(start, ...levels.map(Math.round)) },
  sum: { base: 1.5 * levels.length, stress: 3, load: o.load || 0, charge: 1 },
  hours: levels.map((lv, i) => ({ h: 7 + i, lv, st: 0.8, ld: 0, wo: false })),
});
const ENERGY = {
  ok: true, asOf: '2026-09-29', K: 100, maxHr: 180, C: {},
  days: [
    day('2026-09-27', 80, [78, 70, 66]),
    { date: '2026-09-28', reason: 'noRecovery', now: null },
    day('2026-09-29', 72, [70, 64.4, 60, 55.2]),
  ],
};

function render({ energy = ENERGY, locale = 'en', now = '2026-09-29', sel = null, detail = true } = {}) {
  const host = { innerHTML: '', hidden: true };
  const RealDate = Date;
  class FakeDate extends RealDate {
    static now() { return new RealDate(now + 'T18:00:00').getTime(); }
  }
  const listeners = [];
  const ctx = {
    document: { getElementById: (id) => (id === 'home-energy' ? host : null) },
    SCORES: { energy }, I18N_SCORE: locale === 'es' ? esT : enT, LOCALE: locale,
    HCDay: { sel: () => sel, on: (fn) => listeners.push(fn) },
    Date: FakeDate, Math, String, Number, Array, Object, JSON,
  };
  if (detail) ctx.DETAIL = { metrics: {} };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return { host, step: (d) => { sel = d; listeners.forEach((f) => f()); } };
}

test('today: the latest level big, an "estimate" label, the intraday curve from wake, opens the energy page', () => {
  const { host } = render();
  const h = host.innerHTML;
  assert.equal(host.hidden, false);
  assert.match(h, /data-detail="energy-bank"/);
  assert.doesNotMatch(h, /data-date=/, 'today opens the page on its own latest day');
  assert.match(h, /class="tn-h">Energy bank </);
  assert.match(h, />estimate</i);
  assert.match(h, /<b class="en-num">55<\/b>/);
  assert.match(h, /<svg class="en-sp"[^>]*aria-hidden="true"/);
  // the line starts at the wake level (72 of 100) and has one point per hour after it
  const d = /<path class="en-l" d="([^"]+)"/.exec(h)[1];
  assert.equal((d.match(/[ML]/g) || []).length, 5);
  assert.match(h, /de-mid/, '55 = the middle band colour');
  assert.match(h, /From 72 at 07:00/);
  assert.match(h, /aria-label="Energy bank estimate 55 of 100, latest hour 10:00/);
  assert.doesNotMatch(h, /<script|https?:/);
});

test('hidden without a bake, without a value, or when the newest valued day is stale', () => {
  for (const energy of [null, { ok: false, reason: 'noLoadScale', asOf: '2026-09-29' }, { ...ENERGY, days: [ENERGY.days[1]] }]) {
    const { host } = render({ energy });
    assert.equal(host.innerHTML, '');
    assert.equal(host.hidden, true);
  }
  const { host } = render({ now: '2026-10-09' });
  assert.equal(host.hidden, true, 'ten days old: no card');
});

test('day stepping: a past day shows its own level and opens on that day; a day without a value hides the card', () => {
  const r = render({ sel: '2026-09-27' });
  assert.match(r.host.innerHTML, /<b class="en-num">66<\/b>/);
  assert.match(r.host.innerHTML, /data-date="2026-09-27"/);
  r.step('2026-09-28');
  assert.equal(r.host.hidden, true);
  r.step(null);
  assert.match(r.host.innerHTML, /<b class="en-num">55<\/b>/);
  assert.equal(r.host.hidden, false);
});

test('a level band colours the curve: high >= 67, middle 34-66, low < 34', () => {
  const E = (lv) => ({ ...ENERGY, days: [day('2026-09-29', 90, [lv])] });
  assert.match(render({ energy: E(80) }).host.innerHTML, /de-hi/);
  assert.match(render({ energy: E(34) }).host.innerHTML, /de-mid/);
  assert.match(render({ energy: E(20) }).host.innerHTML, /de-lo/);
});

test('es: Spanish copy', () => {
  const h = render({ locale: 'es' }).host.innerHTML;
  assert.match(h, /class="tn-h">Banco de energía </);
  assert.match(h, />estimación</i);
  assert.match(h, /Desde 72 a las 07:00/);
});
