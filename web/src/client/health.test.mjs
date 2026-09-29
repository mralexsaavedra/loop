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

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'health.js'), 'utf8');

test('each rendered Salud section heading has a stable hl-<section> anchor id', () => {
  const doc = new StubDocument();
  const host = doc.el('health');
  const HEALTH = {
    body: { hasData: false }, activity: { hasData: false }, energy: { hasData: false },
    running: { hasData: true, count: 0, sessions: [] },
    recovery: { hasData: true },
    loadRecovery: { hasData: false },
  };
  const ctx = { document: doc, window: {}, HEALTH, I18N_HEALTH: enHealth, LOCALE: 'en', Math, String, Number, Date, JSON };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  assert.match(host.innerHTML, /<div class="hsub" id="hl-recovery">/);
  assert.match(host.innerHTML, /<div class="hsub" id="hl-running">/);
  assert.doesNotMatch(host.innerHTML, /id="hl-body"/, 'sections without data render no anchor');
});

function renderWith(HEALTH) {
  const doc = new StubDocument();
  const host = doc.el('health');
  const ctx = { document: doc, window: {}, HEALTH, I18N_HEALTH: enHealth, LOCALE: 'en', Math, String, Number, Date, JSON };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return host.innerHTML;
}
const none = { hasData: false };

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

test('run and bike sections render symmetric empty states when the other has data', () => {
  const html = renderWith({
    body: none, activity: none, energy: none, recovery: none, loadRecovery: none,
    running: none,
    cycling: { hasData: true, count: 1, sessions: [{ date: '2026-06-10', dist: 40, time: '1:30', elev: 400, hrAvg: 140, re: 90, kj: 1300 }] },
  });
  assert.match(html, /id="hl-running"/);
  assert.match(html, /No runs with watch metrics yet/);
  const html2 = renderWith({
    body: none, activity: none, energy: none, recovery: none, loadRecovery: none, cycling: none,
    running: { hasData: true, count: 1, sessions: [{ date: '2026-06-02', dist: 8, pace: '5:30', speed: 10.9, power: null, gct: null, vosc: null, stride: null }] },
  });
  assert.match(html2, /id="hl-cycling"/);
  assert.match(html2, /No rides yet/);
});
