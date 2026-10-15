/* Tests for Entreno's Intensity (HR) block (web/src/client/training-dash.js): runs the classic
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

test('intensity only: one metric row per modality with HR (mean HR, the peak as the small line), highest first; volume, split and summary cards are gone (Activity card)', () => {
  assert.equal(DASH.hasData, true);
  const html = render(DASH);
  assert.match(html, /^<section class="hs-sec" aria-labelledby="int-h"><div class="hs-head"><h3 class="hs-lbl" id="int-h">Intensity \(HR\)<\/h3><button type="button" class="hs-i" data-hs-info="int-info"/);
  const rows = [...html.matchAll(/<li class="db-row"[^>]*>[\s\S]*?<span class="db-name">([^<]+)<\/span><span class="db-vals"><span class="db-val"><b>(\d+)<\/b><small>bpm<\/small><\/span><span class="db-base">([^<]*)<\/span>/g)].map((m) => [m[1], +m[2], m[3]]);
  const withHr = DASH.modality.filter((m) => m.avgHr).sort((a, b) => b.avgHr - a.avgHr);
  assert.deepEqual(rows, withHr.map((m) => [enD.modalityLabels[m.key], m.avgHr, `peak ${m.peakHr}`]));
  assert.doesNotMatch(html, /dash-cards|wbar|class="mrow"|Weekly volume|Modality split/, 'the merged parts are not drawn twice');
  assert.doesNotMatch(html, /NaN|undefined|null|Infinity/);
  // each modality its own icon (not the same heart on every row): the same paths as HC.metricIcon
  const icons = [...html.matchAll(/<li class="db-row"[^>]*>(<svg class="db-ico"[\s\S]*?<\/svg>)/g)].map((m) => m[1]);
  const want = { strength: 'gym', hiit: 're', run: 'run', bike: 'bike' };
  const ctx = loadUtil(vm.createContext({ LOCALE: 'en' }));
  assert.deepEqual(icons, withHr.map((m) => ctx.HC.metricIcon(want[m.key] || 'exercise')));
  assert.ok(new Set(icons).size > 1 && !icons.includes(ctx.HC.metricIcon('rhr')), 'no heart on the modality rows');
});

test('the window, HR coverage, data date and strength caveat sit behind ⓘ (hidden), not lost', () => {
  const html = render(DASH);
  const info = html.match(/<div class="hs-info" id="int-info" hidden>([\s\S]*?)<\/div><ul/)[1];
  assert.ok(info.includes(enD.intensityHint.replace('{withHr}', String(DASH.intensity.withHr)).replace('{total}', String(DASH.intensity.total)).replace('{weeks}', '12')));
  assert.ok(info.includes(enD.asOfLine.replace('{date}', '28 Sep')), 'as-of date through the shared formatter, no weekday');
  assert.ok(info.includes(enD.note2Html));
});

test('no HR on any session, or no data: nothing is drawn (the Activity card holds the empty state)', () => {
  assert.equal(render(aggregateDashboard(ROWS.map((r) => ({ ...r, hrAvg: null, hrMax: null })))), '');
  assert.equal(render({ hasData: false }), '');
  assert.equal(render(aggregateDashboard([])), '');
});

test('es locale: Spanish labels and Spanish as-of date', () => {
  const html = render(DASH, { locale: 'es' });
  assert.ok(html.includes(esD.asOfLine.replace('{date}', '28 sept')));
  assert.ok(html.includes('Intensidad (FC)'));
  assert.ok(html.includes('<small>ppm</small>'));
});

test('no host element: renders nothing and does not throw', () => {
  assert.equal(render(DASH, { host: false }), null);
});
