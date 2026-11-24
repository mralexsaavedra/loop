/* The recovery-style 0-100 bands (good >= 67, low <= 33, mid between) have ONE source,
 * lib/score/recovery.mjs (PCT_GOOD / PCT_LOW / pctBand), published for the page as HC_BAND (web/src/client/lib-globals.ts).
 * Guard: no client script re-types the thresholds; behaviour: every client site bands the edges
 * (33 / 33.5 / 66.9 / 67) exactly like the lib. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pctBand } from '../../lib/score/recovery.mjs';
import { en as enScore } from '../src/i18n/score-templates.mjs';
import { loadUtil } from './client-util.mjs';
import { clientScriptSource } from '../src/client-bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(here, '..', 'src', 'client');
const read = (/** @type {string} */ f) => fs.readFileSync(path.join(clientDir, f), 'utf8');
const EDGES = [100, 67, 66.9, 34, 33.5, 33, 0];

test('no client script hardcodes a recovery band threshold (67 / 33 / 34 comparisons)', () => {
  /** @type {string[]} */
  const hits = [];
  // classic *.js and module *.ts scripts (the source as written: the check reads the code's own literals)
  for (const f of fs.readdirSync(clientDir).filter((n) => (n.endsWith('.ts') && !n.endsWith('.d.ts')) && !n.includes('.test.'))) {
    read(f).split('\n').forEach((line, i) => {
      if (/[<>]=?\s*(67|33|34)\b/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], 'read the thresholds from HC_BAND (lib/score/recovery.mjs), never client literals');
});

/** One band function out of a client script, run in a vm with the page's HC_BAND / HC.
 * @param {string} file @param {string} name */
function bandFn(file, name) {
  // a module script (*.ts) is read as its bundle (types stripped, re-indented by esbuild): the function runs from
  // its declaration to the closing brace at the declaration's own indentation
  const src = clientScriptSource(file);
  const m = new RegExp(`\\n([ \\t]*)function ${name}\\(\\w+\\) \\{[\\s\\S]*?\\n\\1\\}`).exec(src);
  assert.ok(m, `${file}: function ${name}`);
  const ctx = vm.createContext({ LOCALE: 'en', Math, String, Number, Array, Object, JSON });
  loadUtil(ctx);
  vm.runInContext(m[0], ctx);
  return ctx[name];
}

test('deepdive.ts: the recovery % colour and the energy gauge band like lib pctBand at the edges', () => {
  const pct = bandFn('deepdive.ts', 'pctCls');
  const energy = bandFn('deepdive.ts', 'energyBand');
  const map = { good: 'hi', mid: 'mid', low: 'lo' };
  for (const v of EDGES) {
    assert.equal(pct(v), pctBand(v), `pctCls(${v})`);
    assert.equal(energy(v), map[/** @type {keyof typeof map} */ (pctBand(v))], `energyBand(${v})`);
  }
});

test('energy.ts: the Inicio energy bank card colours its level like lib pctBand (33.5 = mid, 33 = low)', () => {
  const source = clientScriptSource('energy.ts'); // a module script: the bytes the page inlines
  const map = { good: 'hi', mid: 'mid', low: 'lo' };
  for (const lv of EDGES) {
    const host = { innerHTML: '', hidden: true };
    const day = { date: '2026-09-29', wake: '07:00', start: 80, now: { h: 8, lv }, min: { h: 8, lv }, sum: {}, hours: [{ h: 7, lv, st: 0, ld: 0, wo: false }] };
    const RealDate = Date;
    class FakeDate extends RealDate { static now() { return new RealDate('2026-09-29T18:00:00').getTime(); } }
    const ctx = {
      document: { getElementById: (/** @type {string} */ id) => (id === 'home-energy' ? host : null) },
      SCORES: { energy: { ok: true, asOf: '2026-09-29', days: [day] } }, I18N_SCORE: enScore, LOCALE: 'en',
      DETAIL: { metrics: {} }, Date: FakeDate, Math, String, Number, Array, Object, JSON,
    };
    vm.createContext(ctx);
    loadUtil(ctx);
    vm.runInContext(source, ctx);
    const cls = / en de-(\w+)/.exec(host.innerHTML);
    assert.ok(cls, `card rendered for ${lv}`);
    assert.equal(cls[1], map[/** @type {keyof typeof map} */ (pctBand(lv))], `energy card at ${lv}`);
  }
});

test('detail-state.ts: the energy bank history colours its days like lib pctBand (bad = low)', () => {
  const src = clientScriptSource('detail-state.ts'); // a module script: the bundle the page inlines
  const m = /if \(m\.kind === ["']bank["']\) return ([^;]+);/.exec(src);
  assert.ok(m, 'the bank branch of dayState');
  const ctx = vm.createContext({ LOCALE: 'en', Math, String, Number, Array, Object, JSON });
  loadUtil(ctx);
  const f = vm.runInContext(`(function (v) { return ${m[1]}; })`, ctx);
  const map = { good: 'good', mid: 'mid', low: 'bad' };
  for (const v of EDGES) assert.equal(f(v), map[/** @type {keyof typeof map} */ (pctBand(v))], `bank day ${v}`);
  // no band (null / non-finite) stays 'bad', as before the shared thresholds, never undefined
  for (const v of [null, NaN, undefined]) assert.equal(f(v), 'bad', `bank day ${v}`);
});
