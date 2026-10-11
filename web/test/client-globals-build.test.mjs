/* The classic-script globals emitted by the libs' clientSource() (HC_FMT, HC_BAND, HC_ADH, HC_PROG) as
 * they ship in the BUILT page, not as the unbundled modules emit them: Vite / Rollup bundles the libs
 * together and renames clashing top-level names (fin -> fin$3, ISO_RE -> ISO_RE$2), so a global whose
 * keys or constants came from those names breaks only on the real page. Extracts the inline script
 * from each built fixture (`npm run pretest`), runs it in a vm and checks the public keys and results
 * against the lib modules on the shared cases. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as F from '../../lib/format/numbers.mjs';
import { pctBand, PCT_GOOD, PCT_LOW } from '../../lib/score/recovery.mjs';
import { ADHERENCE, ADHERENCE_CASES, isComplete, dayState } from '../../lib/nutrition/adherence.mjs';
import { PROGRESS, PROGRESS_CASES, rollPoints, weeklyRate, etaMonths } from '../../lib/nutrition/progress.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const PAGES = [
  path.join(WEB_ROOT, 'dist', 'example', 'index.html'),
  path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html'),
  path.join(WEB_ROOT, 'dist', 'personal', 'index.html'),
].filter((p) => fs.existsSync(p));
const js = (v) => JSON.parse(JSON.stringify(v));

const KEYS = {
  HC_FMT: ['DASH', 'toNum', 'groupDigits', 'localise', 'fmtNumber', 'fmtInt', 'fmtRaw', 'fmtPercent', 'fmtMinutes', 'fmtHours', 'fmtPlain'],
  HC_BAND: ['PCT_GOOD', 'PCT_LOW', 'pctBand'],
  HC_ADH: ['ADHERENCE', 'fin', 'isComplete', 'dayState', 'adherence'],
  HC_PROG: ['PROGRESS', 'fin', 'round', 'dayNum', 'isoOf', 'rollPoints', 'weeklyRate', 'weightProgress', 'etaMonths'],
};

function globalsOf(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => /\bvar HC_FMT\s*=/.test(s));
  assert.ok(script, `${htmlPath}: the HC_FMT script`);
  const ctx = vm.createContext({});
  vm.runInContext(script, ctx);
  return ctx;
}

test('at least the example build is present (npm run pretest)', () => {
  assert.ok(PAGES.length > 0, 'no built page: run npm run pretest');
});

for (const page of PAGES) {
  const rel = path.relative(WEB_ROOT, page);

  test(`${rel}: HC_FMT / HC_BAND / HC_ADH / HC_PROG expose exactly their public keys, every function defined`, () => {
    const g = globalsOf(page);
    for (const [name, keys] of Object.entries(KEYS)) {
      assert.ok(g[name], `${name} defined`);
      assert.deepEqual(Object.keys(g[name]), keys, name);
      for (const k of keys) assert.notEqual(g[name][k], undefined, `${name}.${k}`);
    }
  });

  test(`${rel}: the shipped globals compute what the lib modules compute`, () => {
    const { HC_FMT, HC_BAND, HC_ADH, HC_PROG } = globalsOf(page);
    for (const [x, dec, loc, signed] of [[1234.5, 1, 'es', false], [-0.04, 1, 'en', true], [12345678, 0, 'es', false], [null, 0, 'en', false]]) {
      assert.equal(HC_FMT.fmtNumber(x, dec, loc, signed), F.fmtNumber(x, dec, loc, signed));
    }
    assert.equal(HC_FMT.fmtMinutes(421), F.fmtMinutes(421));
    assert.equal(HC_FMT.fmtPercent(97.4, 'es'), F.fmtPercent(97.4, 'es'));
    assert.equal(HC_FMT.fmtPlain(7.5, 1, 'es'), F.fmtPlain(7.5, 1, 'es'));
    assert.equal(HC_BAND.PCT_GOOD, PCT_GOOD);
    assert.equal(HC_BAND.PCT_LOW, PCT_LOW);
    for (const v of [100, 67, 66.9, 34, 33.5, 33, 0, null, NaN]) assert.equal(HC_BAND.pctBand(v), pctBand(v), String(v));

    assert.deepEqual(js(HC_ADH.ADHERENCE), js(ADHERENCE));
    for (const c of ADHERENCE_CASES) assert.deepEqual(js(HC_ADH.adherence(c.dates, c.days, c.targets)), c.expect, c.name);
    const d = { date: '2030-01-01', k: 2000, p: 100, n: 3, groups: { breakfast: 1, lunch: 1, dinner: 1 } };
    assert.equal(HC_ADH.isComplete(d), isComplete(d));
    assert.equal(HC_ADH.dayState(d, { k: 2500, p: 150 }), dayState(d, { k: 2500, p: 150 }));
    assert.equal(HC_ADH.fin(3), true);
    assert.equal(HC_ADH.fin('3'), false);

    assert.deepEqual(js(HC_PROG.PROGRESS), js(PROGRESS));
    for (const c of PROGRESS_CASES) {
      assert.deepEqual(js(HC_PROG.weightProgress(c.metric, c.opts)), c.expect, c.name);
      assert.deepEqual(js(HC_PROG.rollPoints(c.metric)), rollPoints(c.metric), 'rollPoints ' + c.name);
      assert.deepEqual(js(HC_PROG.weeklyRate(rollPoints(c.metric))), weeklyRate(rollPoints(c.metric)), 'weeklyRate ' + c.name);
    }
    assert.deepEqual(js(HC_PROG.etaMonths('2030-02-10', [6, 12])), etaMonths('2030-02-10', [6, 12]));
    assert.equal(HC_PROG.round(1.25, 1), 1.3);
  });
}
