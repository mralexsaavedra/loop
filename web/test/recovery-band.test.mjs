/* The recovery-style 0-100 bands (good >= 67, low <= 33, mid between) have ONE source,
 * lib/score/recovery.mjs (PCT_GOOD / PCT_LOW / pctBand), baked for the page as HC_BAND (clientSource).
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

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(here, '..', 'src', 'client');
const read = (f) => fs.readFileSync(path.join(clientDir, f), 'utf8');
const EDGES = [100, 67, 66.9, 34, 33.5, 33, 0];

test('no client script hardcodes a recovery band threshold (67 / 33 / 34 comparisons)', () => {
  const hits = [];
  for (const f of fs.readdirSync(clientDir).filter((n) => n.endsWith('.js'))) {
    read(f).split('\n').forEach((line, i) => {
      if (/[<>]=?\s*(67|33|34)\b/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], 'read the thresholds from HC_BAND (lib/score/recovery.mjs), never client literals');
});

/** One band function out of a client script, run in a vm with the page's HC_BAND / HC. */
function bandFn(file, name) {
  const m = new RegExp(`function ${name}\\(\\w+\\) \\{[\\s\\S]*?\\n  \\}`).exec(read(file));
  assert.ok(m, `${file}: function ${name}`);
  const ctx = vm.createContext({ LOCALE: 'en', Math, String, Number, Array, Object, JSON });
  loadUtil(ctx);
  vm.runInContext(m[0], ctx);
  return ctx[name];
}

test('deepdive.js: the recovery % colour and the energy gauge band like lib pctBand at the edges', () => {
  const pct = bandFn('deepdive.js', 'pctCls');
  const energy = bandFn('deepdive.js', 'energyBand');
  const map = { good: 'hi', mid: 'mid', low: 'lo' };
  for (const v of EDGES) {
    assert.equal(pct(v), pctBand(v), `pctCls(${v})`);
    assert.equal(energy(v), map[pctBand(v)], `energyBand(${v})`);
  }
});

test('energy.js: the Inicio energy bank card colours its level like lib pctBand (33.5 = mid, 33 = low)', () => {
  const source = read('energy.js');
  const map = { good: 'hi', mid: 'mid', low: 'lo' };
  for (const lv of EDGES) {
    const host = { innerHTML: '', hidden: true };
    const day = { date: '2026-09-29', wake: '07:00', start: 80, now: { h: 8, lv }, min: { h: 8, lv }, sum: {}, hours: [{ h: 7, lv, st: 0, ld: 0, wo: false }] };
    const RealDate = Date;
    class FakeDate extends RealDate { static now() { return new RealDate('2026-09-29T18:00:00').getTime(); } }
    const ctx = {
      document: { getElementById: (id) => (id === 'home-energy' ? host : null) },
      SCORES: { energy: { ok: true, asOf: '2026-09-29', days: [day] } }, I18N_SCORE: enScore, LOCALE: 'en',
      DETAIL: { metrics: {} }, Date: FakeDate, Math, String, Number, Array, Object, JSON,
    };
    vm.createContext(ctx);
    loadUtil(ctx);
    vm.runInContext(source, ctx);
    const cls = / en de-(\w+)/.exec(host.innerHTML);
    assert.ok(cls, `card rendered for ${lv}`);
    assert.equal(cls[1], map[pctBand(lv)], `energy card at ${lv}`);
  }
});

test('detail-state.js: the energy bank history colours its days like lib pctBand (bad = low)', () => {
  const src = read('detail-state.js');
  const m = /if \(m\.kind === 'bank'\) return ([^;]+);/.exec(src);
  assert.ok(m, 'the bank branch of dayState');
  const ctx = vm.createContext({ LOCALE: 'en', Math, String, Number, Array, Object, JSON });
  loadUtil(ctx);
  const f = vm.runInContext(`(function (v) { return ${m[1]}; })`, ctx);
  const map = { good: 'good', mid: 'mid', low: 'bad' };
  for (const v of EDGES) assert.equal(f(v), map[pctBand(v)], `bank day ${v}`);
  // no band (null / non-finite) stays 'bad', as before the shared thresholds, never undefined
  for (const v of [null, NaN, undefined]) assert.equal(f(v), 'bad', `bank day ${v}`);
});
