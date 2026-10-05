/* Tests for the profile sheet renderer (web/src/client/profile.js): runs the classic script in a vm with
 * a baked PROFILE (lib/profile/profile.mjs, SYNTHETIC values) + I18N_PROFILE and a fixed clock, and
 * checks the view it registers for the detail sheet (window.HCViews.profile). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProfile } from '../../../lib/profile/profile.mjs';
import { es as esP, en as enP } from '../i18n/profile-templates.mjs';
import { es as esDate, en as enDate } from '../i18n/date-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'profile.js'), 'utf8');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 3)]);

const STRAVA = {
  fetchedAt: '2030-01-06T08:00:00.000Z',
  firstname: 'Alex', lastname: 'Example', city: 'Sampletown', country: 'Nowhere', athleteType: 'runner',
  bikes: [
    { name: 'Road bike', brand: 'Brand', model: 'Model', frameType: 'road', weightKg: 8.2, distanceM: 1234567.8, retired: false, primary: true },
    { name: 'Old bike', distanceM: 5000, retired: true },
  ],
  shoes: [
    { name: 'Trainers', distanceM: 745000, retired: false, primary: true },
    { name: 'Racers', distanceM: 120049, retired: false },
  ],
  gearScopeMissing: false,
  devices: [{ name: 'Demo Watch 2', count: 40, lastUsed: '2030-01-05' }, { name: 'Demo Phone App', count: 3, lastUsed: '2029-12-01' }],
};
const MANUAL = { birthdate: '1990-05-17', heightCm: 178, devices: [{ name: 'Demo Watch 2', type: 'watch', since: '2028-03' }, { name: 'Demo EMS suit', type: 'ems' }] };
const FULL = buildProfile({ manual: MANUAL, strava: STRAVA, weight: { kg: 71.4, date: '2030-01-04' } });

// nutri = a stand-in for client/nutri-day.js's window.HCNutri (the goal's owner), or null
// fetch = a stand-in for window.fetch (the manual HEAD probe); links = the elements querySelectorAll returns
function setup({ profile = FULL, locale = 'en', now = '2030-01-07', photo = null, nutri = null, settings = null, progress = null, els = {}, fetch = undefined, links = [] } = {}) {
  const img = photo ? { getAttribute: (k) => (k === 'src' ? photo : null) } : null;
  const win = nutri ? { HCNutri: nutri } : {};
  if (settings) win.HCSettings = settings;
  if (progress) win.HCProgress = progress;
  const listeners = {};
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now + 'T12:00:00'])); }
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  const { photo: _p, ...baked } = profile; // Avatar.astro bakes the photo once, in the button's <img>
  const ctx = {
    window: win,
    document: {
      getElementById: (id) => (id === 'avatar-img' ? img : els[id] || null),
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
      querySelectorAll: (sel) => (sel === 'a.pf-manual' ? links : []),
    },
    ...(fetch ? { fetch } : {}),
    encodeURIComponent,
    PROFILE: { ...baked, photo: Boolean(profile.photo) },
    I18N_PROFILE: locale === 'es' ? esP : enP,
    I18N_DATE: locale === 'es' ? esDate : enDate,
    LOCALE: locale,
    Date: FakeDate, Math, String, Number, Array, Object, JSON, isFinite, parseInt,
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  const fire = (t, target) => (listeners[t] || []).forEach((fn) => fn({ target }));
  return { win, fire, view: win.HCViews && win.HCViews.profile, api: win.HCProfile };
}
const html = (s) => { const r = s.view.render(); return r.head + r.body; };
const clean = (h) => assert.doesNotMatch(h, /NaN|undefined|null|Infinity|<script|href=/);

test('registers the profile view for the detail sheet, titled by the locale', () => {
  assert.equal(setup().view.title(), 'Profile');
  assert.equal(setup({ locale: 'es' }).view.title(), 'Perfil');
});

test('header: initials (no photo), full name, age from the birthdate on the viewer\'s clock, location', () => {
  const h = html(setup());
  assert.match(h, /class="pf-ini"[^>]*>AE</);
  assert.ok(h.includes('Alex Example'));
  assert.ok(h.includes('39 years'), 'born 1990-05-17, viewed 2030-01-07');
  assert.ok(h.includes('Sampletown, Nowhere'));
  clean(h);
});

test('age turns over on the birthday itself (client-side, nothing baked)', () => {
  const { api } = setup();
  assert.equal(api.ageOn('1990-05-17', '2030-05-16'), 39);
  assert.equal(api.ageOn('1990-05-17', '2030-05-17'), 40);
  assert.equal(api.ageOn('2000-02-29', '2030-02-28'), 29);
  assert.equal(api.ageOn('2000-02-29', '2030-03-01'), 30);
  assert.equal(api.ageOn(null, '2030-01-01'), null);
  assert.equal(api.ageOn('2031-01-01', '2030-01-01'), null, 'a birthdate after today is not an age');
});

test('header uses the photo from the avatar button when there is one (the data URI is baked once)', () => {
  const h = html(setup({ profile: { ...FULL, photo: 'data:image/jpeg;base64,' + JPEG.toString('base64') }, photo: 'data:image/jpeg;base64,' + JPEG.toString('base64') }));
  assert.match(h, /<img class="pf-photo" src="data:image\/jpeg;base64,[A-Za-z0-9+/=]+" alt=""/);
  assert.doesNotMatch(h, /class="pf-ini"/);
});

test('a non-data-URI src on the button is never copied into the sheet', () => {
  const h = html(setup({ profile: { ...FULL, photo: 'x' }, photo: 'https://tracker.example/x.jpg' }));
  assert.doesNotMatch(h, /tracker\.example/);
});

test('body: height and the latest weigh-in with its date', () => {
  const h = html(setup());
  assert.ok(h.includes('>Body<'));
  assert.match(h, /<b class="pf-val">178<\/b><small>cm<\/small>/);
  assert.match(h, /<b class="pf-val">71\.4<\/b><small>kg<\/small>/);
  assert.ok(h.includes('Latest weigh-in · Fri 4 Jan'));
});

test('es: decimal comma, Spanish copy', () => {
  const h = html(setup({ locale: 'es' }));
  assert.ok(h.includes('39 años'));
  assert.match(h, /<b class="pf-val">71,4<\/b>/);
  assert.match(h, /1234,6/);
  assert.ok(h.includes('>Material<') && h.includes('>Dispositivos<'));
});

test('gear: bikes and shoes with km to 1 decimal, detail line, primary badge, retired folded, shoe replace hint', () => {
  const h = html(setup());
  assert.ok(h.includes('>Gear<'));
  assert.match(h, /Road bike[\s\S]*?Brand Model · Road · 8\.2 kg[\s\S]*?<b class="pf-km">1234\.6<\/b><small>km<\/small>/);
  assert.match(h, /pf-badge">Primary</);
  assert.match(h, /<details class="pf-retired"><summary>Retired \(1\)<\/summary>[\s\S]*Old bike[\s\S]*<\/details>/);
  assert.match(h, /Trainers[\s\S]*?class="pf-hint">Consider replacing[\s\S]*?745\.0/);
  const racers = h.slice(h.indexOf('Racers'));
  assert.doesNotMatch(racers.slice(0, racers.indexOf('</li>')), /pf-hint/, '120 km shoes: no hint');
});

test('gear scope missing: a note on how to grant it, no empty lists', () => {
  const p = buildProfile({ strava: { ...STRAVA, bikes: [], shoes: [], gearScopeMissing: true } });
  const h = html(setup({ profile: p }));
  assert.ok(h.includes('profile:read_all'));
  assert.doesNotMatch(h, />Bikes</);
});

test('devices: manual first with type + since, Strava-only ones marked, usage line', () => {
  const h = html(setup());
  assert.match(h, /Demo Watch 2[\s\S]*?Watch · Since March 2028[\s\S]*?40 activities on Strava · last Sat 5 Jan/);
  assert.match(h, /Demo EMS suit[\s\S]*?EMS/);
  assert.match(h, /Demo Phone App[\s\S]*?Other · Seen on Strava/);
});

// ---- device manuals: a link revealed only when the LAN page serves the PDF ----------------------
const WITH_MANUAL = buildProfile({
  manual: { devices: [{ name: 'Demo Edge 2', type: 'bike-computer', manual: 'demo-edge-manual.pdf' }, { name: 'Demo Scale', type: 'other' }] },
  strava: STRAVA,
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const pdfFetch = (status = 200, type = 'application/pdf') => {
  const calls = [];
  const fn = (url, init) => { calls.push({ url, init }); return Promise.resolve({ status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) } }); };
  fn.calls = calls;
  return fn;
};
const fakeLink = (file) => {
  const attrs = { 'data-manual': file, hidden: '' };
  return { attrs, getAttribute: (k) => (k in attrs ? attrs[k] : null), removeAttribute: (k) => { delete attrs[k]; } };
};

test('device manual: a hidden "Manual" link to /manuales/<file> in a new tab (noopener), labelled; none without a manual', () => {
  const h = html(setup({ profile: WITH_MANUAL }));
  const a = /<a class="pf-manual"[^>]*>[^<]*<\/a>/.exec(h);
  assert.ok(a, 'a link');
  assert.match(a[0], /href="\/manuales\/demo-edge-manual\.pdf"/);
  assert.match(a[0], /target="_blank"/);
  assert.match(a[0], /rel="noopener"/);
  assert.match(a[0], /data-manual="demo-edge-manual\.pdf"/);
  assert.match(a[0], / hidden[ >]/, 'hidden until the file answers');
  assert.match(a[0], /aria-label="Manual for Demo Edge 2 \(PDF, opens in a new tab\)"/);
  assert.match(a[0], />Manual<\/a>$/);
  assert.equal((h.match(/class="pf-manual"/g) || []).length, 1, 'only the device with a manual');
  assert.match(html(setup({ profile: WITH_MANUAL, locale: 'es' })), /aria-label="Manual de Demo Edge 2 \(PDF, se abre en una pestaña nueva\)"/);
});

test('device manual: revealed when HEAD /manuales/<file> answers 200 with a PDF; a later render is not hidden', async () => {
  const fetch = pdfFetch();
  const link = fakeLink('demo-edge-manual.pdf');
  const other = fakeLink('other.pdf');
  const s = setup({ profile: WITH_MANUAL, fetch, links: [link, other] });
  html(s);
  await flush();
  assert.deepEqual(fetch.calls.map((c) => [c.url, c.init.method]), [['/manuales/demo-edge-manual.pdf', 'HEAD']]);
  assert.equal(fetch.calls[0].init.cache, 'no-store');
  assert.equal(link.getAttribute('hidden'), null, 'revealed');
  assert.equal(other.getAttribute('hidden'), '', 'another file untouched');
  assert.doesNotMatch(/<a class="pf-manual"[^>]*>/.exec(html(s))[0], / hidden/);
  assert.equal(fetch.calls.length, 1, 'probed once');
});

test('device manual: stays hidden on a 404, a non-PDF 200 (an SPA fallback page), a failed request or without fetch', async () => {
  for (const fetch of [pdfFetch(404), pdfFetch(200, 'text/html; charset=utf-8'), Object.assign(() => Promise.reject(new Error('blocked')), { calls: [] }), undefined]) {
    const link = fakeLink('demo-edge-manual.pdf');
    const s = setup({ profile: WITH_MANUAL, fetch, links: [link] });
    html(s);
    await flush();
    assert.equal(link.getAttribute('hidden'), '');
    assert.match(/<a class="pf-manual"[^>]*>/.exec(html(s))[0], / hidden/);
  }
});

test('device manual: a name that is not a bare PDF file name (tampered bake) renders no link and no request', async () => {
  const fetch = pdfFetch();
  const p = { ...WITH_MANUAL, devices: [{ ...WITH_MANUAL.devices[0], manual: '../status.json' }, { ...WITH_MANUAL.devices[1], manual: 'a/b.pdf' }] };
  const h = html(setup({ profile: p, fetch }));
  await flush();
  assert.doesNotMatch(h, /pf-manual/);
  assert.equal(fetch.calls.length, 0);
});

test('Strava focus + snapshot date', () => {
  const h = html(setup());
  assert.match(h, /Focus[\s\S]*?Running/);
  assert.ok(h.includes('Strava data from Sun 6 Jan'));
});

test('nothing known: a generic icon and the onboarding hint only', () => {
  const h = html(setup({ profile: buildProfile({}) }));
  assert.match(h, /<svg class="pf-icon"/);
  assert.ok(h.includes('profile/profile.example.json'));
  assert.doesNotMatch(h, />Body<|>Gear<|>Devices</);
  clean(h);
});

test('every name / label is escaped', () => {
  const p = buildProfile({ manual: { name: '<img onerror=x>', devices: [{ name: 'A&B "q"', type: 'other' }] } });
  const h = html(setup({ profile: p }));
  assert.doesNotMatch(h, /<img onerror/);
  assert.ok(h.includes('A&amp;B &quot;q&quot;'));
});

test('without PROFILE or I18N_PROFILE the script registers nothing', () => {
  const win = {};
  const ctx = { window: win, document: { getElementById: () => null } };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  assert.equal(win.HCViews, undefined);
});

test('supplements: listed with dose and meal (es/en), section omitted when there are none', () => {
  const withSupps = buildProfile({ manual: { ...MANUAL, supplements: [{ name: 'Demo Creatine', dose: '3 g', meal: 'lunch' }, { name: 'Demo Mg', meal: 'dinner' }] }, strava: STRAVA });
  const h = html(setup({ profile: withSupps }));
  assert.match(h, /<h3 class="pf-h">Supplements<\/h3>/);
  assert.ok(h.includes('Demo Creatine'));
  assert.ok(h.includes('3 g · Lunch'));
  assert.ok(h.includes('Dinner'));
  clean(h);
  const es = html(setup({ profile: withSupps, locale: 'es' }));
  assert.match(es, /<h3 class="pf-h">Suplementos<\/h3>/);
  assert.ok(es.includes('3 g · Comida'));
  assert.doesNotMatch(html(setup()), /Supplements/);
});

test('events: upcoming listed soonest first with days to go on the viewer clock, past ones folded, es/en', () => {
  const withEvents = buildProfile({ manual: { ...MANUAL, events: [
    { name: 'Demo Sportive', date: '2030-02-16', type: 'sportive', location: 'Hilltown' },
    { name: 'Demo Hyrox', date: '2030-01-08', type: 'hyrox' },
    { name: 'Demo Today Run', date: '2030-01-07', type: 'race' },
    { name: 'Demo Old Race', date: '2029-12-01', type: 'race' },
  ] }, strava: STRAVA });
  const h = html(setup({ profile: withEvents })); // viewer today = 2030-01-07
  assert.match(h, /<h3 class="pf-h">Upcoming events<\/h3>/);
  const order = ['Demo Today Run', 'Demo Hyrox', 'Demo Sportive'].map((n) => h.indexOf(n));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), 'soonest first');
  assert.ok(h.includes('>Today<'));
  assert.ok(h.includes('>Tomorrow<'));
  assert.ok(h.includes('>In 40 days<'));
  assert.ok(h.includes('Sportive · Sat 16 Feb · Hilltown'));
  assert.match(h, /<details class="pf-retired pf-ev-past"><summary>Past \(1\)<\/summary>.*Demo Old Race/s);
  clean(h);
  const es = html(setup({ profile: withEvents, locale: 'es' }));
  assert.match(es, /<h3 class="pf-h">Próximas pruebas<\/h3>/);
  assert.ok(es.includes('>Dentro de 40 días<'));
  assert.ok(es.includes('>Mañana<'));
  assert.ok(es.includes('Pasadas (1)'));
  // a later clock moves everything to the past fold: nothing upcoming is said in words
  const later = html(setup({ profile: withEvents, now: '2030-03-01' }));
  assert.ok(later.includes('No upcoming events.'));
  assert.ok(later.includes('Past (4)'));
  assert.doesNotMatch(html(setup()), /Upcoming events/);
});

/* ---------- Goal setting: the plan's goal, owned by client/nutri-day.js (hc.nutri.goal) ---------- */
const GOALS = [{ goal: 'maintain', kcal: 0, bikeKept: false }, { goal: 'cut', kcal: -320, bikeKept: true }, { goal: 'bulk', kcal: 300, bikeKept: false }];
function nutriStub(goal = 'maintain') {
  const n = { set: [], state: () => ({ goal }), setGoal: (g) => { n.set.push(g); goal = g; return true; } };
  return n;
}

test('goal setting: first section under the header, three labelled radios with one-line descriptions, the current goal checked', () => {
  const s = setup({ profile: { ...FULL, goals: GOALS }, nutri: nutriStub('cut') });
  const r = s.view.render();
  assert.ok(r.body.startsWith('<section class="pf-sec pf-goal-sec">'), 'Goal comes first in the body');
  assert.match(r.body, /<fieldset class="pf-goal" id="pf-goal"><legend class="pf-h">Goal<\/legend>/);
  assert.equal((r.body.match(/<input type="radio" name="pf-goal"/g) || []).length, 3);
  assert.match(r.body, /<input type="radio" name="pf-goal" value="cut" checked>/);
  assert.doesNotMatch(r.body, /value="maintain" checked/);
  assert.ok(r.body.includes('Maintain your weight'));
  assert.ok(r.body.includes('Gentle deficit (~−320 kcal/day, bike days untouched)'));
  assert.ok(r.body.includes('Gentle surplus (~+300 kcal/day)'));
  clean(r.body);
});

test('goal setting (es): Objetivo, Mantener / Bajar / Ganar with their descriptions, thousands-free kcal', () => {
  const b = setup({ profile: { ...FULL, goals: GOALS }, nutri: nutriStub(), locale: 'es' }).view.render().body;
  assert.match(b, /<legend class="pf-h">Objetivo<\/legend>/);
  for (const w of ['Mantener', 'Bajar', 'Ganar', 'Mantener tu peso', 'Déficit suave (~−320 kcal/día, sin tocar los días de bici)', 'Superávit suave (~+300 kcal/día)']) assert.ok(b.includes(w), w);
});

test('goal setting: changing a radio hands the goal to Nutrición (HCNutri.setGoal); other inputs and unknown goals are ignored', () => {
  const n = nutriStub();
  const s = setup({ profile: { ...FULL, goals: GOALS }, nutri: n });
  s.fire('change', { name: 'pf-goal', value: 'bulk' });
  s.fire('change', { name: 'pf-goal', value: 'shred' });
  s.fire('change', { name: 'nutri-day', value: 'cut' });
  assert.deepEqual(n.set, ['bulk']);
  assert.match(s.view.render().body, /value="bulk" checked>/, 'a re-render shows the new goal');
});

test('goal setting is omitted without Nutrición (no HCNutri) or without options; the onboarding sheet still carries it', () => {
  assert.doesNotMatch(html(setup({ profile: { ...FULL, goals: GOALS } })), /pf-goal/);
  assert.doesNotMatch(html(setup({ profile: { ...FULL, goals: [] }, nutri: nutriStub() })), /pf-goal/);
  const empty = buildProfile({});
  const b = setup({ profile: { ...empty, goals: GOALS }, nutri: nutriStub() }).view.render().body;
  assert.match(b, /id="pf-goal"/);
  assert.match(b, /pf-onboard/);
});

// a stand-in for client/settings.js (the LAN settings API answered)
function settingsStub({ ready = true, target = null } = {}) {
  const st = { saved: [], fns: [], target };
  st.ready = () => ready;
  st.targetWeight = () => st.target;
  st.limits = () => ({ min: 35, max: 250 });
  st.parseTarget = (v) => {
    const t = String(v).trim().replace(',', '.').replace(/\s*kg$/, '');
    if (t === '') return { value: null };
    const n = Number(t);
    if (!Number.isFinite(n)) return { error: 'number' };
    return n < 35 || n > 250 ? { error: 'range' } : { value: n };
  };
  st.saveTarget = (kg) => { st.saved.push(kg); return Promise.resolve(); };
  st.onChange = (fn) => st.fns.push(fn);
  return st;
}
const fakeEl = () => {
  const el = { textContent: '', attrs: {} };
  el.setAttribute = (k, v) => { el.attrs[k] = v; };
  el.removeAttribute = (k) => { delete el.attrs[k]; };
  return el;
};

test('target weight (LAN page): a labelled kg field with its range hint, the current value, a status line; none without the settings API', () => {
  const b = setup({ profile: { ...FULL, goals: GOALS }, nutri: nutriStub('cut'), settings: settingsStub({ target: 72.5 }) }).view.render().body;
  assert.match(b, /<label class="food-lbl" for="pf-target">Target weight<\/label>/);
  assert.match(b, /<input class="food-in" id="pf-target" type="text" inputmode="decimal" autocomplete="off" value="72.5" aria-describedby="pf-target-hint pf-target-err">/);
  assert.match(b, /<span class="food-suffix" aria-hidden="true">kg<\/span>/);
  assert.ok(b.includes('Between 35 and 250 kg. Empty = no target.'));
  assert.match(b, /id="pf-goal-msg" role="status"/);
  assert.ok(b.indexOf('id="pf-target"') > b.indexOf('</fieldset>'), 'after the three radios');
  clean(b);
  for (const st of [null, settingsStub({ ready: false })]) {
    const off = setup({ profile: { ...FULL, goals: GOALS }, nutri: nutriStub(), settings: st }).view.render().body;
    assert.doesNotMatch(off, /pf-target|pf-goal-msg/, 'artifact / example build: exactly as before');
  }
  const es = setup({ profile: { ...FULL, goals: GOALS }, nutri: nutriStub(), settings: settingsStub({ target: 72.5 }), locale: 'es' }).view.render().body;
  assert.match(es, /Peso objetivo/);
  assert.match(es, /value="72,5"/);
});

test('target weight: a valid change saves it (empty clears it); a bad one shows an inline error and saves nothing', () => {
  const st = settingsStub({ target: 70 });
  const els = { 'pf-target': fakeEl(), 'pf-target-err': fakeEl(), 'pf-goal-msg': fakeEl() };
  const s = setup({ profile: { ...FULL, goals: GOALS }, nutri: nutriStub(), settings: st, els });
  s.fire('change', { id: 'pf-target', value: 'abc' });
  assert.equal(els['pf-target-err'].textContent, 'Type a number, e.g. 72.5');
  assert.equal(els['pf-target'].attrs['aria-invalid'], 'true');
  s.fire('change', { id: 'pf-target', value: '20' });
  assert.equal(els['pf-target-err'].textContent, 'Between 35 and 250 kg');
  assert.deepEqual(st.saved, []);
  s.fire('change', { id: 'pf-target', value: '68,5 kg' });
  assert.deepEqual(st.saved, [68.5]);
  assert.equal(els['pf-target-err'].textContent, '');
  assert.equal('aria-invalid' in els['pf-target'].attrs, false);
  s.fire('change', { id: 'pf-target', value: '70' });
  assert.deepEqual(st.saved, [68.5], 'the unchanged value is not re-saved');
  s.fire('change', { id: 'pf-target', value: '' });
  assert.deepEqual(st.saved, [68.5, null]);
});

test('the status line follows the settings saves (saving, saved, a coarse reason); the Progreso line refreshes', () => {
  const st = settingsStub();
  const els = { 'pf-goal-msg': fakeEl(), 'pf-progress-txt': fakeEl() };
  let line = '78.0 kg average · -0.35 kg/wk · On pace';
  setup({ profile: { ...FULL, goals: GOALS }, nutri: nutriStub(), settings: st, progress: { line: () => line }, els });
  const emit = (last) => st.fns.forEach((fn) => fn({ last }));
  emit({ what: 'target', status: 'saving' });
  assert.equal(els['pf-goal-msg'].textContent, 'Saving…');
  line = '78.0 kg average · -0.35 kg/wk · Target reached';
  emit({ what: 'target', status: 'saved' });
  assert.equal(els['pf-goal-msg'].textContent, 'Saved');
  assert.equal(els['pf-progress-txt'].textContent, line);
  emit({ what: 'goal', status: 'saved' });
  assert.equal(els['pf-goal-msg'].textContent, 'Goal saved on this server');
  emit({ what: 'goal', status: 'error', code: 'rate_limited' });
  assert.equal(els['pf-goal-msg'].textContent, 'Not saved: too many changes, try again in a minute');
  emit({ what: 'goal', status: 'error', code: 'weird' });
  assert.equal(els['pf-goal-msg'].textContent, 'Not saved: unknown error');
  // a goal not yet confirmed by the server says so (es: "pendiente de guardar")
  st.fns.forEach((fn) => fn({ last: { what: 'goal', status: 'error', code: 'offline' }, pending: 'cut' }));
  assert.equal(els['pf-goal-msg'].textContent, 'Not saved: the server did not answer Goal pending save: it will be retried.');
  st.fns.forEach((fn) => fn({ last: null, pending: 'cut' }));
  assert.equal(els['pf-goal-msg'].textContent, 'Goal pending save: it will be retried.');
});

test('the Progreso line (client/progress.js) sits in the goal section when there is one; nothing without weight data', () => {
  const b = setup({ profile: { ...FULL, goals: GOALS }, nutri: nutriStub(), progress: { line: () => '78.0 kg average · Too few data' } }).view.render().body;
  assert.match(b, /<p class="pf-note pf-progress" id="pf-progress"><span class="pf-lbl">Progress<\/span> <span id="pf-progress-txt">78.0 kg average · Too few data<\/span><\/p><\/section>/);
  assert.doesNotMatch(setup({ profile: { ...FULL, goals: GOALS }, nutri: nutriStub(), progress: { line: () => '' } }).view.render().body, /pf-progress/);
  assert.doesNotMatch(setup({ profile: { ...FULL, goals: GOALS }, nutri: nutriStub(), progress: { line: () => { throw new Error('x'); } } }).view.render().body, /pf-progress/);
});
