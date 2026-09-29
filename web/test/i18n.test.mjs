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
import { es as esHoy, en as enHoy } from '../src/i18n/hoy-templates.mjs';
import { es as esDash, en as enDash } from '../src/i18n/dash-templates.mjs';
import { es as esHealth, en as enHealth } from '../src/i18n/health-templates.mjs';

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

test('hoy-templates.mjs (Hoy tab client format strings) has identical keys in es/en, all non-empty', () => {
  assert.deepEqual(Object.keys(esHoy).sort(), Object.keys(enHoy).sort());
  for (const [locale, tpl] of [['es', esHoy], ['en', enHoy]]) {
    for (const [key, str] of Object.entries(tpl)) {
      assert.equal(typeof str, 'string');
      assert.notEqual(str.trim(), '', `${locale} hoy-templates.${key} must not be empty`);
    }
  }
});

test('hoy-templates.mjs goalLineRe is a valid, locale-specific regex source (compilable with `new RegExp`)', () => {
  assert.doesNotThrow(() => new RegExp(esHoy.goalLineRe, 'i'));
  assert.doesNotThrow(() => new RegExp(enHoy.goalLineRe, 'i'));
  assert.notEqual(esHoy.goalLineRe, enHoy.goalLineRe, 'the goal-line marker word differs by locale ("Objetivo" vs "Target/Goal")');
});

test('dash-templates.mjs (Entrenos tab client format strings) has identical keys in es/en, all non-empty (nested modalityLabels checked separately)', () => {
  assert.deepEqual(Object.keys(esDash).sort(), Object.keys(enDash).sort());
  for (const [locale, tpl] of [['es', esDash], ['en', enDash]]) {
    for (const [key, val] of Object.entries(tpl)) {
      if (key === 'modalityLabels') continue;
      assert.equal(typeof val, 'string');
      assert.notEqual(val.trim(), '', `${locale} dash-templates.${key} must not be empty`);
    }
  }
});

test('dash-templates.mjs modalityLabels covers the same modality keys (strength/hiit/run/bike/other) in es/en, all non-empty', () => {
  assert.deepEqual(Object.keys(esDash.modalityLabels).sort(), ['bike', 'hiit', 'other', 'run', 'strength']);
  assert.deepEqual(Object.keys(esDash.modalityLabels).sort(), Object.keys(enDash.modalityLabels).sort());
  for (const [locale, labels] of [['es', esDash.modalityLabels], ['en', enDash.modalityLabels]]) {
    for (const [key, str] of Object.entries(labels)) assert.notEqual(str.trim(), '', `${locale} dash-templates.modalityLabels.${key} must not be empty`);
  }
});

test('dash-templates.mjs asOfLine credits both Apple Health and Strava as data sources', () => {
  assert.match(esDash.asOfLine, /Apple Health/);
  assert.match(esDash.asOfLine, /Strava/);
  assert.match(enDash.asOfLine, /Apple Health/);
  assert.match(enDash.asOfLine, /Strava/);
});

test('health-templates.mjs (Salud tab client format strings) has identical key trees in es/en, all string leaves non-empty (deltaUnit legitimately empty for unit-less deltas, matches legacy delta(d,\'\',goodDir) call sites)', () => {
  assert.deepEqual(keyTree(esHealth), keyTree(enHealth));
  for (const [locale, dict] of [['es', esHealth], ['en', enHealth]]) {
    for (const [path, value] of leaves(dict)) {
      if (path.endsWith('.deltaUnit')) continue;
      if (typeof value === 'string') assert.notEqual(value.trim(), '', `${locale} health-templates.${path} must not be empty`);
    }
  }
});

test('health-templates.mjs note/card sub-dictionaries have the placeholders health.js relies on', () => {
  for (const [locale, dict] of [['es', esHealth], ['en', enHealth]]) {
    assert.match(dict.bodyNote.main, /\{sourcesClause\}/, `${locale} bodyNote.main must contain {sourcesClause}`);
    assert.match(dict.bodyNote.main, /\{sourceClause\}/, `${locale} bodyNote.main must contain {sourceClause}`);
    assert.match(dict.bodyNote.main, /\{bfSourceClause\}/, `${locale} bodyNote.main must contain {bfSourceClause}`);
    assert.match(dict.energyBalanceNote.main, /\{from\}/);
    assert.match(dict.energyBalanceNote.main, /\{to\}/);
    assert.match(dict.energyBalanceNote.main, /\{days\}/);
    assert.match(dict.energyBalanceNote.main, /\{macroClause\}/);
    assert.match(dict.energyExpenditureNote.main, /\{tdeeDays\}/);
    assert.match(dict.energyExpenditureNote.main, /\{lastIntakeClause\}/);
    assert.match(dict.runningNote, /\{count\}/, `${locale} runningNote must contain {count}`);
    assert.match(dict.loadSec.hint, /\{weeks\}/);
    assert.match(dict.loadSec.barTitleTpl, /\{date\}/);
    assert.match(dict.loadSec.barTitleTpl, /\{load\}/);
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
