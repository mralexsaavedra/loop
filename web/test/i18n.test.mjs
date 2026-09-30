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
import { es as esScore, en as enScore } from '../src/i18n/score-templates.mjs';
import { es as esIntake, en as enIntake } from '../src/i18n/intake-templates.mjs';
import { es as esNutri, en as enNutri } from '../src/i18n/nutri-templates.mjs';
import { GOALS, DAY_TYPES } from '../../lib/nutrition/targets.mjs';
import { MEAL_SLOTS } from '../../lib/nutrition/slots.mjs';
import { es as esAct, en as enAct } from '../src/i18n/activity-templates.mjs';
import { es as esSync, en as enSync } from '../src/i18n/sync-templates.mjs';
import { es as esDate, en as enDate } from '../src/i18n/date-templates.mjs';
import { es as esDetail, en as enDetail } from '../src/i18n/detail-templates.mjs';
import { DETAIL_KEYS } from '../../lib/detail/detail.mjs';
import { ADVICE_COPY } from '../../lib/score/advice-copy.mjs';

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

test('score-templates.mjs (Home tab) has identical key trees in es/en and no empty leaves', () => {
  assert.deepEqual(keyTree(esScore), keyTree(enScore));
  for (const [locale, dict] of [['es', esScore], ['en', enScore]]) {
    for (const [p, v] of leaves(dict)) {
      assert.equal(typeof v, 'string', `${locale}.${p} must be a string`);
      assert.notEqual(v.trim(), '', `${locale}.${p} must not be empty`);
    }
  }
});

test('score-templates.mjs reuses the advice copy from lib/score/advice-copy.mjs (single source)', () => {
  assert.deepEqual(esScore.advice, ADVICE_COPY.es);
  assert.deepEqual(enScore.advice, ADVICE_COPY.en);
});

test('score-templates.mjs carries the four accurate caveats, SDNN and the not-medical note; never the false strength claim', () => {
  for (const [locale, dict] of [['es', esScore], ['en', enScore]]) {
    for (const k of ['re', 'notComparable', 'gymLabel', 'noEpoch', 'residual', 'sdnn', 'notMedical']) {
      assert.ok(dict.caveats[k], `${locale}.caveats.${k}`);
    }
    assert.match(dict.caveats.sdnn, /SDNN/);
    const all = JSON.stringify(dict);
    assert.doesNotMatch(all, /under-?weights? strength|infrarrepresenta/i, `${locale} must not repeat the retired strength caveat`);
  }
  assert.match(enScore.caveats.re, /HR-derived/);
  assert.match(enScore.caveats.re, /metcon/);
  assert.match(enScore.caveats.notComparable, /not comparable/i);
  assert.match(enScore.caveats.gymLabel, /auto-label/i);
  assert.match(enScore.caveats.notMedical, /not medical advice/i);
});

test('score-templates.mjs placeholders that score.js fills are present', () => {
  for (const dict of [esScore, enScore]) {
    assert.match(dict.asOfLbl, /\{date\}/);
    assert.match(dict.staleNote, /\{days\}/);
    assert.match(dict.load.relLbl, /\{modality\}/);
    assert.match(dict.load.preEpochNote, /\{date\}/);
    assert.match(dict.load.otherLine, /\{minutes\}/);
    assert.match(dict.recovery.trendLbl, /\{value\}/);
  }
});

test('Salud copy no longer claims HR under-reads/under-represents strength, and says the index counts only sessions with heart rate', () => {
  for (const [locale, dict] of [['es', esHealth], ['en', enHealth]]) {
    assert.doesNotMatch(dict.loadNoteHtml, /under-reads strength|infrarrepresenta/i, locale);
  }
  assert.match(esHealth.loadSec.hint, /solo sesiones con pulso/);
  assert.match(enHealth.loadSec.hint, /only sessions with heart rate/);
  assert.match(esHealth.loadNoteHtml, /metcon/);
  assert.match(enHealth.loadNoteHtml, /metcon/);
});

test('Entrenamiento dashboard labels the watch "hiit" bucket as gym (matches Inicio), strength stays separate', () => {
  assert.equal(esDash.modalityLabels.hiit, 'Gimnasio');
  assert.equal(enDash.modalityLabels.hiit, 'Gym');
  assert.equal(esDash.modalityLabels.strength, 'Fuerza');
  assert.equal(enDash.modalityLabels.strength, 'Strength');
  // the on-screen caveat must name the bar by its visible label
  assert.match(esDash.note1Html, /«Gimnasio»/);
  assert.match(enDash.note1Html, /“Gym”/);
});

test('intake-templates.mjs (Mi día intake rings) has identical key trees in es/en, no empty leaves, and the placeholders intake.js relies on', () => {
  assert.deepEqual(keyTree(esIntake), keyTree(enIntake));
  for (const [locale, dict] of [['es', esIntake], ['en', enIntake]]) {
    for (const [p, value] of leaves(dict)) {
      if (typeof value === 'string') assert.notEqual(value.trim(), '', `${locale} intake-templates.${p} must not be empty`);
    }
    assert.match(dict.ofTpl, /\{target\}/);
    assert.match(dict.ofTpl, /\{unit\}/);
    assert.match(dict.emptyHtml, /\{days\}/);
    assert.match(dict.emptyHtml, /diet_kcal/, `${locale} empty state names the Shortcut keys`);
  }
});

test('nutri-templates.mjs (Resumen de hoy / Plan de hoy / Avituallamiento) has identical key trees in es/en, every goal / day type / meal slot, and the placeholders nutri-day.js relies on', () => {
  assert.deepEqual(keyTree(esNutri), keyTree(enNutri));
  for (const [locale, dict] of [['es', esNutri], ['en', enNutri]]) {
    for (const [p, value] of leaves(dict)) {
      if (typeof value === 'string') assert.notEqual(value.trim(), '', `${locale} nutri-templates.${p} must not be empty`);
    }
    assert.deepEqual(Object.keys(dict.goals), GOALS);
    assert.deepEqual(Object.keys(dict.dayTypes), DAY_TYPES);
    assert.deepEqual(Object.keys(dict.dayShort), DAY_TYPES);
    assert.equal(dict.dayIcons, undefined, 'no emoji: the segments draw inline SVG icons');
    for (const v of Object.values(dict.dayShort)) assert.ok(v.length <= 10, `${locale} short day label "${v}" fits a quarter of 360 px`);
    assert.deepEqual(Object.keys(dict.plan.meals), MEAL_SLOTS);
    assert.match(dict.backToAuto, /\{type\}/);
    assert.match(dict.why.ride, /\{dur\}/);
    for (const k of ['remShort', 'remShortBike']) assert.match(dict[k], /\{k\}[\s\S]*\{g\}/);
    for (const k of ['k', 'fuel', 'total']) assert.match(dict.planLineBike, new RegExp('\\{' + k + '\\}'));
    assert.match(dict.macroOff, /\{macro\}[\s\S]*\{plan\}[\s\S]*\{target\}/);
    assert.match(dict.fuel.duringCarbs, /\{rate\}[\s\S]*\{total\}/);
    assert.match(dict.fuel.disclaimer, locale === 'es' ? /no es consejo médico/i : /not medical advice/i);
  }
});

test('activity-templates.mjs (Entreno calendar + cumulative time) has identical key trees in es/en, no empty strings, 5 levels and 7 weekdays', () => {
  assert.deepEqual(keyTree(esAct), keyTree(enAct));
  for (const [locale, dict] of [['es', esAct], ['en', enAct]]) {
    for (const [path, value] of leaves(dict)) {
      if (typeof value === 'string') assert.notEqual(value.trim(), '', `${locale} activity-templates.${path} must not be empty`);
    }
    assert.equal(dict.levels.length, 5, `${locale} levels`);
    assert.equal(dict.weekdays.length, 7, `${locale} weekdays`);
    assert.match(dict.calHint, /\{days\}/);
    assert.match(dict.staleNote, /\{days\}/);
  }
});

test('score-templates.mjs timeline copy has the placeholders timeline.js relies on', () => {
  for (const dict of [esScore, enScore]) {
    assert.match(dict.timeline.dateHeading, /\{date\}/);
    assert.match(dict.timeline.minutes, /\{n\}/);
    assert.match(dict.timeline.re, /\{n\}/);
    assert.deepEqual(Object.keys(dict.timeline.modalities), ['gym', 'run', 'bike', 'other']);
  }
});

test('sync-templates.mjs (freshness line + Sync button) has identical key trees in es/en, no empty leaves, {n} where freshness.js substitutes it', () => {
  assert.deepEqual(keyTree(esSync), keyTree(enSync));
  for (const [locale, dict] of [['es', esSync], ['en', enSync]]) {
    for (const [path, value] of leaves(dict)) {
      assert.equal(typeof value, 'string', `${locale} sync-templates.${path}`);
      assert.notEqual(value.trim(), '', `${locale} sync-templates.${path} must not be empty`);
    }
    for (const k of ['minAgo', 'hAgo', 'dAgo']) assert.match(dict[k], /\{n\}/, `${locale}.${k}`);
    assert.deepEqual(Object.keys(dict.labels), ['shortcut', 'strava', 'page']);
    assert.deepEqual(Object.keys(dict.hints), ['shortcut', 'strava', 'page']);
    assert.match(dict.failedCode, /\{reason\}/, `${locale}.failedCode`);
    // every coarse code refresh.sh (status.json error) or ingest (lastTriggerError) can report, + a fallback
    assert.deepEqual(Object.keys(dict.errors), ['branch', 'install', 'build', 'sanity', 'lock', 'trigger_write', 'unknown']);
    assert.equal(dict.wait, undefined, 'no 429 copy: POST /sync never refuses, it coalesces');
  }
  assert.equal(esSync.button, 'Sincronizar');
  assert.equal(enSync.button, 'Sync');
});

test('detail-templates.mjs (detail sheet) has identical key trees in es/en, no empty leaves, a title + unit for every DETAIL key', () => {
  assert.deepEqual(keyTree(esDetail), keyTree(enDetail));
  for (const [locale, dict] of [['es', esDetail], ['en', enDetail]]) {
    for (const [path, value] of leaves(dict)) assert.notEqual(String(value).trim(), '', `${locale} detail-templates.${path} must not be empty`);
    assert.deepEqual(Object.keys(dict.metrics), [...DETAIL_KEYS], `${locale}: one entry per DETAIL key, in order`);
    for (const k of DETAIL_KEYS) assert.ok(dict.metrics[k].title && dict.metrics[k].unit, `${locale}.metrics.${k}`);
    assert.deepEqual(Object.keys(dict.modalities), ['gym', 'run', 'bike', 'other']);
    for (const [k, ph] of [['latestLbl', 'date'], ['staleNote', 'date'], ['chartAria', 'from'], ['calAria', 'month']]) assert.match(dict[k], new RegExp(`\\{${ph}\\}`), `${locale}.${k}`);
    for (const k of ['monitor', 'iqr']) for (const ph of ['lo', 'hi', 'median', 'unit']) assert.match(dict.bands[k], new RegExp(`\\{${ph}\\}`), `${locale}.bands.${k}`);
  }
  assert.equal(esDetail.ranges.d365, '1 año');
});

test('date-templates.mjs (HC.fmtDate names) has identical key trees in es/en, 7 Monday-first weekdays and 12 months', () => {
  assert.deepEqual(keyTree(esDate), keyTree(enDate));
  for (const [locale, dict] of [['es', esDate], ['en', enDate]]) {
    for (const [path, value] of leaves(dict)) assert.notEqual(String(value).trim(), '', `${locale} date-templates.${path} must not be empty`);
    for (const k of ['weekdays', 'weekdaysMin']) assert.equal(dict[k].length, 7, `${locale}.${k}`);
    for (const k of ['months', 'monthsLong']) assert.equal(dict[k].length, 12, `${locale}.${k}`);
    assert.match(dict.dayTpl, /\{weekday\}.*\{day\}.*\{month\}/);
    assert.match(dict.monthTpl, /\{month\}.*\{year\}/);
  }
  assert.equal(esDate.weekdays[0], 'lun');
  assert.equal(enDate.weekdays[0], 'Mon');
});
