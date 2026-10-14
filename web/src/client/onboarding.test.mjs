/* Tests for the in-page onboarding (web/src/client/onboarding.js): runs the classic script in a vm with
 * HC_ENERGY emitted from lib/nutrition/energy.mjs (the page's own global), I18N_ONB, a stub HCFood.api /
 * HCSettings / HCDetail and a fixed clock, then drives the steps through its delegated listeners. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { energySource } from '../../../lib/nutrition/client.mjs';
import { computeTargets } from '../../../lib/nutrition/energy.mjs';
import { es as esO, en as enO } from '../i18n/onboarding-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'onboarding.js'), 'utf8');

function setup({ locale = 'en', profile = null, settings = { goal: null }, protocol = 'http:', later = false, putFails = false, hash = '' } = {}) {
  const listeners = {};
  const calls = [];
  const opened = [];
  const saved = [];
  let closed = 0;
  let synced = 0;
  const store = later ? { 'hc.onboarding.later': '1' } : {};
  const api = (method, p, body) => {
    calls.push([method, p, body && JSON.parse(JSON.stringify(body))]);
    if (method === 'GET' && p === '/profile') return Promise.resolve({ profile });
    if (method === 'GET' && p === '/settings') return Promise.resolve({ settings });
    if (method === 'PUT' && p === '/profile') return putFails ? Promise.reject({ status: 0 }) : Promise.resolve({ profile: body });
    return Promise.reject({ status: 404 });
  };
  const win = {
    HCFood: { api },
    HCSettings: { saveGoal: (g) => { saved.push(['goal', g]); return Promise.resolve(); }, saveTarget: (t) => { saved.push(['target', t]); return Promise.resolve(); } },
    HCDetail: { open: (k, d, o) => opened.push([k, o && o.focus]), close: () => { closed += 1; } },
    // the profile sheet registers before this script on the page (manifest order)
    HCViews: { profile: { title: () => 'Profile', render: () => ({ head: '', body: '' }) } },
  };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : ['2026-10-14T12:00:00'])); }
    static now() { return new RealDate('2026-10-14T12:00:00').getTime(); }
  }
  const ctx = {
    window: win,
    document: {
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
      getElementById: (id) => (id === 'sync-btn' ? { hidden: false, click: () => { synced += 1; } } : null),
    },
    location: { protocol, origin: 'http://192.168.1.50:8091', hash },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    PROFILE: { weight: { kg: 60, date: '2026-10-13' } },
    I18N_ONB: locale === 'es' ? esO : enO,
    LOCALE: locale,
    Promise, Date: FakeDate, Math, String, Number, Array, Object, JSON, isFinite, parseInt,
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(energySource(), ctx);
  vm.runInContext(source, ctx);
  const el = (attrs, extra = {}) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null), closest: (sel) => (sel.includes(Object.keys(attrs)[0]) ? el(attrs, extra) : null), ...extra });
  const fire = (type, target) => (listeners[type] || []).forEach((fn) => fn({ type, target }));
  const field = (key, value, type = 'text') => fire('input', el({ 'data-onb-field': key }, { value, type, checked: value === true }));
  const choose = (key, value) => fire('change', el({ 'data-onb-field': key }, { value, type: 'radio' }));
  const tick = (key) => fire('change', el({ 'data-onb-field': key }, { type: 'checkbox', checked: true }));
  const cellEdit = (cell, value) => fire('change', el({ 'data-onb-cell': cell }, { value }));
  const act = (a) => fire('click', el({ 'data-onb-act': a }));
  const view = win.HCViews.onboarding;
  const html = () => view.render().body;
  return { win, view, html, field, choose, tick, cellEdit, act, calls, opened, saved, store, get closed() { return closed; }, get synced() { return synced; }, onb: win.HCOnboarding, fire, el };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const clean = (h) => assert.doesNotMatch(h, /NaN|undefined|Infinity|\[object/);
function fillAbout(s, { sex = 'female', birthdate = '1997-05-20', height = '165', weight = '60' } = {}) {
  s.choose('sex', sex);
  s.field('birthdate', birthdate);
  s.field('heightCm', height);
  s.field('weightKg', weight);
}

test('registers the onboarding view, titled by the locale; step 1 asks about you and the safety questions', () => {
  const s = setup();
  assert.equal(s.view.title(), 'Set up');
  assert.equal(setup({ locale: 'es' }).view.title(), 'Configurar');
  const h = s.html();
  clean(h);
  assert.match(h, /Step 1 of 4/);
  for (const k of ['name', 'sex', 'birthdate', 'heightCm', 'weightKg', 'activity', 'medical', 'eating1', 'eating2']) assert.match(h, new RegExp(`data-onb-field="${k}"`), k);
  assert.match(h, /value="60"/, 'the newest weigh-in prefills the weight');
});

test('step 1 refuses missing / out-of-range answers and stays (inline errors)', () => {
  const s = setup();
  s.field('weightKg', '');
  s.act('next');
  const h = s.html();
  assert.match(h, /Step 1 of 4/);
  assert.match(h, /aria-invalid="true"/);
  assert.match(h, /this tool is for adults/);
  assert.match(h, /Weight between 30 and 250 kg/);
});

test('the full path: goal + target weight checks, the computed numbers, saving the document then Sync', async () => {
  const s = setup();
  fillAbout(s);
  s.act('next');
  assert.match(s.html(), /Step 2 of 4/);
  s.choose('goal', 'cut');
  s.field('target', '45');
  s.act('next');
  assert.match(s.html(), /below a healthy weight/, 'target BMI 16.5 refused');
  s.field('target', '62');
  s.act('next');
  assert.match(s.html(), /other way/, 'a cut target above the current weight is refused');
  s.field('target', '57');
  s.act('next');
  const h3 = s.html();
  assert.match(h3, /Step 3 of 4/);
  const own = computeTargets({ sex: 'female', age: 29, heightCm: 165, weightKg: 60, activity: 'light' }).targets;
  assert.match(h3, new RegExp(`data-onb-cell="rest.kcal"[^>]*value="${own.cut.rest.kcal}"`));
  assert.match(h3, new RegExp(`data-onb-cell="bikeLong.kcal"[^>]*value="${own.cut.bikeLong.kcal}"`));
  clean(h3);

  s.cellEdit('rest.kcal', '1000');
  assert.match(s.html(), /Below the safe minimum \(1200 kcal\)/);
  s.act('next');
  assert.match(s.html(), /Step 3 of 4/, 'a hard bound blocks the step');
  s.act('reset');
  s.act('next');
  const h4 = s.html();
  assert.match(h4, /Step 4 of 4/);
  assert.match(h4, /<code>http:\/\/192\.168\.1\.50:8091<\/code>/);
  assert.doesNotMatch(h4, /\/ingest\//, 'the page never names a data endpoint');
  assert.match(h4, /icloud\.com\/shortcuts\//);
  assert.doesNotMatch(h4, /Bearer [0-9a-f]{16,}/, 'no token on the page');

  s.act('save');
  await flush(); await flush(); await flush();
  const put = s.calls.find((c) => c[0] === 'PUT');
  assert.equal(put[1], '/profile');
  assert.deepEqual(put[2].targets, own);
  assert.deepEqual(put[2].goals, ['maintain', 'cut', 'bulk']);
  assert.equal(put[2].sex, 'female');
  assert.equal(put[2].birthdate, '1997-05-20');
  assert.equal('pregnant' in put[2] || 'medical' in put[2] || 'eating1' in put[2], false, 'safety answers are not stored');
  assert.deepEqual(s.saved, [['goal', 'cut'], ['target', 57]]);
  assert.equal(s.closed, 1);
  assert.equal(s.synced, 1, 'the page Sync runs so the next build bakes the targets');
});

test('an edited cell is what gets saved (the chosen goal only)', async () => {
  const s = setup();
  fillAbout(s);
  s.act('next');
  s.act('next'); // maintain
  s.cellEdit('gym.p', '120');
  s.act('next');
  s.act('save');
  await flush(); await flush(); await flush();
  const put = s.calls.find((c) => c[0] === 'PUT');
  assert.equal(put[2].targets.maintain.gym.p, 120);
  assert.deepEqual(s.saved, [['goal', 'maintain'], ['target', null]]);
});

test('a failed save keeps the sheet open with the reason', async () => {
  const s = setup({ putFails: true });
  fillAbout(s);
  s.act('next'); s.act('next'); s.act('next');
  s.act('save');
  await flush(); await flush();
  assert.match(s.html(), /Could not save \(no connection\)/);
  assert.equal(s.synced, 0);
  assert.deepEqual(s.saved, []);
});

test('safety screen: pregnancy or under 18 -> no numbers, a referral; illness / eating answers -> maintenance only', () => {
  const p = setup();
  fillAbout(p);
  p.tick('pregnant');
  p.act('next');
  assert.match(p.html(), /midwife/);
  assert.doesNotMatch(p.html(), /data-onb-cell/);

  const m = setup();
  fillAbout(m, { birthdate: '2010-01-01' });
  m.act('next');
  assert.match(m.html(), /This tool is for adults/);

  const med = setup();
  fillAbout(med);
  med.tick('medical');
  med.act('next');
  const h = med.html();
  assert.match(h, /only maintenance is offered/);
  assert.match(h, /value="maintain"/);
  assert.doesNotMatch(h, /value="cut"/);
});

test('"Later" closes and is remembered (localStorage)', () => {
  const s = setup();
  s.act('later');
  assert.equal(s.closed, 1);
  assert.equal(s.store['hc.onboarding.later'], '1');
});

test('first run opens it once: no profile and no goal on the server; never with a goal, a postponement or from a file', async () => {
  for (const hash of ['', '#home']) {
    const fresh = setup({ hash });
    await flush(); await flush();
    assert.deepEqual(fresh.opened.map((o) => o[0]), ['onboarding'], `hash "${hash}" (a tab hash is not a deep link)`);
  }
  for (const opts of [{ settings: { goal: 'cut' } }, { later: true }, { profile: { sex: 'male' } }, { hash: '#profile' }, { hash: '#detail/sleep' }]) {
    const s = setup(opts);
    await flush(); await flush();
    assert.deepEqual(s.opened, [], JSON.stringify(opts));
  }
  const file = setup({ protocol: 'file:' });
  await flush(); await flush();
  assert.deepEqual(file.calls, [], 'no LAN call from file://');
});
