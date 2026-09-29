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
