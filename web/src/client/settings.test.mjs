/* web/src/client/settings.js — the server-side goal + target weight (LAN page). Runs the real food scripts (food-*.js)
 * (its API client: X-HC-Food, JSON, coarse codes) and settings.js in node:vm with a stubbed fetch and a
 * stand-in for nutri-day.js's window.HCNutri; nothing real is requested. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { loadUtil, FOOD_SOURCE } from '../../test/client-util.mjs';
import { es as esF } from '../i18n/food-templates.mjs';
import { FOOD_MEALS, FOOD_STORES, FOOD_UNITS, FOOD_LIMITS, SETTINGS_GOALS } from '../../../lib/nutrition/foodlog.mjs';
import { MEAL_GROUPS, MAIN_SLOTS, ADDON_GROUP, ADDON_SLOT } from '../../../lib/nutrition/slots.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const foodSource = FOOD_SOURCE; // the four food scripts, in page order
const source = fs.readFileSync(path.join(here, 'settings.js'), 'utf8');
const FOOD_CONST = { meals: FOOD_MEALS, stores: FOOD_STORES, units: FOOD_UNITS, limits: FOOD_LIMITS, goals: SETTINGS_GOALS, groups: MEAL_GROUPS, mainSlots: MAIN_SLOTS, addonGroup: ADDON_GROUP, addonSlot: ADDON_SLOT };
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });
const SET = (goal, targetWeightKg = null) => json({ settings: { goal, targetWeightKg, updatedAt: '2030-01-10T10:00:00.000Z' } });

function nutriStub(goal = 'maintain', stored = null, pending = null) {
  const n = { goal, applied: [], stored, pending };
  n.pendingGoal = () => n.pending;
  n.clearPending = (g) => { if (n.pending === g) n.pending = null; };
  n.state = () => ({ goal: n.goal });
  n.applyGoal = (g) => { n.applied.push(g); n.goal = g; return true; };
  n.storedGoal = () => n.stored;
  return n;
}
/** routes: {'GET /api/food/settings': response | fn(init, n)}; unknown -> a network error (offline) */
function setup({ routes = {}, nutri = nutriStub() } = {}) {
  const calls = [];
  const counts = {};
  const fetch = async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    calls.push({ key, init, body: init.body ? JSON.parse(init.body) : undefined });
    counts[key] = (counts[key] || 0) + 1;
    const r = routes[key];
    if (r === undefined) throw new TypeError('Failed to fetch');
    return typeof r === 'function' ? r(init, counts[key]) : r;
  };
  const doc = new StubDocument();
  const docListeners = {};
  doc.addEventListener = (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); };
  doc.hidden = false;
  // collected timers; clearTimeout really cancels (the request timeout of HC.fetchTimeout is cleared on an answer)
  const timers = [];
  let nextId = 0;
  const setTimeout = (fn, ms) => { timers.push({ fn, ms, id: ++nextId }); return nextId; };
  const clearTimeout = (id) => { const i = timers.findIndex((x) => x.id === id); if (i !== -1) timers.splice(i, 1); };
  const window = { HCNutri: nutri };
  const ctx = {
    document: doc, window, I18N_FOOD: esF, FOOD_CONST, FOOD_BASICS: [], LOCALE: 'es',
    Math, JSON, Number, String, Object, Array, Promise, isFinite, fetch, Uint8Array, setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(foodSource, ctx);
  vm.runInContext(source, ctx);
  const tick = () => { const due = timers.splice(0); due.forEach((x) => x.fn()); return due.map((x) => x.ms); };
  const visible = () => (docListeners.visibilitychange || []).forEach((fn) => fn({}));
  return { calls, window, nutri, tick, visible, S: window.HCSettings };
}

test('no settings API (artifact, file://, example build): not ready, no goal applied, nothing written', async () => {
  const t = setup();
  await flush();
  assert.equal(t.S.ready(), false);
  assert.equal(t.S.targetWeight(), null);
  assert.deepEqual(t.nutri.applied, []);
  assert.deepEqual(t.calls.map((c) => c.key), ['GET /api/food/products', 'GET /api/food/settings']);
  await assert.rejects(t.S.saveGoal('cut'), (e) => e.code === 'offline');
  assert.equal(t.calls.length, 2, 'never PUTs without the API');
});

test('the server goal is the source of truth: applied through HCNutri.applyGoal, the target read, X-HC-Food sent', async () => {
  const t = setup({ routes: { 'GET /api/food/settings': SET('cut', 72.5) } });
  await flush();
  assert.equal(t.S.ready(), true);
  assert.equal(t.S.goal(), 'cut');
  assert.equal(t.S.targetWeight(), 72.5);
  assert.deepEqual(t.nutri.applied, ['cut']);
  const get = t.calls.find((c) => c.key === 'GET /api/food/settings');
  assert.equal(get.init.headers['X-HC-Food'], '1');
  // the same goal as the local one: nothing to apply
  const same = setup({ routes: { 'GET /api/food/settings': SET('maintain') } });
  await flush();
  assert.deepEqual(same.nutri.applied, []);
});

test('one-time migration: a server without a goal gets the one this viewer stored; nothing stored = nothing sent', async () => {
  const t = setup({ routes: { 'GET /api/food/settings': SET(null), 'PUT /api/food/settings': SET('bulk') }, nutri: nutriStub('bulk', 'bulk') });
  await flush();
  const put = t.calls.filter((c) => c.key === 'PUT /api/food/settings');
  assert.deepEqual(put.map((c) => c.body), [{ goal: 'bulk' }]);
  assert.equal(put[0].init.headers['Content-Type'], 'application/json');
  assert.equal(t.S.goal(), 'bulk');
  const none = setup({ routes: { 'GET /api/food/settings': SET(null) } });
  await flush();
  assert.equal(none.calls.filter((c) => c.key === 'PUT /api/food/settings').length, 0, 'the plan default is never pushed');
});

test('a PENDING goal (picked here, never confirmed) wins over the server and is pushed; a success clears it', async () => {
  const nutri = nutriStub('bulk', 'bulk', 'bulk');
  const t = setup({ nutri, routes: { 'GET /api/food/settings': SET('cut'), 'PUT /api/food/settings': SET('bulk') } });
  await flush();
  assert.deepEqual(nutri.applied, [], 'the server goal never overwrites the pending one');
  assert.deepEqual(t.calls.filter((c) => c.key === 'PUT /api/food/settings').map((c) => c.body), [{ goal: 'bulk' }]);
  assert.equal(nutri.pending, null, 'confirmed');
  assert.equal(t.S.state().pending, null);
});

test('a failed goal PUT stays pending and is retried when the page becomes visible again', async () => {
  const nutri = nutriStub('bulk', 'bulk', 'bulk');
  const t = setup({ nutri, routes: { 'GET /api/food/settings': SET('cut'), 'PUT /api/food/settings': (init, n) => (n === 1 ? json({ error: 'rate_limited' }, 429) : SET('bulk')) } });
  await flush();
  assert.equal(nutri.pending, 'bulk');
  assert.equal(t.S.state().pending, 'bulk', 'the profile can say "pendiente de guardar"');
  assert.equal(t.S.state().last.status, 'error');
  t.visible();
  await flush();
  assert.equal(t.calls.filter((c) => c.key === 'PUT /api/food/settings').length, 2);
  assert.equal(nutri.pending, null);
});

test('GET /settings is retried with backoff on offline / 5xx (3 tries in all), never on 404 / 503', async () => {
  const t = setup({ routes: { 'GET /api/food/settings': (init, n) => (n < 3 ? json({ error: 'internal' }, 500) : SET('cut')) } });
  await flush();
  assert.deepEqual(t.tick(), [1000]);
  await flush();
  assert.deepEqual(t.tick(), [3000]);
  await flush();
  assert.equal(t.S.ready(), true);
  assert.equal(t.calls.filter((c) => c.key === 'GET /api/food/settings').length, 3);
  const off = setup(); // offline every time: 3 tries, then it stops
  await flush(); off.tick(); await flush(); off.tick(); await flush();
  assert.deepEqual(off.tick(), [], 'no fourth try');
  assert.equal(off.calls.filter((c) => c.key === 'GET /api/food/settings').length, 3);
  for (const status of [404, 503]) {
    const no = setup({ routes: { 'GET /api/food/settings': json({ error: 'x' }, status) } });
    await flush();
    assert.deepEqual(no.tick(), [], `${status}: final`);
    assert.equal(no.S.ready(), false);
  }
  // a server never reached is tried again when the page becomes visible
  off.visible();
  await flush();
  assert.equal(off.calls.filter((c) => c.key === 'GET /api/food/settings').length, 4);
});

test('saveTarget: a partial PUT of the target (1 decimal), null clears it; out-of-range is refused before any request', async () => {
  const t = setup({ routes: { 'GET /api/food/settings': SET('cut'), 'PUT /api/food/settings': (init) => SET('cut', JSON.parse(init.body).targetWeightKg) } });
  await flush();
  const seen = [];
  t.S.onChange((s) => seen.push(s.last && s.last.status));
  await t.S.saveTarget(72.46);
  assert.equal(t.S.targetWeight(), 72.5);
  await t.S.saveTarget(null);
  assert.equal(t.S.targetWeight(), null);
  const bodies = t.calls.filter((c) => c.key === 'PUT /api/food/settings').map((c) => c.body);
  assert.deepEqual(bodies, [{ targetWeightKg: 72.5 }, { targetWeightKg: null }]);
  assert.deepEqual(seen, ['saving', 'saved', 'saving', 'saved']);
  await assert.rejects(t.S.saveTarget(20), (e) => e.code === 'invalid');
  await assert.rejects(t.S.saveGoal('shred'), (e) => e.code === 'invalid');
  assert.equal(t.calls.filter((c) => c.key === 'PUT /api/food/settings').length, 2);
});

test('a refused save reports its coarse code to the listeners and keeps the last stored value', async () => {
  const t = setup({ routes: { 'GET /api/food/settings': SET('cut', 70), 'PUT /api/food/settings': json({ error: 'rate_limited' }, 429) } });
  await flush();
  let last = null;
  t.S.onChange((s) => { last = s.last; });
  await assert.rejects(t.S.saveTarget(68), (e) => e.code === 'rate_limited');
  assert.deepEqual(JSON.parse(JSON.stringify(last)), { what: 'target', status: 'error', code: 'rate_limited' });
  assert.equal(t.S.targetWeight(), 70);
});

test('parseTarget: the food forms\' parser (decimal comma, a trailing kg), empty = no target, the 35–250 kg range', async () => {
  const t = setup();
  const P = (v) => JSON.parse(JSON.stringify(t.S.parseTarget(v)));
  assert.deepEqual(P('72,5'), { value: 72.5 });
  assert.deepEqual(P(' 80 kg '), { value: 80 });
  assert.deepEqual(P('72.46'), { value: 72.5 });
  assert.deepEqual(P(''), { value: null });
  assert.deepEqual(P('kg'), { value: null });
  assert.deepEqual(P('abc'), { error: 'number' });
  assert.deepEqual(P('80 g'), { error: 'number' }, 'another unit is an error, never converted');
  assert.deepEqual(P('34,9'), { error: 'range' });
  assert.deepEqual(P('251'), { error: 'range' });
  assert.deepEqual(JSON.parse(JSON.stringify(t.S.limits())), { min: 35, max: 250 });
});
