/* Tests for Entreno's 30-day calendar + cumulative training time (web/src/client/training-activity.js):
 * the classic script in a vm with baked ACTIVITY / I18N_ACTIVITY / LOCALE and a controllable clock. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activityFromRows, activityBake } from '../../../lib/training/activity.mjs';
import { es as esT, en as enT } from '../i18n/activity-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'training-activity.js'), 'utf8');
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ASOF = '2026-09-29';

// every 2nd day in the last 30 (60 min run), every 3rd day in the previous 30 (30 min gym)
const rows = [];
for (let i = 0; i < 30; i += 2) rows.push({ date: addDays(ASOF, -i), type: 'Running', dur: 60 });
for (let i = 30; i < 60; i += 3) rows.push({ date: addDays(ASOF, -i), type: 'HighIntensityIntervalTraining', dur: 30 });
rows.push({ date: ASOF, type: 'Cycling', dur: 45 });
const ACT = activityFromRows(rows);

function render(activity, { locale = 'en', now = ASOF, at } = {}) {
  const host = { innerHTML: '' };
  const RealDate = Date;
  const stamp = at || now + 'T12:00:00';
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [stamp])); }
    static now() { return new RealDate(stamp).getTime(); }
  }
  const ctx = {
    document: { getElementById: (id) => (id === 'train-activity' ? host : null) },
    ACTIVITY: activity == null ? activity : activityBake(activity), I18N_ACTIVITY: locale === 'es' ? esT : enT, LOCALE: locale, Date: FakeDate, Math, String, Number, Array, Object, JSON,
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return host.innerHTML;
}
const cells = (html) => [...html.matchAll(/<rect class="cal-cell cal-l(\d)"[^>]*><title>([^<]*)<\/title>/g)].map((m) => ({ level: +m[1], title: m[2] }));

test('calendar: 30 day cells ending at the viewer\'s today, level by total minutes, a title per cell (hover)', () => {
  const html = render(ACT);
  const c = cells(html);
  assert.equal(c.length, 30);
  assert.equal(c[29].title, `${ASOF}: 1 h 45 min (Run 1 h, Bike 45 min)`, 'today: run + ride summed into one day, split in the title');
  assert.equal(c[29].level, 4, '105 min -> 90+');
  assert.equal(c[28].level, 0);
  assert.equal(c[28].title, `${addDays(ASOF, -1)}: no training`);
  assert.equal(c[27].level, 3, '60 min -> 60–89');
  assert.ok(html.includes(enT.calHint.replace('{days}', '15')), '15 distinct active days');
  assert.equal((html.match(/class="cal-legend-sw cal-l\d"/g) || []).length, 5, 'a legend for the five levels');
  assert.doesNotMatch(html, /NaN|undefined|<script|href=|style=/);
});

test('cumulative: this 30 days vs the previous 30 as two SVG lines with end labels; the headline totals are written out', () => {
  const html = render(ACT);
  assert.equal((html.match(/<path class="cum-line cum-cur"/g) || []).length, 1);
  assert.equal((html.match(/<path class="cum-line cum-prev"/g) || []).length, 1);
  // last 30: 15 runs × 60 + 45 = 945 min = 15 h 45 min; previous 30: 10 × 30 = 300 min = 5 h
  assert.ok(html.includes('15 h 45 min'), 'current total');
  assert.ok(html.includes('5 h'), 'previous total');
  assert.ok(html.includes(enT.cur) && html.includes(enT.prev), 'legend labels, identity never colour-alone');
  assert.equal((html.match(/<rect class="cum-hit"[^>]*><title>/g) || []).length, 30, 'a hover target per day');
});

test('the viewer a day ahead of the data: windows end today (today empty), not stale', () => {
  const html = render(ACT, { now: addDays(ASOF, 1) });
  const c = cells(html);
  assert.equal(c[29].level, 0);
  assert.equal(c[28].title, `${ASOF}: 1 h 45 min (Run 1 h, Bike 45 min)`);
  assert.doesNotMatch(html, /sc-stale|act-stale/);
});

test('clock skew: the viewer\'s today EARLIER than the data -> windows end at the data date (its sessions stay visible), not stale', () => {
  for (const opts of [{ now: addDays(ASOF, -1) }, { now: addDays(ASOF, -40) }, { at: addDays(ASOF, -1) + 'T23:59:00' }]) {
    const html = render(ACT, opts);
    assert.equal(cells(html)[29].title, `${ASOF}: 1 h 45 min (Run 1 h, Bike 45 min)`, JSON.stringify(opts));
    assert.doesNotMatch(html, /act-stale/);
  }
});

test('clock edge: 23:59 ends the windows that day, 00:01 the next', () => {
  assert.equal(cells(render(ACT, { at: ASOF + 'T23:59:00' }))[29].title, `${ASOF}: 1 h 45 min (Run 1 h, Bike 45 min)`);
  const next = cells(render(ACT, { at: addDays(ASOF, 1) + 'T00:01:00' }));
  assert.equal(next[29].title, `${addDays(ASOF, 1)}: no training`);
});

test('stale data (> 3 days old): windows end at the data date, the block is greyed with a note', () => {
  const html = render(ACT, { now: addDays(ASOF, 10) });
  assert.match(html, /act-stale/);
  assert.ok(html.includes(enT.staleNote.replace('{days}', '10').replace('{date}', ASOF)));
  assert.equal(cells(html)[29].title, `${ASOF}: 1 h 45 min (Run 1 h, Bike 45 min)`);
});

test('empty state and resilience', () => {
  assert.ok(render({ hasData: false }).includes('No workouts yet'));
  assert.doesNotThrow(() => render(undefined));
  const broken = render({ hasData: true, asOf: ASOF, days: 'broken' });
  assert.doesNotMatch(broken, /NaN|undefined/);
});

test('es: Spanish copy and decimal-free h/min durations', () => {
  const html = render(ACT, { locale: 'es' });
  assert.ok(html.includes(esT.calHeading));
  assert.ok(html.includes('15 h 45 min'));
});
