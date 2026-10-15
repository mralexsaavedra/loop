/* lib/nutrition/client.mjs — the ONE place lib/nutrition imports the classic-script emitter
 * (lib/format/numbers.mjs classicGlobal): data/nutrition/generate.mjs loads lib/nutrition on its own (its
 * fresh-clone test copies only this folder), so every other module ships a plain CLIENT descriptor. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as C from './client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('no lib/nutrition module but client.mjs imports lib/format (an import statement, not a comment)', () => {
  const bad = [];
  for (const f of fs.readdirSync(here)) {
    if (!f.endsWith('.mjs') || f.endsWith('.test.mjs') || f === 'client.mjs') continue;
    const src = fs.readFileSync(path.join(here, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    if (/(^|[\s;])(import|export)\b[^;]*?from\s*['"]\.\.\/format\//m.test(src) || /\bimport\s*\(\s*['"]\.\.\/format\//.test(src)) bad.push(f);
  }
  assert.deepEqual(bad, []);
  assert.match(fs.readFileSync(path.join(here, 'client.mjs'), 'utf8'), /from '\.\.\/format\/numbers\.mjs'/, 'client.mjs is the emitter');
});

test('mergeClient: a name two descriptors share must be the same value; the same value merges once', () => {
  const f = function f() { return 1; };
  const g = function f() { return 2; };
  const m = C.mergeClient({ consts: { A: 1 }, hidden: { H: 'x' }, fns: { f } }, { consts: { A: 1, B: 2 }, hidden: { H: 'x' }, fns: { f } });
  assert.deepEqual(Object.keys(m.consts), ['A', 'B']);
  assert.equal(m.fns.f, f);
  assert.throws(() => C.mergeClient({ fns: { f } }, { fns: { f: g } }), /two different fns\.f/);
  assert.throws(() => C.mergeClient({ consts: { A: 1 } }, { consts: { A: 2 } }), /two different consts\.A/);
  assert.throws(() => C.mergeClient({ hidden: { H: 'x' } }, { hidden: { H: 'y' } }), /two different hidden\.H/);
});

test('clientSource = every nutrition global in page order, each one runnable', () => {
  const ctx = vm.createContext({});
  vm.runInContext(C.clientSource(), ctx);
  const order = ['HC_ADH', 'HC_PROG', 'HC_NSCORE', 'HC_FOODLOG', 'HC_DAYTYPE', 'HC_FUEL', 'HC_SCALE', 'HC_GUIDE', 'HC_ENERGY'];
  for (const g of order) assert.equal(typeof ctx[g], 'object', g);
  const src = C.clientSource();
  assert.deepEqual(order.map((g) => src.indexOf('var ' + g + ' =')), order.map((g) => src.indexOf('var ' + g + ' =')).sort((a, b) => a - b));
});

test('HC_ENERGY (the in-page onboarding) computes exactly what lib/nutrition/energy.mjs computes', async () => {
  const E = await import('./energy.mjs');
  const ctx = vm.createContext({});
  vm.runInContext(C.energySource(), ctx);
  const H = ctx.HC_ENERGY;
  const plain = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(Object.keys(H).sort(), [...Object.keys(E.CLIENT.consts), ...Object.keys(E.CLIENT.fns)].sort());
  const people = [
    { sex: 'male', age: 30, heightCm: 175, weightKg: 70, activity: 'light' },
    { sex: 'female', age: 52, heightCm: 160, weightKg: 82, activity: 'sedentary', sports: [{ sport: 'cycling', minutes: 160, perWeek: 2 }] },
    { sex: 'female', age: 19, heightCm: 150, weightKg: 45, activity: 'active', sports: [{ sport: 'strength', minutes: 60, perWeek: 3 }] },
  ];
  for (const p of people) {
    assert.deepEqual(plain(H.computeTargets(p)), plain(E.computeTargets(p)), JSON.stringify(p));
    assert.deepEqual(plain(H.screenPerson(p)), plain(E.screenPerson(p)), JSON.stringify(p));
    assert.deepEqual(plain(H.validatePerson(p)), plain(E.validatePerson(p)), JSON.stringify(p));
  }
  for (const m of [10, 74, 75, 149, 150, 600]) assert.equal(H.dayTypeOfMinutes(m), E.dayTypeOfMinutes(m), String(m));
  assert.deepEqual(plain(H.SPORTS), plain(E.SPORTS));
});
