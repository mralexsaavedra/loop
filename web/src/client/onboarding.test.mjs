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
import { computeTargets, SPORTS } from '../../../lib/nutrition/energy.mjs';
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
  // Enter in a field or on a card: target inside the flow (closest('.onb')), not on a button
  const enter = (attrs = { 'data-onb-field': 'name' }, tag = 'INPUT') => {
    const t = { tagName: tag, getAttribute: (k) => (k in attrs ? attrs[k] : null), closest: (sel) => (sel === '.onb' ? {} : null) };
    let prevented = 0;
    (listeners.keydown || []).forEach((fn) => fn({ type: 'keydown', key: 'Enter', target: t, preventDefault: () => { prevented += 1; } }));
    return prevented;
  };
  const sport = (value, checked = true) => fire('change', el({ 'data-onb-field': 'sport' }, { value, type: 'checkbox', checked }));
  const view = win.HCViews.onboarding;
  const html = () => view.render().body;
  return { win, view, html, field, choose, tick, cellEdit, act, sport, enter, calls, opened, saved, store, get closed() { return closed; }, get synced() { return synced; }, onb: win.HCOnboarding, fire, el };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const clean = (h) => assert.doesNotMatch(h, /NaN|undefined|Infinity|\[object/);
const questions = (h) => (h.match(/class="onb-q"/g) || []).length;

// welcome -> name -> sex -> birth -> height -> weight -> activity -> sports -> one screen per sport -> safety
// -> goal -> target (not for maintain) -> summary -> data
function toSports(s, { sex = 'female', birthdate = '1997-05-20', height = '165', weight = '60', activity = 'light' } = {}) {
  s.act('next'); // welcome
  s.field('name', 'Ana'); s.act('next');
  s.choose('sex', sex); s.act('next');
  s.field('birthdate', birthdate); s.act('next');
  s.field('heightCm', height); s.act('next');
  s.field('weightKg', weight); s.act('next');
  s.choose('activity', activity); s.act('next');
}
function toSafety(s, picks = [['running', '90', '2'], ['strength', '60', '3']], about) {
  toSports(s, about);
  for (const [k] of picks) s.sport(k);
  s.act('next');
  for (const [, min, times] of picks) { s.choose('minutes', min); s.choose('perWeek', times); s.act('next'); }
}
const PERSON = { sex: 'female', age: 29, heightCm: 165, weightKg: 60, activity: 'light' };
const SPORTS_RS = [{ sport: 'running', minutes: 90, perWeek: 2 }, { sport: 'strength', minutes: 60, perWeek: 3 }];

test('registers the onboarding view, titled by the locale; it opens on a welcome cover', () => {
  const s = setup();
  assert.equal(s.view.title(), 'Set up');
  assert.equal(setup({ locale: 'es' }).view.title(), 'Configurar');
  const r = s.view.render();
  assert.equal(r.bare, true, 'its own header: one back arrow, the progress bar');
  const h = r.body;
  clean(h);
  assert.match(h, /id="dt-title"/);
  assert.match(h, /Let&#39;s work out your numbers|Let's work out your numbers/);
  for (const step of enO.welcome.steps) assert.ok(h.includes(step), step);
  assert.match(h, /class="onb-nav"[\s\S]*data-onb-act="next"[^>]*>Start</);
  assert.match(h, /data-onb-act="later"/);
  assert.doesNotMatch(h, /class="onb-prog"/, 'no progress on the cover');
});

test('one question per screen, a segmented progress bar that fills, and ONE back (the top arrow)', () => {
  const s = setup();
  s.act('next');
  const h1 = s.html();
  assert.equal(questions(h1), 1);
  assert.match(h1, /class="onb-prog"/);
  assert.match(h1, /data-onb-field="name"/);
  assert.doesNotMatch(h1, /data-onb-field="sex"/);
  assert.equal((h1.match(/data-onb-act="back"/g) || []).length, 1, 'one back control');
  assert.match(h1, /class="onb-top"><button[^>]*data-onb-act="back"/);
  const on = (h) => (h.match(/<i class="on">/g) || []).length;
  s.act('next');
  const h2 = s.html();
  assert.equal(questions(h2), 1);
  assert.match(h2, /data-onb-field="sex"/);
  assert.equal(on(h2), on(h1) + 1, 'one more segment filled');
  s.act('back');
  assert.match(s.html(), /data-onb-field="name"/);
});

test('height, weight and the target are large centred numbers; the date is a large field', () => {
  const s = setup();
  s.act('next'); s.act('next'); s.choose('sex', 'female'); s.act('next');
  assert.match(s.html(), /class="food-field onb-big"/);
  s.field('birthdate', '1997-05-20'); s.act('next');
  assert.match(s.html(), /class="food-field onb-big"[^>]*>[\s\S]*data-onb-field="heightCm"/);
  s.field('heightCm', '165'); s.act('next');
  assert.match(s.html(), /class="food-field onb-big"[^>]*>[\s\S]*data-onb-field="weightKg"/);
});

test('each screen refuses a missing / out-of-range answer and stays (inline error)', () => {
  const s = setup();
  s.act('next'); s.act('next'); // welcome, name (optional)
  s.act('next');
  assert.match(s.html(), /data-onb-field="sex"/);
  assert.match(s.html(), /Pick one/);
  s.choose('sex', 'male'); s.act('next');
  s.field('birthdate', '2026-02-30'); s.act('next');
  assert.match(s.html(), /this tool is for adults/);
  s.field('birthdate', '1990-01-01'); s.act('next');
  s.field('heightCm', '300'); s.act('next');
  assert.match(s.html(), /Height between 120 and 230 cm/);
  assert.match(s.html(), /aria-invalid="true"/);
  s.field('heightCm', '180'); s.act('next');
  assert.match(s.html(), /value="60"/, 'the newest weigh-in prefills the weight');
  s.field('weightKg', ''); s.act('next');
  assert.match(s.html(), /Weight between 30 and 250 kg/);
});

test('sports: every SPORTS key is a card; none picked is refused; each pick gets its own session screen', () => {
  const s = setup();
  toSports(s);
  const h = s.html();
  for (const k of Object.keys(SPORTS)) assert.match(h, new RegExp(`data-onb-field="sport" value="${k}"`), k);
  s.act('next');
  assert.match(s.html(), /Pick at least one/);
  s.sport('cycling'); s.sport('yoga'); s.sport('cycling', false); s.sport('running');
  s.act('next');
  const y = s.html();
  assert.match(y, /Yoga \/ pilates/);
  assert.match(y, /data-onb-field="minutes" value="60" checked/, 'a default session: 60 min');
  assert.match(y, /data-onb-field="perWeek" value="3" checked/);
  s.act('next');
  assert.match(s.html(), /class="onb-q">Running</, 'picked order');
  s.act('next');
  assert.match(s.html(), /data-onb-field="pregnant"/, 'then the safety screen');
});

test('the full path: summary with the weekly average and only the day types the sports reach; saving sends the sports', async () => {
  const s = setup();
  toSafety(s);
  s.act('next'); // safety, nothing ticked
  s.choose('goal', 'cut'); s.act('next');
  s.field('target', '45'); s.act('next');
  assert.match(s.html(), /below a healthy weight/);
  s.field('target', '57'); s.act('next');
  const h = s.html();
  clean(h);
  const own = computeTargets({ ...PERSON, sports: SPORTS_RS }).targets.cut;
  // a week: 3 short + 2 long sessions, 2 rest days
  const avg = Math.round((2 * own.rest.kcal + 3 * own.gym.kcal + 2 * own.bike.kcal) / 7 / 50) * 50;
  assert.match(h, new RegExp(`class="onb-ring">[\\s\\S]*class="kcal">${avg.toLocaleString('en-US')}<`), 'the average inside the ring');
  assert.match(h, /Rest day/);
  assert.match(h, /Short session/);
  assert.match(h, /Long session/);
  assert.doesNotMatch(h, /Very long session/, 'no sport reaches it');
  assert.match(h, /Strength/);
  assert.doesNotMatch(h, /data-onb-cell/, 'the number grid stays folded');
  s.act('next');
  const d = s.html();
  assert.match(d, /http:\/\/192\.168\.1\.50:8091/);
  assert.doesNotMatch(d, /\/ingest\//, 'the page never names a data endpoint');
  assert.match(d, /icloud\.com\/shortcuts\//);
  assert.match(d, /data-onb-act="save"/);
  s.act('save');
  await flush(); await flush(); await flush();
  const put = s.calls.find((c) => c[0] === 'PUT');
  assert.equal(put[1], '/profile');
  assert.deepEqual(put[2].sports, SPORTS_RS);
  assert.deepEqual(put[2].targets, computeTargets({ ...PERSON, sports: SPORTS_RS }).targets);
  assert.deepEqual(put[2].goals, ['maintain', 'cut', 'bulk']);
  assert.equal(put[2].name, 'Ana');
  assert.equal('pregnant' in put[2] || 'medical' in put[2] || 'eating1' in put[2], false, 'safety answers are not stored');
  assert.deepEqual(s.saved, [['goal', 'cut'], ['target', 57]]);
  assert.equal(s.closed, 1);
  assert.equal(s.synced, 1, 'the page Sync runs so the next build bakes the targets');
});

test('adjust: the grid edits the chosen goal of the used day types; a hard bound blocks; Recalculate drops edits', async () => {
  const s = setup();
  toSafety(s, [['yoga', '60', '3']]);
  s.act('next'); s.act('next'); // safety, maintain -> straight to the summary
  s.act('adjust');
  const h = s.html();
  assert.match(h, /data-onb-cell="gym\.kcal"/);
  assert.doesNotMatch(h, /data-onb-cell="bike\.kcal"/, 'only the day types the week has');
  s.cellEdit('rest.kcal', '1000');
  assert.match(s.html(), /Below the safe minimum \(1200 kcal\)/);
  s.act('next');
  assert.match(s.html(), /data-onb-cell="rest\.kcal"/, 'a hard bound blocks the step');
  s.act('reset');
  s.cellEdit('gym.p', '120');
  s.act('next');
  s.act('save');
  await flush(); await flush(); await flush();
  const put = s.calls.find((c) => c[0] === 'PUT');
  assert.equal(put[2].targets.maintain.gym.p, 120);
  assert.equal(put[2].targets.maintain.rest.kcal, computeTargets({ ...PERSON, sports: [{ sport: 'yoga', minutes: 60, perWeek: 3 }] }).targets.maintain.rest.kcal);
  assert.deepEqual(s.saved, [['goal', 'maintain'], ['target', null]]);
});

test('a failed save keeps the sheet open with the reason', async () => {
  const s = setup({ putFails: true });
  toSafety(s, [['team', '90', '2']]);
  s.act('next'); s.act('next'); s.act('next'); s.act('next');
  s.act('save');
  await flush(); await flush();
  assert.match(s.html(), /Could not save \(no connection\)/);
  assert.equal(s.synced, 0);
  assert.deepEqual(s.saved, []);
});

test('safety screen: pregnancy or under 18 -> no numbers, a referral; illness / eating answers -> maintenance only', () => {
  const p = setup();
  toSafety(p);
  p.tick('pregnant');
  p.act('next');
  assert.match(p.html(), /midwife/);
  assert.doesNotMatch(p.html(), /class="kcal"/);

  const m = setup();
  m.act('next'); m.act('next'); m.choose('sex', 'male'); m.act('next');
  m.field('birthdate', '2010-01-01'); m.act('next');
  assert.match(m.html(), /This tool is for adults/);

  const med = setup();
  toSafety(med);
  med.tick('medical');
  med.act('next');
  const h = med.html();
  assert.match(h, /only maintenance is offered/);
  assert.match(h, /value="maintain"/);
  assert.doesNotMatch(h, /value="cut"/);
});

test('the session chips cover the sports\' range: 30 min to 4 h, 1 to 7 times a week (es labels)', () => {
  const s = setup({ locale: 'es' });
  toSports(s);
  s.sport('cycling'); s.act('next');
  const h = s.html();
  assert.match(h, /class="onb-q">Bici</);
  assert.match(h, /data-onb-field="minutes" value="120" checked/, 'cycling defaults to 2 h');
  for (const m of [30, 45, 60, 90, 120, 180, 240]) assert.match(h, new RegExp(`data-onb-field="minutes" value="${m}"`));
  assert.match(h, />4:00</);
  assert.match(h, />45 min</);
  for (let n = 1; n <= 7; n++) assert.match(h, new RegExp(`data-onb-field="perWeek" value="${n}"`));
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

test('the sport names cover energy.mjs SPORTS in both languages', () => {
  for (const T of [esO, enO]) assert.deepEqual(Object.keys(T.sports.names), Object.keys(SPORTS));
});

test('Enter presses the primary button: Start, Continue (with the same checks), Save; never on a button or outside the flow', async () => {
  const s = setup();
  assert.equal(s.enter(), 1);
  assert.match(s.html(), /data-onb-field="name"/, 'Start');
  s.field('name', 'Ana'); s.enter();
  assert.match(s.html(), /data-onb-field="sex"/, 'Continue');
  s.enter();
  assert.match(s.html(), /Pick one/, 'the same validation as the button');
  assert.equal(s.enter({ 'data-onb-act': 'back' }, 'BUTTON'), 0, 'a focused button clicks itself');
  const out = { tagName: 'INPUT', getAttribute: () => null, closest: () => null };
  assert.match(s.html(), /data-onb-field="sex"/);
  const t = setup(); t.enter(); t.enter();
  t.choose('sex', 'female'); t.enter();
  t.field('birthdate', '1997-05-20'); t.enter(); t.field('heightCm', '165'); t.enter(); t.field('weightKg', '60'); t.enter(); t.enter();
  t.sport('yoga'); t.enter(); t.enter(); t.enter(); t.enter(); t.enter(); t.enter();
  assert.match(t.html(), /data-onb-act="save"/, 'reached the last screen by Enter');
  t.enter();
  await flush(); await flush(); await flush();
  assert.ok(t.calls.some((c) => c[0] === 'PUT'), 'Enter on the last screen saves');
  void out;
});

test('the data screen is a numbered list of steps: the Shortcut button, the server address with a copy button, the token, Strava, the history export', () => {
  const s = setup();
  toSafety(s, [['yoga', '60', '3']]);
  s.act('next'); s.act('next'); s.act('next');
  const h = s.html();
  assert.match(h, /class="db-list onb-steps"/);
  assert.equal((h.match(/<li class="db-row/g) || []).length, 5);
  assert.match(h, /Your history \(optional\)/);
  assert.match(h, /Export All Health Data/);
  assert.match(h, /<a class="chip" href="https:\/\/www\.icloud\.com\/shortcuts\/[^"]+" target="_blank" rel="noopener">Open</);
  assert.match(h, /<code>http:\/\/192\.168\.1\.50:8091<\/code>/);
  assert.match(h, /data-onb-act="copy"/);
  assert.match(h, /\(optional\)/);
  clean(h);
});
