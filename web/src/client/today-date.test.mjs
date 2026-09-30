/* web/src/client/today-date.js — the top bar's date line: the viewer's local today written with the
 * one date formatter (HC.fmtDate), decided at view time (nothing baked), in es and en. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { es as esDate, en as enDate } from '../i18n/date-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'today-date.js'), 'utf8');

function run({ locale, at, withHost = true }) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(at); }
    static now() { return new RealDate(at).getTime(); }
  }
  const doc = new StubDocument();
  const el = withHost ? doc.el('today-date', { tag: 'time' }) : null;
  const ctx = { document: doc, window: {}, LOCALE: locale, I18N_DATE: locale === 'es' ? esDate : enDate, Date: FakeDate, Math, String, Number };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return el;
}

test('writes the viewer\'s local today: "mié 30 sept" (es) / "Wed 30 Sep" (en), with a machine-readable datetime', () => {
  const es = run({ locale: 'es', at: '2026-09-30T08:00:00' });
  assert.equal(es.textContent, 'mié 30 sept');
  assert.equal(es.getAttribute('datetime'), '2026-09-30');
  const en = run({ locale: 'en', at: '2026-09-30T23:59:00' });
  assert.equal(en.textContent, 'Wed 30 Sep');
});

test('no date host on the page: does nothing, never throws', () => {
  assert.doesNotThrow(() => run({ locale: 'en', at: '2026-09-30T08:00:00', withHost: false }));
});
