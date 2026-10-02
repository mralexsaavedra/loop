/* web/src/client/adherence.js — Nutrición "Constancia" (food log adherence, LAN page). Runs the real
 * classic script in node:vm against web/test/dom-stub.mjs with a fixed clock, a stubbed HCFood.api and
 * a stand-in for HCNutri.targetFor; the port is pinned against lib/nutrition/adherence.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { loadUtil } from '../../test/client-util.mjs';
import { es as esN, en as enN } from '../i18n/nutri-templates.mjs';
import { ADHERENCE, ADHERENCE_CASES, isComplete, dayState } from '../../../lib/nutrition/adherence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'adherence.js'), 'utf8');
const TODAY = '2030-01-28';
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const text = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const G3 = { breakfast: 1, lunch: 1, dinner: 1, addon: 0 };
const day = (date, k, p, groups = G3, minP = false) => ({ date, k, p, c: 100, f: 50, n: 3, missing: { p: minP, c: false, f: false }, groups });

function fixedDate(iso) {
  const RealDate = Date;
  return class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(iso + 'T12:00:00'); }
    static now() { return new RealDate(iso + 'T12:00:00').getTime(); }
  };
}
function setup({ days = [], fail = false, locale = 'en', targetFor, food = true } = {}) {
  const doc = new StubDocument();
  const docListeners = {};
  doc.addEventListener = (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); };
  doc.hidden = false;
  // a controllable clock for the debounced reload: tick() runs what is due
  const timers = [];
  const setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].fn = null; };
  const tick = () => { const due = timers.splice(0); due.forEach((x) => x.fn && x.fn()); return due.filter((x) => x.fn).map((x) => x.ms); };
  const els = { block: doc.el('food-adherence-block', { hidden: true }), host: doc.el('food-adherence'), win: doc.el('adh-window') };
  const radios = ADHERENCE.windows.map((w) => doc.el(null, { tag: 'input', attrs: { name: 'adh-win', value: String(w) } }));
  const calls = [];
  const shown = [];
  const window = {
    HCNutri: { state: () => ({ goal: 'cut' }), targetFor: targetFor || ((d) => (d === '2030-01-20' ? null : { k: 2500, p: 150 })) },
  };
  if (food) {
    window.HCFood = {
      api: (method, p) => { calls.push(method + ' ' + p); return fail ? Promise.reject({ code: 'offline' }) : Promise.resolve({ from: 'x', to: 'y', days: typeof days === 'function' ? days() : days }); },
      showDay: (d) => { shown.push(d); return true; },
    };
  }
  const ctx = {
    document: doc, window, LOCALE: locale, NUTRI: { goal: 'maintain', adherence: ADHERENCE }, I18N_NUTRI: locale === 'es' ? esN : enN,
    Date: fixedDate(TODAY), Math, JSON, Number, String, Object, Array, Promise, isFinite, setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  const fire = (el, evt, target) => (el._listeners[evt] || []).forEach((fn) => fn({ target }));
  const visible = () => (docListeners.visibilitychange || []).forEach((fn) => fn({}));
  return { els, radios, calls, shown, window, fire, tick, visible, A: window.HCAdherence, ctx };
}
const cellTarget = (date) => ({ closest: (sel) => (sel === '[data-adh-day]' ? { getAttribute: () => date } : null) });

test('parity: the port computes exactly what lib/nutrition/adherence.mjs computes', () => {
  const { A } = setup({ food: false });
  for (const c of ADHERENCE_CASES) assert.deepEqual(JSON.parse(JSON.stringify(A.adherence(c.dates, c.days, c.targets))), c.expect, c.name);
  const samples = [null, day('2030-01-01', 2000, 100), day('2030-01-01', 2000, 100, { breakfast: 1, lunch: 0, dinner: 1, addon: 0 }), { ...day('2030-01-01', 0, null), n: 0 }];
  for (const d of samples) {
    assert.equal(A.isComplete(d), isComplete(d));
    for (const t of [null, { k: 2500, p: 150 }, { k: 1900, p: 150 }]) assert.equal(A.dayState(d, t), dayState(d, t));
  }
});

test('no food API or an unanswered summary: the block stays hidden, nothing rendered', async () => {
  const off = setup({ fail: true });
  await flush();
  assert.equal(off.els.block.hidden, true);
  assert.equal(off.els.host.innerHTML, '');
  const none = setup({ food: false });
  await flush();
  assert.equal(none.els.block.hidden, true);
});

test('reads the last 28 days ending at the viewer\'s today and shows logged / complete / mean vs target / protein, over complete days only', async () => {
  const t = setup({
    days: [
      day('2030-01-21', 3500, 160), // complete but outside the 7-day window (22-28)
      day('2030-01-23', 2000, 140), day('2030-01-24', 2600, 120), day('2030-01-25', 2950, 160, G3, true),
      day('2030-01-26', 800, 40, { breakfast: 1, lunch: 1, dinner: 0, addon: 2 }), day('2030-01-28', 2400, null),
    ],
  });
  await flush();
  assert.deepEqual(t.calls, ['GET /log/summary?from=2030-01-01&to=2030-01-28']);
  assert.equal(t.els.block.hidden, false);
  const h = text(t.els.host.innerHTML);
  assert.match(h, /Days logged 5 of 7/);
  assert.match(h, /Complete days 4 of 7/);
  assert.match(h, /Mean kcal 2488 target 2500 kcal · 100 %/);
  assert.match(h, /Days with protein ≥ 90 % 2 of 4 compared/);
  assert.match(h, /its total counts as a minimum/);
  assert.match(h, /Days without any protein data \(not counted as met\): 1\./);
  assert.match(h, /Complete = at least one entry in Breakfast, Lunch and Dinner/);
  assert.match(h, /your current goal \(Lose\) × the day type detected that day/);
  assert.doesNotMatch(t.els.host.innerHTML, /NaN|undefined|null/);
});

test('the 7 / 14 / 28-day switch changes the window; a complete day without a day type is counted apart', async () => {
  const t = setup({ days: [day('2030-01-20', 2500, 150), day('2030-01-21', 3500, 160)] });
  await flush();
  assert.match(text(t.els.host.innerHTML), /No complete days with a target in this period\./);
  t.fire(t.els.win, 'change', { value: '14' });
  const h = text(t.els.host.innerHTML);
  assert.match(h, /Complete days 2 of 14/);
  assert.match(h, /Complete days without a known day type, left out of the comparison: 1\./);
  assert.match(h, /Mean kcal 3500/);
  assert.equal(t.radios[1].checked, true);
  t.fire(t.els.win, 'change', { value: '99' });
  assert.match(text(t.els.host.innerHTML), /of 14/, 'an unknown window is ignored');
});

test('the 28-day strip: one >= 44px button per day with its state in words, today marked; a tap opens Registrar on that day', async () => {
  const t = setup({ days: [day('2030-01-27', 2500, 150), day('2030-01-26', 900, 50, { breakfast: 1, lunch: 0, dinner: 0, addon: 0 })] });
  await flush();
  const h = t.els.host.innerHTML;
  assert.equal((h.match(/class="adh-cell /g) || []).length, 28);
  assert.match(h, /data-adh-day="2030-01-27" aria-label="Sun 27 Jan: complete, on target \(±10 %\)\. Open in the log"/);
  assert.match(h, /class="adh-cell adh-partial" data-adh-day="2030-01-26"/);
  assert.match(h, /class="adh-cell adh-none adh-today" data-adh-day="2030-01-28" aria-label="Mon 28 Jan: nothing logged/);
  assert.match(h, /data-adh-day="2030-01-01"/, 'the oldest cell');
  t.fire(t.els.host, 'click', cellTarget('2030-01-26'));
  assert.deepEqual(t.shown, ['2030-01-26']);
});

test('reload after an add / delete re-reads the summary; a failed re-read shows a retry line once the block is shown', async () => {
  let n = 0;
  const t = setup({ days: () => (++n === 1 ? [] : [day('2030-01-28', 2500, 150)]) });
  await flush();
  assert.match(text(t.els.host.innerHTML), /Days logged 0 of 7/);
  t.A.reload();
  t.A.reload();
  t.A.reload();
  assert.equal(t.calls.length, 1, 'debounced: nothing read yet');
  assert.deepEqual(t.tick(), [300], 'one read after 300 ms (NUTRI.adherence.reloadMs), not three');
  await flush();
  assert.equal(t.calls.length, 2);
  assert.match(text(t.els.host.innerHTML), /Days logged 1 of 7/);
  t.window.HCFood.api = () => Promise.reject({ code: 'offline' });
  t.A.reload();
  t.tick();
  await flush();
  assert.match(text(t.els.host.innerHTML), /The log summary could not be read\. Retry/);
});

test('a throwing target lookup never blanks the block: those days are simply unknown', async () => {
  const t = setup({ days: [day('2030-01-28', 2500, 150)], targetFor: () => { throw new Error('boom'); } });
  await flush();
  assert.match(text(t.els.host.innerHTML), /Complete days without a known day type, left out of the comparison: 1/);
});

test('es: Spanish copy and thousands with a dot', async () => {
  const t = setup({ locale: 'es', days: [day('2030-01-27', 2600, 150), day('2030-01-28', 2400, 150)] });
  await flush();
  const h = text(t.els.host.innerHTML);
  assert.match(h, /Días completos 2 de 7/);
  assert.match(h, /Media de kcal 2500 objetivo 2500 kcal · 100 %/);
  assert.match(h, /Completo = al menos una entrada en Desayuno, Comida y Cena/);
});

test('an ASSUMED rest day (sleep only, no session) is labelled in the strip and left out of the means, counted apart', async () => {
  const t = setup({
    days: [day('2030-01-27', 1500, 80), day('2030-01-28', 2500, 150)],
    targetFor: (d) => (d === '2030-01-27' ? { k: 2500, p: 150, inferred: true } : { k: 2500, p: 150 }),
  });
  await flush();
  const h = text(t.els.host.innerHTML);
  assert.match(h, /Complete days 2 of 7/);
  assert.match(h, /Mean kcal 2500 target 2500 kcal · 100 %/, 'only the day with a detected type');
  assert.match(h, /Days with protein ≥ 90 % 1 of 1 compared/);
  assert.match(h, /Assumed rest days \(sleep only, no session\), left out of the comparison: 1\./);
  assert.match(t.els.host.innerHTML, /class="adh-cell adh-assumed" data-adh-day="2030-01-27" aria-label="Sun 27 Jan: complete, assumed rest day\. Open in the log"/);
  assert.match(h, /Assumed rest/, 'in the legend');
});

test('back on the page on another day (core.js waits while busy): the window is re-read so the strip ends at today', async () => {
  const t = setup({ days: [] });
  await flush();
  t.visible();
  assert.equal(t.calls.length, 1, 'same day: nothing to do');
  t.ctx.Date = fixedDate('2030-01-29');
  t.visible();
  await flush();
  assert.deepEqual(t.calls.at(-1), 'GET /log/summary?from=2030-01-02&to=2030-01-29');
  assert.match(t.els.host.innerHTML, /data-adh-day="2030-01-29"/);
});
