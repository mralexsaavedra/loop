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
