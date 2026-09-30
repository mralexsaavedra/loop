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

function load({ locale = 'en', at = '2026-09-29T12:00:00', HC_CONST = HC_CONST_BAKE } = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [at])); }
    static now() { return new RealDate(at).getTime(); }
  }
  const ctx = { LOCALE: locale, HC_CONST, Date: FakeDate, Math, String, Number, Array, Object, JSON };
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

test('duration: one formatter, units from the i18n dict', () => {
  const HC = load();
  const U = { h: 'h', min: 'min' };
  assert.equal(HC.duration(45, U), '45 min');
  assert.equal(HC.duration(60, U), '1 h');
  assert.equal(HC.duration(105.4, U), '1 h 45 min');
  assert.equal(HC.duration(0, U), '0 min');
});

test('the client scripts share HC instead of redefining the helpers or hard-coding the baked constants', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  for (const f of ['timeline.js', 'training-activity.js', 'monitor.js', 'score.js', 'health.js', 'intake.js']) {
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
