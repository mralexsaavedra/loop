/* es/en key-tree parity — see design's Testing Strategy: "i18n | es/en
 * identical key trees, no empty strings". `strings` is walked recursively
 * (leaves are either strings or template functions, e.g. lessAriaLabel);
 * `verdict` leaves are all template functions (dynamic per-computation
 * messages) — checked separately since they can't be "empty string"
 * checked directly. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { es, en } from '../src/i18n/index.mjs';
import { es as esTpl, en as enTpl } from '../src/i18n/verdict-templates.mjs';
import { es as esLog, en as enLog } from '../src/i18n/log-templates.mjs';

function keyTree(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !(v instanceof RegExp) && typeof v !== 'function') {
      keys.push(...keyTree(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

function leaves(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !(v instanceof RegExp) && typeof v !== 'function') {
      out.push(...leaves(v, path));
    } else {
      out.push([path, v]);
    }
  }
  return out;
}

test('es and en `strings` dictionaries have identical key trees', () => {
  assert.deepEqual(keyTree(es.strings), keyTree(en.strings));
});

test('es and en `verdict` dictionaries have identical key trees (all functions)', () => {
  assert.deepEqual(keyTree(es.verdict), keyTree(en.verdict));
  for (const [key, fn] of Object.entries(es.verdict)) assert.equal(typeof fn, 'function', `es.verdict.${key} must be a function`);
  for (const [key, fn] of Object.entries(en.verdict)) assert.equal(typeof fn, 'function', `en.verdict.${key} must be a function`);
});

test('no empty string leaves in either strings dictionary', () => {
  for (const [locale, dict] of [['es', es], ['en', en]]) {
    for (const [path, value] of leaves(dict.strings)) {
      if (typeof value === 'string') assert.notEqual(value.trim(), '', `${locale}.strings.${path} must not be empty`);
    }
  }
});

test('verdict-templates.mjs (client-side format strings) has the same key set as es/en verdict function dicts, and es/en templates match each other', () => {
  assert.deepEqual(Object.keys(esTpl).sort(), Object.keys(es.verdict).sort());
  assert.deepEqual(Object.keys(enTpl).sort(), Object.keys(en.verdict).sort());
  assert.deepEqual(Object.keys(esTpl).sort(), Object.keys(enTpl).sort());
});

test('verdict-templates.mjs entries are non-empty strings containing at least one {placeholder} where the matching verdict function takes arguments', () => {
  const zeroArgFns = new Set(['cutDessert', 'cutDinnerCarb', 'sweetTreats']);
  for (const [locale, tpl] of [['es', esTpl], ['en', enTpl]]) {
    for (const [key, str] of Object.entries(tpl)) {
      assert.equal(typeof str, 'string');
      assert.notEqual(str.trim(), '', `${locale} verdict-templates.${key} must not be empty`);
      if (!zeroArgFns.has(key)) {
        assert.match(str, /\{\w+\}/, `${locale} verdict-templates.${key} should contain at least one {placeholder}`);
      }
    }
  }
});

test('log-templates.mjs (client-side "copy for Claude" format strings) has identical keys in es/en, all non-empty', () => {
  assert.deepEqual(Object.keys(esLog).sort(), Object.keys(enLog).sort());
  for (const [locale, tpl] of [['es', esLog], ['en', enLog]]) {
    for (const [key, str] of Object.entries(tpl)) {
      assert.equal(typeof str, 'string');
      assert.notEqual(str.trim(), '', `${locale} log-templates.${key} must not be empty`);
    }
  }
});

test('every verdict function produces a non-empty string for representative dummy arguments', () => {
  const args = {
    proteinOk: [150], proteinShort: [140, 170], proteinVeryShort: [90, 170],
    overBudget: [250, ['a cut', 'another cut']], underBudget: [350], onTarget: [50],
    fatHigh: [90], cutExtras: [120], cutDessert: [], cutDinnerCarb: [],
    alcohol: ['beer', 1, 118], sweetTreats: [], mealReplace: ['pintxo'],
  };
  for (const [locale, dict] of [['es', es], ['en', en]]) {
    for (const [key, fn] of Object.entries(dict.verdict)) {
      const result = fn(...(args[key] || []));
      assert.equal(typeof result, 'string', `${locale}.verdict.${key} must return a string`);
      assert.notEqual(result.trim(), '', `${locale}.verdict.${key} must not return an empty string`);
    }
  }
});
