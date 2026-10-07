/* Tests for Entreno's workouts dashboard renderer (web/src/client/training-dash.js): runs the classic
 * script in a vm with DASH baked by the real aggregator (lib/training/dashboard.mjs), I18N_DASH and
 * LOCALE, the shared HC helpers (loadUtil) and the escaping DOM stub. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateDashboard } from '../../../lib/training/dashboard.mjs';
import { es as esD, en as enD } from '../i18n/dash-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';
import { StubDocument } from '../../test/dom-stub.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'training-dash.js'), 'utf8');

const w = (date, type, dur, hrAvg = null, hrMax = null, src = 'Apple Watch') => ({ date, type, dur, hrAvg, hrMax, re: null, source: src });
const ROWS = [
  w('2026-09-01', 'HighIntensityIntervalTraining', 60, 140, 175),
  w('2026-09-03', 'Running', 45, 150, 172),
  w('2026-09-08', 'TraditionalStrengthTraining', 50),
  w('2026-09-15', 'Cycling', 90, 130, 160),
  w('2026-09-22', 'HighIntensityIntervalTraining', 55, 145, 180),
  w('2026-09-28', 'Running', 30, 155, 178),
];
const DASH = aggregateDashboard(ROWS);

function render(dash, { locale = 'en', host = true } = {}) {
  const doc = new StubDocument();
  const el = host ? doc.el('train-dash') : null;
  const ctx = { document: doc, DASH: dash, I18N_DASH: locale === 'es' ? esD : enD, LOCALE: locale, Math, String, Number, Array, Object, JSON };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return el ? el.innerHTML : null;
}
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('typical data: as-of line, the three summary cards, 12 weekly bars, modality and intensity sections', () => {
  assert.equal(DASH.hasData, true);
  const html = render(DASH);
  assert.ok(html.includes(enD.asOfLine.replace('{date}', '28 Sep')), 'as-of date through the shared formatter, no weekday');
  const nums = [...html.matchAll(/<div class="dash-num">([^<]*)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(nums, [String(DASH.recent.daysPerWeek), DASH.recent.minPerWeek < 60 ? DASH.recent.minPerWeek + ' min' : (Math.round(DASH.recent.minPerWeek / 6) / 10) + ' h', String(DASH.recent.sessions)]);
  assert.equal((html.match(/class="wbar[ "]/g) || []).length, DASH.weeks);
  assert.ok(html.includes(enD.volHint.replace('{weeks}', '12')));
  for (const m of DASH.modality) assert.ok(html.includes(`<span class="mlbl">${enD.modalityLabels[m.key]}</span>`), m.key);
  assert.ok(html.includes(enD.intensityHeading), 'HR present -> intensity section');
  assert.ok(html.includes(enD.note1Html) && html.includes(enD.note2Html));
  assert.doesNotMatch(html, /NaN|undefined|null|Infinity/);
});

test('zero-activity weeks render as .zero bars with a 0% height, never NaN', () => {
  const html = render(DASH);
  const bars = [...html.matchAll(/<div class="wbar( zero)?" title="([^"]*)"><i style="height:(\d+)%"><\/i><\/div>/g)];
  assert.equal(bars.length, 12);
  const zero = bars.filter((b) => b[1]);
  assert.ok(zero.length > 0, 'the 12-week window starts before the first session');
  for (const b of zero) { assert.equal(b[3], '0'); assert.match(b[2], /: 0 min · 0d$/); }
  assert.ok(bars.some((b) => b[3] === '100'), 'the busiest week fills the bar');
});

test('no HR on any session: the intensity section and its note are omitted', () => {
  const dash = aggregateDashboard(ROWS.map((r) => ({ ...r, hrAvg: null, hrMax: null })));
  const html = render(dash);
  assert.ok(!html.includes(enD.intensityHeading));
  assert.ok(!html.includes(enD.note2Html));
  assert.ok(html.includes(enD.note1Html));
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('empty state: no data (no workouts.csv) shows the empty message only', () => {
  const html = render({ hasData: false });
  assert.equal(html, `<div class="train-empty">${enD.emptyMsg}</div>`);
  assert.equal(render(aggregateDashboard([])), `<div class="train-empty">${enD.emptyMsg}</div>`, 'aggregator on zero rows');
});

test('es locale: Spanish labels, comma decimals in hours and Spanish as-of date', () => {
  const html = render(DASH, { locale: 'es' });
  assert.ok(html.includes(esD.asOfLine.replace('{date}', '28 sept')));
  assert.ok(html.includes(esD.daysPerWeekLbl));
  const hours = [...text(html).matchAll(/\d+[.,]\d+ h/g)].map((m) => m[0]);
  assert.ok(hours.length > 0);
  for (const h of hours) assert.ok(!h.includes('.'), `decimal comma in ${h}`);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('no host element: renders nothing and does not throw', () => {
  assert.equal(render(DASH, { host: false }), null);
});
