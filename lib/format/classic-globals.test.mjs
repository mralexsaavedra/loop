/* Every classic-script global classicGlobal emits for the page (HC_FMT, HC_BAND and the nutrition ones) is a
 * closed scope: each identifier its functions use is declared in the global itself or is a standard
 * ECMAScript built-in (Math, Number, isFinite…), never a lib helper someone forgot to ship (which would only
 * throw a ReferenceError in the browser, on the path that reaches it). Checked with ESLint's scope analysis
 * (no-undef), the same rule `npm run lint` applies to the source. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Linter } from 'eslint';
import globals from 'globals';
import { classicGlobal, clientSource as fmtSource } from './numbers.mjs';
import { clientSource as bandSource } from '../score/recovery.mjs';
import { clientSource as nutriSource } from '../nutrition/client.mjs';

const linter = new Linter();
const CONFIG = {
  languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.builtin } },
  rules: { 'no-undef': 'error' },
};
const undeclared = (src) => linter.verify(src, CONFIG).map((m) => m.message);

test('no emitted global uses an identifier it does not declare (nor a non-ECMAScript global)', () => {
  const sources = { HC_FMT: fmtSource(), HC_BAND: bandSource(), nutrition: nutriSource() };
  for (const [name, src] of Object.entries(sources)) assert.deepEqual(undeclared(src), [], name);
});

test('the check catches a helper the descriptor forgot to ship, and a browser / Node global', () => {
  const f = vm.runInNewContext('(function f(v) { return helper(v) + LIMIT; })');
  assert.deepEqual(undeclared(classicGlobal('HC_T', { hidden: { LIMIT: 1 }, fns: { f } })), ["'helper' is not defined."]);
  const g = vm.runInNewContext('(function g() { return window.x || process.env.X; })');
  assert.deepEqual(undeclared(classicGlobal('HC_T', { fns: { g } })), ["'window' is not defined.", "'process' is not defined."]);
});
