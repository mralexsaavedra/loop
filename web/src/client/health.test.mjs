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
  assert.match(html, /<section class="hs-sec hs-sec-recovery" id="hl-recovery" aria-labelledby="hs-h-recovery">/);
  assert.match(html, /<section class="hs-sec hs-sec-running" id="hl-running" aria-labelledby="hs-h-running">/);
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
    walkingHr: { latest: 98, latestDate: '2026-06-30', avg30: 100, d30: -1, spark: null },
    sleep: { latest: 6.4, avg: 7.2, nights: 30, latestDate: '2026-06-30', spark: null, target: 7.5, pctTarget: 40, sd: 0.6 },
  },
  loadRecovery: { hasData: true, weeks: 2, series: [{ w: '2026-06-01', load: 10 }, { w: '2026-06-08', load: 0 }], split: null },
});

test('Salud answers "how is my body": recovery, fitness, sleep, body, activity, energy in that order; training blocks go to Entreno', () => {
  const out = {};
  renderWith(full(), { out });
  const at = (k) => out.health.indexOf(`id="hl-${k}"`);
  const order = ['recovery', 'fitness', 'sleep', 'body', 'activity', 'energy'].map(at);
  assert.ok(order.every((v, i) => v !== -1 && (i === 0 || v > order[i - 1])), `Salud order ${order}`);
  for (const k of ['running', 'cycling', 'load']) {
    assert.equal(at(k), -1, `${k} is not in Salud`);
    assert.notEqual(out.train.indexOf(`id="hl-${k}"`), -1, `${k} is in Entreno`);
  }
  const t = (k) => out.train.indexOf(`id="hl-${k}"`);
  assert.ok(t('running') < t('cycling') && t('cycling') < t('load'), 'Entreno order: running, cycling, load vs recovery');
  assert.match(out.health, /<section class="hs-sec hs-sec-sleep" id="hl-sleep"/, 'sleep is its own section (monitor + sleep dial land here)');
  assert.equal(out.health.split('id="hl-sleep"').length - 1, 1, 'one hl-sleep id');
});

test('the recovery detail card host (#score-recovery) sits right under the recovery heading', () => {
  const out = {};
  renderWith(full(), { out });
  const head = /id="hl-recovery" aria-labelledby="hs-h-recovery"><div class="hs-head">[\s\S]*?<\/div>(?:<div class="hs-info" id="hs-info-recovery" hidden>[\s\S]*?<\/div>)?<div id="score-recovery"><\/div>/;
  assert.match(out.health, head);
  // even with no recovery trends, a baked recovery score still gets its section + host
  renderWith({ ...full(), recovery: none }, { out, SCORES: { recovery: { asOf: '2026-06-30' } } });
  assert.match(out.health, head);
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

// Salud (#health-body) + Entreno (#health-train) hosts; returns both, Salud first, or each via `out`.
// `balance: true` adds Nutrición's #nutri-balance host (out.balance, out.balanceHidden).
function renderWith(HEALTH, { DateCls = Date, SCORES, PROFILE, out = {}, detail = false, balance = false, introSlot = false } = {}) {
  const doc = new StubDocument();
  const slot = introSlot ? doc.el('hs-intro-i', { attrs: { 'data-label': 'About Health' } }) : null;
  const host = doc.el('health-body');
  const train = doc.el('health-train');
  const bal = balance ? doc.el('nutri-balance') : null;
  const ctx = { document: doc, window: {}, HEALTH, SCORES, PROFILE, I18N_HEALTH: enHealth, LOCALE: 'en', Math, String, Number, Date: DateCls, JSON };
  if (detail) ctx.DETAIL = { metrics: {} };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  out.health = host.innerHTML;
  out.train = train.innerHTML;
  if (bal) { out.balance = bal.innerHTML; out.balanceHidden = bal.hidden; }
  if (slot) out.intro = slot.innerHTML;
  return host.innerHTML + train.innerHTML;
}

test('the Salud title\'s ⓘ is the shared HC.infoBtn markup, written into its slot (no hand-copied button in Salud.astro)', () => {
  const out = {};
  renderWith({ body: none, activity: none, energy: none, running: none, cycling: none, recovery: none, loadRecovery: none }, { out, introSlot: true });
  const ctx = vm.createContext({});
  loadUtil(ctx);
  assert.equal(out.intro, ctx.HC.infoBtn('hs-intro', 'About Health'));
  assert.match(out.intro, /data-hs-info="hs-intro" aria-expanded="false" aria-controls="hs-intro" aria-label="About Health"/);
});
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
  assert.match(html, /<span class="db-name">Waist<\/span>/);
  assert.match(html, /85.2<\/b><small>cm<\/small><span class="db-arr db-good" aria-hidden="true">▼<\/span>/);
  assert.match(html, /<span class="db-base">1 Jun · Δ -2.8 cm<\/span>/, 'measurement date + change since the first reading');
  assert.doesNotMatch(html, /No waist measurements yet/);
});

test('body section without waist data says how to add it (empty state)', () => {
  const html = renderWith({
    body: { hasData: true, weight: { latest: 80, latestDate: '2026-06-01', source: 's', sources: 1, d30: null, spark: null } },
    activity: none, energy: none, running: none, recovery: none, loadRecovery: none,
  });
  assert.match(html, /No waist measurements yet/);
});

test('cycling section: one list row per ride (newest first): icon · date with HR / effort / work under it · distance with time and climb; the count and sources behind ⓘ', () => {
  const html = renderWith({
    body: none, activity: none, energy: none, recovery: none, loadRecovery: none,
    running: { hasData: true, count: 1, sessions: [{ date: '2026-06-02', dist: 8, pace: '5:30', speed: 10.9, power: null, gct: null, vosc: null, stride: null }] },
    cycling: { hasData: true, count: 12, sessions: [
      { date: '2026-06-10', dist: 40.25, time: '1:30', elev: 412, hrAvg: 141, re: 96, kj: 1310 },
      { date: '2026-06-04', dist: null, time: '1:00', elev: null, hrAvg: null, re: null, kj: null },
    ] },
  });
  assert.match(html, /<section class="hs-sec hs-sec-cycling" id="hl-cycling" aria-labelledby="hs-h-cycling"><div class="hs-head"><h3 class="hs-lbl" id="hs-h-cycling">Cycling<\/h3><button type="button" class="hs-i" data-hs-info="hs-info-cycling"/);
  assert.doesNotMatch(html, /<table|run-tbl/, 'no tables left');
  const rows = [...html.slice(html.indexOf('id="hl-cycling"')).matchAll(/<li class="db-row"[^>]*><svg class="db-ico"[^>]*>[\s\S]*?<\/svg><span class="db-name">([^<]+)(?:<small class="db-note">([^<]*)<\/small>)?<\/span><span class="db-vals"><span class="db-val"><b>([^<]+)<\/b>(?:<small>([^<]*)<\/small>)?<\/span>(?:<span class="db-base">([^<]*)<\/span>)?/g)].map((m) => m.slice(1));
  // ONE row template with the runs: the small lines under the value, nothing under the date
  assert.deepEqual(rows[0], ['Wed 10 Jun', undefined, '40.25', 'km', '1:30 · ↑412 m']);
  // a ride's second small line: HR · effort · kJ (the work is visible on the row, grouped by HC.nf)
  assert.match(html, /<span class="db-base">1:30 · ↑412 m<\/span><span class="db-base">141 bpm · Effort 96 · 1,310 kJ<\/span><\/span><\/li>/);
  assert.match(html, /aria-label="Wed 10 Jun · 40.25 km · 1:30 · ↑412 m · 141 bpm · Effort 96 · 1,310 kJ"/, 'and in the aria label');
  assert.doesNotMatch(html.slice(html.indexOf('Thu 4 Jun')).split('</li>')[0], /class="db-base">[^<]*<\/span><span class="db-base">/, 'nothing recorded: no empty second line');
  assert.deepEqual(rows[1], ['Thu 4 Jun', undefined, '—', undefined, '1:00'], 'missing fields are left out, never 0; no distance = a dash, no unit');
  const info = html.match(/<div class="hs-info" id="hs-info-cycling" hidden>([\s\S]*?)<\/div>/)[1];
  assert.match(info, /<b>12<\/b> rides/);
  assert.ok(html.indexOf('hl-running') < html.indexOf('hl-cycling'), 'cycling follows running');
});

test('running rows (text diet): date, distance, time + pace only; HR, effort, climb and the watch dynamics move to the opened day (aria keeps them)', () => {
  const html = renderWith({
    body: none, activity: none, energy: none, recovery: none, loadRecovery: none, cycling: none,
    running: { hasData: true, count: 5, sessions: [
      { date: '2026-06-22', dist: 7.7, time: '0:41', pace: '5:18', hrAvg: 152, re: 57, elev: 35, power: null, gct: null, vosc: null, stride: null },
      { date: '2026-06-20', dist: null, time: '0:30', pace: null, hrAvg: null, re: null, elev: null, power: 240, gct: 250, vosc: 10, stride: 1.1 },
    ] },
  });
  assert.match(html, /<span class="db-name">Mon 22 Jun<\/span><span class="db-vals"><span class="db-val"><b>7.7<\/b><small>km<\/small><\/span><span class="db-base">0:41 · 5:18\/km<\/span>/);
  assert.match(html, /<span class="db-name">Sat 20 Jun<\/span><span class="db-vals"><span class="db-val"><b>—<\/b><\/span><span class="db-base">0:30<\/span>/, 'no distance: no pace');
  assert.doesNotMatch(html.slice(html.indexOf('id="hl-running"')), /db-note/, 'no small line under the date');
  assert.match(html, /aria-label="Mon 22 Jun · 7.7 km · 0:41 · 5:18\/km · 152 bpm · Effort 57 · ↑35 m"/);
  assert.match(html, /aria-label="Sat 20 Jun · 0:30 · 240 W · GCT 250 ms · Osc\. 10 cm · Stride 1.1 m"/);
  assert.equal((html.match(/<path d="M6 21l3.5-5/g) || []).length, 2, 'the run icon on every run row');
  assert.match(html.match(/<div class="hs-info" id="hs-info-running" hidden>([\s\S]*?)<\/div>/)[1], /<b>5<\/b> runs/);
});

test('load vs recovery: weekly bars (strain blue) in a card, HRV and resting HR of the higher-load weeks as two metric rows (▲▼ vs the easy weeks, coloured by the good direction), the explanation behind ⓘ', () => {
  const html = renderWith({
    body: none, activity: none, energy: none, recovery: none, running: none, cycling: none,
    loadRecovery: { hasData: true, weeks: 2, series: [{ w: '2026-06-01', load: 10 }, { w: '2026-06-08', load: 0 }], split: { hrvHigh: 50.8, hrvLow: 55.5, rhrHigh: 54.4, rhrLow: 54.4 } },
  });
  assert.match(html, /<section class="hs-sec hs-sec-load" id="hl-load" aria-labelledby="hs-h-load"><div class="hs-head"><h3 class="hs-lbl" id="hs-h-load">Load vs recovery<\/h3><button type="button" class="hs-i" data-hs-info="hs-info-load"/);
  const info = html.match(/<div class="hs-info" id="hs-info-load" hidden>([\s\S]*?)<\/div>/)[1];
  assert.ok(info.includes(enHealth.loadSec.hint.replace('{weeks}', '2')) && info.includes(enHealth.loadNoteHtml), 'hint + explanation behind ⓘ');
  assert.match(html, /<div class="lvr-card"><span class="dt-trend-lbl">Weekly cardiovascular load<\/span><div class="wbars">/);
  assert.equal((html.match(/class="wbar[ "]/g) || []).length, 2);
  // the reference's trend bars: each week's value printed on top of its bar, the bar in a fixed track
  assert.ok(html.includes('<div class="wbar"'), 'a week with load');
  assert.match(html, /<div class="wbar"[^>]*><span class="wbar-v">10<\/span><span class="wbar-t"><i style="height:100%"><\/i><\/span><\/div>/);
  assert.match(html, /<div class="wbar zero"[^>]*><span class="wbar-v">0<\/span><span class="wbar-t"><i style="height:0%"><\/i><\/span><\/div>/);
  assert.match(html, /<span class="db-name">HRV · higher-load weeks<\/span><span class="db-vals"><span class="db-val"><b>50.8<\/b><small>ms<\/small><span class="db-arr db-bad" aria-hidden="true">▼<\/span><\/span><span class="db-base">easy weeks 55.5 ms<\/span>/, 'lower HRV in heavier weeks: ▼ orange');
  assert.match(html, /<span class="db-name">resting HR · higher-load<\/span><span class="db-vals"><span class="db-val"><b>54.4<\/b><small>bpm<\/small><span class="db-arr db-flat" aria-hidden="true">•<\/span>/, 'same resting HR: grey dot');
  assert.doesNotMatch(html, /dash-card|class="hsub"/, 'no tiles, no sub-headings left');
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

test('every Salud trend card opens its detail view; run / ride rows open that day in the load view (the row is the keyboard opener)', () => {
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
  for (const k of keys) assert.match(html, new RegExp(`<li><div class="db-row"(?: id="hl-\\w+")? data-detail="${k}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="`), k);
  assert.match(html, /<li><div class="db-row" data-detail="load-run" data-date="2026-06-22" role="button" tabindex="0" aria-haspopup="dialog" aria-label="Mon 22 Jun · 7.7 km · /);
  assert.match(html, /<li><div class="db-row" data-detail="load-bike" data-date="2026-06-10" role="button" tabindex="0" aria-haspopup="dialog" aria-label="/);
  assert.doesNotMatch(renderAt(H, '2026-07-01'), /data-detail/, 'no detail sheet baked: plain cards and rows');
});

test('activity: headline = the latest day with its date, "so far" when it is today; 30-day avg + delta underneath', () => {
  const H = {
    body: none, energy: none, running: none, recovery: none, loadRecovery: none,
    activity: { hasData: true, steps: { latest: 9039, latestDate: '2026-06-30', avg30: 8500, days30: 31, d30: 300, spark: sp } },
  };
  const past = renderAt(H, '2026-07-02');
  assert.match(past, /9,039<\/b><small>steps<\/small><span class="db-arr db-good" aria-hidden="true">▲<\/span><\/span><span class="db-base">8,500<\/span>/);
  assert.match(past, /aria-label="Steps: 9,039 steps, 30 Jun · 30-day avg 8,500 steps · above"/);
  const today = renderAt(H, '2026-06-30');
  assert.match(today, /9,039<\/b><small>steps<\/small><\/span><span class="db-base">8,500 · today, so far<\/span>/, 'a partial day: no arrow');
});

test('recovery: resting HR / HRV / sleep lead with the newest value, the 30-day baseline under it; rows carry hl-<key> anchors for the health monitor', () => {
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
  for (const k of ['rhr', 'hrv', 'respiratory', 'wristTemp']) assert.match(html, new RegExp(`<li class="db-row" id="hl-${k}" aria-label="`), k);
  assert.match(html, /<section class="hs-sec hs-sec-sleep" id="hl-sleep"/, 'sleep: the section is the anchor');
  assert.match(html, /71<\/b><small>ms<\/small><span class="db-arr db-good" aria-hidden="true">▲<\/span><\/span><span class="db-base">60<\/span>/);
  assert.match(html, /aria-label="HRV: 71 ms, 30 Jun · 30-day avg 60 ms · above"/);
  assert.match(html, /6:24<\/b><span class="db-arr db-bad" aria-hidden="true">▼<\/span><\/span><span class="db-base">7:12<\/span>/);
  assert.match(html, /30-night avg 7:12/);
  assert.match(html, /52<\/b><small>bpm<\/small><span class="db-arr db-bad" aria-hidden="true">▲<\/span>/, 'resting HR above its baseline is the bad way');
  assert.match(html, /14.8<\/b><small>brpm<\/small><span class="db-arr db-neutral"/, 'a change signal has no good direction: a neutral (never grey) arrow');
  assert.match(html, /<section class="hs-sec hs-sec-recovery" id="hl-recovery"/, 'the section anchor is kept');
  // the sleep rows carry their own icons (moon, target, spread), not a moon on every row
  const sleepSec = html.slice(html.indexOf('id="hl-sleep"'), html.indexOf('</section>', html.indexOf('id="hl-sleep"')));
  const moon = (sleepSec.match(/<path d="M20 14.5A8/g) || []).length;
  assert.equal(moon, 1, 'one moon: the sleep row itself');
  assert.match(sleepSec, /<path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 8a4/, 'nights at target: the target icon');
  assert.match(sleepSec, /<path d="M4 7h16M4 12h16M4 17h16/, 'night-to-night spread: the regularity icon');
});

test('recovery: a signal the health monitor already lists is not repeated under Recovery; one it lacks stays', () => {
  const tr = (latest) => ({ latest, latestDate: '2026-06-30', avg30: latest, d30: 0, spark: sp });
  const H = {
    body: none, activity: none, energy: none, running: none, loadRecovery: none,
    recovery: { hasData: true, rhr: tr(52), hrv: tr(60), respiratory: tr(14.5), wristTemp: tr(36) },
  };
  const SCORES = { monitor: { cards: [{ key: 'respiratory' }, { key: 'rhr' }, { key: 'hrv' }, { key: 'sleep' }] } };
  const html = renderAt(H, '2026-07-01', { SCORES });
  for (const k of ['rhr', 'hrv', 'respiratory']) assert.doesNotMatch(html, new RegExp(`id="hl-${k}"`), `${k} lives in the monitor only`);
  assert.match(html, /<li class="db-row" id="hl-wristTemp"/, 'not in the monitor: kept under Recovery');
  assert.match(html, /<section class="hs-sec hs-sec-recovery" id="hl-recovery"[\s\S]*<div id="score-recovery"><\/div>/, 'the section and its card host stay');
  const all = renderAt(H, '2026-07-01', { SCORES: { monitor: { cards: [{ key: 'rhr' }, { key: 'hrv' }, { key: 'respiratory' }, { key: 'wristTemp' }] } } });
  assert.doesNotMatch(all, /<ul class="db-list">[^]*?id="hl-(rhr|hrv|respiratory|wristTemp)"/, 'all four in the monitor: no rows under Recovery');
  assert.match(all, /<div id="score-recovery"><\/div><\/section>/, 'the section keeps only the card host');
});

test('energy: expenditure headline = the newest day TDEE with its date; 30-day avg as context', () => {
  const html = renderAt({
    body: none, activity: none, running: none, recovery: none, loadRecovery: none,
    energy: { hasData: true, tdeeLatest: 2600, tdeeLatestDate: '2026-06-29', tdeeAvg: 2400, tdeeDays: 30, spark: sp, balance: null, intakeDays: 0 },
  }, '2026-07-01');
  assert.match(html, /2,600<\/b><small>kcal<\/small><span class="db-arr db-neutral" aria-hidden="true">▲<\/span><\/span><span class="db-base">2,400<\/span>/, 'no good direction: a neutral --ink arrow, never grey');
  assert.match(html, /aria-label="Daily expenditure: 2,600 kcal, 29 Jun · 30-day avg 2,400 kcal/);
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
  assert.match(html, /9,000<\/b>/, 'the steps row still shows its value');
  assert.match(html, /70<\/b><small>ms/, 'the HRV row renders after the broken resting-HR row');
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

/* ---- stale cards: a trend card whose newest value is > STALE_DAYS old is greyed with a note ---- */
test('a Salud row whose newest value is more than 3 days old is greyed with "no recent data" and no arrow; a fresh one is not', () => {
  const tr = (latestDate) => ({ latest: 52, latestDate, avg30: 50, d30: 0, spark: sp });
  const H = {
    body: { hasData: true, weight: { ...tr('2026-06-25'), source: 's', sources: 1 },
      waist: { latest: 85, latestDate: '2026-03-01', firstDate: '2026-01-01', points: 2, delta: -1, spark: sp } },
    activity: { hasData: true, steps: tr('2026-07-01') },
    energy: none, running: none, loadRecovery: none,
    recovery: { hasData: true, rhr: tr('2026-06-28'), hrv: tr('2026-06-27') },
  };
  const out = {};
  renderAt(H, '2026-07-01', { out });
  const row = (name) => {
    const at = out.health.indexOf(`<span class="db-name">${name}</span>`);
    const i = out.health.lastIndexOf('<li class="db-row', at);
    return out.health.slice(i, out.health.indexOf('</li>', i));
  };
  const rhr = row('Resting HR'); // 3 days old: still fresh (the rule is MORE than 3 days)
  assert.match(rhr, /^<li class="db-row" id="hl-rhr"/);
  assert.ok(!rhr.includes(enHealth.staleNote));
  const hrv = row('HRV'); // 4 days old
  assert.match(hrv, /^<li class="db-row db-stale" id="hl-hrv"/);
  assert.ok(hrv.includes('<span class="db-base">' + enHealth.staleNote + '</span>'));
  assert.doesNotMatch(hrv, /db-arr/);
  assert.match(row('Weight'), /^<li class="db-row db-stale"/);
  assert.match(row('Steps'), /^<li class="db-row"[^>]*aria-label/, 'today is fresh');
  assert.doesNotMatch(row('Steps'), /db-stale/);
  // waist is a sparse manual measurement dated in its own line: never greyed by this rule
  assert.ok(!row('Waist').includes('db-stale'));
  assert.equal(enHealth.staleNote, 'no recent data');
});

test('Fitness groups VO₂max (Δ since the first reading) and walking HR, moved out of Recovery', () => {
  const H = {
    body: none, activity: none, energy: none, running: none, loadRecovery: none,
    recovery: { hasData: true, rhr: { latest: 52, latestDate: '2026-06-30', avg30: 50, d30: 0, spark: sp },
      vo2max: { latest: 45.2, latestDate: '2026-06-30', first: 44, spark: sp }, walkingHr: { latest: 96, latestDate: '2026-06-30', avg30: 100, d30: -2, spark: sp } },
  };
  const out = {};
  renderAt(H, '2026-07-01', { out, detail: true });
  const sec = (k) => { const i = out.health.indexOf(`id="hl-${k}"`); return i === -1 ? '' : out.health.slice(i, out.health.indexOf('</section>', i)); };
  assert.match(sec('fitness'), /<h3 class="hs-lbl" id="hs-h-fitness">Fitness<\/h3>/);
  assert.match(sec('fitness'), /data-detail="vo2max"[\s\S]*45.2<\/b><small>ml\/kg\/min<\/small><span class="db-arr db-good" aria-hidden="true">▲<\/span><\/span><span class="db-base">Δ \+1.2<\/span>/);
  assert.match(sec('fitness'), /data-detail="walkingHr"[\s\S]*96<\/b><small>bpm<\/small><span class="db-arr db-good" aria-hidden="true">▼<\/span>/, 'walking HR down is the good way');
  assert.doesNotMatch(sec('recovery'), /vo2max|walkingHr/, 'no longer under Recovery');
  assert.ok(out.health.indexOf('id="hl-recovery"') < out.health.indexOf('id="hl-fitness"'));
});

test('text diet: rows carry number + label + arrow + baseline only; every former intro / caveat is reachable behind an ⓘ toggle', () => {
  const E = { hasData: true, tdeeLatest: 4400, tdeeLatestDate: '2026-06-29', tdeeAvg: 2600, tdeeDays: 30, spark: sp, balance: null, lastIntake: null, latestCorrected: true, correctedDays: 2 };
  const out = {};
  renderAt({ ...full(), energy: E }, '2026-07-01', { out });
  const h = out.health;
  assert.doesNotMatch(h, /mtrend|class="spark|dash-note|dash-as/, 'no trend cards, sparklines or loose notes left in Salud');
  for (const key of ['recovery', 'fitness', 'sleep', 'body', 'activity', 'energy']) {
    assert.match(h, new RegExp(`<button type="button" class="hs-i" data-hs-info="hs-info-${key}" aria-expanded="false" aria-controls="hs-info-${key}" aria-label="About [^"]+">`), key);
    assert.match(h, new RegExp(`<div class="hs-info" id="hs-info-${key}" hidden>`), key);
  }
  const info = (k) => { const i = h.indexOf(`<div class="hs-info" id="hs-info-${k}" hidden>`); return h.slice(i, h.indexOf('</div>', i)); };
  assert.ok(info('recovery').includes(enHealth.recoveryNoteHtml));
  assert.ok(info('fitness').includes(enHealth.fitnessNoteHtml));
  assert.ok(info('sleep').includes(enHealth.sleepNoteHtml));
  assert.ok(info('activity').includes(enHealth.activityNoteHtml));
  assert.ok(info('body').includes('<b>How to read this.</b>'), 'the bioimpedance caveat');
  assert.ok(info('body').includes('No waist measurements yet'));
  assert.ok(info('energy').includes(enHealth.energyRide.latest));
  assert.ok(info('energy').includes(enHealth.energyRide.days.replace('{n}', '2')));
  assert.ok(info('energy').includes('<b>Expenditure only.</b>') || info('energy').includes('Expenditure'), 'the expenditure-only caveat');
  assert.ok(!h.includes(enHealth.introMsg), 'the tab intro lives in the Salud header ⓘ (tabs/Salud.astro)');
});

test('sleep consistency: % nights on target, ±spread, bedtime / wake as rows that open the sleep sheet', () => {
  const H = {
    body: none, activity: none, energy: none, running: none, loadRecovery: none,
    recovery: { hasData: true, sleep: { latest: 7.1, avg: 7.2, nights: 30, latestDate: '2026-06-30', spark: sp, target: 7.5, pctTarget: 40, sd: 0.6, bedtime: '23:40', bedtimeSd: 25, wake: '07:05', wakeSd: 18 } },
  };
  const html = renderAt(H, '2026-07-01', { detail: true });
  assert.match(html, /<span class="db-name">nights ≥ 7:30<\/span><span class="db-vals"><span class="db-val"><b>40<\/b><small>%<\/small>/);
  assert.match(html, /<b>±0:36<\/b>/);
  assert.match(html, /<b>23:40<\/b><\/span><span class="db-base">±25′<\/span>/);
  assert.match(html, /<b>07:05<\/b><\/span><span class="db-base">±18′<\/span>/);
  assert.equal((html.match(/data-detail="sleep"/g) || []).length, 5);
});

test('sleep stages: REM / deep / core / awake rows (hours, % of asleep, vs the staged-night mean) + efficiency, with their ⓘ note; none without stages', () => {
  const base = { latest: 7.1, avg: 7.2, nights: 30, latestDate: '2026-06-30', spark: sp, target: 7.5, pctTarget: 40, sd: 0.6 };
  const stages = { date: '2026-06-30', rem: 1.6, deep: 1, core: 4.6, awake: 0.3, eff: 93, shares: { rem: 23, deep: 14, core: 66 }, avg: { rem: 1.4, deep: 1.1, core: 4.6, awake: 0.4, eff: 92 }, nights: 10 };
  const H = (sl) => ({ body: none, activity: none, energy: none, running: none, loadRecovery: none, recovery: { hasData: true, sleep: sl } });
  const html = renderAt(H({ ...base, stages }), '2026-07-01', { detail: true });
  for (const k of ['rem', 'deep', 'core', 'awake', 'eff']) assert.ok(html.includes(`<span class="db-name">${enHealth.sleepCards.stages[k]}</span>`), k);
  assert.match(html, /REM sleep<\/span><span class="db-vals"><span class="db-val"><b>1:36<\/b><span class="db-arr/);
  assert.ok(html.includes('23% · 1:24'), 'share of asleep, then the mean (h:mm)');
  assert.match(html, /sleep efficiency<\/span><span class="db-vals"><span class="db-val"><b>93<\/b><small>%<\/small>/);
  assert.ok(html.includes(enHealth.sleepStagesNoteHtml), 'ⓘ explains stages + efficiency');
  const old = renderAt(H(base), '2026-07-01', { detail: true });
  assert.ok(!old.includes(enHealth.sleepCards.stages.rem) && !old.includes(enHealth.sleepStagesNoteHtml), 'older extract: no stage rows');
});

test('sleep: an estimated (in-bed-only) newest night is labelled next to its value, and the ⓘ counts the estimated nights; a Watch night has neither', () => {
  const base = { latest: 8.2, avg: 7.9, nights: 9, latestDate: '2026-06-30', spark: sp, target: 7.5, pctTarget: 60, sd: 0.6 };
  const H = (sl) => ({ body: none, activity: none, energy: none, running: none, loadRecovery: none, recovery: { hasData: true, sleep: sl } });
  const html = renderAt(H({ ...base, latestEstimated: true, estimatedNights: 9 }), '2026-07-01', { detail: true });
  assert.ok(html.includes(enHealth.sleepCards.estimated + ' · '), 'the label before the 30-night mean');
  assert.ok(html.includes('<b>Estimated nights</b> (9 of the last 30)'));
  const watch = renderAt(H(base), '2026-07-01', { detail: true });
  assert.ok(!watch.includes(enHealth.sleepCards.estimated) && !watch.includes('Estimated nights'));
});

/* ---- Balance: intake vs expenditure + the macro split live in Nutrición (#nutri-balance), not Salud ---- */
const BAL = {
  hasData: true, tdeeLatest: 2600, tdeeLatestDate: '2026-06-29', tdeeAvg: 2400, tdeeDays: 30, spark: null,
  lastIntake: '2026-06-29', intakeDays: 40,
  balance: { from: '2026-05-31', to: '2026-06-29', days: 30, intakeAvg: 2312, tdeeAvg: 2717, net: -405 },
  macros: { days: 28, p: 140, c: 250, g: 70, pPct: 26, cPct: 46, gPct: 29 },
};
test('Balance moved: Salud\'s Energy keeps the expenditure row only — no intake average, deficit, macro cards or balance note', () => {
  const out = {};
  renderAt({ ...full(), energy: BAL }, '2026-07-01', { out, balance: true });
  const h = out.health;
  const energy = h.slice(h.indexOf('id="hl-energy"'));
  assert.match(energy, /Daily expenditure/);
  assert.doesNotMatch(energy, /dash-card|2312|-405|Deficit \/ day|deficit\/day|Avg intake|Macro split|140 g/, 'nothing of the balance is left in Salud');
  assert.ok(!energy.includes('Balance over'), 'the balance note moved too');
  assert.ok(energy.includes('<b>Expenditure only.</b>'), 'Salud says where the intake went');
});

test('Nutrición Balance: window caption, avg intake / avg burn / deficit per day as metric rows, a stacked macro split bar, the balance note behind ⓘ', () => {
  const out = {};
  renderAt({ ...full(), energy: BAL }, '2026-07-01', { out, balance: true, detail: true });
  const b = out.balance;
  assert.equal(out.balanceHidden, false);
  assert.match(b, /^<section class="hs-sec nb" aria-labelledby="nb-h"><div class="hs-head"><h2 class="hs-lbl" id="nb-h">Balance<\/h2><button type="button" class="hs-i" data-hs-info="nb-info"[^>]*aria-label="About Balance">/);
  assert.match(b, /<div class="hs-info" id="nb-info" hidden><p>Balance over 31 May–29 Jun \(30 logged days\)\. Negative = deficit\.[^<]*<b>historical<\/b>[^<]*The macro split is the average of those days\.<\/p><\/div>/);
  assert.match(b, /<p class="nb-win">31 May – 29 Jun · 30 days logged<\/p>/, 'a fixed window, labelled (no W / M / 6M: the bake has one window)');
  const rows = [...b.matchAll(/<(?:li|div) class="db-row"[^>]*>[\s\S]*?<span class="db-name">([^<]+)<\/span><span class="db-vals"><span class="db-val"><b>([^<]+)<\/b><small>kcal<\/small>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(rows, [['Avg intake', '2,312'], ['Avg burn', '2,717'], ['Deficit / day', '-405']]);
  assert.match(b, /<li><div class="db-row" data-detail="energy"[^>]*>[\s\S]*?Avg burn<\/span>[\s\S]*?<\/div><\/li>/, 'the burn row opens the expenditure sheet; its button role sits inside the <li>');
  assert.match(b, /<li class="db-row"[^>]*>[\s\S]*?Avg intake/, 'a row that opens nothing stays a plain <li class="db-row">');
  assert.match(b, /<div class="nutri-card nb-split"><span class="dt-trend-lbl">Macro split<\/span><svg class="act-bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="Macro split: Protein 140 g, 26%, Carbs 250 g, 46%, Fat 70 g, 29%">/);
  const segs = [...b.matchAll(/<rect class="nb-m-(\w)" x="([\d.]+)" y="0" width="([\d.]+)" height="8"\/>/g)].map((m) => [m[1], +m[2], +m[3]]);
  assert.deepEqual(segs.map((x) => x[0]), ['p', 'c', 'f']);
  assert.ok(Math.abs(segs.reduce((t, x) => t + x[2], 0) - 100) < 0.05, 'the segments fill the bar');
  assert.equal(segs[1][1], segs[0][2], 'stacked');
  assert.match(b, /<li><span class="act-sw nb-m-p" aria-hidden="true"><\/span><b>140 g<\/b> Protein <small>26%<\/small><\/li>/);
});

test('Nutrición Balance: a surplus is labelled as such; no macros -> no split bar', () => {
  const out = {};
  renderAt({ ...full(), energy: { ...BAL, balance: { ...BAL.balance, intakeAvg: 2900, net: 183 }, macros: undefined } }, '2026-07-01', { out, balance: true });
  assert.match(out.balance, /<span class="db-name">Surplus \/ day<\/span><span class="db-vals"><span class="db-val"><b>\+183<\/b>/);
  assert.doesNotMatch(out.balance, /nb-split|act-bar/);
  assert.doesNotMatch(out.balance, /The macro split is the average/);
});

test('Nutrición Balance without enough logged intake: a short empty line, the "intake can\'t be scored" note behind ⓘ; no expenditure -> no section', () => {
  const out = {};
  renderAt({ ...full(), energy: { ...BAL, balance: null, macros: undefined, lastIntake: '2026-06-01' } }, '2026-07-01', { out, balance: true });
  assert.match(out.balance, /<p class="nb-empty">Not enough intake logged yet for a balance\.<\/p>/);
  assert.match(out.balance, /<div class="hs-info" id="nb-info" hidden><p><b>Intake can’t be scored:<\/b> it was logged on too few recent days \(last on 1 Jun, 31 days ago\)/);
  assert.doesNotMatch(out.balance, /db-row|act-bar/);
  const none = {};
  renderAt({ ...full(), energy: { hasData: false } }, '2026-07-01', { out: none, balance: true });
  assert.equal(none.balance, '');
  assert.equal(none.balanceHidden, true, 'the empty host is hidden');
});

// the fitness-age block (SCORES.fitnessAge, lib/score/fitness-age.mjs) at the top of Fitness
const fitH = () => ({
  body: none, activity: none, energy: none, running: none, loadRecovery: none,
  recovery: { hasData: true, vo2max: { latest: 47.2, latestDate: '2026-06-28', first: 44, spark: sp } },
});
const fa = (over = {}) => ({ ok: true, age: 31.4, bound: null, sex: 'male', vo2: { value: 47.2, date: '2026-06-28', source: 'Demo <Watch>' },
  trend: { d30: { date: '2026-05-29', vo2: 46, age: 32.1, bound: null }, d90: { date: '2026-03-30', vo2: 45, age: 33.6, bound: null } }, ref: 'loe2013', ...over });
const fitSec = (html) => { const i = html.indexOf('id="hl-fitness"'); return i === -1 ? '' : html.slice(i, html.indexOf('</section>', i)); };
const P36 = { birthdate: '1990-06-15', sex: 'male' }; // 36 on 2026-07-01

test('fitness age: a ring with the fitness age, the years younger than the chronological age, and the VO₂max it comes from', () => {
  const out = {};
  renderAt(fitH(), '2026-07-01', { out, detail: true, SCORES: { fitnessAge: fa() }, PROFILE: P36 });
  const sec = fitSec(out.health);
  const T = enHealth.fitnessAge;
  assert.match(sec, /<figure class="dial fa fa-good"[^>]*data-detail="fitnessAge"/, 'the ring opens the fitness-age sheet');
  assert.match(sec, /<b class="dial-num">31<\/b><span class="dial-word">Fitness age<\/span>/);
  assert.ok(sec.includes('5 years younger'), 'chronological 36 − fitness 31');
  assert.ok(sec.includes('VO₂max 47.2 ml/kg/min · 28 Jun · Demo &lt;Watch&gt;'), 'its VO₂max, date and (escaped) source');
  assert.match(sec, /data-detail="fitnessAge"[\s\S]*Chronological age<\/span>[\s\S]*<b>36<\/b><small>years<\/small>/);
  // the 90-day trend row: 31.4 vs 33.6 -> Δ −2.2, lower is better
  assert.match(sec, /Fitness age, 90 days<\/span>[\s\S]*<b>31<\/b><small>years<\/small><span class="db-arr db-good" aria-hidden="true">▼<\/span><\/span><span class="db-base">Δ -2.2<\/span>/);
  assert.ok(sec.includes(T.noteHtml), 'the ⓘ cites the reference');
  assert.ok(sec.indexOf('class="dial fa') < sec.indexOf('data-detail="vo2max"'), 'the ring leads the section');
});

test('fitness age: older, bounds ("< 25", "> 75") and the singular year', () => {
  const at = (score, profile) => { const out = {}; renderAt(fitH(), '2026-07-01', { out, detail: true, SCORES: { fitnessAge: score }, PROFILE: profile }); return fitSec(out.health); };
  let s = at(fa({ age: 41.2 }), P36);
  assert.match(s, /class="dial fa fa-bad"/);
  assert.ok(s.includes('5 years older'));
  s = at(fa({ age: 35.4 }), P36);
  assert.ok(s.includes('1 year younger'));
  s = at(fa({ age: 36.2 }), P36);
  assert.match(s, /class="dial fa fa-flat"/);
  assert.ok(s.includes('Same as your age'));
  s = at(fa({ age: 25, bound: 'below', trend: { d30: null, d90: { date: '2026-03-30', vo2: 45, age: 33.6, bound: null } } }), P36);
  assert.match(s, /<b class="dial-num">&lt; 25<\/b>/);
  assert.ok(s.includes('At least 11 years younger'));
  assert.doesNotMatch(s, /Fitness age, 90 days/, 'no change against a clamped value');
  s = at(fa({ age: 75, bound: 'above', trend: { d30: null, d90: null } }), P36);
  assert.match(s, /<b class="dial-num">&gt; 75<\/b>/);
  assert.ok(s.includes('At least 39 years older'));
});

test('fitness age: no number without sex, birthdate or VO₂max — the reason instead', () => {
  const T = enHealth.fitnessAge;
  const at = (score, profile) => { const out = {}; renderAt(fitH(), '2026-07-01', { out, detail: true, SCORES: { fitnessAge: score }, PROFILE: profile }); return fitSec(out.health); };
  let s = at({ ok: false, reason: 'no-sex' }, { birthdate: '1990-06-15', sex: null });
  assert.ok(s.includes(T.noSex));
  assert.doesNotMatch(s, /class="dial fa/);
  s = at(fa(), { birthdate: null, sex: 'male' });
  assert.ok(s.includes(T.noBirth));
  assert.doesNotMatch(s, /class="dial fa/);
  s = at({ ok: false, reason: 'no-vo2max' }, P36);
  assert.ok(s.includes(T.noVo2));
  // no SCORES / PROFILE at all (an old bake): the section renders as before, no block, no throw
  const out = {};
  renderAt(fitH(), '2026-07-01', { out, detail: true });
  assert.match(fitSec(out.health), /data-detail="vo2max"/);
  assert.doesNotMatch(fitSec(out.health), /class="dial fa|NaN|undefined/);
});

test('the empty-state copy inserted raw with innerHTML is trusted markup: plain text + <code> only (health.js, training-activity.js)', async () => {
  // these strings deliberately carry <code>…</code> (a path, a command), so the scripts insert them unescaped;
  // anything else (another tag, an attribute, a stray < or &) must not sneak into them
  const { es: esHealth } = await import('../i18n/health-templates.mjs');
  const { en: enAct, es: esAct } = await import('../i18n/activity-templates.mjs');
  const raw = [enHealth.emptyMsg, enHealth.trainEmptyMsg, esHealth.emptyMsg, esHealth.trainEmptyMsg, enAct.empty, esAct.empty];
  for (const s of raw) {
    assert.equal(typeof s, 'string');
    assert.doesNotMatch(s.replace(/<code>[^<>&"]*<\/code>/g, ''), /[<>&"]/, s);
  }
});
