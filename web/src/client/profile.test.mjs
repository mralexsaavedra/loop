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

function setup({ profile = FULL, locale = 'en', now = '2030-01-07', photo = null } = {}) {
  const img = photo ? { getAttribute: (k) => (k === 'src' ? photo : null) } : null;
  const win = {};
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now + 'T12:00:00'])); }
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  const { photo: _p, ...baked } = profile; // Avatar.astro bakes the photo once, in the button's <img>
  const ctx = {
    window: win,
    document: { getElementById: (id) => (id === 'avatar-img' ? img : null) },
    PROFILE: { ...baked, photo: Boolean(profile.photo) },
    I18N_PROFILE: locale === 'es' ? esP : enP,
    I18N_DATE: locale === 'es' ? esDate : enDate,
    LOCALE: locale,
    Date: FakeDate, Math, String, Number, Array, Object, JSON, isFinite, parseInt,
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return { win, view: win.HCViews && win.HCViews.profile, api: win.HCProfile };
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
