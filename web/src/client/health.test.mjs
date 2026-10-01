/* web/src/client/health.js section anchors — each Salud sub-heading carries an `hl-<section>` id
 * so Inicio's score cards (and any jump()) can land on it. Runs the real classic script in node:vm
 * against web/test/dom-stub.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { en as enHealth } from '../i18n/health-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'health.js'), 'utf8');

test('each rendered section heading has a stable hl-<section> anchor id', () => {
  const html = renderWith({
    body: { hasData: false }, activity: { hasData: false }, energy: { hasData: false },
    running: { hasData: true, count: 0, sessions: [] },
    recovery: { hasData: true },
    loadRecovery: { hasData: false },
  });
  assert.match(html, /<div class="hsub" id="hl-recovery">/);
  assert.match(html, /<div class="hsub" id="hl-running">/);
  assert.doesNotMatch(html, /id="hl-body"/, 'sections without data render no anchor');
});

const full = () => ({
  body: { hasData: true, weight: { latest: 80, latestDate: '2026-06-01', source: 's', sources: 1, d30: null, spark: null } },
  activity: { hasData: true, steps: { latest: 9000, latestDate: '2026-06-30', avg30: 8500, d30: 1, spark: null } },
  energy: { hasData: true, tdeeLatest: 2600, tdeeLatestDate: '2026-06-29', tdeeAvg: 2400, tdeeDays: 30, spark: null, balance: null },
  running: { hasData: true, count: 1, sessions: [{ date: '2026-06-02', dist: 8, time: '44:00', pace: '5:30', hrAvg: null, re: null, elev: null, power: null, gct: null, vosc: null, stride: null }] },
  cycling: { hasData: true, count: 1, sessions: [{ date: '2026-06-10', dist: 40, time: '1:30', elev: 400, hrAvg: 140, re: 90, kj: 1300 }] },
  recovery: {
    hasData: true,
    rhr: { latest: 52, latestDate: '2026-06-30', avg30: 50.4, d30: -1, spark: null },
    sleep: { latest: 6.4, avg: 7.2, nights: 30, latestDate: '2026-06-30', spark: null, target: 7.5, pctTarget: 40, sd: 0.6 },
  },
  loadRecovery: { hasData: true, weeks: 2, series: [{ w: '2026-06-01', load: 10 }, { w: '2026-06-08', load: 0 }], split: null },
});

test('Salud answers "how is my body": recovery, sleep, body, activity, energy in that order; training blocks go to Entreno', () => {
  const out = {};
  renderWith(full(), { out });
  const at = (k) => out.health.indexOf(`id="hl-${k}"`);
  const order = ['recovery', 'sleep', 'body', 'activity', 'energy'].map(at);
  assert.ok(order.every((v, i) => v !== -1 && (i === 0 || v > order[i - 1])), `Salud order ${order}`);
  for (const k of ['running', 'cycling', 'load']) {
    assert.equal(at(k), -1, `${k} is not in Salud`);
    assert.notEqual(out.train.indexOf(`id="hl-${k}"`), -1, `${k} is in Entreno`);
  }
  const t = (k) => out.train.indexOf(`id="hl-${k}"`);
  assert.ok(t('running') < t('cycling') && t('cycling') < t('load'), 'Entreno order: running, cycling, load vs recovery');
  assert.match(out.health, /<div class="hsub" id="hl-sleep">/, 'sleep is its own section (monitor + sleep dial land here)');
  assert.equal(out.health.split('id="hl-sleep"').length - 1, 1, 'one hl-sleep id');
});

test('the recovery detail card host (#score-recovery) sits right under the recovery heading', () => {
  const out = {};
  renderWith(full(), { out });
  assert.match(out.health, /id="hl-recovery">[^<]*<\/div><div id="score-recovery"><\/div>/);
  // even with no recovery trends, a baked recovery score still gets its section + host
  renderWith({ ...full(), recovery: none }, { out, SCORES: { recovery: { asOf: '2026-06-30' } } });
  assert.match(out.health, /id="hl-recovery">[^<]*<\/div><div id="score-recovery"><\/div>/);
});

test('isolation: a throw in the Salud half renders its empty state and the Entreno half still renders (and vice versa)', () => {
  const out = {};
  const brokenBody = { hasData: true, get weight() { throw new Error('boom'); } };
  assert.doesNotThrow(() => renderWith({ ...full(), body: brokenBody }, { out }));
  assert.match(out.health, /train-empty/, 'Salud falls back to its empty state');
  assert.ok(out.health.includes(enHealth.emptyMsg));
  assert.match(out.train, /id="hl-running"/, 'Entreno unaffected');
  assert.doesNotThrow(() => renderWith({ ...full(), running: { hasData: true, count: 1, sessions: null } }, { out }));
  assert.ok(out.train.includes(enHealth.trainEmptyMsg), 'Entreno falls back to its empty state');
  assert.match(out.health, /id="hl-recovery"/, 'Salud unaffected');
});

test('each host has its own empty state', () => {
  const out = {};
  renderWith({ body: none, activity: none, energy: none, running: none, cycling: none, recovery: none, loadRecovery: none }, { out });
  assert.match(out.health, /train-empty/);
  assert.match(out.train, /train-empty/);
  const onlyBody = {};
  renderWith({ ...full(), running: none, cycling: none, loadRecovery: none }, { out: onlyBody });
  assert.doesNotMatch(onlyBody.health, /train-empty/);
  assert.match(onlyBody.train, /train-empty/);
});

// Salud (#health) + Entreno (#health-train) hosts; returns both, Salud first, or each via `out`.
function renderWith(HEALTH, { DateCls = Date, SCORES, out = {}, detail = false } = {}) {
  const doc = new StubDocument();
  const host = doc.el('health');
  const train = doc.el('health-train');
  const ctx = { document: doc, window: {}, HEALTH, SCORES, I18N_HEALTH: enHealth, LOCALE: 'en', Math, String, Number, Date: DateCls, JSON };
  if (detail) ctx.DETAIL = { metrics: {} };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  out.health = host.innerHTML;
  out.train = train.innerHTML;
  return host.innerHTML + train.innerHTML;
}
const none = { hasData: false };

test('energy: a power-meter-corrected headline day says so; corrected days in the window get a note', () => {
  const E = { hasData: true, tdeeLatest: 4400, tdeeLatestDate: '2026-06-29', tdeeAvg: 2600, tdeeDays: 30, spark: null, balance: null };
  const html = renderWith({ body: none, activity: none, running: none, recovery: none, loadRecovery: none,
    energy: { ...E, latestCorrected: true, correctedDays: 2 } });
  assert.ok(html.includes(enHealth.energyRide.latest), 'headline note');
  assert.ok(html.includes(enHealth.energyRide.days.replace('{n}', '2')), 'window note');
  const plain = renderWith({ body: none, activity: none, running: none, recovery: none, loadRecovery: none,
    energy: { ...E, latestCorrected: false, correctedDays: 0 } });
  assert.ok(!plain.includes(enHealth.energyRide.latest));
  assert.ok(!plain.includes('power meter'));
});

test('energy: a power-ride headline day the hourly data could not correct says why; window note too', () => {
  const E = { hasData: true, tdeeLatest: 2600, tdeeLatestDate: '2026-06-29', tdeeAvg: 2600, tdeeDays: 30, spark: null, balance: null };
  const html = renderWith({ body: none, activity: none, running: none, recovery: none, loadRecovery: none,
    energy: { ...E, latestUncovered: true, uncoveredDays: 3 } });
  assert.ok(html.includes(enHealth.energyRide.uncovered), 'headline note');
  assert.ok(html.includes(enHealth.energyRide.uncoveredDays.replace('{n}', '3')), 'window note');
  const plain = renderWith({ body: none, activity: none, running: none, recovery: none, loadRecovery: none, energy: E });
  assert.ok(!plain.includes(enHealth.energyRide.uncovered));
});

test('body section shows waist with its measurement date and change since the first reading', () => {
  const html = renderWith({
    body: { hasData: true, waist: { latest: 85.2, latestDate: '2026-06-01', firstDate: '2026-03-01', points: 3, delta: -2.8, spark: { v: [88, 86.5, 85.2], from: '2026-03-01', to: '2026-06-01' } } },
    activity: none, energy: none, running: none, recovery: none, loadRecovery: none,
  });
  assert.match(html, /Waist · 1 Jun/);
  assert.match(html, /85.2<small>cm<\/small>/);
  assert.match(html, /▼ -2.8 cm/);
  assert.doesNotMatch(html, /No waist measurements yet/);
});

test('body section without waist data says how to add it (empty state)', () => {
  const html = renderWith({
    body: { hasData: true, weight: { latest: 80, latestDate: '2026-06-01', source: 's', sources: 1, d30: null, spark: null } },
    activity: none, energy: none, running: none, recovery: none, loadRecovery: none,
  });
  assert.match(html, /No waist measurements yet/);
});

test('cycling section: recent rides table (newest first) with count, same table style as running', () => {
  const html = renderWith({
    body: none, activity: none, energy: none, recovery: none, loadRecovery: none,
    running: { hasData: true, count: 1, sessions: [{ date: '2026-06-02', dist: 8, pace: '5:30', speed: 10.9, power: null, gct: null, vosc: null, stride: null }] },
    cycling: { hasData: true, count: 12, sessions: [
      { date: '2026-06-10', dist: 40.25, time: '1:30', elev: 412, hrAvg: 141, re: 96, kj: 1310 },
      { date: '2026-06-04', dist: null, time: '1:00', elev: null, hrAvg: null, re: null, kj: null },
    ] },
  });
  assert.match(html, /<div class="hsub" id="hl-cycling">Cycling<\/div>/);
  assert.match(html, /<table class="run-tbl">.*Elev\./s);
  assert.match(html, /40.25 km<\/td><td>1:30<\/td><td>412 m<\/td><td>141 bpm<\/td><td>96<\/td><td>1310 kJ<\/td>/);
  assert.match(html, /<td>4 Jun<\/td><td>—<\/td><td>1:00<\/td><td>—<\/td>/, 'missing fields are a dash, never 0');
  assert.match(html, /<b>12<\/b> rides/);
  assert.ok(html.indexOf('hl-running') < html.indexOf('hl-cycling'), 'cycling follows running');
});

test('running table matches the cycling one: date, distance, time, pace, avg HR, RE, elevation, then the watch dynamics (dash when absent)', () => {
  const html = renderWith({
    body: none, activity: none, energy: none, recovery: none, loadRecovery: none, cycling: none,
    running: { hasData: true, count: 5, sessions: [
      { date: '2026-06-22', dist: 7.7, time: '0:41', pace: '5:18', hrAvg: 152, re: 57, elev: 35, power: null, gct: null, vosc: null, stride: null },
      { date: '2026-06-20', dist: null, time: '0:30', pace: null, hrAvg: null, re: null, elev: null, power: 240, gct: 250, vosc: 10, stride: 1.1 },
    ] },
  });
  assert.match(html, /<tr><th>Date<\/th><th>Dist<\/th><th>Time<\/th><th>Pace<\/th><th>Avg HR<\/th><th>Effort<\/th><th>Elev\.<\/th><th>Power<\/th><th>GCT<\/th><th>Osc\.<\/th><th>Stride<\/th><\/tr>/);
  assert.match(html, /<td>22 Jun<\/td><td>7.7 km<\/td><td>0:41<\/td><td>5:18\/km<\/td><td>152 bpm<\/td><td>57<\/td><td>35 m<\/td><td>—<\/td><td>—<\/td><td>—<\/td><td>—<\/td>/, 'a Strava-only run: dynamics are dashes');
  assert.match(html, /<td>20 Jun<\/td><td>—<\/td><td>0:30<\/td><td>—<\/td><td>—<\/td><td>—<\/td><td>—<\/td><td>240 W<\/td><td>250 ms<\/td><td>10 cm<\/td><td>1.1 m<\/td>/, 'no distance: no pace');
  assert.match(html, /<b>5<\/b> runs/);
});

test('run and bike sections render symmetric empty states when the other has data', () => {
  const html = renderWith({
    body: none, activity: none, energy: none, recovery: none, loadRecovery: none,
    running: none,
    cycling: { hasData: true, count: 1, sessions: [{ date: '2026-06-10', dist: 40, time: '1:30', elev: 400, hrAvg: 140, re: 90, kj: 1300 }] },
  });
  assert.match(html, /id="hl-running"/);
  assert.match(html, /No runs yet/);
  const html2 = renderWith({
    body: none, activity: none, energy: none, recovery: none, loadRecovery: none, cycling: none,
    running: { hasData: true, count: 1, sessions: [{ date: '2026-06-02', dist: 8, pace: '5:30', speed: 10.9, power: null, gct: null, vosc: null, stride: null }] },
  });
  assert.match(html2, /id="hl-cycling"/);
  assert.match(html2, /No rides yet/);
});

/* ---- today first: latest value + its date lead, the 30-day mean and delta are the context line ---- */
function renderAt(HEALTH, now, opts = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now + 'T12:00:00'])); }
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  return renderWith(HEALTH, { DateCls: FakeDate, ...opts });
}
const sp = { v: [1, 2], from: '2026-06-01', to: '2026-06-30' };

test('every Salud trend card opens its detail view; run / ride rows open that day in the load view (a real button in the date cell for keyboards)', () => {
  const tr = (latest) => ({ latest, latestDate: '2026-06-30', avg30: latest, d30: 0, spark: sp });
  const H = {
    body: { hasData: true, weight: { ...tr(80), source: 's', sources: 1 }, bodyfat: { ...tr(18), delta: 0, source: 's' }, lean: { ...tr(60), delta: 0, source: 's' },
      waist: { latest: 85, latestDate: '2026-06-01', firstDate: '2026-03-01', points: 2, delta: -1, spark: sp } },
    activity: { hasData: true, steps: tr(9000), exercise: tr(30), distance: tr(6), flights: tr(10) },
    energy: { hasData: true, tdeeLatest: 2500, tdeeLatestDate: '2026-06-30', tdeeAvg: 2400, tdeeDays: 30, spark: sp, balance: null },
    recovery: { hasData: true, rhr: tr(52), hrv: tr(60), vo2max: { latest: 45, latestDate: '2026-06-30', first: 44, spark: sp }, walkingHr: tr(95),
      respiratory: tr(14.5), wristTemp: tr(36), sleep: { latest: 7, avg: 7, nights: 30, latestDate: '2026-06-30', spark: sp, target: 7.5 } },
    running: { hasData: true, count: 1, sessions: [{ date: '2026-06-22', dist: 7.7, time: '0:41', pace: '5:18', hrAvg: 152, re: 57, elev: 35 }] },
    cycling: { hasData: true, count: 1, sessions: [{ date: '2026-06-10', dist: 40, time: '1:30', elev: 400, hrAvg: 140, re: 90, kj: 1300 }] },
    loadRecovery: none,
  };
  const html = renderAt(H, '2026-07-01', { detail: true });
  const keys = ['rhr', 'hrv', 'vo2max', 'walkingHr', 'respiratory', 'wristTemp', 'sleep', 'weight', 'bodyfat', 'lean', 'waist', 'steps', 'exercise', 'distance', 'flights', 'energy'];
  for (const k of keys) assert.match(html, new RegExp(`<div class="mtrend"(?: id="hl-\\w+")? data-detail="${k}" role="button" tabindex="0" aria-haspopup="dialog">`), k);
  assert.match(html, /<tr data-detail="load-run" data-date="2026-06-22"><td class="dt-cell"><button type="button" class="dt-row-btn" data-detail="load-run" data-date="2026-06-22" aria-haspopup="dialog">22 Jun<\/button><\/td>/);
  assert.match(html, /<tr data-detail="load-bike" data-date="2026-06-10"><td class="dt-cell"><button type="button" class="dt-row-btn"/);
  assert.doesNotMatch(renderAt(H, '2026-07-01'), /data-detail/, 'no detail sheet baked: plain cards and rows');
});

test('activity: headline = the latest day with its date, "so far" when it is today; 30-day avg + delta underneath', () => {
  const H = {
    body: none, energy: none, running: none, recovery: none, loadRecovery: none,
    activity: { hasData: true, steps: { latest: 9039, latestDate: '2026-06-30', avg30: 8500, days30: 31, d30: 300, spark: sp } },
  };
  const past = renderAt(H, '2026-07-02');
  assert.match(past, /9039<small>[^<]*<\/small><span class="mtrend-date">30 Jun<\/span>/);
  assert.match(past, /<div class="mtrend-ctx">30-day avg 8500[^<]*<span class="dlt good">▲ \+300<\/span><\/div>/);
  const today = renderAt(H, '2026-06-30');
  assert.match(today, /<span class="mtrend-date">today, so far<\/span>/);
});

test('recovery: resting HR / HRV / sleep lead with the newest value + date; trends carry hl-<key> anchors for the health monitor', () => {
  const H = {
    body: none, activity: none, energy: none, running: none, loadRecovery: none,
    recovery: {
      hasData: true,
      rhr: { latest: 52, latestDate: '2026-06-30', avg30: 50.4, d30: -1, spark: sp },
      hrv: { latest: 71, latestDate: '2026-06-30', avg30: 60, d30: 2, spark: sp },
      respiratory: { latest: 14.8, latestDate: '2026-06-29', avg30: 14.5, d30: 0.1, spark: sp },
      wristTemp: { latest: 36.1, latestDate: '2026-06-29', avg30: 36.05, d30: 0, spark: sp },
      sleep: { latest: 6.4, avg: 7.2, nights: 30, latestDate: '2026-06-30', spark: sp, target: 7.5, pctTarget: 40, sd: 0.6 },
    },
  };
  const html = renderAt(H, '2026-07-01');
  for (const k of ['rhr', 'hrv', 'respiratory', 'wristTemp']) assert.match(html, new RegExp(`<div class="mtrend" id="hl-${k}">`), k);
  assert.match(html, /<div class="hsub" id="hl-sleep">/, 'sleep: the section heading is the anchor');
  assert.match(html, /71<small>ms<\/small><span class="mtrend-date">30 Jun<\/span>/);
  assert.match(html, /30-day avg 60 ms/);
  assert.match(html, /6.4<small>h<\/small><span class="mtrend-date">30 Jun<\/span>/);
  assert.match(html, /30-night avg 7.2 h/);
  assert.match(html, /<div class="hsub" id="hl-recovery">/, 'the section anchor is kept');
});

test('energy: expenditure headline = the newest day TDEE with its date; 30-day avg as context', () => {
  const html = renderAt({
    body: none, activity: none, running: none, recovery: none, loadRecovery: none,
    energy: { hasData: true, tdeeLatest: 2600, tdeeLatestDate: '2026-06-29', tdeeAvg: 2400, tdeeDays: 30, spark: sp, balance: null, intakeDays: 0 },
  }, '2026-07-01');
  assert.match(html, /2600<small>kcal<\/small><span class="mtrend-date">29 Jun<\/span>/);
  assert.match(html, /30-day avg 2400 kcal/);
});

test('resilience: a non-finite avg30 / d30 never prints NaN or Infinity; one broken trend never blanks the tab', () => {
  const html = renderAt({
    body: none, energy: none, running: none, loadRecovery: none,
    activity: { hasData: true, steps: { latest: 9000, latestDate: '2026-06-30', avg30: NaN, d30: Infinity, spark: sp } },
    recovery: {
      hasData: true,
      rhr: { get latest() { throw new Error('boom'); }, latestDate: '2026-06-30' },
      hrv: { latest: 70, latestDate: '2026-06-30', avg30: 61, d30: NaN, spark: sp },
    },
  }, '2026-07-01');
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /9000<small>/, 'the steps card still shows its headline');
  assert.match(html, /70<small>ms/, 'the HRV card renders after the broken resting-HR card');
  assert.match(html, /30-day avg 61 ms/);
});

test('body composition: body fat and lean mass say how many readings their window holds', () => {
  const bc = (latest) => ({ latest, latestDate: '2026-06-01', source: 'Scale', points: 30, windowPoints: 4, windowDays: 150, delta: -0.8, spark: null });
  const html = renderWith({
    body: { hasData: true, bodyfat: bc(18.2), lean: bc(62.1) },
    activity: none, energy: none, running: none, recovery: none, loadRecovery: none,
  });
  assert.equal(html.split('4 readings in the last 150 days').length - 1, 2);
});
