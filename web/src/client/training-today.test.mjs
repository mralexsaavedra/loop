/* Tests for Inicio's programmed-session renderer (web/src/client/training-today.js): runs the classic
 * script in a vm with TRAINING / TRAINING_META baked like Bake.astro (training.days +
 * lib/training/program.mjs trainingMeta), I18N_HOY, the shared HC helpers and a fixed clock. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trainingMeta, validateProgram } from '../../../lib/training/program.mjs';
import { es as esH, en as enH } from '../i18n/hoy-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';
import { StubDocument } from '../../test/dom-stub.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'training-today.js'), 'utf8');
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(here, '..', '..', '..', 'data', 'training', 'training-data.example.json'), 'utf8'));

function render(training, now, { locale = 'en', host = true } = {}) {
  const doc = new StubDocument();
  const el = host ? doc.el('train-today') : null;
  const RealDate = Date;
  const stamp = now + 'T12:00:00';
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [stamp])); }
    static now() { return new RealDate(stamp).getTime(); }
  }
  const ctx = {
    document: doc, TRAINING: training.days, TRAINING_META: trainingMeta(training), I18N_HOY: locale === 'es' ? esH : enH, LOCALE: locale,
    Date: FakeDate, Math, String, Number, Array, Object, JSON, RegExp,
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return el ? el.innerHTML : null;
}

test('the example program is valid input', () => {
  assert.deepEqual(validateProgram(EXAMPLE), { ok: true });
});

test('a programmed day (picked from the viewer clock): date, focus, every block with label / title / lines, meta', () => {
  const html = render(EXAMPLE, '2026-01-05');
  assert.ok(html.includes('<div class="train-day">Mon 5 Jan</div>'));
  assert.ok(html.includes('🏋️ Squat + metcon'), 'gym icon + focus');
  assert.equal((html.match(/class="train-block"/g) || []).length, 3);
  assert.ok(html.includes("<span class=\"blabel\">A</span><h3>BACK SQUAT EVERY 3' × 5</h3>"));
  assert.ok(html.includes('<li class="goal">Target: sub 2:30 per round</li>'), 'goal line flagged by the locale regex');
  assert.ok(html.includes('<li>10 thrusters</li>'));
  assert.ok(html.includes(`<p class="train-meta">My Hybrid Program · Coach name<br>${enH.sourceLabel} your-program.pdf</p>`));
  assert.doesNotMatch(html, /NaN|undefined|null/);
});

test('a run day: run icon, a block without label renders no label span', () => {
  const html = render(EXAMPLE, '2026-01-08');
  assert.ok(html.includes('🏃 Track'));
  assert.ok(!html.includes('blabel'));
  assert.ok(html.includes('<h3>Warm-up</h3>'));
});

test('a bike day uses the bike icon', () => {
  const t = { days: { '2026-03-02': { kind: 'bike', durationMin: 120, focus: 'Z2 ride', blocks: [{ title: 'Ride', lines: ['2 h Z2'] }] } } };
  assert.ok(render(t, '2026-03-02').includes('🚴 Z2 ride'));
});

test('an unprogrammed day inside the program range is a rest day', () => {
  const html = render(EXAMPLE, '2026-01-06');
  assert.ok(html.includes('<div class="train-day">Tue 6 Jan</div>'));
  assert.ok(html.includes(`<div class="train-empty">${enH.restDayMsg}</div>`));
  assert.ok(!html.includes('train-block'));
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('after the last programmed day: names the last day; before the first: the sample-data message', () => {
  const after = render(EXAMPLE, '2026-02-01');
  assert.ok(after.includes(enH.afterLastMsg.replace('{last}', 'Sat 10 Jan')));
  const before = render(EXAMPLE, '2025-12-31');
  assert.ok(before.includes(enH.beforeFirstMsg));
});

test('no program at all (absent training-data.json -> {days:{}}): rest-day empty state, no meta line', () => {
  const html = render({ days: {} }, '2026-10-07');
  assert.equal(html, `<div class="train-head"><div class="train-day">Wed 7 Oct</div></div><div class="train-empty">${enH.restDayMsg}</div>`);
});

test('untrusted training text is escaped', () => {
  const t = { program: 'P<b>', days: { '2026-03-02': { kind: 'gym', focus: '<img src=x>', blocks: [{ label: '<i>', title: 'A & B', lines: ['<script>x</script>'] }] } } };
  const html = render(t, '2026-03-02');
  assert.doesNotMatch(html, /<img|<script|<i>|P<b>/);
  assert.ok(html.includes('&lt;img src=x&gt;') && html.includes('A &amp; B'));
});

test('es locale: Spanish date and goal regex ("Objetivo")', () => {
  const t = { days: { '2026-09-29': { kind: 'gym', focus: 'Fuerza', blocks: [{ title: 'A', lines: ['Objetivo: RPE 8', 'Sentadilla'] }] } } };
  const html = render(t, '2026-09-29', { locale: 'es' });
  assert.ok(html.includes('<div class="train-day">mar 29 sept</div>'));
  assert.ok(html.includes('<li class="goal">Objetivo: RPE 8</li>'));
  assert.ok(html.includes('<li>Sentadilla</li>'));
});

test('no host element: renders nothing and does not throw', () => {
  assert.equal(render(EXAMPLE, '2026-01-05', { host: false }), null);
});
