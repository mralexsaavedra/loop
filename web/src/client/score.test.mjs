/* Tests for the Home tab client renderer (web/src/client/score.js): runs the classic script in a
 * vm with baked SCORES/I18N_SCORE/LOCALE globals and a controllable clock. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScores } from '../../../lib/score/index.mjs';
import { renderAdvice } from '../../../lib/score/advice-copy.mjs';
import { es as esT, en as enT } from '../i18n/score-templates.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'score.js'), 'utf8');

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ASOF = '2026-09-29';
const wig = (i) => ((i * 7) % 5) - 2;

function fixtureScores({ days = 49, shift = 2 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-client-'));
  try {
    const ds = Array.from({ length: days }, (_, i) => addDays(ASOF, i - (days - 1)));
    const w = (name, header, rows) => fs.writeFileSync(path.join(dir, name), header + '\n' + rows.join('\n') + '\n');
    w('hrv.csv', 'date,value,source', ds.map((d, i) => `${d},${(60 + wig(i)) * (i >= days - 7 ? Math.exp(0.1 * shift) : 1)},W`));
    w('rhr.csv', 'date,value,source', ds.map((d, i) => `${d},${50 + wig(i) * 0.5 - (i >= days - 7 ? shift : 0)},W`));
    w('sleep-daily.csv', 'date,asleep_hours,source,bedtime,waketime', ds.map((d, i) => `${d},${7.5 + wig(i) * 0.2},W,${23 + wig(i) * 0.1},${7 + wig(i) * 0.1}`));
    const rows = ['date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules'];
    ds.forEach((d, i) => {
      if (i % 2 === 0) rows.push(`${d},Running,40,,140,,165,Strava API,5,${50 + (i % 7)},`);
      if (i % 5 === 0) rows.push(`${d},Cycling,60,,140,,165,Strava API,20,20,`);
      if (i % 4 === 0) rows.push(`${d},Tennis,60,,,,,Strava API,,15,`);
      if (i === 3) rows.push(`${d},Running,6,,,,,Strava API,,1,`); // junk
    });
    fs.writeFileSync(path.join(dir, 'workouts.csv'), rows.join('\n') + '\n');
    return buildScores(dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function render(scores, { locale = 'en', now = ASOF, T } = {}) {
  const host = { innerHTML: '' };
  const RealDate = Date;
  class FakeDate extends RealDate {
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  const ctx = {
    document: { getElementById: (id) => (id === 'home' ? host : null) },
    SCORES: scores, I18N_SCORE: T || (locale === 'es' ? esT : enT), LOCALE: locale, Date: FakeDate, Math, String, Number, Array, Object, JSON, isFinite,
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return host.innerHTML;
}
const count = (html, needle) => html.split(needle).length - 1;

test('empty state: no data renders .train-empty and nothing else', () => {
  const html = render({ hasData: false, asOf: null, reEpoch: null, recovery: null, load: null, advice: null });
  assert.match(html, /train-empty/);
  assert.doesNotMatch(html, /sc-card/);
});

test('a missing host element or missing SCORES does not throw', () => {
  assert.doesNotThrow(() => render(undefined));
});

test('full render: recovery trend with band, per-component rows and 14 raw dailies each', () => {
  const s = fixtureScores();
  const html = render(s);
  assert.match(html, /sc-recovery/);
  assert.match(html, /MAD/);
  assert.match(html, /daytime SDNN/i);
  assert.equal(count(html, 'class="sc-comp"'), 4);
  assert.equal(count(html, 'class="sc-raw-v"'), 4 * 14);
  assert.match(html, new RegExp(`sc-band-${s.recovery.band}`));
  assert.equal(count(html, 'class="spark"'), 1 + s.load.modalities.length, 'inline SVG sparklines (recovery + one per modality)');
  assert.doesNotMatch(html, /<script|src=|href=/i, 'no scripts or external refs in the rendered markup');
});

test('colour only on the direction arrow: no grade-fill classes on the recovery card', () => {
  const html = render(fixtureScores());
  assert.match(html, /sc-arrow sc-arrow-(above|at|below)/);
  assert.doesNotMatch(html, /sc-(red|amber|green|grade)/);
});

test('load: one card per modality (gym/run/bike), gated ones show the reason and no direction', () => {
  const s = fixtureScores();
  const html = render(s);
  assert.equal(count(html, 'class="sc-load-card"'), 3);
  for (const m of s.load.modalities) assert.match(html, new RegExp(`data-mod="${m.key}"`));
  const gated = s.load.modalities.filter((m) => !m.trend.ok);
  assert.equal(count(html, 'sc-gated'), gated.length);
  if (gated.length) assert.match(html, new RegExp(enT.load.gated.baselineBuilding.slice(0, 20)));
  const run = s.load.modalities.find((m) => m.key === 'run');
  assert.equal(run.trend.ok, true);
  assert.match(html, /vs your own run days/);
});

test('coverage counters and the other line are shown; the other line says it is not scored', () => {
  const s = fixtureScores();
  const html = render(s);
  for (const k of ['scored', 'unscored', 'invalid', 'droppedJunk', 'preEpoch']) {
    assert.match(html, new RegExp(`sc-cov-${k}">${s.load.coverage[k]}<`), k);
  }
  assert.ok(s.load.coverage.droppedJunk >= 1);
  assert.match(html, /sc-other/);
  assert.match(html, /not scored/i);
});

test('the four accurate caveats + SDNN + not-medical render; the retired strength claim does not', () => {
  const html = render(fixtureScores());
  assert.equal(count(html, 'class="sc-caveat"'), 7);
  assert.match(html, /HR-derived/);
  assert.match(html, /not comparable/i);
  assert.match(html, /auto-label/i);
  assert.match(html, /no comparable load before/i);
  assert.match(html, /not medical advice/i);
  assert.doesNotMatch(html, /under-?weights? strength/i);
});

test('advice is rendered with the shared copy when fresh (identical to renderAdvice)', () => {
  const s = fixtureScores();
  assert.ok(s.advice, 'fixture should produce advice');
  const html = render(s, { now: addDays(ASOF, 1) });
  assert.match(html, /sc-advice/);
  assert.ok(html.includes(renderAdvice(s.advice, 'en')), 'client sentence === lib sentence');
  const es = render(s, { locale: 'es', now: addDays(ASOF, 1) });
  assert.ok(es.includes(renderAdvice(s.advice, 'es')));
});

test('stale: > 3 days old is greyed, shows "as of <date>" and the note, and suppresses advice', () => {
  const s = fixtureScores();
  const html = render(s, { now: addDays(ASOF, 5) });
  assert.match(html, /sc-stale/);
  assert.ok(html.includes(`as of ${ASOF}`));
  assert.match(html, /sc-stale-note/);
  assert.doesNotMatch(html, /sc-advice/);
});

test('stale boundary: exactly 3 days is fresh, 4 days is stale', () => {
  const s = fixtureScores();
  assert.doesNotMatch(render(s, { now: addDays(ASOF, 3) }), /sc-stale/);
  assert.match(render(s, { now: addDays(ASOF, 4) }), /sc-stale/);
});

test('insufficient recovery: shows the insufficient state, no numbers, no advice', () => {
  const s = fixtureScores({ days: 10 });
  assert.equal(s.recovery.gated, true);
  const html = render(s);
  assert.match(html, /sc-insufficient/);
  assert.equal(count(html, 'class="sc-comp"'), 0);
  assert.doesNotMatch(html, /sc-advice/);
});

test('null asOf never produces NaN/undefined text', () => {
  const s = fixtureScores();
  s.recovery.asOf = null; s.load.asOf = null; s.asOf = null;
  const html = render(s);
  assert.doesNotMatch(html, /NaN|undefined|null/);
});

test('es locale uses decimal commas for MAD values', () => {
  const s = fixtureScores();
  const html = render(s, { locale: 'es' });
  const v = Math.abs(s.recovery.trend7).toFixed(1).replace('.', ',');
  assert.ok(html.includes(v), `expected ${v} in es render`);
});

test('baked date strings are validated before rendering: a non-ISO asOf/reEpoch never reaches the markup', () => {
  const s = fixtureScores();
  s.recovery.asOf = '<img src=x onerror=alert(1)>';
  s.load.asOf = '2026-09-29"><i id=xss>';
  s.load.reEpoch = 'javascript:1';
  const html = render(s);
  assert.doesNotMatch(html, /<img|id=xss|javascript:|onerror/);
});

test('Home order: recovery card, then load cards, then the advice sentence, then caveats', () => {
  const s = fixtureScores();
  const html = render(s, { now: addDays(ASOF, 1) });
  const at = (needle) => html.indexOf(needle);
  assert.ok(at('sc-recovery') !== -1 && at('sc-load') !== -1 && at('sc-advice') !== -1);
  assert.ok(at('sc-recovery') < at('sc-load'), 'recovery before load');
  assert.ok(at('sc-load') < at('sc-advice'), 'advice after the load cards');
  assert.ok(at('sc-advice') < at('sc-caveat'), 'caveats last');
});
